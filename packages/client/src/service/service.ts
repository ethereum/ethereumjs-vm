import { Chain } from '../blockchain/index.js'
import { PeerPool } from '../net/peerpool.js'
import { FlowControl } from '../net/protocol/index.js'
import { Event } from '../types.js'
import { type V8Engine, getV8Engine } from '../util/index.js'

import type { Config } from '../config.js'
import type { Peer } from '../net/peer/peer.js'
import type { Protocol } from '../net/protocol/index.js'
import type { Synchronizer } from '../sync/index.js'
import type { AbstractLevel } from 'abstract-level'

export interface ServiceOptions {
  /* Config */
  config: Config

  /* Blockchain */
  chain: Chain

  /* Blockchain database */
  chainDB?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  /* State database */
  stateDB?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  /* Meta database (receipts, logs, indexes) */
  metaDB?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  /* Sync retry interval in ms (default: 8000) */
  interval?: number

  /* Protocol timeout in ms (default: 6000) */
  timeout?: number
}

/**
 * Base class for all services
 * @memberof module:service
 */
export class Service {
  public config: Config
  public opened: boolean
  public running: boolean
  public pool: PeerPool
  public flow: FlowControl
  public chain: Chain
  public interval: number
  public timeout: number
  public synchronizer?: Synchronizer

  // A handle to v8Engine lib for mem stats, assigned on open if running in node
  private v8Engine: V8Engine | null = null

  /**
   * Interval for client stats output (e.g. memory) (in ms)
   * for debug log level
   *
   * (for info there will be somewhat reduced output)
   */
  private STATS_INTERVAL = 1000 * 30 // 30 seconds

  /**
   * Shutdown the client when memory threshold is reached (in percent)
   *
   */
  private MEMORY_SHUTDOWN_THRESHOLD = 92

  private _statsInterval: NodeJS.Timeout | undefined /* global NodeJS */
  private _statsCounter = 0
  /**
   * Create new service and associated peer pool
   */
  constructor(options: ServiceOptions) {
    this.config = options.config

    this.opened = false
    this.running = false

    this.pool = new PeerPool({
      config: this.config,
    })

    this.config.events.on(Event.PROTOCOL_MESSAGE, async (message, protocol, peer) => {
      if (this.running) {
        try {
          await this.handle(message, protocol, peer)
        } catch (error) {
          if (!(error instanceof Error)) {
            error = new Error(error)
          }
          this.config.logger.debug(
            `Error handling message (${protocol}:${message.name}): ${error.message}`,
          )
        }
      }
    })

    this.flow = new FlowControl()
    // @ts-ignore TODO replace with async create constructor
    this.chain = options.chain ?? new Chain(options)
    this.interval = options.interval ?? 8000
    this.timeout = options.timeout ?? 6000
    this.opened = false
    this.running = false
  }

  /**
   * Service name
   */
  get name() {
    return 'eth'
  }

  /**
   * Returns all protocols required by this service
   */
  get protocols(): Protocol[] {
    return []
  }

  /**
   * Open service. Must be called before service is running
   */
  async open() {
    if (this.opened) {
      return false
    }
    const protocols = this.protocols
    this.config.server && this.config.server.addProtocols(protocols)

    this.config.events.on(Event.POOL_PEER_BANNED, (peer) =>
      this.config.logger.debug(`Peer banned: ${peer}`),
    )
    this.config.events.on(Event.POOL_PEER_ADDED, (peer) =>
      this.config.logger.debug(`Peer added: ${peer}`),
    )
    this.config.events.on(Event.POOL_PEER_REMOVED, (peer) =>
      this.config.logger.debug(`Peer removed: ${peer}`),
    )

    await this.pool.open()
    await this.chain.open()
    await this.synchronizer?.open()
    this.opened = true
    return true
  }

  /**
   * Close service.
   */
  async close() {
    if (this.opened) {
      await this.pool.close()
    }
    this.opened = false
  }

  /**
   * Start service
   */
  async start(): Promise<boolean> {
    if (this.running) {
      return false
    }
    await this.pool.start()
    void this.synchronizer?.start()
    if (this.v8Engine === null) {
      this.v8Engine = await getV8Engine()
    }

    this._statsInterval = setInterval(
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await this.stats.bind(this),
      this.STATS_INTERVAL,
    )
    this.running = true
    this.config.logger.info(`Started ${this.name} service.`)
    return true
  }

  /**
   * Stop service
   */
  async stop(): Promise<boolean> {
    if (this.opened) {
      await this.close()
      await this.synchronizer?.close()
    }
    await this.pool.stop()
    clearInterval(this._statsInterval)
    await this.synchronizer?.stop()
    this.running = false
    this.config.logger.info(`Stopped ${this.name} service.`)
    return true
  }

  stats() {
    if (this.v8Engine !== null) {
      const { used_heap_size, heap_size_limit } = this.v8Engine.getHeapStatistics()

      const heapUsed = Math.round(used_heap_size / 1000 / 1000) // MB
      const percentage = Math.round((100 * used_heap_size) / heap_size_limit)
      const msg = `Memory stats usage=${heapUsed} MB percentage=${percentage}%`

      if (this._statsCounter % 4 === 0) {
        this.config.logger.info(msg)
        this._statsCounter = 0
      } else {
        this.config.logger.debug(msg)
      }

      if (percentage >= this.MEMORY_SHUTDOWN_THRESHOLD && !this.config.shutdown) {
        this.config.logger.error('EMERGENCY SHUTDOWN DUE TO HIGH MEMORY LOAD...')
        process.kill(process.pid, 'SIGINT')
      }
      this._statsCounter += 1
    }
  }

  /**
   * Handles incoming request from connected peer
   * @param message message object
   * @param protocol protocol name
   * @param peer peer
   */
  async handle(_message: any, _protocol: string, _peer: Peer): Promise<any> {}
}
