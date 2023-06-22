import { bytesToPrefixedHexString, hexStringToBytes } from '@ethereumjs/util'
import debug from 'debug'

import { BranchNode, ExtensionNode, LeafNode, Trie } from '../trie/index.js'

import { findCommonPrefix, nibblestoBytes } from './nibbles'

import type { TNode } from '../trie/node/types'
import type { TrieWrap } from '../trie/trieWrapper'
import type { Debugger } from 'debug'

export function partitionByCommonPrefix(
  sortedEntries: Array<[number[], string]>
): [number[], number[]][][] {
  const partitions = new Map<string, Set<number[]>>()
  let currentPrefix: number[] = sortedEntries[0][0]
  for (const [i, [key, _value]] of sortedEntries.entries()) {
    if (sortedEntries.length === 1) {
      partitions.set(JSON.stringify([]), new Set([key]))
    } else {
      if (i === 0) {
        const prefix = findCommonPrefix(key, sortedEntries[i + 1][0])
        partitions.set(JSON.stringify(prefix.commonPrefix), new Set([key]))
        continue
      }
      let prefix = findCommonPrefix(key, currentPrefix)
      if (i < sortedEntries.length - 1) {
        const prefixB = findCommonPrefix(key, sortedEntries[i + 1][0])
        prefix = prefix.commonPrefix.length > prefixB.commonPrefix.length ? prefix : prefixB
      }
      // if (i === 1) {
      //   partitions.set(JSON.stringify(prefix.commonPrefix), new Set([currentPrefix, key]))
      //   currentPrefix = key
      //   continue
      // }
      if (partitions.has(JSON.stringify(prefix.commonPrefix))) {
        const p = partitions.get(JSON.stringify(prefix.commonPrefix))!
        p.add(key)
        partitions.set(JSON.stringify(prefix.commonPrefix), p)
      } else {
        partitions.set(JSON.stringify(prefix.commonPrefix), new Set([key]))
      }

      currentPrefix = key
    }
  }
  const partitionedKeys: string[] = [...partitions.keys()].sort((a, b) => a.length - b.length)
  const partitionedEntries: [string, Set<number[]>][] = partitionedKeys.map((k) => [
    k,
    partitions.get(k)!,
  ])
  return partitionedEntries.map(([k, v]) => {
    return [...v.values()].map((_v) => [JSON.parse(k), _v.slice(JSON.parse(k).length)])
  })
}

// function startsWith(entries: [string, number[]][][], prefix: number[]) {
//   let formatted = entries.flat(1)
//   for (const [i, p] of prefix.entries()) {
//     formatted = formatted.filter(
//       (f) => (f[0].length > i && f[1][i] === p) || (f[0].length <= i && f[1][i - f[0].length] === p)
//     )
//   }
//   return formatted.map((f) => JSON.stringify(f))
// }
// function filterKeys(keys: string[]) {
//   const flat: (string | null)[] = keys
//   const cat = keys.map((ps) => {
//     const [p, s] = JSON.parse(ps!)
//     return JSON.stringify([...p, ...s])
//   })
//   const repeats: [boolean, number, number][] = cat.map((v, i, a) => [
//     a.indexOf(v) === i,
//     i,
//     a.indexOf(v),
//   ])
//   const notFirst = repeats.filter((r) => r[0] === false)
//   const first = notFirst.map((v) => v[2])
//   for (const f of first) {
//     flat[f] = null
//   }
//   const filtered = flat.filter((f) => f !== null)
//   return filtered
// }

// function filterEverything(entries: [number[], number[]][][]): string[] {
//   const everything: ([number[], number[]] | null)[] = entries.flat()
//   for (const thing of everything) {
//     console.log(JSON.stringify(thing))
//   }

//   console.log('filterEverything', entries.length)
//   console.log('filterEvery', everything.length, 'everything')
//   const filteredEverything: string[] = []
//   const cats = everything.map((ps) => {
//     const [p, s] = ps!
//     return JSON.stringify([...p, ...s])
//   })
//   console.log('cats', cats.length, cats)
//   const repeats: [boolean, number, number][] = cats.map((v, i) => {
//     return [cats.indexOf(v) === i, i, cats.indexOf(v)]
//   })
//   console.log('repeats', repeats.length, repeats)
//   const notFirst = repeats.filter((r) => r[0] === false)
//   console.log('notFirst', notFirst.length, notFirst)
//   const first = notFirst.map((v) => v[2])
//   for (const f of first) {
//     everything[f] = null
//   }
//   const filtered = filteredEverything.filter((f) => f !== null)
//   // let c = 0
//   // for (let i = 0; i < 16; i++) {
//   //   console.log('filtering', i)
//   //   const startsWithI = startsWith(entries, [i])
//   //   const filteredI: string[] = filterKeys(startsWithI) as string[]
//   //   filteredI.sort((a, b) => {
//   //     const [aP, aS] = JSON.parse(a)
//   //     const [bP, bS] = JSON.parse(b)
//   //     const aV = bytesToPrefixedHexString(Uint8Array.from([...aP, ...aS]))
//   //     const bV = bytesToPrefixedHexString(Uint8Array.from([...bP, ...bS]))
//   //     return Number(BigInt(aV) - BigInt(bV))
//   //   })
//   //   const alteredI = filteredI.map((f, _i) => {
//   //     const [p, s] = JSON.parse(f)
//   //     const alt = JSON.stringify([
//   //       ...p.map((_p: number) => {
//   //         return [_p]
//   //       }),
//   //       [s[0]],
//   //       s.slice(1),
//   //     ])
//   //     console.log('alt', c++, alt)
//   //     return alt
//   //   })
//   //   filteredEverything.push(...alteredI)
//   // }
//   for (const [i, thing] of filtered.entries()) {
//     console.log('filtered', `${i}/${entries.flat().length}`, JSON.stringify(thing))
//   }
//   return filtered
// }

export function compareNibbleArray(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return a.length - b.length
}
export const parseBulk = (entries: [number[], string][]): [[number[], number[]], string][] => {
  const entryMap = new Map(entries.map(([k, v]) => [JSON.stringify(k), v]))
  const sortedEntries = entries.sort(([keyA, _s], [keyB, _sb]) => {
    return compareNibbleArray(keyA, keyB)
  })
  const partitioned = partitionByCommonPrefix(sortedEntries)
  return partitioned.flat().map((key, _i) => {
    key[1].length > 0 && key[0].push(key[1].shift()!)
    const value = entryMap.get(JSON.stringify(key.flat()))!
    return [key, value]
  })
}

export async function bulkInsert(
  this: Trie,
  entries: Array<[number[], string]>
): Promise<Uint8Array> {
  // Sort the entries by key
  entries.sort(([keyA], [keyB]) => {
    return compareNibbleArray(keyA, keyB)
  })
  const batch: Map<string, Uint8Array> = new Map()
  for await (const [i, [key, value]] of entries.entries()) {
    this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(
      `Key: ${bytesToPrefixedHexString(nibblestoBytes(key))}`
    )
    this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(`nibbles: ${key}`)
    if (i === 0) {
      await this.put(nibblestoBytes(key), hexStringToBytes(value))
      continue
    }
    // Otherwise, compare with the previous entry
    const [prevKey] = entries[i - 1]
    // Find common prefix
    const prefix = findCommonPrefix(key.flat(), prevKey)
    // Fetch the node where keys diverge
    this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(
      `Get Node at common prefix: ${prefix.commonPrefix}`
    )
    let divergingNode = (
      await this._getNodePath(
        prefix.commonPrefix,
        this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)
      )
    ).node
    // Insert the new entry into the diverging node
    if (divergingNode instanceof BranchNode) {
      this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(
        `BranchNode: ${bytesToPrefixedHexString(divergingNode.hash())}`
      )
      // Insert into the correct slot in the branch node
      const restKey = prefix.commonPrefix.length > 0 ? key.slice(prefix.commonPrefix.length) : key
      const childIdx = restKey[0]
      const divergentChild = await divergingNode.getChild(childIdx)
      if (divergentChild.getType() === 'NullNode') {
        this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(
          `No Child at index ${childIdx}`
        )
        divergingNode = divergingNode.updateChild(
          new LeafNode({ key: restKey.slice(1), value: hexStringToBytes(value) }),
          restKey[0]
        )
      } else {
        this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(
          `${divergentChild.getType()} Child at index ${childIdx}`
        )
        divergingNode = await this._insertAtNode(
          divergingNode,
          restKey,
          hexStringToBytes(value),
          this.debug
        )
      }
      this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(
        `${divergingNode.getType()}: ${bytesToPrefixedHexString(divergingNode.hash())}`
      )
      // await this.setRootNode(divergingNode)
      batch.set(bytesToPrefixedHexString(divergingNode.hash()), divergingNode.rlpEncode())

      // await this.storeNode(newBranchNode)
    } else if (divergingNode instanceof ExtensionNode) {
      this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)('ExtensionNode')
      // Replace the extension node with a branch node
      const restKey = key.slice(prefix.commonPrefix.length)
      const oldChild = await divergingNode.getChild()
      if (oldChild instanceof BranchNode) {
        const newBranchNode = oldChild.setChild(
          restKey[0],
          new LeafNode({ key: restKey.slice(1), value: hexStringToBytes(value) })
        )
        batch.set(bytesToPrefixedHexString(newBranchNode.hash()), newBranchNode.rlpEncode())
        await this.storeNode(newBranchNode)
        this.root(newBranchNode.hash())
      } else {
        let branchNode = new BranchNode({ value: null })
        branchNode = branchNode.setChild(
          restKey[0],
          new LeafNode({ key: restKey.slice(1), value: hexStringToBytes(value) })
        )
        branchNode = branchNode.setChild(
          oldChild.getPartialKey()[0],
          oldChild.updateKey(oldChild.getPartialKey().slice(1))
        )
        batch.set(bytesToPrefixedHexString(branchNode.hash()), branchNode.rlpEncode())
        await this.storeNode(branchNode)
        this.root(branchNode.hash())
      }
      // await this.setRootNode(divergingNode)
    } else {
      this.debug.extend('bulkInsert').extend(`[${i + 1} / ${entries.length}]`)(`newNode: ${key}`)
      // Insert a new node
      await this.put(nibblestoBytes(key), hexStringToBytes(value))
    }
  }
  this.debug.extend('bulkInsert').extend(`[${entries.length}]`)(
    `trie built. root: ${bytesToPrefixedHexString(this.root())}  updating DB...`
  )

  const batchInput: { type: 'put' | 'del'; key: Uint8Array; value?: Uint8Array }[] = []
  for await (const [i, [key, value]] of [...batch.entries()].entries()) {
    this.debug.extend('bulkInsert').extend('batch')(`[${i + 1} / ${batch.size}] -x-`)
    const pushed = batchInput.push({
      type: 'put' as const,
      key: hexStringToBytes(key),
      value,
    })
    this.debug
      .extend('bulkInsert')
      .extend('batch')
      .extend(`[${i + 1} / ${batch.size}]`)(pushed)
  }
  await this.database().batch(batchInput)
  const newRoot = await this._cleanupNode(await this.rootNode())
  await this.storeNode(newRoot)
  this.root(newRoot.hash())
  return this.root()
}

export async function _insertNodeAtNode(
  node: TNode,
  pathNibbles: number[],
  newNode: LeafNode,
  debug: Debugger
): Promise<TNode> {
  debug = debug.extend('_insertNodeAtNode')
  debug(`inserting node: ${newNode.getPartialKey()}`)
  debug(`at: ${pathNibbles}`)
  if (pathNibbles.length === 0) {
    // We've reached the desired node position.
    return newNode
  } else {
    const [nextNibble, ...restPath] = pathNibbles
    let updatedBranchNode: TNode
    if (node.type === 'BranchNode') {
      // If the current node is a BranchNode, we will update it.
      updatedBranchNode = node as BranchNode
    } else {
      // If the current node isn't a BranchNode, we will create a new one.
      updatedBranchNode = new BranchNode({ value: null })
    }
    // Get the next node (if exists).
    let nextNode = await updatedBranchNode.getChild(nextNibble)
    if (nextNode.getType() === 'NullNode') {
      nextNode = new BranchNode({ value: null })
    }
    // Recursively call `_insertNodeAtNode` on the next node.
    const updatedNextNode = await _insertNodeAtNode(nextNode, restPath, newNode, debug)
    // Update the current BranchNode to point to the updated next node.
    updatedBranchNode = updatedBranchNode.updateChild(updatedNextNode, nextNibble)

    return updatedBranchNode
  }
}

export interface LeafNodeInput {
  newNode: LeafNode
  pathNibbles: number[]
}

export type BulkNodeInput = LeafNodeInput[]
export async function cleanupTrie(trie: Trie, debug: Debugger): Promise<Trie> {
  debug = debug.extend('cleanupTrie')
  debug(`Cleaning up trie: ${bytesToPrefixedHexString(trie.root())}`)
  // Depth-First Search stack
  const stack: TNode[] = [await trie.rootNode()]

  while (stack.length > 0) {
    const node = stack.pop()

    if (node) {
      debug(`Cleaning up node: ${node.hash()}`)
      // Perform the cleanup operation on the node

      // If the node is a branch node, push all its children to the stack
      if (node.type === 'BranchNode') {
        const branchNode = node as BranchNode
        for (let i = 0; i < 16; i++) {
          const child = await branchNode.getChild(i)
          if (child.getType() !== 'NullNode' && child.getType() !== 'ProofNode') {
            const cleanupChild = await trie._cleanupNode(child)
            node.updateChild(cleanupChild, i)
            stack.push(cleanupChild)
          }
        }
      }
      // Replace the original node with the cleaned node
      const cleanedNode = await trie._cleanupNode(node)
      await trie.storeNode(cleanedNode)
    }
  }
  // await trie.setRootNode(rootNode)
  return trie
}
export async function insertBatch(
  nodeInputs: BulkNodeInput,
  secure: boolean = false,
  dbug: Debugger = debug('Trie')
): Promise<TrieWrap> {
  dbug = dbug.extend('insertBatch')
  const trie = new Trie({ secure, persistent: true })
  if (nodeInputs.length === 1) {
    const { newNode, pathNibbles } = nodeInputs[0]
    const newRoot = newNode.updateKey([...pathNibbles, ...newNode.getPartialKey()])
    await trie.storeNode(newRoot)
    trie.root(newRoot.hash())
    return trie
  }
  // Sort the nodeInputs array by pathNibbles to ensure we're inserting nodes in order of their position in the Trie.
  // This way, we can maximize the reuse of previously created or updated BranchNodes.
  // nodeInputs.sort((a, b) => {
  //   const len = Math.min(a.pathNibbles.length, b.pathNibbles.length)
  //   for (let i = 0; i < len; i++) {
  //     if (a.pathNibbles[i] !== b.pathNibbles[i]) {
  //       return a.pathNibbles[i] - b.pathNibbles[i]
  //     }
  //   }
  //   return a.pathNibbles.length - b.pathNibbles.length
  // })

  // We will use a reference to the root of the Trie, which will be updated during the insertions.

  let rootNode = await trie.rootNode()
  for await (const [i, nodeInput] of nodeInputs.entries()) {
    dbug.extend('insertBatch').extend(`[${i + 1}/${nodeInputs.length}]`)(
      `[${nodeInput.pathNibbles}...${nodeInput.newNode.getPartialKey()}]`
    )
    dbug.extend('insertBatch').extend(`[${i + 1}/${nodeInputs.length}]`)(
      `insert leaf for key:
      ${bytesToPrefixedHexString(
        nibblestoBytes([...nodeInput.pathNibbles, ...nodeInput.newNode.getPartialKey()])
      )}`
    )
    dbug.extend(`${nodeInput.pathNibbles}`)(`Inserting node: ${nodeInput.newNode.getPartialKey()}`)
    // Insert the node and update the rootNode reference.
    rootNode = await _insertNodeAtNode(rootNode, nodeInput.pathNibbles, nodeInput.newNode, dbug)
    // rootNode = await trie._cleanupNode(rootNode)
  }
  rootNode = await trie._cleanupNode(rootNode)
  await trie.storeNode(rootNode)
  trie.root(rootNode.hash())
  return cleanupTrie(trie, trie.debug)
}
