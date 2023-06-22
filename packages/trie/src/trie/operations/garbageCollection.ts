import { bytesToPrefixedHexString } from '@ethereumjs/util'
import { equalsBytes } from 'ethereum-cryptography/utils'

import { ROOT_DB_KEY } from '../../types'

import type { TNode } from '../node/types'
import type { TrieWithDB } from '../trieDB'

export async function _garbageCollect(this: TrieWithDB): Promise<void> {
  this.debug.extend('garbageCollect')(`Collecting`)
  const collected = [0, 0, 0]
  await this._withLock(async () => {
    const rootNode = await this.rootNode()
    this.debug.extend('garbageCollect')(
      `Collecting reachable nodes from root: ${bytesToPrefixedHexString(rootNode.hash())}`
    )
    this.debug.extend('garbageCollect')(
      `Collecting reachable nodes from root: ${bytesToPrefixedHexString(this.root())}`
    )
    const reachableHashes = await this.markReachableNodes(rootNode)
    this.debug.extend('garbageCollect')(`Collecting cache`)
    for (const hash of this.cache.keys()) {
      if (!reachableHashes.has(bytesToPrefixedHexString(hash))) {
        collected[0]++
        this.cache.delete(hash)
      }
    }
    this.debug.extend('garbageCollect')(`Collecting db`)
    for await (const hash of await this.database().keys()) {
      if (equalsBytes(hash, this.keySecure(ROOT_DB_KEY))) {
        continue
      }
      if (!reachableHashes.has(bytesToPrefixedHexString(hash))) {
        collected[1]++
        await this.database().del(hash)
      }
    }
  })
  this.debug.extend('garbageCollect')(
    `Collected: { map: ${collected[0]} cache: ${collected[1]} db: ${collected[2]} }`
  )
}

export async function _verifyPrunedIntegrity(this: TrieWithDB): Promise<boolean> {
  const reachableHashes = await this.markReachableNodes(await this.rootNode())
  for await (const key of await this.database().keys()) {
    if (equalsBytes(key, this.keySecure(ROOT_DB_KEY))) {
      continue
    }
    if (!reachableHashes.has(bytesToPrefixedHexString(key))) {
      return false
    }
  }
  return true
}

export async function _markReachableNodes(
  this: TrieWithDB,
  node: TNode | null,
  reachableHashes: Set<string> = new Set()
): Promise<Set<string>> {
  const debug = this.debug.extend('markReachableNodes')
  if (node === null || node.getType() === 'NullNode') {
    return reachableHashes
  }
  debug(`Marking reachable node: ${bytesToPrefixedHexString(node.hash())}`)
  debug(`Reachable nodes: ${reachableHashes.size}`)
  reachableHashes.add(bytesToPrefixedHexString(node.hash()))
  if (node.type === 'BranchNode') {
    for await (const [, childNode] of await node.getChildren()) {
      await this.markReachableNodes(childNode, reachableHashes)
    }
  } else if (node.type === 'ExtensionNode') {
    await this.markReachableNodes(await node.getChild(), reachableHashes)
  } else if (node.type === 'ProofNode') {
    node = await this.resolveProofNode(node)
    if (node.type === 'BranchNode') {
      for await (const [, childNode] of await node.getChildren()) {
        await this.markReachableNodes(childNode, reachableHashes)
      }
    } else if (node.type === 'ExtensionNode') {
      await this.markReachableNodes(await node.getChild(), reachableHashes)
    }
  }
  return reachableHashes
}
