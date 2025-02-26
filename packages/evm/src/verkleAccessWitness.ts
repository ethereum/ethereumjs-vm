import { VerkleAccessedStateType } from '@ethereumjs/common'
import {
  BIGINT_0,
  EthereumJSErrorWithoutCode,
  VERKLE_BASIC_DATA_LEAF_KEY,
  VERKLE_CODE_HASH_LEAF_KEY,
  VERKLE_CODE_OFFSET,
  VERKLE_HEADER_STORAGE_OFFSET,
  VERKLE_MAIN_STORAGE_OFFSET,
  VERKLE_NODE_WIDTH,
  bytesToHex,
  equalsBytes,
  getVerkleKey,
  getVerkleStem,
  getVerkleTreeIndicesForCodeChunk,
  getVerkleTreeIndicesForStorageSlot,
  hexToBytes,
  intToBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'

import { ChunkCache } from './chunkCache.js'
import { StemCache } from './stemCache.js'

import type {
  AccessEventFlags,
  RawVerkleAccessedState,
  VerkleAccessWitnessInterface,
  VerkleAccessedState,
  VerkleAccessedStateWithAddress,
} from '@ethereumjs/common'
import type { StatefulVerkleStateManager } from '@ethereumjs/statemanager'
import type {
  Address,
  PrefixedHexString,
  VerkleCrypto,
  VerkleExecutionWitness,
} from '@ethereumjs/util'
import type { VerkleTree } from '@ethereumjs/verkle'

const debug = debugDefault('evm:verkle:aw')

/**
 * Tree key constants.
 */
const WitnessBranchReadCost = BigInt(1900)
const WitnessChunkReadCost = BigInt(200)
const WitnessBranchWriteCost = BigInt(3000)
const WitnessChunkWriteCost = BigInt(500)
const WitnessChunkFillCost = BigInt(6200)

// read is a default access event if stem or chunk is present
export type StemAccessEvent = { write?: boolean }
// chunk fill access event is not being charged right now in kaustinen but will be rectified
// in upcoming iterations
export type ChunkAccessEvent = StemAccessEvent & { fill?: boolean }

// Since stem is pedersen hashed, it is useful to maintain the reverse relationship
export type StemMeta = { address: Address; treeIndex: number | bigint }

export function decodeAccessedState(
  treeIndex: number | bigint,
  chunkIndex: number,
): VerkleAccessedState {
  const position = BigInt(treeIndex) * BigInt(VERKLE_NODE_WIDTH) + BigInt(chunkIndex)
  switch (position) {
    case BigInt(0):
      return { type: VerkleAccessedStateType.BasicData }
    case BigInt(1):
      return { type: VerkleAccessedStateType.CodeHash }
    default:
      if (position < VERKLE_HEADER_STORAGE_OFFSET) {
        throw Error(`No attribute yet stored >=2 and <${VERKLE_HEADER_STORAGE_OFFSET}`)
      }

      if (position >= VERKLE_HEADER_STORAGE_OFFSET && position < VERKLE_CODE_OFFSET) {
        const slot = position - BigInt(VERKLE_HEADER_STORAGE_OFFSET)
        return { type: VerkleAccessedStateType.Storage, slot }
      } else if (position >= VERKLE_CODE_OFFSET && position < VERKLE_MAIN_STORAGE_OFFSET) {
        const codeChunkIdx = Number(position) - VERKLE_CODE_OFFSET
        return {
          type: VerkleAccessedStateType.Code,
          codeOffset: codeChunkIdx * 31,
        }
      } else if (position >= VERKLE_MAIN_STORAGE_OFFSET) {
        const slot = BigInt(position - VERKLE_MAIN_STORAGE_OFFSET)
        return { type: VerkleAccessedStateType.Storage, slot }
      } else {
        throw Error(
          `Invalid treeIndex=${treeIndex} chunkIndex=${chunkIndex} for verkle tree access`,
        )
      }
  }
}

export class VerkleAccessWitness implements VerkleAccessWitnessInterface {
  stems: Map<PrefixedHexString, StemAccessEvent & StemMeta>
  chunks: Map<PrefixedHexString, ChunkAccessEvent>
  stemCache: StemCache = new StemCache()
  chunkCache: ChunkCache = new ChunkCache()
  verkleCrypto: VerkleCrypto
  constructor(opts: {
    verkleCrypto: VerkleCrypto
    stems?: Map<PrefixedHexString, StemAccessEvent & StemMeta>
    chunks?: Map<PrefixedHexString, ChunkAccessEvent>
  }) {
    if (opts.verkleCrypto === undefined) {
      throw EthereumJSErrorWithoutCode('verkle crypto required')
    }
    this.verkleCrypto = opts.verkleCrypto
    this.stems = opts.stems ?? new Map<PrefixedHexString, StemAccessEvent & StemMeta>()
    this.chunks = opts.chunks ?? new Map<PrefixedHexString, ChunkAccessEvent>()
  }

  readAccountBasicData(address: Address): bigint {
    return this.touchAddressOnReadAndComputeGas(address, 0, VERKLE_BASIC_DATA_LEAF_KEY)
  }

  writeAccountBasicData(address: Address): bigint {
    return this.touchAddressOnWriteAndComputeGas(address, 0, VERKLE_BASIC_DATA_LEAF_KEY)
  }

  readAccountCodeHash(address: Address): bigint {
    return this.touchAddressOnReadAndComputeGas(address, 0, VERKLE_CODE_HASH_LEAF_KEY)
  }

  writeAccountCodeHash(address: Address): bigint {
    return this.touchAddressOnWriteAndComputeGas(address, 0, VERKLE_CODE_HASH_LEAF_KEY)
  }

  readAccountHeader(address: Address): bigint {
    let gas = BIGINT_0

    gas += this.readAccountBasicData(address)
    gas += this.readAccountCodeHash(address)

    return gas
  }

  writeAccountHeader(address: Address): bigint {
    let gas = BIGINT_0

    gas += this.writeAccountBasicData(address)
    gas += this.writeAccountCodeHash(address)

    return gas
  }

  readAccountCodeChunks(contract: Address, startPc: number, endPc: number): bigint {
    let gas = BIGINT_0
    for (let chunkNum = Math.floor(startPc / 31); chunkNum <= Math.floor(endPc / 31); chunkNum++) {
      const { treeIndex, subIndex } = getVerkleTreeIndicesForCodeChunk(chunkNum)
      gas += this.touchAddressOnReadAndComputeGas(contract, treeIndex, subIndex)
    }
    return gas
  }

  writeAccountCodeChunks(contract: Address, startPc: number, endPc: number): bigint {
    let gas = BIGINT_0
    for (let chunkNum = Math.floor(startPc / 31); chunkNum <= Math.floor(endPc / 31); chunkNum++) {
      const { treeIndex, subIndex } = getVerkleTreeIndicesForCodeChunk(chunkNum)
      gas += this.touchAddressOnWriteAndComputeGas(contract, treeIndex, subIndex)
    }
    return gas
  }

  readAccountStorage(address: Address, storageSlot: bigint): bigint {
    const { treeIndex, subIndex } = getVerkleTreeIndicesForStorageSlot(storageSlot)
    return this.touchAddressOnReadAndComputeGas(address, treeIndex, subIndex)
  }

  writeAccountStorage(address: Address, storageSlot: bigint): bigint {
    const { treeIndex, subIndex } = getVerkleTreeIndicesForStorageSlot(storageSlot)
    return this.touchAddressOnWriteAndComputeGas(address, treeIndex, subIndex)
  }

  touchAddressOnWriteAndComputeGas(
    address: Address,
    treeIndex: number | bigint,
    subIndex: number | Uint8Array,
  ): bigint {
    return this.touchAddressAndComputeGas(address, treeIndex, subIndex, {
      isWrite: true,
    })
  }

  touchAddressOnReadAndComputeGas(
    address: Address,
    treeIndex: number | bigint,
    subIndex: number | Uint8Array,
  ): bigint {
    return this.touchAddressAndComputeGas(address, treeIndex, subIndex, {
      isWrite: false,
    })
  }

  touchAddressAndComputeGas(
    address: Address,
    treeIndex: number | bigint,
    subIndex: number | Uint8Array,
    { isWrite }: { isWrite?: boolean },
  ): bigint {
    let gas = BIGINT_0

    const { stemRead, stemWrite, chunkRead, chunkWrite, chunkFill } = this.touchAddress(
      address,
      treeIndex,
      subIndex,
      { isWrite },
    )

    if (stemRead === true) {
      gas += WitnessBranchReadCost
    }
    if (stemWrite === true) {
      gas += WitnessBranchWriteCost
    }

    if (chunkRead === true) {
      gas += WitnessChunkReadCost
    }
    if (chunkWrite === true) {
      gas += WitnessChunkWriteCost
    }
    if (chunkFill === true) {
      gas += WitnessChunkFillCost
    }

    debug(
      `touchAddressAndComputeGas=${gas} address=${address} treeIndex=${treeIndex} subIndex=${subIndex}`,
    )

    return gas
  }

  touchAddress(
    address: Address,
    treeIndex: number | bigint,
    subIndex: number | Uint8Array,
    { isWrite }: { isWrite?: boolean } = {},
  ): AccessEventFlags {
    let stemRead = false,
      stemWrite = false,
      chunkRead = false,
      chunkWrite = false
    // currently there are no gas charges for setting the chunk for the first time
    // i.e. no fill cost is charged right now
    const chunkFill = false

    const accessedStemKey = getVerkleStem(this.verkleCrypto, address, treeIndex)
    const accessedStemHex = bytesToHex(accessedStemKey)
    let accessedStem = this.stemCache.get(accessedStemHex) ?? this.stems.get(accessedStemHex)
    if (accessedStem === undefined) {
      stemRead = true
      accessedStem = { address, treeIndex }
      this.stemCache.set(accessedStemHex, accessedStem)
    }

    const accessedChunkKey = getVerkleKey(
      accessedStemKey,
      typeof subIndex === 'number' ? intToBytes(subIndex) : subIndex,
    )
    const accessedChunkKeyHex = bytesToHex(accessedChunkKey)
    let accessedChunk =
      this.chunkCache.get(accessedChunkKeyHex) ?? this.chunks.get(accessedChunkKeyHex)
    if (accessedChunk === undefined) {
      chunkRead = true
      accessedChunk = {}
      this.chunkCache.set(accessedChunkKeyHex, accessedChunk)
    }

    if (isWrite === true) {
      if (accessedStem.write !== true) {
        stemWrite = true
        // this would also directly modify in the map
        accessedStem.write = true
      }

      if (accessedChunk.write !== true) {
        chunkWrite = true
        // this would also directly modify in the map
        accessedChunk.write = true
      }
    }

    debug(
      `${accessedChunkKeyHex}: isWrite=${isWrite} for stemRead=${stemRead} stemWrite=${stemWrite} chunkRead=${chunkRead} chunkWrite=${chunkWrite} chunkFill=${chunkFill}`,
    )
    return { stemRead, stemWrite, chunkRead, chunkWrite, chunkFill }
  }

  merge(accessWitness: VerkleAccessWitness): void {
    for (const [chunkKey, chunkValue] of accessWitness.chunks.entries()) {
      const stemKey = chunkKey.slice(0, chunkKey.length - 2) as PrefixedHexString
      const stem = accessWitness.stems.get(stemKey)
      if (stem === undefined) {
        throw Error(`Internal error: missing stem for the chunkKey=${chunkKey}`)
      }

      const thisStem = this.stems.get(stemKey)
      if (thisStem === undefined) {
        this.stems.set(stemKey, stem)
      } else {
        thisStem.write = thisStem.write !== true ? stem.write : true
      }

      const thisChunk = this.chunks.get(chunkKey)
      if (thisChunk === undefined) {
        this.chunks.set(chunkKey, chunkValue)
      } else {
        thisChunk.write = thisChunk.write !== true ? chunkValue.write : true
        thisChunk.fill = thisChunk.fill !== true ? thisChunk.fill : true
      }
    }
  }

  commit(): void {
    const cachedStems = this.stemCache.commit()
    for (const [stemKey, stemValue] of cachedStems) {
      this.stems.set(stemKey, stemValue)
    }

    const cachedChunks = this.chunkCache.commit()
    for (const [chunkKey, chunkValue] of cachedChunks) {
      this.chunks.set(chunkKey, chunkValue)
    }
  }

  revert(): void {
    this.stemCache.clear()
    this.chunkCache.clear()
  }

  debugWitnessCost(): void {
    // Calculate the aggregate gas cost for verkle access witness per type
    let stemReads = 0,
      stemWrites = 0,
      chunkReads = 0,
      chunkWrites = 0

    for (const [_, { write }] of this.stems.entries()) {
      stemReads++
      if (write === true) {
        stemWrites++
      }
    }
    for (const [_, { write }] of this.chunks.entries()) {
      chunkReads++
      if (write === true) {
        chunkWrites++
      }
    }
    debug(
      `${stemReads} stem reads, totalling ${BigInt(stemReads) * WitnessBranchReadCost} gas units`,
    )
    debug(
      `${stemWrites} stem writes, totalling ${BigInt(stemWrites) * WitnessBranchWriteCost} gas units`,
    )
    debug(
      `${chunkReads} chunk reads, totalling ${BigInt(chunkReads) * WitnessChunkReadCost} gas units`,
    )
    debug(
      `${chunkWrites} chunk writes, totalling ${BigInt(chunkWrites) * WitnessChunkWriteCost} gas units`,
    )
  }

  *rawAccesses(): Generator<RawVerkleAccessedState> {
    for (const chunkKey of this.chunks.keys()) {
      // drop the last byte
      const stemKey = chunkKey.slice(0, chunkKey.length - 2) as PrefixedHexString
      const stem = this.stems.get(stemKey)
      if (stem === undefined) {
        throw Error(`Internal error: missing stem for the chunkKey=${chunkKey}`)
      }
      const { address, treeIndex } = stem
      const chunkIndex = Number(`0x${chunkKey.slice(chunkKey.length - 2)}`)
      const accessedState = { address, treeIndex, chunkIndex, chunkKey }
      yield accessedState
    }
  }

  *accesses(): Generator<VerkleAccessedStateWithAddress> {
    for (const rawAccess of this.rawAccesses()) {
      const { address, treeIndex, chunkIndex, chunkKey } = rawAccess
      const accessedState = decodeAccessedState(treeIndex, chunkIndex)
      yield { ...accessedState, address, chunkKey }
    }
  }
}

/**
 * Generate a {@link VerkleExecutionWitness} from a state manager and an access witness.
 * @param stateManager - The state manager containing the state to generate the witness for.
 * @param accessWitness - The access witness containing the accessed states.
 * @param parentStateRoot - The parent state root (i.e. prestate root) to generate the witness for.
 * @returns The generated verkle execution witness
 *
 * Note: This does not provide the verkle proof, which is not implemented
 */
export const generateExecutionWitness = async (
  stateManager: StatefulVerkleStateManager,
  accessWitness: VerkleAccessWitness,
  parentStateRoot: Uint8Array,
): Promise<VerkleExecutionWitness> => {
  const trie = stateManager['_trie'] as VerkleTree
  await trie['_lock'].acquire()
  const postStateRoot = await stateManager.getStateRoot()
  const ew: VerkleExecutionWitness = {
    stateDiff: [],
    parentStateRoot: bytesToHex(parentStateRoot),
    verkleProof: undefined as any, // Verkle proofs are not implemented (and never will be)
  }

  // Generate a map of all stems with their accessed suffixes
  const accessedSuffixes = new Map<PrefixedHexString, number[]>()
  for (const chunkKey of accessWitness['chunks'].keys()) {
    const stem = chunkKey.slice(0, 64) as PrefixedHexString
    if (accessedSuffixes.has(stem)) {
      const suffixes = accessedSuffixes.get(stem)
      suffixes!.push(parseInt(chunkKey.slice(64), 16))
      accessedSuffixes.set(stem, suffixes!)
    } else {
      accessedSuffixes.set(stem, [parseInt(chunkKey.slice(64), 16)])
    }
  }

  // Get values from the trie for each stem and suffix
  for (const stem of accessedSuffixes.keys()) {
    trie.root(parentStateRoot)
    const suffixes = accessedSuffixes.get(stem)
    if (suffixes === undefined || suffixes.length === 0) continue
    const currentValues = await trie.get(hexToBytes(stem), suffixes)
    trie.root(postStateRoot)
    const newValues = await trie.get(hexToBytes(stem), suffixes)
    const stemStateDiff = []
    for (let x = 0; x < suffixes.length; x++) {
      // skip if both are the same
      const currentValue = currentValues[x]
      const newValue = newValues[x]
      if (
        currentValue instanceof Uint8Array &&
        newValue instanceof Uint8Array &&
        equalsBytes(currentValue, newValue)
      )
        continue
      stemStateDiff.push({
        suffix: suffixes[x],
        currentValue: currentValue ? bytesToHex(currentValue) : null,
        newValue: newValue ? bytesToHex(newValue) : null,
      })
    }
    ew.stateDiff.push({ stem, suffixDiffs: stemStateDiff })
  }
  trie['_lock'].release()
  return ew
}
