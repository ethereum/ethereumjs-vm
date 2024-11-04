import { bytesToHex, concatBytes, equalsBytes } from '@ethereumjs/util'

import { LeafVerkleNode, LeafVerkleNodeValue, decodeVerkleNode } from './node/index.js'

import type { VerkleTree } from './verkleTree.js'
import type { PrefixedHexString } from '@ethereumjs/util'

/**
 * Recursively walks down the tree from a given starting node and returns all the leaf values
 * @param tree - The verkle tree
 * @param startingNode - The starting node
 * @returns An array of key-value pairs containing the tree keys and associated values
 */
export const dumpLeafValues = async (
  tree: VerkleTree,
  startingNode: Uint8Array,
): Promise<[PrefixedHexString, PrefixedHexString][] | undefined> => {
  if (equalsBytes(startingNode, tree.EMPTY_TREE_ROOT) === true) return
  // Retrieve starting node from DB
  const rawNode = await tree['_db'].get(startingNode)
  if (rawNode === undefined) return
  const node = decodeVerkleNode(rawNode, tree['verkleCrypto'])
  const entries: [PrefixedHexString, PrefixedHexString][] = []
  if (node instanceof LeafVerkleNode) {
    for (const [idx, val] of node.values.entries()) {
      if (val !== LeafVerkleNodeValue.Untouched) {
        entries.push([
          bytesToHex(concatBytes(node.stem, Uint8Array.from([idx]))),
          bytesToHex(val === LeafVerkleNodeValue.Deleted ? new Uint8Array(32) : val),
        ])
      }
    }
    return entries
  } else {
    const childPaths = node.children
      .filter((value) => value !== null)
      .map((value) => dumpLeafValues(tree, tree['verkleCrypto'].hashCommitment(value!.commitment)))

    const res = (await Promise.all(childPaths)).filter((val) => val !== undefined)
    return res.flat(1) as [PrefixedHexString, PrefixedHexString][]
  }
}
/**
 * Recursively walks down the tree from a given starting node and returns all the node paths and hashes
 * @param tree - The verkle tree
 * @param startingNode - The starting node
 * @returns An array of key-value pairs containing the tree paths and associated hashes
 */
export const dumpNodeHashes = async (
  tree: VerkleTree,
  startingNode: Uint8Array,
): Promise<[PrefixedHexString, PrefixedHexString][] | undefined> => {
  let entries: [PrefixedHexString, PrefixedHexString][] = []
  // Retrieve starting node from DB
  const rawNode = await tree['_db'].get(startingNode)
  if (rawNode === undefined) return

  const node = decodeVerkleNode(rawNode, tree['verkleCrypto'])
  // If current node is root, push '0x' for path and node hash for commitment
  equalsBytes(startingNode, tree.root()) && entries.push(['0x', bytesToHex(startingNode)])
  if (node instanceof LeafVerkleNode) {
    // Leaf node paths/hashes were added in the previous inner node's iteration
    return []
  } else {
    const children = node.children.filter((value) => value !== null)
    for (const child of children) {
      entries.push([
        bytesToHex(child!.path),
        bytesToHex(tree['verkleCrypto'].hashCommitment(child!.commitment)),
      ])
    }
    const childPaths = children.map((value) =>
      dumpNodeHashes(tree, tree['verkleCrypto'].hashCommitment(value!.commitment)),
    )
    const res = (await Promise.all(childPaths)).filter((val) => val !== undefined)
    entries = [...entries, ...(res.flat(1) as [PrefixedHexString, PrefixedHexString][])]
  }
  return entries
}
