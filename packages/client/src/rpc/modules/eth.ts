import { createBlock } from '@ethereumjs/block'
import { Hardfork } from '@ethereumjs/common'
import {
  MerkleStateManager,
  StatelessVerkleStateManager,
  getMerkleStateProof,
  getVerkleStateProof,
} from '@ethereumjs/statemanager'
import {
  Capability,
  createBlob4844TxFromSerializedNetworkWrapper,
  createTx,
  createTxFromRLP,
} from '@ethereumjs/tx'
import {
  BIGINT_0,
  BIGINT_1,
  BIGINT_100,
  BIGINT_NEG1,
  EthereumJSErrorUnsetCode,
  TypeOutput,
  bigIntMax,
  bigIntToHex,
  bytesToHex,
  createAddressFromString,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
  intToHex,
  isHexString,
  setLengthLeft,
  toType,
} from '@ethereumjs/util'
import {
  type EIP4844BlobTxReceipt,
  type PostByzantiumTxReceipt,
  type PreByzantiumTxReceipt,
  type TxReceipt,
  type VM,
  runBlock,
  runTx,
} from '@ethereumjs/vm'

import { INTERNAL_ERROR, INVALID_HEX_STRING, INVALID_PARAMS, PARSE_ERROR } from '../error-code.js'
import { callWithStackTrace, getBlockByOption, toJSONRPCTx } from '../helpers.js'
import { middleware, validators } from '../validation.js'

import type { Chain } from '../../blockchain/index.js'
import type { ReceiptsManager } from '../../execution/receipt.js'
import type { EthereumClient } from '../../index.js'
import type { EthProtocol } from '../../net/protocol/index.js'
import type { FullEthereumService, Service } from '../../service/index.js'
import type { RPCTx } from '../types.js'
import type { Block, JSONRPCBlock } from '@ethereumjs/block'
import type { Log } from '@ethereumjs/evm'
import type { Proof } from '@ethereumjs/statemanager'
import type { FeeMarket1559Tx, LegacyTx, TypedTransaction } from '@ethereumjs/tx'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

const EMPTY_SLOT = `0x${'00'.repeat(32)}`

type GetLogsParams = {
  fromBlock?: string // QUANTITY, block number or "earliest" or "latest" (default: "latest")
  toBlock?: string // QUANTITY, block number or "latest" (default: "latest")
  address?: PrefixedHexString // DATA, 20 Bytes, contract address from which logs should originate
  topics?: PrefixedHexString[] // DATA, array, topics are order-dependent
  blockHash?: PrefixedHexString // DATA, 32 Bytes. With the addition of EIP-234,
  // blockHash restricts the logs returned to the single block with
  // the 32-byte hash blockHash. Using blockHash is equivalent to
  // fromBlock = toBlock = the block number with hash blockHash.
  // If blockHash is present in in the filter criteria, then
  // neither fromBlock nor toBlock are allowed.
}

type JSONRPCReceipt = {
  transactionHash: string // DATA, 32 Bytes - hash of the transaction.
  transactionIndex: string // QUANTITY - integer of the transactions index position in the block.
  blockHash: string // DATA, 32 Bytes - hash of the block where this transaction was in.
  blockNumber: string // QUANTITY - block number where this transaction was in.
  from: string // DATA, 20 Bytes - address of the sender.
  to: string | null // DATA, 20 Bytes - address of the receiver. null when it's a contract creation transaction.
  cumulativeGasUsed: string // QUANTITY  - The total amount of gas used when this transaction was executed in the block.
  effectiveGasPrice: string // QUANTITY - The final gas price per gas paid by the sender in wei.
  gasUsed: string // QUANTITY - The amount of gas used by this specific transaction alone.
  contractAddress: string | null // DATA, 20 Bytes - The contract address created, if the transaction was a contract creation, otherwise null.
  logs: JSONRPCLog[] // Array - Array of log objects, which this transaction generated.
  logsBloom: string // DATA, 256 Bytes - Bloom filter for light clients to quickly retrieve related logs.
  // It also returns either:
  root?: string // DATA, 32 bytes of post-transaction stateroot (pre Byzantium)
  status?: string // QUANTITY, either 1 (success) or 0 (failure)
  blobGasUsed?: string // QUANTITY, blob gas consumed by transaction (if blob transaction)
  blobGasPrice?: string // QUAntity, blob gas price for block including this transaction (if blob transaction)
  type: string // QUANTITY, transaction type
}
type JSONRPCLog = {
  removed: boolean // TAG - true when the log was removed, due to a chain reorganization. false if it's a valid log.
  logIndex: string | null // QUANTITY - integer of the log index position in the block. null when it's pending.
  transactionIndex: string | null // QUANTITY - integer of the transactions index position log was created from. null when it's pending.
  transactionHash: string | null // DATA, 32 Bytes - hash of the transactions this log was created from. null when it's pending.
  blockHash: string | null // DATA, 32 Bytes - hash of the block where this log was in. null when it's pending.
  blockNumber: string | null // QUANTITY - the block number where this log was in. null when it's pending.
  address: string // DATA, 20 Bytes - address from which this log originated.
  data: string // DATA - contains one or more 32 Bytes non-indexed arguments of the log.
  topics: string[] // Array of DATA - Array of 0 to 4 32 Bytes DATA of indexed log arguments.
  // (In solidity: The first topic is the hash of the signature of the event
  // (e.g. Deposit(address,bytes32,uint256)), except you declared the event with the anonymous specifier.)
}

/**
 * Returns block formatted to the standard JSON-RPC fields
 */
const toJSONRPCBlock = async (
  block: Block,
  chain: Chain,
  includeTransactions: boolean,
): Promise<JSONRPCBlock> => {
  const json = block.toJSON()
  const header = json!.header!
  const transactions = block.transactions.map((tx, txIndex) =>
    includeTransactions ? toJSONRPCTx(tx, block, txIndex) : bytesToHex(tx.hash()),
  )
  const withdrawalsAttr =
    header.withdrawalsRoot !== undefined
      ? {
          withdrawalsRoot: header.withdrawalsRoot!,
          withdrawals: json.withdrawals,
        }
      : {}
  const td = await chain.getTd(block.hash(), block.header.number)
  return {
    number: header.number!,
    hash: bytesToHex(block.hash()),
    parentHash: header.parentHash!,
    mixHash: header.mixHash,
    nonce: header.nonce!,
    sha3Uncles: header.uncleHash!,
    logsBloom: header.logsBloom!,
    transactionsRoot: header.transactionsTrie!,
    stateRoot: header.stateRoot!,
    receiptsRoot: header.receiptTrie!,
    miner: header.coinbase!,
    difficulty: header.difficulty!,
    totalDifficulty: bigIntToHex(td),
    extraData: header.extraData!,
    size: intToHex(block.serialize().length),
    gasLimit: header.gasLimit!,
    gasUsed: header.gasUsed!,
    timestamp: header.timestamp!,
    transactions,
    uncles: block.uncleHeaders.map((uh) => bytesToHex(uh.hash())),
    baseFeePerGas: header.baseFeePerGas,
    ...withdrawalsAttr,
    blobGasUsed: header.blobGasUsed,
    excessBlobGas: header.excessBlobGas,
    parentBeaconBlockRoot: header.parentBeaconBlockRoot,
    requestsHash: header.requestsHash,
  }
}

/**
 * Returns log formatted to the standard JSON-RPC fields
 */
const toJSONRPCLog = async (
  log: Log,
  block?: Block,
  tx?: TypedTransaction,
  txIndex?: number,
  logIndex?: number,
): Promise<JSONRPCLog> => ({
  removed: false, // TODO implement
  logIndex: logIndex !== undefined ? intToHex(logIndex) : null,
  transactionIndex: txIndex !== undefined ? intToHex(txIndex) : null,
  transactionHash: tx !== undefined ? bytesToHex(tx.hash()) : null,
  blockHash: block ? bytesToHex(block.hash()) : null,
  blockNumber: block ? bigIntToHex(block.header.number) : null,
  address: bytesToHex(log[0]),
  topics: log[1].map(bytesToHex),
  data: bytesToHex(log[2]),
})

/**
 * Returns receipt formatted to the standard JSON-RPC fields
 */
const toJSONRPCReceipt = async (
  receipt: TxReceipt,
  gasUsed: bigint,
  effectiveGasPrice: bigint,
  block: Block,
  tx: TypedTransaction,
  txIndex: number,
  logIndex: number,
  contractAddress?: Address,
  blobGasUsed?: bigint,
  blobGasPrice?: bigint,
): Promise<JSONRPCReceipt> => ({
  transactionHash: bytesToHex(tx.hash()),
  transactionIndex: intToHex(txIndex),
  blockHash: bytesToHex(block.hash()),
  blockNumber: bigIntToHex(block.header.number),
  from: tx.getSenderAddress().toString(),
  to: tx.to?.toString() ?? null,
  cumulativeGasUsed: bigIntToHex(receipt.cumulativeBlockGasUsed),
  effectiveGasPrice: bigIntToHex(effectiveGasPrice),
  gasUsed: bigIntToHex(gasUsed),
  contractAddress: contractAddress?.toString() ?? null,
  logs: await Promise.all(
    receipt.logs.map((l, i) => toJSONRPCLog(l, block, tx, txIndex, logIndex + i)),
  ),
  logsBloom: bytesToHex(receipt.bitvector),
  root:
    (receipt as PreByzantiumTxReceipt).stateRoot instanceof Uint8Array
      ? bytesToHex((receipt as PreByzantiumTxReceipt).stateRoot)
      : undefined,
  status:
    (receipt as PostByzantiumTxReceipt).status !== undefined
      ? intToHex((receipt as PostByzantiumTxReceipt).status)
      : undefined,
  blobGasUsed: blobGasUsed !== undefined ? bigIntToHex(blobGasUsed) : undefined,
  blobGasPrice: blobGasPrice !== undefined ? bigIntToHex(blobGasPrice) : undefined,
  type: intToHex(tx.type),
})

const calculateRewards = async (
  block: Block,
  receiptsManager: ReceiptsManager,
  priorityFeePercentiles: number[],
) => {
  if (priorityFeePercentiles.length === 0) {
    return []
  }
  if (block.transactions.length === 0) {
    return Array.from({ length: priorityFeePercentiles.length }, () => BIGINT_0)
  }

  const blockRewards: bigint[] = []
  const txGasUsed: bigint[] = []
  const baseFee = block.header.baseFeePerGas
  const receipts = await receiptsManager.getReceipts(block.hash())

  if (receipts.length > 0) {
    txGasUsed.push(receipts[0].cumulativeBlockGasUsed)
    for (let i = 1; i < receipts.length; i++) {
      txGasUsed.push(receipts[i].cumulativeBlockGasUsed - receipts[i - 1].cumulativeBlockGasUsed)
    }
  }

  const txs = block.transactions
  const txsWithGasUsed = txs.map((tx, i) => ({
    txGasUsed: txGasUsed[i],
    // Can assume baseFee exists, since if EIP1559/EIP4844 txs are included, this is a post-EIP-1559 block.
    effectivePriorityFee: tx.getEffectivePriorityFee(baseFee!),
  }))

  // Sort array based upon the effectivePriorityFee
  txsWithGasUsed.sort((a, b) => Number(a.effectivePriorityFee - b.effectivePriorityFee))

  let priorityFeeIndex = 0
  // Loop over all txs ...
  let targetCumulativeGasUsed =
    (block.header.gasUsed * BigInt(priorityFeePercentiles[0])) / BIGINT_100
  let cumulativeGasUsed = BIGINT_0
  for (let txIndex = 0; txIndex < txsWithGasUsed.length; txIndex++) {
    cumulativeGasUsed += txsWithGasUsed[txIndex].txGasUsed
    while (
      cumulativeGasUsed >= targetCumulativeGasUsed &&
      priorityFeeIndex < priorityFeePercentiles.length
    ) {
      /*
            Idea: keep adding the premium fee to the priority fee percentile until we actually get above the threshold
            For instance, take the priority fees [0,1,2,100]
            The gas used in the block is 1.05 million
            The first tx takes 1 million gas with prio fee A, the second the remainder over 0.05M with prio fee B
            Then it is clear that the priority fees should be [A,A,A,B]
            -> So A should be added three times
            Note: in this case A < B so the priority fees were "sorted" by default
          */
      blockRewards.push(txsWithGasUsed[txIndex].effectivePriorityFee)
      priorityFeeIndex++
      if (priorityFeeIndex >= priorityFeePercentiles.length) {
        // prevent out-of-bounds read
        break
      }
      const priorityFeePercentile = priorityFeePercentiles[priorityFeeIndex]
      targetCumulativeGasUsed = (block.header.gasUsed * BigInt(priorityFeePercentile)) / BIGINT_100
    }
  }

  return blockRewards
}

/**
 * eth_* RPC module
 * @memberof module:rpc/modules
 */
export class Eth {
  private client: EthereumClient
  private service: Service
  private receiptsManager: ReceiptsManager | undefined
  private _chain: Chain
  private _vm: VM | undefined
  private _rpcDebug: boolean
  public ethVersion: number

  /**
   * Create eth_* RPC module
   * @param client Client to which the module binds
   */
  constructor(client: EthereumClient, rpcDebug: boolean) {
    this.client = client
    this.service = client.service
    this._chain = this.service.chain
    this._vm = (this.service as FullEthereumService).execution?.vm
    this.receiptsManager = (this.service as FullEthereumService).execution?.receiptsManager
    this._rpcDebug = rpcDebug

    const ethProtocol = this.service.protocols.find((p) => p.name === 'eth') as EthProtocol
    this.ethVersion = Math.max(...ethProtocol.versions)

    this.blockNumber = callWithStackTrace(this.blockNumber.bind(this), this._rpcDebug)

    this.call = middleware(callWithStackTrace(this.call.bind(this), this._rpcDebug), 2, [
      [validators.transaction()],
      [validators.blockOption],
    ])

    this.chainId = callWithStackTrace(this.chainId.bind(this), this._rpcDebug)

    this.estimateGas = middleware(
      callWithStackTrace(this.estimateGas.bind(this), this._rpcDebug),
      1,
      [[validators.transaction()], [validators.blockOption]],
    )

    this.getBalance = middleware(
      callWithStackTrace(this.getBalance.bind(this), this._rpcDebug),
      2,
      [[validators.address], [validators.blockOption]],
    )

    this.coinbase = callWithStackTrace(this.coinbase.bind(this), this._rpcDebug)

    this.getBlockByNumber = middleware(
      callWithStackTrace(this.getBlockByNumber.bind(this), this._rpcDebug),
      2,
      [[validators.blockOption], [validators.bool]],
    )

    this.getBlockByHash = middleware(
      callWithStackTrace(this.getBlockByHash.bind(this), this._rpcDebug),
      2,
      [[validators.hex, validators.blockHash], [validators.bool]],
    )

    this.getBlockTransactionCountByHash = middleware(
      callWithStackTrace(this.getBlockTransactionCountByHash.bind(this), this._rpcDebug),
      1,
      [[validators.hex, validators.blockHash]],
    )

    this.getCode = middleware(callWithStackTrace(this.getCode.bind(this), this._rpcDebug), 2, [
      [validators.address],
      [validators.blockOption],
    ])

    this.getUncleCountByBlockNumber = middleware(
      callWithStackTrace(this.getUncleCountByBlockNumber.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )

    this.getStorageAt = middleware(
      callWithStackTrace(this.getStorageAt.bind(this), this._rpcDebug),
      3,
      [[validators.address], [validators.hex], [validators.blockOption]],
    )

    this.getTransactionByBlockHashAndIndex = middleware(
      callWithStackTrace(this.getTransactionByBlockHashAndIndex.bind(this), this._rpcDebug),
      2,
      [[validators.hex, validators.blockHash], [validators.hex]],
    )

    this.getTransactionByBlockNumberAndIndex = middleware(
      callWithStackTrace(this.getTransactionByBlockNumberAndIndex.bind(this), this._rpcDebug),
      2,
      [[validators.hex, validators.blockOption], [validators.hex]],
    )

    this.getTransactionByHash = middleware(
      callWithStackTrace(this.getTransactionByHash.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )

    this.getTransactionCount = middleware(
      callWithStackTrace(this.getTransactionCount.bind(this), this._rpcDebug),
      2,
      [[validators.address], [validators.blockOption]],
    )

    this.getBlockReceipts = middleware(
      callWithStackTrace(this.getBlockReceipts.bind(this), this._rpcDebug),
      1,
      [[validators.blockOption]],
    )
    this.getTransactionReceipt = middleware(
      callWithStackTrace(this.getTransactionReceipt.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )

    this.getUncleCountByBlockNumber = middleware(
      callWithStackTrace(this.getUncleCountByBlockNumber.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )

    this.getLogs = middleware(callWithStackTrace(this.getLogs.bind(this), this._rpcDebug), 1, [
      [
        validators.object({
          fromBlock: validators.optional(validators.blockOption),
          toBlock: validators.optional(validators.blockOption),
          address: validators.optional(
            validators.either(validators.array(validators.address), validators.address),
          ),
          topics: validators.optional(
            validators.array(
              validators.optional(
                validators.either(validators.hex, validators.array(validators.hex)),
              ),
            ),
          ),
          blockHash: validators.optional(validators.blockHash),
        }),
      ],
    ])

    this.sendRawTransaction = middleware(
      callWithStackTrace(this.sendRawTransaction.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )

    this.protocolVersion = callWithStackTrace(this.protocolVersion.bind(this), this._rpcDebug)

    this.syncing = callWithStackTrace(this.syncing.bind(this), this._rpcDebug)

    this.getProof = middleware(callWithStackTrace(this.getProof.bind(this), this._rpcDebug), 3, [
      [validators.address],
      [validators.array(validators.hex)],
      [validators.blockOption],
    ])

    this.getBlockTransactionCountByNumber = middleware(
      callWithStackTrace(this.getBlockTransactionCountByNumber.bind(this), this._rpcDebug),
      1,
      [[validators.blockOption]],
    )

    this.gasPrice = callWithStackTrace(this.gasPrice.bind(this), this._rpcDebug)

    this.feeHistory = middleware(
      callWithStackTrace(this.feeHistory.bind(this), this._rpcDebug),
      2,
      [
        [validators.either(validators.hex, validators.integer)],
        [validators.either(validators.hex, validators.blockOption)],
        [validators.rewardPercentiles],
      ],
    )

    this.blobBaseFee = callWithStackTrace(this.blobBaseFee.bind(this), this._rpcDebug)
  }

  /**
   * Returns number of the most recent block.
   */
  async blockNumber() {
    return bigIntToHex(this._chain.headers.latest?.number ?? BIGINT_0)
  }

  /**
   * Executes a new message call immediately without creating a transaction on the block chain.
   * @param params An array of two parameters:
   *   1. The transaction object
   *       * from (optional) - The address the transaction is sent from
   *       * to - The address the transaction is directed to
   *       * gas (optional) - Integer of the gas provided for the transaction execution
   *       * gasPrice (optional) - Integer of the gasPrice used for each paid gas
   *       * value (optional) - Integer of the value sent with this transaction
   *       * data (optional) - Hash of the method signature and encoded parameters.
   *   2. integer block number, or the string "latest", "earliest" or "pending"
   * @returns The return value of the executed contract.
   */
  async call(params: [RPCTx, string]) {
    const [transaction, blockOpt] = params
    const block = await getBlockByOption(blockOpt, this._chain)

    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }

    const vm = await this._vm.shallowCopy()
    await vm.stateManager.setStateRoot(block.header.stateRoot)

    const { from, to, gas: gasLimit, gasPrice, value } = transaction

    const data = transaction.data ?? transaction.input

    const runCallOpts = {
      caller: from !== undefined ? createAddressFromString(from) : undefined,
      to: to !== undefined ? createAddressFromString(to) : undefined,
      gasLimit: toType(gasLimit, TypeOutput.BigInt),
      gasPrice: toType(gasPrice, TypeOutput.BigInt),
      value: toType(value, TypeOutput.BigInt),
      data: data !== undefined ? hexToBytes(data) : undefined,
      block,
    }
    const { execResult } = await vm.evm.runCall(runCallOpts)
    if (execResult.exceptionError !== undefined) {
      throw {
        code: 3,
        data: bytesToHex(execResult.returnValue),
        message: execResult.exceptionError.type.code, // TODO EVMError now puts the error "message" into the error type, is this correct?
      }
    }
    return bytesToHex(execResult.returnValue)
  }

  /**
   * Returns the currently configured chain id, a value used in replay-protected transaction signing as introduced by EIP-155.
   * @returns The chain ID.
   */
  async chainId() {
    const chainId = this._chain.config.chainCommon.chainId()
    return bigIntToHex(chainId)
  }

  /**
   * Generates and returns an estimate of how much gas is necessary to allow the transaction to complete.
   * The transaction will not be added to the blockchain.
   * Note that the estimate may be significantly more than the amount of gas actually used by the transaction,
   * for a variety of reasons including EVM mechanics and node performance.
   * @param params An array of two parameters:
   *   1. The transaction object
   *       * from (optional) - The address the transaction is sent from
   *       * to - The address the transaction is directed to
   *       * gas (optional) - Integer of the gas provided for the transaction execution
   *       * gasPrice (optional) - Integer of the gasPrice used for each paid gas
   *       * value (optional) - Integer of the value sent with this transaction
   *       * data (optional) - Hash of the method signature and encoded parameters.
   *   2. integer block number, or the string "latest", "earliest" or "pending" (optional)
   * @returns The amount of gas used.
   */
  async estimateGas(params: [RPCTx, string?]) {
    const [transaction, blockOpt] = params
    const block = await getBlockByOption(blockOpt ?? 'latest', this._chain)

    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }
    const vm = await this._vm.shallowCopy()
    await vm.stateManager.setStateRoot(block.header.stateRoot)

    if (transaction.gas === undefined) {
      // If no gas limit is specified use the last block gas limit as an upper bound.
      const latest = await this._chain.getCanonicalHeadHeader()
      transaction.gas = latest.gasLimit as any
    }

    if (transaction.gasPrice === undefined && transaction.maxFeePerGas === undefined) {
      // If no gas price or maxFeePerGas provided, set maxFeePerGas to the next base fee
      if (transaction.type !== undefined && parseInt(transaction.type) === 2) {
        transaction.maxFeePerGas = `0x${block.header.calcNextBaseFee()?.toString(16)}`
      } else if (block.header.baseFeePerGas !== undefined) {
        transaction.gasPrice = `0x${block.header.calcNextBaseFee()?.toString(16)}`
      }
    }

    const txData = {
      ...transaction,
      gasLimit: transaction.gas,
    }

    const blockToRunOn = createBlock(
      {
        header: {
          parentHash: block.hash(),
          number: block.header.number + BIGINT_1,
          timestamp: block.header.timestamp + BIGINT_1,
          baseFeePerGas: block.common.isActivatedEIP(1559)
            ? block.header.calcNextBaseFee()
            : undefined,
        },
      },
      { common: vm.common, setHardfork: true },
    )

    vm.common.setHardforkBy({
      timestamp: blockToRunOn.header.timestamp,
      blockNumber: blockToRunOn.header.number,
    })

    const tx = createTx(txData, { common: vm.common, freeze: false })

    // set from address
    const from =
      transaction.from !== undefined
        ? createAddressFromString(transaction.from)
        : createZeroAddress()
    tx.getSenderAddress = () => {
      return from
    }

    const { totalGasSpent } = await runTx(vm, {
      tx,
      skipNonce: true,
      skipBalance: true,
      skipBlockGasLimitValidation: true,
      block: blockToRunOn,
    })
    return `0x${totalGasSpent.toString(16)}`
  }

  /**
   * Returns the balance of the account at the given address.
   * @param params An array of two parameters:
   *   1. address of the account
   *   2. integer block number, or the string "latest", "earliest" or "pending"
   */
  async getBalance(params: [string, string]) {
    const [addressHex, blockOpt] = params
    const address = createAddressFromString(addressHex)
    const block = await getBlockByOption(blockOpt, this._chain)

    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }

    const vm = await this._vm.shallowCopy()
    await vm.stateManager.setStateRoot(block.header.stateRoot)
    const account = await vm.stateManager.getAccount(address)
    if (account === undefined) {
      return '0x0'
    }
    return bigIntToHex(account.balance)
  }

  /**
   * Returns the currently configured coinbase address.
   * @returns The chain ID.
   */
  async coinbase() {
    const cb = this.client.config.minerCoinbase
    if (cb === undefined) {
      throw {
        code: INTERNAL_ERROR,
        message: 'Coinbase must be explicitly specified',
      }
    }
    return cb.toString()
  }

  /**
   * Returns information about a block by hash.
   * @param params An array of two parameters:
   *   1. a block hash
   *   2. boolean - if true returns the full transaction objects, if false only the hashes of the transactions.
   */
  async getBlockByHash(params: [PrefixedHexString, boolean]) {
    const [blockHash, includeTransactions] = params

    try {
      const block = await this._chain.getBlock(hexToBytes(blockHash))
      return await toJSONRPCBlock(block, this._chain, includeTransactions)
    } catch (error) {
      return null
    }
  }

  /**
   * Returns information about a block by block number.
   * @param params An array of two parameters:
   *   1. integer of a block number, or the string "latest", "earliest" or "pending"
   *   2. boolean - if true returns the full transaction objects, if false only the hashes of the transactions.
   */
  async getBlockByNumber(params: [string, boolean]) {
    const [blockOpt, includeTransactions] = params
    if (blockOpt === 'pending') {
      throw {
        code: INVALID_PARAMS,
        message: `"pending" is not yet supported`,
      }
    }
    try {
      const block = await getBlockByOption(blockOpt, this._chain)
      const response = await toJSONRPCBlock(block, this._chain, includeTransactions)
      return response
    } catch {
      return null
    }
  }

  /**
   * Returns the transaction count for a block given by the block hash.
   * @param params An array of one parameter: A block hash
   */
  async getBlockTransactionCountByHash(params: [PrefixedHexString]) {
    const [blockHash] = params
    try {
      const block = await this._chain.getBlock(hexToBytes(blockHash))
      return intToHex(block.transactions.length)
    } catch (error) {
      throw {
        code: INVALID_PARAMS,
        message: 'Unknown block',
      }
    }
  }

  /**
   * Returns code of the account at the given address.
   * @param params An array of two parameters:
   *   1. address of the account
   *   2. integer block number, or the string "latest", "earliest" or "pending"
   */
  async getCode(params: [string, string]) {
    const [addressHex, blockOpt] = params
    const block = await getBlockByOption(blockOpt, this._chain)

    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }

    const vm = await this._vm.shallowCopy()
    await vm.stateManager.setStateRoot(block.header.stateRoot)

    const address = createAddressFromString(addressHex)
    const code = await vm.stateManager.getCode(address)
    return bytesToHex(code)
  }

  /**
   * Returns the value from a storage position at a given address.
   * @param params An array of three parameters:
   *   1. address of the storage
   *   2. integer of the position in the storage
   *   3. integer block number, or the string "latest", "earliest" or "pending"
   */
  async getStorageAt(params: [string, PrefixedHexString, string]) {
    const [addressHex, keyHex, blockOpt] = params
    if (!/^[0-9a-fA-F]+$/.test(keyHex.slice(2))) {
      throw {
        code: INVALID_HEX_STRING,
        message: `unable to decode storage key: hex string invalid`,
      }
    }
    if (keyHex.length > 66) {
      throw {
        code: INVALID_HEX_STRING,
        message: `unable to decode storage key: hex string too long, want at most 32 bytes`,
      }
    }
    if (blockOpt === 'pending') {
      throw {
        code: INVALID_PARAMS,
        message: '"pending" is not yet supported',
      }
    }
    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }

    const vm = await this._vm.shallowCopy()
    // TODO: this needs more thought, keep on latest for now
    const block = await getBlockByOption(blockOpt, this._chain)
    await vm.stateManager.setStateRoot(block.header.stateRoot)

    const address = createAddressFromString(addressHex)
    const account = await vm.stateManager.getAccount(address)
    if (account === undefined) {
      return EMPTY_SLOT
    }
    const key = setLengthLeft(hexToBytes(keyHex), 32)
    const storage = await vm.stateManager.getStorage(address, key)
    return storage !== null && storage !== undefined
      ? bytesToHex(setLengthLeft(Uint8Array.from(storage) as Uint8Array, 32))
      : EMPTY_SLOT
  }

  /**
   * Returns information about a transaction given a block hash and a transaction's index position.
   * @param params An array of two parameter:
   *   1. a block hash
   *   2. an integer of the transaction index position encoded as a hexadecimal.
   */
  async getTransactionByBlockHashAndIndex(params: [PrefixedHexString, string]) {
    try {
      const [blockHash, txIndexHex] = params
      const txIndex = parseInt(txIndexHex, 16)
      const block = await this._chain.getBlock(hexToBytes(blockHash))
      if (block.transactions.length <= txIndex) {
        return null
      }

      const tx = block.transactions[txIndex]
      return toJSONRPCTx(tx, block, txIndex)
    } catch (error: any) {
      throw {
        code: INVALID_PARAMS,
        message: error.message.toString(),
      }
    }
  }

  /**
   * Returns information about a transaction given a block hash and a transaction's index position.
   * @param params An array of two parameter:
   *   1. a block number
   *   2. an integer of the transaction index position encoded as a hexadecimal.
   */
  async getTransactionByBlockNumberAndIndex(params: [PrefixedHexString, string]) {
    try {
      const [blockNumber, txIndexHex] = params
      const txIndex = parseInt(txIndexHex, 16)
      const block = await getBlockByOption(blockNumber, this._chain)
      if (block.transactions.length <= txIndex) {
        return null
      }

      const tx = block.transactions[txIndex]
      return toJSONRPCTx(tx, block, txIndex)
    } catch (error: any) {
      throw {
        code: INVALID_PARAMS,
        message: error.message.toString(),
      }
    }
  }

  /**
   * Returns the transaction by hash when available within `--txLookupLimit`
   * @param params An array of one parameter:
   *   1. hash of the transaction
   */
  async getTransactionByHash(params: [PrefixedHexString]) {
    const [txHash] = params
    if (!this.receiptsManager) throw EthereumJSErrorUnsetCode('missing receiptsManager')
    const result = await this.receiptsManager.getReceiptByTxHash(hexToBytes(txHash))
    if (!result) return null
    const [_receipt, blockHash, txIndex] = result
    const block = await this._chain.getBlock(blockHash)
    const tx = block.transactions[txIndex]
    return toJSONRPCTx(tx, block, txIndex)
  }

  /**
   * Returns the number of transactions sent from an address.
   * @param params An array of two parameters:
   *   1. address of the account
   *   2. integer block number, or the string "latest", "earliest" or "pending"
   */
  async getTransactionCount(params: [string, string]) {
    const [addressHex, blockOpt] = params
    let block
    if (blockOpt !== 'pending') block = await getBlockByOption(blockOpt, this._chain)
    else block = await getBlockByOption('latest', this._chain)

    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }

    const vm = await this._vm.shallowCopy()
    await vm.stateManager.setStateRoot(block.header.stateRoot)

    const address = createAddressFromString(addressHex)
    const account = await vm.stateManager.getAccount(address)
    if (account === undefined) {
      return '0x0'
    }

    let pendingTxsCount = BIGINT_0

    // Add pending txns to nonce if blockOpt is 'pending'
    if (blockOpt === 'pending') {
      pendingTxsCount = BigInt(
        (this.service as FullEthereumService).txPool.pool.get(addressHex.slice(2))?.length ?? 0,
      )
    }
    return bigIntToHex(account.nonce + pendingTxsCount)
  }

  /**
   * Returns the current ethereum protocol version as a hex-encoded string
   */
  protocolVersion() {
    return intToHex(this.ethVersion)
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block number
   * @param params An array of one parameter:
   *   1: hexadecimal representation of a block number
   */
  async getUncleCountByBlockNumber(params: [string]) {
    const [blockNumberHex] = params
    const blockNumber = BigInt(blockNumberHex)
    const latest =
      this._chain.headers.latest?.number ?? (await this._chain.getCanonicalHeadHeader()).number

    if (blockNumber > latest) {
      throw {
        code: INVALID_PARAMS,
        message: 'specified block greater than current height',
      }
    }

    const block = await this._chain.getBlock(blockNumber)
    return block.uncleHeaders.length
  }

  async getBlockReceipts(params: [string]) {
    const [blockOpt] = params
    let block: Block
    try {
      if (isHexString(blockOpt, 64)) {
        block = await this._chain.getBlock(hexToBytes(blockOpt))
      } else {
        block = await getBlockByOption(blockOpt, this._chain)
      }
    } catch {
      return null
    }
    const blockHash = block.hash()
    if (!this.receiptsManager) throw EthereumJSErrorUnsetCode('missing receiptsManager')
    const result = await this.receiptsManager.getReceipts(blockHash, true, true)
    if (result.length === 0) return []
    const parentBlock = await this._chain.getBlock(block.header.parentHash)
    const vmCopy = await this._vm!.shallowCopy()
    vmCopy.common.setHardfork(block.common.hardfork())
    // Run tx through copied vm to get tx gasUsed and createdAddress
    const runBlockResult = await runBlock(vmCopy, {
      block,
      root: parentBlock.header.stateRoot,
      skipBlockValidation: true,
    })

    const receipts = await Promise.all(
      result.map(async (r, i) => {
        const tx = block.transactions[i]
        const { totalGasSpent, createdAddress } = runBlockResult.results[i]
        const { blobGasPrice, blobGasUsed } = runBlockResult.receipts[i] as EIP4844BlobTxReceipt
        const effectiveGasPrice =
          tx.supports(Capability.EIP1559FeeMarket) === true
            ? (tx as FeeMarket1559Tx).maxPriorityFeePerGas <
              (tx as FeeMarket1559Tx).maxFeePerGas - block.header.baseFeePerGas!
              ? (tx as FeeMarket1559Tx).maxPriorityFeePerGas
              : (tx as FeeMarket1559Tx).maxFeePerGas -
                block.header.baseFeePerGas! +
                block.header.baseFeePerGas!
            : (tx as LegacyTx).gasPrice

        return toJSONRPCReceipt(
          r,
          totalGasSpent,
          effectiveGasPrice,
          block,
          tx,
          i,
          i,
          createdAddress,
          blobGasUsed,
          blobGasPrice,
        )
      }),
    )
    return receipts
  }

  /**
   * Returns the receipt of a transaction by transaction hash.
   * *Note* That the receipt is not available for pending transactions.
   * Only available with `--saveReceipts` enabled
   * Will return empty if tx is past set `--txLookupLimit`
   * (default = 2350000 = about one year, 0 = entire chain)
   * @param params An array of one parameter:
   *  1: Transaction hash
   */
  async getTransactionReceipt(params: [PrefixedHexString]) {
    const [txHash] = params

    if (!this.receiptsManager) throw EthereumJSErrorUnsetCode('missing receiptsManager')
    const result = await this.receiptsManager.getReceiptByTxHash(hexToBytes(txHash))
    if (!result) return null
    const [receipt, blockHash, txIndex, logIndex] = result
    const block = await this._chain.getBlock(blockHash)
    // Check if block is in canonical chain
    const blockByNumber = await this._chain.getBlock(block.header.number)
    if (!equalsBytes(blockByNumber.hash(), block.hash())) {
      return null
    }

    const parentBlock = await this._chain.getBlock(block.header.parentHash)
    const tx = block.transactions[txIndex]
    const effectiveGasPrice = tx.supports(Capability.EIP1559FeeMarket)
      ? (tx as FeeMarket1559Tx).maxPriorityFeePerGas <
        (tx as FeeMarket1559Tx).maxFeePerGas - block.header.baseFeePerGas!
        ? (tx as FeeMarket1559Tx).maxPriorityFeePerGas
        : (tx as FeeMarket1559Tx).maxFeePerGas -
          block.header.baseFeePerGas! +
          block.header.baseFeePerGas!
      : (tx as LegacyTx).gasPrice

    const vmCopy = await this._vm!.shallowCopy()
    vmCopy.common.setHardfork(tx.common.hardfork())
    // Run tx through copied vm to get tx gasUsed and createdAddress
    const runBlockResult = await runBlock(vmCopy, {
      block,
      root: parentBlock.header.stateRoot,
      skipBlockValidation: true,
    })

    const { totalGasSpent, createdAddress } = runBlockResult.results[txIndex]
    const { blobGasPrice, blobGasUsed } = runBlockResult.receipts[txIndex] as EIP4844BlobTxReceipt
    return toJSONRPCReceipt(
      receipt,
      totalGasSpent,
      effectiveGasPrice,
      block,
      tx,
      txIndex,
      logIndex,
      createdAddress,
      blobGasUsed,
      blobGasPrice,
    )
  }

  /**
   * Returns an array of all logs matching a given filter object.
   * Only available with `--saveReceipts` enabled
   * @param params An object of the filter options {@link GetLogsParams}
   */
  async getLogs(params: [GetLogsParams]) {
    const { fromBlock, toBlock, blockHash, address, topics } = params[0]
    if (!this.receiptsManager) throw EthereumJSErrorUnsetCode('missing receiptsManager')
    if (blockHash !== undefined && (fromBlock !== undefined || toBlock !== undefined)) {
      throw {
        code: INVALID_PARAMS,
        message: `Can only specify a blockHash if fromBlock or toBlock are not provided`,
      }
    }

    let from: Block, to: Block
    if (blockHash !== undefined) {
      try {
        from = to = await this._chain.getBlock(hexToBytes(blockHash))
      } catch (error: any) {
        throw {
          code: INVALID_PARAMS,
          message: 'unknown blockHash',
        }
      }
    } else {
      if (fromBlock === 'earliest') {
        from = await this._chain.getBlock(BIGINT_0)
      } else if (fromBlock === 'latest' || fromBlock === undefined) {
        from = this._chain.blocks.latest!
      } else {
        const blockNum = BigInt(fromBlock)
        if (blockNum > this._chain.headers.height) {
          throw {
            code: INVALID_PARAMS,
            message: 'specified `fromBlock` greater than current height',
          }
        }
        from = await this._chain.getBlock(blockNum)
      }
      if (toBlock === fromBlock) {
        to = from
      } else if (toBlock === 'latest' || toBlock === undefined) {
        to = this._chain.blocks.latest!
      } else {
        const blockNum = BigInt(toBlock)
        if (blockNum > this._chain.headers.height) {
          throw {
            code: INVALID_PARAMS,
            message: 'specified `toBlock` greater than current height',
          }
        }
        to = await this._chain.getBlock(blockNum)
      }
    }
    if (
      to.header.number - from.header.number >
      BigInt(this.receiptsManager.GET_LOGS_BLOCK_RANGE_LIMIT)
    ) {
      throw {
        code: INVALID_PARAMS,
        message: `block range limit is ${this.receiptsManager.GET_LOGS_BLOCK_RANGE_LIMIT} blocks`,
      }
    }

    const formattedTopics = topics?.map((t) => {
      if (t === null) {
        return null
      } else if (Array.isArray(t)) {
        return t.map((x) => hexToBytes(x))
      } else {
        return hexToBytes(t)
      }
    })
    let addressBytes: Uint8Array[] | undefined
    if (address !== undefined && address !== null) {
      if (Array.isArray(address)) {
        addressBytes = address.map((a) => hexToBytes(a))
      } else {
        addressBytes = [hexToBytes(address)]
      }
    }
    const logs = await this.receiptsManager.getLogs(from, to, addressBytes, formattedTopics)
    return Promise.all(
      logs.map(({ log, block, tx, txIndex, logIndex }) =>
        toJSONRPCLog(log, block, tx, txIndex, logIndex),
      ),
    )
  }

  /**
   * Creates new message call transaction or a contract creation for signed transactions.
   * @param params An array of one parameter:
   *   1. the signed transaction data
   * @returns a 32-byte tx hash or the zero hash if the tx is not yet available.
   */
  async sendRawTransaction(params: [PrefixedHexString]) {
    const [serializedTx] = params

    const { syncTargetHeight } = this.client.config
    if (!this.client.config.synchronized) {
      throw {
        code: INTERNAL_ERROR,
        message: `client is not aware of the current chain height yet (give sync some more time)`,
      }
    }
    const common = this.client.config.chainCommon.copy()
    const chainHeight = this.client.chain.headers.height
    let txTargetHeight = syncTargetHeight ?? BIGINT_0
    // Following step makes sure txTargetHeight > 0
    if (txTargetHeight <= chainHeight) {
      txTargetHeight = chainHeight + BIGINT_1
    }
    common.setHardforkBy({
      blockNumber: txTargetHeight,
      timestamp: Math.floor(Date.now() / 1000),
    })

    let tx
    try {
      const txBuf = hexToBytes(serializedTx)
      if (txBuf[0] === 0x03) {
        // Blob Transactions sent over RPC are expected to be in Network Wrapper format
        tx = createBlob4844TxFromSerializedNetworkWrapper(txBuf, { common })

        const blobGasLimit = tx.common.param('maxBlobGasPerBlock')
        const blobGasPerBlob = tx.common.param('blobGasPerBlob')

        if (BigInt((tx.blobs ?? []).length) * blobGasPerBlob > blobGasLimit) {
          throw Error(
            `tx blobs=${(tx.blobs ?? []).length} exceeds block limit=${
              blobGasLimit / blobGasPerBlob
            }`,
          )
        }
      } else {
        tx = createTxFromRLP(txBuf, { common })
      }
    } catch (e: any) {
      throw {
        code: PARSE_ERROR,
        message: `serialized tx data could not be parsed (${e.message})`,
      }
    }

    if (!tx.isSigned()) {
      throw {
        code: INVALID_PARAMS,
        message: `tx needs to be signed`,
      }
    }

    // Add the tx to own tx pool
    const { txPool, pool } = this.service as FullEthereumService

    try {
      await txPool.add(tx, true)
      txPool.sendNewTxHashes([[tx.type], [tx.serialize().byteLength], [tx.hash()]], pool.peers)
    } catch (error: any) {
      throw {
        code: INVALID_PARAMS,
        message: error.message ?? error.toString(),
      }
    }

    const peerPool = this.service.pool
    if (
      peerPool.peers.length === 0 &&
      !this.client.config.mine &&
      this.client.config.isSingleNode === false
    ) {
      throw {
        code: INTERNAL_ERROR,
        message: `no peer connection available`,
      }
    }
    txPool.sendTransactions([tx], peerPool.peers)

    return bytesToHex(tx.hash())
  }

  /**
   * Returns an account object along with data about the proof.
   * @param params An array of three parameters:
   *   1. address of the account
   *   2. array of storage keys which should be proofed and included
   *   3. integer block number, or the string "latest" or "earliest"
   * @returns The {@link Proof}
   */
  async getProof(
    params: [PrefixedHexString, PrefixedHexString[], PrefixedHexString],
  ): Promise<Proof> {
    const [addressHex, slotsHex, blockOpt] = params
    const block = await getBlockByOption(blockOpt, this._chain)

    if (this._vm === undefined) {
      throw EthereumJSErrorUnsetCode('missing vm')
    }

    const vm = await this._vm.shallowCopy()

    await vm.stateManager.setStateRoot(block.header.stateRoot)

    const address = createAddressFromString(addressHex)
    const slots = slotsHex.map((slotHex) => setLengthLeft(hexToBytes(slotHex), 32))
    let proof: Proof
    if (vm.stateManager instanceof MerkleStateManager) {
      proof = await getMerkleStateProof(vm.stateManager, address, slots)
    } else if (vm.stateManager instanceof StatelessVerkleStateManager) {
      proof = await getVerkleStateProof(vm.stateManager, address, slots)
    } else {
      throw EthereumJSErrorUnsetCode(
        'getProof RPC method not supported with the StateManager provided',
      )
    }

    for (const p of proof.storageProof) {
      p.key = bigIntToHex(BigInt(p.key))
    }
    return proof
  }

  /**
   * Returns an object with data about the sync status or false.
   * @returns An object with sync status data or false (when not syncing)
   *   * startingBlock - The block at which the import started (will only be reset after the sync reached his head)
   *   * currentBlock - The current block, same as eth_blockNumber
   *   * highestBlock - The estimated highest block
   */
  async syncing() {
    if (this.client.config.synchronized) {
      return false
    }

    const currentBlockHeader =
      this._chain.headers?.latest ?? (await this._chain.getCanonicalHeadHeader())
    const currentBlock = bigIntToHex(currentBlockHeader.number)

    const synchronizer = this.client.service!.synchronizer
    if (!synchronizer) {
      return false
    }
    const { syncTargetHeight } = this.client.config
    const startingBlock = bigIntToHex(synchronizer.startingBlock)

    let highestBlock
    if (typeof syncTargetHeight === 'bigint' && syncTargetHeight !== BIGINT_0) {
      highestBlock = bigIntToHex(syncTargetHeight)
    } else {
      const bestPeer = await synchronizer.best()
      if (!bestPeer) {
        throw {
          code: INTERNAL_ERROR,
          message: `no peer available for synchronization`,
        }
      }
      const highestBlockHeader = await bestPeer.latest()
      if (!highestBlockHeader) {
        throw {
          code: INTERNAL_ERROR,
          message: `highest block header unavailable`,
        }
      }
      highestBlock = bigIntToHex(highestBlockHeader.number)
    }

    return { startingBlock, currentBlock, highestBlock }
  }

  /**
   * Returns the transaction count for a block given by the block number.
   * @param params An array of one parameter:
   *  1. integer of a block number, or the string "latest", "earliest" or "pending"
   */
  async getBlockTransactionCountByNumber(params: [string]) {
    const [blockOpt] = params
    const block = await getBlockByOption(blockOpt, this._chain)
    return intToHex(block.transactions.length)
  }

  /**
   * Gas price oracle.
   *
   * Returns a suggested gas price.
   * @returns a hex code of an integer representing the suggested gas price in wei.
   */
  async gasPrice() {
    // TODO: going more strict on parameter accesses in Common (PR #3532) revealed that this line had
    // absolutely no effect by accessing a non-present gas parameter. Someone familiar with the RPC method
    // implementation should look over it and recall what was meant to be accomplished here.
    const minGasPrice = BIGINT_0 //: bigint = this._chain.config.chainCommon.param('minPrice')
    let gasPrice = BIGINT_0
    const latest = await this._chain.getCanonicalHeadHeader()
    if (this._vm !== undefined && this._vm.common.isActivatedEIP(1559)) {
      const baseFee = latest.calcNextBaseFee()
      let priorityFee = BIGINT_0
      const block = await this._chain.getBlock(latest.number)
      for (const tx of block.transactions) {
        const maxPriorityFeePerGas = (tx as FeeMarket1559Tx).maxPriorityFeePerGas
        priorityFee += maxPriorityFeePerGas
      }

      priorityFee =
        priorityFee !== BIGINT_0 ? priorityFee / BigInt(block.transactions.length) : BIGINT_1
      gasPrice = baseFee + priorityFee > minGasPrice ? baseFee + priorityFee : minGasPrice
    } else {
      // For chains that don't support EIP-1559 we iterate over the last 20
      // blocks to get an average gas price.
      const blockIterations = 20 < latest.number ? 20 : latest.number
      let txCount = BIGINT_0
      for (let i = 0; i < blockIterations; i++) {
        const block = await this._chain.getBlock(latest.number - BigInt(i))
        if (block.transactions.length === 0) {
          continue
        }

        for (const tx of block.transactions) {
          const txGasPrice = (tx as LegacyTx).gasPrice
          gasPrice += txGasPrice
          txCount++
        }
      }

      if (txCount > 0) {
        const avgGasPrice = gasPrice / txCount
        gasPrice = avgGasPrice > minGasPrice ? avgGasPrice : minGasPrice
      } else {
        gasPrice = minGasPrice
      }
    }

    return bigIntToHex(gasPrice)
  }

  async feeHistory(params: [string | number | bigint, string, [number]?]) {
    const blockCount = BigInt(params[0])
    const [, lastBlockRequested, priorityFeePercentiles] = params

    if (blockCount < 1 || blockCount > 1024) {
      throw {
        code: INVALID_PARAMS,
        message: 'invalid block count',
      }
    }

    const { number: lastRequestedBlockNumber } = (
      await getBlockByOption(lastBlockRequested, this._chain)
    ).header

    const oldestBlockNumber = bigIntMax(lastRequestedBlockNumber - blockCount + BIGINT_1, BIGINT_0)

    const requestedBlockNumbers = Array.from(
      { length: Number(blockCount) },
      (_, i) => oldestBlockNumber + BigInt(i),
    )

    const requestedBlocks = await Promise.all(
      requestedBlockNumbers.map((n) => getBlockByOption(n.toString(), this._chain)),
    )

    const [baseFees, gasUsedRatios, baseFeePerBlobGas, blobGasUsedRatio] = requestedBlocks.reduce(
      (v, b) => {
        const [prevBaseFees, prevGasUsedRatios, prevBaseFeesPerBlobGas, prevBlobGasUsedRatio] = v
        const { baseFeePerGas, gasUsed, gasLimit, blobGasUsed } = b.header

        let baseFeePerBlobGas = BIGINT_0
        let blobGasUsedRatio = 0
        if (b.header.excessBlobGas !== undefined) {
          baseFeePerBlobGas = b.header.getBlobGasPrice()
          const max = b.common.param('maxBlobGasPerBlock')
          blobGasUsedRatio = Number(blobGasUsed) / Number(max)
        }

        prevBaseFees.push(baseFeePerGas ?? BIGINT_0)
        prevGasUsedRatios.push(Number(gasUsed) / Number(gasLimit))

        prevBaseFeesPerBlobGas.push(baseFeePerBlobGas)
        prevBlobGasUsedRatio.push(blobGasUsedRatio)

        return [prevBaseFees, prevGasUsedRatios, prevBaseFeesPerBlobGas, prevBlobGasUsedRatio]
      },
      [[], [], [], []] as [bigint[], number[], bigint[], number[]],
    )

    const londonHardforkBlockNumber = this._chain.blockchain.common.hardforkBlock(Hardfork.London)!
    const nextBaseFee =
      lastRequestedBlockNumber - londonHardforkBlockNumber >= BIGINT_NEG1
        ? requestedBlocks[requestedBlocks.length - 1].header.calcNextBaseFee()
        : BIGINT_0
    baseFees.push(nextBaseFee)

    if (this._chain.blockchain.common.isActivatedEIP(4844)) {
      baseFeePerBlobGas.push(
        // use the last blocks common for fee estimation
        requestedBlocks[requestedBlocks.length - 1].header.calcNextBlobGasPrice(
          requestedBlocks[requestedBlocks.length - 1].header.common,
        ),
      )
    } else {
      // TODO (?): known bug
      // If the next block is the first block where 4844 is returned, then
      // BIGINT_1 should be pushed, not BIGINT_0
      baseFeePerBlobGas.push(BIGINT_0)
    }

    let rewards: bigint[][] = []

    if (this.receiptsManager && priorityFeePercentiles) {
      rewards = await Promise.all(
        requestedBlocks.map((b) =>
          calculateRewards(b, this.receiptsManager!, priorityFeePercentiles),
        ),
      )
    }

    return {
      baseFeePerGas: baseFees.map(bigIntToHex),
      gasUsedRatio: gasUsedRatios,
      baseFeePerBlobGas: baseFeePerBlobGas.map(bigIntToHex),
      blobGasUsedRatio,
      oldestBlock: bigIntToHex(oldestBlockNumber),
      reward: rewards.map((r) => r.map(bigIntToHex)),
    }
  }

  /**
   *
   * @returns the blob base fee for the next/pending block in wei
   */
  async blobBaseFee() {
    const headBlock = await this._chain.getCanonicalHeadHeader()
    // use headBlock's common to estimate the next blob fee
    return bigIntToHex(headBlock.calcNextBlobGasPrice(headBlock.common))
  }
}
