import { bytesToPrefixedHexString, hexStringToBytes, utf8ToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Trie } from '../../src/index.js'
import hexencoded from '../fixtures/hex_encoded_securetrie_test.json'
import trieanyorder from '../fixtures/trieanyorder.json'
import secure_anyOrder from '../fixtures/trieanyorder_secureTrie.json'
import trietest from '../fixtures/trietest.json'
import securetest from '../fixtures/trietest_secureTrie.json'

describe('trietest.json', async () => {
  it('emptyValues', async () => {
    const test = trietest.tests.emptyValues
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = new Trie({})
    const toTest: Map<string, string | null> = new Map()
    for await (const [k, v] of test_in) {
      const key = utf8ToBytes(k)
      const value = typeof v === 'string' ? utf8ToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? utf8ToBytes(_v) : null
        const stored_v2 = await trie_v2.get(utf8ToBytes(_k!))
        assert.deepEqual(
          stored_v2,
          _value,
          `after put(${k.slice(0, 8)}...,${v})...trie should retrieve key/value: ${_k.slice(
            0,
            8
          )}... / ${_v}`
        )
      }
    }

    assert.deepEqual(
      trie_v2.root(),
      hexStringToBytes(test.root),
      `root hash (${bytesToPrefixedHexString(trie_v2.root())}) should match test root (${
        test.root
      })`
    )
  })
  it('branchingTests', async () => {
    const test = trietest.tests.branchingTests
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = await Trie.create({})
    const toTest: Map<string, string | null> = new Map()
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = hexStringToBytes(k!)
      const value = typeof v === 'string' ? utf8ToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? utf8ToBytes(_v) : null
        const stored_v2 = await trie_v2.get(hexStringToBytes(_k!))
        assert.deepEqual(
          stored_v2,
          _value,
          `after put(${k.slice(0, 8)}...,${v}) trie should retrieve key/value: ${_k} / ${_v}`
        )
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash should match test root')
  })

  it('jeff', async () => {
    const test = trietest.tests.jeff
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = new Trie({})
    const toTest: Map<string, string | null> = new Map()
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = hexStringToBytes(k!)
      const value = typeof v === 'string' ? hexStringToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)

      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? hexStringToBytes(_v) : null
        const stored_v2 = await trie_v2.get(hexStringToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
  })
  it('insert-middle-leaf', async () => {
    const test = trietest.tests['insert-middle-leaf']
    const test_in: [string, string | null][] = test.in as [string, string | null][]

    // t.pass(`${test_in}`)
    const trie_v2 = new Trie({})
    const toTest: Map<string | null, string | null> = new Map()
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = utf8ToBytes(k!)
      const value = typeof v === 'string' ? utf8ToBytes(v) : null
      await trie_v2.put(key, value)
      // const toTest: Map<string | null, string | null> = new Map()

      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? utf8ToBytes(_v) : null
        const stored_v2 = await trie_v2.get(utf8ToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
  })
  it('branch-value-update', async () => {
    const test = trietest.tests['branch-value-update']
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = new Trie({})
    const toTest: Map<string | null, string | null> = new Map()
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = utf8ToBytes(k!)
      const value = typeof v === 'string' ? utf8ToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? utf8ToBytes(_v) : null
        const stored_v2 = await trie_v2.get(utf8ToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
  })
})
describe('trietest_secureTrie.json', async () => {
  it('emptyValues', async () => {
    const test = securetest.tests.emptyValues
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = new Trie({ secure: true })
    const toTest: Map<string | null, string | null> = new Map()
    for await (const [k, v] of test_in) {
      const key = utf8ToBytes(k!)
      const value = typeof v === 'string' ? utf8ToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? utf8ToBytes(_v) : null
        const stored_v2 = await trie_v2.get(utf8ToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match')
  })
  describe('branchingTests', async () => {
    const toTest: Map<string, string | null> = new Map()
    const test = securetest.tests.branchingTests
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = new Trie({ secure: true })
    it('should test all entries', async () => {
      for await (const [_idx, [k, v]] of test_in.entries()) {
        it(`[${_idx + 1} / ${test_in.length}] => {key: ${k}, value: ${v}}`, async () => {
          const key = hexStringToBytes(k!)
          const value = typeof v === 'string' ? utf8ToBytes(v) : null
          await trie_v2.put(key, value)
          toTest.set(k, v)
          for await (const [_k, _v] of toTest.entries()) {
            const _key = hexStringToBytes(_k)
            const _value = typeof _v === 'string' ? utf8ToBytes(_v) : null
            const stored_v2 = await trie_v2.get(_key)
            assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
          }
        })
      }
    })
    it('should match the test root', async () => {
      const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
      assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
    })
  })

  describe('jeff', async () => {
    const toTest: Map<string | null, string | null> = new Map()
    const test = securetest.tests.jeff
    const test_in: [string, string | null][] = test.in as [string, string | null][]
    const trie_v2 = new Trie({ secure: true })
    it(
      'should test all entries',
      async () => {
        for await (const [_idx, [k, v]] of test_in.entries()) {
          const key = hexStringToBytes(k!)
          const value = typeof v === 'string' ? hexStringToBytes(v) : null
          await trie_v2.put(key, value)
          toTest.set(k, v)

          for await (const [_k, _v] of toTest.entries()) {
            const _value = typeof _v === 'string' ? hexStringToBytes(_v) : null
            const stored_v2 = await trie_v2.get(hexStringToBytes(_k!))
            assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
          }
        }
      },
      { timeout: 10000 }
    )
    it('should match the test root', async () => {
      const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
      assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
    })
  })
})
describe('securetrie', async () => {
  it('1', async () => {
    const toTest: Map<string | null, string | null> = new Map()
    const test = hexencoded.tests.test1
    const test_in: [string, string | null][] = Object.entries(test.in)
    const trie_v2 = new Trie({ secure: true })
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = hexStringToBytes(k!)
      const value = typeof v === 'string' ? hexStringToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? hexStringToBytes(_v) : null
        const stored_v2 = await trie_v2.get(hexStringToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
  })
  it('2', async () => {
    const toTest: Map<string | null, string | null> = new Map()
    const test = hexencoded.tests.test2
    const test_in: [string, string | null][] = Object.entries(test.in)
    const trie_v2 = new Trie({ secure: true })
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = hexStringToBytes(k!)
      const value = typeof v === 'string' ? hexStringToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? hexStringToBytes(_v) : null
        const stored_v2 = await trie_v2.get(hexStringToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
  })
  it('3', async () => {
    const toTest: Map<string | null, string | null> = new Map()
    const test = hexencoded.tests.test3
    const test_in: [string, string | null][] = Object.entries(test.in)
    const trie_v2 = new Trie({ secure: true })
    for await (const [_idx, [k, v]] of test_in.entries()) {
      const key = hexStringToBytes(k!)
      const value = typeof v === 'string' ? hexStringToBytes(v) : null
      await trie_v2.put(key, value)
      toTest.set(k, v)
      for await (const [_k, _v] of toTest.entries()) {
        const _value = typeof _v === 'string' ? hexStringToBytes(_v) : null
        const stored_v2 = await trie_v2.get(hexStringToBytes(_k!))
        assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
      }
    }
    const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
    assert.equal(rootHashv2, test.root, 'root hash v2 should match test root')
  })
})
describe('secure_anyOrder', async () => {
  const serializer = (value: string, hex: boolean = false): Uint8Array => {
    return hex ? hexStringToBytes(value) : utf8ToBytes(value)
  }
  for (const _test of Object.keys(secure_anyOrder.tests)) {
    const hex = _test === 'hex'
    it(`${_test}`, async () => {
      const test = secure_anyOrder.tests[_test as keyof typeof secure_anyOrder.tests]
      const test_in: [string, string | null][] = Object.entries(test.in)
      const trie_v2 = new Trie({ secure: true })
      const toTest: Map<string | null, string | null> = new Map()
      for await (const [k, v] of test_in) {
        const key = serializer(k!, hex)
        const value = typeof v === 'string' ? serializer(v, hex) : null
        await trie_v2.put(key, value)
        toTest.set(k, v)
        for await (const [_k, _v] of toTest.entries()) {
          const _value = typeof _v === 'string' ? serializer(_v, hex) : null
          const stored_v2 = await trie_v2.get(serializer(_k!, hex))
          assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
        }
      }
      const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
      assert.equal(rootHashv2, test.root, 'root hash v2 should match')
    })
  }
})
describe('anyOrder', async () => {
  const serializer = (value: string, hex: boolean = false): Uint8Array => {
    return hex ? hexStringToBytes(value) : utf8ToBytes(value)
  }
  for (const _test of Object.keys(trieanyorder.tests)) {
    const hex = _test === 'hex'
    it(`${_test}`, async () => {
      const test = trieanyorder.tests[_test as keyof typeof trieanyorder.tests]
      const test_in: [string, string | null][] = Object.entries(test.in)
      const trie_v2 = new Trie({})
      const toTest: Map<string | null, string | null> = new Map()
      for await (const [k, v] of test_in) {
        const key = serializer(k!, hex)
        const value = typeof v === 'string' ? serializer(v, hex) : null
        await trie_v2.put(key, value)
        toTest.set(k, v)

        for await (const [_k, _v] of toTest.entries()) {
          const _value = typeof _v === 'string' ? serializer(_v, hex) : null
          const stored_v2 = await trie_v2.get(serializer(_k!, hex))
          assert.deepEqual(stored_v2, _value, `v2 should retrieve key/value: ${_k} / ${_v}`)
        }
      }
      const rootHashv2 = bytesToPrefixedHexString(trie_v2.root())
      assert.equal(rootHashv2, test.root, 'root hash v2 should match')
    })
  }
})
