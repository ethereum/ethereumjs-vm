import { equalsBytes, hexToBytes, utf8ToBytes } from '@ethereumjs/util'
import { EventEmitter } from 'events'
import { multiaddr } from 'multiaddr'
import * as td from 'testdouble'
import { assert, describe, expect, it, vi } from 'vitest'

import { Config } from '../../../src/config'
import { Event } from '../../../src/types'

describe('[RlpxServer]', async () => {
  class RlpxPeer extends EventEmitter {
    accept(_: any, _2: any) {}
    getId() {
      return new Uint8Array([1])
    }
    getDisconnectPrefix(_: any) {
      return 'MockedReason'
    }
    static capabilities(_: any) {
      return []
    }
    _socket = { remoteAddress: 'mock', remotePort: 101 }
  }
  RlpxPeer.prototype.accept = vi.fn((input: object) => {
    if (!(input instanceof RlpxPeer)) throw Error('expected RlpxPeer type as input')
  })
  RlpxPeer.capabilities = vi.fn()
  vi.doMock('../../../src/net/peer/rlpxpeer', () => {
    {
      RlpxPeer
    }
  })

  class RLPx extends EventEmitter {
    listen(_: any, _2: any) {}
  }
  RLPx.prototype.listen = vi.fn()
  class DPT extends EventEmitter {
    bind(_: any, _2: any) {}
    getDnsPeers() {}
  }
  DPT.prototype.bind = vi.fn()
  DPT.prototype.getDnsPeers = vi.fn()

  vi.doMock('@ethereumjs/devp2p', () => {
    {
      RLPx
    }
  })

  const { RlpxServer } = await import('../../../src/net/server/rlpxserver')

  it('should initialize correctly', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({
      config,
      bootnodes: '10.0.0.1:1234,enode://abcd@10.0.0.2:1234',
      key: 'abcd',
    })
    assert.equal(server.name, 'rlpx', 'get name')
    assert.ok(equalsBytes(server.key!, hexToBytes('0xabcd')), 'key parse')
    assert.deepEqual(
      server.bootnodes,
      [multiaddr('/ip4/10.0.0.1/tcp/1234'), multiaddr('/ip4/10.0.0.2/tcp/1234')],
      'bootnodes split'
    )
  })

  it('should start/stop server', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({
      config,
      bootnodes: '10.0.0.1:1234,10.0.0.2:1234',
    })
    ;(server as any).initDpt = vi.fn()
    ;(server as any).initRlpx = vi.fn()
    server.dpt = {
      destroy: vi.fn(),
      bootstrap: vi.fn((input) => {
        if (
          JSON.stringify(input) ===
          JSON.stringify({ address: '10.0.0.1', udpPort: 1234, tcpPort: 1234 })
        )
          return undefined
        if (
          JSON.stringify(input) ===
          JSON.stringify({ address: '10.0.0.2', udpPort: '1234', tcpPort: '1234' })
        )
          throw new Error('err0')
      }),
    }
    server.rlpx = { destroy: vi.fn() }
    server.config.events.on(Event.PEER_ERROR, (err) =>
      assert.equal(err.message, 'err0', 'got error')
    )
    await server.start()
    expect((server as any).initDpt).toHaveBeenCalled()
    expect((server as any).initRlpx).toHaveBeenCalled()
    assert.ok(server.running, 'started')
    assert.notOk(await server.start(), 'already started')
    await server.stop()
    expect(server.dpt!.destroy).toHaveBeenCalled()
    expect(server.rlpx!.destroy).toHaveBeenCalled()
    assert.notOk(server.running, 'stopped')
    assert.notOk(await server.stop(), 'already stopped')
  })

  it('should bootstrap with dns acquired peers', async () => {
    const dnsPeerInfo = { address: '10.0.0.5', udpPort: 1234, tcpPort: 1234 }
    const config = new Config({
      transports: [],
      accountCache: 10000,
      storageCache: 1000,
      discDns: true,
    })
    const server = new RlpxServer({
      config,
      dnsNetworks: ['enrtree:A'],
    })
    ;(server as any).initDpt = vi.fn()
    ;(server as any).initRlpx = vi.fn()
    server.rlpx = { destroy: vi.fn() }
    server.dpt = {
      destroy: vi.fn(),
      getDnsPeers: vi.fn(() => [dnsPeerInfo]),
      bootstrap: vi.fn((input) => {
        if (JSON.stringify(input) !== JSON.stringify(dnsPeerInfo))
          throw new Error('expected input check has failed')
      }),
    }
    await server.start()
    await server.bootstrap()
    await server.stop()
  })

  it('should return rlpx server info with ip4 as default', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const mockId = '0123'
    const server = new RlpxServer({
      config,
      bootnodes: '10.0.0.1:1234,10.0.0.2:1234',
    })
    ;(server as any).initDpt = vi.fn()
    ;(server as any).initRlpx = vi.fn()
    server.dpt = {
      destroy: vi.fn(),
      getDnsPeers: vi.fn(),
      bootstrap: vi.fn((input) => {
        if (
          JSON.stringify(input) ===
          JSON.stringify({ address: '10.0.0.1', udpPort: 1234, tcpPort: 1234 })
        )
          return undefined
        if (
          JSON.stringify(input) ===
          JSON.stringify({ address: '10.0.0.2', udpPort: '1234', tcpPort: '1234' })
        )
          throw new Error('err0')
      }),
    }
    ;(server as any).rlpx = { destroy: vi.fn() }

    // @ts-ignore
    server.rlpx!.id = hexToBytes('0x' + mockId)
    config.events.on(Event.SERVER_ERROR, (err) => assert.equal(err.message, 'err0', 'got error'))

    await server.start()
    const nodeInfo = server.getRlpxInfo()
    assert.deepEqual(
      nodeInfo,
      {
        enode: `enode://${mockId}@0.0.0.0:30303`,
        id: mockId,
        ip: '0.0.0.0',
        listenAddr: '0.0.0.0:30303',
        ports: { discovery: 30303, listener: 30303 },
      },
      'get nodeInfo'
    )
    await server.stop()
  })

  it('should return rlpx server info with ip6', async () => {
    const config = new Config({
      transports: [],
      accountCache: 10000,
      storageCache: 1000,
      extIP: '::',
    })
    const mockId = '0123'
    const server = new RlpxServer({
      config,
      bootnodes: '10.0.0.1:1234,10.0.0.2:1234',
    })
    ;(server as any).initDpt = vi.fn()
    ;(server as any).initRlpx = vi.fn()
    server.dpt = {
      destroy: vi.fn(),
      getDnsPeers: vi.fn(),
      bootstrap: vi.fn((input) => {
        if (
          JSON.stringify(input) ===
          JSON.stringify({ address: '10.0.0.1', udpPort: 1234, tcpPort: 1234 })
        )
          return undefined
        if (
          JSON.stringify(input) ===
          JSON.stringify({ address: '10.0.0.2', udpPort: '1234', tcpPort: '1234' })
        )
          throw new Error('err0')
      }),
    }
    ;(server as any).rlpx = { destroy: vi.fn() }

    // @ts-ignore
    server.rlpx!.id = hexToBytes('0x' + mockId)

    config.events.on(Event.SERVER_ERROR, (err) => assert.equal(err.message, 'err0', 'got error'))
    await server.start()
    const nodeInfo = server.getRlpxInfo()
    assert.deepEqual(
      nodeInfo,
      {
        enode: `enode://${mockId}@[::]:30303`,
        id: mockId,
        ip: '::',
        listenAddr: '[::]:30303',
        ports: { discovery: 30303, listener: 30303 },
      },
      'get nodeInfo'
    )
    await server.stop()
  })

  it('should handle errors', () => {
    let count = 0
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({ config })
    server.config.events.on(Event.SERVER_ERROR, (err) => {
      count = count + 1
      if (err.message === 'err0') assert.ok(true, 'got server error - err0')
      if (err.message === 'err1') assert.ok(true, 'got peer error - err1')
    })
    ;(server as any).error(new Error('EPIPE'))
    ;(server as any).error(new Error('err0'))
    setTimeout(() => {
      assert.equal(count, 2, 'ignored error')
    }, 100)
    ;(server as any).error(new Error('err1'))
  })

  it('should ban peer', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({ config })
    assert.notOk(server.ban('123'), 'not started')
    server.started = true
    server.dpt = {
      destroy: vi.fn(),
      getDnsPeers: vi.fn(),
      bootstrap: vi.fn(),
      banPeer: vi.fn((input) => {
        if (!(input[0] === '112233' && input[1] === 1234))
          throw new Error('expected input check has failed')
      }),
    }
    ;(server as any).rlpx = { destroy: vi.fn() }
    server.ban('112233', 1234)
  })

  it('should init dpt', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({ config })
    ;(server as any).initDpt().catch((error: Error) => {
      throw error
    })
    config.events.on(Event.SERVER_ERROR, (err) =>
      it('should throw', async () => {
        assert.equal(err.message, 'err0', 'got error')
      })
    )
    server['dpt']?.events.emit('error', new Error('err0'))
  })

  it('should init rlpx', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({ config })
    const rlpxPeer = new RlpxPeer()

    ;(rlpxPeer as any).getId = vi.fn().mockReturnValue(new Uint8Array([1]))
    RlpxPeer.prototype.accept = vi.fn((input) => {
      if (JSON.stringify(input[0]) === JSON.stringify(rlpxPeer) && input[1] instanceof RlpxPeer) {
        return
      } else {
        throw new Error('expected input check has failed')
      }
    })
    ;(server as any).initRlpx().catch((error: Error) => {
      throw error
    })
    config.events.on(Event.PEER_CONNECTED, (peer) =>
      it('should connect', async () => {
        assert.ok(peer instanceof RlpxPeer, 'connected')
      })
    )
    config.events.on(Event.PEER_DISCONNECTED, (peer) =>
      it('should disconnect', async () => {
        assert.equal(peer.id, '01', 'disconnected')
      })
    )
    config.events.on(Event.SERVER_ERROR, (err) =>
      it('should throw error', async () => {
        assert.equal(err.message, 'err0', 'got error')
      })
    )
    config.events.on(Event.SERVER_LISTENING, (info) =>
      it('should listen', async () => {
        assert.deepEqual(info, { transport: 'rlpx', url: 'enode://ff@0.0.0.0:30303' }, 'listening')
      })
    )
    server.rlpx!.events.emit('peer:added', rlpxPeer)
    ;(server as any).peers.set('01', { id: '01' } as any)
    server.rlpx!.events.emit('peer:removed', rlpxPeer)
    server.rlpx!.events.emit('peer:error', rlpxPeer, new Error('err0'))

    // @ts-ignore
    server.rlpx!.id = hexToBytes('0xff')
    server.rlpx!.events.emit('listening')
  })

  it('should handles errors from id-less peers', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const server = new RlpxServer({ config })
    const rlpxPeer = new RlpxPeer()
    ;(rlpxPeer as any).getId = vi.fn().mockReturnValue(utf8ToBytes('test'))
    RlpxPeer.prototype.accept = vi.fn((input) => {
      if (JSON.stringify(input[0]) === JSON.stringify(rlpxPeer) && input[1] instanceof RlpxPeer) {
        return
      } else {
        throw new Error('expected input check has failed')
      }
    })
    ;(server as any).initRlpx().catch((error: Error) => {
      throw error
    })
    config.events.on(Event.SERVER_ERROR, (err) =>
      it('should throw', async () => {
        assert.equal(err.message, 'err0', 'got error')
      })
    )
    server.rlpx!.events.emit('peer:error', rlpxPeer, new Error('err0'))
  })
})
