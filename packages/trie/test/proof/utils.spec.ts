// reference: https://github.com/ethereum/go-ethereum/blob/20356e57b119b4e70ce47665a71964434e15200d/trie/proof_test.go

import { MapDB, compareBytes, hexStringToBytes, setLengthLeft, toBytes } from '@ethereumjs/util'
import { concatBytes } from 'ethereum-cryptography/utils'
import { assert, describe, expect, it } from 'vitest'

import { Trie, bytesToNibbles, verifyRangeProof } from '../../src/index.js'

import randKeys from './randTrieKeys.json'
import randValues from './randTrieVals.json'

import type { DB } from '@ethereumjs/util'

const TRIE_SIZE = 512
export interface verifyTest {
  trie: Trie
  entries: [Uint8Array, Uint8Array][]
  start: number
  end: number
  startKey?: Uint8Array
  endKey?: Uint8Array
  keys?: Uint8Array[]
  vals?: Uint8Array[]
}
/**
 * Create a random trie.
 * @param addKey - whether to add 100 ordered keys
 * @returns Trie object and sorted entries
 */
export async function randomTrie(db?: DB<string, string>, addKey: boolean = true) {
  const entries: [Uint8Array, Uint8Array][] = []
  const trie = new Trie({
    db,
  })
  if (addKey) {
    for (let i = 0; i < 100; i++) {
      const key = setLengthLeft(toBytes(i), 32)
      const val = toBytes(i)
      await trie.put(key, val)
      entries.push([key, val])
    }
  }
  for (let i = 0; i < TRIE_SIZE; i++) {
    const key = hexStringToBytes(randKeys[i])
    const val = hexStringToBytes(randValues[i])
    if ((await trie.get(key)) === null) {
      await trie.put(key, val)
      entries.push([key, val])
    }
  }
  return {
    trie,
    entries: entries.sort(([k1], [k2]) => compareBytes(k1, k2)),
  }
}
export function getRandomIntInclusive(min: number, max: number): number {
  min = Math.ceil(min)
  max = Math.floor(max)
  if (max < min) {
    throw new Error('The maximum value should be greater than the minimum value')
  }
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function decreaseKey(key: Uint8Array) {
  for (let i = key.length - 1; i >= 0; i--) {
    if (key[i] > 0) {
      return concatBytes(key.slice(0, i), toBytes(key[i] - 1), key.slice(i + 1))
    }
  }
  return key
}

export function increaseKey(key: Uint8Array) {
  for (let i = key.length - 1; i >= 0; i--) {
    if (key[i] < 255) {
      return concatBytes(key.slice(0, i), toBytes(key[i] + 1), key.slice(i + 1))
    }
  }
  return key
}

function formatParams(test: verifyTest) {
  const { trie, entries, start, end, keys, vals } = test
  let { startKey, endKey } = test
  startKey = startKey ?? entries[start][0]
  endKey = endKey ?? entries[end][0]
  const targetRange = entries.slice(start, end + 1)
  const _keys = keys
    ? keys.map((key) => bytesToNibbles(key))
    : targetRange.map(([key]) => bytesToNibbles(key))
  const _vals = vals ?? targetRange.map(([, val]) => val)
  return { trie, startKey, endKey, _keys, _vals }
}
export async function verify(test: verifyTest) {
  const { trie, startKey, endKey, _keys, _vals } = formatParams(test)
  const startKeyProof = await trie.createProof(startKey)
  const endKeyProof = await trie.createProof(endKey)
  const combinedProof = [...startKeyProof, ...endKeyProof]
  return verifyRangeProof(
    trie.root(),
    bytesToNibbles(startKey),
    bytesToNibbles(endKey),
    _keys,
    _vals,
    combinedProof,
    trie.hashFunction
  )
}

describe('randomTrie', async () => {
  const trie = await randomTrie()
  it('should create a random trie', async () => {
    expect(trie).toBeDefined()
    expect(trie.trie).toBeDefined()
    expect(trie.entries).toBeDefined()
    expect(trie.entries.length).toBeGreaterThanOrEqual(TRIE_SIZE)
    expect(trie.entries.length).toBeLessThanOrEqual(TRIE_SIZE + 100)
  })
  const triedb = new MapDB<string, string>()
  for await (const [key, value] of trie.trie.database()._leveldb.iterator()) {
    await triedb.put(key.toString(), value.toString())
  }
  const fromDB = await randomTrie(triedb)
  it('should recreate trie (from DB)', async () => {
    expect(fromDB).toBeDefined()
    expect(fromDB.trie).toBeDefined()
    expect(fromDB.entries).toBeDefined()
    expect(fromDB.entries.length).toBeGreaterThanOrEqual(TRIE_SIZE)
    expect(fromDB.entries.length).toBeLessThanOrEqual(TRIE_SIZE + 100)
    assert.deepEqual(trie.trie.root(), fromDB.trie.root(), 'The root hash should be equal')
  })
})
describe('randomTrie(false)', async () => {
  const trie = await randomTrie(undefined, false)
  it('should create a random trie', async () => {
    expect(trie).toBeDefined()
    expect(trie.trie).toBeDefined()
    expect(trie.entries).toBeDefined()
    assert.equal(trie.entries.length, TRIE_SIZE, 'The number of entries  equal to TRIE_SIZE')
  })
  const triedb = new MapDB<string, string>()
  for await (const [key, value] of trie.trie.database()._leveldb.iterator()) {
    await triedb.put(key.toString(), value.toString())
  }
  const fromDB = await randomTrie(triedb, false)
  it('should recreate trie (from DB)', async () => {
    expect(fromDB).toBeDefined()
    expect(fromDB.trie).toBeDefined()
    expect(fromDB.entries).toBeDefined()
    assert.equal(trie.entries.length, TRIE_SIZE, 'The number of entries  equal to TRIE_SIZE')
    assert.deepEqual(trie.trie.root(), fromDB.trie.root(), 'The root hash should be equal')
  })
})

describe('generateRandomIntInclusive', async () => {
  const testValues = Array.from({ length: 100 }, () => {
    const min = Math.ceil(Math.random() * 1000)
    const max = Math.ceil(Math.random() * 1000) + min
    const rand = getRandomIntInclusive(min, max)
    return { min, max, rand }
  })
  it('should test function 100 times', async () => {
    assert.ok(
      testValues.every(({ min, max, rand }) => rand >= min && rand <= max),
      'The random number should be between min and max'
    )
  })
})

describe('decreaseKey', async () => {
  const keys = Array.from({ length: 8 }, (_, i) => setLengthLeft(toBytes(2 ** i), 32))
  const decreased = keys.map((key) => decreaseKey(key))
  it('should decrease key', async () => {
    assert.ok(
      decreased.every((key, i) => compareBytes(key, keys[i]) < 0),
      'The decreased key should be less than the original key'
    )
  })
})
describe('increaseKey', async () => {
  const keys = Array.from({ length: 8 }, (_, i) => setLengthLeft(toBytes(2 ** i), 32))
  const increased = keys.map((key) => increaseKey(key))
  it('should decrease key', async () => {
    assert.ok(
      increased.every((key, i) => compareBytes(key, keys[i]) > 0),
      'The increased key should be greater than the original key'
    )
  })
})
