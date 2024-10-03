import {
  BIGINT_27,
  BIGINT_28,
  bytesToBigInt,
  bytesToHex,
  ecrecover,
  publicToAddress,
  setLengthLeft,
  setLengthRight,
} from '@ethereumjs/util'

import { OOGResult } from '../evm.js'

import { gasLimitCheck } from './util.js'

import { getPrecompileName } from './index.js'

import type { ExecResult } from '../types.js'
import type { PrecompileInput } from './types.js'

export function precompile01(opts: PrecompileInput): ExecResult {
  const pName = getPrecompileName('01')
  const ecrecoverFunction = opts.common.customCrypto.ecrecover ?? ecrecover
  const gasUsed = opts.common.param('ecRecoverGas')
  if (!gasLimitCheck(opts, gasUsed, pName)) {
    return OOGResult(opts.gasLimit)
  }

  const data = setLengthRight(opts.data, 128)

  const msgHash = data.subarray(0, 32)
  const v = data.subarray(32, 64)
  const vBigInt = bytesToBigInt(v)

  // Guard against util's `ecrecover`: without providing chainId this will return
  // a signature in most of the cases in the cases that `v=0` or `v=1`
  // However, this should throw, only 27 and 28 is allowed as input
  if (vBigInt !== BIGINT_27 && vBigInt !== BIGINT_28) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: v neither 27 nor 28`)
    }
    return {
      executionGasUsed: gasUsed,
      returnValue: new Uint8Array(),
    }
  }

  const r = data.subarray(64, 96)
  const s = data.subarray(96, 128)

  let publicKey
  try {
    if (opts._debug !== undefined) {
      opts._debug(
        `${pName}: PK recovery with msgHash=${bytesToHex(msgHash)} v=${bytesToHex(
          v,
        )} r=${bytesToHex(r)}s=${bytesToHex(s)}}`,
      )
    }
    publicKey = ecrecoverFunction(msgHash, bytesToBigInt(v), r, s)
  } catch {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: PK recovery failed`)
    }
    return {
      executionGasUsed: gasUsed,
      returnValue: new Uint8Array(0),
    }
  }
  const address = setLengthLeft(publicToAddress(publicKey), 32)
  if (opts._debug !== undefined) {
    opts._debug(`${pName} return address=${bytesToHex(address)}`)
  }
  return {
    executionGasUsed: gasUsed,
    returnValue: address,
  }
}
