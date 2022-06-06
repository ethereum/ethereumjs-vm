import tape from 'tape'
import * as td from 'testdouble'
import { Config } from '../../lib/config.js'
import { Event } from '../../lib/types.js'
import { Chain } from '../../lib/blockchain/index.js'

tape('[LightEthereumService]', async (t) => {
  class PeerPool {
    open() {}
    close() {}
  }
  PeerPool.prototype.open = td.func()
  PeerPool.prototype.close = td.func()
  td.replace('../../lib/net/peerpool.js', { PeerPool })
  const MockChain = td.constructor([] as any)
  MockChain.prototype.open = td.func()
  td.replace('../../lib/blockchain.js', { MockChain })
  const LesProtocol = td.constructor([] as any)
  td.replace('../../lib/net/protocol/lesprotocol.js', { LesProtocol })
  class LightSynchronizer {
    start() {}
    stop() {}
    open() {}
    close() {}
  }
  LightSynchronizer.prototype.start = td.func()
  LightSynchronizer.prototype.stop = td.func()
  LightSynchronizer.prototype.open = td.func()
  LightSynchronizer.prototype.close = td.func()
  td.replace('../../lib/sync/lightsync.js', { LightSynchronizer })

  const { LightEthereumService } = await import('../../lib/service/lightethereumservice.js')

  t.test('should initialize correctly', async (t) => {
    const config = new Config({ transports: [] })
    const chain = new Chain({ config })
    const service = new LightEthereumService({ config, chain })
    t.ok(service.synchronizer instanceof LightSynchronizer, 'light sync')
    t.equals(service.name, 'eth', 'got name')
    t.end()
  })

  t.test('should get protocols', async (t) => {
    const config = new Config({ transports: [] })
    const chain = new Chain({ config })
    const service = new LightEthereumService({ config, chain })
    t.ok(service.protocols[0] instanceof LesProtocol, 'light protocols')
    t.end()
  })

  t.test('should open', async (t) => {
    t.plan(3)
    const server = td.object() as any
    const config = new Config({ servers: [server] })
    const chain = new Chain({ config })
    const service = new LightEthereumService({ config, chain })
    await service.open()
    td.verify(service.synchronizer.open())
    td.verify(server.addProtocols(td.matchers.anything()))
    service.config.events.on(Event.SYNC_SYNCHRONIZED, () => t.pass('synchronized'))
    service.config.events.on(Event.SYNC_ERROR, (err: Error) => {
      if (err.message === 'error0') t.pass('got error 1')
    })
    service.config.events.emit(Event.SYNC_SYNCHRONIZED, BigInt(0))
    service.config.events.emit(Event.SYNC_ERROR, new Error('error0'))
    service.config.events.on(Event.SERVER_ERROR, (err: Error) => {
      if (err.message === 'error1') t.pass('got error 2')
    })
    service.config.events.emit(Event.SERVER_ERROR, new Error('error1'), server)
    await service.close()
  })

  t.test('should start/stop', async (t) => {
    const server = td.object() as any
    const config = new Config({ servers: [server] })
    const chain = new Chain({ config })
    const service = new LightEthereumService({ config, chain })
    await service.start()
    td.verify(service.synchronizer.start())
    t.notOk(await service.start(), 'already started')
    await service.stop()
    td.verify(service.synchronizer.stop())
    t.notOk(await service.stop(), 'already stopped')
    t.end()
  })

  t.test('should reset td', (t) => {
    td.reset()
    t.end()
  })
})
