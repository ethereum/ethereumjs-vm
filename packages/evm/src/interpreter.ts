import { ConsensusAlgorithm } from '@ethereumjs/common'
import {
  Account,
  BIGINT_0,
  BIGINT_1,
  BIGINT_2,
  EthereumJSErrorWithoutCode,
  MAX_UINT64,
  bigIntToHex,
  bytesToBigInt,
  bytesToHex,
  equalsBytes,
  setLengthRight,
} from '@ethereumjs/util'
import debugDefault from 'debug'

import { FORMAT, MAGIC, VERSION } from './eof/constants.js'
import { EOFContainerMode, validateEOF } from './eof/container.js'
import { setupEOF } from './eof/setup.js'
import { ContainerSectionType } from './eof/verify.js'
import { ERROR, EvmError } from './exceptions.js'
import { type EVMPerformanceLogger, type Timer } from './logger.js'
import { Memory } from './memory.js'
import { Message } from './message.js'
import { trap } from './opcodes/index.js'
import { Stack } from './stack.js'

import type { EVM } from './evm.js'
import type { Journal } from './journal.js'
import type { AsyncOpHandler, Opcode, OpcodeMapEntry } from './opcodes/index.js'
import type {
  Block,
  EOFEnv,
  EVMMockBlockchainInterface,
  EVMProfilerOpts,
  EVMResult,
  Log,
} from './types.js'
import type {
  Common,
  StateManagerInterface,
  VerkleAccessWitnessInterface,
} from '@ethereumjs/common'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

const debugGas = debugDefault('evm:gas')

export interface InterpreterOpts {
  pc?: number
}

/**
 * Immediate (unprocessed) result of running an EVM bytecode.
 */
export interface RunResult {
  logs: Log[]
  returnValue?: Uint8Array
  /**
   * A set of accounts to selfdestruct
   */
  selfdestruct: Set<PrefixedHexString>

  /**
   * A map which tracks which addresses were created (used in EIP 6780)
   */
  createdAddresses?: Set<PrefixedHexString>
}

export interface Env {
  address: Address
  caller: Address
  callData: Uint8Array
  callValue: bigint
  code: Uint8Array
  isStatic: boolean
  isCreate: boolean
  depth: number
  gasPrice: bigint
  origin: Address
  block: Block
  contract: Account
  codeAddress: Address /* Different than address for DELEGATECALL and CALLCODE */
  gasRefund: bigint /* Current value (at begin of the frame) of the gas refund */
  eof?: EOFEnv /* Optional EOF environment in case of EOF execution */
  blobVersionedHashes: PrefixedHexString[] /** Versioned hashes for blob transactions */
  createdAddresses?: Set<string>
  accessWitness?: VerkleAccessWitnessInterface
  chargeCodeAccesses?: boolean
}

export interface RunState {
  programCounter: number
  opCode: number
  memory: Memory
  memoryWordCount: bigint
  highestMemCost: bigint
  stack: Stack
  code: Uint8Array
  shouldDoJumpAnalysis: boolean
  validJumps: Uint8Array // array of values where validJumps[index] has value 0 (default), 1 (jumpdest), 2 (beginsub)
  cachedPushes: { [pc: number]: bigint }
  stateManager: StateManagerInterface
  blockchain: EVMMockBlockchainInterface
  env: Env
  messageGasLimit?: bigint // Cache value from `gas.ts` to save gas limit for a message call
  interpreter: Interpreter
  gasRefund: bigint // Tracks the current refund
  gasLeft: bigint // Current gas left
  returnBytes: Uint8Array /* Current bytes in the return Uint8Array. Cleared each time a CALL/CREATE is made in the current frame. */
}

export interface InterpreterResult {
  runState: RunState
  exceptionError?: EvmError
}

export interface InterpreterStep {
  gasLeft: bigint
  gasRefund: bigint
  stateManager: StateManagerInterface
  stack: bigint[]
  pc: number
  depth: number
  opcode: {
    name: string
    fee: number
    dynamicFee?: bigint
    isAsync: boolean
  }
  account: Account
  address: Address
  memory: Uint8Array
  memoryWordCount: bigint
  codeAddress: Address
}

/**
 * Parses and executes EVM bytecode.
 */
export class Interpreter {
  protected _vm: any
  protected _runState: RunState
  protected _stateManager: StateManagerInterface
  protected common: Common
  public _evm: EVM
  public journal: Journal
  _env: Env

  // Keep track of this Interpreter run result
  // TODO move into Env?
  _result: RunResult

  // Opcode debuggers (e.g. { 'push': [debug Object], 'sstore': [debug Object], ...})
  private opDebuggers: { [key: string]: (debug: string) => void } = {}

  private profilerOpts?: EVMProfilerOpts
  private performanceLogger: EVMPerformanceLogger

  // TODO remove gasLeft as constructor argument
  constructor(
    evm: EVM,
    stateManager: StateManagerInterface,
    blockchain: EVMMockBlockchainInterface,
    env: Env,
    gasLeft: bigint,
    journal: Journal,
    performanceLogs: EVMPerformanceLogger,
    profilerOpts?: EVMProfilerOpts,
  ) {
    this._evm = evm
    this._stateManager = stateManager
    this.common = this._evm.common

    if (
      this.common.consensusType() === 'poa' &&
      this._evm['_optsCached'].cliqueSigner === undefined
    )
      throw EthereumJSErrorWithoutCode(
        'Must include cliqueSigner function if clique/poa is being used for consensus type',
      )

    this._runState = {
      programCounter: 0,
      opCode: 0xfe, // INVALID opcode
      memory: new Memory(),
      memoryWordCount: BIGINT_0,
      highestMemCost: BIGINT_0,
      stack: new Stack(),
      code: new Uint8Array(0),
      validJumps: Uint8Array.from([]),
      cachedPushes: {},
      stateManager: this._stateManager,
      blockchain,
      env,
      shouldDoJumpAnalysis: true,
      interpreter: this,
      gasRefund: env.gasRefund,
      gasLeft,
      returnBytes: new Uint8Array(0),
    }
    this.journal = journal
    this._env = env
    this._result = {
      logs: [],
      returnValue: undefined,
      selfdestruct: new Set(),
    }
    this.profilerOpts = profilerOpts
    this.performanceLogger = performanceLogs
  }

  async run(code: Uint8Array, opts: InterpreterOpts = {}): Promise<InterpreterResult> {
    if (!this.common.isActivatedEIP(3540) || code[0] !== FORMAT) {
      // EIP-3540 isn't active and first byte is not 0xEF - treat as legacy bytecode
      this._runState.code = code
    } else if (this.common.isActivatedEIP(3540)) {
      if (code[1] !== MAGIC) {
        // Bytecode contains invalid EOF magic byte
        return {
          runState: this._runState,
          exceptionError: new EvmError(ERROR.INVALID_BYTECODE_RESULT),
        }
      }
      if (code[2] !== VERSION) {
        // Bytecode contains invalid EOF version number
        return {
          runState: this._runState,
          exceptionError: new EvmError(ERROR.INVALID_EOF_FORMAT),
        }
      }
      this._runState.code = code

      const isTxCreate = this._env.isCreate && this._env.depth === 0
      const eofMode = isTxCreate ? EOFContainerMode.TxInitmode : EOFContainerMode.Default

      try {
        setupEOF(this._runState, eofMode)
      } catch (e) {
        return {
          runState: this._runState,
          exceptionError: new EvmError(ERROR.INVALID_EOF_FORMAT), // TODO: verify if all gas should be consumed
        }
      }

      if (isTxCreate) {
        // Tx tries to deploy container
        try {
          validateEOF(
            this._runState.code,
            this._evm,
            ContainerSectionType.InitCode,
            EOFContainerMode.TxInitmode,
          )
        } catch (e) {
          // Trying to deploy an invalid EOF container
          return {
            runState: this._runState,
            exceptionError: new EvmError(ERROR.INVALID_EOF_FORMAT), // TODO: verify if all gas should be consumed
          }
        }
      }
    }
    this._runState.programCounter = opts.pc ?? this._runState.programCounter
    // Check that the programCounter is in range
    const pc = this._runState.programCounter
    if (pc !== 0 && (pc < 0 || pc >= this._runState.code.length)) {
      throw EthereumJSErrorWithoutCode('Internal error: program counter not in range')
    }

    let err
    let cachedOpcodes: OpcodeMapEntry[]
    let doJumpAnalysis = true

    let timer: Timer | undefined
    let overheadTimer: Timer | undefined
    if (this.profilerOpts?.enabled === true && this.performanceLogger.hasTimer()) {
      timer = this.performanceLogger.pauseTimer()
      overheadTimer = this.performanceLogger.startTimer('Overhead')
    }

    // Iterate through the given ops until something breaks or we hit STOP
    while (this._runState.programCounter < this._runState.code.length) {
      const programCounter = this._runState.programCounter
      let opCode: number
      let opCodeObj: OpcodeMapEntry
      if (doJumpAnalysis) {
        opCode = this._runState.code[programCounter]
        // Only run the jump destination analysis if `code` actually contains a JUMP/JUMPI/JUMPSUB opcode
        if (opCode === 0x56 || opCode === 0x57 || opCode === 0x5e) {
          const { jumps, pushes, opcodesCached } = this._getValidJumpDestinations(
            this._runState.code,
          )
          this._runState.validJumps = jumps
          this._runState.cachedPushes = pushes
          this._runState.shouldDoJumpAnalysis = false
          cachedOpcodes = opcodesCached
          doJumpAnalysis = false
        }
      } else {
        opCodeObj = cachedOpcodes![programCounter]
        opCode = opCodeObj.opcodeInfo.code
      }

      // if its an invalid opcode with verkle activated, then check if its because of a missing code
      // chunk in the witness, and throw appropriate error to distinguish from an actual invalid opcode
      if (
        opCode === 0xfe &&
        this.common.isActivatedEIP(6800) &&
        // is this a code loaded from state using witnesses
        this._runState.env.chargeCodeAccesses === true
      ) {
        const contract = this._runState.interpreter.getAddress()

        if (
          !(await this._runState.stateManager.checkChunkWitnessPresent!(contract, programCounter))
        ) {
          throw Error(`Invalid witness with missing codeChunk for pc=${programCounter}`)
        }
      }

      this._runState.opCode = opCode!

      try {
        if (overheadTimer !== undefined) {
          this.performanceLogger.pauseTimer()
        }
        await this.runStep(opCodeObj!)
        if (overheadTimer !== undefined) {
          this.performanceLogger.unpauseTimer(overheadTimer)
        }
      } catch (e: any) {
        // Revert access witness changes if we revert - per EIP-4762
        this._runState.env.accessWitness?.revert()
        if (overheadTimer !== undefined) {
          this.performanceLogger.unpauseTimer(overheadTimer)
        }
        // re-throw on non-VM errors
        if (!('errorType' in e && e.errorType === 'EvmError')) {
          throw e
        }
        // STOP is not an exception
        if (e.error !== ERROR.STOP) {
          err = e
        }
        break
      }
    }

    if (timer !== undefined) {
      this.performanceLogger.stopTimer(overheadTimer!, 0)
      this.performanceLogger.unpauseTimer(timer)
    }

    return {
      runState: this._runState,
      exceptionError: err,
    }
  }

  /**
   * Executes the opcode to which the program counter is pointing,
   * reducing its base gas cost, and increments the program counter.
   */
  async runStep(opcodeObj?: OpcodeMapEntry): Promise<void> {
    const opEntry = opcodeObj ?? this.lookupOpInfo(this._runState.opCode)
    const opInfo = opEntry.opcodeInfo

    let timer: Timer

    if (this.profilerOpts?.enabled === true) {
      timer = this.performanceLogger.startTimer(opInfo.name)
    }

    let gas = opInfo.feeBigInt

    try {
      if (opInfo.dynamicGas) {
        // This function updates the gas in-place.
        // It needs the base fee, for correct gas limit calculation for the CALL opcodes
        gas = await opEntry.gasHandler(this._runState, gas, this.common)
      }

      if (this._evm.events.listenerCount('step') > 0 || this._evm.DEBUG) {
        // Only run this stepHook function if there is an event listener (e.g. test runner)
        // or if the vm is running in debug mode (to display opcode debug logs)
        await this._runStepHook(gas, this.getGasLeft())
      }

      if (this.common.isActivatedEIP(6800) && this._env.chargeCodeAccesses === true) {
        const contract = this._runState.interpreter.getAddress()
        const statelessGas = this._runState.env.accessWitness!.readAccountCodeChunks(
          contract,
          this._runState.programCounter,
          this._runState.programCounter,
        )
        gas += statelessGas
        debugGas(`codechunk accessed statelessGas=${statelessGas} (-> ${gas})`)
      }

      // Check for invalid opcode
      if (opInfo.isInvalid) {
        throw new EvmError(ERROR.INVALID_OPCODE)
      }

      // Reduce opcode's base fee
      this.useGas(gas, opInfo)

      // Advance program counter
      this._runState.programCounter++

      // Execute opcode handler
      const opFn = opEntry.opHandler

      if (opInfo.isAsync) {
        await (opFn as AsyncOpHandler).apply(null, [this._runState, this.common])
      } else {
        opFn.apply(null, [this._runState, this.common])
      }
      this._runState.env.accessWitness?.commit()
    } finally {
      if (this.profilerOpts?.enabled === true) {
        this.performanceLogger.stopTimer(
          timer!,
          Number(gas),
          'opcodes',
          opInfo.fee,
          Number(gas) - opInfo.fee,
        )
      }
    }
  }

  /**
   * Get info for an opcode from EVM's list of opcodes.
   */
  lookupOpInfo(op: number): OpcodeMapEntry {
    return (<any>this._evm)._opcodeMap[op]
  }

  async _runStepHook(dynamicFee: bigint, gasLeft: bigint): Promise<void> {
    const opcodeInfo = this.lookupOpInfo(this._runState.opCode)
    const opcode = opcodeInfo.opcodeInfo
    const eventObj: InterpreterStep = {
      pc: this._runState.programCounter,
      gasLeft,
      gasRefund: this._runState.gasRefund,
      opcode: {
        name: opcode.fullName,
        fee: opcode.fee,
        dynamicFee,
        isAsync: opcode.isAsync,
      },
      stack: this._runState.stack.getStack(),
      depth: this._env.depth,
      address: this._env.address,
      account: this._env.contract,
      memory: this._runState.memory._store.subarray(0, Number(this._runState.memoryWordCount) * 32),
      memoryWordCount: this._runState.memoryWordCount,
      codeAddress: this._env.codeAddress,
      stateManager: this._runState.stateManager,
    }

    if (this._evm.DEBUG) {
      // Create opTrace for debug functionality
      let hexStack = []
      hexStack = eventObj.stack.map((item: any) => {
        return bigIntToHex(BigInt(item))
      })

      const name = eventObj.opcode.name

      const opTrace = {
        pc: eventObj.pc,
        op: name,
        gas: bigIntToHex(eventObj.gasLeft),
        gasCost: bigIntToHex(dynamicFee),
        stack: hexStack,
        depth: eventObj.depth,
      }

      if (!(name in this.opDebuggers)) {
        this.opDebuggers[name] = debugDefault(`evm:ops:${name}`)
      }
      this.opDebuggers[name](JSON.stringify(opTrace))
    }

    /**
     * The `step` event for trace output
     *
     * @event Event: step
     * @type {Object}
     * @property {Number} pc representing the program counter
     * @property {Object} opcode the next opcode to be ran
     * @property {string}     opcode.name
     * @property {fee}        opcode.number Base fee of the opcode
     * @property {dynamicFee} opcode.dynamicFee Dynamic opcode fee
     * @property {boolean}    opcode.isAsync opcode is async
     * @property {BigInt} gasLeft amount of gasLeft
     * @property {BigInt} gasRefund gas refund
     * @property {StateManager} stateManager a {@link StateManager} instance
     * @property {Array} stack an `Array` of `Uint8Arrays` containing the stack
     * @property {Array} returnStack the return stack
     * @property {Account} account the Account which owns the code running
     * @property {Address} address the address of the `account`
     * @property {Number} depth the current number of calls deep the contract is
     * @property {Uint8Array} memory the memory of the EVM as a `Uint8Array`
     * @property {BigInt} memoryWordCount current size of memory in words
     * @property {Address} codeAddress the address of the code which is currently being ran (this differs from `address` in a `DELEGATECALL` and `CALLCODE` call)
     */
    await (this._evm as any)._emit('step', eventObj)
  }

  // Returns all valid jump and jumpsub destinations.
  _getValidJumpDestinations(code: Uint8Array) {
    const jumps = new Uint8Array(code.length)
    const pushes: { [pc: number]: bigint } = {}

    const opcodesCached = Array(code.length)

    for (let i = 0; i < code.length; i++) {
      const opcode = code[i]
      opcodesCached[i] = this.lookupOpInfo(opcode)
      // skip over PUSH0-32 since no jump destinations in the middle of a push block
      if (opcode <= 0x7f) {
        if (opcode >= 0x60) {
          const bytesToPush = opcode - 0x5f
          let pushBytes = code.subarray(i + 1, i + opcode - 0x5e)
          if (pushBytes.length < bytesToPush) {
            pushBytes = setLengthRight(pushBytes, bytesToPush)
          }
          const push = bytesToBigInt(pushBytes)
          pushes[i + 1] = push
          i += bytesToPush
        } else if (opcode === 0x5b) {
          // Define a JUMPDEST as a 1 in the valid jumps array
          jumps[i] = 1
        }
      }
    }
    return { jumps, pushes, opcodesCached }
  }

  /**
   * Subtracts an amount from the gas counter.
   * @param amount - Amount of gas to consume
   * @param context - Usage context for debugging
   * @throws if out of gas
   */
  useGas(amount: bigint, context?: string | Opcode): void {
    this._runState.gasLeft -= amount
    if (this._evm.DEBUG) {
      let tempString = ''
      if (typeof context === 'string') {
        tempString = context + ': '
      } else if (context !== undefined) {
        tempString = `${context.name} fee: `
      }
      debugGas(`${tempString}used ${amount} gas (-> ${this._runState.gasLeft})`)
    }
    if (this._runState.gasLeft < BIGINT_0) {
      this._runState.gasLeft = BIGINT_0
      trap(ERROR.OUT_OF_GAS)
    }
  }

  /**
   * Adds a positive amount to the gas counter.
   * @param amount - Amount of gas refunded
   * @param context - Usage context for debugging
   */
  refundGas(amount: bigint, context?: string): void {
    if (this._evm.DEBUG) {
      debugGas(
        `${typeof context === 'string' ? context + ': ' : ''}refund ${amount} gas (-> ${
          this._runState.gasRefund
        })`,
      )
    }
    this._runState.gasRefund += amount
  }

  /**
   * Reduces amount of gas to be refunded by a positive value.
   * @param amount - Amount to subtract from gas refunds
   * @param context - Usage context for debugging
   */
  subRefund(amount: bigint, context?: string): void {
    if (this._evm.DEBUG) {
      debugGas(
        `${typeof context === 'string' ? context + ': ' : ''}sub gas refund ${amount} (-> ${
          this._runState.gasRefund
        })`,
      )
    }
    this._runState.gasRefund -= amount
    if (this._runState.gasRefund < BIGINT_0) {
      this._runState.gasRefund = BIGINT_0
      trap(ERROR.REFUND_EXHAUSTED)
    }
  }

  /**
   * Increments the internal gasLeft counter. Used for adding callStipend.
   * @param amount - Amount to add
   */
  addStipend(amount: bigint): void {
    if (this._evm.DEBUG) {
      debugGas(`add stipend ${amount} (-> ${this._runState.gasLeft})`)
    }
    this._runState.gasLeft += amount
  }

  /**
   * Returns balance of the given account.
   * @param address - Address of account
   */
  async getExternalBalance(address: Address): Promise<bigint> {
    // shortcut if current account
    if (address.equals(this._env.address)) {
      return this._env.contract.balance
    }

    let account = await this._stateManager.getAccount(address)
    if (!account) {
      account = new Account()
    }
    return account.balance
  }

  /**
   * Store 256-bit a value in memory to persistent storage.
   */
  async storageStore(key: Uint8Array, value: Uint8Array): Promise<void> {
    await this._stateManager.putStorage(this._env.address, key, value)
    const account = await this._stateManager.getAccount(this._env.address)
    if (!account) {
      throw EthereumJSErrorWithoutCode('could not read account while persisting memory')
    }
    this._env.contract = account
  }

  /**
   * Loads a 256-bit value to memory from persistent storage.
   * @param key - Storage key
   * @param original - If true, return the original storage value (default: false)
   */
  async storageLoad(key: Uint8Array, original = false): Promise<Uint8Array> {
    if (original) {
      return this._stateManager.originalStorageCache.get(this._env.address, key)
    } else {
      return this._stateManager.getStorage(this._env.address, key)
    }
  }

  /**
   * Store 256-bit a value in memory to transient storage.
   * @param address Address to use
   * @param key Storage key
   * @param value Storage value
   */
  transientStorageStore(key: Uint8Array, value: Uint8Array): void {
    return this._evm.transientStorage.put(this._env.address, key, value)
  }

  /**
   * Loads a 256-bit value to memory from transient storage.
   * @param address Address to use
   * @param key Storage key
   */
  transientStorageLoad(key: Uint8Array): Uint8Array {
    return this._evm.transientStorage.get(this._env.address, key)
  }

  /**
   * Set the returning output data for the execution.
   * @param returnData - Output data to return
   */
  finish(returnData: Uint8Array): void {
    this._result.returnValue = returnData
    trap(ERROR.STOP)
  }

  /**
   * Set the returning output data for the execution. This will halt the
   * execution immediately and set the execution result to "reverted".
   * @param returnData - Output data to return
   */
  revert(returnData: Uint8Array): void {
    this._result.returnValue = returnData
    trap(ERROR.REVERT)
  }

  /**
   * Returns address of currently executing account.
   */
  getAddress(): Address {
    return this._env.address
  }

  /**
   * Returns balance of self.
   */
  getSelfBalance(): bigint {
    return this._env.contract.balance
  }

  /**
   * Returns the deposited value by the instruction/transaction
   * responsible for this execution.
   */
  getCallValue(): bigint {
    return this._env.callValue
  }

  /**
   * Returns input data in current environment. This pertains to the input
   * data passed with the message call instruction or transaction.
   */
  getCallData(): Uint8Array {
    return this._env.callData
  }

  /**
   * Returns size of input data in current environment. This pertains to the
   * input data passed with the message call instruction or transaction.
   */
  getCallDataSize(): bigint {
    return BigInt(this._env.callData.length)
  }

  /**
   * Returns caller address. This is the address of the account
   * that is directly responsible for this execution.
   */
  getCaller(): bigint {
    return bytesToBigInt(this._env.caller.bytes)
  }

  /**
   * Returns the size of code running in current environment.
   */
  getCodeSize(): bigint {
    return BigInt(this._env.code.length)
  }

  /**
   * Returns the code running in current environment.
   */
  getCode(): Uint8Array {
    return this._env.code
  }

  /**
   * Returns the current gasCounter.
   */
  getGasLeft(): bigint {
    return this._runState.gasLeft
  }

  /**
   * Returns size of current return data buffer. This contains the return data
   * from the last executed call, callCode, callDelegate, callStatic or create.
   * Note: create only fills the return data buffer in case of a failure.
   */
  getReturnDataSize(): bigint {
    return BigInt(this._runState.returnBytes.length)
  }

  /**
   * Returns the current return data buffer. This contains the return data
   * from last executed call, callCode, callDelegate, callStatic or create.
   * Note: create only fills the return data buffer in case of a failure.
   */
  getReturnData(): Uint8Array {
    return this._runState.returnBytes
  }

  /**
   * Returns true if the current call must be executed statically.
   */
  isStatic(): boolean {
    return this._env.isStatic
  }

  /**
   * Returns price of gas in current environment.
   */
  getTxGasPrice(): bigint {
    return this._env.gasPrice
  }

  /**
   * Returns the execution's origination address. This is the
   * sender of original transaction; it is never an account with
   * non-empty associated code.
   */
  getTxOrigin(): bigint {
    return bytesToBigInt(this._env.origin.bytes)
  }

  /**
   * Returns the block’s number.
   */
  getBlockNumber(): bigint {
    return this._env.block.header.number
  }

  /**
   * Returns the block's beneficiary address.
   */
  getBlockCoinbase(): bigint {
    let coinbase: Address
    if (this.common.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      coinbase = this._evm['_optsCached'].cliqueSigner!(this._env.block.header)
    } else {
      coinbase = this._env.block.header.coinbase
    }
    return bytesToBigInt(coinbase.toBytes())
  }

  /**
   * Returns the block's timestamp.
   */
  getBlockTimestamp(): bigint {
    return this._env.block.header.timestamp
  }

  /**
   * Returns the block's difficulty.
   */
  getBlockDifficulty(): bigint {
    return this._env.block.header.difficulty
  }

  /**
   * Returns the block's prevRandao field.
   */
  getBlockPrevRandao(): bigint {
    return bytesToBigInt(this._env.block.header.prevRandao)
  }

  /**
   * Returns the block's gas limit.
   */
  getBlockGasLimit(): bigint {
    return this._env.block.header.gasLimit
  }

  /**
   * Returns the Base Fee of the block as proposed in [EIP-3198](https://eips.ethereum.org/EIPS/eip-3198)
   */
  getBlockBaseFee(): bigint {
    const baseFee = this._env.block.header.baseFeePerGas
    if (baseFee === undefined) {
      // Sanity check
      throw EthereumJSErrorWithoutCode('Block has no Base Fee')
    }
    return baseFee
  }

  /**
   * Returns the Blob Base Fee of the block as proposed in [EIP-7516](https://eips.ethereum.org/EIPS/eip-7516)
   */
  getBlobBaseFee(): bigint {
    const blobBaseFee = this._env.block.header.getBlobGasPrice()
    if (blobBaseFee === undefined) {
      // Sanity check
      throw EthereumJSErrorWithoutCode('Block has no Blob Base Fee')
    }
    return blobBaseFee
  }

  /**
   * Returns the chain ID for current chain. Introduced for the
   * CHAINID opcode proposed in [EIP-1344](https://eips.ethereum.org/EIPS/eip-1344).
   */
  getChainId(): bigint {
    return this.common.chainId()
  }

  /**
   * Sends a message with arbitrary data to a given address path.
   */
  async call(gasLimit: bigint, address: Address, value: bigint, data: Uint8Array): Promise<bigint> {
    const msg = new Message({
      caller: this._env.address,
      gasLimit,
      to: address,
      value,
      data,
      isStatic: this._env.isStatic,
      depth: this._env.depth + 1,
      blobVersionedHashes: this._env.blobVersionedHashes,
      accessWitness: this._env.accessWitness,
    })

    return this._baseCall(msg)
  }

  /**
   * Message-call into this account with an alternative account's code.
   */
  async callCode(
    gasLimit: bigint,
    address: Address,
    value: bigint,
    data: Uint8Array,
  ): Promise<bigint> {
    const msg = new Message({
      caller: this._env.address,
      gasLimit,
      to: this._env.address,
      codeAddress: address,
      value,
      data,
      isStatic: this._env.isStatic,
      depth: this._env.depth + 1,
      blobVersionedHashes: this._env.blobVersionedHashes,
      accessWitness: this._env.accessWitness,
    })

    return this._baseCall(msg)
  }

  /**
   * Sends a message with arbitrary data to a given address path, but disallow
   * state modifications. This includes log, create, selfdestruct and call with
   * a non-zero value.
   */
  async callStatic(
    gasLimit: bigint,
    address: Address,
    value: bigint,
    data: Uint8Array,
  ): Promise<bigint> {
    const msg = new Message({
      caller: this._env.address,
      gasLimit,
      to: address,
      value,
      data,
      isStatic: true,
      depth: this._env.depth + 1,
      blobVersionedHashes: this._env.blobVersionedHashes,
      accessWitness: this._env.accessWitness,
    })

    return this._baseCall(msg)
  }

  /**
   * Message-call into this account with an alternative account’s code, but
   * persisting the current values for sender and value.
   */
  async callDelegate(
    gasLimit: bigint,
    address: Address,
    value: bigint,
    data: Uint8Array,
  ): Promise<bigint> {
    const msg = new Message({
      caller: this._env.caller,
      gasLimit,
      to: this._env.address,
      codeAddress: address,
      value,
      data,
      isStatic: this._env.isStatic,
      delegatecall: true,
      depth: this._env.depth + 1,
      blobVersionedHashes: this._env.blobVersionedHashes,
      accessWitness: this._env.accessWitness,
    })

    return this._baseCall(msg)
  }

  async _baseCall(msg: Message): Promise<bigint> {
    const selfdestruct = new Set(this._result.selfdestruct)
    msg.selfdestruct = selfdestruct
    msg.gasRefund = this._runState.gasRefund

    // empty the return data Uint8Array
    this._runState.returnBytes = new Uint8Array(0)
    let createdAddresses: Set<PrefixedHexString>
    if (this.common.isActivatedEIP(6780)) {
      createdAddresses = new Set(this._result.createdAddresses)
      msg.createdAddresses = createdAddresses
    }

    // empty the return data Uint8Array
    this._runState.returnBytes = new Uint8Array(0)

    // Check if account has enough ether and max depth not exceeded
    if (
      this._env.depth >= Number(this.common.param('stackLimit')) ||
      (msg.delegatecall !== true && this._env.contract.balance < msg.value)
    ) {
      return BIGINT_0
    }

    const results = await this._evm.runCall({ message: msg })

    if (results.execResult.logs) {
      this._result.logs = this._result.logs.concat(results.execResult.logs)
    }

    // this should always be safe
    this.useGas(results.execResult.executionGasUsed, 'CALL, STATICCALL, DELEGATECALL, CALLCODE')

    // Set return value
    if (
      results.execResult.returnValue !== undefined &&
      (!results.execResult.exceptionError ||
        results.execResult.exceptionError.error === ERROR.REVERT)
    ) {
      this._runState.returnBytes = results.execResult.returnValue
    }

    if (!results.execResult.exceptionError) {
      for (const addressToSelfdestructHex of selfdestruct) {
        this._result.selfdestruct.add(addressToSelfdestructHex)
      }
      if (this.common.isActivatedEIP(6780)) {
        // copy over the items to result via iterator
        for (const item of createdAddresses!) {
          this._result.createdAddresses!.add(item)
        }
      }
      // update stateRoot on current contract
      const account = await this._stateManager.getAccount(this._env.address)
      if (!account) {
        throw EthereumJSErrorWithoutCode('could not read contract account')
      }
      this._env.contract = account
      this._runState.gasRefund = results.execResult.gasRefund ?? BIGINT_0
    }

    return this._getReturnCode(results)
  }

  /**
   * Creates a new contract with a given value.
   */
  async create(
    gasLimit: bigint,
    value: bigint,
    codeToRun: Uint8Array,
    salt?: Uint8Array,
    eofCallData?: Uint8Array,
  ): Promise<bigint> {
    const selfdestruct = new Set(this._result.selfdestruct)
    const caller = this._env.address
    const depth = this._env.depth + 1

    // empty the return data buffer
    this._runState.returnBytes = new Uint8Array(0)

    // Check if account has enough ether and max depth not exceeded
    if (
      this._env.depth >= Number(this.common.param('stackLimit')) ||
      this._env.contract.balance < value
    ) {
      return BIGINT_0
    }

    // EIP-2681 check
    if (this._env.contract.nonce >= MAX_UINT64) {
      return BIGINT_0
    }

    this._env.contract.nonce += BIGINT_1
    await this.journal.putAccount(this._env.address, this._env.contract)

    if (this.common.isActivatedEIP(3860)) {
      if (
        codeToRun.length > Number(this.common.param('maxInitCodeSize')) &&
        this._evm.allowUnlimitedInitCodeSize === false
      ) {
        return BIGINT_0
      }
    }

    const message = new Message({
      caller,
      gasLimit,
      value,
      data: codeToRun,
      eofCallData,
      salt,
      depth,
      selfdestruct,
      gasRefund: this._runState.gasRefund,
      blobVersionedHashes: this._env.blobVersionedHashes,
      accessWitness: this._env.accessWitness,
    })

    let createdAddresses: Set<PrefixedHexString>
    if (this.common.isActivatedEIP(6780)) {
      createdAddresses = new Set(this._result.createdAddresses)
      message.createdAddresses = createdAddresses
    }

    const results = await this._evm.runCall({ message })

    if (results.execResult.logs) {
      this._result.logs = this._result.logs.concat(results.execResult.logs)
    }

    // this should always be safe
    this.useGas(results.execResult.executionGasUsed, 'CREATE')

    // Set return buffer in case revert happened
    if (
      results.execResult.exceptionError &&
      results.execResult.exceptionError.error === ERROR.REVERT
    ) {
      this._runState.returnBytes = results.execResult.returnValue
    }

    if (
      !results.execResult.exceptionError ||
      results.execResult.exceptionError.error === ERROR.CODESTORE_OUT_OF_GAS
    ) {
      for (const addressToSelfdestructHex of selfdestruct) {
        this._result.selfdestruct.add(addressToSelfdestructHex)
      }
      if (this.common.isActivatedEIP(6780)) {
        // copy over the items to result via iterator
        for (const item of createdAddresses!) {
          this._result.createdAddresses!.add(item)
        }
      }
      // update stateRoot on current contract
      const account = await this._stateManager.getAccount(this._env.address)
      if (!account) {
        throw EthereumJSErrorWithoutCode('could not read contract account')
      }
      this._env.contract = account
      this._runState.gasRefund = results.execResult.gasRefund ?? BIGINT_0
      if (results.createdAddress) {
        // push the created address to the stack
        return bytesToBigInt(results.createdAddress.bytes)
      }
    }

    return this._getReturnCode(results, true)
  }

  /**
   * Creates a new contract with a given value. Generates
   * a deterministic address via CREATE2 rules.
   */
  async create2(
    gasLimit: bigint,
    value: bigint,
    data: Uint8Array,
    salt: Uint8Array,
  ): Promise<bigint> {
    return this.create(gasLimit, value, data, salt)
  }

  /**
   * Creates a new contract with a given value. Generates
   * a deterministic address via EOFCREATE rules.
   */
  async eofcreate(
    gasLimit: bigint,
    value: bigint,
    containerData: Uint8Array,
    salt: Uint8Array,
    callData: Uint8Array,
  ): Promise<bigint> {
    return this.create(gasLimit, value, containerData, salt, callData)
  }

  /**
   * Mark account for later deletion and give the remaining balance to the
   * specified beneficiary address. This will cause a trap and the
   * execution will be aborted immediately.
   * @param toAddress - Beneficiary address
   */
  async selfDestruct(toAddress: Address): Promise<void> {
    return this._selfDestruct(toAddress)
  }

  async _selfDestruct(toAddress: Address): Promise<void> {
    // only add to refund if this is the first selfdestruct for the address
    if (!this._result.selfdestruct.has(bytesToHex(this._env.address.bytes))) {
      this.refundGas(this.common.param('selfdestructRefundGas'))
    }

    this._result.selfdestruct.add(bytesToHex(this._env.address.bytes))

    const toSelf = equalsBytes(toAddress.bytes, this._env.address.bytes)

    // Add to beneficiary balance
    if (!toSelf) {
      let toAccount = await this._stateManager.getAccount(toAddress)
      if (!toAccount) {
        toAccount = new Account()
      }
      toAccount.balance += this._env.contract.balance
      await this.journal.putAccount(toAddress, toAccount)
    }

    // Modify the account (set balance to 0) flag
    let doModify = !this.common.isActivatedEIP(6780) // Always do this if 6780 is not active

    if (!doModify) {
      // If 6780 is active, check if current address is being created. If so
      // old behavior of SELFDESTRUCT exists and balance should be set to 0 of this account
      // (i.e. burn the ETH in current account)
      doModify = this._env.createdAddresses!.has(this._env.address.toString())
      // If contract is not being created in this tx...
      if (!doModify) {
        // Check if ETH being sent to another account (thus set balance to 0)
        doModify = !toSelf
      }
    }

    // Set contract balance to 0
    if (doModify) {
      await this._stateManager.modifyAccountFields(this._env.address, {
        balance: BIGINT_0,
      })
    }

    trap(ERROR.STOP)
  }

  /**
   * Creates a new log in the current environment.
   */
  log(data: Uint8Array, numberOfTopics: number, topics: Uint8Array[]): void {
    if (numberOfTopics < 0 || numberOfTopics > 4) {
      trap(ERROR.OUT_OF_RANGE)
    }

    if (topics.length !== numberOfTopics) {
      trap(ERROR.INTERNAL_ERROR)
    }

    const log: Log = [this._env.address.bytes, topics, data]
    this._result.logs.push(log)
  }

  private _getReturnCode(results: EVMResult, isEOFCreate = false) {
    if (this._runState.env.eof === undefined || isEOFCreate) {
      if (results.execResult.exceptionError) {
        return BIGINT_0
      } else {
        return BIGINT_1
      }
    } else {
      // EOF mode, call was either EXTCALL / EXTDELEGATECALL / EXTSTATICCALL
      if (results.execResult.exceptionError !== undefined) {
        if (results.execResult.exceptionError.error === ERROR.REVERT) {
          // Revert
          return BIGINT_1
        } else {
          // Failure
          return BIGINT_2
        }
      }
      return BIGINT_0
    }
  }
}
