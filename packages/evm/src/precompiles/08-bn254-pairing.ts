import { bytesToHex } from '@ethereumjs/util'

import { EvmErrorResult, OOGResult } from '../evm.js'
import { ERROR, EvmError } from '../exceptions.js'

import { gasLimitCheck, moduloLengthCheck } from './util.js'

import { getPrecompileName } from './index.js'

import type { EVM } from '../evm.js'
import type { ExecResult } from '../types.js'
import type { PrecompileInput } from './types.js'

export function precompile08(opts: PrecompileInput): ExecResult {
  const pName = getPrecompileName('08')
  if (!moduloLengthCheck(opts, 192, pName)) {
    return EvmErrorResult(new EvmError(ERROR.INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  const inputDataSize = BigInt(Math.floor(opts.data.length / 192))
  const gasUsed =
    opts.common.param('bn254PairingGas') + inputDataSize * opts.common.param('bn254PairingWordGas')

  if (!gasLimitCheck(opts, gasUsed, pName)) {
    return OOGResult(opts.gasLimit)
  }

  let returnData
  try {
    returnData = (opts._EVM as EVM)['_bn254'].pairing(opts.data)
  } catch (e) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: ${e.message}`)
    }
    return EvmErrorResult(e, opts.gasLimit)
  }

  // check ecpairing success or failure by comparing the output length
  if (returnData.length !== 32) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: OOG`)
    }
    // TODO: should this really return OOG?
    return OOGResult(opts.gasLimit)
  }

  if (opts._debug !== undefined) {
    opts._debug(`${pName} return value=${bytesToHex(returnData)}`)
  }

  return {
    executionGasUsed: gasUsed,
    returnValue: returnData,
  }
}
