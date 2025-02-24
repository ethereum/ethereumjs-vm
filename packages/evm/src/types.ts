import type { EOFContainer } from './eof/container.js'
import type { EVMError } from './errors.js'
import type { InterpreterStep, RunState } from './interpreter.js'
import type { Message } from './message.js'
import type { AsyncDynamicGasHandler, SyncDynamicGasHandler } from './opcodes/gas.js'
import type { OpHandler } from './opcodes/index.js'
import type { CustomPrecompile } from './precompiles/index.js'
import type { PrecompileFunc } from './precompiles/types.js'
import type {
  Common,
  ParamsDict,
  StateManagerInterface,
  VerkleAccessWitnessInterface,
} from '@ethereumjs/common'
import type { Account, Address, PrefixedHexString } from '@ethereumjs/util'
import type { EventEmitter } from 'eventemitter3'

export type DeleteOpcode = {
  opcode: number
}

export type AddOpcode = {
  opcode: number
  opcodeName: string
  baseFee: number
  gasFunction?: AsyncDynamicGasHandler | SyncDynamicGasHandler
  logicFunction: OpHandler
}

export type CustomOpcode = AddOpcode | DeleteOpcode

/**
 * Base options for the `EVM.runCode()` / `EVM.runCall()` method.
 */
interface EVMRunOpts {
  /**
   * The `block` the `tx` belongs to. If omitted a default blank block will be used.
   */
  block?: Block
  /**
   * The gas price for the call. Defaults to `0`
   */
  gasPrice?: bigint
  /**
   * The address where the call originated from. Defaults to the zero address.
   */
  origin?: Address
  /**
   * The address that ran this code (`msg.sender`). Defaults to the zero address.
   */
  caller?: Address
  /**
   * The EVM code to run.
   */
  code?: Uint8Array
  /**
   * The input data.
   */
  data?: Uint8Array
  /**
   * The gas limit for the call. Defaults to `16777215` (`0xffffff`)
   */
  gasLimit?: bigint
  /**
   * The value in ether that is being sent to `opts.address`. Defaults to `0`
   */
  value?: bigint
  /**
   * The call depth. Defaults to `0`
   */
  depth?: number
  /**
   * If the call should be executed statically. Defaults to false.
   */
  isStatic?: boolean
  /**
   * Addresses to selfdestruct. Defaults to the empty set.
   */
  selfdestruct?: Set<PrefixedHexString>
  /**
   * The address of the account that is executing this code (`address(this)`). Defaults to the zero address.
   */
  to?: Address
  /**
   * Versioned hashes for each blob in a blob transaction
   */
  blobVersionedHashes?: PrefixedHexString[]
}

export interface EVMRunCodeOpts extends EVMRunOpts {
  /*
   * The initial program counter. Defaults to `0`
   */
  pc?: number
}

/**
 * Options for running a call (or create) operation with `EVM.runCall()`
 */
export interface EVMRunCallOpts extends EVMRunOpts {
  /**
   * If the code location is a precompile.
   */
  isCompiled?: boolean
  /**
   * An optional salt to pass to CREATE2.
   */
  salt?: Uint8Array
  /**
   * Created addresses in current context. Used in EIP 6780
   */
  createdAddresses?: Set<PrefixedHexString>
  /**
   * Skip balance checks if true. If caller balance is less than message value,
   * sets balance to message value to ensure execution doesn't fail.
   */
  skipBalance?: boolean
  /**
   * If the call is a DELEGATECALL. Defaults to false.
   */
  delegatecall?: boolean
  /**
   * Refund counter. Defaults to `0`
   */
  gasRefund?: bigint
  /**
   * Optionally pass in an already-built message.
   */
  message?: Message

  accessWitness?: VerkleAccessWitnessInterface
}

interface NewContractEvent {
  address: Address
  // The deployment code
  code: Uint8Array
}

export type EVMEvent = {
  newContract: (data: NewContractEvent, resolve?: (result?: any) => void) => void
  beforeMessage: (data: Message, resolve?: (result?: any) => void) => void
  afterMessage: (data: EVMResult, resolve?: (result?: any) => void) => void
  step: (data: InterpreterStep, resolve?: (result?: any) => void) => void
}

export interface EVMInterface {
  common: Common
  journal: {
    commit(): Promise<void>
    revert(): Promise<void>
    checkpoint(): Promise<void>
    cleanJournal(): void
    cleanup(): Promise<void>
    putAccount(address: Address, account: Account): Promise<void>
    deleteAccount(address: Address): Promise<void>
    accessList?: Map<string, Set<string>>
    preimages?: Map<PrefixedHexString, Uint8Array>
    addAlwaysWarmAddress(address: string, addToAccessList?: boolean): void
    addAlwaysWarmSlot(address: string, slot: string, addToAccessList?: boolean): void
    startReportingAccessList(): void
    startReportingPreimages?(): void
  }
  stateManager: StateManagerInterface
  precompiles: Map<string, PrecompileFunc>
  runCall(opts: EVMRunCallOpts): Promise<EVMResult>
  runCode(opts: EVMRunCodeOpts): Promise<ExecResult>
  events?: EventEmitter<EVMEvent>
  verkleAccessWitness?: VerkleAccessWitnessInterface
  systemVerkleAccessWitness?: VerkleAccessWitnessInterface
}

export type EVMProfilerOpts = {
  enabled: boolean
  // extra options here (such as use X hardfork for gas)
}

/**
 * Options for instantiating a {@link EVM}.
 */
export interface EVMOpts {
  /**
   * Use a {@link Common} instance for EVM instantiation.
   *
   * ### Supported EIPs
   *
   * - [EIP-1153](https://eips.ethereum.org/EIPS/eip-1153) - Transient storage opcodes (Cancun)
   * - [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559) - Fee market change for ETH 1.0 chain
   * - [EIP-2537](https://eips.ethereum.org/EIPS/eip-2537) - BLS precompiles (removed in v4.0.0, see latest v3 release)
   * - [EIP-2565](https://eips.ethereum.org/EIPS/eip-2565) - ModExp gas cost
   * - [EIP-2718](https://eips.ethereum.org/EIPS/eip-2565) - Transaction Types
   * - [EIP-2935](https://eips.ethereum.org/EIPS/eip-2935) - Serve historical block hashes from state (Prague)
   * - [EIP-2929](https://eips.ethereum.org/EIPS/eip-2929) - gas cost increases for state access opcodes
   * - [EIP-2930](https://eips.ethereum.org/EIPS/eip-2930) - Optional access list tx type
   * - [EIP-3198](https://eips.ethereum.org/EIPS/eip-3198) - Base fee Opcode
   * - [EIP-3529](https://eips.ethereum.org/EIPS/eip-3529) - Reduction in refunds
   * - [EIP-3540](https://eips.ethereum.org/EIPS/eip-3541) - EVM Object Format (EOF) v1 (`outdated`)
   * - [EIP-3541](https://eips.ethereum.org/EIPS/eip-3541) - Reject new contracts starting with the 0xEF byte
   * - [EIP-3554](https://eips.ethereum.org/EIPS/eip-3554) - Difficulty Bomb Delay to December 2021 (only PoW networks)
   * - [EIP-3607](https://eips.ethereum.org/EIPS/eip-3607) - Reject transactions from senders with deployed code
   * - [EIP-3651](https://eips.ethereum.org/EIPS/eip-3651) - Warm COINBASE (Shanghai)
   * - [EIP-3670](https://eips.ethereum.org/EIPS/eip-3670) - EOF - Code Validation (`outdated`)
   * - [EIP-3675](https://eips.ethereum.org/EIPS/eip-3675) - Upgrade consensus to Proof-of-Stake
   * - [EIP-3855](https://eips.ethereum.org/EIPS/eip-3855) - Push0 opcode (Shanghai)
   * - [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860) - Limit and meter initcode (Shanghai)
   * - [EIP-4345](https://eips.ethereum.org/EIPS/eip-4345) - Difficulty Bomb Delay to June 2022
   * - [EIP-4399](https://eips.ethereum.org/EIPS/eip-4399) - Supplant DIFFICULTY opcode with PREVRANDAO (Merge)
   * - [EIP-4788](https://eips.ethereum.org/EIPS/eip-4788) - Beacon block root in the EVM (Cancun)
   * - [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844) - Shard Blob Transactions (Cancun)
   * - [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) - EOA code transactions (Prague) (`outdated`)
   * - [EIP-7709](https://eips.ethereum.org/EIPS/eip-7709) - Read BLOCKHASH from storage and update cost (Osaka)
   * - [EIP-4895](https://eips.ethereum.org/EIPS/eip-4895) - Beacon chain push withdrawals as operations (Shanghai)
   * - [EIP-5133](https://eips.ethereum.org/EIPS/eip-5133) - Delaying Difficulty Bomb to mid-September 2022 (Gray Glacier)
   * - [EIP-5656](https://eips.ethereum.org/EIPS/eip-5656) - MCOPY - Memory copying instruction (Cancun)
   * - [EIP-6110](https://eips.ethereum.org/EIPS/eip-6110) - Supply validator deposits on chain (Prague)
   * - [EIP-6780](https://eips.ethereum.org/EIPS/eip-6780) - SELFDESTRUCT only in same transaction (Cancun)
   * - [EIP-6800](https://eips.ethereum.org/EIPS/eip-6800) - Verkle state tree (Experimental)
   * - [EIP-7002](https://eips.ethereum.org/EIPS/eip-7002) - Execution layer triggerable withdrawals (Prague)
   * - [EIP-7251](https://eips.ethereum.org/EIPS/eip-7251) - Execution layer triggerable validator consolidations (Prague)
   * - [EIP-7516](https://eips.ethereum.org/EIPS/eip-7516) - BLOBBASEFEE opcode (Cancun)
   * - [EIP-7685](https://eips.ethereum.org/EIPS/eip-7685) - General purpose execution layer requests (Prague)
   *
   * *Annotations:*
   *
   * - `experimental`: behaviour can change on patch versions
   */
  common?: Common

  /**
   * Allows unlimited contract sizes while debugging. By setting this to `true`, the check for
   * contract size limit of 24KB (see [EIP-170](https://git.io/vxZkK)) is bypassed.
   *
   * Default: `false` [ONLY set to `true` during debugging]
   */
  allowUnlimitedContractSize?: boolean

  /**
   * Allows unlimited contract code-size init while debugging. This (partially) disables EIP-3860.
   * Gas cost for initcode size analysis will still be charged. Use with caution.
   */
  allowUnlimitedInitCodeSize?: boolean

  /**
   * EVM parameters sorted by EIP can be found in the exported `paramsEVM` dictionary,
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
   * const params = JSON.parse(JSON.stringify(paramsEVM))
   * params['1679']['bn254AddGas'] = 100 // 150
   * ```
   */
  params?: ParamsDict

  /**
   * Override or add custom opcodes to the EVM instruction set
   * These custom opcodes are EIP-agnostic and are always statically added
   * To delete an opcode, add an entry of format `{opcode: number}`. This will delete that opcode from the EVM.
   * If this opcode is then used in the EVM, the `INVALID` opcode would instead be used.
   * To add an opcode, add an entry of the following format:
   * {
   *    // The opcode number which will invoke the custom opcode logic
   *    opcode: number
   *    // The name of the opcode (as seen in the `step` event)
   *    opcodeName: string
   *    // The base fee of the opcode
   *    baseFee: number
   *    // If the opcode charges dynamic gas, add this here. To charge the gas, use the `i` methods of the BN, to update the charged gas
   *    gasFunction?: function(runState: RunState, gas: BN, common: Common)
   *    // The logic of the opcode which holds the logic of changing the current state
   *    logicFunction: function(runState: RunState)
   * }
   * Note: gasFunction and logicFunction can both be async or synchronous functions
   */
  customOpcodes?: CustomOpcode[]

  /*
   * Adds custom precompiles. This is hardfork-agnostic: these precompiles are always activated
   * If only an address is given, the precompile is deleted
   * If an address and a `PrecompileFunc` is given, this precompile is inserted or overridden
   * Please ensure `PrecompileFunc` has exactly one parameter `input: PrecompileInput`
   */
  customPrecompiles?: CustomPrecompile[]

  /**
   * For the EIP-2537 BLS Precompiles, the native JS `ethereum-cryptography` (`@noble/curves`)
   * https://github.com/ethereum/js-ethereum-cryptography BLS12-381 curve implementation
   * is used (see `noble.ts` file in the `precompiles/bls12_381/` folder).
   *
   * To use an alternative implementation this option can be used by passing
   * in a wrapper implementation integrating the desired library and adhering
   * to the `EVMBLSInterface` specification.
   *
   * An interface for the MCL WASM implementation https://github.com/herumi/mcl-wasm
   * is shipped with this library which can be used as follows (with `mcl-wasm` being
   * explicitly added to the set of dependencies):
   *
   * ```ts
   * import * as mcl from 'mcl-wasm'
   *
   * await mcl.init(mcl.BLS12_381)
   * const evm = await createEVM({ bls: new MCLBLS(mcl) })
   * ```
   */
  bls?: EVMBLSInterface

  /**
   * For the EIP-196/EIP-197 BN254 (alt_BN128) EC precompiles, the native JS `ethereum-cryptography`
   * (`@noble/curves`) https://github.com/ethereum/js-ethereum-cryptography BN254 curve implementation
   * is used (see `noble.ts` file in the `precompiles/bn254/` folder).
   *
   * To use an alternative implementation this option can be used by passing
   * in a wrapper implementation integrating the desired library and adhering
   * to the `EVMBN254Interface` specification.
   *
   * An interface for a WASM wrapper https://github.com/ethereumjs/rustbn.js around the
   * Parity fork of the Zcash bn pairing cryptography library is shipped with this library
   * which can be used as follows (with `rustbn.js` being explicitly added to the set of
   * dependencies):
   *
   * ```ts
   * import { initRustBN } from 'rustbn-wasm'
   *
   * const bn254 = await initRustBN()
   * const evm = await createEVM({ bn254: new RustBN254(bn254) })
   * ```
   */
  bn254?: EVMBN254Interface

  /*
   * The EVM comes with a basic dependency-minimized `SimpleStateManager` implementation
   * which serves most code execution use cases and which is included in the
   * `@ethereumjs/statemanager` package.
   *
   * The `@ethereumjs/statemanager` package also provides a variety of state manager
   * implementations for different needs (MPT-tree backed, RPC, experimental verkle)
   * which can be used by this option as a replacement.
   */
  stateManager?: StateManagerInterface

  /**
   * The EVM comes with a basic mock blockchain interface and implementation for
   * non-block containing use cases.
   *
   * For block-containing setups use the full blockchain implementation from the
   * `@ethereumjs/blockchain package.
   */
  blockchain?: EVMMockBlockchainInterface

  /**
   *
   */
  profiler?: EVMProfilerOpts

  /**
   * When running the EVM with PoA consensus, the `cliqueSigner` function from the `@ethereumjs/block` class
   * must be provided along with a `BlockHeader` so that the coinbase can be correctly retrieved when the
   * `Interpreter.getBlockCoinbase` method is called.
   */
  cliqueSigner?: (header: Block['header']) => Address
}

/**
 * Result of executing a message via the {@link EVM}.
 */
export interface EVMResult {
  /**
   * Address of created account during transaction, if any
   */
  createdAddress?: Address
  /**
   * Contains the results from running the code, if any, as described in {@link runCode}
   */
  execResult: ExecResult
}

/**
 * Result of executing a call via the {@link EVM}.
 */
export interface ExecResult {
  runState?: RunState
  /**
   * Description of the exception, if any occurred
   */
  exceptionError?: EVMError
  /**
   * Amount of gas left
   */
  gas?: bigint
  /**
   * Amount of gas the code used to run
   */
  executionGasUsed: bigint
  /**
   * Return value from the contract
   */
  returnValue: Uint8Array
  /**
   * Array of logs that the contract emitted
   */
  logs?: Log[]
  /**
   * A set of accounts to selfdestruct
   */
  selfdestruct?: Set<PrefixedHexString>
  /**
   * Map of addresses which were created (used in EIP 6780)
   */
  createdAddresses?: Set<PrefixedHexString>
  /**
   * The gas refund counter
   */
  gasRefund?: bigint
  /**
   * Amount of blob gas consumed by the transaction
   */
  blobGasUsed?: bigint
}

/**
 * High level wrapper for BLS libraries used
 * for the BLS precompiles
 */
export type EVMBLSInterface = {
  init?(): void
  addG1(input: Uint8Array): Uint8Array
  mulG1(input: Uint8Array): Uint8Array
  addG2(input: Uint8Array): Uint8Array
  mulG2(input: Uint8Array): Uint8Array
  mapFPtoG1(input: Uint8Array): Uint8Array
  mapFP2toG2(input: Uint8Array): Uint8Array
  msmG1(input: Uint8Array): Uint8Array
  msmG2(input: Uint8Array): Uint8Array
  pairingCheck(input: Uint8Array): Uint8Array
}

/**
 * High level wrapper for BN254 (alt_BN128) libraries
 * used for the BN254 (alt_BN128) EC precompiles
 */
export type EVMBN254Interface = {
  add: (input: Uint8Array) => Uint8Array
  mul: (input: Uint8Array) => Uint8Array
  pairing: (input: Uint8Array) => Uint8Array
}

/**
 * Log that the contract emits.
 */
export type Log = [address: Uint8Array, topics: Uint8Array[], data: Uint8Array]

export type Block = {
  header: {
    number: bigint
    coinbase: Address
    timestamp: bigint
    difficulty: bigint
    prevRandao: Uint8Array
    gasLimit: bigint
    baseFeePerGas?: bigint
    getBlobGasPrice(): bigint | undefined
  }
}

export interface TransientStorageInterface {
  get(addr: Address, key: Uint8Array): Uint8Array
  put(addr: Address, key: Uint8Array, value: Uint8Array): void
  commit(): void
  checkpoint(): void
  revert(): void
  toJSON(): { [address: string]: { [key: string]: string } }
  clear(): void
}

export type EVMMockBlock = {
  hash(): Uint8Array
}

export interface EVMMockBlockchainInterface {
  getBlock(blockId: number): Promise<EVMMockBlock>
  putBlock(block: EVMMockBlock): Promise<void>
  shallowCopy(): EVMMockBlockchainInterface
}

export class EVMMockBlockchain implements EVMMockBlockchainInterface {
  async getBlock() {
    return {
      hash() {
        return new Uint8Array(32)
      },
    }
  }
  async putBlock() {}
  shallowCopy() {
    return this
  }
}

// EOF type which holds the execution-related data for EOF
export type EOFEnv = {
  container: EOFContainer
  eofRunState: {
    returnStack: number[]
  }
}

// EIP-7702 flag: if contract code starts with these 3 bytes, it is a 7702-delegated EOA
export const DELEGATION_7702_FLAG = new Uint8Array([0xef, 0x01, 0x00])
