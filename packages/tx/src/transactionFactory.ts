import { fetchFromProvider, getProvider } from '@ethereumjs/util'

import { txFromSerializedTx, txFromTxData, txFromValuesArray } from './constructors.js'
import { normalizeTxParams } from './fromRpc.js'
import {
  TransactionType,
  isAccessListEIP2930TxData,
  isBlobEIP4844TxData,
  isEOACodeEIP7702TxData,
  isFeeMarketEIP1559TxData,
  isLegacyTxData,
} from './types.js'

import type { Transaction, TxData, TxOptions, TypedTxData } from './types.js'
import type { EthersProvider } from '@ethereumjs/util'
/**
 * Create a transaction from a `txData` object
 *
 * @param txData - The transaction data. The `type` field will determine which transaction type is returned (if undefined, creates a legacy transaction)
 * @param txOptions - Options to pass on to the constructor of the transaction
 */
export function createTxFromTxData<T extends TransactionType>(
  txData: TypedTxData,
  txOptions: TxOptions = {}
): Transaction[T] {
  if (!('type' in txData) || txData.type === undefined) {
    // Assume legacy transaction
    return txFromTxData.LegacyTransaction(txData, txOptions) as Transaction[T]
  } else {
    if (isLegacyTxData(txData)) {
      return txFromTxData.LegacyTransaction(txData, txOptions) as Transaction[T]
    } else if (isAccessListEIP2930TxData(txData)) {
      return txFromTxData.AccessListEIP2930Transaction(txData, txOptions) as Transaction[T]
    } else if (isFeeMarketEIP1559TxData(txData)) {
      return txFromTxData.FeeMarketEIP1559Transaction(txData, txOptions) as Transaction[T]
    } else if (isBlobEIP4844TxData(txData)) {
      return txFromTxData.BlobEIP4844Transaction(txData, txOptions) as Transaction[T]
    } else if (isEOACodeEIP7702TxData(txData)) {
      return txFromTxData.EOACodeEIP7702Transaction(txData, txOptions) as Transaction[T]
    } else {
      throw new Error(`Tx instantiation with type ${(txData as TypedTxData)?.type} not supported`)
    }
  }
}

/**
 * This method tries to decode serialized data.
 *
 * @param data - The data Uint8Array
 * @param txOptions - The transaction options
 */
export function createTxFromSerializedData<T extends TransactionType>(
  data: Uint8Array,
  txOptions: TxOptions = {}
): Transaction[T] {
  if (data[0] <= 0x7f) {
    // Determine the type.
    switch (data[0]) {
      case TransactionType.AccessListEIP2930:
        return txFromSerializedTx.AccessListEIP2930Transaction(data, txOptions) as Transaction[T]
      case TransactionType.FeeMarketEIP1559:
        return txFromSerializedTx.FeeMarketEIP1559Transaction(data, txOptions) as Transaction[T]
      case TransactionType.BlobEIP4844:
        return txFromSerializedTx.BlobEIP4844Transaction(data, txOptions) as Transaction[T]
      case TransactionType.EOACodeEIP7702:
        return txFromSerializedTx.EOACodeEIP7702Transaction(data, txOptions) as Transaction[T]
      default:
        throw new Error(`TypedTransaction with ID ${data[0]} unknown`)
    }
  } else {
    return txFromSerializedTx.LegacyTransaction(data, txOptions) as Transaction[T]
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
  txOptions: TxOptions = {}
) {
  if (data instanceof Uint8Array) {
    return createTxFromSerializedData(data, txOptions)
  } else if (Array.isArray(data)) {
    // It is a legacy transaction
    return txFromValuesArray.LegacyTransaction(data, txOptions)
  } else {
    throw new Error('Cannot decode transaction: unknown type input')
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
  txOptions: TxOptions = {}
): Promise<Transaction[T]> {
  return createTxFromTxData(normalizeTxParams(txData), txOptions)
}

/**
 *  Method to retrieve a transaction from the provider
 * @param provider - a url string for a JSON-RPC provider or an Ethers JsonRPCProvider object
 * @param txHash - Transaction hash
 * @param txOptions - The transaction options
 * @returns the transaction specified by `txHash`
 */
export async function createTxFromJsonRpcProvider(
  provider: string | EthersProvider,
  txHash: string,
  txOptions?: TxOptions
) {
  const prov = getProvider(provider)
  const txData = await fetchFromProvider(prov, {
    method: 'eth_getTransactionByHash',
    params: [txHash],
  })
  if (txData === null) {
    throw new Error('No data returned from provider')
  }
  return createTxFromRPC(txData, txOptions)
}
