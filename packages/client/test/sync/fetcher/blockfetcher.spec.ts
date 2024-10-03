import { createBlockHeader } from '@ethereumjs/block'
import { Hardfork } from '@ethereumjs/common'
import { KECCAK256_RLP } from '@ethereumjs/util'
import { assert, describe, it, vi } from 'vitest'

import { Chain } from '../../../src/blockchain/chain.js'
import { Config } from '../../../src/config.js'
import { Event } from '../../../src/types.js'
import { wait } from '../../integration/util.js'
class PeerPool {
  idle() {}
  ban() {}
}
PeerPool.prototype.idle = vi.fn()
PeerPool.prototype.ban = vi.fn()

const { BlockFetcher } = await import('../../../src/sync/fetcher/blockfetcher.js')

describe('[BlockFetcher]', async () => {
  it('should start/stop', async () => {
    const config = new Config({ maxPerRequest: 5 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(1),
      count: BigInt(10),
      timeout: 5,
    })
    fetcher.next = () => false
    assert.notOk((fetcher as any).running, 'not started')
    void fetcher.fetch()
    assert.equal((fetcher as any).in.length, 2, 'added 2 tasks')
    await wait(100)
    assert.ok((fetcher as any).running, 'started')
    fetcher.destroy()
    await wait(100)
    assert.notOk((fetcher as any).running, 'stopped')
  })

  it('enqueueByNumberList()', async () => {
    const config = new Config({ maxPerRequest: 5 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(1),
      count: BigInt(10),
      timeout: 5,
    })
    void fetcher.fetch()
    assert.equal((fetcher as any).in.length, 2, 'added 2 tasks')
    await wait(100)

    let blockNumberList = [BigInt(11), BigInt(12)]
    let min = BigInt(11)
    let max = BigInt(12)
    fetcher.enqueueByNumberList(blockNumberList, min, max)

    assert.equal((fetcher as any).in.length, 3, '1 new task for two subsequent block numbers')

    blockNumberList = [BigInt(13), BigInt(15)]
    min = BigInt(13)
    max = BigInt(15)
    fetcher.enqueueByNumberList(blockNumberList, min, max)
    assert.equal((fetcher as any).in.length, 3, 'no new task added only the height changed')
    assert.equal(
      fetcher.first + fetcher.count - BigInt(1) === BigInt(15),
      true,
      'height should now be 15',
    )

    // Clear fetcher queue for next test of gap when following head
    fetcher.clear()
    blockNumberList = [BigInt(50), BigInt(51)]
    min = BigInt(50)
    max = BigInt(51)
    fetcher.enqueueByNumberList(blockNumberList, min, max)
    assert.equal(
      (fetcher as any).in.length,
      11,
      '10 new tasks to catch up to head (1-49, 5 per request), 1 new task for subsequent block numbers (50-51)',
    )

    fetcher.destroy()
  })

  it('should process', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(0),
      count: BigInt(0),
    })
    const blocks: any = [{ header: { number: 1 } }, { header: { number: 2 } }]
    assert.deepEqual(fetcher.process({ task: { count: 2 } } as any, blocks), blocks, 'got results')
    assert.notOk(
      fetcher.process({ task: { count: 2 } } as any, { blocks: [] } as any),
      'bad results',
    )
  })

  it('should adopt correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(0),
      count: BigInt(0),
    })
    const blocks: any = [{ header: { number: 1 } }, { header: { number: 2 } }]
    const task = { count: 3, first: BigInt(1) }
    ;(fetcher as any).running = true
    fetcher.enqueueTask(task)
    const job = (fetcher as any).in.peek()
    let results = fetcher.process(job as any, blocks)
    assert.equal((fetcher as any).in.length, 1, 'Fetcher should still have same job')
    assert.equal(job?.partialResult?.length, 2, 'Should have two partial results')
    assert.equal(results, undefined, 'Process should not return full results yet')

    const remainingBlocks: any = [{ header: { number: 3 } }]
    results = fetcher.process(job as any, remainingBlocks)
    assert.equal(results?.length, 3, 'Should return full results')
  })

  it('should find a fetchable peer', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    pool.idle = vi.fn(() => {
      return 'peer0'
    })
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(0),
      count: BigInt(0),
    })
    assert.equal(fetcher.peer(), 'peer0' as any, 'found peer')
  })

  it('should request correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(0),
      count: BigInt(0),
    })
    const partialResult: any = [{ header: { number: 1 } }, { header: { number: 2 } }]

    const task = { count: 3, first: BigInt(1) }
    const peer = {
      eth: {
        getBlockBodies: vi.fn(),
        getBlockHeaders: vi.fn((input) => {
          const expected = {
            block: task.first + BigInt(partialResult.length),
            max: task.count - partialResult.length,
            reverse: false,
          }
          assert.deepEqual(input, expected)
        }),
      },
      id: 'random',
      address: 'random',
      latest: vi.fn(),
    }
    const job = { peer, partialResult, task }
    await fetcher.request(job as any)
  })

  it('should parse bodies correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    config.chainCommon.getHardforkBy = vi.fn((input) => {
      if (input['blockNumber'] !== undefined && input['timestamp'] !== undefined)
        return Hardfork.Shanghai

      if (input['blockNumber'] !== undefined) return Hardfork.Shanghai

      if (input['blockNumber'] !== undefined && input['timestamp'] !== undefined)
        return Hardfork.Shanghai
      throw new Error('unknown hardfork')
    })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const fetcher = new BlockFetcher({
      config,
      pool,
      chain,
      first: BigInt(0),
      count: BigInt(0),
    })

    const shanghaiHeader = createBlockHeader(
      { number: 1, withdrawalsRoot: KECCAK256_RLP },
      { common: config.chainCommon, setHardfork: true },
    )

    const task = { count: 1, first: BigInt(1) }
    const peer = {
      eth: {
        getBlockBodies: vi.fn(() => {
          return [0, [[[], [], []]]]
        }),
        getBlockHeaders: vi.fn(() => {
          return [0, [shanghaiHeader]]
        }),
      },
      id: 'random',
      address: 'random',
      latest: vi.fn(),
    }
    const job = { peer, task }
    const resp = await fetcher.request(job as any)
    assert.equal(resp.length, 1, 'shanghai block should have been returned')
    assert.equal(resp[0].withdrawals?.length, 0, 'should have withdrawals array')
  })
})
describe('store()', async () => {
  const config = new Config({ maxPerRequest: 5 })
  const pool = new PeerPool() as any
  const chain = await Chain.create({ config })
  const fetcher = new BlockFetcher({
    config,
    pool,
    chain,
    first: BigInt(1),
    count: BigInt(10),
    timeout: 5,
  })
  it('should error', async () => {
    chain.putBlocks = vi.fn().mockRejectedValueOnce(new Error('could not find parent header'))
    try {
      await fetcher.store([])
      assert.fail('fetcher store should have errored')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(err.message, 'could not find parent header', 'store() threw on invalid block')
      const { destroyFetcher, banPeer } = fetcher.processStoreError(err, {
        first: BigInt(1),
        count: 10,
      })
      assert.equal(destroyFetcher, false, 'fetcher should not be destroyed on this error')
      assert.equal(banPeer, true, 'peer should be banned on this error')
    }
  })
  chain.putBlocks = vi.fn().mockResolvedValueOnce(1)
  config.events.on(Event.SYNC_FETCHED_BLOCKS, () =>
    it('should emit fetched blocks event', () => {
      assert.ok(true, 'store() emitted SYNC_FETCHED_BLOCKS event on putting blocks')
    }),
  )
  await fetcher.store([])
})
