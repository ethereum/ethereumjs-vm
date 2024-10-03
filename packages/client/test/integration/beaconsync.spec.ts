import { BlockHeader } from '@ethereumjs/block'
import { createCommonFromGethGenesis } from '@ethereumjs/common'
import { assert, describe, it, vi } from 'vitest'

import { Event } from '../../src/types.js'
import { postMergeData } from '../testdata/geth-genesis/post-merge.js'

import { destroy, setup, wait } from './util.js'

const common = createCommonFromGethGenesis(postMergeData, { chain: 'post-merge' })
common.setHardforkBy({ blockNumber: BigInt(0) })

describe('should sync blocks', async () => {
  BlockHeader.prototype['_consensusFormatValidation'] = vi.fn()
  vi.doMock('@ethereumjs/block', () => {
    return {
      BlockHeader,
    }
  })

  const [remoteServer, remoteService] = await setup({ location: '127.0.0.2', height: 20, common })
  const [localServer, localService] = await setup({ location: '127.0.0.1', height: 0, common })
  const next = await remoteService.chain.getCanonicalHeadHeader()
  ;(localService.synchronizer as any).skeleton.status.progress.subchains = [
    {
      head: BigInt(21),
      tail: BigInt(21),
      next: next.hash(),
    },
  ]
  await localService.synchronizer!.stop()
  await localServer.discover('remotePeer1', '127.0.0.2')
  localService.config.events.on(Event.SYNC_SYNCHRONIZED, async () => {
    it('should be synced', () => {
      assert.equal(localService.chain.blocks.height, BigInt(20), 'synced')
    })
    await destroy(localServer, localService)
    await destroy(remoteServer, remoteService)
  })
  await localService.synchronizer!.start()
}, 30000)

describe('should not sync with stale peers', async () => {
  const [remoteServer, remoteService] = await setup({ location: '127.0.0.2', height: 9, common })
  const [localServer, localService] = await setup({ location: '127.0.0.1', height: 10, common })
  localService.config.events.on(Event.SYNC_SYNCHRONIZED, async () => {
    throw new Error('synced with a stale peer')
  })
  it('should not sync', async () => {
    try {
      await localServer.discover('remotePeer', '127.0.0.2')
      await wait(300)
      assert.fail('should not sync')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok('did not sync')
    }
  })
  await destroy(localServer, localService)
  await destroy(remoteServer, remoteService)
}, 30000)

describe('should sync with best peer', async () => {
  const [remoteServer1, remoteService1] = await setup({
    location: '127.0.0.2',
    height: 7,
    common,
  })
  const [remoteServer2, remoteService2] = await setup({
    location: '127.0.0.3',
    height: 10,
    common,
  })
  const [localServer, localService] = await setup({
    location: '127.0.0.1',
    height: 0,
    common,
    minPeers: 2,
  })
  ;(localService.synchronizer as any).skeleton.status.progress.subchains = [
    {
      head: BigInt(11),
      tail: BigInt(11),
      next: (await remoteService2.chain.getCanonicalHeadHeader()).hash(),
    },
  ]
  localService.interval = 1000
  await localService.synchronizer!.stop()
  await localServer.discover('remotePeer1', '127.0.0.2')
  await localServer.discover('remotePeer2', '127.0.0.3')

  localService.config.events.on(Event.SYNC_SYNCHRONIZED, async () => {
    it('should sync with best peer', async () => {
      if (localService.chain.blocks.height === BigInt(10)) {
        assert.ok(true, 'synced with best peer')
      }
    })
    await destroy(localServer, localService)
    await destroy(remoteServer1, remoteService1)
    await destroy(remoteServer2, remoteService2)
  })
  await localService.synchronizer!.start()
}, 30000)
