import {
  bigIntToBytes,
  bytesToBigInt,
  bytesToInt32,
  concatBytes,
  int32ToBytes,
  intToBytes,
  setLengthLeft,
  setLengthRight,
  toBytes,
} from './bytes.js'

import type { Account } from './account.js'
import type { Address } from './address.js'
import type { PrefixedHexString } from './types.js'

/**
 * @dev Returns the 31-bytes binary tree stem for a given address and tree index.
 * @param hashFunction The hashFunction for the binary tree
 * @param {Address} address The address to generate the tree key for.
 * @param treeIndex The index of the tree to generate the key for. Defaults to 0.
 * @return The 31-bytes binary tree stem as a Uint8Array.
 */
export function getBinaryTreeStem(
  hashFunction: (value: Uint8Array) => Uint8Array,
  address: Address,
  treeIndex: number | bigint = 0,
): Uint8Array {
  const address32 = setLengthLeft(address.toBytes(), 32)

  let treeIndexBytes: Uint8Array
  if (typeof treeIndex === 'number') {
    treeIndexBytes = setLengthRight(int32ToBytes(Number(treeIndex), true), 32)
  } else {
    treeIndexBytes = setLengthRight(bigIntToBytes(BigInt(treeIndex), true).slice(0, 32), 32)
  }

  const treeStem = hashFunction(concatBytes(address32, treeIndexBytes)).slice(0, 31)

  return treeStem
}

export interface BinaryTreeStateDiff {
  stem: PrefixedHexString
  suffixDiffs: {
    currentValue: PrefixedHexString | null
    newValue: PrefixedHexString | null
    suffix: number | string
  }[]
}

// TODO: This is a placeholder type, the actual type is not yet defined
export type BinaryTreeProof = any

/**
 * Experimental, object format could eventual change.
 * An object that provides the state and proof necessary for binary tree stateless execution
 * */
export interface BinaryTreeExecutionWitness {
  /**
   * The stateRoot of the parent block
   */
  parentStateRoot: PrefixedHexString
  /**
   * An array of state diffs.
   * Each item corresponding to state accesses or state modifications of the block.
   * In the current design, it also contains the resulting state of the block execution (post-state).
   */
  stateDiff: BinaryTreeStateDiff[]
  /**
   * The proof for the block.
   * Proves that the provided stateDiff belongs to the canonical binary tree.
   */
  proof: any
}

export enum BinaryTreeLeafType {
  BasicData = 0,
  CodeHash = 1,
}

export type BinaryTreeLeafBasicData = {
  version: number
  nonce: bigint
  balance: bigint
  codeSize: number
}

export const BINARY_TREE_VERSION_OFFSET = 0
export const BINARY_TREE_CODE_SIZE_OFFSET = 5
export const BINARY_TREE_NONCE_OFFSET = 8
export const BINARY_TREE_BALANCE_OFFSET = 16

export const BINARY_TREE_VERSION_BYTES_LENGTH = 1
export const BINARY_TREE_CODE_SIZE_BYTES_LENGTH = 3
export const BINARY_TREE_NONCE_BYTES_LENGTH = 8
export const BINARY_TREE_BALANCE_BYTES_LENGTH = 16

export const BINARY_TREE_BASIC_DATA_LEAF_KEY = intToBytes(BinaryTreeLeafType.BasicData)
export const BINARY_TREE_CODE_HASH_LEAF_KEY = intToBytes(BinaryTreeLeafType.CodeHash)

export const BINARY_TREE_CODE_CHUNK_SIZE = 31
export const BINARY_TREE_HEADER_STORAGE_OFFSET = 64
export const BINARY_TREE_CODE_OFFSET = 128
export const BINARY_TREE_NODE_WIDTH = 256
export const BINARY_TREE_MAIN_STORAGE_OFFSET = BigInt(256) ** BigInt(BINARY_TREE_CODE_CHUNK_SIZE)

/**
 * @dev Returns the tree key for a given binary tree stem, and sub index.
 * @dev Assumes that the tree node width = 256
 * @param stem The 31-bytes binary tree stem as a Uint8Array.
 * @param subIndex The sub index of the tree to generate the key for as a Uint8Array.
 * @return The tree key as a Uint8Array.
 */
export const getBinaryTreeKey = (stem: Uint8Array, leaf: BinaryTreeLeafType | Uint8Array) => {
  switch (leaf) {
    case BinaryTreeLeafType.BasicData:
      return concatBytes(stem, BINARY_TREE_BASIC_DATA_LEAF_KEY)
    case BinaryTreeLeafType.CodeHash:
      return concatBytes(stem, BINARY_TREE_CODE_HASH_LEAF_KEY)
    default:
      return concatBytes(stem, leaf)
  }
}

/**
 * Calculates the position of the storage key in the BinaryTree tree, determining
 * both the tree index (the node in the tree) and the subindex (the position within the node).
 * @param {bigint} storageKey - The key representing a specific storage slot.
 * @returns {Object} - An object containing the tree index and subindex
 */
export function getBinaryTreeTreeIndicesForStorageSlot(storageKey: bigint): {
  treeIndex: bigint
  subIndex: number
} {
  let position: bigint
  if (storageKey < BINARY_TREE_CODE_OFFSET - BINARY_TREE_HEADER_STORAGE_OFFSET) {
    position = BigInt(BINARY_TREE_HEADER_STORAGE_OFFSET) + storageKey
  } else {
    position = BINARY_TREE_MAIN_STORAGE_OFFSET + storageKey
  }

  const treeIndex = position / BigInt(BINARY_TREE_NODE_WIDTH)
  const subIndex = Number(position % BigInt(BINARY_TREE_NODE_WIDTH))

  return { treeIndex, subIndex }
}

/**
 * Calculates the position of the code chunks in the BinaryTree tree, determining
 * both the tree index (the node in the tree) and the subindex (the position within the node).
 * @param {bigint} chunkId - The ID representing a specific chunk.
 * @returns {Object} - An object containing the tree index and subindex
 */
export function getBinaryTreeTreeIndicesForCodeChunk(chunkId: number) {
  const treeIndex = Math.floor((BINARY_TREE_CODE_OFFSET + chunkId) / BINARY_TREE_NODE_WIDTH)
  const subIndex = (BINARY_TREE_CODE_OFFSET + chunkId) % BINARY_TREE_NODE_WIDTH
  return { treeIndex, subIndex }
}

/**
 * Asynchronously calculates the BinaryTree tree key for the specified code chunk ID.
 * @param {Address} address - The account address to access code for.
 * @param {number} chunkId - The ID of the code chunk to retrieve.
 * @param hashFunction - The hash function used for BinaryTree-related operations.
 * @returns {Uint8Array} - The BinaryTree tree key as a byte array.
 */
export const getBinaryTreeTreeKeyForCodeChunk = (
  address: Address,
  chunkId: number,
  hashFunction: (input: Uint8Array) => Uint8Array,
) => {
  const { treeIndex, subIndex } = getBinaryTreeTreeIndicesForCodeChunk(chunkId)
  return concatBytes(getBinaryTreeStem(hashFunction, address, treeIndex), toBytes(subIndex))
}

// This code was written by robots based on the reference implementation in EIP-7864
export const chunkifyCode = (code: Uint8Array) => {
  const PUSH1 = 0x60 // Assuming PUSH1 is defined as 0x60
  const PUSH32 = 0x7f // Assuming PUSH32 is defined as 0x7f
  const PUSH_OFFSET = 0x5f // Assuming PUSH_OFFSET is defined as 0x5f

  // Calculate padding length
  const paddingLength = (31 - (code.length % 31)) % 31
  const paddedCode = new Uint8Array(code.length + paddingLength)
  paddedCode.set(code)

  // Pre-allocate the bytesToExecData array
  const bytesToExecData = new Uint8Array(paddedCode.length + 32)

  let pos = 0
  while (pos < paddedCode.length) {
    let pushdataBytes = 0
    if (PUSH1 <= paddedCode[pos] && paddedCode[pos] <= PUSH32) {
      pushdataBytes = paddedCode[pos] - PUSH_OFFSET
    }
    pos += 1
    for (let x = 0; x < pushdataBytes; x++) {
      bytesToExecData[pos + x] = pushdataBytes - x
    }
    pos += pushdataBytes
  }

  // Pre-allocate the chunks array
  const numChunks = Math.ceil(paddedCode.length / 31)
  const chunks = new Array<Uint8Array>(numChunks)

  for (let i = 0, pos = 0; i < numChunks; i++, pos += 31) {
    const chunk = new Uint8Array(32)
    chunk[0] = Math.min(bytesToExecData[pos], 31)
    chunk.set(paddedCode.subarray(pos, pos + 31), 1)
    chunks[i] = chunk
  }

  return chunks
}

/**
 * Asynchronously calculates the BinaryTree tree key for the specified storage slot.
 * @param {Address} address - The account address to access code for.
 * @param {bigint} storageKey - The storage slot key to retrieve the key for.
 * @param hashFunction - The hash function used in the Binary Tree.
 * @returns {Uint8Array} - The BinaryTree tree key as a byte array.
 */
export const getBinaryTreeTreeKeyForStorageSlot = (
  address: Address,
  storageKey: bigint,
  hashFunction: (input: Uint8Array) => Uint8Array,
) => {
  const { treeIndex, subIndex } = getBinaryTreeTreeIndicesForStorageSlot(storageKey)

  return concatBytes(getBinaryTreeStem(hashFunction, address, treeIndex), intToBytes(subIndex))
}

/**
 * This function extracts and decodes account header elements (version, nonce, code size, and balance)
 * from an encoded `Uint8Array` representation of raw BinaryTree leaf-node basic data. Each component is sliced
 * from the `encodedBasicData` array based on predefined offsets and lengths, and then converted
 * to its appropriate type (integer or BigInt).
 * @param {Uint8Array} encodedBasicData - The encoded BinaryTree leaf basic data containing the version, nonce,
 * code size, and balance in a compact Uint8Array format.
 * @returns {BinaryTreeLeafBasicData} - An object containing the decoded version, nonce, code size, and balance.
 */
export function decodeBinaryTreeLeafBasicData(
  encodedBasicData: Uint8Array,
): BinaryTreeLeafBasicData {
  const versionBytes = encodedBasicData.slice(0, BINARY_TREE_VERSION_BYTES_LENGTH)
  const nonceBytes = encodedBasicData.slice(
    BINARY_TREE_NONCE_OFFSET,
    BINARY_TREE_NONCE_OFFSET + BINARY_TREE_NONCE_BYTES_LENGTH,
  )
  const codeSizeBytes = encodedBasicData.slice(
    BINARY_TREE_CODE_SIZE_OFFSET,
    BINARY_TREE_CODE_SIZE_OFFSET + BINARY_TREE_CODE_SIZE_BYTES_LENGTH,
  )
  const balanceBytes = encodedBasicData.slice(
    BINARY_TREE_BALANCE_OFFSET,
    BINARY_TREE_BALANCE_OFFSET + BINARY_TREE_BALANCE_BYTES_LENGTH,
  )

  const version = bytesToInt32(versionBytes)
  const nonce = bytesToBigInt(nonceBytes)
  const codeSize = bytesToInt32(codeSizeBytes)
  const balance = bytesToBigInt(balanceBytes)

  return { version, nonce, codeSize, balance }
}

/**
 * This function takes a `BinaryTreeLeafBasicData` object and encodes its properties
 * (version, nonce, code size, and balance) into a compact `Uint8Array` format. Each
 * property is serialized and padded to match the required byte lengths defined by
 * EIP-7864. Additionally, 4 bytes are reserved for future use as specified
 * in EIP-7864.
 * @param {Account} account - An object containing the version, nonce,
 *   code size, and balance to be encoded.
 * @returns {Uint8Array} - A compact bytes representation of the account header basic data.
 */
export function encodeBinaryTreeLeafBasicData(account: Account): Uint8Array {
  const encodedVersion = setLengthLeft(
    int32ToBytes(account.version),
    BINARY_TREE_VERSION_BYTES_LENGTH,
  )
  // Per EIP-7864, bytes 1-4 are reserved for future use
  const reservedBytes = new Uint8Array([0, 0, 0, 0])
  const encodedNonce = setLengthLeft(bigIntToBytes(account.nonce), BINARY_TREE_NONCE_BYTES_LENGTH)
  const encodedCodeSize = setLengthLeft(
    int32ToBytes(account.codeSize),
    BINARY_TREE_CODE_SIZE_BYTES_LENGTH,
  )
  const encodedBalance = setLengthLeft(
    bigIntToBytes(account.balance),
    BINARY_TREE_BALANCE_BYTES_LENGTH,
  )
  return concatBytes(encodedVersion, reservedBytes, encodedCodeSize, encodedNonce, encodedBalance)
}

/**
 * Helper method to generate the suffixes for code chunks for putting code
 * @param numChunks number of chunks to generate suffixes for
 * @returns number[] - an array of numbers corresponding to the code chunks being put
 */
export const generateChunkSuffixes = (numChunks: number) => {
  if (numChunks === 0) return []
  const chunkSuffixes: number[] = new Array<number>(numChunks)
  let currentSuffix = BINARY_TREE_CODE_OFFSET
  for (let x = 0; x < numChunks; x++) {
    chunkSuffixes[x] = currentSuffix
    currentSuffix++
    // Reset suffix to 0 if exceeds BINARY_TREE_NODE_WIDTH
    if (currentSuffix >= BINARY_TREE_NODE_WIDTH) currentSuffix = 0
  }

  return chunkSuffixes
}

/**
 * Helper method for generating the code stems necessary for putting code
 * @param numChunks the number of code chunks to be put
 * @param address the address of the account getting the code
 * @param hashFunction an initialized {@link BinaryTreeCrypto} object
 * @returns an array of stems for putting code
 */
export function generateCodeStems(
  numChunks: number,
  address: Address,
  hashFunction: (input: Uint8Array) => Uint8Array,
): Uint8Array[] {
  // The maximum number of chunks is 793 (maxCodeSize - 24576) / (bytes per chunk 31) + (round up - 1)
  // Code is stored in chunks starting at leaf index 128 of the leaf node corresponding to the stem of the code's address
  // Code chunks beyond the initial 128 are stored in additional leaf nodes in batches up of up to 256 chunks per leaf node
  // so the maximum number of leaf nodes that can hold contract code for a specific address is 4 leaf nodes (128 chunks in
  // the first leaf node and 256 chunks in up to 3 additional leaf nodes)
  // So, instead of computing every single leaf key (which is a heavy operation), we just compute the stem for the first
  // chunk in each leaf node and can then know that the chunks in between have tree keys in monotonically increasing order
  const numStems =
    numChunks > BINARY_TREE_CODE_OFFSET ? Math.ceil(numChunks / BINARY_TREE_NODE_WIDTH) + 1 : 1
  const chunkStems = new Array<Uint8Array>(numStems)
  // Compute the stem for the initial set of code chunks
  chunkStems[0] = getBinaryTreeTreeKeyForCodeChunk(address, 0, hashFunction).slice(0, 31)

  for (let stemNum = 0; stemNum < numStems - 1; stemNum++) {
    // Generate additional stems
    const firstChunkKey = getBinaryTreeTreeKeyForCodeChunk(
      address,
      BINARY_TREE_CODE_OFFSET + stemNum * BINARY_TREE_NODE_WIDTH,
      hashFunction,
    )
    chunkStems[stemNum + 1] = firstChunkKey.slice(0, 31)
  }
  return chunkStems
}
