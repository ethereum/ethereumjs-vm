import { EvmErrorResult, OOGResult } from '../evm'
import { ERROR, EvmError } from '../exceptions'

import { gasDiscountPairs } from './util/bls12_381'

import type { ExecResult } from '../evm'
import type { PrecompileInput } from './types'

const {
  BLS12_381_ToG2Point,
  BLS12_381_ToFrPoint,
  BLS12_381_FromG2Point,
} = require('./util/bls12_381')

export async function precompile0f(opts: PrecompileInput): Promise<ExecResult> {
  const mcl = (<any>opts._EVM)._mcl!

  const inputData = opts.data

  if (inputData.length === 0) {
    return EvmErrorResult(new EvmError(ERROR.BLS_12_381_INPUT_EMPTY), opts.gasLimit) // follow Geths implementation
  }

  const numPairs = Math.floor(inputData.length / 288)

  const gasUsedPerPair = opts._common.paramByEIP('gasPrices', 'Bls12381G2MulGas', 2537) ?? BigInt(0)
  const gasDiscountArray = gasDiscountPairs
  const gasDiscountMax = gasDiscountArray[gasDiscountArray.length - 1][1]
  let gasDiscountMultiplier

  if (numPairs <= gasDiscountArray.length) {
    if (numPairs === 0) {
      gasDiscountMultiplier = 0 // this implicitly sets gasUsed to 0 as per the EIP.
    } else {
      gasDiscountMultiplier = gasDiscountArray[numPairs - 1][1]
    }
  } else {
    gasDiscountMultiplier = gasDiscountMax
  }

  const gasUsed = (gasUsedPerPair * BigInt(numPairs) * BigInt(gasDiscountMultiplier)) / BigInt(1000)

  if (opts.gasLimit < gasUsed) {
    return OOGResult(opts.gasLimit)
  }

  if (inputData.length % 288 !== 0) {
    return EvmErrorResult(new EvmError(ERROR.BLS_12_381_INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  // prepare pairing list and check for mandatory zero bytes

  const zeroBytes16 = Buffer.alloc(16, 0)
  const zeroByteCheck = [
    [0, 16],
    [64, 80],
    [128, 144],
    [192, 208],
  ]

  const G2Array = []
  const FrArray = []

  for (let k = 0; k < inputData.length / 288; k++) {
    // zero bytes check
    const pairStart = 288 * k
    for (const index in zeroByteCheck) {
      const slicedBuffer = opts.data.slice(
        zeroByteCheck[index][0] + pairStart,
        zeroByteCheck[index][1] + pairStart
      )
      if (!slicedBuffer.equals(zeroBytes16)) {
        return EvmErrorResult(new EvmError(ERROR.BLS_12_381_POINT_NOT_ON_CURVE), opts.gasLimit)
      }
    }
    let G2
    try {
      G2 = BLS12_381_ToG2Point(opts.data.slice(pairStart, pairStart + 256), mcl)
    } catch (e: any) {
      return EvmErrorResult(e, opts.gasLimit)
    }
    const Fr = BLS12_381_ToFrPoint(opts.data.slice(pairStart + 256, pairStart + 288), mcl)

    G2Array.push(G2)
    FrArray.push(Fr)
  }

  const result = mcl.mulVec(G2Array, FrArray)

  const returnValue = BLS12_381_FromG2Point(result)

  return {
    executionGasUsed: gasUsed,
    returnValue,
  }
}
