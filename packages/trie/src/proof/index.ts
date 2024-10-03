import { bytesToHex, concatBytes, equalsBytes } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'

import { createTrieFromProof } from '../constructors.js'
import { MerklePatriciaTrie, verifyRangeProof } from '../index.js'
import { bytesToNibbles } from '../util/nibbles.js'

import type { MPTOpts, Proof } from '../index.js'
import type { PutBatch } from '@ethereumjs/util'

/**
 * An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes
 * from the root node to the leaf node storing state data.
 * @param rootHash Root hash of the trie that this proof was created from and is being verified for
 * @param key Key that is being verified and that the proof is created for
 * @param proof An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes from the root node to the leaf node storing state data.
 * @param opts optional, the opts may include a custom hashing function to use with the trie for proof verification
 * @throws If proof is found to be invalid.
 * @returns The value from the key, or null if valid proof of non-existence.
 */
export async function verifyMPTProof(
  key: Uint8Array,
  proof: Proof,
  opts?: MPTOpts,
): Promise<Uint8Array | null> {
  try {
    const proofTrie = await createTrieFromProof(proof, opts)
    const value = await proofTrie.get(key, true)
    return value
  } catch (err) {
    if (!(err instanceof Error)) {
      err = new Error(err)
    }
    throw new Error('Invalid proof provided')
  }
}

// /**
//  * A range proof is a proof that includes the encoded trie nodes from the root node to leaf node for one or more branches of a trie,
//  * allowing an entire range of leaf nodes to be validated. This is useful in applications such as snap sync where contiguous ranges
//  * of state trie data is received and validated for constructing world state, locally. Also see {@link verifyRangeProof}.
//  * @param rootHash - root hash of state trie this proof is being verified against.
//  * @param firstKey - first key of range being proven.
//  * @param lastKey - last key of range being proven.
//  * @param keys - key list of leaf data being proven.
//  * @param values - value list of leaf data being proven, one-to-one correspondence with keys.
//  * @param proof - proof node list, if all-elements-proof where no proof is needed, proof should be null, and both `firstKey` and `lastKey` must be null as well
//  * @param opts - optional, the opts may include a custom hashing function to use with the trie for proof verification
//  * @returns a flag to indicate whether there exists more trie node in the trie
//  */
export function verifyMPTRangeProof(
  rootHash: Uint8Array,
  firstKey: Uint8Array | null,
  lastKey: Uint8Array | null,
  keys: Uint8Array[],
  values: Uint8Array[],
  proof: Uint8Array[] | null,
  opts?: MPTOpts,
): Promise<boolean> {
  return verifyRangeProof(
    rootHash,
    firstKey && bytesToNibbles(firstKey),
    lastKey && bytesToNibbles(lastKey),
    keys.map((k) => k).map(bytesToNibbles),
    values,
    proof,
    opts?.useKeyHashingFunction ?? keccak256,
  )
}

/**
 * Creates a proof from a trie and key that can be verified using {@link verifyMPTProof}. An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains
 * the encoded trie nodes from the root node to the leaf node storing state data. The returned proof will be in the format of an array that contains Uint8Arrays of
 * serialized branch, extension, and/or leaf nodes.
 * @param key key to create a proof for
 */
export async function createMerkleProof(trie: MerklePatriciaTrie, key: Uint8Array): Promise<Proof> {
  trie['DEBUG'] && trie['debug'](`Creating Proof for Key: ${bytesToHex(key)}`, ['create_proof'])
  const { stack } = await trie.findPath(trie['appliedKey'](key))
  const p = stack.map((stackElem) => {
    return stackElem.serialize()
  })
  trie['DEBUG'] && trie['debug'](`Proof created with (${stack.length}) nodes`, ['create_proof'])
  return p
}

/**
 * Updates a trie from a proof by putting all the nodes in the proof into the trie. Pass {@param shouldVerifyRoot} as true to check
 * that root key of proof matches root of trie and throw if not.
 * An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes from the root node to the leaf node storing state data.
 * @param proof An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof to update the trie from.
 * @param shouldVerifyRoot - defaults to false. If `true`, verifies that the root key of the proof matches the trie root and throws if not (i.e invalid proof).
 * @returns The root of the proof
 */
export async function updateTrieFromMerkleProof(
  trie: MerklePatriciaTrie,
  proof: Proof,
  shouldVerifyRoot: boolean = false,
) {
  trie['DEBUG'] && trie['debug'](`Saving (${proof.length}) proof nodes in DB`, ['from_proof'])
  const opStack = proof.map((nodeValue) => {
    let key = Uint8Array.from(trie['hash'](nodeValue))
    key = trie['_opts'].keyPrefix ? concatBytes(trie['_opts'].keyPrefix, key) : key
    return {
      type: 'put',
      key,
      value: nodeValue,
    } as PutBatch
  })

  if (shouldVerifyRoot) {
    if (opStack[0] !== undefined && opStack[0] !== null) {
      if (!equalsBytes(trie.root(), opStack[0].key)) {
        throw new Error('The provided proof does not have the expected trie root')
      }
    }
  }

  await trie['_db'].batch(opStack)
  if (opStack[0] !== undefined) {
    return opStack[0].key
  }
}

/**
 * Verifies a proof by putting all of its nodes into a trie and attempting to get the proven key. An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof
 * contains the encoded trie nodes from the root node to the leaf node storing state data.
 * @param rootHash Root hash of the trie that this proof was created from and is being verified for
 * @param key Key that is being verified and that the proof is created for
 * @param proof an EIP-1186 proof to verify the key against
 * @throws If proof is found to be invalid.
 * @returns The value from the key, or null if valid proof of non-existence.
 */
export async function verifyMerkleProof(
  trie: MerklePatriciaTrie,
  rootHash: Uint8Array,
  key: Uint8Array,
  proof: Proof,
): Promise<Uint8Array | null> {
  trie['DEBUG'] &&
    trie['debug'](
      `Verifying Proof:\n|| Key: ${bytesToHex(key)}\n|| Root: ${bytesToHex(
        rootHash,
      )}\n|| Proof: (${proof.length}) nodes
  `,
      ['VERIFY_PROOF'],
    )
  const proofTrie = new MerklePatriciaTrie({
    root: rootHash,
    useKeyHashingFunction: trie['_opts'].useKeyHashingFunction,
    common: trie['_opts'].common,
  })
  try {
    await updateTrieFromMerkleProof(proofTrie, proof, true)
  } catch (e) {
    if (!(e instanceof Error)) {
      e = new Error(e)
    }
    throw new Error('Invalid proof nodes given')
  }
  try {
    trie['DEBUG'] &&
      trie['debug'](`Verifying proof by retrieving key: ${bytesToHex(key)} from proof trie`, [
        'VERIFY_PROOF',
      ])
    const value = await proofTrie.get(trie['appliedKey'](key), true)
    trie['DEBUG'] && trie['debug'](`PROOF VERIFIED`, ['VERIFY_PROOF'])
    return value
  } catch (err) {
    if (!(err instanceof Error)) {
      err = new Error(err)
    }
    if (err.message === 'Missing node in DB') {
      throw new Error('Invalid proof provided')
    } else {
      throw err
    }
  }
}

export * from './range.js'
