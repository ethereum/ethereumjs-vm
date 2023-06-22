import {
  bytesToPrefixedHexString,
  bytesToUtf8,
  equalsBytes,
  hexStringToBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { ROOT_DB_KEY, Trie } from '../../src/index.js'
import secureTrieTests from '../fixtures/trietest_secureTrie.json'

describe('SecureTrie', () => {
  const trie = new Trie({ useKeyHashing: true })
  const k = utf8ToBytes('foo')
  const v = utf8ToBytes('bar')

  it('put and get value', async () => {
    await trie.put(k, v)
    const res = await trie.get(k)
    assert.ok(equalsBytes(v, res!))
  })

  it('copy trie', async () => {
    const t = trie.copy()
    const res = await t.get(k)
    assert.ok(equalsBytes(v, res!))
  })
})

describe('SecureTrie proof', () => {
  it('create a merkle proof and verify it with a single short key', async () => {
    const trie = new Trie({})
    await trie.put(utf8ToBytes('key1aa'), utf8ToBytes('01234'))
    const retrieved = await trie.get(utf8ToBytes('key1aa'))
    assert.equal(bytesToUtf8(retrieved!), '01234', 'should put/get a value')
    const proof = await trie.createProof(utf8ToBytes('key1aa'))
    assert.ok(proof, 'proof should be created')
    const val = await trie.verifyProof(trie.root(), utf8ToBytes('key1aa'), proof)
    assert.ok(val)
    if (val instanceof Uint8Array) {
      assert.equal(bytesToUtf8(val), '01234')
    }
  })
})

describe('secure tests', () => {
  let trie = new Trie({ secure: true })

  it('empty values', async () => {
    for (const row of secureTrieTests.tests.emptyValues.in) {
      const val =
        row[1] !== undefined && row[1] !== null
          ? utf8ToBytes(row[1])
          : (null as unknown as Uint8Array)
      await trie.put(utf8ToBytes(row[0]!), val)
    }
    assert.equal(bytesToPrefixedHexString(trie.root()), secureTrieTests.tests.emptyValues.root)
  })

  it('branchingTests', async () => {
    trie = new Trie({ secure: true })
    for (const row of secureTrieTests.tests.branchingTests.in) {
      const val =
        row[1] !== undefined && row[1] !== null
          ? utf8ToBytes(row[1])
          : (null as unknown as Uint8Array)
      await trie.put(utf8ToBytes(row[0]!), val)
    }
    assert.equal(bytesToPrefixedHexString(trie.root()), secureTrieTests.tests.branchingTests.root)
  })

  /**
  TODO: Fix this test
  it('jeff', async () => {
    for (const row of secureTrieTests.tests.jeff.in) {
      let val = row[1]
      if (val !== undefined && val !== null) {
        val = hexStringToBytes(row[1].slice(2))
      }
      await trie.put(hexStringToBytes(row[0].slice(2)), val)
    }
    assert.equal(bytesToPrefixedHexString(trie.root()), secureTrieTests.tests.jeff.root)
  })*/

  it('put fails if the key is the ROOT_DB_KEY', async () => {
    const trie = new Trie({ useKeyHashing: true, useRootPersistence: true })

    try {
      await trie.put(ROOT_DB_KEY, utf8ToBytes('bar'))

      assert.fail("Attempting to set '__root__' should fail but it did not.")
    } catch (e: any) {
      assert.equal(e.message, "Attempted to set '__root__' key but it is not allowed.")
    }
  })
})

const trie = new Trie({ useKeyHashing: true })
const a = hexStringToBytes(
  'f8448080a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0a155280bc3c09fd31b0adebbdd4ef3d5128172c0d2008be964dc9e10e0f0fedf'
)
const ak = hexStringToBytes('095e7baea6a6c7c4c2dfeb977efac326af552d87')
const b = hexStringToBytes(
  'f844802ea056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0db94dc4aab9b6a1a11956906ea34f3252f394576aece12199b23b269bb2738ab'
)
const bk = hexStringToBytes('945304eb96065b2a98b57a48a06ae28d285a71b5')
const c = hexStringToBytes(
  'f84c80880de0b6b3a7640000a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
)
const ck = hexStringToBytes('a94f5374fce5edbc8e2a8697c15331677e6ebf0b')
// checkpoint
// checkpoint
// commit
const d = hexStringToBytes(
  'f8488084535500b1a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0a155280bc3c09fd31b0adebbdd4ef3d5128172c0d2008be964dc9e10e0f0fedf'
)
const dk = hexStringToBytes('095e7baea6a6c7c4c2dfeb977efac326af552d87')
const e = hexStringToBytes(
  'f8478083010851a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0db94dc4aab9b6a1a11956906ea34f3252f394576aece12199b23b269bb2738ab'
)
const ek = hexStringToBytes('945304eb96065b2a98b57a48a06ae28d285a71b5')
const f = hexStringToBytes(
  'f84c01880de0b6b3540df72ca056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
)
const fk = hexStringToBytes('a94f5374fce5edbc8e2a8697c15331677e6ebf0b')
// commit
const g = hexStringToBytes(
  'f8488084535500b1a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a0a155280bc3c09fd31b0adebbdd4ef3d5128172c0d2008be964dc9e10e0f0fedf'
)
const gk = hexStringToBytes('095e7baea6a6c7c4c2dfeb977efac326af552d87')

describe('secure tests should not crash', () => {
  it('should work', async () => {
    await trie.put(ak, a)
    await trie.put(bk, b)
    await trie.put(ck, c)
    trie.checkpoint()
    trie.checkpoint()
    await trie.commit()
    await trie.put(dk, d)
    await trie.put(ek, e)
    await trie.put(fk, f)
    await trie.commit()
    await trie.put(gk, g)
  })
})

describe('Securetrie.copy', () => {
  it('created copy includes values added after checkpoint', async () => {
    const trie = new Trie({ useKeyHashing: true })

    await trie.put(utf8ToBytes('key1'), utf8ToBytes('value1'))
    await trie.put(utf8ToBytes('key2'), utf8ToBytes('value2'))
    trie.checkpoint()
    const trieCopy = trie.copy()
    const value = await trieCopy.get(utf8ToBytes('key2'))
    assert.ok(value, `trieCopy.get(key2): ${value ? bytesToUtf8(value) : 'null'}`)
  })

  it('created copy includes values added before checkpoint', async () => {
    const trie = new Trie({})
    await trie.put(utf8ToBytes('address1'), utf8ToBytes('value1'))
    trie.checkpoint()
    await trie.commit()
    trie.flushCheckpoints()
    await trie.put(utf8ToBytes('address2'), utf8ToBytes('value2'))
    const trieCopy = trie.copy()
    const value = await trieCopy.get(utf8ToBytes('address1'))
    assert.deepEqual(value, utf8ToBytes('value1'), 'value 1 should be in trie copy')
    const lookup = await trieCopy.get(utf8ToBytes('address1'))
    const lookup2 = await trieCopy.get(utf8ToBytes('address2'))
    assert.deepEqual(lookup, utf8ToBytes('value1'), 'node with value 1 should be in trie copy')

    assert.deepEqual(lookup2, utf8ToBytes('value2'), 'node with value 2 should be in trie copy')
  })

  it('created copy uses the correct hash function', async () => {
    const trie = new Trie({
      useKeyHashing: true,
      secure: true,
      hashFunction: (value) => {
        return Uint8Array.from([...utf8ToBytes('HASHED'), ...value])
      },
    })

    const key = utf8ToBytes('TestKey')
    const trieCopy = trie.copy()
    assert.equal(
      bytesToUtf8((trieCopy as any).hashFunction(key)),
      bytesToUtf8((trie as any).hashFunction(key)),
      'hashes should be equal'
    )
    assert.equal(
      bytesToUtf8((trieCopy as any).hashFunction(key)),
      'HASHEDTestKey',
      'hash should be custom hash function'
    )
  })
})
