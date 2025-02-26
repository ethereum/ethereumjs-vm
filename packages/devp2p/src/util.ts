import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  bytesToHex,
  bytesToUnprefixedHex,
  concatBytes,
  equalsBytes,
} from '@ethereumjs/util'
import debug from 'debug'
import { publicKeyConvert } from 'ethereum-cryptography/secp256k1-compat.js'
import { secp256k1 } from 'ethereum-cryptography/secp256k1.js'

import type { ETH } from './protocol/eth.js'

export const devp2pDebug = debug('devp2p:#')

export function genPrivateKey(): Uint8Array {
  const privateKey = secp256k1.utils.randomPrivateKey()
  return secp256k1.utils.isValidPrivateKey(privateKey) === true ? privateKey : genPrivateKey()
}

export function pk2id(pk: Uint8Array): Uint8Array {
  if (pk.length === 33) {
    pk = publicKeyConvert(pk, false)
  }
  return pk.subarray(1)
}

export function id2pk(id: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.from([0x04]), id)
}

export function zfill(bytes: Uint8Array, size: number, leftpad: boolean = true): Uint8Array {
  if (bytes.length >= size) return bytes
  if (leftpad === undefined) leftpad = true
  const pad = new Uint8Array(size - bytes.length).fill(0x00)
  return leftpad ? concatBytes(pad, bytes) : concatBytes(bytes, pad)
}

export function xor(a: Uint8Array, b: any): Uint8Array {
  const length = Math.min(a.length, b.length)
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; ++i) bytes[i] = a[i] ^ b[i]
  return bytes
}

type assertInput = Uint8Array | Uint8Array[] | ETH.StatusMsg | number | null

export function assertEq(
  expected: assertInput,
  actual: assertInput,
  msg: string,
  debug: Function,
  messageName?: string,
): void {
  let fullMsg

  if (expected instanceof Uint8Array && actual instanceof Uint8Array) {
    if (equalsBytes(expected, actual)) return
    fullMsg = `${msg}: ${bytesToHex(expected)} / ${bytesToHex(actual)}`
    const debugMsg = `[ERROR] ${fullMsg}`
    if (messageName !== undefined) {
      debug(messageName, debugMsg)
    } else {
      debug(debugMsg)
    }
    throw EthereumJSErrorWithoutCode(fullMsg)
  }

  if (expected === actual) return
  fullMsg = `${msg}: ${expected} / ${actual}`
  if (messageName !== undefined) {
    debug(messageName, fullMsg)
  } else {
    debug(fullMsg)
  }
  throw EthereumJSErrorWithoutCode(fullMsg)
}

export function formatLogId(id: string, verbose: boolean): string {
  const numChars = 7
  if (verbose) {
    return id
  } else {
    return `${id.substring(0, numChars)}`
  }
}

export function formatLogData(data: string, verbose: boolean): string {
  const maxChars = 60
  if (verbose || data.length <= maxChars) {
    return data
  } else {
    return `${data.substring(0, maxChars)}...`
  }
}

export class Deferred<T> {
  promise: Promise<T>
  resolve: (...args: any[]) => any = () => {}
  reject: (...args: any[]) => any = () => {}
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

export function createDeferred<T>(): Deferred<T> {
  return new Deferred()
}

export function unstrictDecode(value: Uint8Array) {
  // rlp library throws on remainder.length !== 0
  // this utility function bypasses that
  return RLP.decode(value, true).data
}

/*************************** ************************************************************/
// Methods borrowed from `node-ip` by Fedor Indutny (https://github.com/indutny/node-ip)
// and modified to use Uint8Arrays instead of Buffers
export const ipToString = (bytes: Uint8Array, offset?: number, length?: number): string => {
  offset = offset !== undefined ? ~~offset : 0
  length = length ?? bytes.length - offset

  const tempArray: Array<number | string> = []
  let result: string = ''
  if (length === 4) {
    // IPv4
    for (let i = 0; i < length; i++) {
      tempArray.push(bytes[offset + i])
    }
    result = tempArray.join('.')
  } else if (length === 16) {
    // IPv6
    for (let i = 0; i < length; i += 2) {
      tempArray.push(new DataView(bytes.buffer).getUint16(offset + i).toString(16))
    }
    result = tempArray.join(':')
    result = result.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3')
    result = result.replace(/:{3,4}/, '::')
  }

  return result
}

const ipv4Regex = /^(\d{1,3}\.){3,3}\d{1,3}$/
const ipv6Regex = /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i

export const isV4Format = function (ip: string): boolean {
  return ipv4Regex.test(ip)
}

export const isV6Format = function (ip: string): boolean {
  return ipv6Regex.test(ip)
}

export const ipToBytes = (ip: string, bytes?: Uint8Array, offset: number = 0): Uint8Array => {
  offset = ~~offset

  let result: Uint8Array

  if (isV4Format(ip)) {
    result = bytes ?? new Uint8Array(offset + 4)
    ip.split(/\./g).map((byte) => {
      result[offset++] = parseInt(byte, 10) & 0xff
    })
  } else if (isV6Format(ip)) {
    const sections = ip.split(':', 8)

    let i
    for (i = 0; i < sections.length; i++) {
      const isv4 = isV4Format(sections[i])
      let v4Bytes: Uint8Array = new Uint8Array([])

      if (isv4) {
        v4Bytes = ipToBytes(sections[i])
        sections[i] = bytesToUnprefixedHex(v4Bytes.subarray(0, 2))
      }

      if (v4Bytes.length > 0 && ++i < 8) {
        sections.splice(i, 0, bytesToUnprefixedHex(v4Bytes.subarray(2, 4)))
      }
    }

    if (sections[0] === '') {
      while (sections.length < 8) sections.unshift('0')
    } else if (sections[sections.length - 1] === '') {
      while (sections.length < 8) sections.push('0')
    } else if (sections.length < 8) {
      for (i = 0; i < sections.length && sections[i] !== ''; i++);
      const argv: any = [i, 1]
      for (i = 9 - sections.length; i > 0; i--) {
        argv.push('0')
      }
      sections.splice.apply(sections, argv)
    }

    result = bytes ?? new Uint8Array(offset + 16)
    for (i = 0; i < sections.length; i++) {
      const word = parseInt(sections[i], 16)
      result[offset++] = (word >> 8) & 0xff
      result[offset++] = word & 0xff
    }
  } else {
    throw Error(`Invalid ip format: ${ip}`)
  }

  if (result === undefined) {
    throw Error(`Invalid ip address: ${ip}`)
  }

  return result
}

/************  End of methods borrowed from `node-ip` ***************************/
