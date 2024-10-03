import { ConsensusType } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { MerklePatriciaTrie } from '@ethereumjs/trie'
import { Blob4844Tx, Capability } from '@ethereumjs/tx'
import {
  BIGINT_0,
  CLRequestType,
  KECCAK256_RLP,
  KECCAK256_RLP_ARRAY,
  bytesToHex,
  equalsBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

/* eslint-disable */
// This is to allow for a proper and linked collection of constructors for the class header.
// For tree shaking/code size this should be no problem since types go away on transpilation.
// TODO: See if there is an easier way to achieve the same result.
// See: https://github.com/microsoft/TypeScript/issues/47558
// (situation will eventually improve on Typescript and/or Eslint update)
import {
  genRequestsTrieRoot,
  genTransactionsTrieRoot,
  genWithdrawalsTrieRoot,
  BlockHeader,
  type createBlockFromBeaconPayloadJSON,
  type createBlock,
  type createBlockFromExecutionPayload,
  type createBlockFromJSONRPCProvider,
  type createBlockFromRLP,
  type createBlockFromRPC,
  type createBlockFromBytesArray,
} from '../index.js'
/* eslint-enable */
import type { BlockBytes, BlockOptions, ExecutionPayload, JSONBlock } from '../types.js'
import type { Common } from '@ethereumjs/common'
import type { FeeMarket1559Tx, LegacyTx, TypedTransaction } from '@ethereumjs/tx'
import type {
  CLRequest,
  ConsolidationRequest,
  DepositRequest,
  VerkleExecutionWitness,
  Withdrawal,
  WithdrawalRequest,
} from '@ethereumjs/util'

/**
 * Class representing a block in the Ethereum network. The {@link BlockHeader} has its own
 * class and can be used independently, for a block it is included in the form of the
 * {@link Block.header} property.
 *
 * A block object can be created with one of the following constructor methods
 * (separate from the Block class to allow for tree shaking):
 *
 * - {@link createBlock }
 * - {@link createBlockFromBytesArray }
 * - {@link createBlockFromRLP }
 * - {@link createBlockFromRPC }
 * - {@link createBlockFromJSONRPCProvider }
 * - {@link createBlockFromExecutionPayload }
 * - {@link createBlockFromBeaconPayloadJSON }
 */
export class Block {
  public readonly header: BlockHeader
  public readonly transactions: TypedTransaction[] = []
  public readonly uncleHeaders: BlockHeader[] = []
  public readonly withdrawals?: Withdrawal[]
  public readonly requests?: CLRequest<CLRequestType>[]
  public readonly common: Common
  protected keccakFunction: (msg: Uint8Array) => Uint8Array

  /**
   * EIP-6800: Verkle Proof Data (experimental)
   * null implies that the non default executionWitness might exist but not available
   * and will not lead to execution of the block via vm with verkle stateless manager
   */
  public readonly executionWitness?: VerkleExecutionWitness | null

  protected cache: {
    txTrieRoot?: Uint8Array
    withdrawalsTrieRoot?: Uint8Array
    requestsRoot?: Uint8Array
  } = {}

  /**
   * This constructor takes the values, validates them, assigns them and freezes the object.
   *
   * @deprecated Use the static factory methods (see {@link Block} for an overview) to assist in creating
   * a Block object from varying data types and options.
   */
  constructor(
    header?: BlockHeader,
    transactions: TypedTransaction[] = [],
    uncleHeaders: BlockHeader[] = [],
    withdrawals?: Withdrawal[],
    opts: BlockOptions = {},
    requests?: CLRequest<CLRequestType>[],
    executionWitness?: VerkleExecutionWitness | null,
  ) {
    this.header = header ?? new BlockHeader({}, opts)
    this.common = this.header.common
    this.keccakFunction = this.common.customCrypto.keccak256 ?? keccak256

    this.transactions = transactions
    this.withdrawals = withdrawals ?? (this.common.isActivatedEIP(4895) ? [] : undefined)
    this.executionWitness = executionWitness
    this.requests = requests ?? (this.common.isActivatedEIP(7685) ? [] : undefined)
    // null indicates an intentional absence of value or unavailability
    // undefined indicates that the executionWitness should be initialized with the default state
    if (this.common.isActivatedEIP(6800) && this.executionWitness === undefined) {
      this.executionWitness = {
        // TODO: Evaluate how default parentStateRoot should be handled?
        parentStateRoot: '0x',
        stateDiff: [],
        verkleProof: {
          commitmentsByPath: [],
          d: '0x',
          depthExtensionPresent: '0x',
          ipaProof: {
            cl: [],
            cr: [],
            finalEvaluation: '0x',
          },
          otherStems: [],
        },
      }
    }

    this.uncleHeaders = uncleHeaders
    if (uncleHeaders.length > 0) {
      this.validateUncles()
      if (this.common.consensusType() === ConsensusType.ProofOfAuthority) {
        const msg = this._errorMsg(
          'Block initialization with uncleHeaders on a PoA network is not allowed',
        )
        throw new Error(msg)
      }
      if (this.common.consensusType() === ConsensusType.ProofOfStake) {
        const msg = this._errorMsg(
          'Block initialization with uncleHeaders on a PoS network is not allowed',
        )
        throw new Error(msg)
      }
    }

    if (!this.common.isActivatedEIP(4895) && withdrawals !== undefined) {
      throw new Error('Cannot have a withdrawals field if EIP 4895 is not active')
    }

    if (
      !this.common.isActivatedEIP(6800) &&
      executionWitness !== undefined &&
      executionWitness !== null
    ) {
      throw new Error(`Cannot have executionWitness field if EIP 6800 is not active `)
    }

    if (!this.common.isActivatedEIP(7685) && requests !== undefined) {
      throw new Error(`Cannot have requests field if EIP 7685 is not active`)
    }

    // Requests should be sorted in monotonically ascending order based on type
    // and whatever internal sorting logic is defined by each request type
    if (requests !== undefined && requests.length > 1) {
      for (let x = 1; x < requests.length; x++) {
        if (requests[x].type < requests[x - 1].type)
          throw new Error('requests are not sorted in ascending order')
      }
    }
    const freeze = opts?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
  }

  /**
   * Returns a Array of the raw Bytes Arrays of this block, in order.
   */
  raw(): BlockBytes {
    const bytesArray = <BlockBytes>[
      this.header.raw(),
      this.transactions.map((tx) =>
        tx.supports(Capability.EIP2718TypedTransaction) ? tx.serialize() : tx.raw(),
      ) as Uint8Array[],
      this.uncleHeaders.map((uh) => uh.raw()),
    ]
    const withdrawalsRaw = this.withdrawals?.map((wt) => wt.raw())
    if (withdrawalsRaw) {
      bytesArray.push(withdrawalsRaw)
    }

    const requestsRaw = this.requests?.map((req) => req.serialize())
    if (requestsRaw) {
      bytesArray.push(requestsRaw)
    }

    if (this.executionWitness !== undefined && this.executionWitness !== null) {
      const executionWitnessBytes = RLP.encode(JSON.stringify(this.executionWitness))
      bytesArray.push(executionWitnessBytes as any)
    }
    return bytesArray
  }

  /**
   * Returns the hash of the block.
   */
  hash(): Uint8Array {
    return this.header.hash()
  }

  /**
   * Determines if this block is the genesis block.
   */
  isGenesis(): boolean {
    return this.header.isGenesis()
  }

  /**
   * Returns the rlp encoding of the block.
   */
  serialize(): Uint8Array {
    return RLP.encode(this.raw())
  }

  /**
   * Generates transaction trie for validation.
   */
  async genTxTrie(): Promise<Uint8Array> {
    return genTransactionsTrieRoot(
      this.transactions,
      new MerklePatriciaTrie({ common: this.common }),
    )
  }

  /**
   * Validates the transaction trie by generating a trie
   * and do a check on the root hash.
   * @returns True if the transaction trie is valid, false otherwise
   */
  async transactionsTrieIsValid(): Promise<boolean> {
    let result
    if (this.transactions.length === 0) {
      result = equalsBytes(this.header.transactionsTrie, KECCAK256_RLP)
      return result
    }

    if (this.cache.txTrieRoot === undefined) {
      this.cache.txTrieRoot = await this.genTxTrie()
    }
    result = equalsBytes(this.cache.txTrieRoot, this.header.transactionsTrie)
    return result
  }

  async requestsTrieIsValid(requestsInput?: CLRequest<CLRequestType>[]): Promise<boolean> {
    if (!this.common.isActivatedEIP(7685)) {
      throw new Error('EIP 7685 is not activated')
    }

    const requests = requestsInput ?? this.requests!

    if (requests!.length === 0) {
      return equalsBytes(this.header.requestsRoot!, KECCAK256_RLP)
    }

    if (requestsInput === undefined) {
      if (this.cache.requestsRoot === undefined) {
        this.cache.requestsRoot = await genRequestsTrieRoot(this.requests!)
      }
      return equalsBytes(this.cache.requestsRoot, this.header.requestsRoot!)
    } else {
      const reportedRoot = await genRequestsTrieRoot(requests)
      return equalsBytes(reportedRoot, this.header.requestsRoot!)
    }
  }
  /**
   * Validates transaction signatures and minimum gas requirements.
   * @returns {string[]} an array of error strings
   */
  getTransactionsValidationErrors(): string[] {
    const errors: string[] = []
    let blobGasUsed = BIGINT_0

    // eslint-disable-next-line prefer-const
    for (let [i, tx] of this.transactions.entries()) {
      const errs = tx.getValidationErrors()
      if (this.common.isActivatedEIP(1559)) {
        if (tx.supports(Capability.EIP1559FeeMarket)) {
          tx = tx as FeeMarket1559Tx
          if (tx.maxFeePerGas < this.header.baseFeePerGas!) {
            errs.push('tx unable to pay base fee (EIP-1559 tx)')
          }
        } else {
          tx = tx as LegacyTx
          if (tx.gasPrice < this.header.baseFeePerGas!) {
            errs.push('tx unable to pay base fee (non EIP-1559 tx)')
          }
        }
      }
      if (this.common.isActivatedEIP(4844)) {
        const blobGasLimit = this.common.param('maxblobGasPerBlock')
        const blobGasPerBlob = this.common.param('blobGasPerBlob')
        if (tx instanceof Blob4844Tx) {
          blobGasUsed += BigInt(tx.numBlobs()) * blobGasPerBlob
          if (blobGasUsed > blobGasLimit) {
            errs.push(
              `tx causes total blob gas of ${blobGasUsed} to exceed maximum blob gas per block of ${blobGasLimit}`,
            )
          }
        }
      }
      if (errs.length > 0) {
        errors.push(`errors at tx ${i}: ${errs.join(', ')}`)
      }
    }

    if (this.common.isActivatedEIP(4844)) {
      if (blobGasUsed !== this.header.blobGasUsed) {
        errors.push(`invalid blobGasUsed expected=${this.header.blobGasUsed} actual=${blobGasUsed}`)
      }
    }

    return errors
  }

  /**
   * Validates transaction signatures and minimum gas requirements.
   * @returns True if all transactions are valid, false otherwise
   */
  transactionsAreValid(): boolean {
    const errors = this.getTransactionsValidationErrors()

    return errors.length === 0
  }

  /**
   * Validates the block data, throwing if invalid.
   * This can be checked on the Block itself without needing access to any parent block
   * It checks:
   * - All transactions are valid
   * - The transactions trie is valid
   * - The uncle hash is valid
   * @param onlyHeader if only passed the header, skip validating txTrie and unclesHash (default: false)
   * @param verifyTxs if set to `false`, will not check for transaction validation errors (default: true)
   */
  async validateData(onlyHeader: boolean = false, verifyTxs: boolean = true): Promise<void> {
    if (verifyTxs) {
      const txErrors = this.getTransactionsValidationErrors()
      if (txErrors.length > 0) {
        const msg = this._errorMsg(`invalid transactions: ${txErrors.join(' ')}`)
        throw new Error(msg)
      }
    }

    if (onlyHeader) {
      return
    }

    if (verifyTxs) {
      for (const [index, tx] of this.transactions.entries()) {
        if (!tx.isSigned()) {
          const msg = this._errorMsg(
            `invalid transactions: transaction at index ${index} is unsigned`,
          )
          throw new Error(msg)
        }
      }
    }

    if (!(await this.transactionsTrieIsValid())) {
      const msg = this._errorMsg('invalid transaction trie')
      throw new Error(msg)
    }

    if (!this.uncleHashIsValid()) {
      const msg = this._errorMsg('invalid uncle hash')
      throw new Error(msg)
    }

    if (this.common.isActivatedEIP(4895) && !(await this.withdrawalsTrieIsValid())) {
      const msg = this._errorMsg('invalid withdrawals trie')
      throw new Error(msg)
    }

    // Validation for Verkle blocks
    // Unnecessary in this implementation since we're providing defaults if those fields are undefined
    if (this.common.isActivatedEIP(6800)) {
      if (this.executionWitness === undefined) {
        throw new Error(`Invalid block: missing executionWitness`)
      }
      if (this.executionWitness === null) {
        throw new Error(`Invalid block: ethereumjs stateless client needs executionWitness`)
      }
    }
  }

  /**
   * Validates that blob gas fee for each transaction is greater than or equal to the
   * blobGasPrice for the block and that total blob gas in block is less than maximum
   * blob gas per block
   * @param parentHeader header of parent block
   */
  validateBlobTransactions(parentHeader: BlockHeader) {
    if (this.common.isActivatedEIP(4844)) {
      const blobGasLimit = this.common.param('maxblobGasPerBlock')
      const blobGasPerBlob = this.common.param('blobGasPerBlob')
      let blobGasUsed = BIGINT_0

      const expectedExcessBlobGas = parentHeader.calcNextExcessBlobGas()
      if (this.header.excessBlobGas !== expectedExcessBlobGas) {
        throw new Error(
          `block excessBlobGas mismatch: have ${this.header.excessBlobGas}, want ${expectedExcessBlobGas}`,
        )
      }

      let blobGasPrice

      for (const tx of this.transactions) {
        if (tx instanceof Blob4844Tx) {
          blobGasPrice = blobGasPrice ?? this.header.getBlobGasPrice()
          if (tx.maxFeePerBlobGas < blobGasPrice) {
            throw new Error(
              `blob transaction maxFeePerBlobGas ${
                tx.maxFeePerBlobGas
              } < than block blob gas price ${blobGasPrice} - ${this.errorStr()}`,
            )
          }

          blobGasUsed += BigInt(tx.blobVersionedHashes.length) * blobGasPerBlob

          if (blobGasUsed > blobGasLimit) {
            throw new Error(
              `tx causes total blob gas of ${blobGasUsed} to exceed maximum blob gas per block of ${blobGasLimit}`,
            )
          }
        }
      }

      if (this.header.blobGasUsed !== blobGasUsed) {
        throw new Error(
          `block blobGasUsed mismatch: have ${this.header.blobGasUsed}, want ${blobGasUsed}`,
        )
      }
    }
  }

  /**
   * Validates the uncle's hash.
   * @returns true if the uncle's hash is valid, false otherwise.
   */
  uncleHashIsValid(): boolean {
    if (this.uncleHeaders.length === 0) {
      return equalsBytes(KECCAK256_RLP_ARRAY, this.header.uncleHash)
    }
    const uncles = this.uncleHeaders.map((uh) => uh.raw())
    const raw = RLP.encode(uncles)
    return equalsBytes(this.keccakFunction(raw), this.header.uncleHash)
  }

  /**
   * Validates the withdrawal root
   * @returns true if the withdrawals trie root is valid, false otherwise
   */
  async withdrawalsTrieIsValid(): Promise<boolean> {
    if (!this.common.isActivatedEIP(4895)) {
      throw new Error('EIP 4895 is not activated')
    }

    let result
    if (this.withdrawals!.length === 0) {
      result = equalsBytes(this.header.withdrawalsRoot!, KECCAK256_RLP)
      return result
    }

    if (this.cache.withdrawalsTrieRoot === undefined) {
      this.cache.withdrawalsTrieRoot = await genWithdrawalsTrieRoot(
        this.withdrawals!,
        new MerklePatriciaTrie({ common: this.common }),
      )
    }
    result = equalsBytes(this.cache.withdrawalsTrieRoot, this.header.withdrawalsRoot!)
    return result
  }

  /**
   * Consistency checks for uncles included in the block, if any.
   *
   * Throws if invalid.
   *
   * The rules for uncles checked are the following:
   * Header has at most 2 uncles.
   * Header does not count an uncle twice.
   */
  validateUncles() {
    if (this.isGenesis()) {
      return
    }

    // Header has at most 2 uncles
    if (this.uncleHeaders.length > 2) {
      const msg = this._errorMsg('too many uncle headers')
      throw new Error(msg)
    }

    // Header does not count an uncle twice.
    const uncleHashes = this.uncleHeaders.map((header) => bytesToHex(header.hash()))
    if (!(new Set(uncleHashes).size === uncleHashes.length)) {
      const msg = this._errorMsg('duplicate uncles')
      throw new Error(msg)
    }
  }

  /**
   * Validates if the block gasLimit remains in the boundaries set by the protocol.
   * Throws if invalid
   *
   * @param parentBlock - the parent of this `Block`
   */
  validateGasLimit(parentBlock: Block) {
    return this.header.validateGasLimit(parentBlock.header)
  }

  /**
   * Returns the block in JSON format.
   */
  toJSON(): JSONBlock {
    const withdrawalsAttr = this.withdrawals
      ? {
          withdrawals: this.withdrawals.map((wt) => wt.toJSON()),
        }
      : {}
    return {
      header: this.header.toJSON(),
      transactions: this.transactions.map((tx) => tx.toJSON()),
      uncleHeaders: this.uncleHeaders.map((uh) => uh.toJSON()),
      ...withdrawalsAttr,
      requests: this.requests?.map((req) => bytesToHex(req.serialize())),
    }
  }

  /**
   * Maps the block properties to the execution payload structure from the beacon chain,
   * see https://github.com/ethereum/consensus-specs/blob/dev/specs/bellatrix/beacon-chain.md#ExecutionPayload
   *
   * @returns dict with the execution payload parameters with camel case naming
   */
  toExecutionPayload(): ExecutionPayload {
    const blockJSON = this.toJSON()
    const header = blockJSON.header!
    const transactions = this.transactions.map((tx) => bytesToHex(tx.serialize())) ?? []
    const withdrawalsArr = blockJSON.withdrawals ? { withdrawals: blockJSON.withdrawals } : {}

    const executionPayload: ExecutionPayload = {
      blockNumber: header.number!,
      parentHash: header.parentHash!,
      feeRecipient: header.coinbase!,
      stateRoot: header.stateRoot!,
      receiptsRoot: header.receiptTrie!,
      logsBloom: header.logsBloom!,
      gasLimit: header.gasLimit!,
      gasUsed: header.gasUsed!,
      timestamp: header.timestamp!,
      extraData: header.extraData!,
      baseFeePerGas: header.baseFeePerGas!,
      blobGasUsed: header.blobGasUsed,
      excessBlobGas: header.excessBlobGas,
      blockHash: bytesToHex(this.hash()),
      prevRandao: header.mixHash!,
      transactions,
      ...withdrawalsArr,
      parentBeaconBlockRoot: header.parentBeaconBlockRoot,
      executionWitness: this.executionWitness,

      // lets add the  request fields first and then iterate over requests to fill them up
      depositRequests: this.common.isActivatedEIP(6110) ? [] : undefined,
      withdrawalRequests: this.common.isActivatedEIP(7002) ? [] : undefined,
      consolidationRequests: this.common.isActivatedEIP(7251) ? [] : undefined,
    }

    if (this.requests !== undefined) {
      for (const request of this.requests) {
        switch (request.type) {
          case CLRequestType.Deposit:
            executionPayload.depositRequests!.push((request as DepositRequest).toJSON())
            continue

          case CLRequestType.Withdrawal:
            executionPayload.withdrawalRequests!.push((request as WithdrawalRequest).toJSON())
            continue

          case CLRequestType.Consolidation:
            executionPayload.consolidationRequests!.push((request as ConsolidationRequest).toJSON())
            continue
        }
      }
    } else if (
      executionPayload.depositRequests !== undefined ||
      executionPayload.withdrawalRequests !== undefined ||
      executionPayload.consolidationRequests !== undefined
    ) {
      throw Error(`Undefined requests for activated deposit or withdrawal requests`)
    }

    return executionPayload
  }

  /**
   * Return a compact error string representation of the object
   */
  public errorStr() {
    let hash = ''
    try {
      hash = bytesToHex(this.hash())
    } catch {
      hash = 'error'
    }
    let hf = ''
    try {
      hf = this.common.hardfork()
    } catch {
      hf = 'error'
    }
    let errorStr = `block number=${this.header.number} hash=${hash} `
    errorStr += `hf=${hf} baseFeePerGas=${this.header.baseFeePerGas ?? 'none'} `
    errorStr += `txs=${this.transactions.length} uncles=${this.uncleHeaders.length}`
    return errorStr
  }

  /**
   * Internal helper function to create an annotated error message
   *
   * @param msg Base error message
   * @hidden
   */
  protected _errorMsg(msg: string) {
    return `${msg} (${this.errorStr()})`
  }
}
