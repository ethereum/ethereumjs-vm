import { assert, describe, expect, it, vi } from 'vitest'

import { Chain } from '../../../src/blockchain/index.js'
import { Config } from '../../../src/config.js'
import { Event } from '../../../src/types.js'

class PeerPool {
  idle() {}
  ban() {}
}
PeerPool.prototype.idle = vi.fn()
PeerPool.prototype.ban = vi.fn()
vi.mock('../../src/net/peerpool.js', () => {
  return PeerPool
})

const { HeaderFetcher } = await import('../../../src/sync/fetcher/headerfetcher.js')
describe('[HeaderFetcher]', async () => {
  it('should process', () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool()
    const flow = { handleReply: vi.fn() }
    const fetcher = new HeaderFetcher({ config, pool, flow })
    const headers = [{ number: 1 }, { number: 2 }]
    assert.deepEqual(
      fetcher.process(
        { task: { count: 2 }, peer: 'peer0' } as any,
        { headers, bv: BigInt(1) } as any,
      ),
      headers as any,
      'got results',
    )
    assert.notOk(
      fetcher.process({ task: { count: 2 } } as any, { headers: [], bv: BigInt(1) } as any),
      'bad results',
    )
    expect((fetcher as any).flow.handleReply).toHaveBeenCalledWith('peer0', 1)
  })

  it('should adopt correctly', () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const flow = { handleReply: vi.fn() }
    const fetcher = new HeaderFetcher({
      config,
      pool,
      flow,
    })
    const headers = [{ number: 1 }, { number: 2 }]
    const task = { count: 3, first: BigInt(1) }
    ;(fetcher as any).running = true
    fetcher.enqueueTask(task)
    const job = (fetcher as any).in.peek()

    let results = fetcher.process(job as any, { headers, bv: BigInt(1) } as any)
    assert.equal((fetcher as any).in.length, 1, 'Fetcher should still have same job')
    assert.equal(job?.partialResult?.length, 2, 'Should have two partial results')
    assert.equal(results, undefined, 'Process should not return full results yet')

    const remainingHeaders: any = [{ number: 3 }]
    results = fetcher.process(job as any, { headers: remainingHeaders, bv: BigInt(1) } as any)
    assert.equal(results?.length, 3, 'Should return full results')
  })

  it('should find a fetchable peer', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool()
    const fetcher = new HeaderFetcher({ config, pool })
    ;(fetcher as any).pool.idle.mockReturnValueOnce('peer0')
    assert.equal(fetcher.peer(), 'peer0' as any, 'found peer')
  })

  it('should request correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const flow = { handleReply: vi.fn(), maxRequestCount: vi.fn() }
    const fetcher = new HeaderFetcher({
      config,
      pool,
      flow,
    })
    const partialResult = [{ number: 1 }, { number: 2 }]
    const task = { count: 3, first: BigInt(1) }
    const peer = {
      les: { getBlockHeaders: vi.fn() },
      id: 'random',
      address: 'random',
      latest: vi.fn(),
    }
    const job = { peer, partialResult, task }
    await fetcher.request(job as any)
    expect(job.peer.les.getBlockHeaders).toHaveBeenCalledWith({
      block: job.task.first + BigInt(partialResult.length),
      max: job.task.count - partialResult.length,
      reverse: false,
    })
  })
})
describe('store()', async () => {
  const config = new Config({ maxPerRequest: 5 })
  const pool = new PeerPool() as any
  const chain = await Chain.create({ config })
  const fetcher = new HeaderFetcher({
    config,
    pool,
    chain,
    first: BigInt(1),
    count: BigInt(10),
    timeout: 5,
  })
  it('should handle bad header', async () => {
    chain.putHeaders = vi.fn((input) => {
      if (input[0] === 0) throw new Error('err0')
    }) as any
    try {
      await fetcher.store([0 as any])
      assert.fail('should fail')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(err.message, 'err0', 'store() threw on invalid header')
    }
  })

  chain.putHeaders = vi.fn((input) => {
    if (input[0] === 1) return 1
  }) as any
  config.events.on(Event.SYNC_FETCHED_HEADERS, () =>
    it('should emit event on put headers', () => {
      assert.ok(true, 'store() emitted SYNC_FETCHED_HEADERS event on putting headers')
    }),
  )
  await fetcher.store([1 as any])
})
