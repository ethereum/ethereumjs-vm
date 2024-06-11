import { RLP } from '@ethereumjs/rlp'
import { MapDB, equalsBytes, hexToBytes } from '@ethereumjs/util'
import { loadVerkleCrypto } from 'verkle-cryptography-wasm'
import { assert, describe, it } from 'vitest'

import { InternalNode, LeafNode, ROOT_DB_KEY } from '../src/index.js'
import { VerkleTree } from '../src/verkleTree.js'

import type { PrefixedHexString } from '@ethereumjs/util'

// Testdata from https://github.com/gballet/go-ethereum/blob/kaustinen-with-shapella/trie/verkle_test.go
const presentKeys = [
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d01',
  '0xe6ed6c222e3985050b4fc574b136b0a42c63538e9ab970995cd418ba8e526400',
  '0x18fb432d3b859ec3a1803854e8cceea75d092e52d0d4a4398d13022496745a02',
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
  '0x18fb432d3b859ec3a1803854e8cceea75d092e52d0d4a4398d13022496745a04',
  '0xe6ed6c222e3985050b4fc574b136b0a42c63538e9ab970995cd418ba8e526402',
  '0xe6ed6c222e3985050b4fc574b136b0a42c63538e9ab970995cd418ba8e526403',
  '0x18fb432d3b859ec3a1803854e8cceea75d092e52d0d4a4398d13022496745a00',
  '0x18fb432d3b859ec3a1803854e8cceea75d092e52d0d4a4398d13022496745a03',
  '0xe6ed6c222e3985050b4fc574b136b0a42c63538e9ab970995cd418ba8e526401',
  '0xe6ed6c222e3985050b4fc574b136b0a42c63538e9ab970995cd418ba8e526404',
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d00',
  '0x18fb432d3b859ec3a1803854e8cceea75d092e52d0d4a4398d13022496745a01',
].map((key) => hexToBytes(key as PrefixedHexString))

// Corresponding values for the present keys
const values = [
  '0x320122e8584be00d000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0300000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  '0x1bc176f2790c91e6000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0xe703000000000000000000000000000000000000000000000000000000000000',
].map((key) => hexToBytes(key as PrefixedHexString))

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const absentKeys = [
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d03',
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d04',
].map((key) => hexToBytes(key as PrefixedHexString))

describe('Verkle tree', () => {
  it('should insert and retrieve values', async () => {
    const verkleCrypto = await loadVerkleCrypto()
    const tree = await VerkleTree.create({
      verkleCrypto,
    })
    const db = new MapDB<Uint8Array, Uint8Array>()
    tree.database(db)
    // Insert a root node
    await tree['_db'].put(
      ROOT_DB_KEY,
      new InternalNode({
        commitment: verkleCrypto.zeroCommitment,
        depth: 0,
        verkleCrypto,
      }).serialize()
    )
    const res = await tree.findPath(presentKeys[0])

    assert.ok(res.node === null, 'should not find a node when the key is not present')
    assert.deepEqual(res.remaining, presentKeys[0])

    await tree.put(presentKeys[0], values[0])
    console.log(await tree.get(presentKeys[0]))
    // for (let i = 0; i < presentKeys.length; i++) {
    //   console.log('lets put a key')
    //   await tree.put(presentKeys[i], values[i])
    // }
    // for (let i = 0; i < presentKeys.length; i++) {
    //   const retrievedValue = await tree.get(presentKeys[i])
    //   if (retrievedValue === null) {
    //     assert.fail('Value not found')
    //   }
    //   assert.ok(equalsBytes(retrievedValue, values[i]))
    // }
    // const path = await tree.findPath(presentKeys[0])
    // assert.ok(path.node instanceof LeafNode)
  })
})
