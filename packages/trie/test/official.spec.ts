import { bytesToPrefixedHexString, hexStringToBytes, utf8ToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Trie } from '../src/index.js'

import trieAnyOrderTests from './fixtures/trieanyorder.json'
import trieTests from './fixtures/trietest.json'

describe('official tests', () => {
  it('should work', async () => {
    const testNames = Object.keys(trieTests.tests)
    let trie = new Trie()

    for await (const [idx, testName] of testNames.entries()) {
      assert.ok(`Starting ${idx + 1}/${testNames.length}: ${testName}`)
      const inputs = (trieTests as any).tests[testName].in
      const expect = (trieTests as any).tests[testName].root
      for await (const [_i_input, input] of inputs.entries()) {
        for (let i = 0; i < 2; i++) {
          if (typeof input[i] === 'string' && input[i].slice(0, 2) === '0x') {
            input[i] = hexStringToBytes(input[i])
          } else if (typeof input[i] === 'string') {
            input[i] = utf8ToBytes(input[i])
          }
        }
        await trie.put(input[0], input[1])
      }
      assert.equal(bytesToPrefixedHexString(trie.root()), expect)
      trie = new Trie()
    }
  })
})

describe('official tests any order', async () => {
  it('should work', async () => {
    const testNames = Object.keys(trieAnyOrderTests.tests)
    let trie = new Trie()
    for (const testName of testNames) {
      const test = (trieAnyOrderTests.tests as any)[testName]
      const keys = Object.keys(test.in)
      let key: any
      for (key of keys) {
        let val = test.in[key]

        if (typeof key === 'string' && key.slice(0, 2) === '0x') {
          key = hexStringToBytes(key)
        } else if (typeof key === 'string') {
          key = utf8ToBytes(key)
        }

        if (typeof val === 'string' && val.slice(0, 2) === '0x') {
          val = hexStringToBytes(val)
        } else if (typeof val === 'string') {
          val = utf8ToBytes(val)
        }

        await trie.put(key, val)
      }
      assert.equal(bytesToPrefixedHexString(trie.root()), test.root)
      trie = new Trie()
    }
  })
})
