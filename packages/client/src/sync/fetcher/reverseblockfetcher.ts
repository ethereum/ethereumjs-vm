import { BIGINT_0 } from '@ethereumjs/util'

import { errSyncMerged } from '../../service/skeleton.js'
import { Event } from '../../types.js'

import { BlockFetcher } from './blockfetcher.js'

import type { Skeleton } from '../../service/skeleton.js'
import type { BlockFetcherOptions, JobTask } from './blockfetcherbase.js'
import type { Block } from '@ethereumjs/block'

interface ReverseBlockFetcherOptions extends BlockFetcherOptions {
  /** Skeleton */
  skeleton: Skeleton
}

/**
 * Implements an eth/66 based reverse block fetcher
 * @memberof module:sync/fetcher
 */
export class ReverseBlockFetcher extends BlockFetcher {
  private skeleton: Skeleton

  /**
   * Create new block fetcher
   */
  constructor(options: ReverseBlockFetcherOptions) {
    super({ ...options, reverse: true })
    this.skeleton = options.skeleton
  }

  /**
   * Store fetch result. Resolves once store operation is complete.
   * @param blocks fetch result
   */
  async store(blocks: Block[]) {
    try {
      const num = await this.skeleton.putBlocks(blocks)
      this.DEBUG &&
        this.debug(
          `Fetcher results stored in skeleton chain (blocks num=${blocks.length} first=${
            blocks[0]?.header.number
          } last=${blocks[blocks.length - 1]?.header.number})`,
        )
      this.config.events.emit(Event.SYNC_FETCHED_BLOCKS, blocks.slice(0, num))
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      if (e === errSyncMerged) {
        // Tear down the syncer to restart from new subchain segments
        this.DEBUG && this.debug('Skeleton subchains merged, restarting sync')
        this.running = false
        this.clear()
        this.destroy()
      } else {
        this.DEBUG &&
          this.debug(
            `Error storing fetcher results in skeleton chain (blocks num=${blocks.length} first=${
              blocks[0]?.header.number
            } last=${blocks[blocks.length - 1]?.header.number}): ${e}`,
          )
        throw e
      }
    }
  }

  processStoreError(
    error: Error,
    _task: JobTask,
  ): { destroyFetcher: boolean; banPeer: boolean; stepBack: bigint } {
    const stepBack = BIGINT_0
    const destroyFetcher = !(error.message as string).includes(
      `Blocks don't extend canonical subchain`,
    )
    const banPeer = true
    return { destroyFetcher, banPeer, stepBack }
  }
}
