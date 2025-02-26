import { BIGINT_0, EthereumJSErrorWithoutCode, short } from '@ethereumjs/util'
import { EventEmitter } from 'eventemitter3'

import { BoundEthProtocol, BoundSnapProtocol } from '../protocol/index.js'

import type { Config } from '../../config.js'
import type { BoundProtocol, Protocol, Sender } from '../protocol/index.js'
import type { Server } from '../server/index.js'
import type { BlockHeader } from '@ethereumjs/block'

export interface PeerOptions {
  /* Config */
  config: Config

  /* Peer id */
  id?: string

  /* Peer address */
  address: string

  /* Transport name */
  transport: string

  /* Pass true if peer initiated connection (default: false) */
  inbound?: boolean

  /* Supported protocols */
  protocols?: Protocol[]

  /* Server */
  server?: Server
}

/**
 * Network peer
 * @memberof module:net/peer
 */
export abstract class Peer extends EventEmitter {
  public config: Config
  public id: string
  public address: string
  public inbound: boolean
  public server: Server | undefined
  protected transport: string
  protected protocols: Protocol[]
  protected boundProtocols: BoundProtocol[] = []
  private _idle: boolean

  // TODO check if this should be moved into RlpxPeer
  public eth?: BoundEthProtocol
  public snap?: BoundSnapProtocol

  /*
    If the peer is in the PeerPool.
    If true, messages are handled immediately.
    If false, adds incoming messages to handleMessageQueue,
    which are handled after the peer is added to the pool.
  */
  public pooled: boolean = false

  /**
   * Create new peer
   */
  constructor(options: PeerOptions) {
    super()

    this.config = options.config

    this.id = options.id ?? ''
    this.address = options.address
    this.transport = options.transport
    this.inbound = options.inbound ?? false
    this.protocols = options.protocols ?? []

    this._idle = true
  }

  /**
   * Get idle state of peer
   */
  get idle() {
    return this._idle
  }

  /**
   * Set idle state of peer
   */
  set idle(value) {
    this._idle = value
  }

  abstract connect(): Promise<void>

  /**
   * Eventually updates and returns the latest header of peer
   */
  async latest(): Promise<BlockHeader | undefined> {
    if (!this.eth) {
      return
    }
    let block: bigint | Uint8Array
    if (!this.eth!.updatedBestHeader) {
      // If there is no updated best header stored yet, start with the status hash
      block = this.eth!.status.bestHash
    } else {
      block = this.getPotentialBestHeaderNum()
    }
    const result = await this.eth!.getBlockHeaders({
      block,
      max: 1,
    })
    if (result !== undefined) {
      const latest = result[1][0]
      this.eth!.updatedBestHeader = latest
      if (latest !== undefined) {
        const height = latest.number
        if (
          height > BIGINT_0 &&
          (this.config.syncTargetHeight === undefined ||
            this.config.syncTargetHeight === BIGINT_0 ||
            this.config.syncTargetHeight < latest.number)
        ) {
          this.config.syncTargetHeight = height
          this.config.logger.info(`New sync target height=${height} hash=${short(latest.hash())}`)
        }
      }
    }
    return this.eth!.updatedBestHeader
  }

  /**
   * Returns a potential best block header number for the peer
   * (not necessarily verified by block request) derived from
   * either the client-wide sync target height or the last best
   * header timestamp "forward-calculated" by block/slot times (12s).
   */
  getPotentialBestHeaderNum(): bigint {
    let forwardCalculatedNum = BIGINT_0
    const bestSyncTargetNum = this.config.syncTargetHeight ?? BIGINT_0
    if (this.eth?.updatedBestHeader !== undefined) {
      const bestHeaderNum = this.eth!.updatedBestHeader.number
      const nowSec = Math.floor(Date.now() / 1000)
      const diffSec = nowSec - Number(this.eth!.updatedBestHeader.timestamp)
      const SLOT_TIME = 12
      const diffBlocks = BigInt(Math.floor(diffSec / SLOT_TIME))
      forwardCalculatedNum = bestHeaderNum + diffBlocks
    }
    const best = forwardCalculatedNum > bestSyncTargetNum ? forwardCalculatedNum : bestSyncTargetNum
    return best
  }

  /**
   * Handle unhandled messages along handshake
   */
  handleMessageQueue() {
    this.boundProtocols.map((e) => e.handleMessageQueue())
  }

  async addProtocol(sender: Sender, protocol: Protocol): Promise<void> {
    let bound: BoundProtocol
    const boundOpts = {
      config: protocol.config, // TODO: why cant we use `this.config`?
      protocol,
      peer: this,
      sender,
    }

    if (protocol.name === 'eth') {
      bound = new BoundEthProtocol(boundOpts)

      await bound!.handshake(sender)

      this.eth = <BoundEthProtocol>bound
    } else if (protocol.name === 'snap') {
      bound = new BoundSnapProtocol(boundOpts)
      if (sender.status === undefined) throw Error('Snap can only be bound on handshaked peer')

      this.snap = <BoundSnapProtocol>bound
    } else {
      throw EthereumJSErrorWithoutCode(`addProtocol: ${protocol.name} protocol not supported`)
    }

    this.boundProtocols.push(bound)
  }

  toString(withFullId = false): string {
    const properties = {
      id: withFullId ? this.id : this.id.substr(0, 8),
      address: this.address,
      transport: this.transport,
      protocols: this.boundProtocols.map((e) => e.name),
      inbound: this.inbound,
    }
    return Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null && value.toString() !== '')
      .map((keyValue) => keyValue.join('='))
      .join(' ')
  }
}
