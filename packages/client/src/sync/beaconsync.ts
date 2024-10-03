import { BIGINT_0, BIGINT_1, bytesToHex } from '@ethereumjs/util'

import { Event } from '../types.js'
import { short } from '../util/index.js'

import { ReverseBlockFetcher } from './fetcher/index.js'
import { Synchronizer } from './sync.js'

import type { VMExecution } from '../execution/index.js'
import type { Peer } from '../net/peer/peer.js'
import type { Skeleton } from '../service/skeleton.js'
import type { SynchronizerOptions } from './sync.js'
import type { Block } from '@ethereumjs/block'

interface BeaconSynchronizerOptions extends SynchronizerOptions {
  /** Skeleton chain */
  skeleton: Skeleton

  /** VM Execution */
  execution: VMExecution
}

/**
 * Beacon sync is the post-merge version of the chain synchronization, where the
 * chain is not downloaded from genesis onward, rather from trusted head backwards.
 * @memberof module:sync
 */
export class BeaconSynchronizer extends Synchronizer {
  skeleton: Skeleton
  private execution: VMExecution

  public running = false

  constructor(options: BeaconSynchronizerOptions) {
    super(options)
    this.skeleton = options.skeleton
    this.execution = options.execution

    this.processSkeletonBlocks = this.processSkeletonBlocks.bind(this)
    this.runExecution = this.runExecution.bind(this)
  }

  /**
   * Returns synchronizer type
   */
  get type() {
    return 'beacon'
  }

  get fetcher(): ReverseBlockFetcher | null {
    if (this._fetcher !== null && !(this._fetcher instanceof ReverseBlockFetcher)) {
      throw Error(`Invalid Fetcher, expected ReverseBlockFetcher`)
    }
    return this._fetcher
  }

  set fetcher(fetcher: ReverseBlockFetcher | null) {
    this._fetcher = fetcher
  }

  /**
   * Open synchronizer. Must be called before sync() is called
   */
  async open(): Promise<void> {
    if (this.opened) return
    await super.open()
    await this.chain.open()
    await this.pool.open()
    await this.skeleton.open()

    this.config.events.on(Event.SYNC_FETCHED_BLOCKS, this.processSkeletonBlocks)
    if (this.config.execution) {
      this.config.events.on(Event.CHAIN_UPDATED, this.runExecution)
    }

    const { height: number, td } = this.chain.blocks
    const hash = this.chain.blocks.latest!.hash()
    this.startingBlock = number
    const timestamp = this.chain.blocks.latest?.header.timestamp
    this.config.chainCommon.setHardforkBy({ blockNumber: number, timestamp })

    this.config.logger.info(
      `Latest local block number=${Number(number)} td=${td} hash=${bytesToHex(
        hash,
      )} hardfork=${this.config.chainCommon.hardfork()}`,
    )

    const subchain = this.skeleton.bounds()
    if (subchain !== undefined) {
      const { head, tail, next } = subchain
      this.config.superMsg(`Resuming beacon sync tail=${tail} head=${head} next=${short(next)}`)
      const headBlock = await this.skeleton.getBlock(head, true)
      if (headBlock !== undefined) {
        await this.skeleton.initSync(headBlock)
        void this.start()
      } else {
        await this.skeleton.reset()
      }
    }
  }

  /**
   * Returns true if peer can be used for syncing
   */
  syncable(peer: Peer): boolean {
    return peer.eth !== undefined
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
      const latest = await peer.latest()
      if (latest !== undefined) {
        const { number } = latest
        if (!best || best[1] < number) {
          best = [peer, number]
        }
      }
    }
    return best ? best[0] : undefined
  }

  /**
   * Start synchronizer.
   * If passed a block, will initialize sync starting from the block.
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const timeout = setTimeout(() => {
      this.forceSync = true
    }, this.interval * 30)
    if (!this.skeleton.isLinked()) {
      while (this.running) {
        try {
          await this.sync()
        } catch (error) {
          if (!(error instanceof Error)) {
            error = new Error(error)
          }
          this.config.logger.error(`Beacon sync error: ${error.message}`)
          this.config.events.emit(Event.SYNC_ERROR, error)
        }
        await new Promise((resolve) => setTimeout(resolve, this.interval))
      }
    } else {
      // It could be that the canonical chain fill got stopped midway, ideally CL
      // would keep extending the skeleton that might trigger fillCanonicalChain
      // but if we are already linked and CL is down, we don't need to wait
      // for CL and just fill up the chain in meantime
      void this.skeleton.fillCanonicalChain()
    }

    this.running = false
    clearTimeout(timeout)
  }

  async reorged(block: Block): Promise<void> {
    if (!this.opened) return
    // Clean the current fetcher, later this.start will start it again
    await this.stop()
    this.config.logger.debug(
      `Beacon sync reorged, new head number=${block.header.number} hash=${short(
        block.header.hash(),
      )}`,
    )
    void this.start()
  }

  /**
   * Returns true if the block successfully extends the chain.
   */
  async extendChain(block: Block): Promise<boolean> {
    if (!this.opened) return false
    const reorg = await this.skeleton.setHead(block, false)
    return !reorg
  }

  /**
   * Sets the new head of the skeleton chain.
   */
  async setHead(block: Block): Promise<boolean> {
    if (!this.opened) return false
    // New head announced, start syncing to it if we are not already.
    // If this causes a reorg, we will tear down the fetcher and start
    // from the new head.
    const reorg = await this.skeleton.setHead(block, true, !this.running)
    if (reorg) {
      await this.reorged(block)
    }
    return true
  }

  /**
   * Sync blocks from the skeleton chain tail.
   * @param peer remote peer to sync with
   * @return Resolves when sync completed
   */
  async syncWithPeer(peer?: Peer): Promise<boolean> {
    if (
      !this.skeleton.isStarted() ||
      this.skeleton.bounds() === undefined ||
      this.skeleton.isLinked()
    ) {
      this.clearFetcher()
      return false
    }

    const latest = peer ? await peer.latest() : undefined
    if (!latest) return false

    const height = latest.number
    if (
      typeof this.config.syncTargetHeight !== 'bigint' ||
      this.config.syncTargetHeight === BIGINT_0 ||
      this.config.syncTargetHeight < latest.number
    ) {
      this.config.syncTargetHeight = height
      this.config.logger.info(`New sync target height=${height} hash=${short(latest.hash())}`)
    }

    const { tail } = this.skeleton.bounds()
    const first = tail - BIGINT_1

    let count
    if (first <= this.chain.blocks.height) {
      // skeleton should have linked by now, if not it means skeleton is syncing the reorg
      // to the current canonical, so we can lower the skeleton target by another 1000 blocks
      count = BigInt(this.config.skeletonSubchainMergeMinimum)
    } else {
      // We sync one less because tail's next should be pointing to the block in chain
      count = tail - this.chain.blocks.height - BIGINT_1
    }

    // Do not try syncing blocks on/pre genesis
    if (count > first) {
      count = first
    }

    if (count > BIGINT_0 && (this.fetcher === null || this.fetcher.syncErrored !== undefined)) {
      this.config.logger.debug(
        `syncWithPeer - new ReverseBlockFetcher peer=${
          peer?.id
        } subChainTail=${tail} first=${first} count=${count} chainHeight=${
          this.chain.blocks.height
        } ${
          this.fetcher === null
            ? ''
            : 'previous fetcher errored=' + this.fetcher.syncErrored?.message
        }`,
      )
      this.fetcher = new ReverseBlockFetcher({
        config: this.config,
        pool: this.pool,
        chain: this.chain,
        skeleton: this.skeleton,
        interval: this.interval,
        first,
        count,
        destroyWhenDone: true,
      })
    }
    return true
  }

  async processSkeletonBlocks(blocks: Block[]) {
    if (blocks.length === 0) {
      if (this.fetcher !== null) {
        this.config.logger.warn('No blocks fetched are applicable for import')
      }
      return
    }

    blocks = blocks as Block[]
    const first = blocks[0].header.number
    const last = blocks[blocks.length - 1].header.number
    const hash = short(blocks[0].hash())

    this.config.logger.debug(
      `Imported skeleton blocks count=${blocks.length} first=${first} last=${last} hash=${hash} peers=${this.pool.size}`,
    )
  }

  /**
   * Runs vm execution on {@link Event.CHAIN_UPDATED}
   */
  async runExecution(): Promise<void> {
    // Execute single block when within 50 blocks of head if skeleton not filling,
    // otherwise run execution in batch of 50 blocks when filling canonical chain.
    const shouldRunOnlyBatched = !(
      this.skeleton.bounds() !== undefined &&
      this.chain.blocks.height > this.skeleton.bounds().head - BigInt(50)
    )
    if (!shouldRunOnlyBatched || this.chain.blocks.height % BigInt(50) === BIGINT_0) {
      await this.execution.run(true, shouldRunOnlyBatched)
    }
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
    this.config.events.removeListener(Event.SYNC_FETCHED_BLOCKS, this.processSkeletonBlocks)
    if (this.config.execution) {
      this.config.events.removeListener(Event.CHAIN_UPDATED, this.runExecution)
    }
    await super.close()
  }
}
