import {
  EthereumJSErrorWithoutCode,
  bigInt64ToBytes,
  bytesToBigInt64,
  concatBytes,
  equalsBytes,
} from '@ethereumjs/util'
import * as ssz from 'micro-eth-signer/ssz'

import { blockFromTuple, parseBlockTuple, readBlockTupleAtOffset } from './blockTuple.js'
import { formatEntry, readEntry } from './e2store.js'
import { EpochAccumulator, Era1Types, VERSION } from './types.js'

/**
 * Format era1 from epoch of history data
 * @param blockTuples header, body, receipts, totalDifficulty
 * @param headerRecords array of Header Records { blockHash: Uint8Array, totalDifficulty: bigint }
 * @param epoch epoch index
 * @returns serialized era1 file
 */
export const formatEra1 = async (
  blockTuples: {
    header: Uint8Array
    body: Uint8Array
    receipts: Uint8Array
    totalDifficulty: bigint
  }[],
  headerRecords: {
    blockHash: Uint8Array
    totalDifficulty: bigint
  }[],
  epoch: number,
) => {
  const version = await formatEntry(VERSION)
  const blocks = []
  for (const { header, body, receipts, totalDifficulty } of blockTuples) {
    const compressedHeader = await formatEntry({
      type: Era1Types.CompressedHeader,
      data: header,
    })
    const compressedBody = await formatEntry({
      type: Era1Types.CompressedBody,
      data: body,
    })
    const compressedReceipts = await formatEntry({
      type: Era1Types.CompressedReceipts,
      data: receipts,
    })
    const compressedTotalDifficulty = await formatEntry({
      type: Era1Types.TotalDifficulty,
      data: ssz.uint256.encode(totalDifficulty),
    })
    const entry = concatBytes(
      compressedHeader,
      compressedBody,
      compressedReceipts,
      compressedTotalDifficulty,
    )
    blocks.push(entry)
  }
  const blocksLength = blocks.reduce((acc, b) => acc + b.length, 0)

  const epochAccumulatorRoot = EpochAccumulator.merkleRoot(headerRecords)

  const accumulatorEntry = await formatEntry({
    type: Era1Types.AccumulatorRoot,
    data: epochAccumulatorRoot,
  })

  const startingNumber = bigInt64ToBytes(BigInt(epoch * 8192), true)
  const count = bigInt64ToBytes(BigInt(blocks.length), true)

  const blockIndexLength = 8 * blocks.length + 24

  const eraLength = version.length + blocksLength + accumulatorEntry.length + blockIndexLength

  const recordStart = eraLength - blockIndexLength
  const offsetBigInt: bigint[] = []
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) {
      const offset = 8 - recordStart
      offsetBigInt.push(BigInt(offset))
    } else {
      const offset = offsetBigInt[i - 1] + BigInt(blocks[i - 1].length)
      offsetBigInt.push(offset)
    }
  }

  const offsets: Uint8Array[] = offsetBigInt.map((o) => bigInt64ToBytes(o, true))

  // startingNumber | index | index | index ... | count
  const blockIndex = await formatEntry({
    type: Era1Types.BlockIndex,
    data: concatBytes(startingNumber, ...offsets, count),
  })

  // version | block-tuple* | other-entries | Accumulator | BLockIndex
  const era1 = concatBytes(version, ...blocks, accumulatorEntry, blockIndex)
  return era1
}

export function getBlockIndex(bytes: Uint8Array) {
  const count = Number(bytesToBigInt64(bytes.slice(-8), true))
  const recordLength = 8 * count + 24
  const recordEnd = bytes.length
  const recordStart = recordEnd - recordLength
  const { data, type } = readEntry(bytes.subarray(recordStart, recordEnd))
  if (!equalsBytes(type, Era1Types.BlockIndex)) {
    throw EthereumJSErrorWithoutCode('not a valid block index')
  }
  return { data, type, count, recordStart }
}

export function readBlockIndex(data: Uint8Array, count: number) {
  const startingNumber = Number(bytesToBigInt64(data.slice(0, 8), true))
  const offsets: number[] = []
  for (let i = 0; i < count; i++) {
    const slotEntry = data.subarray((i + 1) * 8, (i + 2) * 8)
    const offset = Number(new DataView(slotEntry.slice(0, 8).buffer).getBigInt64(0, true))
    offsets.push(offset)
  }
  return {
    startingNumber,
    offsets,
  }
}

export async function* readBlockTuplesFromERA1(
  bytes: Uint8Array,
  count: number,
  offsets: number[],
  recordStart: number,
) {
  for (let x = 0; x < count; x++) {
    try {
      const { headerEntry, bodyEntry, receiptsEntry, totalDifficultyEntry } =
        readBlockTupleAtOffset(bytes, recordStart, offsets[x])
      yield { headerEntry, bodyEntry, receiptsEntry, totalDifficultyEntry }
    } catch {
      // noop - we skip empty slots
    }
  }
}

export async function readOtherEntries(bytes: Uint8Array) {
  const { data, count, recordStart } = getBlockIndex(bytes)
  const { offsets } = readBlockIndex(data, count)
  const lastTuple = readBlockTupleAtOffset(bytes, recordStart, offsets[count - 1])
  const otherEntries = []
  let next = recordStart + offsets[count - 1] + lastTuple.length
  let nextEntry = readEntry(bytes.slice(next))
  while (!equalsBytes(nextEntry.type, Era1Types.AccumulatorRoot)) {
    otherEntries.push(nextEntry)
    next = next + nextEntry.data.length + 8
    nextEntry = readEntry(bytes.slice(next))
  }
  return { accumulatorRoot: nextEntry.data, otherEntries }
}
export async function readAccumulatorRoot(bytes: Uint8Array) {
  const { accumulatorRoot } = await readOtherEntries(bytes)
  return accumulatorRoot
}

export async function readERA1(bytes: Uint8Array) {
  const { data, count, recordStart } = getBlockIndex(bytes)
  const { offsets } = readBlockIndex(data, count)
  return readBlockTuplesFromERA1(bytes, count, offsets, recordStart)
}

export async function getHeaderRecords(bytes: Uint8Array) {
  const blockTuples = await readERA1(bytes)
  const headerRecords = []
  for await (const tuple of blockTuples) {
    const { header, body, totalDifficulty } = await parseBlockTuple(tuple)
    const block = blockFromTuple({ header, body })
    const headerRecord = {
      blockHash: block.header.hash(),
      totalDifficulty: totalDifficulty.data,
    }
    headerRecords.push(headerRecord)
  }
  return headerRecords
}

export async function validateERA1(bytes: Uint8Array) {
  const accumulatorRoot = await readAccumulatorRoot(bytes)
  const headerRecords = await getHeaderRecords(bytes)
  const epochAccumulatorRoot = EpochAccumulator.merkleRoot(headerRecords)
  return equalsBytes(epochAccumulatorRoot, accumulatorRoot)
}
