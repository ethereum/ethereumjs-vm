import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  bytesToInt,
  concatBytes,
  hexToBytes,
  intToBytes,
} from '@ethereumjs/util'
import * as crypto from 'crypto'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { getRandomBytesSync } from 'ethereum-cryptography/random.js'
import { ecdh, ecdsaRecover, ecdsaSign } from 'ethereum-cryptography/secp256k1-compat.js'
import { secp256k1 } from 'ethereum-cryptography/secp256k1.js'

import { assertEq, genPrivateKey, id2pk, pk2id, unstrictDecode, xor, zfill } from '../util.js'

import { MAC } from './mac.js'

import type { Common } from '@ethereumjs/common'
type Decipher = crypto.Decipher

const debug = debugDefault('devp2p:rlpx:peer')

function ecdhX(publicKey: Uint8Array, privateKey: Uint8Array) {
  // return (publicKey * privateKey).x
  function hashfn(x: Uint8Array, y: Uint8Array) {
    const pubKey = new Uint8Array(33)
    pubKey[0] = (y[31] & 1) === 0 ? 0x02 : 0x03
    pubKey.set(x, 1)
    return pubKey.subarray(1)
  }
  return ecdh(publicKey, privateKey, { hashfn }, new Uint8Array(32))
}

// a straight rip from python interop w/go ecies implementation
// for sha3, blocksize is 136 bytes
// for sha256, blocksize is 64 bytes
// NIST SP 800-56a Concatenation Key Derivation Function (see section 5.8.1).
// https://github.com/ethereum/pydevp2p/blob/master/devp2p/crypto.py#L295
// https://github.com/ethereum/go-ethereum/blob/fe532a98f9f32bb81ef0d8d013cf44327830d11e/crypto/ecies/ecies.go#L165
// https://github.com/ethereum/cpp-ethereum/blob/develop/libdevcrypto/CryptoPP.cpp#L36
function concatKDF(keyMaterial: Uint8Array, keyLength: number) {
  const SHA256BlockSize = 64
  const reps = ((keyLength + 7) * 8) / (SHA256BlockSize * 8)

  const bytes = []
  for (let counter = 0, tmp = new Uint8Array(4); counter <= reps; ) {
    counter += 1
    new DataView(tmp.buffer).setUint32(0, counter)
    bytes.push(
      Uint8Array.from(crypto.createHash('sha256').update(tmp).update(keyMaterial).digest()),
    )
  }

  return concatBytes(...bytes).subarray(0, keyLength)
}

export class ECIES {
  protected _privateKey: Uint8Array
  protected _publicKey: Uint8Array
  protected _remotePublicKey: Uint8Array | null
  protected _nonce: Uint8Array
  protected _remoteNonce: Uint8Array | null = null
  protected _initMsg: Uint8Array | null | undefined = null
  protected _remoteInitMsg: Uint8Array | null = null
  protected _gotEIP8Auth: boolean = false
  protected _gotEIP8Ack: boolean = false
  protected _ingressAes: Decipher | null = null
  protected _egressAes: Decipher | null = null
  protected _ingressMac: MAC | null = null
  protected _egressMac: MAC | null = null
  protected _ephemeralPrivateKey: Uint8Array
  protected _ephemeralPublicKey: Uint8Array
  protected _remoteEphemeralPublicKey: Uint8Array | null = null // we don't need store this key, but why don't?
  protected _ephemeralSharedSecret: Uint8Array | null = null
  protected _bodySize: number | null = null

  protected _keccakFunction: (msg: Uint8Array) => Uint8Array
  protected _ecdsaSign: (
    msg: Uint8Array,
    pk: Uint8Array,
  ) => {
    signature: Uint8Array
    recid: number
  }
  protected _ecdsaRecover: (
    sig: Uint8Array,
    recId: number,
    hash: Uint8Array,
    compressed?: boolean,
  ) => Uint8Array

  constructor(privateKey: Uint8Array, id: Uint8Array, remoteId: Uint8Array, common?: Common) {
    this._privateKey = privateKey
    this._publicKey = id2pk(id)
    this._remotePublicKey = remoteId !== null ? id2pk(remoteId) : null

    this._nonce = getRandomBytesSync(32)
    this._ephemeralPrivateKey = genPrivateKey()
    this._ephemeralPublicKey = secp256k1.getPublicKey(this._ephemeralPrivateKey, false)

    this._keccakFunction = common?.customCrypto.keccak256 ?? keccak256
    this._ecdsaSign = common?.customCrypto.ecdsaSign ?? ecdsaSign
    this._ecdsaRecover = common?.customCrypto.ecdsaRecover ?? ecdsaRecover
  }

  _encryptMessage(
    data: Uint8Array,
    sharedMacData: Uint8Array | null = null,
  ): Uint8Array | undefined {
    const privateKey = genPrivateKey()
    if (!this._remotePublicKey) return
    const x = ecdhX(this._remotePublicKey, privateKey)
    const key = concatKDF(x, 32)
    const ekey = key.subarray(0, 16) // encryption key
    const mKey = crypto.createHash('sha256').update(key.subarray(16, 32)).digest() // MAC key

    // encrypt
    const IV = getRandomBytesSync(16)
    const cipher = crypto.createCipheriv('aes-128-ctr', ekey, IV)
    const encryptedData = Uint8Array.from(cipher.update(data))
    const dataIV = concatBytes(IV, encryptedData)

    // create tag
    if (!sharedMacData) {
      sharedMacData = Uint8Array.from([])
    }
    const tag = Uint8Array.from(
      crypto.createHmac('sha256', mKey).update(concatBytes(dataIV, sharedMacData)).digest(),
    )

    const publicKey = secp256k1.getPublicKey(privateKey, false)
    return concatBytes(publicKey, dataIV, tag)
  }

  _decryptMessage(data: Uint8Array, sharedMacData: Uint8Array | null = null): Uint8Array {
    assertEq(
      data.subarray(0, 1),
      hexToBytes('0x04'),
      'wrong ecies header (possible cause: EIP8 upgrade)',
      debug,
    )

    const publicKey = data.subarray(0, 65)
    const dataIV = data.subarray(65, -32)
    const tag = data.subarray(-32)

    // derive keys
    const x = ecdhX(publicKey, this._privateKey)
    const key = concatKDF(x, 32)
    const ekey = key.subarray(0, 16) // encryption key
    const mKey = Uint8Array.from(crypto.createHash('sha256').update(key.subarray(16, 32)).digest()) // MAC key

    // check the tag
    if (!sharedMacData) {
      sharedMacData = Uint8Array.from([])
    }
    const _tag = crypto
      .createHmac('sha256', mKey)
      .update(concatBytes(dataIV, sharedMacData))
      .digest()
    assertEq(_tag, tag, 'should have valid tag', debug)

    // decrypt data
    const IV = dataIV.subarray(0, 16)
    const encryptedData = dataIV.subarray(16)
    const decipher = crypto.createDecipheriv('aes-128-ctr', ekey, IV)
    return Uint8Array.from(decipher.update(encryptedData))
  }

  _setupFrame(remoteData: Uint8Array, incoming: boolean): void {
    if (!this._remoteNonce) return
    const nonceMaterial = incoming
      ? concatBytes(this._nonce, this._remoteNonce)
      : concatBytes(this._remoteNonce, this._nonce)
    const hNonce = this._keccakFunction(nonceMaterial)

    if (!this._ephemeralSharedSecret) return
    const IV = new Uint8Array(16).fill(0x00)
    const sharedSecret = this._keccakFunction(concatBytes(this._ephemeralSharedSecret, hNonce))

    const aesSecret = this._keccakFunction(concatBytes(this._ephemeralSharedSecret, sharedSecret))
    this._ingressAes = crypto.createDecipheriv('aes-256-ctr', aesSecret, IV)
    this._egressAes = crypto.createDecipheriv('aes-256-ctr', aesSecret, IV)

    const macSecret = this._keccakFunction(concatBytes(this._ephemeralSharedSecret, aesSecret))
    this._ingressMac = new MAC(macSecret)
    this._ingressMac.update(concatBytes(xor(macSecret, this._nonce), remoteData))
    this._egressMac = new MAC(macSecret)

    if (this._initMsg === null || this._initMsg === undefined) return
    this._egressMac.update(concatBytes(xor(macSecret, this._remoteNonce), this._initMsg))
  }

  createAuthEIP8() {
    if (!this._remotePublicKey) return
    const x = ecdhX(this._remotePublicKey, this._privateKey)
    const sig = this._ecdsaSign(xor(x, this._nonce), this._ephemeralPrivateKey)
    const data = [
      concatBytes(sig.signature, Uint8Array.from([sig.recid])),
      // this._keccakFunction(pk2id(this._ephemeralPublicKey)),
      pk2id(this._publicKey),
      this._nonce,
      Uint8Array.from([0x04]),
    ]

    const dataRLP = RLP.encode(data)
    const pad = getRandomBytesSync(100 + Math.floor(Math.random() * 151)) // Random padding between 100, 250
    const authMsg = concatBytes(dataRLP, pad)
    const overheadLength = 113
    const sharedMacData = intToBytes(authMsg.length + overheadLength)
    const encryptedMsg = this._encryptMessage(authMsg, sharedMacData)
    if (!encryptedMsg) return
    this._initMsg = concatBytes(sharedMacData, encryptedMsg)
    return this._initMsg
  }

  createAuthNonEIP8(): Uint8Array | undefined {
    if (!this._remotePublicKey) return
    const x = ecdhX(this._remotePublicKey, this._privateKey)
    const sig = this._ecdsaSign(xor(x, this._nonce), this._ephemeralPrivateKey)
    const data = concatBytes(
      sig.signature,
      Uint8Array.from([sig.recid]),
      this._keccakFunction(pk2id(this._ephemeralPublicKey)),
      pk2id(this._publicKey),
      this._nonce,
      Uint8Array.from([0x00]),
    )

    this._initMsg = this._encryptMessage(data)
    return this._initMsg
  }

  parseAuthPlain(
    data: Uint8Array,
    sharedMacData: Uint8Array | null = null,
  ): Uint8Array | undefined {
    const prefix = sharedMacData !== null ? sharedMacData : new Uint8Array()
    this._remoteInitMsg = concatBytes(prefix, data)
    const decrypted = this._decryptMessage(data, sharedMacData)

    let signature = null
    let recoveryId = null
    let heId = null
    let remotePublicKey = null
    let nonce = null

    if (!this._gotEIP8Auth) {
      assertEq(decrypted.length, 194, 'invalid packet length', debug)

      signature = decrypted.subarray(0, 64)
      recoveryId = decrypted[64]
      heId = decrypted.subarray(65, 97) // 32 bytes
      remotePublicKey = id2pk(decrypted.subarray(97, 161))
      nonce = decrypted.subarray(161, 193)
    } else {
      const decoded = unstrictDecode(decrypted) as Uint8Array[]

      signature = decoded[0].subarray(0, 64)
      recoveryId = decoded[0][64]
      remotePublicKey = id2pk(decoded[1])
      nonce = decoded[2]
    }

    // parse packet
    this._remotePublicKey = remotePublicKey // 64 bytes
    this._remoteNonce = nonce // 32 bytes
    // assertEq(decrypted[193], 0, 'invalid postfix', debug)

    const x = ecdhX(this._remotePublicKey, this._privateKey)

    if (this._remoteNonce === null) {
      return
    }
    this._remoteEphemeralPublicKey = this._ecdsaRecover(
      signature,
      recoveryId,
      xor(x, this._remoteNonce),
      false,
    )

    if (this._remoteEphemeralPublicKey === null) return
    this._ephemeralSharedSecret = ecdhX(this._remoteEphemeralPublicKey, this._ephemeralPrivateKey)
    if (heId !== null && this._remoteEphemeralPublicKey !== null) {
      assertEq(
        this._keccakFunction(pk2id(this._remoteEphemeralPublicKey)),
        heId,
        'the hash of the ephemeral key should match',
        debug,
      )
    }
  }

  parseAuthEIP8(data: Uint8Array): void {
    const size = bytesToInt(data.subarray(0, 2)) + 2
    assertEq(data.length, size, 'message length different from specified size (EIP8)', debug)
    this.parseAuthPlain(data.subarray(2), data.subarray(0, 2))
  }

  createAckEIP8(): Uint8Array | undefined {
    const data = [pk2id(this._ephemeralPublicKey), this._nonce, Uint8Array.from([0x04])]

    const dataRLP = RLP.encode(data)
    const pad = getRandomBytesSync(100 + Math.floor(Math.random() * 151)) // Random padding between 100, 250
    const ackMsg = concatBytes(dataRLP, pad)
    const overheadLength = 113
    const sharedMacData = intToBytes(ackMsg.length + overheadLength)
    const encryptedMsg = this._encryptMessage(ackMsg, sharedMacData)
    if (!encryptedMsg) return
    this._initMsg = concatBytes(sharedMacData, encryptedMsg)

    if (!this._remoteInitMsg) return
    this._setupFrame(this._remoteInitMsg, true)
    return this._initMsg
  }

  createAckOld(): Uint8Array | undefined {
    const data = concatBytes(pk2id(this._ephemeralPublicKey), this._nonce, new Uint8Array([0x00]))

    this._initMsg = this._encryptMessage(data)

    if (!this._remoteInitMsg) return
    this._setupFrame(this._remoteInitMsg, true)
    return this._initMsg
  }

  parseAckPlain(data: Uint8Array, sharedMacData: Uint8Array | null = null): void {
    const decrypted = this._decryptMessage(data, sharedMacData)

    let remoteEphemeralPublicKey = null
    let remoteNonce = null

    if (!this._gotEIP8Ack) {
      assertEq(decrypted.length, 97, 'invalid packet length', debug)
      assertEq(decrypted[96], 0, 'invalid postfix', debug)

      remoteEphemeralPublicKey = id2pk(decrypted.subarray(0, 64))
      remoteNonce = decrypted.subarray(64, 96)
    } else {
      const decoded = unstrictDecode(decrypted) as Uint8Array[]

      remoteEphemeralPublicKey = id2pk(decoded[0])
      remoteNonce = decoded[1]
    }

    // parse packet
    this._remoteEphemeralPublicKey = remoteEphemeralPublicKey
    this._remoteNonce = remoteNonce

    this._ephemeralSharedSecret = ecdhX(this._remoteEphemeralPublicKey, this._ephemeralPrivateKey)
    if (!sharedMacData) {
      sharedMacData = Uint8Array.from([])
    }
    this._setupFrame(concatBytes(sharedMacData, data), false)
  }

  parseAckEIP8(data: Uint8Array): void {
    const size = bytesToInt(data.subarray(0, 2)) + 2
    assertEq(data.length, size, 'message length different from specified size (EIP8)', debug)
    this.parseAckPlain(data.subarray(2), data.subarray(0, 2))
  }

  createBlockHeader(size: number): Uint8Array | undefined {
    const bufSize = zfill(intToBytes(size), 3)
    const headerData = RLP.encode([0, 0]) // [capability-id, context-id] (currently unused in spec)
    let header = concatBytes(bufSize, headerData)
    header = zfill(header, 16, false)
    if (!this._egressAes) return
    header = Uint8Array.from(this._egressAes.update(header))

    if (!this._egressMac) return
    this._egressMac.updateHeader(header)
    const tag = Uint8Array.from(this._egressMac.digest())

    return concatBytes(header, tag)
  }

  parseHeader(data: Uint8Array): number | undefined {
    // parse header
    let header = data.subarray(0, 16)
    const mac = data.subarray(16, 32)

    if (!this._ingressMac) return
    this._ingressMac.updateHeader(header)
    const _mac = Uint8Array.from(this._ingressMac.digest())
    assertEq(_mac, mac, 'Invalid MAC', debug)

    if (!this._ingressAes) return
    header = Uint8Array.from(this._ingressAes.update(header))
    this._bodySize = bytesToInt(header.subarray(0, 3))
    return this._bodySize
  }

  createBody(data: Uint8Array): Uint8Array | undefined {
    data = zfill(data, Math.ceil(data.length / 16) * 16, false)
    if (!this._egressAes) return
    const encryptedData = Uint8Array.from(this._egressAes.update(data))

    if (!this._egressMac) return
    this._egressMac.updateBody(encryptedData)
    const tag = Uint8Array.from(this._egressMac.digest())
    return concatBytes(encryptedData, tag)
  }

  parseBody(data: Uint8Array): Uint8Array | undefined {
    if (this._bodySize === null) throw EthereumJSErrorWithoutCode('need to parse header first')

    const body = data.subarray(0, -16)
    const mac = data.subarray(-16)

    if (!this._ingressMac) return
    this._ingressMac.updateBody(body)
    const _mac = Uint8Array.from(this._ingressMac.digest())
    assertEq(_mac, mac, 'Invalid MAC', debug)

    const size = this._bodySize
    this._bodySize = null

    if (!this._ingressAes) return
    return Uint8Array.from(this._ingressAes.update(body)).subarray(0, size)
  }
}
