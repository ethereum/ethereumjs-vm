import { bytesToUtf8, utf8ToBytes } from 'ethereum-cryptography/utils.js'
import { EventEmitter } from 'events'
import { assert, describe, it } from 'vitest'

import { Trie, nibblestoBytes } from '../src/index.js'

import type { BatchDBOp } from '../src'

describe('kv stream test', () => {
  const trie = new Trie()
  const ops = [
    {
      type: 'del',
      key: utf8ToBytes('father'),
    },
    {
      type: 'put',
      key: utf8ToBytes('name'),
      value: utf8ToBytes('Yuri Irsenovich Kim'),
    },
    {
      type: 'put',
      key: utf8ToBytes('dob'),
      value: utf8ToBytes('16 February 1941'),
    },
    {
      type: 'put',
      key: utf8ToBytes('spouse'),
      value: utf8ToBytes('Kim Young-sook'),
    },
    {
      type: 'put',
      key: utf8ToBytes('occupation'),
      value: utf8ToBytes('Clown'),
    },
    {
      type: 'put',
      key: utf8ToBytes('nameads'),
      value: utf8ToBytes('Yuri Irsenovich Kim'),
    },
    {
      type: 'put',
      key: utf8ToBytes('namfde'),
      value: utf8ToBytes('Yuri Irsenovich Kim'),
    },
    {
      type: 'put',
      key: utf8ToBytes('namsse'),
      value: utf8ToBytes('Yuri Irsenovich Kim'),
    },
    {
      type: 'put',
      key: utf8ToBytes('dofab'),
      value: utf8ToBytes('16 February 1941'),
    },
    {
      type: 'put',
      key: utf8ToBytes('spoudse'),
      value: utf8ToBytes('Kim Young-sook'),
    },
    {
      type: 'put',
      key: utf8ToBytes('occupdsation'),
      value: utf8ToBytes('Clown'),
    },
    {
      type: 'put',
      key: utf8ToBytes('dozzzb'),
      value: utf8ToBytes('16 February 1941'),
    },
    {
      type: 'put',
      key: utf8ToBytes('spouszze'),
      value: utf8ToBytes('Kim Young-sook'),
    },
    {
      type: 'put',
      key: utf8ToBytes('occupatdfion'),
      value: utf8ToBytes('Clown'),
    },
    {
      type: 'put',
      key: utf8ToBytes('dssob'),
      value: utf8ToBytes('16 February 1941'),
    },
    {
      type: 'put',
      key: utf8ToBytes('spossuse'),
      value: utf8ToBytes('Kim Young-sook'),
    },
    {
      type: 'put',
      key: utf8ToBytes('occupssation'),
      value: utf8ToBytes('Clown'),
    },
  ] as BatchDBOp[]

  const valObj: Record<string, string> = {}
  for (const op of ops) {
    if (op.type === 'put') {
      valObj[bytesToUtf8(op.key)] = bytesToUtf8(op.value)
    }
  }

  it('should populate trie', async () => {
    await trie.batch(ops)
    const done = new EventEmitter()
    const stream = trie.createReadStream()
    stream.on('error', (err: any) => {
      assert.fail(`stream error: ${err}`)
      done.emit('done')
    })
    const streamed: string[] = []
    stream.on('data', (d: { key: number[]; value: Uint8Array }) => {
      const key = bytesToUtf8(nibblestoBytes(d.key))
      const value = bytesToUtf8(d.value)
      if (streamed.includes(key)) {
        // console.log('key', key, streamed)
      } else {
        streamed.push(key)

        assert.equal(value, valObj[key], `value for key ${key} should match`)
        delete valObj[key]
      }
    })
    stream.on('close', () => {})
    stream.on('end', () => {
      const keys = Object.keys(valObj)
      assert.equal(keys.length, 0)
      done.emit('done')
    })
    const pass = await new Promise((res, rej) => {
      done.once('done', () => {
        res(true)
        rej(false)
      })
    })
    assert.ok(pass, 'test passed')
  })
})

describe('db stream test', () => {
  const trie = new Trie()
  const ops = [
    {
      type: 'put',
      key: utf8ToBytes('color'),
      value: utf8ToBytes('purple'),
    },
    {
      type: 'put',
      key: utf8ToBytes('food'),
      value: utf8ToBytes('sushi'),
    },
    {
      type: 'put',
      key: utf8ToBytes('fight'),
      value: utf8ToBytes('fire'),
    },
    {
      type: 'put',
      key: utf8ToBytes('colo'),
      value: utf8ToBytes('trolo'),
    },
    {
      type: 'put',
      key: utf8ToBytes('color'),
      value: utf8ToBytes('blue'),
    },
    {
      type: 'put',
      key: utf8ToBytes('color'),
      value: utf8ToBytes('pink'),
    },
  ] as BatchDBOp[]

  it('should populate trie', async () => {
    trie.checkpoint()
    await trie.batch(ops)
  })
})
