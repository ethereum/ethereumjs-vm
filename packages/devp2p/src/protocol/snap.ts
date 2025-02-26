import { RLP, utils } from '@ethereumjs/rlp'
import { EthereumJSErrorWithoutCode, bytesToHex } from '@ethereumjs/util'
import * as snappy from 'snappyjs'

import { ProtocolType } from '../types.js'
import { formatLogData } from '../util.js'

import { Protocol } from './protocol.js'

import type { Peer } from '../rlpx/peer.js'
import type { SendMethod } from '../types.js'

export class SNAP extends Protocol {
  private DEBUG: boolean

  constructor(version: number, peer: Peer, send: SendMethod) {
    super(peer, send, ProtocolType.SNAP, version, SNAP.MESSAGE_CODES)
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
  }

  static snap = { name: 'snap', version: 1, length: 8, constructor: SNAP }

  _handleMessage(code: SNAP.MESSAGE_CODES, data: Uint8Array) {
    const payload = RLP.decode(data)

    // Note, this needs optimization, see issue #1882
    if (this.DEBUG) {
      this.debug(
        this.getMsgPrefix(code),
        `Received ${this.getMsgPrefix(code)} message from ${this._peer['_socket'].remoteAddress}:${
          this._peer['_socket'].remotePort
        }: ${formatLogData(bytesToHex(data), this._verbose)}`,
      )
    }

    switch (code) {
      case SNAP.MESSAGE_CODES.GET_ACCOUNT_RANGE:
      case SNAP.MESSAGE_CODES.ACCOUNT_RANGE:
      case SNAP.MESSAGE_CODES.GET_STORAGE_RANGES:
      case SNAP.MESSAGE_CODES.STORAGE_RANGES:
      case SNAP.MESSAGE_CODES.GET_BYTE_CODES:
      case SNAP.MESSAGE_CODES.BYTE_CODES:
      case SNAP.MESSAGE_CODES.GET_TRIE_NODES:
      case SNAP.MESSAGE_CODES.TRIE_NODES:
        break
      default:
        return
    }

    this.events.emit('message', code, payload)
  }

  sendStatus() {
    throw Error('SNAP protocol does not support status handshake')
  }

  /**
   *
   * @param code Message code
   * @param payload Payload (including reqId, e.g. `[1, [437000, 1, 0, 0]]`)
   */
  sendMessage(code: SNAP.MESSAGE_CODES, payload: any) {
    if (this.DEBUG) {
      this.debug(
        this.getMsgPrefix(code),
        `Send ${this.getMsgPrefix(code)} message to ${this._peer['_socket'].remoteAddress}:${
          this._peer['_socket'].remotePort
        }: ${formatLogData(utils.bytesToHex(RLP.encode(payload)), this._verbose)}`,
      )
    }

    switch (code) {
      case SNAP.MESSAGE_CODES.GET_ACCOUNT_RANGE:
      case SNAP.MESSAGE_CODES.ACCOUNT_RANGE:
      case SNAP.MESSAGE_CODES.GET_STORAGE_RANGES:
      case SNAP.MESSAGE_CODES.STORAGE_RANGES:
      case SNAP.MESSAGE_CODES.GET_BYTE_CODES:
      case SNAP.MESSAGE_CODES.BYTE_CODES:
      case SNAP.MESSAGE_CODES.GET_TRIE_NODES:
      case SNAP.MESSAGE_CODES.TRIE_NODES:
        break
      default:
        throw EthereumJSErrorWithoutCode(`Unknown code ${code}`)
    }

    payload = RLP.encode(payload)

    // Use snappy compression if peer supports DevP2P >=v5
    const protocolVersion = this._peer['_hello']?.protocolVersion
    if (protocolVersion !== undefined && protocolVersion >= 5) {
      payload = snappy.compress(payload)
    }

    this._send(code, payload)
  }

  getMsgPrefix(msgCode: SNAP.MESSAGE_CODES): string {
    return SNAP.MESSAGE_CODES[msgCode]
  }

  getVersion() {
    return this._version
  }
}

export namespace SNAP {
  export enum MESSAGE_CODES {
    // snap1
    GET_ACCOUNT_RANGE = 0x00,
    ACCOUNT_RANGE = 0x01,
    GET_STORAGE_RANGES = 0x02,
    STORAGE_RANGES = 0x03,
    GET_BYTE_CODES = 0x04,
    BYTE_CODES = 0x05,
    GET_TRIE_NODES = 0x06,
    TRIE_NODES = 0x07,
  }
}
