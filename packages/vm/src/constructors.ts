import { Common, Mainnet } from '@ethereumjs/common'
import { EVMMockBlockchain, createEVM, getActivePrecompiles } from '@ethereumjs/evm'
import { MerkleStateManager } from '@ethereumjs/statemanager'
import {
  Account,
  Address,
  EthereumJSErrorWithoutCode,
  createAccount,
  unprefixedHexToBytes,
} from '@ethereumjs/util'

import { VM } from './vm.js'

import type { VMOpts } from './types.js'

/**
 * VM async constructor. Creates engine instance and initializes it.
 *
 * @param opts VM engine constructor options
 */
export async function createVM(opts: VMOpts = {}): Promise<VM> {
  // Save if a `StateManager` was passed (for activatePrecompiles)
  const didPassStateManager = opts.stateManager !== undefined

  // Add common, SM, blockchain, EVM here
  if (opts.common === undefined) {
    opts.common = new Common({ chain: Mainnet })
  }

  if (opts.stateManager === undefined) {
    opts.stateManager = new MerkleStateManager({
      common: opts.common,
    })
  }

  if (opts.blockchain === undefined) {
    opts.blockchain = new EVMMockBlockchain()
  }

  if (opts.profilerOpts !== undefined) {
    const profilerOpts = opts.profilerOpts
    if (profilerOpts.reportAfterBlock === true && profilerOpts.reportAfterTx === true) {
      throw EthereumJSErrorWithoutCode(
        'Cannot have `reportProfilerAfterBlock` and `reportProfilerAfterTx` set to `true` at the same time',
      )
    }
  }

  if (opts.evm !== undefined && opts.evmOpts !== undefined) {
    throw EthereumJSErrorWithoutCode('the evm and evmOpts options cannot be used in conjunction')
  }

  if (opts.evm === undefined) {
    let enableProfiler = false
    if (opts.profilerOpts?.reportAfterBlock === true || opts.profilerOpts?.reportAfterTx === true) {
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
