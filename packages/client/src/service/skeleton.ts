import { createBlockFromRLP } from '@ethereumjs/block'
import { RLP } from '@ethereumjs/rlp'
import {
  BIGINT_0,
  BIGINT_1,
  BIGINT_100,
  BIGINT_2EXP256,
  Lock,
  bigIntToBytes,
  bytesToBigInt,
  bytesToInt,
  equalsBytes,
  formatBigDecimal,
  intToBytes,
  utf8ToBytes,
} from '@ethereumjs/util'

import { short, timeDuration } from '../util/index.js'
import { DBKey, MetaDBManager } from '../util/metaDBManager.js'

import type { SnapFetcherDoneFlags } from '../sync/fetcher/types.js'
import type { MetaDBManagerOptions } from '../util/metaDBManager.js'
import type { Block, BlockHeader } from '@ethereumjs/block'
import type { Hardfork } from '@ethereumjs/common'

const INVALID_PARAMS = -32602

export enum PutStatus {
  VALID = 'VALID',
  INVALID = 'INVALID',
}

type FillStatus = {
  status: PutStatus
  height: bigint
  hash: Uint8Array
  validationError?: string
}

type SkeletonStatus = {
  progress: SkeletonProgress
  linked: boolean
  canonicalHeadReset: boolean
  safe: bigint
  finalized: bigint
}

/**
 * Database entry to allow suspending and resuming a chain
 * sync. As the skeleton header chain is downloaded backwards, restarts can and
 * will produce temporarily disjoint subchains. There is no way to restart a
 * suspended skeleton sync without prior knowledge of all prior suspension points.
 */
type SkeletonProgress = {
  subchains: SkeletonSubchain[]
}

/**
 * Contiguous header chain segment that is backed by the database,
 * but may not be linked to the live chain. The skeleton downloader may produce
 * a new one of these every time it is restarted until the subchain grows large
 * enough to connect with a previous subchain.
 */
type SkeletonSubchain = {
  head: bigint /** Block number of the newest header in the subchain */
  tail: bigint /** Block number of the oldest header in the subchain */
  next: Uint8Array /** Block hash of the next oldest header in the subchain */
}
type SkeletonSubchainRLP = [head: Uint8Array, tail: Uint8Array, next: Uint8Array]

/**
 * errSyncReorged is an internal helper error to signal that the head chain of
 * the current sync cycle was (partially) reorged, thus the skeleton syncer
 * should abort and restart with the new state.
 */
export const errSyncReorged = new Error('sync reorged')

/**
 * errReorgDenied is returned if an attempt is made to extend the beacon chain
 * with a new header, but it does not link up to the existing sync.
 */
export const errReorgDenied = new Error('non-forced head reorg denied')

/**
 * errSyncMerged is an internal helper error to signal that the current sync
 * cycle merged with a previously aborted subchain, thus the skeleton syncer
 * should abort and restart with the new state.
 */
export const errSyncMerged = new Error('sync merged')

const zeroBlockHash = new Uint8Array(32)
/**
 * The Skeleton chain class helps support beacon sync by accepting head blocks
 * while backfill syncing the rest of the chain.
 */

const STALE_WINDOW = 10 * 60_000

export class Skeleton extends MetaDBManager {
  private _lock = new Lock()

  private status: SkeletonStatus
  fillStatus: FillStatus | null = null

  private started: number /** Timestamp when the skeleton syncer was created */

  private syncedchain = 0
  private pulled = BIGINT_0 /** Number of headers downloaded in this run */

  private filling = false /** Whether we are actively filling the canonical chain */
  private lastfilledAt = 0
  private lastfilled = BIGINT_0

  private lastexecutedAt = 0
  private lastexecuted = BIGINT_0

  private lastfetchedAt = 0
  private lastfetched = BIGINT_0

  private lastvalid = 0

  private lastFcuTime = 0
  private lastsyncedAt = 0

  private STATUS_LOG_INTERVAL = 8000 /** How often to log sync status (in ms) */

  /**
   * safeBlock as indicated by engine api, set
   */
  public safeBlock?: Block
  public finalizedBlock?: Block

  // to track if we have cl FCUs close to the clock head
  synchronized = false
  private lastSynchronized = false
  private lastSyncDate = 0

  constructor(opts: MetaDBManagerOptions) {
    super(opts)
    this.status = {
      progress: { subchains: [] },
      linked: false,
      canonicalHeadReset: false,
      safe: BIGINT_0,
      finalized: BIGINT_0,
    }
    this.started = 0
  }

  /**
   * Run a function after acquiring a lock. It is implied that we have already
   * initialized the module (or we are calling this from the init function, like
   * `_setCanonicalGenesisBlock`)
   * @param action - function to run after acquiring a lock
   * @hidden
   */
  private async runWithLock<T>(action: () => Promise<T>): Promise<T> {
    try {
      await this._lock.acquire()
      const value = await action()
      return value
    } finally {
      this._lock.release()
    }
  }

  async open() {
    // make sure to open chain before this can be opened
    await this.chain.open()

    await this.runWithLock<void>(async () => {
      await this.getSyncStatus()
      this.logSyncStatus('Read')
      this.started = new Date().getTime()
    })
  }

  async close() {
    await this.runWithLock<void>(async () => {
      await this.writeSyncStatus()
      this.started = 0
    })
  }

  async reset() {
    if (this.started === 0) {
      throw Error(`skeleton reset called before being opened`)
    }
    await this.runWithLock<void>(async () => {
      // retain safe,finalized from the progress as that is not bound to change
      this.status = {
        ...this.status,
        progress: { subchains: [] },
        linked: false,
        canonicalHeadReset: false,
      }
      await this.writeSyncStatus()
    })
  }

  /**
   * Returns true if the skeleton chain is linked to canonical
   */
  private async checkLinked() {
    if (this.status.progress.subchains.length === 0) return false
    const { tail, next } = this.bounds()
    // if its genesis we are linked
    if (tail === BIGINT_0) return true
    if (tail <= this.chain.blocks.height + BIGINT_1) {
      const nextBlock = await this.chain.getBlock(tail - BIGINT_1)
      const linked = equalsBytes(next, nextBlock.hash())
      if (linked && this.status.progress.subchains.length > 1) {
        // Remove all other subchains as no more relevant
        const junkedSubChains = this.status.progress.subchains.splice(1)
        this.config.logger.debug(
          `Canonical subchain linked with main, removing junked chains ${junkedSubChains
            .map((s) => `[tail=${s.tail} head=${s.head} next=${short(s.next)}]`)
            .join(',')}`,
        )
        await this.writeSyncStatus()
      }
      return linked
    }
    return false
  }

  isLinked() {
    return this.status.linked
  }

  isStarted() {
    return this.started > 0
  }

  async isLastAnnouncement(): Promise<boolean> {
    const subchain0 = this.status.progress.subchains[0]
    if (subchain0 !== undefined) {
      return this.getBlock(subchain0.head + BIGINT_1) !== undefined
    } else {
      return true
    }
  }

  /**
   * Try fast forwarding the chain head to the number
   */
  private async fastForwardHead(lastchain: SkeletonSubchain, target: bigint) {
    const head = lastchain.head
    let headBlock = await this.getBlock(head, true)
    if (headBlock === undefined) {
      return
    }

    for (let newHead = head + BIGINT_1; newHead <= target; newHead += BIGINT_1) {
      const newBlock = await this.getBlock(newHead, true)
      if (newBlock === undefined || !equalsBytes(newBlock.header.parentHash, headBlock.hash())) {
        // Head can't be updated forward
        break
      }
      headBlock = newBlock
    }
    lastchain.head = headBlock.header.number
    this.config.logger.debug(
      `lastchain head fast forwarded from=${head} to=${lastchain.head} tail=${lastchain.tail}`,
    )
  }

  /**
   * processNewHead does the internal shuffling for a new head marker and either
   * accepts and integrates it into the skeleton or requests a reorg. Upon reorg,
   * the syncer will tear itself down and restart with a fresh head. It is simpler
   * to reconstruct the sync state than to mutate it.
   *
   * @returns true if the chain was reorged
   */
  private async processNewHead(head: Block, force = false): Promise<boolean> {
    // If the header cannot be inserted without interruption, return an error for
    // the outer loop to tear down the skeleton sync and restart it
    const { number } = head.header
    if (number === BIGINT_0) {
      if (!equalsBytes(this.chain.genesis.hash(), head.hash())) {
        throw Error(
          `Invalid genesis setHead announcement number=${number} hash=${short(
            head.hash(),
          )} genesisHash=${short(this.chain.genesis.hash())}`,
        )
      }
      // genesis announcement
      this.status.linked = true
      this.status.canonicalHeadReset = false
      return false
    }

    const [lastchain] = this.status.progress.subchains
    // subchains should have already been inited
    if (lastchain === undefined) {
      throw Error(`No subchain to processNewHead`)
    }

    if (lastchain.tail > number) {
      // Not a noop / double head announce, abort with a reorg
      if (force) {
        this.config.logger.warn(
          `Skeleton setHead before tail, resetting skeleton tail=${lastchain.tail} head=${lastchain.head} newHead=${number}`,
        )
        lastchain.head = number
        lastchain.tail = number
        lastchain.next = head.header.parentHash
      } else {
        this.config.logger.debug(
          `Skeleton announcement before tail, will reset skeleton tail=${lastchain.tail} head=${lastchain.head} newHead=${number}`,
        )
      }
      return true
    } else if (lastchain.head >= number) {
      // Check if its duplicate announcement, if not trim the head and let the match run
      // post this if block
      const mayBeDupBlock = await this.getBlock(number)
      if (mayBeDupBlock !== undefined && equalsBytes(mayBeDupBlock.header.hash(), head.hash())) {
        this.config.logger.debug(
          `Skeleton duplicate ${force ? 'setHead' : 'announcement'} tail=${lastchain.tail} head=${
            lastchain.head
          } number=${number} hash=${short(head.hash())}`,
        )
        return false
      } else {
        // Since its not a dup block, so there is reorg in the chain or at least in the head
        // which we will let it get addressed post this if else block
        if (force) {
          this.config.logger.debug(
            `Skeleton head reorg tail=${lastchain.tail} head=${
              lastchain.head
            } number=${number} expected=${short(
              mayBeDupBlock?.hash() ?? zeroBlockHash,
            )} actual=${short(head.hash())}`,
          )
        } else {
          this.config.logger.debug(
            `Skeleton differing announcement tail=${lastchain.tail} head=${lastchain.head} number=${number}`,
          )
        }
        return true
      }
    } else if (lastchain.head + BIGINT_1 < number) {
      if (force) {
        await this.fastForwardHead(lastchain, number - BIGINT_1)
        // If its still less than number then its gapped head
        if (lastchain.head + BIGINT_1 < number) {
          this.config.logger.debug(
            `Beacon chain gapped setHead head=${lastchain.head} newHead=${number}`,
          )
          return true
        }
      } else {
        this.config.logger.debug(
          `Beacon chain gapped announcement head=${lastchain.head} newHead=${number}`,
        )
        return true
      }
    }
    const parent = await this.getBlock(number - BIGINT_1)
    if (parent === undefined || !equalsBytes(parent.hash(), head.header.parentHash)) {
      if (force) {
        this.config.logger.warn(
          `Beacon chain forked ancestor=${parent?.header.number} hash=${short(
            parent?.hash() ?? 'NA',
          )} want=${short(head.header.parentHash)}`,
        )
      }
      return true
    }
    if (force) {
      lastchain.head = number
      if (this.status.progress.subchains.length === 0) {
        // If there was no subchain to being with i.e. initialized from genesis and no reorg
        // then push in subchains else the reorg handling will push the new chain
        this.status.progress.subchains.push(lastchain)
        this.status.linked = await this.checkLinked()
      }
      this.config.logger.debug(
        `Beacon chain extended new head=${lastchain.head} tail=${lastchain.tail} next=${short(
          lastchain.next,
        )}`,
      )
    }
    return false
  }

  /**
   * Announce and integrate a new head.
   * @params head - The block being attempted as a new head
   * @params force - Flag to indicate if this is just a check of worthiness or a actually new head
   * @params init - Flag this is the first time since the beacon sync start to perform additional tasks
   * @params reorgThrow - Flag to indicate if we would actually like to throw if there is a reorg
   *         instead of just returning the boolean
   *
   * @returns True if the head (will) cause a reorg in the canonical skeleton subchain
   */
  async setHead(head: Block, force = true, init = false, reorgThrow = false): Promise<boolean> {
    if (
      this.config.syncTargetHeight === undefined ||
      this.config.syncTargetHeight < head.header.number
    ) {
      this.config.syncTargetHeight = head.header.number
    }

    return this.runWithLock<boolean>(async () => {
      if (this.started === 0) {
        throw Error(`skeleton setHead called before being opened`)
      }
      if (!init) {
        this.lastFcuTime = Date.now()
      }

      this.config.logger.debug(
        `New skeleton head announced number=${head.header.number} hash=${short(
          head.hash(),
        )} force=${force}`,
      )

      let [lastchain] = this.status.progress.subchains
      if (lastchain === undefined) {
        // init the subchains even if this is not a forced head
        lastchain = {
          head: this.chain.blocks.height,
          tail: this.chain.blocks.height,
          next: this.chain.blocks.latest?.header.parentHash ?? zeroBlockHash,
        }
        this.status.linked = true
        this.status.canonicalHeadReset = false
        this.config.logger.debug(
          `Initing empty skeleton with current chain head tail=${lastchain.tail} head=${
            lastchain.head
          } next=${short(lastchain.next)}`,
        )
        this.status.progress.subchains.push(lastchain)
      }

      const subchain0Head = lastchain.head
      const reorg = await this.processNewHead(head, force)

      // see if just the head needs to be updated or a new subchain needs to be created
      if (force && reorg) {
        // It could just be a reorg at this head with previous tail preserved unless
        //   1. parent is not present in skeleton (it could be in chain for whatever reason) or
        //   2. the parent < current skeleton tail
        // then we need to reset the subchain itself
        const subchain = this.status.progress.subchains[0]
        const parent = await this.getBlock(head.header.number - BIGINT_1, true)
        if (
          subchain === undefined ||
          parent === undefined ||
          !equalsBytes(parent.hash(), head.header.parentHash) ||
          parent.header.number < subchain.tail
        ) {
          // truncate subchain 0 before inserting a new chain so that this chain can be merged into new
          // one without issues if the opportunity arises
          if (
            subchain !== undefined &&
            this.status.linked &&
            this.status.canonicalHeadReset === false &&
            this.chain.blocks.height >= subchain.tail
          ) {
            const truncateTailToNumber = this.chain.blocks.height + BIGINT_1
            const truncateTailTo =
              truncateTailToNumber <= subchain.head
                ? await this.getBlock(truncateTailToNumber, true)
                : undefined
            if (truncateTailTo !== undefined) {
              subchain.tail = truncateTailTo.header.number
              subchain.next = truncateTailTo.header.parentHash
              this.config.logger.info(
                `Truncated subchain0 with head=${subchain.head} to a new tail=${
                  subchain.tail
                } next=${short(subchain.next)} before overlaying a new subchain`,
              )
            } else {
              // clear out this subchain
              this.config.logger.info(
                `Dropping subchain0 with head=${subchain.head} before overlaying a new subchain as truncateTailToNumber=${truncateTailToNumber} block not available `,
              )
              this.status.progress.subchains.splice(0, 1)
            }
          }

          const s = {
            head: head.header.number,
            tail: head.header.number,
            next: head.header.parentHash,
          }

          // reset subchains if it only had been set with genesis to only track non-trivial subchains
          if (subchain0Head === BIGINT_0) {
            this.status.progress.subchains = []
          }

          this.status.progress.subchains.unshift(s)
          const msgs = [
            `Created new subchain tail=${s.tail} head=${s.head} next=${short(s.next)}`,
            'Note: Subchain will be backfilled and merged with the canonical chain on success.',
          ]
          this.config.superMsg(msgs)
          // Reset the filling of canonical head from tail only on tail reorg and exit any ongoing fill
          this.status.canonicalHeadReset = s.tail > BIGINT_0
        } else {
          // we are here because valid canonical parent is either in skeleton or chain and new head
          // > tail and hence doesn't reorg the current tail
          subchain.head = head.header.number
          // if this was a linked chain with no reset marked and chain height >= tail we need to
          // truncate the tail
          if (
            this.status.linked &&
            !this.status.canonicalHeadReset &&
            this.chain.blocks.height >= subchain.tail
          ) {
            let truncateTailTo
            const truncateTailToNumber = this.chain.blocks.height + BIGINT_1
            if (truncateTailToNumber < head.header.number) {
              truncateTailTo = await this.getBlock(truncateTailToNumber, true)
            }

            if (truncateTailTo === undefined) {
              subchain.tail = head.header.number
              subchain.next = head.header.parentHash
              // reset canonical head, don't change linked status because parent was
              // found in canonical chain
              this.status.canonicalHeadReset = true
              this.config.logger.info(
                `Truncated subchain tail for chain reorg to the subchain head=${
                  subchain.tail
                } next=${short(subchain.next)} linked=${this.status.linked} canonicalHeadReset=${
                  this.status.canonicalHeadReset
                }`,
              )
            } else {
              subchain.tail = truncateTailTo.header.number
              subchain.next = truncateTailTo.header.parentHash
              // just reset tail and no need to modify linked status
              this.config.logger.info(
                `Truncated subchain with head=${subchain.head} to a new tail=${
                  subchain.tail
                } next=${short(subchain.next)} linked=${this.status.linked} canonicalHeadReset=${
                  this.status.canonicalHeadReset
                }`,
              )
            }
          }
        }

        // if chain head reset needs to be done i.e. fill not started or chain is not linked because of reorg
        // fillStatus should be set null
        if (this.status.canonicalHeadReset || !this.status.linked) {
          this.fillStatus = null
        }
      }

      // only add to unfinalized cache if this is announcement and before canonical head
      await this.putBlock(head, !force && head.header.number <= subchain0Head)

      if (init) {
        await this.trySubChainsMerge()
      }
      if ((force && reorg) || init) {
        this.status.linked = await this.checkLinked()
      }
      // fill by the fcU will be triggered on its own
      if (init && this.status.linked && head.header.number > subchain0Head) {
        void this.fillCanonicalChain()
      }
      if (force || init) {
        await this.writeSyncStatus()
      }
      if (init) {
        this.logSyncStatus('init', { forceShowInfo: true })
      }

      // Earlier we were throwing on reorg, essentially for the purposes for killing the reverse fetcher
      // but it can be handled properly in the calling fn without erroring
      if (reorg && reorgThrow) {
        if (force) {
          throw errSyncReorged
        } else {
          throw errReorgDenied
        }
      }
      return reorg
    })
  }

  /**
   * Updates if the skeleton/cl seems synced to the head
   * copied over from config, could be DRY-ied
   * @param option latest to update the sync state with
   */
  updateSynchronizedState(latest?: BlockHeader | null) {
    // If no syncTargetHeight has been discovered from peer or fcU sync state can't be
    // determined
    const subchain0 = this.status.progress.subchains[0]
    if ((this.config.syncTargetHeight ?? BIGINT_0) === BIGINT_0 || subchain0 === undefined) {
      return
    }

    if (latest !== null && latest !== undefined) {
      const height = subchain0.head
      if (height >= (this.config.syncTargetHeight ?? BIGINT_0)) {
        this.config.syncTargetHeight = height
        this.lastSyncDate =
          typeof latest.timestamp === 'bigint' && latest.timestamp > 0n
            ? Number(latest.timestamp) * 1000
            : Date.now()

        const diff = Date.now() - this.lastSyncDate
        // update synchronized
        if (diff < this.config.syncedStateRemovalPeriod) {
          if (!this.synchronized) {
            this.synchronized = true
            // Log to console the sync status
            this.config.superMsg(
              `Synchronized cl (skeleton) at height=${height} hash=${short(latest.hash())} 🎉`,
            )
          }
        }
      }
    } else {
      if (this.synchronized) {
        const diff = Date.now() - this.lastSyncDate
        if (diff >= this.config.syncedStateRemovalPeriod) {
          this.synchronized = false
          this.config.logger.info(
            `Cl (skeleton) sync status reset (no chain updates for ${Math.round(
              diff / 1000,
            )} seconds).`,
          )
        }
      }
    }

    if (this.synchronized !== this.lastSynchronized) {
      this.config.logger.debug(
        `Cl (skeleton) synchronized=${this.synchronized}${
          latest !== null && latest !== undefined ? ' height=' + latest.number : ''
        } syncTargetHeight=${this.config.syncTargetHeight} lastSyncDate=${
          (Date.now() - this.lastSyncDate) / 1000
        } secs ago`,
      )
      this.lastSynchronized = this.synchronized
    }
  }

  async forkchoiceUpdate(
    headBlock: Block,
    {
      safeBlockHash,
      finalizedBlockHash,
    }: { safeBlockHash?: Uint8Array; finalizedBlockHash?: Uint8Array } = {},
  ): Promise<{ reorged: boolean; safeBlock?: Block; finalizedBlock?: Block }> {
    // setHead locks independently and between setHead unlocking and locking below there should
    // be no injected code as each of the async ops take the lock. so once setHead takes the
    // lock, all of them should be executed serially
    const prevLinked = this.status.linked
    const reorged = await this.setHead(headBlock, true)
    if (reorged && prevLinked && !this.status.linked) {
      // blocking fill with engineParentLookupMaxDepth as fcU tries to put max engineParentLookupMaxDepth
      await this.blockingTailBackfillWithCutoff(this.chain.config.engineParentLookupMaxDepth).catch(
        (e) => {
          this.config.logger.debug(`blockingTailBackfillWithCutoff exited with error=${e}`)
        },
      )
    }

    const subchain0 = this.status.progress.subchains[0]
    if (subchain0 === undefined) {
      throw Error(`subchain0 should have been set as a result of skeleton setHead`)
    }

    // set/update safe and finalized and see if they can backfill the tail in which case should
    // update tail of subchain0
    // also important to do putBlocks before running validations
    let safeBlock: Block | undefined
    if (safeBlockHash !== undefined) {
      if (equalsBytes(safeBlockHash, zeroBlockHash)) {
        safeBlock = this.chain.genesis
      } else if (equalsBytes(safeBlockHash, this.safeBlock?.hash() ?? zeroBlockHash)) {
        safeBlock = this.safeBlock
      } else if (equalsBytes(safeBlockHash, headBlock.hash())) {
        safeBlock = headBlock
      } else {
        safeBlock = await this.getBlockByHash(safeBlockHash)
      }
      if (safeBlock !== undefined) {
        if (safeBlock.header.number > headBlock.header.number) {
          throw {
            code: INVALID_PARAMS,
            message: `Invalid safe block=${safeBlock.header.number} > headBlock=${headBlock.header.number}`,
          }
        }
        if (!this.status.linked && safeBlock.header.number === subchain0.tail - BIGINT_1) {
          await this.putBlocks([safeBlock])
        }
      }
    } else {
      safeBlock = this.safeBlock ?? this.chain.genesis
    }

    let finalizedBlock: Block | undefined
    if (finalizedBlockHash !== undefined) {
      if (equalsBytes(finalizedBlockHash, zeroBlockHash)) {
        finalizedBlock = this.chain.genesis
      } else if (equalsBytes(finalizedBlockHash, this.finalizedBlock?.hash() ?? zeroBlockHash)) {
        finalizedBlock = this.finalizedBlock
      } else if (equalsBytes(finalizedBlockHash, headBlock.hash())) {
        finalizedBlock = headBlock
      } else {
        finalizedBlock = await this.getBlockByHash(finalizedBlockHash)
      }
      if (finalizedBlock !== undefined) {
        if (
          finalizedBlock.header.number > headBlock.header.number ||
          (safeBlock !== undefined && finalizedBlock.header.number > safeBlock.header.number)
        ) {
          throw {
            code: INVALID_PARAMS,
            message: `Invalid finalized block=${finalizedBlock.header.number} > headBlock=${headBlock.header.number} or safeBlock=${safeBlock?.header.number}`,
          }
        }
        if (!this.status.linked && finalizedBlock.header.number === subchain0.tail - BIGINT_1) {
          await this.putBlocks([finalizedBlock])
        }
      }
    } else {
      finalizedBlock = this.finalizedBlock ?? this.chain.genesis
    }

    await this.runWithLock<void>(async () => {
      let shouldBeFinalizedNumber = this.finalizedBlock?.header.number ?? BIGINT_0
      if (finalizedBlock !== undefined && finalizedBlock.header.number > shouldBeFinalizedNumber) {
        shouldBeFinalizedNumber = finalizedBlock.header.number
      }

      let shouldBeSafeNumber = shouldBeFinalizedNumber
      if (this.safeBlock !== undefined && this.safeBlock.header.number > shouldBeSafeNumber) {
        shouldBeSafeNumber = this.safeBlock.header.number
      }
      if (safeBlock !== undefined && safeBlock.header.number > shouldBeSafeNumber) {
        shouldBeSafeNumber = safeBlock.header.number
      }

      // check for canonicality and availability of the safe and finalized now
      if (this.status.linked || shouldBeSafeNumber >= subchain0.tail) {
        if (safeBlock === undefined) {
          throw {
            code: INVALID_PARAMS,
            message: `safe block not available in canonical chain`,
          }
        } else {
          const canonicalBlock = await this.getBlock(safeBlock.header.number, true)
          if (
            canonicalBlock === undefined ||
            !equalsBytes(safeBlock.hash(), canonicalBlock.hash())
          ) {
            throw {
              code: INVALID_PARAMS,
              message: `safe block not canonical in chain`,
            }
          }
        }
      }

      if (this.status.linked || shouldBeFinalizedNumber >= subchain0.tail) {
        if (finalizedBlock === undefined) {
          throw {
            code: INVALID_PARAMS,
            message: `finalized block not available in canonical chain`,
          }
        } else {
          const canonicalBlock = await this.getBlock(finalizedBlock.header.number, true)
          if (
            canonicalBlock === undefined ||
            !equalsBytes(finalizedBlock.hash(), canonicalBlock.hash())
          ) {
            throw {
              code: INVALID_PARAMS,
              message: `finalized block not canonical in chain`,
            }
          }
        }
      }

      this.updateSynchronizedState(headBlock?.header)
      this.safeBlock = safeBlock ?? this.safeBlock

      if (
        (finalizedBlock?.header.number ?? BIGINT_0) >
        (this.finalizedBlock?.header.number ?? BIGINT_0)
      ) {
        void this.pruneFinalizedNonCanonicalBlocks()
      }

      this.finalizedBlock = finalizedBlock ?? this.finalizedBlock
    })

    // blocking fill with engineParentLookupMaxDepth as fcU tries to put max engineParentLookupMaxDepth
    // blocks if there are executed blocks to fill with. This blocking causes it to not interfere
    // with the setHead mechanism. This is however a hack and a better solution needs to be devised
    // to handle it blockchain level as because of async nature of new payloads and fcUs and the skeleton
    // there is always a chance for uncoordinated put blocks unless they are all coordinated through skeleton
    // which might also be a valid
    await this.blockingFillWithCutoff(this.chain.config.engineParentLookupMaxDepth)

    return { reorged, safeBlock: this.safeBlock, finalizedBlock: this.finalizedBlock }
  }

  async setVmHead(snapStatus: { syncedHash: Uint8Array; syncedHeight: bigint }): Promise<boolean> {
    const { syncedHash, syncedHeight } = snapStatus
    return this.runWithLock<boolean>(async () => {
      // check if the synced state's block is canonical and <= current safe and chain has synced till
      const syncedBlock = await this.getBlock(
        syncedHeight,
        // need to debug why this flag causes to return undefined when chain gets synced
        //, true
      )
      if (
        syncedBlock !== undefined &&
        syncedBlock.header.number <= this.chain.blocks.height &&
        ((this.safeBlock !== undefined &&
          syncedBlock.header.number <= this.safeBlock.header.number) ||
          syncedBlock.header.number <=
            this.chain.blocks.height - this.config.snapTransitionSafeDepth)
      ) {
        await this.chain.blockchain.setIteratorHead('vm', syncedHash)
        await this.chain.update(false)
        return true
      } else {
        return false
      }
    })
  }

  /**
   * Setup the skeleton to init sync with head
   * @params head - The block with which we want to init the skeleton head
   * @params reorgThrow - If we would like the function to throw instead of silently
   *         return if there is reorg of the skeleton head
   *
   * @returns True if the skeleton was reorged trying to init else false
   */
  async initSync(head: Block, reorgThrow = false): Promise<boolean> {
    return this.setHead(head, true, true, reorgThrow)
  }

  /**
   * Bounds returns the current head and tail tracked by the skeleton syncer.
   */
  bounds(): SkeletonSubchain {
    return this.status.progress.subchains[0]
  }

  async headHash(): Promise<Uint8Array | undefined> {
    const subchain = this.bounds()
    if (subchain !== undefined) {
      const headBlock = await this.getBlock(subchain.head)
      if (headBlock) {
        return headBlock.hash()
      }
    }
  }

  private async trySubChainsMerge(): Promise<boolean> {
    let merged = false
    let edited = false

    // If the subchain extended into the next subchain, we need to handle
    // the overlap. Since there could be many overlaps, do this in a loop.
    while (
      this.status.progress.subchains.length > 1 &&
      this.status.progress.subchains[1].head >= this.status.progress.subchains[0].tail
    ) {
      // Extract some stats from the second subchain
      const { head, tail, next } = this.status.progress.subchains[1]
      // Since we just overwrote part of the next subchain, we need to trim
      // its head independent of matching or mismatching content
      if (tail >= this.status.progress.subchains[0].tail) {
        // Fully overwritten, get rid of the subchain as a whole
        this.config.logger.debug(
          `Previous subchain fully overwritten tail=${tail} head=${head} next=${short(next)}`,
        )
        this.status.progress.subchains.splice(1, 1)
        edited = true
        continue
      } else {
        // Partially overwritten, trim the head to the overwritten size
        this.status.progress.subchains[1].head = this.status.progress.subchains[0].tail - BIGINT_1
        this.config.logger.debug(
          `Previous subchain partially overwritten tail=${tail} head=${head} next=${short(
            next,
          )} with newHead=${this.status.progress.subchains[1].head}`,
        )
        edited = true
      }
      // If the old subchain is an extension of the new one, merge the two
      // and let the skeleton syncer restart (to clean internal state)

      // subchains are useful if subChain1Head is in skeleton only and its tail correct
      const subChain1Head = await this.getBlock(this.status.progress.subchains[1].head, true)
      // tail lookup also needs to be from skeleton because we set resetCanonicalHead true if merged
      const subChain1Tail = await this.getBlock(this.status.progress.subchains[1].tail, true)
      if (
        subChain1Head === undefined ||
        subChain1Tail === undefined ||
        !equalsBytes(subChain1Tail.header.parentHash, this.status.progress.subchains[1].next)
      ) {
        // if subChain1Head is not in the skeleton then all previous subchains are not useful
        // and better to junk
        this.config.logger.debug(
          `Removing all previous subchains as skeleton missing block at previous subchain head=${this.status.progress.subchains[1].head} or its tail=${this.status.progress.subchains[1].tail}`,
        )
        this.status.progress.subchains.splice(1, this.status.progress.subchains.length - 1)
      } else if (
        equalsBytes(subChain1Head.hash(), this.status.progress.subchains[0].next) === true
      ) {
        // only merge is we can integrate a big progress, as each merge leads
        // to disruption of the block fetcher to start a fresh
        if (head - tail > this.config.skeletonSubchainMergeMinimum) {
          this.config.logger.debug(
            `Previous subchain merged tail=${tail} head=${head} next=${short(next)}`,
          )
          this.status.progress.subchains[0].tail = tail
          this.status.progress.subchains[0].next = next
          this.status.progress.subchains.splice(1, 1)
          // If subchains were merged, all further available headers
          // are invalid since we skipped ahead.
          merged = true
        } else {
          this.config.logger.debug(
            `Subchain ignored for merge tail=${tail} head=${head} count=${head - tail}`,
          )
          this.status.progress.subchains.splice(1, 1)
        }
        edited = true
      }
    }
    if (edited) await this.writeSyncStatus()
    return merged
  }

  /**
   * Writes skeleton blocks to the db by number
   * @returns number of blocks saved
   */
  async putBlocks(blocks: Block[], skipForwardFill: boolean = false): Promise<number> {
    return this.runWithLock<number>(async () => {
      // if no subchain or linked chain throw error as this will exit the fetcher
      if (this.status.progress.subchains.length === 0) {
        throw Error(`Skeleton no subchain set for sync`)
      }
      if (this.status.linked) {
        throw Error(`Chain already linked`)
      }

      let merged = false
      let tailUpdated = false
      this.config.logger.debug(
        `Skeleton putBlocks start=${blocks[0]?.header.number} hash=${short(
          blocks[0]?.hash(),
        )} fork=${blocks[0].common.hardfork()} end=${
          blocks[blocks.length - 1]?.header.number
        } count=${blocks.length}, subchain head=${this.status.progress.subchains[0]?.head} tail = ${
          this.status.progress.subchains[0].tail
        } next=${short(this.status.progress.subchains[0]?.next)}`,
      )
      for (const block of blocks) {
        const { number } = block.header
        if (number >= this.status.progress.subchains[0].tail) {
          // These blocks should already be in skeleton, and might be coming in
          // from previous events especially if the previous subchains merge
          continue
        } else if (number === BIGINT_0) {
          if (!equalsBytes(this.chain.genesis.hash(), block.hash())) {
            throw Error(
              `Skeleton pubBlocks with invalid genesis block number=${number} hash=${short(
                block.hash(),
              )} genesisHash=${short(this.chain.genesis.hash())}`,
            )
          }
          continue
        } else if (number < BIGINT_0) {
          throw Error(`Skeleton putBlocks with invalid block number=${number}`)
        }

        // Extend subchain or create new segment if necessary
        if (equalsBytes(this.status.progress.subchains[0].next, block.hash())) {
          await this.putBlock(block)
          this.pulled += BIGINT_1
          this.status.progress.subchains[0].tail = block.header.number
          this.status.progress.subchains[0].next = block.header.parentHash
          tailUpdated = true
        } else {
          // Critical error, we expect new incoming blocks to extend the canonical
          // subchain which is the [0]'th
          const tailBlock = await this.getBlock(this.status.progress.subchains[0].tail)
          this.config.logger.warn(
            `Blocks don't extend canonical subchain tail=${
              this.status.progress.subchains[0].tail
            } head=${this.status.progress.subchains[0].head} next=${short(
              this.status.progress.subchains[0].next,
            )} tailHash=${short(
              tailBlock?.hash() ?? zeroBlockHash,
            )} tailFork=${tailBlock?.common.hardfork()}, block number=${number} tailparent=${short(
              tailBlock?.header.parentHash ?? zeroBlockHash,
            )} hash=${short(block.hash())} fork=${block.common.hardfork()}`,
          )
          throw Error(`Blocks don't extend canonical subchain`)
        }
        merged = await this.trySubChainsMerge()

        // If tail is updated normally or because of merge, we should now fill from
        // the tail to modify the canonical
        if (tailUpdated || merged) {
          this.status.canonicalHeadReset = true
          // since tail has been backfilled, fill status should be null
          this.fillStatus = null
          if (this.status.progress.subchains[0].tail - BIGINT_1 <= this.chain.blocks.height) {
            this.status.linked = await this.checkLinked()
          }
        }

        // If its merged, we need to break as the new tail could be quite ahead
        // so we need to clear out and run the reverse block fetcher again
        if (merged || this.status.linked) break
      }

      await this.writeSyncStatus()

      // If the sync is finished, start filling the canonical chain.
      if (this.status.linked) {
        this.config.superMsg(
          `Backfilling subchain completed, filling canonical chain=${!skipForwardFill}`,
        )
        if (!skipForwardFill) {
          void this.fillCanonicalChain()
        }
      }

      if (merged) throw errSyncMerged
      return blocks.length
    })
  }

  private async backStep(fromBlock: bigint): Promise<bigint | null> {
    try {
      if (this.config.skeletonFillCanonicalBackStep <= 0) return null
      const { head, tail } = this.bounds()
      // by default we try back stepping from tail or fromBlock whichever is bigger
      let newTail: bigint | null = tail < fromBlock ? fromBlock : tail

      let tailBlock
      do {
        newTail = newTail + BigInt(this.config.skeletonFillCanonicalBackStep)
        tailBlock = await this.getBlock(newTail, true)
      } while (tailBlock === undefined && newTail <= head)
      if (newTail > head) {
        newTail = head
        tailBlock = await this.getBlock(newTail, true)
      }

      if (tailBlock !== undefined && newTail) {
        this.config.logger.info(`Backstepped skeleton tail=${newTail} head=${head}`)
        this.status.progress.subchains[0].tail = tailBlock.header.number
        this.status.progress.subchains[0].next = tailBlock.header.parentHash
        await this.writeSyncStatus()
        return newTail
      } else {
        // we need a new head, emptying the subchains
        this.status.progress.subchains = []
        await this.writeSyncStatus()
        this.config.logger.warn(
          `Couldn't backStep subchain 0, dropping subchains for new head signal`,
        )
        return null
      }
    } finally {
      this.status.canonicalHeadReset = true
      this.status.linked = await this.checkLinked()
    }
  }

  /**
   * fill the canonical chain from skeleton if there is only a small segment to fill
   */
  async blockingFillWithCutoff(cutoffLen: number): Promise<void> {
    const subchain0 = this.status.progress.subchains[0]
    if (this.status.linked && subchain0 !== undefined) {
      const fillPromise = this.fillCanonicalChain().catch((_e) => {})
      // if subchain0Head is not too ahead, then fill blocking as it gives better sync
      // log experience else just trigger
      if (
        subchain0.head - BigInt(cutoffLen) <
        (this.status.canonicalHeadReset ? subchain0.tail : this.chain.blocks.height)
      ) {
        this.config.logger.debug('Attempting blocking fill')
        await fillPromise
      }
    }
  }

  async getUnfinalizedParentsForBackfill(maxItems: number): Promise<Block[]> {
    const blocks = []
    const subchain0 = this.status.progress.subchains[0]
    if (!this.status.linked && subchain0 !== undefined) {
      let next = subchain0.next
      for (let i = 0; i < maxItems; i++) {
        const tailBlock = await this.getBlockByHash(next)

        if (tailBlock === undefined) {
          break
        } else {
          blocks.push(tailBlock)
          next = tailBlock.header.parentHash
        }
      }
    }

    return blocks
  }

  /**
   * lookup and try backfill if skeleton already has blocks previously filled
   */
  async tryTailBackfill(): Promise<void> {
    let blocks: Block[]
    do {
      blocks = await this.getUnfinalizedParentsForBackfill(this.chain.config.maxPerRequest)
      if (blocks.length > 0) {
        await this.putBlocks(blocks)
      }
    } while (blocks.length > 0)
  }

  /**
   *
   */
  async blockingTailBackfillWithCutoff(maxItems: number): Promise<void> {
    const blocks = await this.getUnfinalizedParentsForBackfill(maxItems)
    if (blocks.length > 0) {
      // also skip the fill since a blocking fill might be attempted by forkchoiceUpdate
      await this.putBlocks(blocks, true)

      // if chain isn't linked and blocks requested were full then start a non blocking
      // fill
      if (!this.status.linked && blocks.length === maxItems) {
        void this.tryTailBackfill().catch((e) => {
          this.chain.config.logger.debug(`tryTailBackfill exited with error ${e}`)
        })
      }
    }
  }

  /**
   * Inserts skeleton blocks into canonical chain and runs execution.
   */
  async fillCanonicalChain() {
    if (this.filling) return
    this.filling = true

    let canonicalHead = this.chain.blocks.height
    const subchain = this.status.progress.subchains[0]!
    if (this.status.canonicalHeadReset) {
      if (subchain.tail > canonicalHead + BIGINT_1) {
        throw Error(
          `Canonical head should already be on or ahead subchain tail canonicalHead=${canonicalHead} tail=${subchain.tail}`,
        )
      }
      let newHead = subchain.tail - BIGINT_1
      if (newHead < BIGINT_0) {
        newHead = BIGINT_0
      }

      if (canonicalHead > BIGINT_0) {
        this.config.logger.debug(
          `Resetting canonicalHead for fillCanonicalChain from=${canonicalHead} to=${newHead}`,
        )
        canonicalHead = newHead
        await this.chain.resetCanonicalHead(canonicalHead)
      }
      // update in lock so as to not conflict/overwrite setHead/putBlock updates
      await this.runWithLock<void>(async () => {
        this.status.canonicalHeadReset = false
      })
    }

    const start = canonicalHead
    // This subchain is a reference to update the tail for the very subchain we are filling the data for
    this.config.logger.debug(
      `Starting canonical chain fill canonicalHead=${canonicalHead} subchainHead=${subchain.head}`,
    )

    // run till it has not been determined that tail reset is required by concurrent setHead calls
    // filling is switched on and off by fillCanonicalChain only so no need to monitor that
    let fillLogIndex = 0
    let skippedLogIndex = 0
    while (!this.status.canonicalHeadReset && canonicalHead < subchain.head) {
      // Get next block
      const number = canonicalHead + BIGINT_1
      const block = await this.getBlock(number)

      if (block === undefined) {
        // This can happen
        //   i) Only if canonicalHeadReset was flagged on causing skeleton to change its tail canonicality
        // Else we should back step and fetch again as it indicates some concurrency/db errors
        if (!this.status.canonicalHeadReset) {
          this.config.logger.debug(
            `fillCanonicalChain block number=${number} not found, backStepping...`,
          )
          await this.runWithLock<void>(async () => {
            // backstep the subchain from the block that was not found only if the canonicalHeadReset
            // has not been flagged or else the chain tail has already been reset by sethead
            await this.backStep(number)
          })
        } else {
          this.config.logger.debug(
            `fillCanonicalChain block number=${number} not found canonicalHeadReset=${this.status.canonicalHeadReset}, breaking out...`,
          )
        }
        break
      }

      // Insert into chain
      let numBlocksInserted = 0
      let numBlocksSkipped = 0
      // chain height has to be <= block number as we will skip putting this block as it might currently
      // cause chain reset. This can happen if any other async process added a batch of blocks like
      // execution's setHead. If that caused this chain to be not canonical anymore than the next
      // putBlocks should fail causing the fill to exit with skeleton stepback
      if (this.chain.blocks.height <= block.header.number) {
        try {
          numBlocksInserted = await this.chain.putBlocks([block], true)
          if (numBlocksInserted > 0) {
            this.fillStatus = {
              status: PutStatus.VALID,
              height: block.header.number,
              hash: block.hash(),
            }
          }
        } catch (e) {
          const validationError = `${e}`
          this.config.logger.error(`fillCanonicalChain putBlock error=${validationError}`)
          const errorMsg = `${validationError}`.toLowerCase()
          if (errorMsg.includes('block') && errorMsg.includes('not found')) {
            // see if backstepping is required ot this is just canonicalHeadReset
            await this.runWithLock<void>(async () => {
              if (!this.status.canonicalHeadReset) {
                this.config.logger.debug(
                  `fillCanonicalChain canonicalHeadReset=${this.status.canonicalHeadReset}, backStepping...`,
                )
                await this.backStep(number)
              } else {
                this.config.logger.debug(
                  `fillCanonicalChain canonicalHeadReset=${this.status.canonicalHeadReset}, breaking out...`,
                )
              }
            })
          } else {
            this.fillStatus = {
              status: PutStatus.INVALID,
              height: block.header.number,
              hash: block.hash(),
              validationError,
            }
          }
        }

        // handle insertion failures
        if (numBlocksInserted !== 1) {
          this.config.logger.error(
            `Failed to put block number=${number} fork=${block.common.hardfork()} hash=${short(
              block.hash(),
            )} parentHash=${short(block.header.parentHash)}from skeleton chain to canonical`,
          )
          // Lets log some parent by number and parent by hash, that may help to understand whats going on
          let parent = null
          try {
            parent = await this.chain.getBlock(number - BIGINT_1)
            this.config.logger.info(
              `ParentByNumber number=${parent?.header.number}, hash=${short(
                parent?.hash() ?? 'undefined',
              )} hf=${parent?.common.hardfork()}`,
            )
          } catch (e) {
            this.config.logger.error(`Failed to fetch parent of number=${number}`)
          }

          let parentWithHash = null
          try {
            parentWithHash = await this.chain.getBlock(block.header.parentHash)
            this.config.logger.info(
              `parentByHash number=${parentWithHash?.header.number}, hash=${short(
                parentWithHash?.hash() ?? 'undefined',
              )} hf=${parentWithHash?.common.hardfork()}  `,
            )
          } catch (e) {
            this.config.logger.error(
              `Failed to fetch parent with parentWithHash=${short(block.header.parentHash)}`,
            )
          }
          break
        }
      } else {
        numBlocksSkipped = 1
      }

      canonicalHead += BigInt(numBlocksInserted + numBlocksSkipped)
      fillLogIndex += numBlocksInserted
      skippedLogIndex += numBlocksSkipped
      // Delete skeleton block to clean up as we go, if block is fetched and chain is linked
      // it will be fetched from the chain without any issues
      //
      // however delete it in a lock as the parent lookup of a reorged block in skeleton is used
      // to determine if the tail is to be reset or not
      await this.runWithLock<void>(async () => {
        // there could be a race between new subchain creation and deletion of the block with the
        // tail of subchain so making sure we are in happy condition to go for deletion
        if (
          this.status.linked &&
          !this.status.canonicalHeadReset &&
          this.chain.blocks.height >= block.header.number
        ) {
          await this.deleteBlock(block)
        }
      })
      if (fillLogIndex >= this.config.numBlocksPerIteration) {
        this.config.logger.debug(
          `Skeleton canonical chain fill status: canonicalHead=${canonicalHead} chainHead=${this.chain.blocks.height} subchainHead=${subchain.head}`,
        )
        fillLogIndex = 0
      }
    }
    this.filling = false
    this.config.logger.debug(
      `Successfully put=${fillLogIndex} skipped (because already inserted)=${skippedLogIndex} blocks start=${start} end=${canonicalHead} skeletonHead=${subchain.head} from skeleton chain to canonical syncTargetHeight=${this.config.syncTargetHeight}`,
    )
  }

  serialize({
    hardfork,
    blockRLP,
  }: {
    hardfork: Hardfork | string
    blockRLP: Uint8Array
  }): Uint8Array {
    const skeletonArr = [utf8ToBytes(hardfork), blockRLP]
    return RLP.encode(skeletonArr)
  }

  deserialize(rlp: Uint8Array): { hardfork: Hardfork | string; blockRLP: Uint8Array } {
    const [hardfork, blockRLP] = RLP.decode(rlp) as Uint8Array[]
    return { hardfork: hardfork.toString(), blockRLP }
  }

  /**
   * Writes a skeleton block to the db by number
   */
  private async putBlock(block: Block, onlyUnfinalized: boolean = false): Promise<boolean> {
    // Serialize the block with its hardfork so that its easy to load the block latter
    const rlp = this.serialize({ hardfork: block.common.hardfork(), blockRLP: block.serialize() })
    await this.put(DBKey.SkeletonUnfinalizedBlockByHash, block.hash(), rlp)

    if (!onlyUnfinalized) {
      await this.put(DBKey.SkeletonBlock, bigIntToBytes(block.header.number), rlp)
      // this is duplication of the unfinalized blocks but for now an easy reference
      // will be pruned on finalization changes. this could be simplified and deduped
      // but will anyway will move into blockchain class and db on upcoming skeleton refactor
      await this.put(
        DBKey.SkeletonBlockHashToNumber,
        block.hash(),
        bigIntToBytes(block.header.number),
      )
    }

    return true
  }

  skeletonBlockRlpToBlock(skeletonBlockRlp: Uint8Array): Block {
    const { hardfork, blockRLP } = this.deserialize(skeletonBlockRlp)
    const common = this.config.chainCommon.copy()
    common.setHardfork(hardfork)

    const block = createBlockFromRLP(blockRLP, {
      common,
    })
    return block
  }

  /**
   * Gets a block from the skeleton or canonical db by number.
   */
  async getBlock(number: bigint, onlyCanonical = false): Promise<Block | undefined> {
    try {
      const skeletonBlockRlp = await this.get(DBKey.SkeletonBlock, bigIntToBytes(number))
      if (skeletonBlockRlp === null) {
        throw Error(`SkeletonBlock rlp lookup failed for ${number} onlyCanonical=${onlyCanonical}`)
      }
      return this.skeletonBlockRlpToBlock(skeletonBlockRlp)
    } catch {
      // If skeleton is linked, it probably has deleted the block and put it into the chain
      if (onlyCanonical && !this.status.linked) return undefined
      // As a fallback, try to get the block from the canonical chain in case it is available there
      try {
        return await this.chain.getBlock(number)
      } catch (error) {
        return undefined
      }
    }
  }

  /**
   * Gets a skeleton block from the db by hash
   */
  async getBlockByHash(
    hash: Uint8Array,
    onlyCanonical: boolean = false,
  ): Promise<Block | undefined> {
    const number = await this.get(DBKey.SkeletonBlockHashToNumber, hash)
    if (number) {
      const block = await this.getBlock(bytesToBigInt(number), onlyCanonical)
      if (block !== undefined && equalsBytes(block.hash(), hash)) {
        return block
      }
    }

    if (onlyCanonical === true && !this.status.linked) {
      return undefined
    }

    let block = onlyCanonical === false ? await this.getUnfinalizedBlock(hash) : undefined
    if (block === undefined && (onlyCanonical === false || this.status.linked)) {
      block = await this.chain.getBlock(hash).catch((_e) => undefined)
    }

    if (onlyCanonical === false) {
      return block
    } else {
      if (this.status.linked && block !== undefined) {
        const canBlock = await this.chain.getBlock(block.header.number).catch((_e) => undefined)
        if (canBlock !== undefined && equalsBytes(canBlock.hash(), block.hash())) {
          // block is canonical
          return block
        }
      }

      // no canonical block found or the block was not canonical
      return undefined
    }
  }

  async getUnfinalizedBlock(hash: Uint8Array): Promise<Block | undefined> {
    try {
      const skeletonBlockRlp = await this.get(DBKey.SkeletonUnfinalizedBlockByHash, hash)
      if (skeletonBlockRlp === null) {
        throw Error(`SkeletonUnfinalizedBlockByHash rlp lookup failed for hash=${short(hash)}`)
      }
      return this.skeletonBlockRlpToBlock(skeletonBlockRlp)
    } catch (_e) {
      return undefined
    }
  }

  /**
   * Deletes a skeleton block from the db by number
   */
  async deleteBlock(block: Block): Promise<boolean> {
    try {
      await this.delete(DBKey.SkeletonBlock, bigIntToBytes(block.header.number))
      await this.delete(DBKey.SkeletonBlockHashToNumber, block.hash())
      await this.delete(DBKey.SkeletonUnfinalizedBlockByHash, block.hash())
      return true
    } catch {
      return false
    }
  }

  /**
   *
   * TODO: complete the impl of pruning of blocks which got finalized and were non
   * canonical. canonical blocks anyway get deleted in deleteBlock
   */

  async pruneFinalizedNonCanonicalBlocks(): Promise<void> {
    return
  }

  logSyncStatus(
    logPrefix: string,
    {
      forceShowInfo,
      lastStatus,
      vmexecution,
      fetching,
      snapsync,
      peers,
    }: {
      forceShowInfo?: boolean
      lastStatus?: string
      vmexecution?: { running: boolean; started: boolean }
      fetching?: boolean
      snapsync?: SnapFetcherDoneFlags
      peers?: number | string
    } = {},
  ): string {
    const vmHead = this.chain.blocks.vm
    const subchain0 = this.status.progress.subchains[0]

    const isValid =
      vmHead !== undefined &&
      this.status.linked &&
      (vmHead?.header.number ?? BIGINT_0) === (subchain0?.head ?? BIGINT_0)

    // track for printing log because validation oscillates between multiple calls
    if (forceShowInfo === true) {
      if (isValid) {
        if (this.lastvalid === 0) {
          this.config.superMsg('Chain validation completed')
        }
        this.lastvalid = Date.now()
      } else {
        this.lastvalid = 0
      }
    }

    const isSynced =
      this.status.linked &&
      (this.chain.blocks.latest?.header.number ?? BIGINT_0) === (subchain0?.head ?? BIGINT_0)

    const status = isValid
      ? 'VALID'
      : isSynced
        ? vmexecution?.running === true
          ? `EXECUTING`
          : `SYNCED`
        : `SYNCING`

    if (peers === undefined || peers === 0) {
      this.lastsyncedAt = 0
    } else {
      if (
        status === 'SYNCING' &&
        lastStatus !== undefined &&
        (lastStatus !== status || this.lastsyncedAt === 0)
      ) {
        this.lastsyncedAt = Date.now()
      }
    }

    if (status !== 'EXECUTING') {
      this.lastexecutedAt = 0
    } else {
      if (this.lastexecutedAt === 0 || this.lastexecuted !== vmHead?.header.number) {
        this.lastexecutedAt = Date.now()
      }
      this.lastexecuted = vmHead?.header.number ?? BIGINT_0
    }

    if (status !== 'SYNCED') {
      this.syncedchain = 0
    } else {
      if (this.syncedchain === 0) {
        this.syncedchain = Date.now()
      }
    }

    if (fetching === false) {
      this.lastfetchedAt = 0
    } else if (fetching === true) {
      if (this.lastfetchedAt === 0 || subchain0.tail !== this.lastfetched) {
        this.lastfetchedAt = Date.now()
      }
      this.lastfetched = subchain0.tail
    }

    if (!this.filling) {
      this.lastfilledAt = 0
    } else {
      if (this.lastfilledAt === 0 || this.lastfilled !== this.chain.blocks.height) {
        this.lastfilledAt = Date.now()
      }
      this.lastfilled = this.chain.blocks.height
    }

    let extraStatus
    let scenario = ''
    switch (status) {
      case 'EXECUTING':
        scenario = Date.now() - this.lastexecutedAt > STALE_WINDOW ? 'execution stalled?' : ''
        extraStatus = ` (${scenario} vm=${vmHead?.header.number} cl=el=${this.chain.blocks.height})`
        break
      case 'SYNCED':
        if (vmexecution?.started === true) {
          scenario =
            Date.now() - this.syncedchain > STALE_WINDOW
              ? 'execution stalled?'
              : 'awaiting execution'
        } else if (snapsync !== undefined) {
          // stall detection yet to be added
          if (snapsync.done) {
            scenario = `snapsync-to-vm-transition=${
              (snapsync.snapTargetHeight ?? BIGINT_0) + this.config.snapTransitionSafeDepth
            }`
          } else {
            scenario = `snapsync target=${snapsync.snapTargetHeight}`
          }
        } else {
          scenario = 'execution none'
        }
        extraStatus = ` (${scenario} vm=${vmHead?.header.number} cl=el=${this.chain.blocks.height} )`
        break
      case 'SYNCING':
        if (this.filling) {
          scenario = Date.now() - this.lastfilledAt > STALE_WINDOW ? 'filling stalled?' : 'filling'
          extraStatus = ` (${scenario} | el=${this.chain.blocks.height} cl=${subchain0?.head})`
        } else {
          if (fetching === true) {
            scenario =
              Date.now() - this.lastfetchedAt > STALE_WINDOW ? 'backfill stalled?' : 'backfilling'
            extraStatus = ` (${scenario} tail=${subchain0.tail} | el=${this.chain.blocks.height} cl=${subchain0?.head})`
          } else {
            if (subchain0 === undefined) {
              scenario = 'awaiting fcu'
            } else if (peers === undefined || peers === 0) {
              scenario = 'awaiting peers'
            } else {
              if (Date.now() - this.lastFcuTime > STALE_WINDOW) {
                scenario = this.lastFcuTime === 0 ? `awaiting fcu` : `cl stalled?`
              } else {
                scenario =
                  Date.now() - this.lastsyncedAt > STALE_WINDOW ? `sync stalled?` : `awaiting sync`
              }
            }
            extraStatus = ` (${scenario} | el=${this.chain.blocks.height} cl=${subchain0?.head})`
          }
        }
        break

      // no additional status is needed on valid
      default:
        extraStatus = ''
    }
    const chainHead = `el=${this.chain.blocks.latest?.header.number ?? 'na'} hash=${short(
      this.chain.blocks.latest?.hash() ?? 'na',
    )}`

    forceShowInfo = forceShowInfo ?? false
    lastStatus = lastStatus ?? status

    if (forceShowInfo || status !== lastStatus) {
      let beaconSyncETA = 'na'
      if (!this.status.linked && subchain0 !== undefined) {
        // Print a progress report making the UX a bit nicer
        let left = this.bounds().tail - BIGINT_1 - this.chain.blocks.height
        if (this.status.linked) left = BIGINT_0
        if (left > BIGINT_0) {
          if (this.pulled !== BIGINT_0 && fetching === true) {
            const sinceStarted = (new Date().getTime() - this.started) / 1000
            beaconSyncETA = `${timeDuration((sinceStarted / Number(this.pulled)) * Number(left))}`
            this.config.logger.debug(
              `Syncing beacon headers downloaded=${this.pulled} left=${left} eta=${beaconSyncETA}`,
            )
          }
        }
      }

      let vmlogInfo
      let snapLogInfo
      let subchainLog = ''
      if (isValid) {
        vmlogInfo = `vm=cl=${chainHead}`
      } else {
        vmlogInfo = `vm=${vmHead?.header.number} hash=${short(vmHead?.hash() ?? 'na')} started=${
          vmexecution?.started
        }`

        if (vmexecution?.started === true) {
          vmlogInfo = `${vmlogInfo} executing=${vmexecution?.running}`
        } else {
          if (snapsync === undefined) {
            snapLogInfo = `snapsync=false`
          } else {
            const { snapTargetHeight, snapTargetRoot, snapTargetHash } = snapsync
            if (snapsync.done === true) {
              snapLogInfo = `snapsync=synced height=${snapTargetHeight} hash=${short(
                snapTargetHash ?? 'na',
              )} root=${short(snapTargetRoot ?? 'na')}`
            } else if (snapsync.syncing) {
              const accountsDone = formatBigDecimal(
                snapsync.accountFetcher.first * BIGINT_100,
                BIGINT_2EXP256,
                BIGINT_100,
              )
              const storageReqsDone = formatBigDecimal(
                snapsync.storageFetcher.first * BIGINT_100,
                snapsync.storageFetcher.count,
                BIGINT_100,
              )
              const codeReqsDone = formatBigDecimal(
                snapsync.byteCodeFetcher.first * BIGINT_100,
                snapsync.byteCodeFetcher.count,
                BIGINT_100,
              )

              const snapprogress = `accounts=${accountsDone}% storage=${storageReqsDone}% of ${snapsync.storageFetcher.count} codes=${codeReqsDone}% of ${snapsync.byteCodeFetcher.count}`

              let stage = 'snapsync=??'
              stage = `snapsync=accounts`
              // move the stage along
              if (snapsync.accountFetcher.done === true) {
                stage = `snapsync=storage&codes`
              }
              if (snapsync.storageFetcher.done === true && snapsync.byteCodeFetcher.done === true) {
                stage = `snapsync=trienodes`
              }
              if (snapsync.trieNodeFetcher.done === true) {
                stage = `finished`
              }

              snapLogInfo = `${stage} ${snapprogress} (hash=${short(
                snapTargetHash ?? 'na',
              )} root=${short(snapTargetRoot ?? 'na')})`
            } else {
              if (this.synchronized) {
                snapLogInfo = `snapsync=??`
              } else {
                snapLogInfo = `snapsync awaiting cl synchronization`
              }
            }
          }
        }

        // if not synced add subchain info
        if (!isSynced) {
          const subchainLen = this.status.progress.subchains.length
          subchainLog = `subchains(${subchainLen}) linked=${
            this.status.linked
          } ${this.status.progress.subchains
            // if info log show only first subchain to be succinct
            .slice(0, 1)
            .map((s) => `[tail=${s.tail} head=${s.head} next=${short(s.next)}]`)
            .join(',')}${subchainLen > 1 ? '…' : ''} ${
            beaconSyncETA !== undefined ? 'eta=' + beaconSyncETA : ''
          } reorgsHead=${
            this.status.canonicalHeadReset &&
            (subchain0?.tail ?? BIGINT_0) <= this.chain.blocks.height
          } synchronized=${this.synchronized}`
        }
      }
      peers = peers !== undefined ? `${peers}` : 'na'

      // if valid then the status info is short and sweet
      this.config.logger.info('')
      if (isValid) {
        this.config.logger.info(`${logPrefix} ${status}${extraStatus} ${vmlogInfo} peers=${peers}`)
      } else {
        // else break into two
        this.config.logger.info(
          `${logPrefix} ${status}${extraStatus} synchronized=${this.config.synchronized} peers=${peers}`,
        )
        if (snapLogInfo !== undefined && snapLogInfo !== '') {
          this.config.logger.info(`${logPrefix} ${snapLogInfo}`)
        }
        if (vmlogInfo !== undefined && vmlogInfo !== '') {
          this.config.logger.info(`${logPrefix} ${vmlogInfo}`)
        }
        if (!isSynced) {
          this.config.logger.info(`${logPrefix} ${subchainLog}`)
        }
      }
    } else {
      this.config.logger.debug(
        `${logPrefix} ${status} linked=${
          this.status.linked
        } subchains=${this.status.progress.subchains
          .map((s) => `[tail=${s.tail} head=${s.head} next=${short(s.next)}]`)
          .join(',')} reset=${this.status.canonicalHeadReset} ${chainHead}`,
      )
    }
    return status
  }

  /**
   * Writes the {@link SkeletonStatus} to db
   */
  private async writeSyncStatus(): Promise<boolean> {
    this.logSyncStatus('Writing')
    const encodedStatus = this.statusToRLP()
    await this.put(DBKey.SkeletonStatus, new Uint8Array(0), encodedStatus)
    return true
  }

  /**
   * Reads the {@link SkeletonStatus} from db
   */
  private async getSyncStatus(): Promise<SkeletonStatus | undefined> {
    const rawStatus = await this.get(DBKey.SkeletonStatus, new Uint8Array(0))
    if (!rawStatus) return
    const status = this.statusRLPtoObject(rawStatus)
    this.status = status

    const { safe, finalized } = this.status
    this.safeBlock = await this.getBlock(safe, true)
    this.finalizedBlock = await this.getBlock(finalized, true)

    return status
  }

  /**
   * Encodes a {@link SkeletonStatus} to RLP for saving to the db
   */
  private statusToRLP(): Uint8Array {
    const subchains: SkeletonSubchainRLP[] = this.status.progress.subchains.map((subchain) => [
      bigIntToBytes(subchain.head),
      bigIntToBytes(subchain.tail),
      subchain.next,
    ])
    return RLP.encode([
      subchains,
      // linked
      intToBytes(this.status.linked ? 1 : 0),
      // canonicalHeadReset
      intToBytes(this.status.canonicalHeadReset ? 1 : 0),
      // safe and finalized
      bigIntToBytes(this.status.safe),
      bigIntToBytes(this.status.finalized),
    ])
  }

  /**
   * Decodes an RLP encoded {@link SkeletonStatus}
   */
  private statusRLPtoObject(serializedStatus: Uint8Array): SkeletonStatus {
    const status: SkeletonStatus = {
      progress: { subchains: [] },
      linked: false,
      canonicalHeadReset: true,
      safe: BIGINT_0,
      finalized: BIGINT_0,
    }
    const rawStatus = RLP.decode(serializedStatus) as unknown as [
      SkeletonSubchainRLP[],
      Uint8Array,
      Uint8Array,
      // safe and finalized
      Uint8Array,
      Uint8Array,
    ]
    const subchains: SkeletonSubchain[] = rawStatus[0].map((raw) => ({
      head: bytesToBigInt(raw[0]),
      tail: bytesToBigInt(raw[1]),
      next: raw[2],
    }))
    status.progress.subchains = subchains
    status.linked = bytesToInt(rawStatus[1]) === 1
    status.canonicalHeadReset = bytesToInt(rawStatus[2]) === 1
    status.safe = bytesToBigInt(rawStatus[3])
    status.finalized = bytesToBigInt(rawStatus[4])
    return status
  }
}
