import {
  bytesToBigInt,
  bytesToUnprefixedHex,
  concatBytes,
  equalsBytes,
  setLengthLeft,
  unprefixedHexToBytes,
} from '@ethereumjs/util'

import { EVMError, EVMErrorCode } from '../../errors.js'

import {
  BLS_FIELD_MODULUS,
  BLS_G1_INFINITY_POINT_BYTES,
  BLS_G1_POINT_BYTE_LENGTH,
  BLS_G2_INFINITY_POINT_BYTES,
  BLS_G2_POINT_BYTE_LENGTH,
  BLS_ONE_BUFFER,
  BLS_ZERO_BUFFER,
} from './constants.js'

import type { EVMBLSInterface } from '../../types.js'

/**
 * Converts an Uint8Array to a MCL G1 point. Raises errors if the point is not on the curve
 * and (if activated) if the point is in the subgroup / order check.
 * @param input Input Uint8Array. Should be 128 bytes
 * @param mcl MCL instance
 * @param verifyOrder Perform the subgroup check (defaults to true)
 * @returns MCL G1 point
 */
function BLS12_381_ToG1Point(input: Uint8Array, mcl: any, verifyOrder = true): any {
  if (equalsBytes(input, BLS_G1_INFINITY_POINT_BYTES)) {
    return new mcl.G1()
  }

  const p_x = bytesToUnprefixedHex(input.subarray(16, BLS_G1_POINT_BYTE_LENGTH / 2))
  const p_y = bytesToUnprefixedHex(input.subarray(80, BLS_G1_POINT_BYTE_LENGTH))

  const G1 = new mcl.G1()

  const Fp_X = new mcl.Fp()
  const Fp_Y = new mcl.Fp()
  const One = new mcl.Fp()

  Fp_X.setStr(p_x, 16)
  Fp_Y.setStr(p_y, 16)
  One.setStr('1', 16)

  G1.setX(Fp_X)
  G1.setY(Fp_Y)
  G1.setZ(One)

  mcl.verifyOrderG1(verifyOrder)
  if (verifyOrder && G1.isValidOrder() === false) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_POINT_NOT_ON_CURVE,
    })
  }

  // Check if these coordinates are actually on the curve.
  if (G1.isValid() === false) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_POINT_NOT_ON_CURVE,
    })
  }

  return G1
}

// input: a mcl G1 point
// output: a 128-byte Uint8Array
function BLS12_381_FromG1Point(input: any): Uint8Array {
  // TODO: figure out if there is a better way to decode these values.
  const decodeStr = input.getStr(16) //return a string of pattern "1 <x_coord> <y_coord>"
  const decoded = decodeStr.match(/"?[0-9a-f]+"?/g) // match above pattern.

  if (decodeStr === '0') {
    return new Uint8Array(BLS_G1_POINT_BYTE_LENGTH)
  }

  const xBytes = setLengthLeft(unprefixedHexToBytes(decoded[1]), 64)
  const yBytes = setLengthLeft(unprefixedHexToBytes(decoded[2]), 64)

  return concatBytes(xBytes, yBytes)
}

// input: two 64-byte buffers
// output: a mcl Fp2 point

function BLS12_381_ToFp2Point(fpXCoordinate: Uint8Array, fpYCoordinate: Uint8Array, mcl: any): any {
  // check if the coordinates are in the field
  if (bytesToBigInt(fpXCoordinate) >= BLS_FIELD_MODULUS) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_FP_NOT_IN_FIELD,
    })
  }
  if (bytesToBigInt(fpYCoordinate) >= BLS_FIELD_MODULUS) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_FP_NOT_IN_FIELD,
    })
  }

  const fp_x = new mcl.Fp()
  const fp_y = new mcl.Fp()

  const fp2 = new mcl.Fp2()
  fp_x.setStr(bytesToUnprefixedHex(fpXCoordinate.subarray(16)), 16)
  fp_y.setStr(bytesToUnprefixedHex(fpYCoordinate.subarray(16)), 16)

  fp2.set_a(fp_x)
  fp2.set_b(fp_y)

  return fp2
}

/**
 * Converts an Uint8Array to a MCL G2 point. Raises errors if the point is not on the curve
 * and (if activated) if the point is in the subgroup / order check.
 * @param input Input Uint8Array. Should be 256 bytes
 * @param mcl MCL instance
 * @param verifyOrder Perform the subgroup check (defaults to true)
 * @returns MCL G2 point
 */
function BLS12_381_ToG2Point(input: Uint8Array, mcl: any, verifyOrder = true): any {
  if (equalsBytes(input, BLS_G2_INFINITY_POINT_BYTES)) {
    return new mcl.G2()
  }

  const p_x_1 = input.subarray(0, 64)
  const p_x_2 = input.subarray(64, BLS_G2_POINT_BYTE_LENGTH / 2)
  const p_y_1 = input.subarray(128, 192)
  const p_y_2 = input.subarray(192, BLS_G2_POINT_BYTE_LENGTH)

  const Fp2X = BLS12_381_ToFp2Point(p_x_1, p_x_2, mcl)
  const Fp2Y = BLS12_381_ToFp2Point(p_y_1, p_y_2, mcl)

  const FpOne = new mcl.Fp()
  FpOne.setStr('1', 16)

  const FpZero = new mcl.Fp()
  FpZero.setStr('0', 16)

  const Fp2One = new mcl.Fp2()

  Fp2One.set_a(FpOne)
  Fp2One.set_b(FpZero)

  const p = new mcl.G2()

  p.setX(Fp2X)
  p.setY(Fp2Y)
  p.setZ(Fp2One)

  mcl.verifyOrderG2(verifyOrder)
  if (verifyOrder && p.isValidOrder() === false) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_POINT_NOT_ON_CURVE,
    })
  }

  if (p.isValid() === false) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_POINT_NOT_ON_CURVE,
    })
  }

  return p
}

// input: a mcl G2 point
// output: a 256-byte Uint8Array
function BLS12_381_FromG2Point(input: any): Uint8Array {
  // TODO: figure out if there is a better way to decode these values.
  const decodeStr = input.getStr(16) //return a string of pattern "1 <x_coord_1> <x_coord_2> <y_coord_1> <y_coord_2>"
  if (decodeStr === '0') {
    return new Uint8Array(BLS_G2_POINT_BYTE_LENGTH)
  }
  const decoded = decodeStr.match(/"?[0-9a-f]+"?/g) // match above pattern.

  const xBytes1 = setLengthLeft(unprefixedHexToBytes(decoded[1]), 64)
  const xBytes2 = setLengthLeft(unprefixedHexToBytes(decoded[2]), 64)
  const yBytes1 = setLengthLeft(unprefixedHexToBytes(decoded[3]), 64)
  const yBytes2 = setLengthLeft(unprefixedHexToBytes(decoded[4]), 64)

  return concatBytes(xBytes1, xBytes2, yBytes1, yBytes2)
}

// input: a 32-byte hex scalar Uint8Array
// output: a mcl Fr point

function BLS12_381_ToFrPoint(input: Uint8Array, mcl: any): any {
  const mclHex = mcl.fromHexStr(bytesToUnprefixedHex(input))
  const Fr = new mcl.Fr()
  Fr.setBigEndianMod(mclHex)
  return Fr
}

// input: a 64-byte buffer
// output: a mcl Fp point

function BLS12_381_ToFpPoint(fpCoordinate: Uint8Array, mcl: any): any {
  // check if point is in field
  if (bytesToBigInt(fpCoordinate) >= BLS_FIELD_MODULUS) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_FP_NOT_IN_FIELD,
    })
  }

  const fp = new mcl.Fp()

  fp.setBigEndianMod(mcl.fromHexStr(bytesToUnprefixedHex(fpCoordinate)))

  return fp
}

/**
 * Implementation of the `EVMBLSInterface` using the `mcl-wasm` WASM `mcl` wrapper library,
 * see https://github.com/herumi/mcl-wasm.
 *
 * This can be optionally used to replace the build-in Noble implementation (`NobleBLS`) with
 * a more performant WASM variant. See EVM `bls` constructor option on how to use.
 */
export class MCLBLS implements EVMBLSInterface {
  protected readonly _mcl: any

  constructor(mcl: any) {
    this._mcl = mcl
  }

  init() {
    this._mcl.setMapToMode(this._mcl.IRTF) // set the right map mode; otherwise mapToG2 will return wrong values.
    this._mcl.verifyOrderG1(true) // subgroup checks for G1
    this._mcl.verifyOrderG2(true) // subgroup checks for G2
  }

  addG1(input: Uint8Array): Uint8Array {
    // convert input to G1 points, add them, and convert the output to a Uint8Array.
    const p1 = BLS12_381_ToG1Point(input.subarray(0, BLS_G1_POINT_BYTE_LENGTH), this._mcl, false)
    const p2 = BLS12_381_ToG1Point(
      input.subarray(BLS_G1_POINT_BYTE_LENGTH, BLS_G1_POINT_BYTE_LENGTH * 2),
      this._mcl,
      false,
    )

    const result = this._mcl.add(p1, p2)

    return BLS12_381_FromG1Point(result)
  }

  mulG1(input: Uint8Array): Uint8Array {
    // convert input to G1 points, add them, and convert the output to a Uint8Array.
    const p = BLS12_381_ToG1Point(input.subarray(0, BLS_G1_POINT_BYTE_LENGTH), this._mcl)
    const frPoint = BLS12_381_ToFrPoint(input.subarray(BLS_G1_POINT_BYTE_LENGTH, 160), this._mcl)

    const result = this._mcl.mul(p, frPoint)

    return BLS12_381_FromG1Point(result)
  }

  addG2(input: Uint8Array): Uint8Array {
    // convert input to G1 points, add them, and convert the output to a Uint8Array.
    const p1 = BLS12_381_ToG2Point(input.subarray(0, BLS_G2_POINT_BYTE_LENGTH), this._mcl, false)
    const p2 = BLS12_381_ToG2Point(
      input.subarray(BLS_G2_POINT_BYTE_LENGTH, BLS_G2_POINT_BYTE_LENGTH * 2),
      this._mcl,
      false,
    )

    const result = this._mcl.add(p1, p2)

    return BLS12_381_FromG2Point(result)
  }

  mulG2(input: Uint8Array): Uint8Array {
    // convert input to G2 point/Fr point, add them, and convert the output to a Uint8Array.
    const p = BLS12_381_ToG2Point(input.subarray(0, BLS_G2_POINT_BYTE_LENGTH), this._mcl)
    const frPoint = BLS12_381_ToFrPoint(input.subarray(BLS_G2_POINT_BYTE_LENGTH, 288), this._mcl)

    const result = this._mcl.mul(p, frPoint)

    return BLS12_381_FromG2Point(result)
  }

  mapFPtoG1(input: Uint8Array): Uint8Array {
    // convert input to Fp1 point
    const Fp1Point = BLS12_381_ToFpPoint(input.subarray(0, 64), this._mcl)
    // map it to G1
    const result = Fp1Point.mapToG1()

    return BLS12_381_FromG1Point(result)
  }

  mapFP2toG2(input: Uint8Array): Uint8Array {
    // convert input to Fp2 point
    const Fp2Point = BLS12_381_ToFp2Point(input.subarray(0, 64), input.subarray(64, 128), this._mcl)
    // map it to G2
    const result = Fp2Point.mapToG2()

    return BLS12_381_FromG2Point(result)
  }

  msmG1(input: Uint8Array): Uint8Array {
    const pairLength = 160
    const numPairs = input.length / pairLength
    const G1Array = []
    const FrArray = []

    for (let k = 0; k < numPairs; k++) {
      const pairStart = pairLength * k
      const G1 = BLS12_381_ToG1Point(
        input.subarray(pairStart, pairStart + BLS_G1_POINT_BYTE_LENGTH),
        this._mcl,
      )
      const Fr = BLS12_381_ToFrPoint(
        input.subarray(pairStart + BLS_G1_POINT_BYTE_LENGTH, pairStart + pairLength),
        this._mcl,
      )

      G1Array.push(G1)
      FrArray.push(Fr)
    }

    const result = this._mcl.mulVec(G1Array, FrArray)

    return BLS12_381_FromG1Point(result)
  }

  msmG2(input: Uint8Array): Uint8Array {
    const pairLength = 288
    const numPairs = input.length / pairLength
    const G2Array = []
    const FrArray = []

    for (let k = 0; k < numPairs; k++) {
      const pairStart = pairLength * k
      const G2 = BLS12_381_ToG2Point(
        input.subarray(pairStart, pairStart + BLS_G2_POINT_BYTE_LENGTH),
        this._mcl,
      )
      const Fr = BLS12_381_ToFrPoint(
        input.subarray(pairStart + BLS_G2_POINT_BYTE_LENGTH, pairStart + pairLength),
        this._mcl,
      )

      G2Array.push(G2)
      FrArray.push(Fr)
    }

    const result = this._mcl.mulVec(G2Array, FrArray)
    return BLS12_381_FromG2Point(result)
  }

  pairingCheck(input: Uint8Array): Uint8Array {
    const pairLength = 384
    const pairs = []
    for (let k = 0; k < input.length / pairLength; k++) {
      const pairStart = pairLength * k
      const G1 = BLS12_381_ToG1Point(
        input.subarray(pairStart, pairStart + BLS_G1_POINT_BYTE_LENGTH),
        this._mcl,
      )

      const g2start = pairStart + BLS_G1_POINT_BYTE_LENGTH
      const G2 = BLS12_381_ToG2Point(
        input.subarray(g2start, g2start + BLS_G2_POINT_BYTE_LENGTH),
        this._mcl,
      )

      pairs.push([G1, G2])
    }

    // run the pairing check
    // reference (Nethermind): https://github.com/NethermindEth/nethermind/blob/374b036414722b9c8ad27e93d64840b8f63931b9/src/Nethermind/Nethermind.Evm/Precompiles/Bls/Mcl/PairingPrecompile.cs#L93
    let GT
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index]
      const G1 = pair[0]
      const G2 = pair[1]

      if (index === 0) {
        GT = this._mcl.millerLoop(G1, G2)
      } else {
        GT = this._mcl.mul(GT, this._mcl.millerLoop(G1, G2))
      }
    }

    GT = this._mcl.finalExp(GT)

    if (GT.isOne() === true) {
      return BLS_ONE_BUFFER
    } else {
      return BLS_ZERO_BUFFER
    }
  }
}

export {
  BLS12_381_FromG1Point,
  BLS12_381_FromG2Point,
  BLS12_381_ToFp2Point,
  BLS12_381_ToFpPoint,
  BLS12_381_ToFrPoint,
  BLS12_381_ToG1Point,
  BLS12_381_ToG2Point,
}
