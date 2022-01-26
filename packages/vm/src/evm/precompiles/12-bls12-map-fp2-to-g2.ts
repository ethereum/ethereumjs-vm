import { BN } from 'ethereumjs-util'
import { PrecompileInput } from './types'
import { VmErrorResult, ExecResult, OOGResult } from '../evm'
import { ERROR, VmError } from '../../exceptions'

const { BLS12_381_ToFp2Point, BLS12_381_FromG2Point } = require('./util/bls12_381')

export default async function (opts: PrecompileInput): Promise<ExecResult> {
  if (!opts.data) {
    throw new Error('opts.data is undefined')
  }

  const mcl = opts._VM._mcl

  const inputData = opts.data

  // note: the gas used is constant; even if the input is incorrect.
  const gasUsed = new BN(opts._common.paramByEIP('gasPrices', 'Bls12381MapG2Gas', 2537))

  if (opts.gasLimit.lt(gasUsed)) {
    return OOGResult(opts.gasLimit)
  }

  if (inputData.length != 128) {
    return VmErrorResult(new VmError(ERROR.BLS_12_381_INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  // check if some parts of input are zero bytes.
  const zeroBytes16 = Buffer.alloc(16, 0)
  const zeroByteCheck = [
    [0, 16],
    [64, 80],
  ]

  for (const index in zeroByteCheck) {
    const slicedBuffer = opts.data.slice(zeroByteCheck[index][0], zeroByteCheck[index][1])
    if (!slicedBuffer.equals(zeroBytes16)) {
      return VmErrorResult(new VmError(ERROR.BLS_12_381_POINT_NOT_ON_CURVE), opts.gasLimit)
    }
  }

  // convert input to mcl Fp2 point

  let Fp2Point
  try {
    Fp2Point = BLS12_381_ToFp2Point(opts.data.slice(0, 64), opts.data.slice(64, 128), mcl)
  } catch (e: any) {
    return VmErrorResult(e, opts.gasLimit)
  }
  // map it to G2
  const result = Fp2Point.mapToG2()

  const returnValue = BLS12_381_FromG2Point(result)

  return {
    gasUsed,
    returnValue: returnValue,
  }
}
