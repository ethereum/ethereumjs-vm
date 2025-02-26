import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  bigIntToHex,
  blobsToCommitments,
  blobsToProofs,
  bytesToBigInt,
  bytesToHex,
  commitmentsToVersionedHashes,
  computeVersionedHash,
  equalsBytes,
  getBlobs,
  validateNoLeadingZeroes,
} from '@ethereumjs/util'

import { paramsTx } from '../params.js'
import { TransactionType } from '../types.js'
import { AccessLists, txTypeBytes, validateNotArray } from '../util.js'

import { Blob4844Tx } from './tx.js'

import type {
  BlobEIP4844NetworkValuesArray,
  JSONBlobTxNetworkWrapper,
  TxOptions,
} from '../types.js'
import type { TxData, TxValuesArray } from './tx.js'
import type { KZG, PrefixedHexString } from '@ethereumjs/util'

const validateBlobTransactionNetworkWrapper = (
  blobVersionedHashes: PrefixedHexString[],
  blobs: PrefixedHexString[],
  commitments: PrefixedHexString[],
  kzgProofs: PrefixedHexString[],
  version: number,
  kzg: KZG,
) => {
  if (!(blobVersionedHashes.length === blobs.length && blobs.length === commitments.length)) {
    throw EthereumJSErrorWithoutCode(
      'Number of blobVersionedHashes, blobs, and commitments not all equal',
    )
  }
  if (blobVersionedHashes.length === 0) {
    throw EthereumJSErrorWithoutCode('Invalid transaction with empty blobs')
  }

  let isValid
  try {
    isValid = kzg.verifyBlobProofBatch(blobs, commitments, kzgProofs)
  } catch (error) {
    throw EthereumJSErrorWithoutCode(`KZG verification of blobs fail with error=${error}`)
  }
  if (!isValid) {
    throw EthereumJSErrorWithoutCode('KZG proof cannot be verified from blobs/commitments')
  }

  for (let x = 0; x < blobVersionedHashes.length; x++) {
    const computedVersionedHash = computeVersionedHash(commitments[x], version)
    if (computedVersionedHash !== blobVersionedHashes[x]) {
      throw EthereumJSErrorWithoutCode(
        `commitment for blob at index ${x} does not match versionedHash`,
      )
    }
  }
}

/**
 * Instantiate a transaction from a data dictionary.
 *
 * Format: { chainId, nonce, gasPrice, gasLimit, to, value, data, accessList,
 * v, r, s, blobs, kzgCommitments, blobVersionedHashes, kzgProofs }
 *
 * Notes:
 * - `chainId` will be set automatically if not provided
 * - All parameters are optional and have some basic default values
 * - `blobs` cannot be supplied as well as `kzgCommitments`, `blobVersionedHashes`, `kzgProofs`
 * - If `blobs` is passed in,  `kzgCommitments`, `blobVersionedHashes`, `kzgProofs` will be derived by the constructor
 */
export function createBlob4844Tx(txData: TxData, opts?: TxOptions) {
  if (opts?.common?.customCrypto?.kzg === undefined) {
    throw EthereumJSErrorWithoutCode(
      'A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx',
    )
  }
  const kzg = opts!.common!.customCrypto!.kzg!
  if (txData.blobsData !== undefined) {
    if (txData.blobs !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'cannot have both raw blobs data and encoded blobs in constructor',
      )
    }
    if (txData.kzgCommitments !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'cannot have both raw blobs data and KZG commitments in constructor',
      )
    }
    if (txData.blobVersionedHashes !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'cannot have both raw blobs data and versioned hashes in constructor',
      )
    }
    if (txData.kzgProofs !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'cannot have both raw blobs data and KZG proofs in constructor',
      )
    }
    txData.blobs = getBlobs(txData.blobsData.reduce((acc, cur) => acc + cur)) as PrefixedHexString[]
    txData.kzgCommitments = blobsToCommitments(kzg, txData.blobs as PrefixedHexString[])
    txData.blobVersionedHashes = commitmentsToVersionedHashes(
      txData.kzgCommitments as PrefixedHexString[],
    )
    txData.kzgProofs = blobsToProofs(
      kzg,
      txData.blobs as PrefixedHexString[],
      txData.kzgCommitments as PrefixedHexString[],
    )
  }

  return new Blob4844Tx(txData, opts)
}

/**
 * Create a transaction from an array of byte encoded values ordered according to the devp2p network encoding - format noted below.
 *
 * Format: `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
 * accessList, signatureYParity, signatureR, signatureS]`
 */
export function createBlob4844TxFromBytesArray(values: TxValuesArray, opts: TxOptions = {}) {
  if (opts.common?.customCrypto?.kzg === undefined) {
    throw EthereumJSErrorWithoutCode(
      'A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx',
    )
  }

  if (values.length !== 11 && values.length !== 14) {
    throw EthereumJSErrorWithoutCode(
      'Invalid EIP-4844 transaction. Only expecting 11 values (for unsigned tx) or 14 values (for signed tx).',
    )
  }

  const [
    chainId,
    nonce,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
    to,
    value,
    data,
    accessList,
    maxFeePerBlobGas,
    blobVersionedHashes,
    v,
    r,
    s,
  ] = values

  validateNotArray({ chainId, v })
  validateNoLeadingZeroes({
    nonce,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
    value,
    maxFeePerBlobGas,
    v,
    r,
    s,
  })

  return new Blob4844Tx(
    {
      chainId: bytesToBigInt(chainId),
      nonce,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to,
      value,
      data,
      accessList: accessList ?? [],
      maxFeePerBlobGas,
      blobVersionedHashes,
      v: v !== undefined ? bytesToBigInt(v) : undefined, // EIP2930 supports v's with value 0 (empty Uint8Array)
      r,
      s,
    },
    opts,
  )
}

/**
 * Instantiate a transaction from a RLP serialized tx.
 *
 * Format: `0x03 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data,
 * access_list, max_fee_per_data_gas, blob_versioned_hashes, y_parity, r, s])`
 */
export function createBlob4844TxFromRLP(serialized: Uint8Array, opts: TxOptions = {}) {
  if (opts.common?.customCrypto?.kzg === undefined) {
    throw EthereumJSErrorWithoutCode(
      'A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx',
    )
  }

  if (equalsBytes(serialized.subarray(0, 1), txTypeBytes(TransactionType.BlobEIP4844)) === false) {
    throw EthereumJSErrorWithoutCode(
      `Invalid serialized tx input: not an EIP-4844 transaction (wrong tx type, expected: ${
        TransactionType.BlobEIP4844
      }, received: ${bytesToHex(serialized.subarray(0, 1))}`,
    )
  }

  const values = RLP.decode(serialized.subarray(1))

  if (!Array.isArray(values)) {
    throw EthereumJSErrorWithoutCode('Invalid serialized tx input: must be array')
  }

  return createBlob4844TxFromBytesArray(values as TxValuesArray, opts)
}

/**
 * Creates a transaction from the network encoding of a blob transaction (with blobs/commitments/proof)
 * @param serialized a buffer representing a serialized BlobTransactionNetworkWrapper
 * @param opts any TxOptions defined
 * @returns a Blob4844Tx
 */
export function createBlob4844TxFromSerializedNetworkWrapper(
  serialized: Uint8Array,
  opts?: TxOptions,
): Blob4844Tx {
  if (!opts || !opts.common) {
    throw EthereumJSErrorWithoutCode('common instance required to validate versioned hashes')
  }

  if (opts.common?.customCrypto?.kzg === undefined) {
    throw EthereumJSErrorWithoutCode(
      'A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx',
    )
  }

  if (equalsBytes(serialized.subarray(0, 1), txTypeBytes(TransactionType.BlobEIP4844)) === false) {
    throw EthereumJSErrorWithoutCode(
      `Invalid serialized tx input: not an EIP-4844 transaction (wrong tx type, expected: ${
        TransactionType.BlobEIP4844
      }, received: ${bytesToHex(serialized.subarray(0, 1))}`,
    )
  }

  // Validate network wrapper
  const networkTxValues = RLP.decode(serialized.subarray(1))
  if (networkTxValues.length !== 4) {
    throw Error(`Expected 4 values in the deserialized network transaction`)
  }
  const [txValues, blobs, kzgCommitments, kzgProofs] =
    networkTxValues as BlobEIP4844NetworkValuesArray

  // Construct the tx but don't freeze yet, we will assign blobs etc once validated
  const decodedTx = createBlob4844TxFromBytesArray(txValues, { ...opts, freeze: false })
  if (decodedTx.to === undefined) {
    throw Error('Blob4844Tx can not be send without a valid `to`')
  }

  const commonCopy = opts.common.copy()
  commonCopy.updateParams(opts.params ?? paramsTx)

  const version = Number(commonCopy.param('blobCommitmentVersionKzg'))
  const blobsHex = blobs.map((blob) => bytesToHex(blob))
  const commsHex = kzgCommitments.map((com) => bytesToHex(com))
  const proofsHex = kzgProofs.map((proof) => bytesToHex(proof))
  validateBlobTransactionNetworkWrapper(
    decodedTx.blobVersionedHashes,
    blobsHex,
    commsHex,
    proofsHex,
    version,
    opts.common.customCrypto.kzg,
  )

  // set the network blob data on the tx
  decodedTx.blobs = blobsHex
  decodedTx.kzgCommitments = commsHex
  decodedTx.kzgProofs = proofsHex

  // freeze the tx
  const freeze = opts?.freeze ?? true
  if (freeze) {
    Object.freeze(decodedTx)
  }

  return decodedTx
}

/**
 * Creates the minimal representation of a blob transaction from the network wrapper version.
 * The minimal representation is used when adding transactions to an execution payload/block
 * @param txData a {@link Blob4844Tx} containing optional blobs/kzg commitments
 * @param opts - dictionary of {@link TxOptions}
 * @returns the "minimal" representation of a Blob4844Tx (i.e. transaction object minus blobs and kzg commitments)
 */
export function createMinimal4844TxFromNetworkWrapper(
  txData: Blob4844Tx,
  opts?: TxOptions,
): Blob4844Tx {
  if (opts?.common?.customCrypto?.kzg === undefined) {
    throw EthereumJSErrorWithoutCode(
      'A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx',
    )
  }

  const tx = createBlob4844Tx(
    {
      ...txData,
      ...{ blobs: undefined, kzgCommitments: undefined, kzgProofs: undefined },
    },
    opts,
  )
  return tx
}

/**
 * Returns the EIP 4844 transaction network wrapper in JSON format similar to toJSON, including
 * blobs, commitments, and proofs fields
 * @param serialized a buffer representing a serialized BlobTransactionNetworkWrapper
 * @param opts any TxOptions defined
 * @returns JSONBlobTxNetworkWrapper with blobs, KZG commitments, and KZG proofs fields
 */
export function blobTxNetworkWrapperToJSON(
  serialized: Uint8Array,
  opts?: TxOptions,
): JSONBlobTxNetworkWrapper {
  const tx = createBlob4844TxFromSerializedNetworkWrapper(serialized, opts)

  const accessListJSON = AccessLists.getAccessListJSON(tx.accessList)
  const baseJSON = tx.toJSON()

  return {
    ...baseJSON,
    chainId: bigIntToHex(tx.chainId),
    maxPriorityFeePerGas: bigIntToHex(tx.maxPriorityFeePerGas),
    maxFeePerGas: bigIntToHex(tx.maxFeePerGas),
    accessList: accessListJSON,
    maxFeePerBlobGas: bigIntToHex(tx.maxFeePerBlobGas),
    blobVersionedHashes: tx.blobVersionedHashes,
    blobs: tx.blobs!,
    kzgCommitments: tx.kzgCommitments!,
    kzgProofs: tx.kzgProofs!,
  }
}
