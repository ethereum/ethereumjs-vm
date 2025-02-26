import { RLP } from '@ethereumjs/rlp'
import {
  BIGINT_0,
  EthereumJSErrorWithoutCode,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  bytesToInt,
  bytesToUnprefixedHex,
  hexToBytes,
  intToBytes,
  isHexString,
} from '@ethereumjs/util'
import * as snappy from 'snappyjs'

import { ProtocolType } from '../types.js'
import { assertEq, formatLogData, formatLogId } from '../util.js'

import { Protocol } from './protocol.js'

import type { Peer } from '../rlpx/peer.js'
import type { SendMethod } from '../types.js'
import type { Input } from '@ethereumjs/rlp'

export class ETH extends Protocol {
  protected _status: ETH.StatusMsg | null = null
  protected _peerStatus: ETH.StatusMsg | null = null
  private DEBUG: boolean = false

  // Eth64
  protected _hardfork: string = 'chainstart'
  protected _latestBlock = BIGINT_0
  protected _forkHash: string = ''
  protected _nextForkBlock = BIGINT_0

  constructor(version: number, peer: Peer, send: SendMethod) {
    super(peer, send, ProtocolType.ETH, version, ETH.MESSAGE_CODES)

    // Set forkHash and nextForkBlock
    if (this._version >= 64) {
      const c = this._peer.common
      this._hardfork = c.hardfork() ?? this._hardfork
      // Set latestBlock minimally to start block of fork to have some more
      // accurate basis if no latestBlock is provided along status send
      this._latestBlock = c.hardforkBlock(this._hardfork) ?? BIGINT_0
      this._forkHash = c.forkHash(this._hardfork)
      // Next fork block number or 0 if none available
      this._nextForkBlock = c.nextHardforkBlockOrTimestamp(this._hardfork) ?? BIGINT_0
    }

    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    this.DEBUG = process?.env?.DEBUG?.includes('ethjs') ?? false
  }

  static eth62 = { name: 'eth', version: 62, length: 8, constructor: ETH }
  static eth63 = { name: 'eth', version: 63, length: 17, constructor: ETH }
  static eth64 = { name: 'eth', version: 64, length: 17, constructor: ETH }
  static eth65 = { name: 'eth', version: 65, length: 17, constructor: ETH }
  static eth66 = { name: 'eth', version: 66, length: 17, constructor: ETH }
  static eth67 = { name: 'eth', version: 67, length: 17, constructor: ETH }
  static eth68 = { name: 'eth', version: 68, length: 17, constructor: ETH }

  _handleMessage(code: ETH.MESSAGE_CODES, data: Uint8Array) {
    const payload = RLP.decode(data)

    if (code !== ETH.MESSAGE_CODES.STATUS && this.DEBUG) {
      const debugMsg = this.DEBUG
        ? `Received ${this.getMsgPrefix(code)} message from ${
            this._peer['_socket'].remoteAddress
          }:${this._peer['_socket'].remotePort}`
        : undefined
      const logData = formatLogData(bytesToHex(data), this._verbose)
      this.debug(this.getMsgPrefix(code), `${debugMsg}: ${logData}`)
    }
    switch (code) {
      case ETH.MESSAGE_CODES.STATUS: {
        assertEq(
          this._peerStatus,
          null,
          'Uncontrolled status message',
          this.debug.bind(this),
          'STATUS',
        )
        this._peerStatus = payload as ETH.StatusMsg
        const peerStatusMsg = `${
          this._peerStatus !== undefined ? this._getStatusString(this._peerStatus) : ''
        }`
        if (this.DEBUG) {
          const debugMsg = this.DEBUG
            ? `Received ${this.getMsgPrefix(code)} message from ${
                this._peer['_socket'].remoteAddress
              }:${this._peer['_socket'].remotePort}`
            : undefined
          this.debug(this.getMsgPrefix(code), `${debugMsg}: ${peerStatusMsg}`)
        }
        this._handleStatus()
        break
      }

      case ETH.MESSAGE_CODES.NEW_BLOCK_HASHES:
      case ETH.MESSAGE_CODES.TX:
      case ETH.MESSAGE_CODES.GET_BLOCK_HEADERS:
      case ETH.MESSAGE_CODES.BLOCK_HEADERS:
      case ETH.MESSAGE_CODES.GET_BLOCK_BODIES:
      case ETH.MESSAGE_CODES.BLOCK_BODIES:
      case ETH.MESSAGE_CODES.NEW_BLOCK:
        if (this._version >= ETH.eth62.version) break
        return

      case ETH.MESSAGE_CODES.GET_RECEIPTS:
      case ETH.MESSAGE_CODES.RECEIPTS:
        if (this._version >= ETH.eth63.version) break
        return

      case ETH.MESSAGE_CODES.NEW_POOLED_TRANSACTION_HASHES:
      case ETH.MESSAGE_CODES.GET_POOLED_TRANSACTIONS:
      case ETH.MESSAGE_CODES.POOLED_TRANSACTIONS:
        if (this._version >= ETH.eth65.version) break
        return

      case ETH.MESSAGE_CODES.GET_NODE_DATA:
      case ETH.MESSAGE_CODES.NODE_DATA:
        if (this._version >= ETH.eth63.version && this._version <= ETH.eth66.version) break
        return

      default:
        return
    }

    this.events.emit('message', code, payload)
  }

  /**
   * Eth 64 Fork ID validation (EIP-2124)
   * @param forkId Remote fork ID
   */
  _validateForkId(forkId: Uint8Array[]) {
    const c = this._peer.common

    const peerForkHash = bytesToHex(forkId[0])
    const peerNextFork = bytesToBigInt(forkId[1])

    if (this._forkHash === peerForkHash) {
      // There is a known next fork
      if (peerNextFork > BIGINT_0) {
        if (this._latestBlock >= peerNextFork) {
          const msg = 'Remote is advertising a future fork that passed locally'
          if (this.DEBUG) {
            this.debug('STATUS', msg)
          }
          throw EthereumJSErrorWithoutCode(msg)
        }
      }
    }

    const peerFork = c.hardforkForForkHash(peerForkHash)
    if (peerFork === null) {
      const msg = 'Unknown fork hash'
      if (this.DEBUG) {
        this.debug('STATUS', msg)
      }
      throw EthereumJSErrorWithoutCode(msg)
    }

    if (!c.hardforkGteHardfork(peerFork.name, this._hardfork)) {
      const nextHardforkBlock = c.nextHardforkBlockOrTimestamp(peerFork.name)
      if (
        peerNextFork === null ||
        nextHardforkBlock === null ||
        nextHardforkBlock !== peerNextFork
      ) {
        const msg = 'Outdated fork status, remote needs software update'
        if (this.DEBUG) {
          this.debug('STATUS', msg)
        }
        throw EthereumJSErrorWithoutCode(msg)
      }
    }
  }

  _handleStatus(): void {
    if (this._status === null || this._peerStatus === null) return
    clearTimeout(this._statusTimeoutId!)

    assertEq(
      this._status[0],
      this._peerStatus[0],
      'Protocol version mismatch',
      this.debug.bind(this),
      'STATUS',
    )
    assertEq(
      this._status[1],
      this._peerStatus[1],
      'NetworkId mismatch',
      this.debug.bind(this),
      'STATUS',
    )
    assertEq(
      this._status[4],
      this._peerStatus[4],
      'Genesis block mismatch',
      this.debug.bind(this),
      'STATUS',
    )

    const status: {
      chainId: Uint8Array | Uint8Array[]
      td: Uint8Array
      bestHash: Uint8Array
      genesisHash: Uint8Array
      forkId?: Uint8Array | Uint8Array[]
    } = {
      chainId: this._peerStatus[1],
      td: this._peerStatus[2] as Uint8Array,
      bestHash: this._peerStatus[3] as Uint8Array,
      genesisHash: this._peerStatus[4] as Uint8Array,
      forkId: undefined,
    }

    if (this._version >= 64) {
      assertEq(
        this._peerStatus[5].length,
        2,
        'Incorrect forkId msg format',
        this.debug.bind(this),
        'STATUS',
      )
      this._validateForkId(this._peerStatus[5] as Uint8Array[])
      status.forkId = this._peerStatus[5]
    }

    this.events.emit('status', status)
    if (this._firstPeer === '') {
      this._addFirstPeerDebugger()
    }
  }

  getVersion() {
    return this._version
  }

  _forkHashFromForkId(forkId: Uint8Array): string {
    return bytesToUnprefixedHex(forkId)
  }

  _nextForkFromForkId(forkId: Uint8Array): number {
    return bytesToInt(forkId)
  }

  _getStatusString(status: ETH.StatusMsg) {
    let sStr = `[V:${bytesToInt(status[0] as Uint8Array)}, NID:${bytesToInt(
      status[1] as Uint8Array,
    )}, TD:${status[2].length === 0 ? 0 : bytesToBigInt(status[2] as Uint8Array).toString()}`
    sStr += `, BestH:${formatLogId(
      bytesToHex(status[3] as Uint8Array),
      this._verbose,
    )}, GenH:${formatLogId(bytesToHex(status[4] as Uint8Array), this._verbose)}`
    if (this._version >= 64) {
      sStr += `, ForkHash: ${
        status[5] !== undefined ? bytesToHex(status[5][0] as Uint8Array) : '-'
      }`
      sStr += `, ForkNext: ${
        (status[5][1] as Uint8Array).length > 0 ? bytesToHex(status[5][1] as Uint8Array) : '-'
      }`
    }
    sStr += `]`
    return sStr
  }

  sendStatus(status: ETH.StatusOpts) {
    if (this._status !== null) return
    this._status = [
      intToBytes(this._version),
      bigIntToBytes(this._peer.common.chainId()),
      status.td,
      status.bestHash,
      status.genesisHash,
    ]
    if (this._version >= 64) {
      if (status.latestBlock) {
        const latestBlock = bytesToBigInt(status.latestBlock)
        if (latestBlock < this._latestBlock) {
          throw EthereumJSErrorWithoutCode(
            'latest block provided is not matching the HF setting of the Common instance (Rlpx)',
          )
        }
        this._latestBlock = latestBlock
      }
      const forkHashB = hexToBytes(
        isHexString(this._forkHash) ? this._forkHash : `0x${this._forkHash}`,
      )

      const nextForkB =
        this._nextForkBlock === BIGINT_0 ? new Uint8Array() : bigIntToBytes(this._nextForkBlock)

      this._status.push([forkHashB, nextForkB])
    }

    if (this.DEBUG) {
      this.debug(
        'STATUS',

        `Send STATUS message to ${this._peer['_socket'].remoteAddress}:${
          this._peer['_socket'].remotePort
        } (eth${this._version}): ${this._getStatusString(this._status)}`,
      )
    }

    let payload = RLP.encode(this._status)

    // Use snappy compression if peer supports DevP2P >=v5
    if (this._peer['_hello'] !== null && this._peer['_hello'].protocolVersion >= 5) {
      payload = snappy.compress(payload)
    }

    this._send(ETH.MESSAGE_CODES.STATUS, payload)
    this._handleStatus()
  }

  sendMessage(code: ETH.MESSAGE_CODES, payload: Input) {
    if (this.DEBUG) {
      const logData = formatLogData(bytesToHex(RLP.encode(payload)), this._verbose)
      const messageName = this.getMsgPrefix(code)
      const debugMsg = `Send ${messageName} message to ${this._peer['_socket'].remoteAddress}:${this._peer['_socket'].remotePort}: ${logData}`

      this.debug(messageName, debugMsg)
    }

    switch (code) {
      case ETH.MESSAGE_CODES.STATUS:
        throw EthereumJSErrorWithoutCode('Please send status message through .sendStatus')

      case ETH.MESSAGE_CODES.NEW_BLOCK_HASHES:
      case ETH.MESSAGE_CODES.TX:
      case ETH.MESSAGE_CODES.GET_BLOCK_HEADERS:
      case ETH.MESSAGE_CODES.BLOCK_HEADERS:
      case ETH.MESSAGE_CODES.GET_BLOCK_BODIES:
      case ETH.MESSAGE_CODES.BLOCK_BODIES:
      case ETH.MESSAGE_CODES.NEW_BLOCK:
        if (this._version >= ETH.eth62.version) break
        throw EthereumJSErrorWithoutCode(`Code ${code} not allowed with version ${this._version}`)

      case ETH.MESSAGE_CODES.GET_RECEIPTS:
      case ETH.MESSAGE_CODES.RECEIPTS:
        if (this._version >= ETH.eth63.version) break
        throw EthereumJSErrorWithoutCode(`Code ${code} not allowed with version ${this._version}`)

      case ETH.MESSAGE_CODES.NEW_POOLED_TRANSACTION_HASHES:
      case ETH.MESSAGE_CODES.GET_POOLED_TRANSACTIONS:
      case ETH.MESSAGE_CODES.POOLED_TRANSACTIONS:
        if (this._version >= ETH.eth65.version) break
        throw EthereumJSErrorWithoutCode(`Code ${code} not allowed with version ${this._version}`)

      case ETH.MESSAGE_CODES.GET_NODE_DATA:
      case ETH.MESSAGE_CODES.NODE_DATA:
        if (this._version >= ETH.eth63.version && this._version <= ETH.eth66.version) break
        throw EthereumJSErrorWithoutCode(`Code ${code} not allowed with version ${this._version}`)

      default:
        throw EthereumJSErrorWithoutCode(`Unknown code ${code}`)
    }

    payload = RLP.encode(payload)

    // Use snappy compression if peer supports DevP2P >=v5
    if (this._peer['_hello'] !== null && this._peer['_hello'].protocolVersion >= 5) {
      payload = snappy.compress(payload)
    }

    this._send(code, payload)
  }

  getMsgPrefix(msgCode: ETH.MESSAGE_CODES): string {
    return ETH.MESSAGE_CODES[msgCode]
  }
}

export namespace ETH {
  export interface StatusMsg extends Array<Uint8Array | Uint8Array[]> {}

  export type StatusOpts = {
    td: Uint8Array
    bestHash: Uint8Array
    latestBlock?: Uint8Array
    genesisHash: Uint8Array
  }

  export enum MESSAGE_CODES {
    // eth62
    STATUS = 0x00,
    NEW_BLOCK_HASHES = 0x01,
    TX = 0x02,
    GET_BLOCK_HEADERS = 0x03,
    BLOCK_HEADERS = 0x04,
    GET_BLOCK_BODIES = 0x05,
    BLOCK_BODIES = 0x06,
    NEW_BLOCK = 0x07,

    // eth63
    GET_NODE_DATA = 0x0d,
    NODE_DATA = 0x0e,
    GET_RECEIPTS = 0x0f,
    RECEIPTS = 0x10,

    // eth65
    NEW_POOLED_TRANSACTION_HASHES = 0x08,
    GET_POOLED_TRANSACTIONS = 0x09,
    POOLED_TRANSACTIONS = 0x0a,
  }
}
