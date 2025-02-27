// Line is added so I can open a placeholder PR on github [REMOVE ME]
import { bytesToBigInt, toBytes } from '@ethereumjs/util'

import type { FeeMarket1559Tx } from './1559/tx.js'
import type { AccessList2930Tx } from './2930/tx.js'
import type { Blob4844Tx } from './4844/tx.js'
import type { EOACode7702Tx } from './7702/tx.js'
import type { LegacyTx } from './legacy/tx.js'
import type { Common, Hardfork, ParamsDict } from '@ethereumjs/common'
import type {
  Address,
  AddressLike,
  BigIntLike,
  BytesLike,
  PrefixedHexString,
} from '@ethereumjs/util'
/**
 * Can be used in conjunction with {@link Transaction[TransactionType].supports}
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

  /**
   * Tx supports setting EOA code
   * See [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
   */
  EIP7702EOACode = 7702,
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
   * Tx parameters sorted by EIP can be found in the exported `paramsTx` dictionary,
   * which is internally passed to the associated `@ethereumjs/common` instance which
   * manages parameter selection based on the hardfork and EIP settings.
   *
   * This option allows providing a custom set of parameters. Note that parameters
   * get fully overwritten, so you need to extend the default parameter dict
   * to provide the full parameter set.
   *
   * It is recommended to deep-clone the params object for this to avoid side effects:
   *
   * ```ts
   * const params = JSON.parse(JSON.stringify(paramsTx))
   * params['1']['txGas'] = 30000 // 21000
   * ```
   */
  params?: ParamsDict
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

export function isAuthorizationListBytes(
  input: AuthorizationListBytes | AuthorizationList,
): input is AuthorizationListBytes {
  if (input.length === 0) {
    return true
  }
  const firstItem = input[0]
  if (Array.isArray(firstItem)) {
    return true
  }
  return false
}

export function isAuthorizationList(
  input: AuthorizationListBytes | AuthorizationList,
): input is AuthorizationList {
  return !isAuthorizationListBytes(input) // This is exactly the same method, except the output is negated.
}

export interface TransactionCache {
  hash?: Uint8Array
  dataFee?: {
    value: bigint
    hardfork: string | Hardfork
  }
  senderPubKey?: Uint8Array
}

/**
 * Encompassing type for all transaction types.
 */
export enum TransactionType {
  Legacy = 0,
  AccessListEIP2930 = 1,
  FeeMarketEIP1559 = 2,
  BlobEIP4844 = 3,
  EOACodeEIP7702 = 4,
}

export interface Transaction {
  [TransactionType.Legacy]: LegacyTx
  [TransactionType.FeeMarketEIP1559]: FeeMarket1559Tx
  [TransactionType.AccessListEIP2930]: AccessList2930Tx
  [TransactionType.BlobEIP4844]: Blob4844Tx
  [TransactionType.EOACodeEIP7702]: EOACode7702Tx
}

export type TypedTransaction = Transaction[TransactionType]

export function isLegacyTx(tx: TypedTransaction): tx is LegacyTx {
  return tx.type === TransactionType.Legacy
}

export function isAccessList2930Tx(tx: TypedTransaction): tx is AccessList2930Tx {
  return tx.type === TransactionType.AccessListEIP2930
}

export function isFeeMarket1559Tx(tx: TypedTransaction): tx is FeeMarket1559Tx {
  return tx.type === TransactionType.FeeMarketEIP1559
}

export function isBlob4844Tx(tx: TypedTransaction): tx is Blob4844Tx {
  return tx.type === TransactionType.BlobEIP4844
}

export function isEOACode7702Tx(tx: TypedTransaction): tx is EOACode7702Tx {
  return tx.type === TransactionType.EOACodeEIP7702
}

export interface TransactionInterface<T extends TransactionType = TransactionType> {
  readonly common: Common
  readonly nonce: bigint
  readonly gasLimit: bigint
  readonly to?: Address
  readonly value: bigint
  readonly data: Uint8Array
  readonly v?: bigint
  readonly r?: bigint
  readonly s?: bigint
  readonly cache: TransactionCache
  supports(capability: Capability): boolean
  type: TransactionType
  txOptions: TxOptions
  getIntrinsicGas(): bigint
  getDataGas(): bigint
  getUpfrontCost(): bigint
  toCreationAddress(): boolean
  raw(): TxValuesArray[T]
  serialize(): Uint8Array
  getMessageToSign(): Uint8Array | Uint8Array[]
  getHashedMessageToSign(): Uint8Array
  hash(): Uint8Array
  getMessageToVerifySignature(): Uint8Array
  getValidationErrors(): string[]
  isSigned(): boolean
  isValid(): boolean
  verifySignature(): boolean
  getSenderAddress(): Address
  getSenderPublicKey(): Uint8Array
  sign(privateKey: Uint8Array, extraEntropy?: Uint8Array | boolean): Transaction[T]
  toJSON(): JSONTx
  errorStr(): string

  addSignature(
    v: bigint,
    r: Uint8Array | bigint,
    s: Uint8Array | bigint,
    convertV?: boolean,
  ): Transaction[T]
}

export interface LegacyTxInterface<T extends TransactionType = TransactionType>
  extends TransactionInterface<T> {}

export interface EIP2718CompatibleTx<T extends TransactionType = TransactionType>
  extends TransactionInterface<T> {
  readonly chainId: bigint
  getMessageToSign(): Uint8Array
}

export interface EIP2930CompatibleTx<T extends TransactionType = TransactionType>
  extends EIP2718CompatibleTx<T> {
  readonly accessList: AccessListBytes
  readonly AccessListJSON: AccessList
}

export interface EIP1559CompatibleTx<T extends TransactionType = TransactionType>
  extends EIP2930CompatibleTx<T> {
  readonly maxPriorityFeePerGas: bigint
  readonly maxFeePerGas: bigint
}

export interface EIP4844CompatibleTx<T extends TransactionType = TransactionType>
  extends EIP1559CompatibleTx<T> {
  readonly maxFeePerBlobGas: bigint
  blobVersionedHashes: Uint8Array[]
  blobs?: Uint8Array[]
  kzgCommitments?: Uint8Array[]
  kzgProofs?: Uint8Array[]
  serializeNetworkWrapper(): Uint8Array
  numBlobs(): number
}

export interface EIP7702CompatibleTx<T extends TransactionType = TransactionType>
  extends EIP1559CompatibleTx<T> {
  // ChainID, Address, [nonce], y_parity, r, s
  readonly authorizationList: AuthorizationListBytes
}

export interface TxData {
  [TransactionType.Legacy]: LegacyTxData
  [TransactionType.AccessListEIP2930]: AccessList2930TxData
  [TransactionType.FeeMarketEIP1559]: FeeMarketEIP1559TxData
  [TransactionType.BlobEIP4844]: BlobEIP4844TxData
  [TransactionType.EOACodeEIP7702]: EOACode7702TxData
}

export type TypedTxData = TxData[TransactionType]

export function isLegacyTxData(txData: TypedTxData): txData is LegacyTxData {
  const txType = Number(bytesToBigInt(toBytes(txData.type)))
  return txType === TransactionType.Legacy
}

export function isAccessList2930TxData(txData: TypedTxData): txData is AccessList2930TxData {
  const txType = Number(bytesToBigInt(toBytes(txData.type)))
  return txType === TransactionType.AccessListEIP2930
}

export function isFeeMarket1559TxData(txData: TypedTxData): txData is FeeMarketEIP1559TxData {
  const txType = Number(bytesToBigInt(toBytes(txData.type)))
  return txType === TransactionType.FeeMarketEIP1559
}

export function isBlob4844TxData(txData: TypedTxData): txData is BlobEIP4844TxData {
  const txType = Number(bytesToBigInt(toBytes(txData.type)))
  return txType === TransactionType.BlobEIP4844
}

export function isEOACode7702TxData(txData: TypedTxData): txData is EOACode7702TxData {
  const txType = Number(bytesToBigInt(toBytes(txData.type)))
  return txType === TransactionType.EOACodeEIP7702
}

/**
 * Legacy {@link Transaction} Data
 */
export type LegacyTxData = {
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
  to?: AddressLike | ''

  /**
   * The amount of Ether sent.
   */
  value?: BigIntLike

  /**
   * This will contain the data of the message or the init of a contract.
   */
  data?: BytesLike | ''

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
 * {@link AccessList2930Tx} data.
 */
export interface AccessList2930TxData extends LegacyTxData {
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
 * {@link FeeMarket1559Tx} data.
 */
export interface FeeMarketEIP1559TxData extends AccessList2930TxData {
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
 * {@link Blob4844Tx} data.
 */
export interface BlobEIP4844TxData extends FeeMarketEIP1559TxData {
  /**
   * The versioned hashes used to validate the blobs attached to a transaction
   */
  blobVersionedHashes?: BytesLike[]
  /**
   * The maximum fee per blob gas paid for the transaction
   */
  maxFeePerBlobGas?: BigIntLike
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
 * {@link EOACode7702Tx} data.
 */
export interface EOACode7702TxData extends FeeMarketEIP1559TxData {
  authorizationList?: AuthorizationListBytes | AuthorizationList | never
}

export interface TxValuesArray {
  [TransactionType.Legacy]: LegacyTxValuesArray
  [TransactionType.AccessListEIP2930]: AccessList2930TxValuesArray
  [TransactionType.FeeMarketEIP1559]: FeeMarketEIP1559TxValuesArray
  [TransactionType.BlobEIP4844]: BlobEIP4844TxValuesArray
  [TransactionType.EOACodeEIP7702]: EOACode7702TxValuesArray
}

/**
 * Bytes values array for a legacy {@link Transaction}
 */
type LegacyTxValuesArray = Uint8Array[]

/**
 * Bytes values array for an {@link AccessList2930Tx}
 */
type AccessList2930TxValuesArray = [
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
  Uint8Array?,
]

/**
 * Bytes values array for a {@link FeeMarket1559Tx}
 */
type FeeMarketEIP1559TxValuesArray = [
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
  Uint8Array?,
]

/**
 * Bytes values array for a {@link EOACode7702Transaction}
 */
type EOACode7702TxValuesArray = [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  AccessListBytes,
  AuthorizationListBytes,
  Uint8Array?,
  Uint8Array?,
  Uint8Array?,
]

/**
 * Bytes values array for a {@link Blob4844Tx}
 */
type BlobEIP4844TxValuesArray = [
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
  Uint8Array?,
]

export type BlobEIP4844NetworkValuesArray = [
  BlobEIP4844TxValuesArray,
  Uint8Array[],
  Uint8Array[],
  Uint8Array[],
]

type JSONAccessListItem = { address: string; storageKeys: string[] }

/**
 * Generic interface for all tx types with a
 * JSON representation of a transaction.
 *
 * Note that all values are marked as optional
 * and not all the values are present on all tx types
 * (an EIP1559 tx e.g. lacks a `gasPrice`).
 */
export interface JSONTx {
  nonce?: PrefixedHexString
  gasPrice?: PrefixedHexString
  gasLimit?: PrefixedHexString
  to?: PrefixedHexString
  data?: PrefixedHexString
  v?: PrefixedHexString
  r?: PrefixedHexString
  s?: PrefixedHexString
  value?: PrefixedHexString
  chainId?: PrefixedHexString
  accessList?: JSONAccessListItem[] // TODO should this not be AccessList?
  authorizationList?: AuthorizationList
  type?: PrefixedHexString
  maxPriorityFeePerGas?: PrefixedHexString
  maxFeePerGas?: PrefixedHexString
  maxFeePerBlobGas?: PrefixedHexString
  blobVersionedHashes?: PrefixedHexString[]
  yParity?: PrefixedHexString
}

export type JSONBlobTxNetworkWrapper = JSONTx & {
  blobs: PrefixedHexString[]
  kzgCommitments: PrefixedHexString[]
  kzgProofs: PrefixedHexString[]
}

/*
 * Based on https://ethereum.org/en/developers/docs/apis/json-rpc/
 */
export interface JSONRPCTx {
  blockHash: string | null // DATA, 32 Bytes - hash of the block where this transaction was in. null when it's pending.
  blockNumber: string | null // QUANTITY - block number where this transaction was in. null when it's pending.
  from: string // DATA, 20 Bytes - address of the sender.
  gas: string // QUANTITY - gas provided by the sender.
  gasPrice: string // QUANTITY - gas price provided by the sender in wei. If EIP-1559 tx, defaults to maxFeePerGas.
  maxFeePerGas?: string // QUANTITY - max total fee per gas provided by the sender in wei.
  maxPriorityFeePerGas?: string // QUANTITY - max priority fee per gas provided by the sender in wei.
  type: string // QUANTITY - EIP-2718 Typed Transaction type
  accessList?: JSONTx['accessList'] // EIP-2930 access list
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
  maxFeePerBlobGas?: string // QUANTITY - max data fee for blob transactions
  blobVersionedHashes?: string[] // DATA - array of 32 byte versioned hashes for blob transactions
  yParity?: string // DATA - parity of the y-coordinate of the public key
}

/*
 * Access List types
 */

export type AccessListItem = {
  address: PrefixedHexString
  storageKeys: PrefixedHexString[]
}

/*
 * An Access List as a tuple of [address: Uint8Array, storageKeys: Uint8Array[]]
 */
export type AccessListBytesItem = [Uint8Array, Uint8Array[]]
export type AccessListBytes = AccessListBytesItem[]
export type AccessList = AccessListItem[]

/**
 * Authorization list types
 */
export type AuthorizationListItem = {
  chainId: PrefixedHexString
  address: PrefixedHexString
  nonce: PrefixedHexString
  yParity: PrefixedHexString
  r: PrefixedHexString
  s: PrefixedHexString
}

// Tuple of [chain_id, address, [nonce], y_parity, r, s]
export type AuthorizationListBytesItem = [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
]
export type AuthorizationListBytes = AuthorizationListBytesItem[]
export type AuthorizationList = AuthorizationListItem[]

type NestedUint8Array = (Uint8Array | NestedUint8Array)[]

// This is all necessary in Block
export interface MinimalTxInterfaceBlock {
  supports(capability: Capability): boolean
  serialize(): Uint8Array
  raw(): NestedUint8Array // TODO make more explicit, can deduce exactly what the raw returns
  toJSON(): any // more typesafe

  // Properties
  maxFeePerGas: bigint
  gasPrice: bigint
  numBlobs: number
  maxFeePerBlobGas: bigint
  blobVersionedHashes: Uint8Array[]

  // Can likely throw out
  getValidationErrors(): string
  isSigned(): boolean
}

// This is all necessary in VM
export interface MinimalTxInterfaceVM {
  hash(): Uint8Array // Only used in debug logger !?
  supports(capability: Capability): boolean
  getSenderAddress(): Address
  isSigned(): boolean // Only used in debug logger !?
  getIntrinsicGas(): bigint
  getUpfrontCost(): bigint
  getEffectivePriorityFee(): bigint
  serialize(): Uint8Array

  // Properties
  common: Common
  gasLimit: bigint
  gasPrice: bigint
  maxFeePerGas: bigint
  maxFeePerBlobGas: bigint
  numBlobs: number
  data: Uint8Array
  AccessListJSON: any // Todo type
  authorizationList: any // Todo type
  to: Address | undefined | null // Note null got added here
  value: bigint
  nonce: bigint
  blobVersionedHashes: Uint8Array[]
  type: number
  blobs: any // Todo type

  // Can likely throw out
  errorStr(): string
}
