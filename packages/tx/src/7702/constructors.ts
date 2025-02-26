import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  bytesToBigInt,
  bytesToHex,
  equalsBytes,
  validateNoLeadingZeroes,
} from '@ethereumjs/util'

import { TransactionType } from '../types.js'
import { txTypeBytes, validateNotArray } from '../util.js'

import { EOACode7702Tx } from './tx.js'

import type { TxOptions } from '../types.js'
import type { TxData, TxValuesArray } from './tx.js'

/**
 * Instantiate a transaction from a data dictionary.
 *
 * Format: { chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
 * accessList, v, r, s }
 *
 * Notes:
 * - `chainId` will be set automatically if not provided
 * - All parameters are optional and have some basic default values
 */
export function createEOACode7702Tx(txData: TxData, opts: TxOptions = {}) {
  return new EOACode7702Tx(txData, opts)
}

/**
 * Create a transaction from an array of byte encoded values ordered according to the devp2p network encoding - format noted below.
 *
 * Format: `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
 * accessList, signatureYParity, signatureR, signatureS]`
 */
export function createEOACode7702TxFromBytesArray(values: TxValuesArray, opts: TxOptions = {}) {
  if (values.length !== 10 && values.length !== 13) {
    throw EthereumJSErrorWithoutCode(
      'Invalid EIP-7702 transaction. Only expecting 10 values (for unsigned tx) or 13 values (for signed tx).',
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
    authorityList,
    v,
    r,
    s,
  ] = values

  validateNotArray({ chainId, v })
  validateNoLeadingZeroes({ nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, value, v, r, s })

  return new EOACode7702Tx(
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
      authorizationList: authorityList ?? [],
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
 * Format: `0x04 || rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
 * accessList, signatureYParity, signatureR, signatureS])`
 */
export function createEOACode7702TxFromRLP(serialized: Uint8Array, opts: TxOptions = {}) {
  if (
    equalsBytes(serialized.subarray(0, 1), txTypeBytes(TransactionType.EOACodeEIP7702)) === false
  ) {
    throw EthereumJSErrorWithoutCode(
      `Invalid serialized tx input: not an EIP-7702 transaction (wrong tx type, expected: ${
        TransactionType.EOACodeEIP7702
      }, received: ${bytesToHex(serialized.subarray(0, 1))}`,
    )
  }

  const values = RLP.decode(serialized.subarray(1))

  if (!Array.isArray(values)) {
    throw EthereumJSErrorWithoutCode('Invalid serialized tx input: must be array')
  }

  return createEOACode7702TxFromBytesArray(values as TxValuesArray, opts)
}
