import { MapDB, bytesToHex, equalsBytes, hexToBytes } from '@ethereumjs/util'
import { loadVerkleCrypto } from 'verkle-cryptography-wasm'
import { assert, beforeAll, describe, it } from 'vitest'

import {
  InternalNode,
  LeafNode,
  VerkleNodeType,
  decodeNode,
  matchingBytesLength,
} from '../src/index.js'
import { VerkleTree } from '../src/verkleTree.js'

import type { VerkleNode } from '../src/index.js'
import type { PrefixedHexString, VerkleCrypto } from '@ethereumjs/util'

// Testdata from https://github.com/gballet/go-ethereum/blob/kaustinen-with-shapella/trie/verkle_test.go
const presentKeys = [
  // Two keys with the same stem but different suffixes
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d01',
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
  // A key with a partially matching stem 0x318d to above 2 keys
  '0x318dfa512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
  // A key with a partially matching stem 0x318dfa51 to above key
  '0x318dfa513b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
  '0xe6ed6c222e3985050b4fc574b136b0a42c63538e9ab970995cd418ba8e526400',
  '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
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
  it.skip('should insert and retrieve values', async () => {
    const verkleCrypto = await loadVerkleCrypto()
    const tree = await VerkleTree.create({
      verkleCrypto,
      db: new MapDB<Uint8Array, Uint8Array>(),
    })

    const res = await tree.findPath(presentKeys[0])

    assert.ok(res.node === null, 'should not find a node when the key is not present')
    assert.deepEqual(res.remaining, presentKeys[0])

    // Test that two keys with the same stem store values in the same leaf node
    for (let i = 0; i < 2; i++) {
      await tree.put(presentKeys[i], values[i])
    }
    for (let i = 0; i < 2; i++) {
      const retrievedValue = await tree.get(presentKeys[i])
      if (retrievedValue === undefined) {
        assert.fail('Value not found')
      }
      assert.ok(equalsBytes(retrievedValue, values[i]))
    }

    // Test that one key that partially matches the stems of the two existing keys is inserted (with appropriate internal nodes inserted as well)
    for (let i = 2; i < 3; i++) {
      await tree.put(presentKeys[i], values[i])
    }
    for (let i = 2; i < 3; i++) {
      const retrievedValue = await tree.get(presentKeys[i])
      if (retrievedValue === undefined) {
        assert.fail('Value not found')
      }
      assert.ok(equalsBytes(retrievedValue, values[i]))
    }

    // Test that one key that with further partial match to the previous key is inserted (with appropriate internal nodes inserted as well)
    for (let i = 3; i < 4; i++) {
      await tree.put(presentKeys[i], values[i])
    }
    for (let i = 3; i < 4; i++) {
      const retrievedValue = await tree.get(presentKeys[i])
      if (retrievedValue === undefined) {
        assert.fail('Value not found')
      }
      assert.ok(equalsBytes(retrievedValue, values[i]))
    }

    // Get path to node at depth 2 and verify that the whole key is used
    const pathToDeepNode = await tree.findPath(presentKeys[2].slice(0, 31))
    assert.ok(pathToDeepNode.node !== null)
    assert.equal(pathToDeepNode.remaining.length, 0)
    // Verify that findPath returns a path that demonstrates the nonexistence of a key
    // by returning only the root node (in this instance where the trie has only a root internal node and 1 leaf node)
    // with a different stem than the one passed to `findPath`
    const pathToNonExistentNode = await tree.findPath(absentKeys[0])
    assert.equal(pathToNonExistentNode.node, null)
    assert.equal(pathToNonExistentNode.stack.length, 2, 'contains the root node in the stack')
  })
})

describe('findPath validation', () => {
  let verkleCrypto: VerkleCrypto
  beforeAll(async () => {
    verkleCrypto = await loadVerkleCrypto()
  })
  it('should find the path to various leaf nodes', async () => {
    const keys = [
      // Two keys with the same stem but different suffixes
      '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d01',
      '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
      // A key with a partially matching stem 0x318d to above 2 keys
      '0x318dfa512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
      // A key with a partially matching stem 0x318dfa51 to above key
      '0x318dfa513b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
    ]
    const values = [
      '0x320122e8584be00d000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0300000000000000000000000000000000000000000000000000000000000000',
    ]
    const trie = await VerkleTree.create({
      verkleCrypto,
      db: new MapDB<Uint8Array, Uint8Array>(),
    })

    await trie['_createRootNode']()

    let putStack: [Uint8Array, VerkleNode][] = []
    const stem1 = hexToBytes(keys[0]).slice(0, 31)
    // Create first leaf node
    const leafNode1 = await LeafNode.create(
      stem1,
      new Array(256).fill(new Uint8Array(32)),
      verkleCrypto
    )

    leafNode1.setValue(hexToBytes(keys[0])[31], hexToBytes(values[0]))
    leafNode1.setValue(hexToBytes(keys[1])[31], hexToBytes(values[1]))

    putStack.push([leafNode1.hash(), leafNode1])

    // Pull root node from DB
    const rawNode = await trie['_db'].get(trie.root())
    const rootNode = decodeNode(rawNode!, verkleCrypto) as InternalNode
    // Update root node with commitment from leaf node
    rootNode.setChild(stem1[0], { commitment: leafNode1.commitment, path: stem1 })
    trie.root(verkleCrypto.serializeCommitment(rootNode.commitment))
    putStack.push([trie.root(), rootNode])
    await trie.saveStack(putStack)

    // Verify that path to leaf node can be found from stem
    const res = await trie.findPath(stem1)
    assert.deepEqual(res.node?.commitment, leafNode1.commitment)

    // Retrieve a value from the leaf node
    const val1 = await trie.get(hexToBytes(keys[1]))
    assert.deepEqual(val1, hexToBytes(values[1]))

    // Put a second leaf node in the tree with a partially matching stem
    putStack = []
    const stem2 = hexToBytes(keys[2]).slice(0, 31)

    // Find path to closest node in tree
    const foundPath = await trie.findPath(stem2)

    // Confirm node with stem2 doesn't exist in trie
    assert.equal(foundPath.node, null)

    // Create new leaf node
    const leafNode2 = await LeafNode.create(
      stem2,
      new Array(256).fill(new Uint8Array(32)),
      verkleCrypto
    )
    leafNode2.setValue(hexToBytes(keys[2])[31], hexToBytes(values[2]))
    putStack.push([leafNode2.hash(), leafNode2])

    const nearestNode = foundPath.stack.pop()![0]
    // Verify that another leaf node is "nearest" node
    assert.equal(nearestNode.type, VerkleNodeType.Leaf)
    assert.deepEqual(nearestNode, leafNode1)

    // Compute the portion of stem1 and stem2 that match (i.e. the partial path closest to stem2)
    // Note: We subtract 1 since we are using 0-indexed arrays
    const partialMatchingStemIndex = matchingBytesLength(stem1, stem2) - 1
    // Find the path to the new internal node (the matching portion of stem1 and stem2)
    const internalNode1Path = stem1.slice(0, partialMatchingStemIndex)
    // Create new internal node
    const internalNode1 = InternalNode.create(verkleCrypto)

    // Update the child references for leafNode1 and leafNode 2
    internalNode1.setChild(stem1[partialMatchingStemIndex], {
      commitment: nearestNode.commitment,
      path: (nearestNode as LeafNode).stem,
    })
    internalNode1.setChild(stem2[partialMatchingStemIndex], {
      commitment: leafNode2.commitment,
      path: stem2,
    })

    putStack.push([internalNode1.hash(), internalNode1])
    // Update rootNode child reference for internal node 1

    const rootNodeFromPath = foundPath.stack.pop()![0] as InternalNode
    // Confirm node from findPath matches root
    assert.deepEqual(rootNodeFromPath, rootNode)
    rootNodeFromPath.setChild(internalNode1Path[0], {
      commitment: internalNode1.commitment,
      path: internalNode1Path,
    })
    trie.root(verkleCrypto.serializeCommitment(rootNodeFromPath.commitment))
    putStack.push([trie.root(), rootNodeFromPath])
    await trie.saveStack(putStack)
    let res2 = await trie.findPath(stem1)

    assert.equal(res2.remaining.length, 0, 'confirm full path was found')
    assert.equal(res2.stack.length, 2, 'confirm node is at depth 2')
    res2 = await trie.findPath(stem2)
    assert.equal(res2.remaining.length, 0, 'confirm full path was found')
    assert.equal(res2.stack.length, 2, 'confirm node is at depth 2')
    const val2 = await trie.get(hexToBytes(keys[2]))
    assert.deepEqual(val2, hexToBytes(values[2]), 'confirm values[2] can be retrieved from trie')
  })

  it.only('should put values and find them', async () => {
    const keys = [
      // Two keys with the same stem but different suffixes
      '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d01',
      '0x318dea512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
      // A key with a partially matching stem 0x318d to above 2 keys
      '0x318dfa512b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
      // A key with a partially matching stem 0x318dfa51 to above key
      '0x318dfa513b6f3237a2d4763cf49bf26de3b617fb0cabe38a97807a5549df4d02',
    ]
    const values = [
      '0x320122e8584be00d000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0300000000000000000000000000000000000000000000000000000000000000',
    ]
    const trie = await VerkleTree.create({
      verkleCrypto,
      db: new MapDB<Uint8Array, Uint8Array>(),
    })

    await trie['_createRootNode']()

    await trie.put(hexToBytes(keys[0]), hexToBytes(values[0]))
    await trie.put(hexToBytes(keys[1]), hexToBytes(values[1]))
    await trie.put(hexToBytes(keys[2]), hexToBytes(values[2]))
    await trie.put(hexToBytes(keys[3]), hexToBytes(values[3]))
    const val1 = await trie.get(hexToBytes(keys[0]))
    assert.deepEqual(val1, hexToBytes(values[0]))
    const val3 = await trie.get(hexToBytes(keys[2]))
    assert.deepEqual(val3, hexToBytes(values[2]))
    const res = await trie.findPath(hexToBytes(keys[3]).slice(0, 31))
    console.log(bytesToHex(res.stack[2][0].stem))
    console.log(res)
    // const val4 = await trie.get(hexToBytes(keys[3]))
    // assert.deepEqual(val4, hexToBytes(values[3]))
  })
})
