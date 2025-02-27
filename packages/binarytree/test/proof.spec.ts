import { blake3 } from '@noble/hashes/blake3'
import { assert, describe, it } from 'vitest'

import { createBinaryTree } from '../src/constructors.js'
import { decodeBinaryNode } from '../src/index.js'
import { binaryTreeFromProof, verifyBinaryProof } from '../src/proof.js'

import type { StemBinaryNode } from '../src/node/stemNode.js'

// Create an array of 100 random key/value pairs by hashing keys.

const keyValuePairs: { originalKey: Uint8Array; hashedKey: Uint8Array; value: Uint8Array }[] = []

for (let i = 0; i < 100; i++) {
  const key = new Uint8Array(32).fill(0)
  key[31] = i // vary the last byte to differentiate keys

  const hashedKey = blake3(key)

  // Create a value also based on i (filled with 0xBB and ending with i)
  const value = new Uint8Array(32).fill(1)
  value[31] = i

  keyValuePairs.push({ originalKey: key, hashedKey, value })
}

describe('binary tree proof', async () => {
  const tree1 = await createBinaryTree()

  // Insert each key/value pair into the tree.
  for (const { hashedKey, value } of keyValuePairs) {
    const stem = hashedKey.slice(0, 31)
    const index = hashedKey[31]
    await tree1.put(stem, [index], [value])
  }

  it('should create and verify a merkle proof for existing key', async () => {
    // create merkle proof for first key/value pair
    const proof = await tree1.createBinaryProof(keyValuePairs[0].hashedKey)

    const rootNode = decodeBinaryNode(proof[0])
    assert.deepEqual(
      tree1['merkelize'](rootNode),
      tree1.root(),
      'first value in proof should be root node',
    )
    const valueNode = decodeBinaryNode(proof[proof.length - 1]) as StemBinaryNode
    assert.deepEqual(
      keyValuePairs[0].value,
      valueNode.values[keyValuePairs[0].hashedKey[31]],
      'last value in proof should be target node',
    )

    // create sparse tree from proof
    const tree2 = await binaryTreeFromProof(proof)
    assert.deepEqual(
      tree2.root(),
      tree1.root(),
      'tree from proof should be created with correct root node',
    )

    // get value from sparse tree
    const [value] = await tree2.get(keyValuePairs[0].hashedKey.slice(0, 31), [
      keyValuePairs[0].hashedKey[31],
    ])
    assert.deepEqual(value, keyValuePairs[0].value)

    // verify proof using verifyBinaryProof
    const proofValue = await verifyBinaryProof(tree1.root(), keyValuePairs[0].hashedKey, proof)
    assert.deepEqual(keyValuePairs[0].value, proofValue, 'verify proof should return target value')
  })

  it('should create and verify a proof of non-existence', async () => {
    const fakeKey = new Uint8Array(keyValuePairs[0].hashedKey.length).fill(5)

    const proof = await tree1.createBinaryProof(fakeKey)
    const proofValue = await verifyBinaryProof(tree1.root(), fakeKey, proof)
    assert.deepEqual(proofValue, undefined, 'verify proof of non-existence should return undefined')
  })
})
