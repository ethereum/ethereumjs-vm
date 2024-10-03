import {
  TypeOutput,
  bigIntToHex,
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  toType,
} from '@ethereumjs/util'
import { type VM, encodeReceipt, runTx } from '@ethereumjs/vm'

import { INTERNAL_ERROR, INVALID_PARAMS } from '../error-code.js'
import { callWithStackTrace, getBlockByOption } from '../helpers.js'
import { middleware, validators } from '../validation.js'

import type { Chain } from '../../blockchain/index.js'
import type { EthereumClient } from '../../index.js'
import type { FullEthereumService } from '../../service/index.js'
import type { RPCTx } from '../types.js'
import type { Block } from '@ethereumjs/block'
import type { PrefixedHexString } from '@ethereumjs/util'

export interface tracerOpts {
  disableStack?: boolean
  disableStorage?: boolean
  enableMemory?: boolean
  enableReturnData?: boolean
  tracer?: string
  timeout?: string
  tracerConfig?: any
}

export interface structLog {
  depth: number
  gas: number
  gasCost: number
  op: string
  pc: number
  stack: string[] | undefined
  memory: string[] | undefined
  returnData: string[] | undefined
  storage: {
    [key: string]: string
  }
  error: boolean | undefined | null
}
/**
 * Validate tracer opts to ensure only supports opts are provided
 * @param opts a dictionary of {@link tracerOpts}
 * @returns a dictionary of valid {@link tracerOpts}
 * @throws if invalid tracer options are provided
 */
const validateTracerConfig = (opts: tracerOpts): tracerOpts => {
  if (opts.tracerConfig !== undefined) {
    throw {
      code: INVALID_PARAMS,
      message: 'custom tracers and tracer configurations are not implemented',
    }
  }
  if (opts.tracer !== undefined) {
    throw {
      code: INVALID_PARAMS,
      message: 'custom tracers not implemented',
    }
  }
  if (opts.timeout !== undefined) {
    throw {
      code: INVALID_PARAMS,
      message: 'custom tracer timeouts not implemented',
    }
  }

  if (opts.enableReturnData === true) {
    throw {
      code: INVALID_PARAMS,
      message: 'enabling return data not implemented',
    }
  }
  return {
    ...{ disableStack: false, disableStorage: false, enableMemory: false, enableReturnData: false },
    ...opts,
  }
}
/**
 * debug_* RPC module
 * @memberof module:rpc/modules
 */
export class Debug {
  private service: FullEthereumService
  private chain: Chain
  private vm: VM
  private _rpcDebug: boolean
  /**
   * Create debug_* RPC module
   * @param client Client to which the module binds
   */
  constructor(client: EthereumClient, rpcDebug: boolean) {
    this.service = client.services.find((s) => s.name === 'eth') as FullEthereumService
    this.chain = this.service.chain
    this.vm = (this.service as FullEthereumService).execution?.vm
    this._rpcDebug = rpcDebug
    this.traceTransaction = middleware(
      callWithStackTrace(this.traceTransaction.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )
    this.traceCall = middleware(callWithStackTrace(this.traceCall.bind(this), this._rpcDebug), 2, [
      [validators.transaction()],
      [validators.blockOption],
    ])
    this.storageRangeAt = middleware(
      callWithStackTrace(this.storageRangeAt.bind(this), this._rpcDebug),
      5,
      [
        [validators.blockHash],
        [validators.unsignedInteger],
        [validators.address],
        [validators.uint256],
        [validators.unsignedInteger],
      ],
    )
    this.getRawBlock = middleware(
      callWithStackTrace(this.getRawBlock.bind(this), this._rpcDebug),
      1,
      [[validators.blockOption]],
    )
    this.getRawHeader = middleware(
      callWithStackTrace(this.getRawHeader.bind(this), this._rpcDebug),
      1,
      [[validators.blockOption]],
    )
    this.getRawReceipts = middleware(
      callWithStackTrace(this.getRawReceipts.bind(this), this._rpcDebug),
      1,
      [[validators.blockOption]],
    )
    this.getRawTransaction = middleware(
      callWithStackTrace(this.getRawTransaction.bind(this), this._rpcDebug),
      1,
      [[validators.hex]],
    )
  }

  /**
   * Returns a call trace for the requested transaction or null if not available
   * @param params an array of two parameters:
   *     1. string representing the transaction hash
   *     2. an optional tracer options object
   */
  async traceTransaction(params: [PrefixedHexString, tracerOpts]) {
    const [txHash, config] = params

    // Validate configuration and parameters
    if (!this.service.execution.receiptsManager) {
      throw {
        message: 'missing receiptsManager',
        code: INTERNAL_ERROR,
      }
    }

    const opts = validateTracerConfig(config)

    const result = await this.service.execution.receiptsManager.getReceiptByTxHash(
      hexToBytes(txHash),
    )
    if (!result) return null
    const [_, blockHash, txIndex] = result
    const block = await this.service.chain.getBlock(blockHash)
    const parentBlock = await this.service.chain.getBlock(block.header.parentHash)
    const tx = block.transactions[txIndex]

    // Copy VM so as to not modify state when running transactions being traced
    const vmCopy = await this.service.execution.vm.shallowCopy()
    await vmCopy.stateManager.setStateRoot(parentBlock.header.stateRoot)
    for (let x = 0; x < txIndex; x++) {
      // Run all txns in the block prior to the traced transaction
      await runTx(vmCopy, { tx: block.transactions[x], block })
    }

    const trace = {
      gas: '',
      returnValue: '',
      failed: false,
      structLogs: [] as structLog[],
    }
    vmCopy.evm.events?.on('step', async (step, next) => {
      const memory = []
      let storage = {}
      if (opts.disableStorage === false) {
        if (!('dumpStorage' in vmCopy.stateManager)) {
          throw {
            message: 'stateManager has no dumpStorage implementation',
            code: INTERNAL_ERROR,
          }
        }
        storage = await vmCopy.stateManager.dumpStorage!(step.address)
      }
      if (opts.enableMemory === true) {
        for (let x = 0; x < step.memoryWordCount; x++) {
          const word = bytesToHex(step.memory.slice(x * 32, 32))
          memory.push(word)
        }
      }
      const log = {
        pc: step.pc,
        op: step.opcode.name,
        gasCost: step.opcode.fee + Number(step.opcode.dynamicFee),
        gas: Number(step.gasLeft),
        depth: step.depth,
        error: null,
        stack: opts.disableStack !== true ? step.stack.map(bigIntToHex) : undefined,
        storage,
        memory,
        returnData: undefined,
      }
      trace.structLogs.push(log)
      next?.()
    })

    vmCopy.evm.events?.on('afterMessage', (data, next) => {
      if (data.execResult.exceptionError !== undefined && trace.structLogs.length > 0) {
        // Mark last opcode trace as error if exception occurs
        trace.structLogs[trace.structLogs.length - 1].error = true
      }
      next?.()
    })
    const res = await runTx(vmCopy, { tx, block })
    trace.gas = bigIntToHex(res.totalGasSpent)
    trace.failed = res.execResult.exceptionError !== undefined
    trace.returnValue = bytesToHex(res.execResult.returnValue)
    return trace
  }

  /**
   * Returns a trace of an eth_call within the context of the given block execution using the final state of the parent block
   * @param params an array of 3 parameters:
   *    1. an {@link RPCTx} object that mirrors the eth_call parameters object
   *    2. A block hash or number formatted as a hex prefixed string
   *    3. An optional tracer options object
   * @returns an execution trace of an {@link eth_call} in the context of a given block execution
   * mirroring the output from {@link traceTransaction}
   */
  async traceCall(params: [RPCTx, string, tracerOpts]) {
    const [callArgs, blockOpt, tracerOpts] = params

    // Validate configuration and parameters
    if (!this.service.execution.receiptsManager) {
      throw {
        message: 'missing receiptsManager',
        code: INTERNAL_ERROR,
      }
    }

    if (this.vm === undefined) {
      throw new Error('missing vm')
    }

    const opts = validateTracerConfig(tracerOpts)

    const block = await getBlockByOption(blockOpt, this.chain)
    const parentBlock = await this.service.chain.getBlock(block.header.parentHash)

    const vm = await this.vm.shallowCopy()
    await vm.stateManager.setStateRoot(parentBlock.header.stateRoot)
    const { from, to, gas: gasLimit, gasPrice, value, data } = callArgs

    const trace = {
      gas: '',
      returnValue: '',
      failed: false,
      structLogs: [] as structLog[],
    }
    vm.evm.events?.on('step', async (step, next) => {
      const memory = []
      let storage = {}
      if (opts.disableStorage === false) {
        if (!('dumpStorage' in vm.stateManager)) {
          throw {
            message: 'stateManager has no dumpStorage implementation',
            code: INTERNAL_ERROR,
          }
        }
        storage = await vm.stateManager.dumpStorage!(step.address)
      }
      if (opts.enableMemory === true) {
        for (let x = 0; x < step.memoryWordCount; x++) {
          const word = bytesToHex(step.memory.slice(x * 32, 32))
          memory.push(word)
        }
      }
      const log = {
        pc: step.pc,
        op: step.opcode.name,
        gasCost: step.opcode.fee + Number(step.opcode.dynamicFee),
        gas: Number(step.gasLeft),
        depth: step.depth,
        error: null,
        stack: opts.disableStack !== true ? step.stack.map(bigIntToHex) : undefined,
        storage,
        memory,
        returnData: undefined,
      }
      trace.structLogs.push(log)
      next?.()
    })

    vm.evm.events?.on('afterMessage', (data, next) => {
      if (data.execResult.exceptionError !== undefined && trace.structLogs.length > 0) {
        // Mark last opcode trace as error if exception occurs
        trace.structLogs[trace.structLogs.length - 1].error = true
      }
      next?.()
    })
    const runCallOpts = {
      caller: from !== undefined ? createAddressFromString(from) : undefined,
      to: to !== undefined ? createAddressFromString(to) : undefined,
      gasLimit: toType(gasLimit, TypeOutput.BigInt),
      gasPrice: toType(gasPrice, TypeOutput.BigInt),
      value: toType(value, TypeOutput.BigInt),
      data: data !== undefined ? hexToBytes(data) : undefined,
    }
    const res = await vm.evm.runCall(runCallOpts)
    trace.gas = bigIntToHex(res.execResult.executionGasUsed)
    trace.failed = res.execResult.exceptionError !== undefined
    trace.returnValue = bytesToHex(res.execResult.returnValue)
    return trace
  }

  /**
   * Returns a limited set of storage keys belonging to an account.
   * @param params An array of 5 parameters:
   *    1. The hash of the block at which to get storage from the state.
   *    2. The transaction index of the requested block post which to get the storage.
   *    3. The address of the account.
   *    4. The starting (hashed) key from which storage will be returned. To include the entire range, pass '0x00'.
   *    5. The maximum number of storage values that could be returned.
   * @returns A {@link StorageRange} object that will contain at most `limit` entries in its `storage` field.
   * The object will also contain `nextKey`, the next (hashed) storage key after the range included in `storage`.
   */
  async storageRangeAt(
    params: [PrefixedHexString, number, PrefixedHexString, PrefixedHexString, number],
  ) {
    const [blockHash, txIndex, account, startKey, limit] = params

    if (this.vm === undefined) {
      throw new Error('Missing VM.')
    }

    let block: Block
    try {
      // Validator already verified that `blockHash` is properly formatted.
      block = await this.chain.getBlock(hexToBytes(blockHash))
    } catch {
      throw {
        code: INTERNAL_ERROR,
        message: 'Could not get requested block hash.',
      }
    }

    if (txIndex >= block.transactions.length) {
      throw {
        code: INTERNAL_ERROR,
        message: 'txIndex cannot be larger than the number of transactions in the block.',
      }
    }

    const parentBlock = await this.chain.getBlock(block.header.parentHash)
    // Copy the VM and run transactions including the relevant transaction.
    const vmCopy = await this.vm.shallowCopy()
    if (!('dumpStorageRange' in vmCopy.stateManager)) {
      throw {
        code: INTERNAL_ERROR,
        message: 'stateManager has no dumpStorageRange implementation',
      }
    }
    await vmCopy.stateManager.setStateRoot(parentBlock.header.stateRoot)
    for (let i = 0; i <= txIndex; i++) {
      await runTx(vmCopy, { tx: block.transactions[i], block })
    }

    // await here so that any error can be handled in the catch below for proper response
    return vmCopy.stateManager.dumpStorageRange!(
      // Validator already verified that `account` and `startKey` are properly formatted.
      createAddressFromString(account),
      BigInt(startKey),
      limit,
    )
  }
  /**
   * Returns an RLP-encoded block
   * @param blockOpt Block number or tag
   */
  async getRawBlock(params: [string]) {
    const [blockOpt] = params
    const block = await getBlockByOption(blockOpt, this.chain)
    return bytesToHex(block.serialize())
  }
  /**
   * Returns an RLP-encoded block header
   * @param blockOpt Block number or tag
   * @returns
   */
  async getRawHeader(params: [string]) {
    const [blockOpt] = params
    const block = await getBlockByOption(blockOpt, this.chain)
    return bytesToHex(block.header.serialize())
  }
  /**
   * Returns an array of EIP-2718 binary-encoded receipts
   * @param blockOpt Block number or tag
   */
  async getRawReceipts(params: [string]) {
    const [blockOpt] = params
    if (!this.service.execution.receiptsManager) throw new Error('missing receiptsManager')
    const block = await getBlockByOption(blockOpt, this.chain)
    const receipts = await this.service.execution.receiptsManager.getReceipts(
      block.hash(),
      true,
      true,
    )
    return receipts.map((r) => bytesToHex(encodeReceipt(r, r.txType)))
  }
  /**
   * Returns the bytes of the transaction.
   * @param blockOpt Block number or tag
   */
  async getRawTransaction(params: [PrefixedHexString]) {
    const [txHash] = params
    if (!this.service.execution.receiptsManager) throw new Error('missing receiptsManager')
    const result = await this.service.execution.receiptsManager.getReceiptByTxHash(
      hexToBytes(txHash),
    )
    if (!result) return null
    const [_receipt, blockHash, txIndex] = result
    const block = await this.chain.getBlock(blockHash)
    const tx = block.transactions[txIndex]
    return bytesToHex(tx.serialize())
  }
}
