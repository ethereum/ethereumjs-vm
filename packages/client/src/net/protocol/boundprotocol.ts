import { EthereumJSErrorWithoutCode, Lock } from '@ethereumjs/util'

import { Event } from '../../types.js'

import type { Config } from '../../config.js'
import type { Peer } from '../peer/peer.js'
import type { EthProtocolMethods } from './ethprotocol.js'
import type { Message, Protocol } from './protocol.js'
import type { Sender } from './sender.js'
import type { AccountData, SnapProtocolMethods, StorageData } from './snapprotocol.js'
import type { BlockBodyBytes, BlockHeader } from '@ethereumjs/block'
import type { TypedTransaction } from '@ethereumjs/tx'
import type { TxReceipt } from '@ethereumjs/vm'

export interface BoundProtocolOptions {
  /* Config */
  config: Config

  /* Protocol */
  protocol: Protocol

  /* Peer */
  peer: Peer

  /* Sender */
  sender: Sender
}

/**
 * Binds a protocol implementation to the specified peer
 * @memberof module:net/protocol
 */
export class BoundProtocol {
  public config: Config
  public name: string
  private protocol: Protocol
  protected peer: Peer
  private sender: Sender
  private versions: number[]
  private timeout: number
  private _status: any
  private resolvers: Map<string | number, any>
  private messageQueue: Message[] = []

  /**
   * An eventual updated best head.
   *
   * If set this is by design known to be greater or equal the block hash from
   * the initial `STATUS` exchange (`_status` property here) and `updatedBestHash`
   * number/hash should take precedence.
   */
  public updatedBestHeader?: BlockHeader

  /**
   * Create bound protocol
   */
  constructor(options: BoundProtocolOptions) {
    this.config = options.config

    this.protocol = options.protocol
    this.peer = options.peer
    this.sender = options.sender
    this.name = this.protocol.name
    this.versions = this.protocol.versions
    this.timeout = this.protocol.timeout
    this._status = {}
    this.resolvers = new Map()
    this.sender.on('message', (message: any) => {
      try {
        if (this.peer.pooled) {
          this.handle(message)
        } else {
          this.messageQueue.push(message)
          // Expected message queue growth is in the single digits
          // so this adds a guard here if something goes wrong
          if (this.messageQueue.length >= 50) {
            const error = EthereumJSErrorWithoutCode('unexpected message queue growth for peer')
            this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
          }
        }
      } catch (error: any) {
        this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      }
    })
    this.sender.on('error', (error: Error) =>
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer),
    )
  }

  get status(): any {
    return this._status
  }

  set status(status: any) {
    Object.assign(this._status, status)
  }

  async handshake(sender: Sender) {
    this._status = await this.protocol.handshake(sender)
  }

  /**
   * Handle incoming message
   * @param message message object
   * @emits {@link Event.PROTOCOL_MESSAGE}
   * @emits {@link Event.PROTOCOL_ERROR}
   */
  private handle(incoming: Message) {
    const messages = this.protocol.messages
    const message = messages.find((m) => m.code === incoming.code)
    if (!message) {
      return
    }

    let data
    let error
    try {
      data = this.protocol.decode(message, incoming.payload)
    } catch (e: any) {
      error = EthereumJSErrorWithoutCode(`Could not decode message ${message.name}: ${e}`)
    }
    const resolver = this.resolvers.get(incoming.code)
    if (resolver !== undefined) {
      clearTimeout(resolver.timeout)
      this.resolvers.delete(incoming.code)
      if (error) {
        resolver.reject(error)
      } else {
        resolver.resolve(data)
      }
    } else {
      if (error) {
        this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      } else {
        this.config.events.emit(
          Event.PROTOCOL_MESSAGE,
          { name: message.name, data },
          this.protocol.name,
          this.peer,
        )
      }
    }
  }

  /**
   * Handle unhandled messages along handshake
   */
  handleMessageQueue() {
    for (const message of this.messageQueue) {
      this.handle(message)
    }
  }

  /**
   * Send message with name and the specified args
   * @param name message name
   * @param args message arguments
   */
  send(name: string, args?: any) {
    const messages = this.protocol.messages
    const message = messages.find((m) => m.name === name)
    if (message) {
      const encoded = this.protocol.encode(message, args)
      this.sender.sendMessage(message.code, encoded)
    } else {
      throw EthereumJSErrorWithoutCode(`Unknown message: ${name}`)
    }
    return message
  }

  /**
   * Returns a promise that resolves with the message payload when a response
   * to the specified message is received
   * @param name message to wait for
   * @param args message arguments
   */
  async request(name: string, args: any): Promise<any> {
    const message = this.send(name, args)
    let lock
    if (
      typeof message.response === 'number' &&
      this.resolvers.get(message.response) !== undefined
    ) {
      const res = this.resolvers.get(message.response)
      lock = res.lock
      await res.lock.acquire()
    }
    const resolver: any = {
      timeout: null,
      resolve: null,
      reject: null,
      lock: lock ?? new Lock(),
    }
    this.resolvers.set(message.response!, resolver)
    if (lock === undefined) {
      await resolver.lock.acquire()
    }
    return new Promise((resolve, reject) => {
      resolver.resolve = function (e: any) {
        resolver.lock.release()
        resolve(e)
      }
      resolver.reject = function (e: any) {
        resolver.lock.release()
        reject(e)
      }
      resolver.timeout = setTimeout(() => {
        resolver.timeout = null
        this.resolvers.delete(message.response!)
        resolver.reject(EthereumJSErrorWithoutCode(`Request timed out after ${this.timeout}ms`))
      }, this.timeout)
    })
  }
}

export class BoundEthProtocol extends BoundProtocol implements EthProtocolMethods {
  name = 'eth' // public name: string

  constructor(options: BoundProtocolOptions) {
    super(options)
  }

  async getBlockHeaders(opts: {
    reqId?: bigint | undefined
    block: bigint | Uint8Array
    max: number
    skip?: number | undefined
    reverse?: boolean | undefined
  }): Promise<[bigint, BlockHeader[]]> {
    return this.request('GetBlockHeaders', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
  async getBlockBodies(opts: {
    reqId?: bigint | undefined
    hashes: Uint8Array[]
  }): Promise<[bigint, BlockBodyBytes[]]> {
    return this.request('GetBlockBodies', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
  async getPooledTransactions(opts: {
    reqId?: bigint | undefined
    hashes: Uint8Array[]
  }): Promise<[bigint, TypedTransaction[]]> {
    return this.request('GetPooledTransactions', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
  async getReceipts(opts: {
    reqId?: bigint | undefined
    hashes: Uint8Array[]
  }): Promise<[bigint, TxReceipt[]]> {
    return this.request('GetReceipts', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
}

export class BoundSnapProtocol extends BoundProtocol implements SnapProtocolMethods {
  name = 'snap' // public name: string

  constructor(options: BoundProtocolOptions) {
    super(options)
  }
  async getAccountRange(opts: {
    reqId?: bigint | undefined
    root: Uint8Array
    origin: Uint8Array
    limit: Uint8Array
    bytes: bigint
  }): Promise<{ reqId: bigint; accounts: AccountData[]; proof: Uint8Array[] }> {
    return this.request('GetAccountRange', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
  async getStorageRanges(opts: {
    reqId?: bigint | undefined
    root: Uint8Array
    accounts: Uint8Array[]
    origin: Uint8Array
    limit: Uint8Array
    bytes: bigint
  }): Promise<{
    reqId: bigint
    slots: StorageData[][]
    proof: Uint8Array[]
  }> {
    return this.request('GetStorageRanges', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
  async getByteCodes(opts: {
    reqId?: bigint | undefined
    hashes: Uint8Array[]
    bytes: bigint
  }): Promise<{ reqId: bigint; codes: Uint8Array[] }> {
    return this.request('GetByteCodes', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
  async getTrieNodes(opts: {
    reqId?: bigint | undefined // so this adds a guard here if something goes wrong
    // so this adds a guard here if something goes wrong
    root: Uint8Array
    paths: Uint8Array[][]
    bytes: bigint
  }): Promise<{ reqId: bigint; nodes: Uint8Array[] }> {
    return this.request('GetTrieNodes', opts).catch((error: Error) => {
      this.config.events.emit(Event.PROTOCOL_ERROR, error, this.peer)
      return undefined
    })
  }
}
