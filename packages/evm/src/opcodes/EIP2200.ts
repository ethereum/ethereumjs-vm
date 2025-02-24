import { equalsBytes } from '@ethereumjs/util'

import { EVMError, EVMErrorCode } from '../errors.js'

import { adjustSstoreGasEIP2929 } from './EIP2929.js'
import { trap } from './util.js'

import type { RunState } from '../interpreter.js'
import type { Common } from '@ethereumjs/common'

/**
 * Adjusts gas usage and refunds of SStore ops per EIP-2200 (Istanbul)
 *
 * @param {RunState} runState
 * @param {Uint8Array}   currentStorage
 * @param {Uint8Array}   originalStorage
 * @param {Uint8Array}   value
 * @param {Common}   common
 */
export function updateSstoreGasEIP2200(
  runState: RunState,
  currentStorage: Uint8Array,
  originalStorage: Uint8Array,
  value: Uint8Array,
  key: Uint8Array,
  common: Common,
) {
  // Fail if not enough gas is left
  if (runState.interpreter.getGasLeft() <= common.param('sstoreSentryEIP2200Gas')) {
    trap(new EVMError({ code: EVMErrorCode.OUT_OF_GAS }))
  }

  // Noop
  if (equalsBytes(currentStorage, value)) {
    const sstoreNoopCost = common.param('sstoreNoopEIP2200Gas')
    return adjustSstoreGasEIP2929(runState, key, sstoreNoopCost, 'noop', common)
  }
  if (equalsBytes(originalStorage, currentStorage)) {
    // Create slot
    if (originalStorage.length === 0) {
      return common.param('sstoreInitEIP2200Gas')
    }
    // Delete slot
    if (value.length === 0) {
      runState.interpreter.refundGas(
        common.param('sstoreClearRefundEIP2200Gas'),
        'EIP-2200 -> sstoreClearRefundEIP2200',
      )
    }
    // Write existing slot
    return common.param('sstoreCleanEIP2200Gas')
  }
  if (originalStorage.length > 0) {
    if (currentStorage.length === 0) {
      // Recreate slot
      runState.interpreter.subRefund(
        common.param('sstoreClearRefundEIP2200Gas'),
        'EIP-2200 -> sstoreClearRefundEIP2200',
      )
    } else if (value.length === 0) {
      // Delete slot
      runState.interpreter.refundGas(
        common.param('sstoreClearRefundEIP2200Gas'),
        'EIP-2200 -> sstoreClearRefundEIP2200',
      )
    }
  }
  if (equalsBytes(originalStorage, value)) {
    if (originalStorage.length === 0) {
      // Reset to original non-existent slot
      const sstoreInitRefund = common.param('sstoreInitRefundEIP2200Gas')
      runState.interpreter.refundGas(
        adjustSstoreGasEIP2929(runState, key, sstoreInitRefund, 'initRefund', common),
        'EIP-2200 -> initRefund',
      )
    } else {
      // Reset to original existing slot
      const sstoreCleanRefund = common.param('sstoreCleanRefundEIP2200Gas')
      runState.interpreter.refundGas(
        BigInt(adjustSstoreGasEIP2929(runState, key, sstoreCleanRefund, 'cleanRefund', common)),
        'EIP-2200 -> cleanRefund',
      )
    }
  }
  // Dirty update
  return common.param('sstoreDirtyEIP2200Gas')
}
