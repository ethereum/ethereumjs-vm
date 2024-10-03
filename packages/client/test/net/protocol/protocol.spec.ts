import * as td from 'testdouble'
import { assert, describe, it } from 'vitest'

import { Config } from '../../../src/config.js'
import { RlpxPeer } from '../../../src/net/peer/rlpxpeer.js'
import { BoundProtocol, Protocol, Sender } from '../../../src/net/protocol/index.js'

describe('[Protocol]', () => {
  const testMessage = {
    name: 'TestMessage',
    code: 0x01,
    encode: (value: any) => value.toString(),
    decode: (value: any) => parseInt(value),
  }
  class TestProtocol extends Protocol {
    constructor() {
      const config = new Config({ accountCache: 10000, storageCache: 1000 })
      super({ config })
    }

    get name(): string {
      return 'test'
    }
    get versions(): number[] {
      return [1]
    }
    get messages(): any[] {
      return [testMessage]
    }
    encodeStatus(): number[] {
      return [1]
    }
    decodeStatus(status: any): any {
      return { id: status[0] }
    }
  }

  it('should throw if missing abstract methods', () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const p = new Protocol({ config })
    assert.throws(() => p.versions, /Unimplemented/)
    assert.throws(() => p.messages, /Unimplemented/)
    assert.throws(() => p.encodeStatus(), /Unimplemented/)
    assert.throws(() => p.decodeStatus({}), /Unimplemented/)
  })

  it('should handle open', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const p = new Protocol({ config })
    await p.open()
    assert.ok(p.opened, 'is open')
  })

  it('should perform handshake (status now)', async () => {
    const p = new TestProtocol()
    const sender = new Sender()
    sender.sendStatus = td.func<Sender['sendStatus']>()
    sender.status = [1]
    assert.deepEqual(await p.handshake(sender), { id: 1 }, 'got status now')
  })

  it('should perform handshake (status later)', async () => {
    const p = new TestProtocol()
    const sender = new Sender()
    sender.sendStatus = td.func<Sender['sendStatus']>()
    setTimeout(() => {
      sender.emit('status', [1])
    }, 100)
    const status = await p.handshake(sender)
    td.verify(sender.sendStatus([1]))
    assert.deepEqual(status, { id: 1 }, 'got status later')
  })

  it('should handle handshake timeout', async () => {
    const p = new TestProtocol()
    const sender = new Sender()
    sender.sendStatus = td.func<Sender['sendStatus']>()
    p.timeout = 100
    setTimeout(() => {
      sender.emit('status', [1])
    }, 101)
    try {
      await p.handshake(sender)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(/timed out/.test(e.message), 'got timeout error')
    }
  })

  it('should encode message', () => {
    const p = new TestProtocol()
    assert.equal(p.encode(testMessage, 1234), '1234', 'encoded')
    assert.equal(p.encode({} as any, 1234), 1234, 'encode not defined')
  })

  it('should decode message', () => {
    const p = new TestProtocol()
    assert.equal(p.decode(testMessage, '1234'), 1234, 'decoded')
    assert.equal(p.decode({} as any, 1234), 1234, 'decode not defined')
  })

  it('should bind to peer', async () => {
    const p = new TestProtocol()

    const peer = new RlpxPeer({ host: '127.0.0.1', port: 30303, config: p.config })

    const sender = new Sender()

    const bound = new BoundProtocol({ peer, sender, protocol: p, config: p.config })

    assert.ok(bound instanceof BoundProtocol, 'correct bound protocol')
  })

  td.reset()
})
