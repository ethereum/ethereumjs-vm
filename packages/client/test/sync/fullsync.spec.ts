import tape from 'tape-catch'
import td from 'testdouble'
import { BN } from 'ethereumjs-util'
import { Config } from '../../lib/config'
import { Chain } from '../../lib/blockchain'
import { Event } from '../../lib/types'
import { Block } from '@ethereumjs/block'

tape('[FullSynchronizer]', async (t) => {
  class PeerPool {
    open() {}
    close() {}
  }
  PeerPool.prototype.open = td.func<any>()
  PeerPool.prototype.close = td.func<any>()
  td.replace('../../lib/net/peerpool', { PeerPool })
  class BlockFetcher {
    fetch() {}
  }
  BlockFetcher.prototype.fetch = td.func<any>()
  td.replace('../../lib/sync/fetcher/blockfetcher', { BlockFetcher })

  const { FullSynchronizer } = await import('../../lib/sync/fullsync')

  t.test('should initialize correctly', async (t) => {
    const config = new Config({ loglevel: 'error', transports: [] })
    const pool = new PeerPool() as any
    const chain = new Chain({ config })
    const sync = new FullSynchronizer({ config, pool, chain })
    t.equals(sync.type, 'full', 'full type')
    t.end()
  })

  t.test('should open', async (t) => {
    const config = new Config({ loglevel: 'error', transports: [] })
    const pool = new PeerPool() as any
    const chain = new Chain({ config })
    const sync = new FullSynchronizer({
      config,
      pool,
      chain,
    })
    ;(sync as any).pool.open = td.func<PeerPool['open']>()
    ;(sync as any).pool.peers = []
    td.when((sync as any).pool.open()).thenResolve(null)
    await sync.open()
    t.pass('opened')
    await sync.close()
    t.end()
  })

  t.test('should get height', async (t) => {
    const config = new Config({ loglevel: 'error', transports: [] })
    const pool = new PeerPool() as any
    const chain = new Chain({ config })
    const sync = new FullSynchronizer({ config, pool, chain })
    const peer = { eth: { getBlockHeaders: td.func(), status: { bestHash: 'hash' } } }
    const headers = [{ number: new BN(5) }]
    td.when(peer.eth.getBlockHeaders({ block: 'hash', max: 1 })).thenResolve([new BN(1), headers])
    const latest = await sync.latest(peer as any)
    t.ok(latest!.number.eqn(5), 'got height')
    await sync.close()
    t.end()
  })

  t.test('should find best', async (t) => {
    const config = new Config({ loglevel: 'error', transports: [] })
    const pool = new PeerPool() as any
    const chain = new Chain({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
    })
    ;(sync as any).running = true
    ;(sync as any).height = td.func()
    ;(sync as any).chain = { blocks: { td: new BN(1) } }
    const peers = [
      { eth: { status: { td: new BN(1) } }, inbound: false },
      { eth: { status: { td: new BN(2) } }, inbound: false },
    ]
    ;(sync as any).pool = { peers }
    ;(sync as any).forceSync = true
    td.when((sync as any).height(peers[0])).thenDo((peer: any) =>
      Promise.resolve(peer.eth.status.td)
    )
    td.when((sync as any).height(peers[1])).thenDo((peer: any) =>
      Promise.resolve(peer.eth.status.td)
    )
    t.equals(sync.best(), peers[1], 'found best')
    await sync.close()
    t.end()
  })

  t.test('should sync', async (t) => {
    t.plan(3)
    const config = new Config({ loglevel: 'error', transports: [] })
    const pool = new PeerPool() as any
    const chain = new Chain({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
    })
    sync.best = td.func<typeof sync['best']>()
    sync.latest = td.func<typeof sync['latest']>()
    td.when(sync.best()).thenReturn('peer')
    td.when(sync.latest('peer' as any)).thenResolve({
      number: new BN(2),
      hash: () => Buffer.from([]),
    })
    td.when((BlockFetcher.prototype as any).fetch(), { delay: 20 }).thenResolve(undefined)
    ;(sync as any).chain = { blocks: { height: new BN(3) } }
    t.notOk(await sync.sync(), 'local height > remote height')
    await sync.stop()
    ;(sync as any).chain = {
      blocks: { height: new BN(0) },
    }
    setTimeout(() => {
      config.events.emit(Event.SYNC_SYNCHRONIZED, new BN(0))
    }, 100)
    t.ok(await sync.sync(), 'local height < remote height')
    await sync.stop()

    td.when((BlockFetcher.prototype as any).fetch()).thenReject(new Error('err0'))
    try {
      await sync.sync()
    } catch (err: any) {
      t.equals(err.message, 'err0', 'got error')
      await sync.stop()
      await sync.close()
    }
  })

  t.test('should send NewBlock/NewBlockHash to right peers', async (t) => {
    const config = new Config({ loglevel: 'error', transports: [] })
    const pool = new PeerPool() as any
    const chain = new Chain({ config })
    const sync = new FullSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
    })

    let timesSentToPeer2 = 0
    const peers = [
      {
        id: 'abc',
        eth: {
          status: { td: new BN(1) },
          send() {
            t.pass('sent NewBlock to peer1')
          },
        },
        inbound: false,
      },
      {
        id: 'efg',
        eth: {
          status: { td: new BN(2) },
          send() {
            t.pass('sent NewBlockHashes to peer2')
            timesSentToPeer2++
          },
        },
        inbound: false,
      },
      {
        id: 'hij',
        eth: {
          status: { td: new BN(3) },
          send() {
            t.fail('should not send announcement to peer3')
          },
        },
        inbound: false,
      },
    ]
    ;(sync as any).pool = { peers }

    Block.prototype.validateDifficulty = td.func<any>()
    td.when(Block.prototype.validateDifficulty(td.matchers.anything())).thenReturn(true)
    const chainTip = Block.fromBlockData()
    const newBlock = Block.fromBlockData({
      header: {
        parentHash: chainTip.hash(),
      },
    })

    chain.getLatestBlock = td.func<any>()
    chain.putBlocks = td.func<any>()
    td.when(chain.getLatestBlock()).thenResolve(chainTip)
    td.when(chain.putBlocks(td.matchers.anything())).thenResolve()

    await sync.handleNewBlock(newBlock, peers[2] as any)
    await sync.handleNewBlock(newBlock)
    t.ok(timesSentToPeer2 === 1, 'sent NewBlockHashes to Peer 2 once')
    t.pass('did not send NewBlock to peer3')
    t.end()
  })

  t.test('should reset td', (t) => {
    td.reset()
    t.end()
  })
})
