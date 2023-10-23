import { BIGINT_0, bytesToHex, equalsBytes } from '@ethereumjs/util'

import { Event } from '../types'
import { short } from '../util'

import { AccountFetcher } from './fetcher'
import { Synchronizer } from './sync'

import type { VMExecution } from '../execution'
import type { Peer } from '../net/peer/peer'
import type { Skeleton } from '../service/skeleton'
import type { SnapFetcherDoneFlags } from './fetcher/types'
import type { SynchronizerOptions } from './sync'
import type { DefaultStateManager } from '@ethereumjs/statemanager'

interface SnapSynchronizerOptions extends SynchronizerOptions {
  /** Skeleton chain */
  skeleton?: Skeleton

  /** VM Execution */
  execution: VMExecution
}

export class SnapSynchronizer extends Synchronizer {
  public running = false
  skeleton?: Skeleton
  private execution: VMExecution
  readonly fetcherDoneFlags: SnapFetcherDoneFlags = {
    done: false,
    syncing: false,
    accountFetcher: {
      started: false,
      // entire account range
      first: BigInt(0),
      done: false,
    },
    storageFetcher: {
      started: false,
      first: BigInt(0),
      count: BigInt(0),
      done: false,
    },
    byteCodeFetcher: {
      started: false,
      first: BigInt(0),
      count: BigInt(0),
      done: false,
    },
    trieNodeFetcher: {
      started: false,
      first: BigInt(0),
      count: BigInt(0),
      done: false,
    },
  }

  constructor(options: SnapSynchronizerOptions) {
    super(options)

    this.skeleton = options.skeleton
    this.execution = options.execution
  }

  /**
   * Returns synchronizer type
   */
  get type() {
    return 'snap'
  }

  get fetcher(): AccountFetcher | null {
    if (this._fetcher !== null && !(this._fetcher instanceof AccountFetcher)) {
      throw Error(`Invalid Fetcher, expected AccountFetcher`)
    }
    return this._fetcher
  }

  set fetcher(fetcher: AccountFetcher | null) {
    this._fetcher = fetcher
  }

  /**
   * Open synchronizer. Must be called before sync() is called
   */
  async open(): Promise<void> {
    await super.open()
    await this.chain.open()
    await this.pool.open()

    const { snapTargetHeight, snapTargetRoot } = this.config

    this.config.logger.info(
      `Opened SnapSynchronizer snapTargetHeight=${snapTargetHeight ?? 'NA'} snapTargetRoot=${short(
        snapTargetRoot ?? 'NA'
      )}`
    )
  }

  /**
   * Returns true if peer can be used for syncing
   */
  syncable(peer: Peer): boolean {
    // Need eth as well to get the latest of the peer
    // TODO: review
    return peer.snap !== undefined && peer.eth !== undefined
  }

  /**
   * Finds the best peer to sync with. We will synchronize to this peer's
   * blockchain. Returns null if no valid peer is found
   */
  async best(): Promise<Peer | undefined> {
    let best: [Peer, bigint] | undefined
    const peers = this.pool.peers.filter(this.syncable.bind(this))
    if (peers.length < this.config.minPeers && !this.forceSync) return
    for (const peer of peers) {
      const latest = await this.latest(peer)
      if (latest) {
        const { number } = latest
        if (
          (!best &&
            number + this.config.snapAvailabilityDepth / BigInt(4) >= this.chain.blocks.height) ||
          (best && best[1] < number)
        ) {
          best = [peer, number]
        }
      }
    }
    return best ? best[0] : undefined
  }

  /**
   * Get latest header of peer
   */
  async latest(peer: Peer) {
    // TODO: refine the way to query latest to fetch for the peer
    const blockHash = peer.eth!.status.bestHash
    // const blockHash = this.skeleton?.headHash() ?? peer.eth!.status.bestHash
    const result = await peer.eth?.getBlockHeaders({
      block: blockHash,
      max: 1,
    })
    return result ? result[1][0] : undefined
  }

  /**
   * Start synchronizer.
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const timeout = setTimeout(() => {
      this.forceSync = true
    }, this.interval * 30)
    try {
      await this.sync()
    } catch (error: any) {
      this.config.logger.error(`Snap sync error: ${error.message}`)
      this.config.events.emit(Event.SYNC_ERROR, error)
    }
    await new Promise((resolve) => setTimeout(resolve, this.interval))
    this.running = false
    clearTimeout(timeout)
  }

  async checkAndSync(): Promise<{
    syncedHash: Uint8Array
    syncedRoot: Uint8Array
    syncedHeight: bigint
  } | null> {
    const fetchingAlreadyDone = this.fetcherDoneFlags.done
    if (!fetchingAlreadyDone) {
      await this.sync()
    }

    if (!this.fetcherDoneFlags.done) {
      throw Error(
        `snap sync fetchers didn't sync complete state accountFetcherDone=${this.fetcherDoneFlags.accountFetcher.done} storageFetcherDone=${this.fetcherDoneFlags.storageFetcher.done} byteCodeFetcherDone=${this.fetcherDoneFlags.byteCodeFetcher.done} trieNodeFetcherDone=${this.fetcherDoneFlags.trieNodeFetcher.done}`
      )
    }

    // a bit weird way to extract this data ideally should have been returned by sync
    // but that is being run through a sync abstract class
    const { snapTargetHeight, snapTargetRoot, snapTargetHash } = this.config
    if (
      snapTargetHeight === undefined ||
      snapTargetRoot === undefined ||
      snapTargetHash === undefined
    ) {
      throw Error(
        `Invalid synced data by snapsync snapTargetHeight=${snapTargetHeight} snapTargetRoot=${short(
          snapTargetRoot ?? 'na'
        )} snapTargetHash=${short(snapTargetHash ?? 'na')}`
      )
    }

    // getStateRoot also flushes the data
    const syncedRoot = await this.execution.vm.stateManager.getStateRoot()
    if (!equalsBytes(syncedRoot, snapTargetRoot)) {
      throw Error(
        `Invalid snap syncedRoot=${short(syncedRoot)} targetRoot=${short(
          snapTargetRoot
        )}  for target height=${snapTargetHeight} hash=${short(snapTargetHash)}`
      )
      // TODO: figure out what needs to be reinited
      // this.fetcherDoneFlags.accountFetcher.done = false;
      // this.fetcherDoneFlags.storageFetcher.done = false;
      // this.fetcherDoneFlags.byteCodeFetcher.done = false;
      // this.fetcherDoneFlags.trieNodeFetcher.done = false
    }

    const snapDoneMsg = `snapsync complete!!! height=${snapTargetHeight} root=${short(
      snapTargetRoot
    )}  hash=${short(snapTargetHash)}`
    if (fetchingAlreadyDone) {
      this.config.logger.debug(snapDoneMsg)
    } else {
      this.config.superMsg(snapDoneMsg)
    }

    return {
      syncedHash: snapTargetHash,
      syncedRoot: snapTargetRoot,
      syncedHeight: snapTargetHeight,
    }
  }

  /**
   * Called from `sync()` to sync blocks and state from peer starting from current height.
   * @param peer remote peer to sync with
   * @returns a boolean if the setup was successful
   */
  async syncWithPeer(peer?: Peer): Promise<boolean> {
    // if skeleton is passed we have to wait for skeleton to be updated
    if (this.skeleton?.synchronized !== true || this.fetcherDoneFlags.done) {
      this.config.logger.info(`SnapSynchronizer - early return ${peer?.id}`)
      return false
    }

    const latest = peer ? await this.latest(peer) : undefined
    if (!latest) {
      return false
    }

    this.config.logger.info(`SnapSynchronizer - syncWithPeer ${peer?.id}`)
    const stateRoot = latest.stateRoot
    const height = latest.number
    // eslint-disable-next-line eqeqeq
    if (this.config.syncTargetHeight == null || this.config.syncTargetHeight < latest.number) {
      this.config.syncTargetHeight = height
      this.config.logger.info(`New sync target height=${height} hash=${bytesToHex(latest.hash())}`)
    }

    if (
      (this.fetcher === null || this.fetcher.syncErrored !== undefined) &&
      this.config.syncTargetHeight <= latest.number + this.config.snapAvailabilityDepth
    ) {
      if ((this.config.snapTargetHeight ?? BIGINT_0) < latest.number) {
        this.config.snapTargetHeight = latest.number
        this.config.snapTargetRoot = latest.stateRoot
        this.config.snapTargetHash = latest.hash()
      }

      this.config.logger.info(
        `syncWithPeer new AccountFetcher peer=${peer?.id} snapTargetHeight=${
          this.config.snapTargetHeight
        } snapTargetRoot=${short(this.config.snapTargetRoot!)}  ${
          this.fetcher === null
            ? ''
            : 'previous fetcher errored=' + this.fetcher.syncErrored?.message
        }`
      )
      this.fetcher = new AccountFetcher({
        config: this.config,
        pool: this.pool,
        stateManager: this.execution.vm.stateManager as DefaultStateManager,
        root: stateRoot,
        // This needs to be determined from the current state of the MPT dump
        first: BigInt(0),
        fetcherDoneFlags: this.fetcherDoneFlags,
      })
    } else {
      return false
    }
    return true
  }

  /**
   * Stop synchronization. Returns a promise that resolves once its stopped.
   */
  async stop(): Promise<boolean> {
    return super.stop()
  }

  /**
   * Close synchronizer.
   */
  async close() {
    if (!this.opened) return
    await super.close()
  }
}
