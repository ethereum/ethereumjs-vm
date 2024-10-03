import { createEVM } from '@ethereumjs/evm'
import { AsyncEventEmitter } from '@ethereumjs/util'

import { createVM } from './constructors.js'
import { paramsVM } from './params.js'

import type { VMEvents, VMOpts } from './types.js'
import type { Common, StateManagerInterface } from '@ethereumjs/common'
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
   * Instantiates a new {@link VM} Object.
   *
   * @deprecated The direct usage of this constructor is discouraged since
   * non-finalized async initialization might lead to side effects. Please
   * use the async {@link createVM} constructor instead (same API).
   * @param opts
   */
  constructor(opts: VMOpts = {}) {
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
    return createVM({
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
