import { bytesToPrefixedHexString, equalsBytes, hexStringToBytes } from '@ethereumjs/util'

import { bytesToNibbles } from '../../util/nibbles'

import type { ExtensionNode } from '../node'
import type { TNode } from '../node/types'
import type { TrieWrap } from '../trieWrapper'
import type { Debugger } from 'debug'

// export async function verifyProof(
//   root: Uint8Array,
//   key: Uint8Array,
//   proof: Uint8Array[],
//   d_bug: Debugger = debug('trie')
// ): Promise<Uint8Array | null | false> {
//   d_bug = d_bug.extend('_verifyProof')
//   d_bug(
//     `Verifying proof (length: ${proof.length}) against rootHash: ${bytesToPrefixedHexString(
//       keccak256(proof[0])
//     )}`
//   )
//   let node: Uint8Array[] = RLP.decode(proof[0]) as Uint8Array[]
//   const path = bytesToNibbles(key)
//   d_bug.extend('path')(path)
//   for await (const p of proof.slice(1)) {
//     d_bug(`path remaining: ${path}`)
//     d_bug(`searching child on index ${path[0]}`)
//     const child = node[path[0]]?.length > 0 ? node[path[0]] : new NullNode({}).hash()
//     if (child.length === 0) {
//       d_bug(`Child not found on index ${path[0]}`)
//       return false
//     }
//     node = RLP.decode(p) as Uint8Array[]
//     path.shift()
//   }
//   if (node.length === 2) {
//     d_bug.extend('LeafNode')(
//       `Proof verification successful for key: ${bytesToPrefixedHexString(key)}`
//     )
//     return node[1] as Uint8Array
//   } else if (node.length === 17) {
//     if (path.length === 0) {
//       d_bug.extend('BranchNode')(`path length = 0.  returning ${node[16]}`)
//       return node[16] as Uint8Array
//     } else if ((node[path[0]] as Uint8Array).length > 0) {
//       d_bug.extend('BranchNode')(`Proof verification successful for key: ${key}`)
//       return node[path[0]] as Uint8Array
//     } else {
//       d_bug.extend('BranchNode')(`Proof verification failed for key: ${key} on index ${path[0]}`)
//       return false
//     }
//   } else {
//     d_bug.extend('else')(`Proof verification failed for key: ${key}`)
//     return false
//   }
// }
// export async function fromProof(
//   proof: Uint8Array[],
//   d_bug: Debugger = debug('trie')
// ): Promise<TrieWrap> {
//   d_bug = d_bug.extend('fromProof')
//   d_bug(`Building Trie from proof`)
//   if (!proof.length) {
//     throw new Error('Proof is empty')
//   }
//   const trie = new TrieWrap({ secure: true, debug: d_bug })
//   for (const [i, p] of proof.reverse().entries()) {
//     d_bug(`ProofNode ${i + 1}/${proof.length}`)
//     const encoded = p
//     const hash = trie.hashFunction(encoded)
//     const node = await trie._decodeToNode(encoded, d_bug)
//     d_bug = d_bug.extend(node.getType())
//     d_bug(`Storing with hash: ${bytesToPrefixedHexString(node.hash())}`)
//     await trie.storeNode(node, d_bug)
//     if (i === 0) {
//       trie.rootNode = node
//     }
//   }
//   return trie
// }
export async function createProof(
  this: TrieWrap,
  key: Uint8Array,
  debug: Debugger = this.debug
): Promise<Uint8Array[]> {
  debug = debug.extend('createProof')
  let node: TNode | undefined = await this.rootNode()
  let childNode: TNode | undefined
  key = this.keySecure(key)
  const nibbles = bytesToNibbles(key)
  debug(`Creating proof for key: ${bytesToPrefixedHexString(key)}`)
  debug(`nibbles: [${nibbles}]`)
  debug = debug.extend('root')
  debug(`nibbles: [${node.getPartialKey()}]`)
  let nibbleIndex = 0
  const proof: Uint8Array[] = []
  let dbValue: Uint8Array | undefined | string
  while (nibbleIndex <= nibbles.length) {
    debug(`${node.getType()} => [${node.getPartialKey()}]`)
    switch (node.getType()) {
      case 'ProofNode':
        dbValue = await this.database().get(node.hash())
        if (dbValue === undefined) {
          debug(`Path led to proof node with hash: ${node.hash()}`)
          debug(`Returning Proof with ${proof.length} nodes`)
          proof.push(node.hash())
          return proof
        }
        node = await this._decodeToNode(hexStringToBytes(dbValue.toString()))
        break
      case 'LeafNode':
        proof.push(node.rlpEncode())
        debug = debug.extend(`[${nibbles[nibbleIndex]}]`)
        this.debug.extend('createProof')(
          `Reached LeafNode.  Returning proof with ${proof.length} nodes`
        )
        for (const [idx, p] of proof.entries()) {
          this.debug.extend('createProof').extend(idx.toString())(bytesToPrefixedHexString(p))
          this.debug.extend('createProof').extend(idx.toString()).extend('hash')(
            bytesToPrefixedHexString(this.hashFunction(p)).slice(0, 16)
          )
        }
        return proof
      case 'BranchNode':
        proof.push(node.rlpEncode())
        childNode = await node.getChild(nibbles[nibbleIndex])
        if (childNode.getType() === 'NullNode') {
          return proof
        }
        debug = debug.extend(`[${nibbles[nibbleIndex]}]`)
        nibbleIndex++
        node = childNode
        break
      case 'ExtensionNode':
        proof.push(node.rlpEncode())
        node = node as ExtensionNode
        debug = debug.extend(`[-]`)
        nibbleIndex += node.getPartialKey().length
        node = await node.getChild()
    }

    if (node.getType() === 'LeafNode') {
      debug = debug.extend(`[${nibbles[nibbleIndex]}]`).extend('LeafNode')
      proof.push(node.rlpEncode())
      return proof
    }
  }
  proof.push(node.rlpEncode())
  return proof
}
export async function updateFromProof(
  this: TrieWrap,
  proof: Uint8Array[],
  debug: Debugger = this.debug
): Promise<void> {
  await this._withLock(async () => {
    debug = debug.extend('updateFromProof')
    debug(`Updating Trie from proof`)
    if (!proof.length) {
      throw new Error('Proof is empty')
    }
    debug(`Proof length: ${proof.length} [${proof.map((p) => p.length)}]`)
    const proofRoot = proof[0]
    if (!equalsBytes(this.root(), this.EMPTY_TRIE_ROOT)) {
      if (!equalsBytes(this.root(), this.hashFunction(proofRoot))) {
        debug(`Proof root: ${bytesToPrefixedHexString(this.root())}`)
        debug(`trie root: ${bytesToPrefixedHexString(this.hashFunction(proofRoot))}`)
        throw new Error(
          `ProofRoot: ${bytesToPrefixedHexString(
            proofRoot
          )} does not match root: ${bytesToPrefixedHexString(
            this.root()
          )} !== ${bytesToPrefixedHexString(this.hashFunction(this.EMPTY_TRIE_ROOT))}}`
        )
      }
    }
    for (const p of proof.slice()) {
      await this.database().put(this.hashFunction(p), p)
    }
  })
}
