import {
  BIGINT_0,
  BIGINT_1,
  BIGINT_2,
  BIGINT_32,
  BIGINT_64,
  BIGINT_7,
  BIGINT_8,
  BIGINT_96,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  setLengthLeft,
  setLengthRight,
} from '@ethereumjs/util'

import { OOGResult } from '../evm.js'

import { gasLimitCheck } from './util.js'

import { getPrecompileName } from './index.js'

import type { ExecResult } from '../types.js'
import type { PrecompileInput } from './types.js'

const BIGINT_4 = BigInt(4)
const BIGINT_16 = BigInt(16)
const BIGINT_200 = BigInt(200)
const BIGINT_480 = BigInt(480)
const BIGINT_1024 = BigInt(1024)
const BIGINT_3072 = BigInt(3072)
const BIGINT_199680 = BigInt(199680)

const maxInt = BigInt(Number.MAX_SAFE_INTEGER)
const maxSize = BigInt(2147483647) // @ethereumjs/util setLengthRight limitation

function multiplicationComplexity(x: bigint): bigint {
  let fac1
  let fac2
  if (x <= BIGINT_64) {
    return x ** BIGINT_2
  } else if (x <= BIGINT_1024) {
    // return Math.floor(Math.pow(x, 2) / 4) + 96 * x - 3072
    fac1 = x ** BIGINT_2 / BIGINT_4
    fac2 = x * BIGINT_96
    return fac1 + fac2 - BIGINT_3072
  } else {
    // return Math.floor(Math.pow(x, 2) / 16) + 480 * x - 199680
    fac1 = x ** BIGINT_2 / BIGINT_16
    fac2 = x * BIGINT_480
    return fac1 + fac2 - BIGINT_199680
  }
}

function multiplicationComplexityEIP2565(x: bigint): bigint {
  const words = (x + BIGINT_7) / BIGINT_8
  return words * words
}

function getAdjustedExponentLength(data: Uint8Array): bigint {
  let expBytesStart
  try {
    const baseLen = bytesToBigInt(data.subarray(0, 32))
    expBytesStart = 96 + Number(baseLen) // 96 for base length, then exponent length, and modulus length, then baseLen for the base data, then exponent bytes start
  } catch {
    expBytesStart = Number.MAX_SAFE_INTEGER - 32
  }
  const expLen = bytesToBigInt(data.subarray(32, 64))
  let firstExpBytes = data.subarray(expBytesStart, expBytesStart + 32) // first word of the exponent data
  firstExpBytes = setLengthRight(firstExpBytes, 32) // reading past the data reads virtual zeros
  let firstExpBigInt = bytesToBigInt(firstExpBytes)
  let max32expLen = 0
  if (expLen < BIGINT_32) {
    max32expLen = 32 - Number(expLen)
  }
  firstExpBigInt = firstExpBigInt >> (BIGINT_8 * BigInt(Math.max(max32expLen, 0)))

  let bitLen = -1
  while (firstExpBigInt > BIGINT_0) {
    bitLen = bitLen + 1
    firstExpBigInt = firstExpBigInt >> BIGINT_1
  }
  let expLenMinus32OrZero = expLen - BIGINT_32
  if (expLenMinus32OrZero < BIGINT_0) {
    expLenMinus32OrZero = BIGINT_0
  }
  const eightTimesExpLenMinus32OrZero = expLenMinus32OrZero * BIGINT_8
  let adjustedExpLen = eightTimesExpLenMinus32OrZero
  if (bitLen > 0) {
    adjustedExpLen += BigInt(bitLen)
  }
  return adjustedExpLen
}

export function expMod(a: bigint, power: bigint, modulo: bigint) {
  if (power === BIGINT_0) {
    return BIGINT_1 % modulo
  }
  let res = BIGINT_1
  while (power > BIGINT_0) {
    if (power & BIGINT_1) res = (res * a) % modulo
    a = (a * a) % modulo
    power >>= BIGINT_1
  }
  return res
}

export function precompile05(opts: PrecompileInput): ExecResult {
  const pName = getPrecompileName('05')
  const data = opts.data.length < 96 ? setLengthRight(opts.data, 96) : opts.data

  let adjustedELen = getAdjustedExponentLength(data)
  if (adjustedELen < BIGINT_1) {
    adjustedELen = BIGINT_1
  }

  const bLen = bytesToBigInt(data.subarray(0, 32))
  const eLen = bytesToBigInt(data.subarray(32, 64))
  const mLen = bytesToBigInt(data.subarray(64, 96))

  let maxLen = bLen
  if (maxLen < mLen) {
    maxLen = mLen
  }
  const Gquaddivisor = opts.common.param('modexpGquaddivisorGas')
  let gasUsed

  const bStart = BIGINT_96
  const bEnd = bStart + bLen
  const eStart = bEnd
  const eEnd = eStart + eLen
  const mStart = eEnd
  const mEnd = mStart + mLen

  if (!opts.common.isActivatedEIP(2565)) {
    gasUsed = (adjustedELen * multiplicationComplexity(maxLen)) / Gquaddivisor
  } else {
    gasUsed = (adjustedELen * multiplicationComplexityEIP2565(maxLen)) / Gquaddivisor
    if (gasUsed < BIGINT_200) {
      gasUsed = BIGINT_200
    }
  }
  if (!gasLimitCheck(opts, gasUsed, pName)) {
    return OOGResult(opts.gasLimit)
  }

  if (bLen === BIGINT_0 && mLen === BIGINT_0) {
    return {
      executionGasUsed: gasUsed,
      returnValue: new Uint8Array(),
    }
  }

  if (bLen > maxSize || eLen > maxSize || mLen > maxSize) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: OOG`)
    }
    return OOGResult(opts.gasLimit)
  }

  if (mEnd > maxInt) {
    if (opts._debug !== undefined) {
      opts._debug(`${pName} failed: OOG`)
    }
    return OOGResult(opts.gasLimit)
  }

  const B = bytesToBigInt(setLengthRight(data.subarray(Number(bStart), Number(bEnd)), Number(bLen)))
  const E = bytesToBigInt(setLengthRight(data.subarray(Number(eStart), Number(eEnd)), Number(eLen)))
  const M = bytesToBigInt(setLengthRight(data.subarray(Number(mStart), Number(mEnd)), Number(mLen)))

  let R
  if (M === BIGINT_0) {
    R = new Uint8Array()
  } else {
    R = expMod(B, E, M)
    if (R === BIGINT_0) {
      R = new Uint8Array()
    } else {
      R = bigIntToBytes(R)
    }
  }

  const res = setLengthLeft(R, Number(mLen))
  if (opts._debug !== undefined) {
    opts._debug(`${pName} return value=${bytesToHex(res)}`)
  }

  return {
    executionGasUsed: gasUsed,
    returnValue: res,
  }
}
