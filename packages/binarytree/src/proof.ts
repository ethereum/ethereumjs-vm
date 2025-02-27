import { equalsBytes } from '@ethereumjs/util'

import { createBinaryTree } from './constructors.js'
import { decodeBinaryNode } from './node/index.js'

import type { BinaryTree } from './binaryTree.js'
import type { BinaryNode } from './node/index.js'
import type { StemBinaryNode } from './node/stemNode.js'

/**
 * Saves the nodes from a proof into the tree.
 * @param proof
 */
export async function binaryTreeFromProof(_proof: Uint8Array[]): Promise<BinaryTree> {
  const proofTrie = await createBinaryTree()
  const putStack: [Uint8Array, BinaryNode][] = _proof.map((bytes) => {
    const node = decodeBinaryNode(bytes)
    return [proofTrie['merkelize'](node), node]
  })
  await proofTrie.saveStack(putStack)
  const root = putStack[0][0]
  proofTrie.root(root)
  return proofTrie
}

/**
 * Verifies a proof.
 * @param rootHash
 * @param key
 * @param proof
 * @throws If proof is found to be invalid.
 * @returns The value from the key, or null if valid proof of non-existence.
 */
export async function verifyBinaryProof(
  rootHash: Uint8Array,
  key: Uint8Array,
  proof: Uint8Array[],
): Promise<Uint8Array | null> {
  const proofTrie = await binaryTreeFromProof(proof)
  const [value] = await proofTrie.get(key.slice(0, 31), [key[31]])
  const valueNode = decodeBinaryNode(proof[proof.length - 1]) as StemBinaryNode
  const expectedValue = valueNode.values[key[31]]
  if (!expectedValue) {
    if (value) {
      throw new Error('Proof is invalid')
    }
  } else if (value && !equalsBytes(value, expectedValue)) {
    throw new Error('Proof is invalid')
  }
  return value
}
