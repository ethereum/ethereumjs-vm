import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  bytesToHex,
  bytesToInt,
  bytesToUtf8,
  concatBytes,
  intToBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { ecdsaRecover, ecdsaSign } from 'ethereum-cryptography/secp256k1-compat.js'

import { assertEq, ipToBytes, ipToString, isV4Format, isV6Format, unstrictDecode } from '../util.js'

import type { PeerInfo } from '../types.js'
import type { Common } from '@ethereumjs/common'

const debug = debugDefault('devp2p:dpt:server')

function getTimestamp() {
  return (Date.now() / 1000) | 0
}

const timestamp = {
  encode(value = getTimestamp() + 60) {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value)
    return bytes
  },
  decode(bytes: Uint8Array) {
    if (bytes.length !== 4) throw new RangeError(`Invalid timestamp bytes :${bytesToHex(bytes)}`)
    return new DataView(bytes.buffer).getUint32(0)
  },
}

const address = {
  encode(value: string) {
    if (isV4Format(value)) return ipToBytes(value)
    if (isV6Format(value)) return ipToBytes(value)
    throw EthereumJSErrorWithoutCode(`Invalid address: ${value}`)
  },
  decode(bytes: Uint8Array) {
    if (bytes.length === 4) return ipToString(bytes)
    if (bytes.length === 16) return ipToString(bytes)

    const str = bytesToUtf8(bytes)
    if (isV4Format(str) || isV6Format(str)) return str

    // also can be host, but skip it right now (because need async function for resolve)
    throw EthereumJSErrorWithoutCode(`Invalid address bytes: ${bytesToHex(bytes)}`)
  },
}

const port = {
  encode(value: number | null): Uint8Array {
    if (value === null) return new Uint8Array()
    if (value >>> 16 > 0) throw new RangeError(`Invalid port: ${value}`)
    return Uint8Array.from([(value >>> 8) & 0xff, (value >>> 0) & 0xff])
  },
  decode(bytes: Uint8Array): number | null {
    if (bytes.length === 0) return null
    return bytesToInt(bytes)
  },
}

const endpoint = {
  encode(obj: PeerInfo): Uint8Array[] {
    return [
      address.encode(obj.address!),
      port.encode(obj.udpPort ?? null),
      port.encode(obj.tcpPort ?? null),
    ]
  },
  decode(payload: Uint8Array[]): PeerInfo {
    return {
      address: address.decode(payload[0]),
      udpPort: port.decode(payload[1]),
      tcpPort: port.decode(payload[2]),
    }
  },
}

type InPing = { [0]: Uint8Array; [1]: Uint8Array[]; [2]: Uint8Array[]; [3]: Uint8Array }
type OutPing = { version: number; from: PeerInfo; to: PeerInfo; timestamp: number }
const ping = {
  encode(obj: OutPing): InPing {
    return [
      intToBytes(obj.version),
      endpoint.encode(obj.from),
      endpoint.encode(obj.to),
      timestamp.encode(obj.timestamp),
    ]
  },
  decode(payload: InPing): OutPing {
    return {
      version: bytesToInt(payload[0]),
      from: endpoint.decode(payload[1]),
      to: endpoint.decode(payload[2]),
      timestamp: timestamp.decode(payload[3]),
    }
  },
}

type OutPong = { to: PeerInfo; hash: Uint8Array; timestamp: number }
type InPong = { [0]: Uint8Array[]; [1]: Uint8Array[]; [2]: Uint8Array }
const pong = {
  encode(obj: OutPong) {
    return [endpoint.encode(obj.to), obj.hash, timestamp.encode(obj.timestamp)]
  },
  decode(payload: InPong) {
    return {
      to: endpoint.decode(payload[0]),
      hash: payload[1],
      timestamp: timestamp.decode(payload[2]),
    }
  },
}

type OutFindMsg = { id: string; timestamp: number }
type InFindMsg = { [0]: string; [1]: Uint8Array }
const findneighbours = {
  encode(obj: OutFindMsg): InFindMsg {
    return [obj.id, timestamp.encode(obj.timestamp)]
  },
  decode(payload: InFindMsg): OutFindMsg {
    return {
      id: payload[0],
      timestamp: timestamp.decode(payload[1]),
    }
  },
}

type InNeighborMsg = { peers: PeerInfo[]; timestamp: number }
type OutNeighborMsg = { [0]: Uint8Array[][]; [1]: Uint8Array }
const neighbours = {
  encode(obj: InNeighborMsg): OutNeighborMsg {
    return [
      obj.peers.map((peer: PeerInfo) => endpoint.encode(peer).concat(peer.id as Uint8Array)),
      timestamp.encode(obj.timestamp),
    ]
  },
  decode(payload: OutNeighborMsg): InNeighborMsg {
    return {
      peers: payload[0].map((data) => {
        return { endpoint: endpoint.decode(data), id: data[3] } // hack for id
      }),
      timestamp: timestamp.decode(payload[1]),
    }
  },
}

const messages: any = {
  ping,
  pong,
  findneighbours,
  neighbours,
}

type Types = { [index: string]: { [index: string]: number | string } }
const types: Types = {
  byName: {
    ping: 0x01,
    pong: 0x02,
    findneighbours: 0x03,
    neighbours: 0x04,
  },
  byType: {
    0x01: 'ping',
    0x02: 'pong',
    0x03: 'findneighbours',
    0x04: 'neighbours',
  },
}

// [0, 32) data hash
// [32, 96) signature
// 96 recoveryId
// 97 type
// [98, length) data

export function encode<T>(typename: string, data: T, privateKey: Uint8Array, common?: Common) {
  const type: number = types.byName[typename] as number
  if (type === undefined) throw EthereumJSErrorWithoutCode(`Invalid typename: ${typename}`)
  const encodedMsg = messages[typename].encode(data)
  const typedata = concatBytes(Uint8Array.from([type]), RLP.encode(encodedMsg))

  const sighash = (common?.customCrypto.keccak256 ?? keccak256)(typedata)
  const sig = (common?.customCrypto.ecdsaSign ?? ecdsaSign)(sighash, privateKey)
  const hashdata = concatBytes(sig.signature, Uint8Array.from([sig.recid]), typedata)
  const hash = (common?.customCrypto.keccak256 ?? keccak256)(hashdata)
  return concatBytes(hash, hashdata)
}

export function decode(bytes: Uint8Array, common?: Common) {
  const hash = (common?.customCrypto.keccak256 ?? keccak256)(bytes.subarray(32))
  assertEq(bytes.subarray(0, 32), hash, 'Hash verification failed', debug)

  const typedata = bytes.subarray(97)
  const type = typedata[0]
  const typename = types.byType[type]
  if (typename === undefined) throw EthereumJSErrorWithoutCode(`Invalid type: ${type}`)
  const data = messages[typename].decode(unstrictDecode(typedata.subarray(1)))

  const sighash = (common?.customCrypto.keccak256 ?? keccak256)(typedata)
  const signature = bytes.subarray(32, 96)
  const recoverId = bytes[96]
  const publicKey = (common?.customCrypto.ecdsaRecover ?? ecdsaRecover)(
    signature,
    recoverId,
    sighash,
    false,
  )
  return { typename, data, publicKey }
}
