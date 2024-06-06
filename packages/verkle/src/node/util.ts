import { RLP } from '@ethereumjs/rlp'
import { bigIntToBytes, bytesToBigInt, setLengthRight } from '@ethereumjs/util'

import { InternalNode } from './internalNode.js'
import { LeafNode } from './leafNode.js'
import { type VerkleNode, VerkleNodeType } from './types.js'

export function decodeRawNode(raw: Uint8Array[]): VerkleNode {
  const nodeType = raw[0][0]
  const depth = 0
  switch (nodeType) {
    case VerkleNodeType.Internal:
      return InternalNode.fromRawNode(raw, depth)
    case VerkleNodeType.Leaf:
      return LeafNode.fromRawNode(raw, depth)
    default:
      throw new Error('Invalid node type')
  }
}

export function decodeNode(raw: Uint8Array) {
  const decoded = RLP.decode(Uint8Array.from(raw)) as Uint8Array[]
  if (!Array.isArray(decoded)) {
    throw new Error('Invalid node')
  }
  return decodeRawNode(decoded)
}

export function isRawNode(node: Uint8Array | Uint8Array[]): node is Uint8Array[] {
  return Array.isArray(node) && !(node instanceof Uint8Array)
}

/***
 * Converts 128 32byte values of a leaf node into 16 byte values for generating a commitment for half of a
 * leaf node's values
 * @param values - an array of Uint8Arrays representing the first or second 128 values stored by verkle trie leaf node
 * @param deletedValues - an array of booleans where a value of true at a given position indicates a value
 * that is being deleted - should always be false if generating C2 values
 * Returns an array of 256 16byte UintArrays with the leaf marker set for each value that is deleted
 */
export const createCValues = (values: Uint8Array[], deletedValues = new Array(128).fill(false)) => {
  if (values.length !== 128 || deletedValues.length !== 128)
    throw new Error(`got wrong number of values, expected 128, got ${values.length}`)
  const expandedValues: Uint8Array[] = new Array(256)
  for (let x = 0; x < 128; x++) {
    // We add 16 trailing zeros to each value since all commitments are to an array of 32 byte values
    expandedValues[x] = setLengthRight(
      deletedValues[x] === true
        ? // TODO: Improve performance by only flipping the 129th bit of `expandedValues[x]` (instead of bigint addition)
          bigIntToBytes(bytesToBigInt(values[x].subarray(0, 16)) + BigInt(2 ** 128))
        : values[x].slice(0, 16),
      32
    )
    // TODO: Decide if we should use slice or subarray here (i.e. do we need to copy these slices or not)
    expandedValues[x + 1] = setLengthRight(values[x].slice(16), 32)
  }
  return expandedValues
}