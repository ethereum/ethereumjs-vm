import { Hardfork } from '@ethereumjs/common'
import {
  Account,
  Address,
  AsyncEventEmitter,
  BIGINT_0,
  BIGINT_1,
  KECCAK256_NULL,
  KECCAK256_RLP,
  MAX_INTEGER,
  bigIntToBytes,
  bytesToUnprefixedHex,
  createZeroAddress,
  equalsBytes,
  generateAddress,
  generateAddress2,
  short,
} from '@ethereumjs/util'
import debugDefault from 'debug'

import { FORMAT } from './eof/constants.js'
import { isEOF } from './eof/util.js'
import { ERROR, EvmError } from './exceptions.js'
import { Interpreter } from './interpreter.js'
import { Journal } from './journal.js'
import { EVMPerformanceLogger } from './logger.js'
import { Message } from './message.js'
import { getOpcodesForHF } from './opcodes/index.js'
import { paramsEVM } from './params.js'
import { NobleBLS, getActivePrecompiles, getPrecompileName } from './precompiles/index.js'
import { TransientStorage } from './transientStorage.js'
import {
  type Block,
  type CustomOpcode,
  DELEGATION_7702_FLAG,
  type EVMBLSInterface,
  type EVMBN254Interface,
  type EVMEvents,
  type EVMInterface,
  type EVMMockBlockchainInterface,
  type EVMOpts,
  type EVMResult,
  type EVMRunCallOpts,
  type EVMRunCodeOpts,
  type ExecResult,
} from './types.js'

import type { InterpreterOpts } from './interpreter.js'
import type { Timer } from './logger.js'
import type { MessageWithTo } from './message.js'
import type { AsyncDynamicGasHandler, SyncDynamicGasHandler } from './opcodes/gas.js'
import type { OpHandler, OpcodeList, OpcodeMap } from './opcodes/index.js'
import type { CustomPrecompile, PrecompileFunc } from './precompiles/index.js'
import type { Common, StateManagerInterface } from '@ethereumjs/common'

const debug = debugDefault('evm:evm')
const debugGas = debugDefault('evm:gas')
const debugPrecompiles = debugDefault('evm:precompiles')

/**
 * EVM is responsible for executing an EVM message fully
 * (including any nested calls and creates), processing the results
 * and storing them to state (or discarding changes in case of exceptions).
 * @ignore
 */
export class EVM implements EVMInterface {
  protected static supportedHardforks = [
    Hardfork.Chainstart,
    Hardfork.Homestead,
    Hardfork.Dao,
    Hardfork.TangerineWhistle,
    Hardfork.SpuriousDragon,
    Hardfork.Byzantium,
    Hardfork.Constantinople,
    Hardfork.Petersburg,
    Hardfork.Istanbul,
    Hardfork.MuirGlacier,
    Hardfork.Berlin,
    Hardfork.London,
    Hardfork.ArrowGlacier,
    Hardfork.GrayGlacier,
    Hardfork.MergeForkIdTransition,
    Hardfork.Paris,
    Hardfork.Shanghai,
    Hardfork.Cancun,
    Hardfork.Prague,
    Hardfork.Osaka,
  ]
  protected _tx?: {
    gasPrice: bigint
    origin: Address
  }
  protected _block?: Block

  public readonly common: Common
  public readonly events: AsyncEventEmitter<EVMEvents>

  public stateManager: StateManagerInterface
  public blockchain: EVMMockBlockchainInterface
  public journal: Journal

  public readonly transientStorage: TransientStorage

  protected _opcodes!: OpcodeList

  public readonly allowUnlimitedContractSize: boolean
  public readonly allowUnlimitedInitCodeSize: boolean

  protected readonly _customOpcodes?: CustomOpcode[]
  protected readonly _customPrecompiles?: CustomPrecompile[]

  protected _handlers!: Map<number, OpHandler>

  protected _dynamicGasHandlers!: Map<number, AsyncDynamicGasHandler | SyncDynamicGasHandler>

  protected _opcodeMap!: OpcodeMap

  protected _precompiles!: Map<string, PrecompileFunc>

  protected readonly _optsCached: EVMOpts

  protected performanceLogger: EVMPerformanceLogger

  public get precompiles() {
    return this._precompiles
  }

  public get opcodes() {
    return this._opcodes
  }

  protected readonly _bls?: EVMBLSInterface

  /**
   * EVM is run in DEBUG mode (default: false)
   * Taken from DEBUG environment variable
   *
   * Safeguards on debug() calls are added for
   * performance reasons to avoid string literal evaluation
   * @hidden
   */
  readonly DEBUG: boolean = false

  protected readonly _emit: (topic: string, data: any) => Promise<void>

  private _bn254: EVMBN254Interface

  /**
   *
   * Creates new EVM object
   *
   * @deprecated The direct usage of this constructor is replaced since
   * non-finalized async initialization lead to side effects. Please
   * use the async {@link createEVM} constructor instead (same API).
   *
   * @param opts The EVM options
   * @param bn128 Initialized bn128 WASM object for precompile usage (internal)
   */
  constructor(opts: EVMOpts) {
    this.common = opts.common!
    this.blockchain = opts.blockchain!
    this.stateManager = opts.stateManager!

    if (this.common.isActivatedEIP(6800)) {
      const mandatory = ['checkChunkWitnessPresent']
      for (const m of mandatory) {
        if (!(m in this.stateManager)) {
          throw new Error(
            `State manager used must implement ${m} if Verkle (EIP-6800) is activated`,
          )
        }
      }
    }

    this.events = new AsyncEventEmitter()
    this._optsCached = opts

    // Supported EIPs
    const supportedEIPs = [
      663, 1153, 1559, 2537, 2565, 2718, 2929, 2930, 2935, 3198, 3529, 3540, 3541, 3607, 3651, 3670,
      3855, 3860, 4200, 4399, 4750, 4788, 4844, 4895, 5133, 5450, 5656, 6110, 6206, 6780, 6800,
      7002, 7069, 7251, 7480, 7516, 7620, 7685, 7692, 7698, 7702, 7709,
    ]

    for (const eip of this.common.eips()) {
      if (!supportedEIPs.includes(eip)) {
        throw new Error(`EIP-${eip} is not supported by the EVM`)
      }
    }

    if (!EVM.supportedHardforks.includes(this.common.hardfork() as Hardfork)) {
      throw new Error(
        `Hardfork ${this.common.hardfork()} not set as supported in supportedHardforks`,
      )
    }

    this.common.updateParams(opts.params ?? paramsEVM)

    this.allowUnlimitedContractSize = opts.allowUnlimitedContractSize ?? false
    this.allowUnlimitedInitCodeSize = opts.allowUnlimitedInitCodeSize ?? false
    this._customOpcodes = opts.customOpcodes
    this._customPrecompiles = opts.customPrecompiles

    this.journal = new Journal(this.stateManager, this.common)
    this.transientStorage = new TransientStorage()

    this.common.events.on('hardforkChanged', () => {
      this.getActiveOpcodes()
      this._precompiles = getActivePrecompiles(this.common, this._customPrecompiles)
    })

    // Initialize the opcode data
    this.getActiveOpcodes()
    this._precompiles = getActivePrecompiles(this.common, this._customPrecompiles)

    // Precompile crypto libraries
    if (this.common.isActivatedEIP(2537)) {
      this._bls = opts.bls ?? new NobleBLS()
      this._bls.init?.()
    }
    this._bn254 = opts.bn254!

    this._emit = async (topic: string, data: any): Promise<void> => {
      return new Promise((resolve) => this.events.emit(topic as keyof EVMEvents, data, resolve))
    }

    this.performanceLogger = new EVMPerformanceLogger()

    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    // Additional window check is to prevent vite browser bundling (and potentially other) to break
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
  }

  /**
   * Returns a list with the currently activated opcodes
   * available for EVM execution
   */
  getActiveOpcodes(): OpcodeList {
    const data = getOpcodesForHF(this.common, this._customOpcodes)
    this._opcodes = data.opcodes
    this._dynamicGasHandlers = data.dynamicGasHandlers
    this._handlers = data.handlers
    this._opcodeMap = data.opcodeMap
    return data.opcodes
  }

  protected async _executeCall(message: MessageWithTo): Promise<EVMResult> {
    let gasLimit = message.gasLimit
    const fromAddress = message.caller

    if (this.common.isActivatedEIP(6800)) {
      const sendsValue = message.value !== BIGINT_0
      if (message.depth === 0) {
        const originAccessGas = message.accessWitness!.touchTxOriginAndComputeGas(fromAddress)
        debugGas(`originAccessGas=${originAccessGas} waived off for origin at depth=0`)

        const destAccessGas = message.accessWitness!.touchTxTargetAndComputeGas(message.to, {
          sendsValue,
        })
        debugGas(`destAccessGas=${destAccessGas} waived off for target at depth=0`)
      }

      let callAccessGas = message.accessWitness!.touchAndChargeMessageCall(message.to)
      if (sendsValue) {
        callAccessGas += message.accessWitness!.touchAndChargeValueTransfer(fromAddress, message.to)
      }
      gasLimit -= callAccessGas
      if (gasLimit < BIGINT_0) {
        if (this.DEBUG) {
          debugGas(`callAccessGas charged(${callAccessGas}) caused OOG (-> ${gasLimit})`)
        }
        return { execResult: OOGResult(message.gasLimit) }
      } else {
        if (this.DEBUG) {
          debugGas(`callAccessGas used (${callAccessGas} gas (-> ${gasLimit}))`)
        }
      }
    }

    let account = await this.stateManager.getAccount(fromAddress)
    if (!account) {
      account = new Account()
    }
    let errorMessage
    // Reduce tx value from sender
    if (!message.delegatecall) {
      try {
        await this._reduceSenderBalance(account, message)
      } catch (e) {
        errorMessage = e
      }
    }

    // Load `to` account
    let toAccount = await this.stateManager.getAccount(message.to)
    if (!toAccount) {
      if (this.common.isActivatedEIP(6800)) {
        const absenceProofAccessGas = message.accessWitness!.touchAndChargeProofOfAbsence(
          message.to,
        )
        gasLimit -= absenceProofAccessGas
        if (gasLimit < BIGINT_0) {
          if (this.DEBUG) {
            debugGas(
              `Proof of absence access charged(${absenceProofAccessGas}) caused OOG (-> ${gasLimit})`,
            )
          }
          return { execResult: OOGResult(message.gasLimit) }
        } else {
          if (this.DEBUG) {
            debugGas(`Proof of absence access used (${absenceProofAccessGas} gas (-> ${gasLimit}))`)
          }
        }
      }
      toAccount = new Account()
    }
    // Add tx value to the `to` account
    if (!message.delegatecall) {
      try {
        await this._addToBalance(toAccount, message)
      } catch (e) {
        errorMessage = e
      }
    }

    // Load code
    await this._loadCode(message)
    let exit = false
    if (!message.code || (typeof message.code !== 'function' && message.code.length === 0)) {
      exit = true
      if (this.DEBUG) {
        debug(`Exit early on no code (CALL)`)
      }
    }
    if (errorMessage !== undefined) {
      exit = true
      if (this.DEBUG) {
        debug(`Exit early on value transfer overflowed (CALL)`)
      }
    }
    if (exit) {
      return {
        execResult: {
          gasRefund: message.gasRefund,
          executionGasUsed: message.gasLimit - gasLimit,
          exceptionError: errorMessage, // Only defined if addToBalance failed
          returnValue: new Uint8Array(0),
        },
      }
    }

    let result: ExecResult
    if (message.isCompiled) {
      let timer: Timer
      let callTimer: Timer | undefined
      let target: string
      if (this._optsCached.profiler?.enabled === true) {
        target = bytesToUnprefixedHex(message.codeAddress.bytes)
        // TODO: map target precompile not to address, but to a name
        target = getPrecompileName(target) ?? target.slice(20)
        if (this.performanceLogger.hasTimer()) {
          callTimer = this.performanceLogger.pauseTimer()
        }
        timer = this.performanceLogger.startTimer(target)
      }
      result = await this.runPrecompile(message.code as PrecompileFunc, message.data, gasLimit)

      if (this._optsCached.profiler?.enabled === true) {
        this.performanceLogger.stopTimer(timer!, Number(result.executionGasUsed), 'precompiles')
        if (callTimer !== undefined) {
          this.performanceLogger.unpauseTimer(callTimer)
        }
      }
      result.gasRefund = message.gasRefund
    } else {
      if (this.DEBUG) {
        debug(`Start bytecode processing...`)
      }
      result = await this.runInterpreter({ ...message, gasLimit } as Message)
    }

    if (message.depth === 0) {
      this.postMessageCleanup()
    }

    result.executionGasUsed += message.gasLimit - gasLimit

    return {
      execResult: result,
    }
  }

  protected async _executeCreate(message: Message): Promise<EVMResult> {
    let gasLimit = message.gasLimit
    const fromAddress = message.caller

    if (this.common.isActivatedEIP(6800)) {
      if (message.depth === 0) {
        const originAccessGas = message.accessWitness!.touchTxOriginAndComputeGas(fromAddress)
        debugGas(`originAccessGas=${originAccessGas} waived off for origin at depth=0`)
      }
    }

    let account = await this.stateManager.getAccount(message.caller)
    if (!account) {
      account = new Account()
    }
    // Reduce tx value from sender
    await this._reduceSenderBalance(account, message)

    if (this.common.isActivatedEIP(3860)) {
      if (
        message.data.length > Number(this.common.param('maxInitCodeSize')) &&
        !this.allowUnlimitedInitCodeSize
      ) {
        return {
          createdAddress: message.to,
          execResult: {
            returnValue: new Uint8Array(0),
            exceptionError: new EvmError(ERROR.INITCODE_SIZE_VIOLATION),
            executionGasUsed: message.gasLimit,
          },
        }
      }
    }

    // TODO at some point, figure out why we swapped out data to code in the first place
    message.code = message.data
    message.data = message.eofCallData ?? new Uint8Array()
    message.to = await this._generateAddress(message)

    if (this.common.isActivatedEIP(6780)) {
      message.createdAddresses!.add(message.to.toString())
    }

    if (this.DEBUG) {
      debug(`Generated CREATE contract address ${message.to}`)
    }
    let toAccount = await this.stateManager.getAccount(message.to)
    if (!toAccount) {
      toAccount = new Account()
    }

    if (this.common.isActivatedEIP(6800)) {
      const contractCreateAccessGas = message.accessWitness!.touchAndChargeContractCreateInit(
        message.to,
      )
      gasLimit -= contractCreateAccessGas
      if (gasLimit < BIGINT_0) {
        if (this.DEBUG) {
          debugGas(
            `ContractCreateInit charge(${contractCreateAccessGas}) caused OOG (-> ${gasLimit})`,
          )
        }
        return { execResult: OOGResult(message.gasLimit) }
      } else {
        if (this.DEBUG) {
          debugGas(`ContractCreateInit charged (${contractCreateAccessGas} gas (-> ${gasLimit}))`)
        }
      }
    }

    // Check for collision
    if (
      (toAccount.nonce && toAccount.nonce > BIGINT_0) ||
      !(equalsBytes(toAccount.codeHash, KECCAK256_NULL) === true) ||
      // See EIP 7610 and the discussion `https://ethereum-magicians.org/t/eip-7610-revert-creation-in-case-of-non-empty-storage`
      !(equalsBytes(toAccount.storageRoot, KECCAK256_RLP) === true)
    ) {
      if (this.DEBUG) {
        debug(`Returning on address collision`)
      }
      return {
        createdAddress: message.to,
        execResult: {
          returnValue: new Uint8Array(0),
          exceptionError: new EvmError(ERROR.CREATE_COLLISION),
          executionGasUsed: message.gasLimit,
        },
      }
    }

    await this.journal.putAccount(message.to, toAccount)
    await this.stateManager.clearStorage(message.to)

    const newContractEvent = {
      address: message.to,
      code: message.code,
    }

    await this._emit('newContract', newContractEvent)

    toAccount = await this.stateManager.getAccount(message.to)
    if (!toAccount) {
      toAccount = new Account()
    }
    // EIP-161 on account creation and CREATE execution
    if (this.common.gteHardfork(Hardfork.SpuriousDragon)) {
      toAccount.nonce += BIGINT_1
    }

    // Add tx value to the `to` account
    let errorMessage
    try {
      await this._addToBalance(toAccount, message as MessageWithTo)
    } catch (e) {
      errorMessage = e
    }

    let exit = false
    if (
      message.code === undefined ||
      (typeof message.code !== 'function' && message.code.length === 0)
    ) {
      exit = true
      if (this.DEBUG) {
        debug(`Exit early on no code (CREATE)`)
      }
    }
    if (errorMessage !== undefined) {
      exit = true
      if (this.DEBUG) {
        debug(`Exit early on value transfer overflowed (CREATE)`)
      }
    }

    if (exit) {
      if (this.common.isActivatedEIP(6800)) {
        const createCompleteAccessGas =
          message.accessWitness!.touchAndChargeContractCreateCompleted(message.to)
        gasLimit -= createCompleteAccessGas
        if (gasLimit < BIGINT_0) {
          if (this.DEBUG) {
            debug(
              `ContractCreateComplete access gas (${createCompleteAccessGas}) caused OOG (-> ${gasLimit})`,
            )
          }
          return { execResult: OOGResult(message.gasLimit) }
        } else {
          debug(
            `ContractCreateComplete access used (${createCompleteAccessGas}) gas (-> ${gasLimit})`,
          )
        }
      }

      return {
        createdAddress: message.to,
        execResult: {
          executionGasUsed: message.gasLimit - gasLimit,
          gasRefund: message.gasRefund,
          exceptionError: errorMessage, // only defined if addToBalance failed
          returnValue: new Uint8Array(0),
        },
      }
    }

    if (this.DEBUG) {
      debug(`Start bytecode processing...`)
    }

    // run the message with the updated gas limit and add accessed gas used to the result
    let result = await this.runInterpreter({ ...message, gasLimit, isCreate: true } as Message)
    result.executionGasUsed += message.gasLimit - gasLimit

    // fee for size of the return value
    let totalGas = result.executionGasUsed
    let returnFee = BIGINT_0
    if (!result.exceptionError && !this.common.isActivatedEIP(6800)) {
      returnFee = BigInt(result.returnValue.length) * BigInt(this.common.param('createDataGas'))
      totalGas = totalGas + returnFee
      if (this.DEBUG) {
        debugGas(`Add return value size fee (${returnFee} to gas used (-> ${totalGas}))`)
      }
    }

    // Check for SpuriousDragon EIP-170 code size limit
    let allowedCodeSize = true
    if (
      !result.exceptionError &&
      this.common.gteHardfork(Hardfork.SpuriousDragon) &&
      result.returnValue.length > Number(this.common.param('maxCodeSize'))
    ) {
      allowedCodeSize = false
    }

    // If enough gas and allowed code size
    let CodestoreOOG = false
    if (totalGas <= message.gasLimit && (this.allowUnlimitedContractSize || allowedCodeSize)) {
      if (this.common.isActivatedEIP(3541) && result.returnValue[0] === FORMAT) {
        if (!this.common.isActivatedEIP(3540)) {
          result = { ...result, ...INVALID_BYTECODE_RESULT(message.gasLimit) }
        } else if (
          // TODO check if this is correct
          // Also likely cleanup this eofCallData stuff
          /*(message.depth > 0 && message.eofCallData === undefined) ||
          (message.depth === 0 && !isEOF(message.code))*/
          !isEOF(message.code)
        ) {
          // TODO the message.eof was flagged for this to work for this first
          // Running into Legacy mode: unable to deploy EOF contract
          result = { ...result, ...INVALID_BYTECODE_RESULT(message.gasLimit) }
        } else {
          // 3541 is active and current runtime mode is EOF
          result.executionGasUsed = totalGas
        }
      } else {
        result.executionGasUsed = totalGas
      }
    } else {
      if (this.common.gteHardfork(Hardfork.Homestead)) {
        if (!allowedCodeSize) {
          if (this.DEBUG) {
            debug(`Code size exceeds maximum code size (>= SpuriousDragon)`)
          }
          result = { ...result, ...CodesizeExceedsMaximumError(message.gasLimit) }
        } else {
          if (this.DEBUG) {
            debug(`Contract creation: out of gas`)
          }
          result = { ...result, ...OOGResult(message.gasLimit) }
        }
      } else {
        // we are in Frontier
        if (totalGas - returnFee <= message.gasLimit) {
          // we cannot pay the code deposit fee (but the deposit code actually did run)
          if (this.DEBUG) {
            debug(`Not enough gas to pay the code deposit fee (Frontier)`)
          }
          result = { ...result, ...COOGResult(totalGas - returnFee) }
          CodestoreOOG = true
        } else {
          if (this.DEBUG) {
            debug(`Contract creation: out of gas`)
          }
          result = { ...result, ...OOGResult(message.gasLimit) }
        }
      }
    }

    // get the fresh gas limit for the rest of the ops
    gasLimit = message.gasLimit - result.executionGasUsed
    if (!result.exceptionError && this.common.isActivatedEIP(6800)) {
      const createCompleteAccessGas = message.accessWitness!.touchAndChargeContractCreateCompleted(
        message.to,
      )
      gasLimit -= createCompleteAccessGas
      if (gasLimit < BIGINT_0) {
        if (this.DEBUG) {
          debug(
            `ContractCreateComplete access gas (${createCompleteAccessGas}) caused OOG (-> ${gasLimit})`,
          )
        }
        result = { ...result, ...OOGResult(message.gasLimit) }
      } else {
        debug(
          `ContractCreateComplete access used (${createCompleteAccessGas}) gas (-> ${gasLimit})`,
        )
        result.executionGasUsed += createCompleteAccessGas
      }
    }

    // Save code if a new contract was created
    if (
      !result.exceptionError &&
      result.returnValue !== undefined &&
      result.returnValue.length !== 0
    ) {
      // Add access charges for writing this code to the state
      if (this.common.isActivatedEIP(6800)) {
        const byteCodeWriteAccessfee =
          message.accessWitness!.touchCodeChunksRangeOnWriteAndChargeGas(
            message.to,
            0,
            result.returnValue.length - 1,
          )
        gasLimit -= byteCodeWriteAccessfee
        if (gasLimit < BIGINT_0) {
          if (this.DEBUG) {
            debug(
              `byteCodeWrite access gas (${byteCodeWriteAccessfee}) caused OOG (-> ${gasLimit})`,
            )
          }
          result = { ...result, ...OOGResult(message.gasLimit) }
        } else {
          debug(`byteCodeWrite access used (${byteCodeWriteAccessfee}) gas (-> ${gasLimit})`)
          result.executionGasUsed += byteCodeWriteAccessfee
        }
      }

      await this.stateManager.putCode(message.to, result.returnValue)
      if (this.DEBUG) {
        debug(`Code saved on new contract creation`)
      }
    } else if (CodestoreOOG) {
      // This only happens at Frontier. But, let's do a sanity check;
      if (!this.common.gteHardfork(Hardfork.Homestead)) {
        // Pre-Homestead behavior; put an empty contract.
        // This contract would be considered "DEAD" in later hard forks.
        // It is thus an unnecessary default item, which we have to save to disk
        // It does change the state root, but it only wastes storage.
        const account = await this.stateManager.getAccount(message.to)
        await this.journal.putAccount(message.to, account ?? new Account())
      }
    }

    if (message.depth === 0) {
      this.postMessageCleanup()
    }

    return {
      createdAddress: message.to,
      execResult: result,
    }
  }

  /**
   * Starts the actual bytecode processing for a CALL or CREATE
   */
  protected async runInterpreter(
    message: Message,
    opts: InterpreterOpts = {},
  ): Promise<ExecResult> {
    let contract = await this.stateManager.getAccount(message.to ?? createZeroAddress())
    if (!contract) {
      contract = new Account()
    }

    const env = {
      address: message.to ?? createZeroAddress(),
      caller: message.caller ?? createZeroAddress(),
      callData: message.data ?? Uint8Array.from([0]),
      callValue: message.value ?? BIGINT_0,
      code: message.code as Uint8Array,
      isStatic: message.isStatic ?? false,
      isCreate: message.isCreate ?? false,
      depth: message.depth ?? 0,
      gasPrice: this._tx!.gasPrice,
      origin: this._tx!.origin ?? message.caller ?? createZeroAddress(),
      block: this._block ?? defaultBlock(),
      contract,
      codeAddress: message.codeAddress,
      gasRefund: message.gasRefund,
      chargeCodeAccesses: message.chargeCodeAccesses,
      blobVersionedHashes: message.blobVersionedHashes ?? [],
      accessWitness: message.accessWitness,
      createdAddresses: message.createdAddresses,
    }

    const interpreter = new Interpreter(
      this,
      this.stateManager,
      this.blockchain,
      env,
      message.gasLimit,
      this.journal,
      this.performanceLogger,
      this._optsCached.profiler,
    )
    if (message.selfdestruct) {
      interpreter._result.selfdestruct = message.selfdestruct
    }
    if (message.createdAddresses) {
      interpreter._result.createdAddresses = message.createdAddresses
    }

    const interpreterRes = await interpreter.run(message.code as Uint8Array, opts)

    let result = interpreter._result
    let gasUsed = message.gasLimit - interpreterRes.runState!.gasLeft
    if (interpreterRes.exceptionError) {
      if (
        interpreterRes.exceptionError.error !== ERROR.REVERT &&
        interpreterRes.exceptionError.error !== ERROR.INVALID_EOF_FORMAT
      ) {
        gasUsed = message.gasLimit
      }

      // Clear the result on error
      result = {
        ...result,
        logs: [],
        selfdestruct: new Set(),
        createdAddresses: new Set(),
      }
    }

    return {
      ...result,
      runState: {
        ...interpreterRes.runState!,
        ...result,
        ...interpreter._env,
      },
      exceptionError: interpreterRes.exceptionError,
      gas: interpreterRes.runState?.gasLeft,
      executionGasUsed: gasUsed,
      gasRefund: interpreterRes.runState!.gasRefund,
      returnValue: result.returnValue ? result.returnValue : new Uint8Array(0),
    }
  }

  /**
   * Executes an EVM message, determining whether it's a call or create
   * based on the `to` address. It checkpoints the state and reverts changes
   * if an exception happens during the message execution.
   */
  async runCall(opts: EVMRunCallOpts): Promise<EVMResult> {
    let timer: Timer | undefined
    if (
      (opts.depth === 0 || opts.message === undefined) &&
      this._optsCached.profiler?.enabled === true
    ) {
      timer = this.performanceLogger.startTimer('Initialization')
    }
    let message = opts.message
    let callerAccount
    if (!message) {
      this._block = opts.block ?? defaultBlock()
      this._tx = {
        gasPrice: opts.gasPrice ?? BIGINT_0,
        origin: opts.origin ?? opts.caller ?? createZeroAddress(),
      }
      const caller = opts.caller ?? createZeroAddress()

      const value = opts.value ?? BIGINT_0
      if (opts.skipBalance === true) {
        callerAccount = await this.stateManager.getAccount(caller)
        if (!callerAccount) {
          callerAccount = new Account()
        }
        if (callerAccount.balance < value) {
          // if skipBalance and balance less than value, set caller balance to `value` to ensure sufficient funds
          callerAccount.balance = value
          await this.journal.putAccount(caller, callerAccount)
        }
      }

      message = new Message({
        caller,
        gasLimit: opts.gasLimit ?? BigInt(0xffffff),
        to: opts.to,
        value,
        data: opts.data,
        code: opts.code,
        depth: opts.depth,
        isCompiled: opts.isCompiled,
        isStatic: opts.isStatic,
        salt: opts.salt,
        selfdestruct: opts.selfdestruct ?? new Set(),
        createdAddresses: opts.createdAddresses ?? new Set(),
        delegatecall: opts.delegatecall,
        blobVersionedHashes: opts.blobVersionedHashes,
        accessWitness: opts.accessWitness,
      })
    }

    if (message.depth === 0) {
      if (!callerAccount) {
        callerAccount = await this.stateManager.getAccount(message.caller)
      }
      if (!callerAccount) {
        callerAccount = new Account()
      }
      callerAccount.nonce++
      await this.journal.putAccount(message.caller, callerAccount)
      if (this.DEBUG) {
        debug(`Update fromAccount (caller) nonce (-> ${callerAccount.nonce}))`)
      }
    }

    await this._emit('beforeMessage', message)

    if (!message.to && this.common.isActivatedEIP(2929)) {
      message.code = message.data
      this.journal.addWarmedAddress((await this._generateAddress(message)).bytes)
    }

    await this.journal.checkpoint()
    if (this.common.isActivatedEIP(1153)) this.transientStorage.checkpoint()
    if (this.DEBUG) {
      debug('-'.repeat(100))
      debug(`message checkpoint`)
    }

    let result
    if (this.DEBUG) {
      const { caller, gasLimit, to, value, delegatecall } = message
      debug(
        `New message caller=${caller} gasLimit=${gasLimit} to=${
          to?.toString() ?? 'none'
        } value=${value} delegatecall=${delegatecall ? 'yes' : 'no'}`,
      )
    }
    if (message.to) {
      if (this.DEBUG) {
        debug(`Message CALL execution (to: ${message.to})`)
      }
      result = await this._executeCall(message as MessageWithTo)
    } else {
      if (this.DEBUG) {
        debug(`Message CREATE execution (to undefined)`)
      }
      result = await this._executeCreate(message)
    }
    if (this.DEBUG) {
      const { executionGasUsed, exceptionError, returnValue } = result.execResult
      debug(
        `Received message execResult: [ gasUsed=${executionGasUsed} exceptionError=${
          exceptionError ? `'${exceptionError.error}'` : 'none'
        } returnValue=${short(returnValue)} gasRefund=${result.execResult.gasRefund ?? 0} ]`,
      )
    }
    const err = result.execResult.exceptionError
    // This clause captures any error which happened during execution
    // If that is the case, then all refunds are forfeited
    // There is one exception: if the CODESTORE_OUT_OF_GAS error is thrown
    // (this only happens the Frontier/Chainstart fork)
    // then the error is dismissed
    if (err && err.error !== ERROR.CODESTORE_OUT_OF_GAS) {
      result.execResult.selfdestruct = new Set()
      result.execResult.createdAddresses = new Set()
      result.execResult.gasRefund = BIGINT_0
    }
    if (
      err &&
      !(this.common.hardfork() === Hardfork.Chainstart && err.error === ERROR.CODESTORE_OUT_OF_GAS)
    ) {
      result.execResult.logs = []
      await this.journal.revert()
      if (this.common.isActivatedEIP(1153)) this.transientStorage.revert()
      if (this.DEBUG) {
        debug(`message checkpoint reverted`)
      }
    } else {
      await this.journal.commit()
      if (this.common.isActivatedEIP(1153)) this.transientStorage.commit()
      if (this.DEBUG) {
        debug(`message checkpoint committed`)
      }
    }
    await this._emit('afterMessage', result)

    if (message.depth === 0 && this._optsCached.profiler?.enabled === true) {
      this.performanceLogger.stopTimer(timer!, 0)
    }

    return result
  }

  /**
   * Bound to the global VM and therefore
   * shouldn't be used directly from the evm class
   */
  async runCode(opts: EVMRunCodeOpts): Promise<ExecResult> {
    this._block = opts.block ?? defaultBlock()

    this._tx = {
      gasPrice: opts.gasPrice ?? BIGINT_0,
      origin: opts.origin ?? opts.caller ?? createZeroAddress(),
    }

    const message = new Message({
      code: opts.code,
      data: opts.data,
      gasLimit: opts.gasLimit ?? BigInt(0xffffff),
      to: opts.to ?? createZeroAddress(),
      caller: opts.caller,
      value: opts.value,
      depth: opts.depth,
      selfdestruct: opts.selfdestruct ?? new Set(),
      isStatic: opts.isStatic,
      blobVersionedHashes: opts.blobVersionedHashes,
    })

    return this.runInterpreter(message, { pc: opts.pc })
  }

  /**
   * Returns code for precompile at the given address, or undefined
   * if no such precompile exists.
   */
  getPrecompile(address: Address): PrecompileFunc | undefined {
    return this.precompiles.get(bytesToUnprefixedHex(address.bytes))
  }

  /**
   * Executes a precompiled contract with given data and gas limit.
   */
  protected runPrecompile(
    code: PrecompileFunc,
    data: Uint8Array,
    gasLimit: bigint,
  ): Promise<ExecResult> | ExecResult {
    if (typeof code !== 'function') {
      throw new Error('Invalid precompile')
    }

    const opts = {
      data,
      gasLimit,
      common: this.common,
      _EVM: this,
      _debug: this.DEBUG ? debugPrecompiles : undefined,
      stateManager: this.stateManager,
    }

    return code(opts)
  }

  protected async _loadCode(message: Message): Promise<void> {
    if (!message.code) {
      const precompile = this.getPrecompile(message.codeAddress)
      if (precompile) {
        message.code = precompile
        message.isCompiled = true
      } else {
        message.code = await this.stateManager.getCode(message.codeAddress)

        // EIP-7702 delegation check
        if (
          this.common.isActivatedEIP(7702) &&
          equalsBytes(message.code.slice(0, 3), DELEGATION_7702_FLAG)
        ) {
          const address = new Address(message.code.slice(3, 24))
          message.code = await this.stateManager.getCode(address)
          if (message.depth === 0) {
            this.journal.addAlwaysWarmAddress(address.toString())
          }
        }

        message.isCompiled = false
        message.chargeCodeAccesses = true
      }
    }
  }

  protected async _generateAddress(message: Message): Promise<Address> {
    let addr
    if (message.salt) {
      addr = generateAddress2(message.caller.bytes, message.salt, message.code as Uint8Array)
    } else {
      let acc = await this.stateManager.getAccount(message.caller)
      if (!acc) {
        acc = new Account()
      }
      const newNonce = acc.nonce - BIGINT_1
      addr = generateAddress(message.caller.bytes, bigIntToBytes(newNonce))
    }
    return new Address(addr)
  }

  protected async _reduceSenderBalance(account: Account, message: Message): Promise<void> {
    account.balance -= message.value
    if (account.balance < BIGINT_0) {
      throw new EvmError(ERROR.INSUFFICIENT_BALANCE)
    }
    const result = this.journal.putAccount(message.caller, account)
    if (this.DEBUG) {
      debug(`Reduced sender (${message.caller}) balance (-> ${account.balance})`)
    }
    return result
  }

  protected async _addToBalance(toAccount: Account, message: MessageWithTo): Promise<void> {
    const newBalance = toAccount.balance + message.value
    if (newBalance > MAX_INTEGER) {
      throw new EvmError(ERROR.VALUE_OVERFLOW)
    }
    toAccount.balance = newBalance
    // putAccount as the nonce may have changed for contract creation
    const result = this.journal.putAccount(message.to, toAccount)
    if (this.DEBUG) {
      debug(`Added toAccount (${message.to}) balance (-> ${toAccount.balance})`)
    }
    return result
  }

  /**
   * Once the interpreter has finished depth 0, a post-message cleanup should be done
   */
  private postMessageCleanup() {
    if (this.common.isActivatedEIP(1153)) this.transientStorage.clear()
  }

  /**
   * This method copies the EVM, current HF and EIP settings
   * and returns a new EVM instance.
   *
   * Note: this is only a shallow copy and both EVM instances
   * will point to the same underlying state DB.
   *
   * @returns EVM
   */
  public shallowCopy(): EVM {
    const common = this.common.copy()
    common.setHardfork(this.common.hardfork())

    const opts = {
      ...this._optsCached,
      common,
      stateManager: this.stateManager.shallowCopy(),
    }
    ;(opts.stateManager as any).common = common
    return new EVM(opts)
  }

  public getPerformanceLogs() {
    return this.performanceLogger.getLogs()
  }

  public clearPerformanceLogs() {
    this.performanceLogger.clear()
  }
}

export function OOGResult(gasLimit: bigint): ExecResult {
  return {
    returnValue: new Uint8Array(0),
    executionGasUsed: gasLimit,
    exceptionError: new EvmError(ERROR.OUT_OF_GAS),
  }
}
// CodeDeposit OOG Result
export function COOGResult(gasUsedCreateCode: bigint): ExecResult {
  return {
    returnValue: new Uint8Array(0),
    executionGasUsed: gasUsedCreateCode,
    exceptionError: new EvmError(ERROR.CODESTORE_OUT_OF_GAS),
  }
}

export function INVALID_BYTECODE_RESULT(gasLimit: bigint): ExecResult {
  return {
    returnValue: new Uint8Array(0),
    executionGasUsed: gasLimit,
    exceptionError: new EvmError(ERROR.INVALID_BYTECODE_RESULT),
  }
}

export function INVALID_EOF_RESULT(gasLimit: bigint): ExecResult {
  return {
    returnValue: new Uint8Array(0),
    executionGasUsed: gasLimit,
    exceptionError: new EvmError(ERROR.INVALID_EOF_FORMAT),
  }
}

export function CodesizeExceedsMaximumError(gasUsed: bigint): ExecResult {
  return {
    returnValue: new Uint8Array(0),
    executionGasUsed: gasUsed,
    exceptionError: new EvmError(ERROR.CODESIZE_EXCEEDS_MAXIMUM),
  }
}

export function EvmErrorResult(error: EvmError, gasUsed: bigint): ExecResult {
  return {
    returnValue: new Uint8Array(0),
    executionGasUsed: gasUsed,
    exceptionError: error,
  }
}

export function defaultBlock(): Block {
  return {
    header: {
      number: BIGINT_0,
      coinbase: createZeroAddress(),
      timestamp: BIGINT_0,
      difficulty: BIGINT_0,
      prevRandao: new Uint8Array(32),
      gasLimit: BIGINT_0,
      baseFeePerGas: undefined,
      getBlobGasPrice: () => undefined,
    },
  }
}
