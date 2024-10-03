/// <reference path="./testdouble.d.ts" />
import { EventEmitter } from 'events'
import * as td from 'testdouble'
import { assert, describe, it } from 'vitest'

import { Config } from '../../../src/config.js'
import { BoundProtocol } from '../../../src/net/protocol/index.js'
import { Sender } from '../../../src/net/protocol/sender.js'
import { Event } from '../../../src/types.js'

describe('[BoundProtocol]', () => {
  const peer = td.object('Peer') as any
  const protocol = td.object('Protocol') as any
  const testMessage = {
    name: 'TestMessage',
    code: 0x01,
    response: 0x02,
    encode: (value: any) => value.toString(),
    decode: (value: any) => parseInt(value),
  }
  const testResponse = {
    name: 'TestResponse',
    code: 0x02,
    encode: (value: any) => value.toString(),
    decode: (value: any) => parseInt(value),
  }
  protocol.timeout = 100
  protocol.messages = [testMessage, testResponse]

  it('should add methods for messages with a response', () => {
    const sender = new Sender()
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })

    assert.equal(bound['protocol'].messages[0].name, 'TestMessage')
  })

  it('should get/set status', () => {
    const sender = new Sender()
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })
    assert.deepEqual(bound.status, {}, 'empty status')
    bound.status = { id: 1 }
    assert.deepEqual(bound.status, { id: 1 }, 'status set')
  })

  it('should do handshake', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const sender = new EventEmitter() as Sender
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })
    td.when(protocol.handshake(td.matchers.isA(EventEmitter))).thenResolve({ id: 1 })
    await bound.handshake(sender)
    assert.deepEqual(bound.status, { id: 1 }, 'handshake success')
  })

  it('should handle incoming without resolver', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const sender = new Sender()
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })
    bound.config.events.once(Event.PROTOCOL_ERROR, (err) => {
      assert.ok(/error0/.test(err.message), 'decode error')
    })
    td.when(protocol.decode(testMessage, '1')).thenThrow(new Error('error0'))
    ;(bound as any).handle({ name: 'TestMessage', code: 0x01, payload: '1' })
    bound.config.events.once(Event.PROTOCOL_MESSAGE, (message) => {
      assert.deepEqual(message, { name: 'TestMessage', data: 2 }, 'correct message')
    })
    td.when(protocol.decode(testMessage, '2')).thenReturn(2)
    ;(bound as any).handle({ name: 'TestMessage', code: 0x01, payload: '2' })
  })

  it('should perform send', () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const sender = new Sender()
    sender.sendMessage = td.func<Sender['sendMessage']>()
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })
    td.when(protocol.encode(testMessage, 3)).thenReturn('3')
    assert.deepEqual(bound.send('TestMessage', 3), testMessage, 'message returned')
    td.verify(sender.sendMessage(0x01, '3' as any))
    assert.throws(() => bound.send('UnknownMessage'), /Unknown message/, 'unknown message')
  })

  it('should perform request', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const sender = new Sender()
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })
    sender.sendMessage = td.func<Sender['sendMessage']>()
    td.when(protocol.encode(testMessage, 1)).thenReturn('1')
    td.when(protocol.decode(testResponse, '2')).thenReturn(2)
    td.when(sender.sendMessage(0x01, '1' as any)).thenDo(() => {
      setTimeout(() => {
        sender.emit('message', { code: 0x02, payload: '2' })
      }, 100)
    })
    const response = await bound.request('TestMessage', 1)
    assert.equal(response, 2, 'got response')
    td.when(protocol.decode(testResponse, '2')).thenThrow(new Error('error1'))
    try {
      await bound.request('TestMessage', 1)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(/error1/.test(err.message), 'got error')
    }
  })

  it('should timeout request', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const sender = td.object<Sender>('Sender')
    const bound = new BoundProtocol({
      config,
      protocol,
      peer,
      sender,
    })
    try {
      await bound.request('TestMessage', {})
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(/timed out/.test(err.message), 'got error')
    }
  })

  it('should reset td', () => {
    td.reset()
  })
})
