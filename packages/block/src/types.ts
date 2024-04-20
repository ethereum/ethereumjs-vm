import type { BlockHeader } from './header.js'
import type { Common } from '@ethereumjs/common'
import type { JsonRpcTx, JsonTx, TransactionType, TxData } from '@ethereumjs/tx'
import type {
  AddressLike,
  BigIntLike,
  BytesLike,
  JsonRpcWithdrawal,
  PrefixedHex20,
  PrefixedHex32,
  PrefixedHex8,
  PrefixedHexString,
  WithdrawalBytes,
  WithdrawalData,
} from '@ethereumjs/util'

/**
 * An object to set to which blockchain the blocks and their headers belong. This could be specified
 * using a {@link Common} object, or `chain` and `hardfork`. Defaults to mainnet without specifying a
 * hardfork.
 */
export interface BlockOptions {
  /**
   * A {@link Common} object defining the chain and the hardfork a block/block header belongs to.
   *
   * Object will be internally copied so that tx behavior don't incidentally
   * change on future HF changes.
   *
   * Default: {@link Common} object set to `mainnet` and the HF currently defined as the default
   * hardfork in the {@link Common} class.
   *
   * Current default hardfork: `merge`
   */
  common?: Common
  /**
   * Set the hardfork either by timestamp (for HFs from Shanghai onwards) or by block number
   * for older Hfs.
   *
   * Additionally it is possible to pass in a specific TD value to support live-Merge-HF
   * transitions. Note that this should only be needed in very rare and specific scenarios.
   *
   * Default: `false` (HF is set to whatever default HF is set by the {@link Common} instance)
   */
  setHardfork?: boolean | BigIntLike
  /**
   * If a preceding {@link BlockHeader} (usually the parent header) is given the preceding
   * header will be used to calculate the difficulty for this block and the calculated
   * difficulty takes precedence over a provided static `difficulty` value.
   *
   * Note that this option has no effect on networks other than PoW/Ethash networks
   * (respectively also deactivates on the Merge HF switching to PoS/Casper).
   */
  calcDifficultyFromHeader?: BlockHeader
  /**
   * A block object by default gets frozen along initialization. This gives you
   * strong additional security guarantees on the consistency of the block parameters.
   * It also enables block hash caching when the `hash()` method is called multiple times.
   *
   * If you need to deactivate the block freeze - e.g. because you want to subclass block and
   * add additional properties - it is strongly encouraged that you do the freeze yourself
   * within your code instead.
   *
   * Default: true
   */
  freeze?: boolean
  /**
   * Provide a clique signer's privateKey to seal this block.
   * Will throw if provided on a non-PoA chain.
   */
  cliqueSigner?: Uint8Array
  /**
   *  Skip consensus format validation checks on header if set. Defaults to false.
   */
  skipConsensusFormatValidation?: boolean

  executionWitness?: VerkleExecutionWitness
}

export interface VerkleProof {
  commitmentsByPath: PrefixedHexString[]
  d: PrefixedHexString
  depthExtensionPresent: PrefixedHexString
  ipaProof: {
    cl: PrefixedHexString[]
    cr: PrefixedHexString[]
    finalEvaluation: PrefixedHexString
  }
  otherStems: PrefixedHexString[]
}

export interface VerkleStateDiff {
  stem: PrefixedHexString
  suffixDiffs: {
    currentValue: PrefixedHexString | null
    newValue: PrefixedHexString | null
    suffix: number | string
  }[]
}

/**
 * Experimental, object format could eventual change.
 * An object that provides the state and proof necessary for verkle stateless execution
 * */
export interface VerkleExecutionWitness {
  /**
   * An array of state diffs.
   * Each item corresponding to state accesses or state modifications of the block.
   * In the current design, it also contains the resulting state of the block execution (post-state).
   */
  stateDiff: VerkleStateDiff[]
  /**
   * The verkle proof for the block.
   * Proves that the provided stateDiff belongs to the canonical verkle tree.
   */
  verkleProof: VerkleProof
}

/**
 * A block header's data.
 */
export interface HeaderData {
  parentHash?: BytesLike
  uncleHash?: BytesLike
  coinbase?: AddressLike
  stateRoot?: BytesLike
  transactionsTrie?: BytesLike
  receiptTrie?: BytesLike
  logsBloom?: BytesLike
  difficulty?: BigIntLike
  number?: BigIntLike
  gasLimit?: BigIntLike
  gasUsed?: BigIntLike
  timestamp?: BigIntLike
  extraData?: BytesLike
  mixHash?: BytesLike
  nonce?: BytesLike
  baseFeePerGas?: BigIntLike
  withdrawalsRoot?: BytesLike
  blobGasUsed?: BigIntLike
  excessBlobGas?: BigIntLike
  parentBeaconBlockRoot?: BytesLike
}

/**
 * A block's data.
 */
export interface BlockData {
  /**
   * Header data for the block
   */
  header?: HeaderData
  transactions?: Array<TxData[TransactionType]>
  uncleHeaders?: Array<HeaderData>
  withdrawals?: Array<WithdrawalData>
  /**
   * EIP-6800: Verkle Proof Data (experimental)
   */
  executionWitness?: VerkleExecutionWitness | null
}

export type WithdrawalsBytes = WithdrawalBytes[]
export type ExecutionWitnessBytes = Uint8Array

export type BlockBytes =
  | [BlockHeaderBytes, TransactionsBytes, UncleHeadersBytes]
  | [BlockHeaderBytes, TransactionsBytes, UncleHeadersBytes, WithdrawalsBytes]
  | [
      BlockHeaderBytes,
      TransactionsBytes,
      UncleHeadersBytes,
      WithdrawalsBytes,
      ExecutionWitnessBytes
    ]

/**
 * BlockHeaderBuffer is a Buffer array, except for the Verkle PreState which is an array of prestate arrays.
 */
export type BlockHeaderBytes = Uint8Array[]
export type BlockBodyBytes = [TransactionsBytes, UncleHeadersBytes, WithdrawalsBytes?]
/**
 * TransactionsBytes can be an array of serialized txs for Typed Transactions or an array of Uint8Array Arrays for legacy transactions.
 */
export type TransactionsBytes = Uint8Array[][] | Uint8Array[]
export type UncleHeadersBytes = Uint8Array[][]

/**
 * An object with the block's data represented as strings.
 */
export interface JsonBlock {
  /**
   * Header data for the block
   */
  header?: JsonHeader
  transactions?: JsonTx[]
  uncleHeaders?: JsonHeader[]
  withdrawals?: JsonRpcWithdrawal[]
  executionWitness?: VerkleExecutionWitness | null
}

/**
 * An object with the block header's data represented as 0x-prefixed hex strings.
 */
export interface JsonHeader {
  parentHash?: PrefixedHexString
  uncleHash?: PrefixedHexString
  coinbase?: PrefixedHexString
  stateRoot?: PrefixedHexString
  transactionsTrie?: PrefixedHexString
  receiptTrie?: PrefixedHexString
  logsBloom?: PrefixedHexString
  difficulty?: PrefixedHexString
  number?: PrefixedHexString
  gasLimit?: PrefixedHexString
  gasUsed?: PrefixedHexString
  timestamp?: PrefixedHexString
  extraData?: PrefixedHexString
  mixHash?: PrefixedHexString
  nonce?: PrefixedHexString
  baseFeePerGas?: PrefixedHexString
  withdrawalsRoot?: PrefixedHexString
  blobGasUsed?: PrefixedHexString
  excessBlobGas?: PrefixedHexString
  parentBeaconBlockRoot?: PrefixedHexString
}

/*
 * Based on https://ethereum.org/en/developers/docs/apis/json-rpc/
 */
export interface JsonRpcBlock {
  number: PrefixedHexString // the block number. null when pending block.
  hash: PrefixedHexString // hash of the block. null when pending block.
  parentHash: PrefixedHexString // hash of the parent block.
  mixHash?: PrefixedHexString // bit hash which proves combined with the nonce that a sufficient amount of computation has been carried out on this block.
  nonce: PrefixedHexString // hash of the generated proof-of-work. null when pending block.
  sha3Uncles: PrefixedHexString // SHA3 of the uncles data in the block.
  logsBloom: PrefixedHexString // the bloom filter for the logs of the block. null when pending block.
  transactionsRoot: PrefixedHexString // the root of the transaction trie of the block.
  stateRoot: PrefixedHexString // the root of the final state trie of the block.
  receiptsRoot: PrefixedHexString // the root of the receipts trie of the block.
  miner: PrefixedHexString // the address of the beneficiary to whom the mining rewards were given.
  difficulty: PrefixedHexString // integer of the difficulty for this block.
  totalDifficulty: PrefixedHexString // integer of the total difficulty of the chain until this block.
  extraData: PrefixedHexString // the “extra data” field of this block.
  size: PrefixedHexString // integer the size of this block in bytes.
  gasLimit: PrefixedHexString // the maximum gas allowed in this block.
  gasUsed: PrefixedHexString // the total used gas by all transactions in this block.
  timestamp: PrefixedHexString // the unix timestamp for when the block was collated.
  transactions: Array<JsonRpcTx | PrefixedHexString> // Array of transaction objects, or 32 Bytes transaction hashes depending on the last given parameter.
  uncles: PrefixedHexString[] // Array of uncle hashes
  baseFeePerGas?: PrefixedHexString // If EIP-1559 is enabled for this block, returns the base fee per gas
  withdrawals?: Array<JsonRpcWithdrawal> // If EIP-4895 is enabled for this block, array of withdrawals
  withdrawalsRoot?: PrefixedHexString // If EIP-4895 is enabled for this block, the root of the withdrawal trie of the block.
  blobGasUsed?: PrefixedHexString // If EIP-4844 is enabled for this block, returns the blob gas used for the block
  excessBlobGas?: PrefixedHexString // If EIP-4844 is enabled for this block, returns the excess blob gas for the block
  parentBeaconBlockRoot?: PrefixedHexString // If EIP-4788 is enabled for this block, returns parent beacon block root
  executionWitness?: VerkleExecutionWitness | null // If Verkle is enabled for this block
}

// Note: all these strings are 0x-prefixed
export type WithdrawalV1 = {
  index: PrefixedHex8 // Quantity
  validatorIndex: PrefixedHex8 // Quantity
  address: PrefixedHex20 // DATA
  amount: PrefixedHex32 // Quantity
}

// Note: all these strings are 0x-prefixed
export type ExecutionPayload = {
  parentHash: PrefixedHexString // DATA, 32 Bytes
  feeRecipient: PrefixedHexString // DATA, 20 Bytes
  stateRoot: PrefixedHexString // DATA, 32 Bytes
  receiptsRoot: PrefixedHexString // DATA, 32 bytes
  logsBloom: PrefixedHexString // DATA, 256 Bytes
  prevRandao: PrefixedHexString // DATA, 32 Bytes
  blockNumber: PrefixedHexString // QUANTITY, 64 Bits
  gasLimit: PrefixedHexString // QUANTITY, 64 Bits
  gasUsed: PrefixedHexString // QUANTITY, 64 Bits
  timestamp: PrefixedHexString // QUANTITY, 64 Bits
  extraData: PrefixedHexString // DATA, 0 to 32 Bytes
  baseFeePerGas: PrefixedHexString // QUANTITY, 256 Bits
  blockHash: PrefixedHexString // DATA, 32 Bytes
  transactions: PrefixedHexString[] // Array of DATA - Array of transaction rlp strings,
  withdrawals?: WithdrawalV1[] // Array of withdrawal objects
  blobGasUsed?: PrefixedHexString // QUANTITY, 64 Bits
  excessBlobGas?: PrefixedHexString // QUANTITY, 64 Bits
  parentBeaconBlockRoot?: PrefixedHexString // QUANTITY, 64 Bits
  // VerkleExecutionWitness is already a hex serialized object
  executionWitness?: VerkleExecutionWitness | null // QUANTITY, 64 Bits, null implies not available
}
