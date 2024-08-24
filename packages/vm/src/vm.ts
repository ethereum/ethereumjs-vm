import { Common, Mainnet } from '@ethereumjs/common'
import { EVMMockBlockchain, createEVM, getActivePrecompiles } from '@ethereumjs/evm'
import { DefaultStateManager } from '@ethereumjs/statemanager'
import {
  Account,
  Address,
  AsyncEventEmitter,
  createAccount,
  unprefixedHexToBytes,
} from '@ethereumjs/util'

import { paramsVM } from './params.js'

import type { VMEvents, VMOpts } from './types.js'
import type { StateManagerInterface } from '@ethereumjs/common'
import type { EVMInterface, EVMMockBlockchainInterface } from '@ethereumjs/evm'
import type { BigIntLike } from '@ethereumjs/util'

/**
 * Execution engine which can be used to run a blockchain, individual
 * blocks, individual transactions, or snippets of EVM bytecode.
 *
 * This class is an AsyncEventEmitter, please consult the README to learn how to use it.
 */
export class VM {
  /**
   * The StateManager used by the VM
   */
  readonly stateManager: StateManagerInterface

  /**
   * The blockchain the VM operates on
   */
  readonly blockchain: EVMMockBlockchainInterface

  readonly common: Common

  readonly events: AsyncEventEmitter<VMEvents>
  /**
   * The EVM used for bytecode execution
   */
  readonly evm: EVMInterface

  protected readonly _opts: VMOpts
  protected _isInitialized: boolean = false

  protected readonly _setHardfork: boolean | BigIntLike

  /**
   * Cached emit() function, not for public usage
   * set to public due to implementation internals
   * @hidden
   */
  public _emit(topic: keyof VMEvents, data: any): Promise<void> {
    return new Promise((resolve) => this.events.emit(topic, data, resolve))
  }

  /**
   * VM is run in DEBUG mode (default: false)
   * Taken from DEBUG environment variable
   *
   * Safeguards on debug() calls are added for
   * performance reasons to avoid string literal evaluation
   * @hidden
   */
  readonly DEBUG: boolean = false

  /**
   * VM async constructor. Creates engine instance and initializes it.
   *
   * @param opts VM engine constructor options
   */
  static async create(opts: VMOpts = {}): Promise<VM> {
    // Save if a `StateManager` was passed (for activatePrecompiles)
    const didPassStateManager = opts.stateManager !== undefined

    // Add common, SM, blockchain, EVM here
    if (opts.common === undefined) {
      opts.common = new Common({ chain: Mainnet })
    }

    if (opts.stateManager === undefined) {
      opts.stateManager = new DefaultStateManager({
        common: opts.common,
      })
    }

    if (opts.blockchain === undefined) {
      opts.blockchain = new EVMMockBlockchain()
    }

    if (opts.profilerOpts !== undefined) {
      const profilerOpts = opts.profilerOpts
      if (profilerOpts.reportAfterBlock === true && profilerOpts.reportAfterTx === true) {
        throw new Error(
          'Cannot have `reportProfilerAfterBlock` and `reportProfilerAfterTx` set to `true` at the same time',
        )
      }
    }

    if (opts.evm !== undefined && opts.evmOpts !== undefined) {
      throw new Error('the evm and evmOpts options cannot be used in conjunction')
    }

    if (opts.evm === undefined) {
      let enableProfiler = false
      if (
        opts.profilerOpts?.reportAfterBlock === true ||
        opts.profilerOpts?.reportAfterTx === true
      ) {
        enableProfiler = true
      }
      const evmOpts = opts.evmOpts ?? {}
      opts.evm = await createEVM({
        common: opts.common,
        stateManager: opts.stateManager,
        blockchain: opts.blockchain,
        profiler: {
          enabled: enableProfiler,
        },
        ...evmOpts,
      })
    }

    if (opts.activatePrecompiles === true && !didPassStateManager) {
      await opts.evm.journal.checkpoint()
      // put 1 wei in each of the precompiles in order to make the accounts non-empty and thus not have them deduct `callNewAccount` gas.
      for (const [addressStr] of getActivePrecompiles(opts.common)) {
        const address = new Address(unprefixedHexToBytes(addressStr))
        let account = await opts.evm.stateManager.getAccount(address)
        // Only do this if it is not overridden in genesis
        // Note: in the case that custom genesis has storage fields, this is preserved
        if (account === undefined) {
          account = new Account()
          const newAccount = createAccount({
            balance: 1,
            storageRoot: account.storageRoot,
          })
          await opts.evm.stateManager.putAccount(address, newAccount)
        }
      }
      await opts.evm.journal.commit()
    }

    return new VM(opts)
  }

  /**
   * Instantiates a new {@link VM} Object.
   *
   * @deprecated The direct usage of this constructor is discouraged since
   * non-finalized async initialization might lead to side effects. Please
   * use the async {@link VM.create} constructor instead (same API).
   * @param opts
   */
  protected constructor(opts: VMOpts = {}) {
    this.common = opts.common!
    this.common.updateParams(opts.params ?? paramsVM)
    this.stateManager = opts.stateManager!
    this.blockchain = opts.blockchain!
    this.evm = opts.evm!

    this.events = new AsyncEventEmitter<VMEvents>()

    this._opts = opts

    this._setHardfork = opts.setHardfork ?? false

    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    // Additional window check is to prevent vite browser bundling (and potentially other) to break
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
  }

  /**
   * Returns a copy of the {@link VM} instance.
   *
   * Note that the returned copy will share the same db as the original for the blockchain and the statemanager.
   *
   * Associated caches will be deleted and caches will be re-initialized for a more short-term focused
   * usage, being less memory intense (the statemanager caches will switch to using an ORDERED_MAP cache
   * data structure more suitable for short-term usage, the trie node LRU cache will not be activated at all).
   * To fine-tune this behavior (if the shallow-copy-returned object has a longer life span e.g.) you can set
   * the `downlevelCaches` option to `false`.
   *
   * @param downlevelCaches Downlevel (so: adopted for short-term usage) associated state caches (default: true)
   */
  async shallowCopy(downlevelCaches = true): Promise<VM> {
    const common = this.common.copy()
    common.setHardfork(this.common.hardfork())
    const blockchain = this.blockchain.shallowCopy()
    const stateManager = this.stateManager.shallowCopy(downlevelCaches)
    const evmOpts = {
      ...(this.evm as any)._optsCached,
      common: this._opts.evmOpts?.common?.copy() ?? common,
      blockchain: this._opts.evmOpts?.blockchain?.shallowCopy() ?? blockchain,
      stateManager: this._opts.evmOpts?.stateManager?.shallowCopy(downlevelCaches) ?? stateManager,
    }
    const evmCopy = await createEVM(evmOpts) // TODO fixme (should copy the EVMInterface, not default EVM)
    return VM.create({
      stateManager,
      blockchain: this.blockchain,
      common,
      evm: evmCopy,
      setHardfork: this._setHardfork,
      profilerOpts: this._opts.profilerOpts,
    })
  }

  /**
   * Return a compact error string representation of the object
   */
  errorStr() {
    let hf = ''
    try {
      hf = this.common.hardfork()
    } catch {
      hf = 'error'
    }
    const errorStr = `vm hf=${hf}`
    return errorStr
  }
}
