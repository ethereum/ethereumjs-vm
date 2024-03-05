import { assert, describe, it } from 'vitest'

import { SyncMode } from '../../src/config'
import { Event } from '../../src/types'

import { destroy, setup, wait } from './util'

describe(
  'should sync headers',
  async () => {
    const [remoteServer, remoteService] = await setup({
      location: '127.0.0.2',
      height: 20,
      syncmode: SyncMode.Full,
    })
    const [localServer, localService] = await setup({
      location: '127.0.0.1',
      height: 0,
      syncmode: SyncMode.Light,
    })
    await localService.synchronizer!.stop()
    await localServer.discover('remotePeer1', '127.0.0.2')
    localService.config.events.on(Event.SYNC_SYNCHRONIZED, async () => {
      it('should sync', () => {
        assert.equal(localService.chain.headers.height, BigInt(20), 'synced')
      })
      await destroy(localServer, localService)
      await destroy(remoteServer, remoteService)
    })
    await localService.synchronizer!.start()
  },
  { timeout: 30000 }
)

describe(
  'should not sync with stale peers',
  async () => {
    const [remoteServer, remoteService] = await setup({
      location: '127.0.0.2',
      height: 9,
      syncmode: SyncMode.Full,
    })
    const [localServer, localService] = await setup({
      location: '127.0.0.1',
      height: 10,
      syncmode: SyncMode.Light,
    })
    localService.config.events.on(Event.SYNC_SYNCHRONIZED, async () => {
      throw new Error('synced with a stale peer')
    })
    await localServer.discover('remotePeer', '127.0.0.2')
    await wait(100)
    await destroy(localServer, localService)
    await destroy(remoteServer, remoteService)
    it('should not sync', async () => {
      assert.ok('did not sync')
    })
  },
  { timeout: 30000 }
)

describe(
  'should sync with best peer',
  async () => {
    const [remoteServer1, remoteService1] = await setup({
      location: '127.0.0.2',
      height: 9,
      syncmode: SyncMode.Full,
    })
    const [remoteServer2, remoteService2] = await setup({
      location: '127.0.0.3',
      height: 10,
      syncmode: SyncMode.Full,
    })
    const [localServer, localService] = await setup({
      location: '127.0.0.1',
      height: 0,
      syncmode: SyncMode.Light,
    })
    await localService.synchronizer!.stop()
    await localServer.discover('remotePeer1', '127.0.0.2')
    await localServer.discover('remotePeer2', '127.0.0.3')
    localService.config.events.on(Event.SYNC_SYNCHRONIZED, async () => {
      it('should sync with best peer', async () => {
        assert.equal(localService.chain.headers.height, BigInt(10), 'synced with best peer')
      })
      await destroy(localServer, localService)
      await destroy(remoteServer1, remoteService1)
      await destroy(remoteServer2, remoteService2)
    })
    await localService.synchronizer!.start()
  },
  { timeout: 30000 }
)
