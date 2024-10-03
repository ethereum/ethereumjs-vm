import { bytesToHex } from '@ethereumjs/util'

import { EvmErrorResult, OOGResult } from '../evm.js'
import { ERROR, EvmError } from '../exceptions.js'

import { leading16ZeroBytesCheck, msmGasUsed } from './bls12_381/index.js'
import { gasLimitCheck, moduloLengthCheck } from './util.js'

import { getPrecompileName } from './index.js'

import type { EVMBLSInterface, ExecResult } from '../types.js'
import type { PrecompileInput } from './types.js'

export async function precompile0d(opts: PrecompileInput): Promise<ExecResult> {
  const pName = getPrecompileName('0d')
  const bls = (<any>opts._EVM)._bls! as EVMBLSInterface

  const inputData = opts.data

  if (inputData.length === 0) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: Empty input`)
    }
    return EvmErrorResult(new EvmError(ERROR.BLS_12_381_INPUT_EMPTY), opts.gasLimit) // follow Geth's implementation
  }

  // TODO: Double-check respectively confirm that this order is really correct that the gas check
  // on this eventually to be "floored" pair number should happen before the input length modulo
  // validation (same for g2msm)
  const numPairs = Math.floor(inputData.length / 160)
  const gasUsedPerPair = opts.common.paramByEIP('bls12381G1MulGas', 2537) ?? BigInt(0)
  const gasUsed = msmGasUsed(numPairs, gasUsedPerPair)

  if (!gasLimitCheck(opts, gasUsed, pName)) {
    return OOGResult(opts.gasLimit)
  }

  if (inputData.length % 160 !== 0) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: Invalid input length length=${inputData.length}`)
    }
    return EvmErrorResult(new EvmError(ERROR.BLS_12_381_INVALID_INPUT_LENGTH), opts.gasLimit)
  }
  if (!moduloLengthCheck(opts, 160, pName)) {
    return EvmErrorResult(new EvmError(ERROR.BLS_12_381_INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  // prepare pairing list and check for mandatory zero bytes
  const zeroByteRanges = [
    [0, 16],
    [64, 80],
  ]

  for (let k = 0; k < numPairs; k++) {
    // zero bytes check
    const pairStart = 160 * k
    if (!leading16ZeroBytesCheck(opts, zeroByteRanges, pName, pairStart)) {
      return EvmErrorResult(new EvmError(ERROR.BLS_12_381_POINT_NOT_ON_CURVE), opts.gasLimit)
    }
  }

  let returnValue
  try {
    returnValue = bls.msmG1(opts.data)
  } catch (e) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: ${e.message}`)
    }
    return EvmErrorResult(e, opts.gasLimit)
  }

  if (opts._debug !== undefined) {
    opts._debug(`${pName} return value=${bytesToHex(returnValue)}`)
  }

  return {
    executionGasUsed: gasUsed,
    returnValue,
  }
}
