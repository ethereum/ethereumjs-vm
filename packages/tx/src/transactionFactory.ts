import { EthereumJSErrorWithoutCode, fetchFromProvider, getProvider } from '@ethereumjs/util'

import { createFeeMarket1559Tx, createFeeMarket1559TxFromRLP } from './1559/constructors.js'
import { createAccessList2930Tx, createAccessList2930TxFromRLP } from './2930/constructors.js'
import { createBlob4844Tx, createBlob4844TxFromRLP } from './4844/constructors.js'
import { createEOACode7702Tx, createEOACode7702TxFromRLP } from './7702/constructors.js'
import {
  createLegacyTx,
  createLegacyTxFromBytesArray,
  createLegacyTxFromRLP,
} from './legacy/constructors.js'
import {
  TransactionType,
  isAccessList2930TxData,
  isBlob4844TxData,
  isEOACode7702TxData,
  isFeeMarket1559TxData,
  isLegacyTxData,
} from './types.js'
import { normalizeTxParams } from './util.js'

import type { Transaction, TxData, TxOptions, TypedTxData } from './types.js'
import type { EthersProvider } from '@ethereumjs/util'
/**
 * Create a transaction from a `txData` object
 *
 * @param txData - The transaction data. The `type` field will determine which transaction type is returned (if undefined, creates a legacy transaction)
 * @param txOptions - Options to pass on to the constructor of the transaction
 */
export function createTx<T extends TransactionType>(
  txData: TypedTxData,
  txOptions: TxOptions = {},
): Transaction[T] {
  if (!('type' in txData) || txData.type === undefined) {
    // Assume legacy transaction
    return createLegacyTx(txData, txOptions) as Transaction[T]
  } else {
    if (isLegacyTxData(txData)) {
      return createLegacyTx(txData, txOptions) as Transaction[T]
    } else if (isAccessList2930TxData(txData)) {
      return createAccessList2930Tx(txData, txOptions) as Transaction[T]
    } else if (isFeeMarket1559TxData(txData)) {
      return createFeeMarket1559Tx(txData, txOptions) as Transaction[T]
    } else if (isBlob4844TxData(txData)) {
      return createBlob4844Tx(txData, txOptions) as Transaction[T]
    } else if (isEOACode7702TxData(txData)) {
      return createEOACode7702Tx(txData, txOptions) as Transaction[T]
    } else {
      throw EthereumJSErrorWithoutCode(
        `Tx instantiation with type ${(txData as TypedTxData)?.type} not supported`,
      )
    }
  }
}

/**
 * This method tries to decode serialized data.
 *
 * @param data - The data Uint8Array
 * @param txOptions - The transaction options
 */
export function createTxFromRLP<T extends TransactionType>(
  data: Uint8Array,
  txOptions: TxOptions = {},
): Transaction[T] {
  if (data[0] <= 0x7f) {
    // Determine the type.
    switch (data[0]) {
      case TransactionType.AccessListEIP2930:
        return createAccessList2930TxFromRLP(data, txOptions) as Transaction[T]
      case TransactionType.FeeMarketEIP1559:
        return createFeeMarket1559TxFromRLP(data, txOptions) as Transaction[T]
      case TransactionType.BlobEIP4844:
        return createBlob4844TxFromRLP(data, txOptions) as Transaction[T]
      case TransactionType.EOACodeEIP7702:
        return createEOACode7702TxFromRLP(data, txOptions) as Transaction[T]
      default:
        throw EthereumJSErrorWithoutCode(`TypedTransaction with ID ${data[0]} unknown`)
    }
  } else {
    return createLegacyTxFromRLP(data, txOptions) as Transaction[T]
  }
}

/**
 * When decoding a BlockBody, in the transactions field, a field is either:
 * A Uint8Array (a TypedTransaction - encoded as TransactionType || rlp(TransactionPayload))
 * A Uint8Array[] (Legacy Transaction)
 * This method returns the right transaction.
 *
 * @param data - A Uint8Array or Uint8Array[]
 * @param txOptions - The transaction options
 */
export function createTxFromBlockBodyData(
  data: Uint8Array | Uint8Array[],
  txOptions: TxOptions = {},
) {
  if (data instanceof Uint8Array) {
    return createTxFromRLP(data, txOptions)
  } else if (Array.isArray(data)) {
    // It is a legacy transaction
    return createLegacyTxFromBytesArray(data, txOptions)
  } else {
    throw EthereumJSErrorWithoutCode('Cannot decode transaction: unknown type input')
  }
}

/**
 * Method to decode data retrieved from RPC, such as `eth_getTransactionByHash`
 * Note that this normalizes some of the parameters
 * @param txData The RPC-encoded data
 * @param txOptions The transaction options
 * @returns
 */
export async function createTxFromRPC<T extends TransactionType>(
  txData: TxData[T],
  txOptions: TxOptions = {},
): Promise<Transaction[T]> {
  return createTx(normalizeTxParams(txData), txOptions)
}

/**
 *  Method to retrieve a transaction from the provider
 * @param provider - a url string for a JSON-RPC provider or an Ethers JSONRPCProvider object
 * @param txHash - Transaction hash
 * @param txOptions - The transaction options
 * @returns the transaction specified by `txHash`
 */
export async function createTxFromJSONRPCProvider(
  provider: string | EthersProvider,
  txHash: string,
  txOptions?: TxOptions,
) {
  const prov = getProvider(provider)
  const txData = await fetchFromProvider(prov, {
    method: 'eth_getTransactionByHash',
    params: [txHash],
  })
  if (txData === null) {
    throw EthereumJSErrorWithoutCode('No data returned from provider')
  }
  return createTxFromRPC(txData, txOptions)
}
