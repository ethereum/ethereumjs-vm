import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  bigInt64ToBytes,
  bytesToHex,
  concatBytes,
  equalsBytes,
} from '@ethereumjs/util'
import { uint256 } from 'micro-eth-signer/ssz'

import { compressData, decompressData } from './snappy.js'
import { Era1Types, EraTypes } from './types.js'

import type { e2StoreEntry } from './types.js'

export async function parseEntry(entry: e2StoreEntry) {
  if (equalsBytes(entry.type, Era1Types.TotalDifficulty)) {
    return { type: entry.type, data: uint256.decode(entry.data) }
  }
  const decompressed = await decompressData(entry.data)
  let data
  switch (bytesToHex(entry.type)) {
    case bytesToHex(Era1Types.CompressedBody): {
      const [txs, uncles, withdrawals] = RLP.decode(decompressed)
      data = { txs, uncles, withdrawals }
      break
    }
    case bytesToHex(Era1Types.CompressedHeader):
    case bytesToHex(Era1Types.CompressedReceipts):
      data = RLP.decode(decompressed)
      break
    case bytesToHex(Era1Types.AccumulatorRoot):
    case bytesToHex(EraTypes.CompressedBeaconState):
    case bytesToHex(EraTypes.CompressedSignedBeaconBlockType):
      data = decompressed
      break
    default:
      throw EthereumJSErrorWithoutCode(`unknown entry type - ${bytesToHex(entry.type)}`)
  }
  return { type: entry.type, data }
}

/**
 * Reads the first e2Store formatted entry from a string of bytes
 * @param bytes a Uint8Array containing one or more serialized {@link e2StoreEntry}
 * @returns a deserialized {@link e2StoreEntry}
 * @throws if the length of the entry read is greater than the possible number of bytes in the data element
 */
export const readEntry = (bytes: Uint8Array): e2StoreEntry => {
  if (bytes.length < 8)
    throw EthereumJSErrorWithoutCode(
      `invalid data length, got ${bytes.length}, expected at least 8`,
    )
  const type = bytes.slice(0, 2)
  const lengthBytes = concatBytes(bytes.subarray(2, 8), new Uint8Array([0, 0]))
  const length = Number(
    new DataView(lengthBytes.buffer, lengthBytes.byteOffset).getBigUint64(0, true),
  )
  if (length > bytes.length) {
    // Check for overflow
    throw EthereumJSErrorWithoutCode(
      `invalid data length, got ${length}, expected max of ${bytes.length - 8}`,
    )
  }

  const data = length > 0 ? bytes.subarray(8, 8 + length) : new Uint8Array()
  return { type, data }
}

/**
 * Format e2store entry
 * @param entry { type: entry type, data: uncompressed data }
 * @returns serialized entry
 */
export const formatEntry = async ({
  type,
  data,
}: {
  type: Uint8Array
  data: Uint8Array
}) => {
  const compressed = equalsBytes(type, Era1Types.TotalDifficulty)
    ? data
    : equalsBytes(type, Era1Types.AccumulatorRoot)
      ? data
      : equalsBytes(type, Era1Types.Version)
        ? data
        : equalsBytes(type, Era1Types.BlockIndex)
          ? data
          : await compressData(data)
  const length = compressed.length
  const lengthBytes = bigInt64ToBytes(BigInt(length), true).slice(0, 6)
  return concatBytes(type, lengthBytes, compressed)
}
