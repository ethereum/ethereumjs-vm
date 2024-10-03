import { createBlockHeader } from '@ethereumjs/block'
import * as td from 'testdouble'
import { assert, describe, it, vi } from 'vitest'

import { Chain } from '../../src/blockchain/index.js'
import { Config } from '../../src/config.js'
import { Peer } from '../../src/net/peer/peer.js'
import { HeaderFetcher } from '../../src/sync/fetcher/headerfetcher.js'
import { Event } from '../../src/types.js'

import type { BlockHeader } from '@ethereumjs/block'

class PeerPool {
  open() {}
  close() {}
  idle() {}
}
PeerPool.prototype.open = td.func<any>()
PeerPool.prototype.close = td.func<any>()

HeaderFetcher.prototype.fetch = td.func<any>()
HeaderFetcher.prototype.clear = td.func<any>()
HeaderFetcher.prototype.destroy = td.func<any>()
vi.mock('../../src/sync/fetcher/headerfetcher.js', () => td.object())

Peer.prototype.latest = td.func<any>()
vi.mock('../../src/net/peer/peer.js', () => td.object())

const { LightSynchronizer } = await import('../../src/sync/lightsync.js')
describe('[LightSynchronizer]', async () => {
  it('should initialize correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new LightSynchronizer({ config, pool, chain })
    assert.equal(sync.type, 'light', 'light type')
  })

  it('should find best', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new LightSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
    })
    sync['running'] = true
    ;(sync as any).chain = { headers: { td: BigInt(1) } }
    const peers = [
      {
        les: { status: { headTd: BigInt(1), headNum: BigInt(1), serveHeaders: 1 } },
        inbound: false,
      },
      {
        les: { status: { headTd: BigInt(2), headNum: BigInt(2), serveHeaders: 1 } },
        inbound: false,
      },
    ]
    ;(sync as any).pool = { peers }
    ;(sync as any).forceSync = true
    assert.equal(await sync.best(), <any>peers[1], 'found best')
  })

  it('should sync', async () => {
    const config = new Config({
      accountCache: 10000,
      storageCache: 1000,
      safeReorgDistance: 0,
    })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new LightSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
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

    td.when(HeaderFetcher.prototype.fetch(), { delay: 20, times: 2 }).thenResolve(true)
    ;(sync as any).chain = { headers: { height: BigInt(3) } }
    assert.notOk(await sync.sync(), 'local height > remote height')
    ;(sync as any).chain = { headers: { height: BigInt(0) } }
    setTimeout(() => {
      config.events.emit(Event.SYNC_SYNCHRONIZED, BigInt(0))
    }, 100)
    assert.ok(await sync.sync(), 'local height < remote height')
    td.when(HeaderFetcher.prototype.fetch()).thenReject(new Error('err0'))
    try {
      await sync.sync()
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(err.message, 'err0', 'got error')
      await sync.stop()
      await sync.close()
      vi.unmock('../../src/sync/fetcher/headerfetcher')
      vi.unmock('../../src/net/peer/peer')
    }
  })
})
describe('sync errors', async () => {
  it('should produce correct errors', async () => {
    td.reset()
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new LightSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
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
    td.when(HeaderFetcher.prototype.fetch()).thenResolve(true)
    td.when(HeaderFetcher.prototype.fetch()).thenDo(() =>
      config.events.emit(Event.SYNC_FETCHED_HEADERS, [] as BlockHeader[]),
    )
    config.logger.on('data', async (data) => {
      if ((data.message as string).includes('No headers fetched are applicable for import')) {
        assert.ok(true, 'generated correct warning message when no headers received')
        config.logger.removeAllListeners()
        await sync.stop()
        await sync.close()
      }
    })
    await sync.sync()
  })
})
describe('import headers', () => {
  it('should import header', async () => {
    td.reset()
    HeaderFetcher.prototype.fetch = td.func<any>()
    HeaderFetcher.prototype.clear = td.func<any>()
    HeaderFetcher.prototype.destroy = td.func<any>()
    vi.mock('../../src/sync/fetcher/headerfetcher', () => td.object())

    Peer.prototype.latest = td.func<any>()
    vi.mock('../../src/net/peer/peer', () => td.object())

    const { LightSynchronizer } = await import('../../src/sync/lightsync.js')
    const config = new Config({
      accountCache: 10000,
      storageCache: 1000,
      safeReorgDistance: 0,
    })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const sync = new LightSynchronizer({
      config,
      interval: 1,
      pool,
      chain,
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
    td.when(HeaderFetcher.prototype.fetch()).thenResolve(true)
    td.when(HeaderFetcher.prototype.fetch()).thenDo(() =>
      config.events.emit(Event.SYNC_FETCHED_HEADERS, [createBlockHeader({})]),
    )
    config.logger.on('data', async (data) => {
      if ((data.message as string).includes('Imported headers count=1')) {
        assert.ok(true, 'successfully imported new header')
        config.logger.removeAllListeners()
        await sync.stop()
        await sync.close()
        vi.unmock('../../src/net/peer/peer')
        vi.unmock('../../src/sync/fetcher/headerfetcher')
      }
    })

    await sync.sync()
  })
})
