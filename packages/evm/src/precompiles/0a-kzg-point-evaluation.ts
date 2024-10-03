import {
  bigIntToBytes,
  bytesToHex,
  computeVersionedHash,
  concatBytes,
  setLengthLeft,
} from '@ethereumjs/util'

import { EvmErrorResult, OOGResult } from '../evm.js'
import { ERROR, EvmError } from '../exceptions.js'

import { gasLimitCheck } from './util.js'

import { getPrecompileName } from './index.js'

import type { ExecResult } from '../types.js'
import type { PrecompileInput } from './types.js'

export const BLS_MODULUS = BigInt(
  '52435875175126190479447740508185965837690552500527637822603658699938581184513',
)

const modulusBuffer = setLengthLeft(bigIntToBytes(BLS_MODULUS), 32)

export async function precompile0a(opts: PrecompileInput): Promise<ExecResult> {
  const pName = getPrecompileName('0a')
  if (opts.common.customCrypto?.kzg === undefined) {
    throw new Error('kzg not initialized')
  }
  const gasUsed = opts.common.param('kzgPointEvaluationPrecompileGas')
  if (!gasLimitCheck(opts, gasUsed, pName)) {
    return OOGResult(opts.gasLimit)
  }

  if (opts.data.length !== 192) {
    return EvmErrorResult(new EvmError(ERROR.INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  const version = Number(opts.common.param('blobCommitmentVersionKzg'))
  const fieldElementsPerBlob = opts.common.param('fieldElementsPerBlob')
  const versionedHash = bytesToHex(opts.data.subarray(0, 32))
  const z = bytesToHex(opts.data.subarray(32, 64))
  const y = bytesToHex(opts.data.subarray(64, 96))
  const commitment = bytesToHex(opts.data.subarray(96, 144))
  const kzgProof = bytesToHex(opts.data.subarray(144, 192))

  if (computeVersionedHash(commitment, version) !== versionedHash) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: INVALID_COMMITMENT`)
    }
    return EvmErrorResult(new EvmError(ERROR.INVALID_COMMITMENT), opts.gasLimit)
  }

  if (opts._debug !== undefined) {
    opts._debug(
      `${pName}: proof verification with commitment=${
        commitment
      } z=${z} y=${y} kzgProof=${kzgProof}`,
    )
  }
  try {
    const res = opts.common.customCrypto?.kzg?.verifyProof(commitment, z, y, kzgProof)
    if (res === false) {
      return EvmErrorResult(new EvmError(ERROR.INVALID_PROOF), opts.gasLimit)
    }
  } catch (err) {
    if (!(err instanceof Error)) {
      err = new Error(err)
    }
    if (err.message.includes('C_KZG_BADARGS') === true) {
      if (opts._debug !== undefined) {
        opts._debug(`${pName} failed: INVALID_INPUTS`)
      }
      return EvmErrorResult(new EvmError(ERROR.INVALID_INPUTS), opts.gasLimit)
    }
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: Unknown error - ${err.message}`)
    }
    return EvmErrorResult(new EvmError(ERROR.REVERT), opts.gasLimit)
  }

  // Return value - FIELD_ELEMENTS_PER_BLOB and BLS_MODULUS as padded 32 byte big endian values
  const fieldElementsBuffer = setLengthLeft(bigIntToBytes(fieldElementsPerBlob), 32)

  if (opts._debug !== undefined) {
    opts._debug(
      `${pName} return fieldElements=${bytesToHex(
        fieldElementsBuffer,
      )} modulus=${bytesToHex(modulusBuffer)}`,
    )
  }

  return {
    executionGasUsed: gasUsed,
    returnValue: concatBytes(fieldElementsBuffer, modulusBuffer),
  }
}
