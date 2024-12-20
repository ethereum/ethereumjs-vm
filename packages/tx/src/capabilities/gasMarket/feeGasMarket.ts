import type { EIP1559CompatibleTx, FeeGasMarketInterface } from '../../types.js'

// NOTE: this file is currently essentially the "FeeMarket" capability

export function getUpfrontCost(tx: FeeGasMarketInterface, baseFee: bigint): bigint {
  const prio = tx.maxPriorityFeePerGas
  const maxBase = tx.maxFeePerGas - baseFee
  const inclusionFeePerGas = prio < maxBase ? prio : maxBase
  const gasPrice = inclusionFeePerGas + baseFee
  return tx.gasLimit * gasPrice + tx.value
}

export function getEffectivePriorityFee(
  tx: FeeGasMarketInterface,
  baseFee: bigint | undefined,
): bigint {
  if (baseFee === undefined || baseFee > tx.maxFeePerGas) {
    throw new Error('Tx cannot pay baseFee')
  }

  // The remaining fee for the coinbase, which can take up to this value, capped at `maxPriorityFeePerGas`
  const remainingFee = tx.maxFeePerGas - baseFee

  return tx.maxPriorityFeePerGas < remainingFee ? tx.maxPriorityFeePerGas : remainingFee
}
