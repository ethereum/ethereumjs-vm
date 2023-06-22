import { bytesToPrefixedHexString, equalsBytes } from '@ethereumjs/util'

import type { FoundNodeFunction, WalkFilterFunction } from '../../types'
import type { MerklePatriciaTrie } from '../merklePatricia'
import type { BranchNode } from '../node'
import type { TNode } from '../node/types'
import type { TrieWrap } from '../trieWrapper'

// Experimental Walk Iterators

export async function* _walk(
  this: MerklePatriciaTrie,
  node: TNode | null,
  currentKey: number[] = [],
  onFound: FoundNodeFunction = async (_trieNode: TNode, _key: number[]) => {},
  filter: WalkFilterFunction = async (_trieNode: TNode, _key: number[]) => true
): AsyncIterable<{ node: TNode; currentKey: number[] }> {
  if (node === null) {
    return
  }
  if (await filter(node, currentKey)) {
    await onFound(node, currentKey)
    yield { node, currentKey }
  }
  switch (node.type) {
    case 'BranchNode': {
      for (const [nibble, childNode] of (await (node as BranchNode).childNodes()).entries()) {
        const nextKey = [...currentKey, nibble]
        yield* this._walk(childNode, nextKey, onFound, filter)
      }
      break
    }
    case 'ExtensionNode': {
      const childNode = await this.getNode(
        (await node.getChild()).hash(),
        this.debug.extend('_walk')
      )
      const nextKey = [...currentKey, ...node.keyNibbles]
      yield* this._walk(childNode, nextKey, onFound, filter)
      break
    }
    default:
      break
  }
}

export async function* walkTrie(
  this: TrieWrap,
  startNodeHash: Uint8Array = this.root(),
  _currentKey: number[] = [],
  onFound: FoundNodeFunction = async (_trieNode: TNode, _key: number[]) => {},
  filter: WalkFilterFunction = async (_trieNode: TNode, _key: number[]) => true
): AsyncIterable<TNode> {
  if (equalsBytes(startNodeHash, this.EMPTY_TRIE_ROOT)) {
    return
  }
  type Task = {
    node: TNode
    fullKey: number[]
  }
  const startNode = await this.lookupNodeByHash(startNodeHash)
  if (!startNode) {
    throw new Error(`Node with hash ${bytesToPrefixedHexString(startNodeHash)} not found`)
  }
  const tasks: Task[] = [
    {
      node: startNode,
      fullKey: _currentKey,
    },
  ]
  // Set to store hashes of visited nodes
  const visited = new Set<string>()
  while (tasks.length > 0) {
    const { node, fullKey } = tasks.pop()! // we know tasks.length > 0
    if (visited.has(node.hash().toString())) {
      // Skip this node as we have already visited it
      continue
    }
    visited.add(node.hash().toString())
    if (await filter(node, fullKey)) {
      await onFound(node, fullKey)
      yield node
    }
    switch (node.type) {
      case 'BranchNode': {
        for (const [nibble, childNode] of (await (node as BranchNode).childNodes()).entries()) {
          const nextKey = [...fullKey, nibble]
          tasks.push({ node: childNode, fullKey: nextKey })
        }
        break
      }
      case 'ExtensionNode': {
        const childNode = await this.getNode((await node.getChild()).hash())
        const nextKey = [...fullKey, ...node.keyNibbles]
        tasks.push({ node: childNode, fullKey: nextKey })
        break
      }
      default:
        break
    }
  }
}

export async function* _walkTrieRecursively(
  this: TrieWrap,
  nodeHash: Uint8Array,
  currentKey: number[] = [],
  onFound: FoundNodeFunction = async (_trieNode: TNode, _key: number[]) => {},
  filter: WalkFilterFunction = async (_trieNode: TNode, _key: number[]) => true,
  visited: Set<string> = new Set<string>() // Added visited set
): AsyncIterable<{ node: TNode; currentKey: number[] }> {
  const node = await this.lookupNodeByHash(nodeHash)
  if (node === undefined || visited.has(bytesToPrefixedHexString(node.hash()))) {
    return
  }
  visited.add(bytesToPrefixedHexString(node.hash()))
  if (await filter(node, currentKey)) {
    await onFound(node, currentKey)
    yield { node, currentKey }
  }
  switch (node.type) {
    case 'BranchNode': {
      for (const [nibble, childNode] of (await (node as BranchNode).childNodes()).entries()) {
        const nextKey = [...currentKey, nibble]
        yield* this._walkTrieRecursively(childNode.hash(), nextKey, onFound, filter, visited)
      }
      break
    }
    case 'ExtensionNode': {
      const childNode = await node.getChild()
      const nextKey = [...currentKey, ...node.getPartialKey()]
      yield* this._walkTrieRecursively(childNode.hash(), nextKey, onFound, filter, visited)
      break
    }
    default:
      break
  }
}
