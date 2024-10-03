import { createBlock } from '@ethereumjs/block'
import * as td from 'testdouble'
import { assert, describe, it, vi } from 'vitest'

import { Chain } from '../../src/blockchain/index.js'
import { Config } from '../../src/config.js'
import { Event } from '../../src/types.js'
import { wait } from '../integration/util.js'

describe('[FullSynchronizer]', async () => {
  const txPool: any = { removeNewBlockTxs: () => {}, checkRunState: () => {} }
  const execution: any = { run: () => {} }
  class PeerPool {
    open() {}
    close() {}
    idle() {}
    ban(_peer: any) {}
  }
  PeerPool.prototype.open = vi.fn()
  PeerPool.prototype.close = vi.fn()
  PeerPool.prototype.idle = vi.fn()
  class BlockFetcher {
    fetch() {}
    clear() {}
    destroy() {}
  }
  BlockFetcher.prototype.fetch = vi.fn()
  BlockFetcher.prototype.clear = vi.fn()
  BlockFetcher.prototype.destroy = vi.fn()
  vi.doMock('../../src/sync/fetcher/index.js', () => {
    return {
      default: () => ({ BlockFetcher }),
    }
  })

  const { FullSynchronizer } = await import('../../src/sync/fullsync.js')

  it('should initialize correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({ config, pool, chain, txPool, execution })
    assert.equal(sync.type, 'full', 'full type')
  })

  it('should open', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({
      config,
      pool,
      chain,
      txPool,
      execution,
    })
    ;(sync as any).pool.open = vi.fn().mockResolvedValue(null)
    ;(sync as any).pool.peers = []
    await sync.open()
    assert.ok(true, 'opened')
    await sync.close()
  })

  it('should get height', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({ config, pool, chain, txPool, execution })
    const peer = {
      eth: {
        getBlockHeaders: vi.fn((input) => {
          const headers = [{ number: BigInt(5) }]
          if (JSON.stringify(input) === JSON.stringify({ block: 'hash', max: 1 }))
            return [BigInt(1), headers]
        }),
        status: { bestHash: 'hash' },
      },
      latest: async () => {
        return {
          number: BigInt(5),
          hash: () => new Uint8Array(0),
        }
      },
    }
    const latest = await peer.latest()
    assert.equal(latest!.number, BigInt(5), 'got height')
    await sync.stop()
    await sync.close()
  })

  it('should find best', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
      txPool,
      execution,
    })
    ;(sync as any).running = true
    const peers = [
      { eth: { status: { td: BigInt(1) } }, inbound: false },
      { eth: { status: { td: BigInt(2) } }, inbound: false },
    ]
    ;(sync as any).height = vi.fn((input) => {
      if (JSON.stringify(input) === JSON.stringify(peers[0]))
        return Promise.resolve(peers[0].eth.status.td)
      if (JSON.stringify(input) === JSON.stringify(peers[1]))
        return Promise.resolve(peers[1].eth.status.td)
    })
    ;(sync as any).chain = { blocks: { td: BigInt(1) } }
    ;(sync as any).pool = { peers }
    ;(sync as any).forceSync = true
    assert.equal(await sync.best(), <any>peers[1], 'found best')
    await sync.stop()
    await sync.close()
  })

  it('should sync', async () => {
    const config = new Config({
      accountCache: 10000,
      storageCache: 1000,
      safeReorgDistance: 0,
    })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
      txPool,
      execution,
    })
    sync.best = td.func<(typeof sync)['best']>()
    td.when(sync.best()).thenResolve({
      les: { status: { headNum: BigInt(2) } },
      latest: () => {
        return {
          number: BigInt(2),
          hash: () => new Uint8Array(0),
        }
      },
    } as any)
    let count = 0
    BlockFetcher.prototype.fetch = vi.fn(async () => {
      if (count < 2) {
        count--
        await wait(2000)
        return undefined
      } else {
        throw new Error('stubbed function called more than twice')
      }
    })
    ;(sync as any).chain = { blocks: { height: BigInt(3) } }
    assert.notOk(await sync.sync(), 'local height > remote height')
    ;(sync as any).chain = {
      blocks: { height: BigInt(0) },
    }
    setTimeout(() => {
      config.events.emit(Event.SYNC_SYNCHRONIZED, BigInt(0))
    }, 100)
    assert.ok(await sync.sync(), 'local height < remote height')
    BlockFetcher.prototype.fetch = vi.fn().mockRejectedValue(new Error('err0'))
    try {
      await sync.sync()
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(err.message, 'err0', 'got error')
      await sync.stop()
      await sync.close()
    }
  })

  it('should send NewBlock/NewBlockHashes to right peers', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
      txPool,
      execution,
    })
    ;(sync as any)._fetcher = {
      enqueueByNumberList: (blockNumberList: bigint[], min: bigint) => {
        assert.equal(blockNumberList[0], BigInt(0), 'enqueueing the correct block in the Fetcher')
        assert.equal(blockNumberList.length, 1, 'correct number of blocks enqueued in Fetcher')
        assert.equal(min, BigInt(0), 'correct start block number in Fetcher')
      },
    }
    Object.defineProperty(sync, 'fetcher', {
      get() {
        return this._fetcher
      },
    })

    let timesSentToPeer2 = 0
    const peers = [
      {
        id: 'Peer 1',
        eth: {
          status: { td: BigInt(1) },
          send(name: string) {
            assert.equal(name, 'NewBlock', 'sent NewBlock to Peer 1')
          },
        },
        inbound: false,
      },
      {
        id: 'Peer 2',
        eth: {
          status: { td: BigInt(2) },
          send(name: string) {
            assert.equal(name, 'NewBlockHashes', 'sent NewBlockHashes to Peer 2')
            timesSentToPeer2++
          },
        },
        inbound: false,
      },
      {
        id: 'Peer 3',
        eth: {
          status: { td: BigInt(3) },
          send() {
            assert.fail('should not send announcement to peer3')
          },
        },
        inbound: false,
      },
    ]
    ;(sync as any).pool = { peers }

    const chainTip = createBlock({
      header: {},
    })
    const newBlock = createBlock({
      header: {
        parentHash: chainTip.hash(),
      },
    })
    chain.getCanonicalHeadBlock = vi.fn()
    chain.putBlocks = vi.fn((input) => {
      assert.ok(
        JSON.stringify(input) === JSON.stringify([newBlock]),
        'putBlocks is called as expected',
      )
    }) as any
    // NewBlock message from Peer 3
    await sync.handleNewBlock(newBlock, peers[2] as any)

    assert.equal(config.syncTargetHeight, BigInt(0), 'sync target height should be set to 0')
    await sync.handleNewBlock(newBlock)
    assert.equal(timesSentToPeer2, 1, 'sent NewBlockHashes to Peer 2 once')
    assert.ok(true, 'did not send NewBlock to Peer 3')
    ;(sync as any).chain._blocks = {
      latest: chainTip,
    }
    ;(sync as any).newBlocksKnownByPeer.delete(peers[0].id)
    await sync.handleNewBlock(newBlock, peers[2] as any)
  })

  it('should process blocks', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
      txPool,
      execution,
    })

    const chainTip = createBlock({
      header: {},
    })
    const newBlock = createBlock({
      header: {
        parentHash: chainTip.hash(),
      },
    })

    sync.running = true
    assert.ok(await sync.processBlocks([newBlock]), 'should successfully process blocks')
  })
})
