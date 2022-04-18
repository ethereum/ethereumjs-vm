import { Fetcher, FetcherOptions } from './fetcher'
import { BN } from 'ethereumjs-util'
import { Chain } from '../../blockchain'

export interface BlockFetcherOptions extends FetcherOptions {
  /* Blockchain */
  chain: Chain

  /* Block number to start fetching from */
  first: BN

  /* How many blocks to fetch */
  count: BN

  /* Destroy fetcher once all tasks are done */
  destroyWhenDone?: boolean
}

export type JobTask = {
  first: BN
  count: number
}

export abstract class BlockFetcherBase<JobResult, StorageItem> extends Fetcher<
  JobTask,
  JobResult,
  StorageItem
> {
  protected chain: Chain
  protected first: BN
  protected count: BN
  height: BN

  /**
   * Create new block fetcher
   */
  constructor(options: BlockFetcherOptions) {
    super(options)

    this.chain = options.chain
    this.first = options.first
    this.count = options.count
    this.height = this.first?.add(this.count).subn(1)
    this.debug(
      `Block fetcher instantiated interval=${this.interval} first=${this.first} count=${this.count} destroyWhenDone=${this.destroyWhenDone}`
    )
  }

  /**
   * Generate list of tasks to fetch
   */
  tasks(first = this.first, count = this.count, maxTasks = Infinity): JobTask[] {
    const max = this.config.maxPerRequest
    const tasks: JobTask[] = []
    let debugStr = `first=${first}`
    const pushedCount = new BN(0)

    while (count.gten(max) && tasks.length < maxTasks) {
      tasks.push({ first: first.clone(), count: max })
      first.iaddn(max)
      count.isubn(max)
      pushedCount.iaddn(max)
    }
    if (count.gtn(0) && tasks.length < maxTasks) {
      tasks.push({ first: first.clone(), count: count.toNumber() })
      pushedCount.iadd(count)
    }
    debugStr = `${debugStr} count=${pushedCount}`
    this.debug(`Created new tasks num=${tasks.length} ${debugStr}`)
    return tasks
  }

  nextTasks(): void {
    if (this.in.length === 0 && this.count.gten(0)) {
      this.debug(`Fetcher has pendancy with first=${this.first} count=${this.count}`)
      const tasks = this.tasks(this.first, this.count, this.config.maxFetcherJobs)
      for (const task of tasks) {
        this.enqueueTask(task)
      }
      this.debug(`Enqueued num=${tasks.length} tasks`)
    }
  }

  /**
   * Create new tasks based on a provided list of block numbers.
   *
   * If numbers are sequential the request is created as bulk request.
   *
   * If there are no tasks in the fetcher and `min` is behind head,
   * inserts the requests for the missing blocks first.
   *
   * @param numberList List of block numbers
   * @param min Start block number
   */
  enqueueByNumberList(numberList: BN[], min: BN) {
    const nextChainHeight = this.chain.headers.height.addn(1)
    if (this.in.length === 0 && nextChainHeight.lt(min)) {
      // If fetcher queue is empty and head is behind `min`,
      // enqueue tasks for missing block numbers so head can reach `min`
      this.debug(`Enqueuing missing blocks between chain head and newBlockHashes...`)
      const tasks = this.tasks(nextChainHeight, min.sub(nextChainHeight))
      for (const task of tasks) {
        this.enqueueTask(task)
      }
    }
    const numBlocks = numberList.length
    let bulkRequest = true
    const seqCheckNum = min.clone()
    for (let num = 1; num <= numBlocks; num++) {
      if (!numberList.map((num) => num.toString()).includes(seqCheckNum.toString())) {
        bulkRequest = false
        break
      }
      seqCheckNum.iaddn(1)
    }

    if (bulkRequest) {
      this.enqueueTask(
        {
          first: min,
          count: numBlocks,
        },
        true
      )
    } else {
      numberList.forEach((first) => {
        this.enqueueTask(
          {
            first,
            count: 1,
          },
          true
        )
      })
    }
    this.debug(
      `Enqueued tasks by number list num=${numberList.length} min=${min} bulkRequest=${bulkRequest}`
    )
  }
}
