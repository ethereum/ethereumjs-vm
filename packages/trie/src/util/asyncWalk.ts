import { RLP } from '@ethereumjs/rlp'
import { equalsBytes } from '@ethereumjs/util'
// TODO: replace with bytesToHex from @ethereumjs/util
import { toHex } from 'ethereum-cryptography/utils.js' // eslint-disable-line

import { BranchNode } from '../node/branch.js'
import { ExtensionNode } from '../node/extension.js'

import type { Trie } from '../trie.js'
import type { TrieNode } from '../types.js'

export type NodeFilter = (node: TrieNode, key: number[]) => Promise<boolean>
export type OnFound = (node: TrieNode, key: number[]) => Promise<any>

/**
 * Walk Trie via async generator
 * @param nodeHash - The root key to walk on.
 * @param currentKey - The current (partial) key.
 * @param onFound - Called on every node found (before filter)
 * @param filter - Filter nodes yielded by the generator.
 * @param visited - Set of visited nodes
 * @returns AsyncIterable<{ node: TrieNode; currentKey: number[] }>
 * Iterate through nodes with
 * `for await (const { node, currentKey } of trie._walkTrie(root)) { ... }`
 */
export async function* _walkTrie(
  this: Trie,
  nodeHash: Uint8Array,
  currentKey: number[] = [],
  onFound: OnFound = async (_trieNode: TrieNode, _key: number[]) => {},
  filter: NodeFilter = async (_trieNode: TrieNode, _key: number[]) => true,
  visited: Set<string> = new Set<string>(),
): AsyncIterable<{ node: TrieNode; currentKey: number[] }> {
  if (equalsBytes(nodeHash, this.EMPTY_TRIE_ROOT)) {
    return
  }
  try {
    const node = await this.lookupNode(nodeHash)
    if (node === undefined || visited.has(toHex(this.hash(node!.serialize())))) {
      return
    }
    visited.add(toHex(this.hash(node!.serialize())))
    await onFound(node!, currentKey)
    if (await filter(node!, currentKey)) {
      yield { node: node!, currentKey }
    }
    if (node instanceof BranchNode) {
      for (const [nibble, childNode] of node._branches.entries()) {
        const nextKey = [...currentKey, nibble]
        const _childNode: Uint8Array =
          childNode instanceof Uint8Array ? childNode : this.hash(RLP.encode(childNode))
        yield* _walkTrie.bind(this)(_childNode, nextKey, onFound, filter, visited)
      }
    } else if (node instanceof ExtensionNode) {
      const childNode = node.value()
      const nextKey = [...currentKey, ...node._nibbles]
      yield* _walkTrie.bind(this)(childNode, nextKey, onFound, filter, visited)
    }
  } catch {
    return
  }
}
