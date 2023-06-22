import { equalsBytes } from 'ethereum-cryptography/utils'

import { ProofDatabase } from '../db/index.js'
import { Trie } from '../trie/index.js'
import { bytesToNibbles, nibblesCompare, nibblesEqual, nibblestoBytes } from '../util/nibbles.js'

import { hasRightElement } from './rangeHelpers.js'

// VerifyRangeProof checks whether the given leaf nodes and edge proof
// can prove the given trie leaves range is matched with the specific root.
export async function _verifyRangeProof(
  this: Trie,
  rootHash: Uint8Array,
  firstKey: Uint8Array | number[] | undefined,
  lastKey: Uint8Array | number[] | undefined,
  keys: number[][],
  values: Uint8Array[],
  proof?: Uint8Array[]
): Promise<boolean> {
  if (firstKey instanceof Uint8Array) {
    firstKey = bytesToNibbles(firstKey)
  }
  if (lastKey instanceof Uint8Array) {
    lastKey = bytesToNibbles(lastKey)
  }
  if (keys.length !== values.length) {
    throw new Error(`Inconsistent proof data, keys: ${keys.length}, values: ${values.length}`)
  }

  // Ensure the received batch is monotonic increasing and contains no deletions
  for (let i = 0; i < keys.length - 1; i++) {
    if (nibblesCompare(keys[i], keys[i + 1]) >= 0) {
      throw new Error('Range is not monotonically increasing')
    }
  }
  for (const value of values) {
    if (value.length === 0) {
      throw new Error('Range contains deletion')
    }
  }

  // Special case, there is no edge proof at all. The given range is expected
  // to be the whole leaf-set in the trie.
  if (!proof) {
    const trie = new Trie({ secure: this.secure })
    for (let index = 0; index < keys.length; index++) {
      await trie.put(nibblestoBytes(keys[index]), values[index])
    }
    const hash = trie.root()
    if (!equalsBytes(hash, rootHash)) {
      return false
    }
    return true // No more elements
  }
  if (!firstKey || !lastKey) {
    throw new Error('Invalid edge keys')
  }

  // Special case, there is a provided edge proof but zero key/value pairs,
  // ensure there are no more accounts/slots in the trie.

  if (keys.length === 0) {
    const trie = new Trie({ secure: this.secure, hashFunction: this.hashFunction })
    const [root, val] = await trie.proofToPath(
      rootHash,
      null,
      firstKey,
      new ProofDatabase({ proof }),
      true
    )
    if (!root) {
      throw new Error('Invalid proof')
    }
    if (val || hasRightElement(root, firstKey, 0)) {
      throw new Error('More entries available')
    }
    return true
  }

  // Special case, there is only one element and two edge keys are the same.
  // In this case, we can't construct two edge paths. So handle it here.
  if (keys.length === 1 && nibblesEqual(firstKey, lastKey)) {
    const trie = new Trie({ secure: this.secure, hashFunction: this.hashFunction })
    const [root, val] = await trie.proofToPath(
      rootHash,
      null,
      firstKey,
      new ProofDatabase({ proof }),
      false
    )
    if (root === null) {
      return false
      // throw new Error('Invalid proof')
    }
    if (!nibblesEqual(firstKey, keys[0])) {
      return false
      // throw new Error('Correct proof but invalid key')
    }
    if (val && !equalsBytes(val, values[0])) {
      return false
      // throw new Error('Correct proof but invalid data')
    }
    return true
  }

  // Ok, in all other cases, we require two edge paths available.
  // First check the validity of edge keys.
  if (nibblesCompare(firstKey, lastKey) >= 0) {
    throw new Error('Invalid edge keys')
  }

  if (firstKey.length !== lastKey.length) {
    throw new Error('Inconsistent edge keys')
  }
  let trie = new Trie({ secure: this.secure, hashFunction: this.hashFunction })

  // Convert the edge proofs to edge trie paths. Then we can
  // have the same tree architecture with the original one.
  // For the first edge proof, non-existent proof is allowed.
  let root = (
    await trie.proofToPath(rootHash, null, firstKey, new ProofDatabase({ proof }), true)
  )[0]

  // Pass the root node here, the second path will be merged
  // with the first one. For the last edge proof, non-existent
  // proof is also allowed.
  root = (await trie.proofToPath(rootHash, root, lastKey, new ProofDatabase({ proof }), true))[0]

  // Remove all internal references. All the removed parts should
  // be re-filled(or re-constructed) by the given leaves range.
  // const empty = await trie.unset(root, firstKey, lastKey, keys, i, true, [])

  // Rebuild the trie with the leaf stream, the shape of trie
  // should be same with the original one.
  trie = new Trie({ root: root ?? undefined, secure: this.secure, hashFunction: this.hashFunction })
  // if (empty) {
  //   await trie.setRootNode(new NullNode({})) // Empty trie
  // }
  for (let index = 0; index < keys.length; index++) {
    await trie.put(nibblestoBytes(keys[index]), values[index])
  }
  // await trie.setRootByHash(rootHash)
  const hash = trie.root()
  if (!equalsBytes(hash, rootHash)) {
    return false
  }
  return true
}
