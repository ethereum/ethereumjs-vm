import { Hardfork } from '@ethereumjs/common'
import { BIGINT_0 } from '@ethereumjs/util'

import { FlowControl } from '../net/protocol/index.js'
import { Event } from '../types.js'
import { wait } from '../util/wait.js'

import type { Chain } from '../blockchain/index.js'
import type { Config } from '../config.js'
import type { Peer } from '../net/peer/peer.js'
import type { PeerPool } from '../net/peerpool.js'
import type {
  AccountFetcher,
  BlockFetcher,
  HeaderFetcher,
  ReverseBlockFetcher,
} from './fetcher/index.js'

export interface SynchronizerOptions {
  /* Config */
  config: Config

  /* Peer pool */
  pool: PeerPool

  /* Blockchain */
  chain: Chain

  /* Flow control manager */
  flow?: FlowControl

  /* Refresh interval in ms (default: 1000) */
  interval?: number
}

/**
 * Base class for blockchain synchronizers
 * @memberof module:sync
 */
export abstract class Synchronizer {
  public config: Config

  protected pool: PeerPool
  protected chain: Chain
  protected flow: FlowControl
  protected interval: number
  protected forceSync: boolean

  public _fetcher: AccountFetcher | BlockFetcher | HeaderFetcher | ReverseBlockFetcher | null
  public opened: boolean
  public running: boolean
  public startingBlock: bigint

  // Time (in ms) after which the synced state is reset
  private SYNCED_STATE_REMOVAL_PERIOD = 60000
  private _syncedStatusCheckInterval: NodeJS.Timeout | undefined /* global NodeJS */

  /**
   * Create new node
   */
  constructor(options: SynchronizerOptions) {
    this.config = options.config

    this.pool = options.pool
    this.chain = options.chain
    this._fetcher = null
    this.flow = options.flow ?? new FlowControl()
    this.interval = options.interval ?? 1000
    this.opened = false
    this.running = false
    this.forceSync = false
    this.startingBlock = BIGINT_0

    this.config.events.on(Event.POOL_PEER_ADDED, (peer) => {
      if (this.syncable(peer)) {
        this.config.logger.debug(`Found ${this.type} peer: ${peer}`)
      }
    })

    this.config.events.on(Event.CHAIN_UPDATED, () => {
      this.config.updateSynchronizedState(this.chain.headers.latest, true)
    })
  }

  /**
   * Returns synchronizer type
   */
  get type() {
    return 'sync'
  }

  get fetcher(): AccountFetcher | BlockFetcher | HeaderFetcher | ReverseBlockFetcher | null {
    return this._fetcher
  }

  set fetcher(fetcher: AccountFetcher | BlockFetcher | HeaderFetcher | ReverseBlockFetcher | null) {
    this._fetcher = fetcher
  }

  /**
   * Open synchronizer. Must be called before sync() is called
   */
  async open() {
    this.opened = true
  }

  /**
   * Returns true if peer can be used for syncing
   */
  syncable(_peer: Peer) {
    // TODO: evaluate syncability of peer
    return true
  }

  /**
   * Start synchronization
   */
  async start(): Promise<void | boolean> {
    if (this.running || this.config.chainCommon.gteHardfork(Hardfork.Paris)) {
      return false
    }
    this.running = true

    this._syncedStatusCheckInterval = setInterval(
      this._syncedStatusCheck.bind(this),
      this.SYNCED_STATE_REMOVAL_PERIOD,
    )

    const timeout = setTimeout(() => {
      this.forceSync = true
    }, this.interval * 30)
    while (this.running && !this.config.chainCommon.gteHardfork(Hardfork.Paris)) {
      try {
        await this.sync()
      } catch (error) {
        if (!(error instanceof Error)) {
          error = new Error(error)
        }
        this.config.events.emit(Event.SYNC_ERROR, error)
      }
      await wait(this.interval)
    }
    this.running = false
    clearTimeout(timeout)
  }

  abstract best(): Promise<Peer | undefined>

  abstract syncWithPeer(peer?: Peer): Promise<boolean>

  resolveSync(height?: number) {
    this.clearFetcher()
    const heightStr = typeof height === 'number' && height !== 0 ? ` height=${height}` : ''
    this.config.logger.debug(`Finishing up sync with the current fetcher ${heightStr}`)
    return true
  }

  async syncWithFetcher() {
    try {
      if (this._fetcher) {
        await this._fetcher.blockingFetch()
      }
      this.config.logger.debug(`Fetcher finished fetching...`)
      return this.resolveSync()
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      this.config.logger.error(
        `Received sync error, stopping sync and clearing fetcher: ${error.message ?? error}`,
      )
      this.clearFetcher()
      throw error
    }
  }

  /**
   * Fetch all blocks from current height up to highest found amongst peers
   * @returns when sync is completed
   */
  async sync(): Promise<boolean> {
    let peer = await this.best()
    let numAttempts = 1
    while (!peer && this.opened) {
      this.config.logger.debug(`Waiting for best peer (attempt #${numAttempts})`)
      await wait(5000)
      peer = await this.best()
      numAttempts += 1
    }

    if (!(await this.syncWithPeer(peer))) return false

    // syncWithFetcher should auto resolve when sync completes even if from any other independent
    // fetcher. We shouldn't be auto resolving the fetchers on sync events because SYNC events are
    // not precision based but we need precision to resolve the fetchers
    //
    // TODO: check this for the forward fetcher that it resolves on being close/on head or post merge
    return this.syncWithFetcher()
  }

  /**
   * Clears and removes the fetcher.
   */
  clearFetcher() {
    if (this._fetcher) {
      this._fetcher.clear()
      this._fetcher.destroy()
      this._fetcher = null
    }
  }

  /**
   * Stop synchronizer.
   */
  async stop(): Promise<boolean> {
    this.clearFetcher()
    if (!this.running) {
      return false
    }
    clearInterval(this._syncedStatusCheckInterval as NodeJS.Timeout)
    await new Promise((resolve) => setTimeout(resolve, this.interval))
    this.running = false
    this.config.logger.info('Stopped synchronization.')
    return true
  }

  /**
   * Close synchronizer.
   */
  async close() {
    this.opened = false
  }

  /**
   * Reset synced status after a certain time with no chain updates
   */
  _syncedStatusCheck() {
    this.config.updateSynchronizedState()
  }
}
