import { bytesToHex, setLengthRight } from '@ethereumjs/util'

import { EvmErrorResult, OOGResult } from '../evm.js'

import { gasLimitCheck } from './util.js'

import type { EVM } from '../evm.js'
import type { ExecResult } from '../types.js'
import type { PrecompileInput } from './types.js'

export function precompile07(opts: PrecompileInput): ExecResult {
  const gasUsed = opts.common.param('ecMulGas')
  if (!gasLimitCheck(opts, gasUsed, 'ECMUL (0x07)')) {
    return OOGResult(opts.gasLimit)
  }

  // > 128 bytes: chop off extra bytes
  // < 128 bytes: right-pad with 0-s
  const input = setLengthRight(opts.data.subarray(0, 128), 128)

  let returnData
  try {
    returnData = (opts._EVM as EVM)['_bn254'].mul(input)
  } catch (e: any) {
    if (opts._debug !== undefined) {
      opts._debug(`ECMUL (0x07) failed: ${e.message}`)
    }
    return EvmErrorResult(e, opts.gasLimit)
  }

  // check ecmul success or failure by comparing the output length
  if (returnData.length !== 64) {
    if (opts._debug !== undefined) {
      opts._debug(`ECMUL (0x07) failed: OOG`)
    }
    // TODO: should this really return OOG?
    return OOGResult(opts.gasLimit)
  }

  if (opts._debug !== undefined) {
    opts._debug(`ECMUL (0x07) return value=${bytesToHex(returnData)}`)
  }

  return {
    executionGasUsed: gasUsed,
    returnValue: returnData,
  }
}
