import type { FeeMarketEIP1559Transaction } from './eip1559Transaction'
import type { AccessListEIP2930Transaction } from './eip2930Transaction'
import type { BlobEIP4844Transaction } from './eip4844Transaction'
import type { Transaction } from './legacyTransaction'
import type { AccessList, AccessListBytes, Common } from '@ethereumjs/common'
import type { Address, AddressLike, BigIntLike, BytesLike } from '@ethereumjs/util'
export type {
  AccessList,
  AccessListBytes,
  AccessListBytesItem,
  AccessListItem,
} from '@ethereumjs/common'

/**
 * Can be used in conjunction with {@link Transaction.supports}
 * to query on tx capabilities
 */
export enum Capability {
  /**
   * Tx supports EIP-155 replay protection
   * See: [155](https://eips.ethereum.org/EIPS/eip-155) Replay Attack Protection EIP
   */
  EIP155ReplayProtection = 155,

  /**
   * Tx supports EIP-1559 gas fee market mechanism
   * See: [1559](https://eips.ethereum.org/EIPS/eip-1559) Fee Market EIP
   */
  EIP1559FeeMarket = 1559,

  /**
   * Tx is a typed transaction as defined in EIP-2718
   * See: [2718](https://eips.ethereum.org/EIPS/eip-2718) Transaction Type EIP
   */
  EIP2718TypedTransaction = 2718,

  /**
   * Tx supports access list generation as defined in EIP-2930
   * See: [2930](https://eips.ethereum.org/EIPS/eip-2930) Access Lists EIP
   */
  EIP2930AccessLists = 2930,
}

/**
 * The options for initializing a {@link Transaction}.
 */
export interface TxOptions {
  /**
   * A {@link Common} object defining the chain and hardfork for the transaction.
   *
   * Object will be internally copied so that tx behavior don't incidentally
   * change on future HF changes.
   *
   * Default: {@link Common} object set to `mainnet` and the default hardfork as defined in the {@link Common} class.
   *
   * Current default hardfork: `istanbul`
   */
  common?: Common
  /**
   * A transaction object by default gets frozen along initialization. This gives you
   * strong additional security guarantees on the consistency of the tx parameters.
   * It also enables tx hash caching when the `hash()` method is called multiple times.
   *
   * If you need to deactivate the tx freeze - e.g. because you want to subclass tx and
   * add additional properties - it is strongly encouraged that you do the freeze yourself
   * within your code instead.
   *
   * Default: true
   */
  freeze?: boolean

  /**
   * Allows unlimited contract code-size init while debugging. This (partially) disables EIP-3860.
   * Gas cost for initcode size analysis will still be charged. Use with caution.
   */
  allowUnlimitedInitCodeSize?: boolean
}

export function isAccessListBytes(input: AccessListBytes | AccessList): input is AccessListBytes {
  if (input.length === 0) {
    return true
  }
  const firstItem = input[0]
  if (Array.isArray(firstItem)) {
    return true
  }
  return false
}

export function isAccessList(input: AccessListBytes | AccessList): input is AccessList {
  return !isAccessListBytes(input) // This is exactly the same method, except the output is negated.
}

/**
 * Encompassing type for all transaction types.
 *
 * Note that this also includes legacy txs which are
 * referenced as {@link Transaction} for compatibility reasons.
 */
export type TransactionType =
  | Transaction
  | AccessListEIP2930Transaction
  | FeeMarketEIP1559Transaction
  | BlobEIP4844Transaction

export interface TransactionInterface<TTransactionType extends TransactionType> {
  supports(capability: Capability): boolean
  type: number
  validate(): boolean
  validate(stringError: false): boolean
  validate(stringError: true): string[]
  validate(stringError: boolean): boolean | string[]
  getBaseFee(): bigint
  getDataFee(): bigint
  getUpfrontCost(): bigint
  toCreationAddress(): boolean
  raw():
    | TxValuesArray
    | AccessListEIP2930ValuesArray
    | FeeMarketEIP1559ValuesArray
    | BlobEIP4844ValuesArray
  serialize(): Uint8Array
  getMessageToSign(hashMessage: false): Uint8Array | Uint8Array[]
  getMessageToSign(hashMessage?: true): Uint8Array
  hash(): Uint8Array
  getMessageToVerifySignature(): Uint8Array
  isSigned(): boolean
  verifySignature(): boolean
  getSenderAddress(): Address
  getSenderPublicKey(): Uint8Array
  sign(privateKey: Uint8Array): TTransactionType
  toJSON(): JsonTx
  errorStr(): string
}

/**
 * Legacy {@link Transaction} Data
 */
export type TxData = {
  /**
   * The transaction's nonce.
   */
  nonce?: BigIntLike

  /**
   * The transaction's gas price.
   */
  gasPrice?: BigIntLike | null

  /**
   * The transaction's gas limit.
   */
  gasLimit?: BigIntLike

  /**
   * The transaction's the address is sent to.
   */
  to?: AddressLike

  /**
   * The amount of Ether sent.
   */
  value?: BigIntLike

  /**
   * This will contain the data of the message or the init of a contract.
   */
  data?: BytesLike

  /**
   * EC recovery ID.
   */
  v?: BigIntLike

  /**
   * EC signature parameter.
   */
  r?: BigIntLike

  /**
   * EC signature parameter.
   */
  s?: BigIntLike

  /**
   * The transaction type
   */

  type?: BigIntLike
}

/**
 * {@link AccessListEIP2930Transaction} data.
 */
export interface AccessListEIP2930TxData extends TxData {
  /**
   * The transaction's chain ID
   */
  chainId?: BigIntLike

  /**
   * The access list which contains the addresses/storage slots which the transaction wishes to access
   */
  accessList?: AccessListBytes | AccessList | null
}

/**
 * {@link FeeMarketEIP1559Transaction} data.
 */
export interface FeeMarketEIP1559TxData extends AccessListEIP2930TxData {
  /**
   * The transaction's gas price, inherited from {@link Transaction}.  This property is not used for EIP1559
   * transactions and should always be undefined for this specific transaction type.
   */
  gasPrice?: never | null
  /**
   * The maximum inclusion fee per gas (this fee is given to the miner)
   */
  maxPriorityFeePerGas?: BigIntLike
  /**
   * The maximum total fee
   */
  maxFeePerGas?: BigIntLike
}

/**
 * {@link BlobEIP4844Transaction} data.
 */
export interface BlobEIP4844TxData extends FeeMarketEIP1559TxData {
  /**
   * The versioned hashes used to validate the blobs attached to a transaction
   */
  versionedHashes?: BytesLike[]
  /**
   * The maximum fee per data gas paid for the transaction
   */
  maxFeePerDataGas?: BigIntLike
  /**
   * The blobs associated with a transaction
   */
  blobs?: BytesLike[]
  /**
   * The KZG commitments corresponding to the versioned hashes for each blob
   */
  kzgCommitments?: BytesLike[]
  /**
   * The KZG proofs associated with the transaction
   */
  kzgProofs?: BytesLike[]
  /**
   * An array of arbitrary strings that blobs are to be constructed from
   */
  blobsData?: string[]
}

/**
 * Bytes values array for a legacy {@link Transaction}
 */
export type TxValuesArray = Uint8Array[]

/**
 * Bytes values array for an {@link AccessListEIP2930Transaction}
 */
export type AccessListEIP2930ValuesArray = [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  AccessListBytes,
  Uint8Array?,
  Uint8Array?,
  Uint8Array?
]

/**
 * Bytes values array for a {@link FeeMarketEIP1559Transaction}
 */
export type FeeMarketEIP1559ValuesArray = [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  AccessListBytes,
  Uint8Array?,
  Uint8Array?,
  Uint8Array?
]

/**
 * Bytes values array for a {@link BlobEIP4844Transaction}
 */
export type BlobEIP4844ValuesArray = [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  AccessListBytes,
  Uint8Array,
  Uint8Array[],
  Uint8Array?,
  Uint8Array?,
  Uint8Array?
]

export type BlobEIP4844NetworkValuesArray = [
  BlobEIP4844ValuesArray,
  Uint8Array[],
  Uint8Array[],
  Uint8Array[]
]

type JsonAccessListItem = { address: string; storageKeys: string[] }

/**
 * Generic interface for all tx types with a
 * JSON representation of a transaction.
 *
 * Note that all values are marked as optional
 * and not all the values are present on all tx types
 * (an EIP1559 tx e.g. lacks a `gasPrice`).
 */
export interface JsonTx {
  nonce?: string
  gasPrice?: string
  gasLimit?: string
  to?: string
  data?: string
  v?: string
  r?: string
  s?: string
  value?: string
  chainId?: string
  accessList?: JsonAccessListItem[]
  type?: string
  maxPriorityFeePerGas?: string
  maxFeePerGas?: string
  maxFeePerDataGas?: string
  versionedHashes?: string[]
}

/*
 * Based on https://ethereum.org/en/developers/docs/apis/json-rpc/
 */
export interface JsonRpcTx {
  blockHash: string | null // DATA, 32 Bytes - hash of the block where this transaction was in. null when it's pending.
  blockNumber: string | null // QUANTITY - block number where this transaction was in. null when it's pending.
  from: string // DATA, 20 Bytes - address of the sender.
  gas: string // QUANTITY - gas provided by the sender.
  gasPrice: string // QUANTITY - gas price provided by the sender in wei. If EIP-1559 tx, defaults to maxFeePerGas.
  maxFeePerGas?: string // QUANTITY - max total fee per gas provided by the sender in wei.
  maxPriorityFeePerGas?: string // QUANTITY - max priority fee per gas provided by the sender in wei.
  type: string // QUANTITY - EIP-2718 Typed Transaction type
  accessList?: JsonTx['accessList'] // EIP-2930 access list
  chainId?: string // Chain ID that this transaction is valid on.
  hash: string // DATA, 32 Bytes - hash of the transaction.
  input: string // DATA - the data send along with the transaction.
  nonce: string // QUANTITY - the number of transactions made by the sender prior to this one.
  to: string | null /// DATA, 20 Bytes - address of the receiver. null when it's a contract creation transaction.
  transactionIndex: string | null // QUANTITY - integer of the transactions index position in the block. null when it's pending.
  value: string // QUANTITY - value transferred in Wei.
  v: string // QUANTITY - ECDSA recovery id
  r: string // DATA, 32 Bytes - ECDSA signature r
  s: string // DATA, 32 Bytes - ECDSA signature s
  maxFeePerDataGas?: string // QUANTITY - max data fee for blob transactions
  versionedHashes?: string[] // DATA - array of 32 byte versioned hashes for blob transactions
}
