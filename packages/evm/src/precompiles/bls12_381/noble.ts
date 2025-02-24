import {
  BIGINT_0,
  bigIntToBytes,
  bytesToBigInt,
  concatBytes,
  equalsBytes,
  setLengthLeft,
} from '@ethereumjs/util'
import { bls12_381 } from '@noble/curves/bls12-381'

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
import type { Fp2 } from '@noble/curves/abstract/tower'
import type { AffinePoint } from '@noble/curves/abstract/weierstrass'

const G1_ZERO = bls12_381.G1.ProjectivePoint.ZERO
const G2_ZERO = bls12_381.G2.ProjectivePoint.ZERO

function BLS12_381_ToFp2Point(fpXCoordinate: Uint8Array, fpYCoordinate: Uint8Array) {
  // check if the coordinates are in the field
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

  const fpBytes = concatBytes(fpXCoordinate.subarray(16), fpYCoordinate.subarray(16))

  const FP = bls12_381.fields.Fp2.fromBytes(fpBytes)
  return FP
}

/**
 * Converts an Uint8Array to a Noble G1 point. Raises errors if the point is not on the curve
 * and (if activated) if the point is in the subgroup / order check.
 * @param input Input Uint8Array. Should be 128 bytes
 * @returns Noble G1 point
 */
function BLS12_381_ToG1Point(input: Uint8Array, verifyOrder = true) {
  if (equalsBytes(input, BLS_G1_INFINITY_POINT_BYTES) === true) {
    return G1_ZERO
  }

  const x = bytesToBigInt(input.subarray(16, BLS_G1_POINT_BYTE_LENGTH / 2))
  const y = bytesToBigInt(input.subarray(80, BLS_G1_POINT_BYTE_LENGTH))

  const G1 = bls12_381.G1.ProjectivePoint.fromAffine({
    x,
    y,
  })

  try {
    G1.assertValidity()
  } catch (e) {
    if (verifyOrder || (e as Error).message !== 'bad point: not in prime-order subgroup')
      throw new EVMError({
        code: EVMErrorCode.BLS_12_381_POINT_NOT_ON_CURVE,
      })
  }

  return G1
}

// input: a Noble G1 point
// output: a 128-byte Uint8Array
function BLS12_381_FromG1Point(input: AffinePoint<bigint>): Uint8Array {
  const xBytes = setLengthLeft(bigIntToBytes(input.x), 64)
  const yBytes = setLengthLeft(bigIntToBytes(input.y), 64)

  return concatBytes(xBytes, yBytes)
}

/**
 * Converts an Uint8Array to a Noble G2 point. Raises errors if the point is not on the curve
 * and (if activated) if the point is in the subgroup / order check.
 * @param input Input Uint8Array. Should be 256 bytes
 * @returns Noble G2 point
 */
function BLS12_381_ToG2Point(input: Uint8Array, verifyOrder = true) {
  if (equalsBytes(input, BLS_G2_INFINITY_POINT_BYTES) === true) {
    return G2_ZERO
  }

  const p_x_1 = input.subarray(0, 64)
  const p_x_2 = input.subarray(64, BLS_G2_POINT_BYTE_LENGTH / 2)
  const p_y_1 = input.subarray(128, 192)
  const p_y_2 = input.subarray(192, BLS_G2_POINT_BYTE_LENGTH)

  const Fp2X = BLS12_381_ToFp2Point(p_x_1, p_x_2)
  const Fp2Y = BLS12_381_ToFp2Point(p_y_1, p_y_2)

  const pG2 = bls12_381.G2.ProjectivePoint.fromAffine({
    x: Fp2X,
    y: Fp2Y,
  })

  try {
    pG2.assertValidity()
  } catch (e) {
    if (verifyOrder || (e as Error).message !== 'bad point: not in prime-order subgroup')
      throw new EVMError({
        code: EVMErrorCode.BLS_12_381_POINT_NOT_ON_CURVE,
      })
  }

  return pG2
}

// input: a Noble G1 point
// output: a 128-byte Uint8Array
function BLS12_381_FromG2Point(input: AffinePoint<Fp2>): Uint8Array {
  const xBytes1 = setLengthLeft(bigIntToBytes(input.x.c0), 64)
  const xBytes2 = setLengthLeft(bigIntToBytes(input.x.c1), 64)
  const yBytes1 = setLengthLeft(bigIntToBytes(input.y.c0), 64)
  const yBytes2 = setLengthLeft(bigIntToBytes(input.y.c1), 64)

  return concatBytes(xBytes1, xBytes2, yBytes1, yBytes2)
}

// input: a 32-byte hex scalar Uint8Array
// output: a Noble Fr point

function BLS12_381_ToFrPoint(input: Uint8Array): bigint {
  const Fr = bls12_381.fields.Fr.fromBytes(input)

  // TODO: This fixes the following two failing tests:
  // bls_g1mul_random*g1_unnormalized_scalar
  // bls_g1mul_random*p1_unnormalized_scalar
  // It should be nevertheless validated if this is (fully) correct,
  // especially if ">" or ">=" should be applied.
  //
  // Unfortunately the scalar in both test vectors is significantly
  // greater than the ORDER threshold, here are th values from both tests:
  //
  // Scalar / Order
  // 69732848789442042582239751384143889712113271203482973843852656394296700715236n
  // 52435875175126190479447740508185965837690552500527637822603658699938581184513n
  //
  // There should be 4 test cases added to the official test suite:
  // 1. bls_g1mul_random*g1_unnormalized_scalar within threshold (ORDER (?))
  // 2. bls_g1mul_random*g1_unnormalized_scalar outside threshold (ORDER + 1 (?))
  // 3. bls_g1mul_random*p1_unnormalized_scalar within threshold (ORDER (?))
  // 4. bls_g1mul_random*p1_unnormalized_scalar outside threshold (ORDER + 1 (?))
  //
  return bls12_381.fields.Fr.create(Fr)
}

// input: a 64-byte buffer
// output: a Noble Fp point

function BLS12_381_ToFpPoint(fpCoordinate: Uint8Array) {
  // check if point is in field
  if (bytesToBigInt(fpCoordinate) >= BLS_FIELD_MODULUS) {
    throw new EVMError({
      code: EVMErrorCode.BLS_12_381_FP_NOT_IN_FIELD,
    })
  }
  const FP = bls12_381.fields.Fp.fromBytes(fpCoordinate.slice(16))
  return FP
}

/**
 * Implementation of the `EVMBLSInterface` using the `ethereum-cryptography (`@noble/curves`)
 * JS library, see https://github.com/ethereum/js-ethereum-cryptography.
 *
 * This is the EVM default implementation.
 */
export class NobleBLS implements EVMBLSInterface {
  addG1(input: Uint8Array): Uint8Array {
    const p1 = BLS12_381_ToG1Point(input.subarray(0, BLS_G1_POINT_BYTE_LENGTH), false)
    const p2 = BLS12_381_ToG1Point(
      input.subarray(BLS_G1_POINT_BYTE_LENGTH, BLS_G1_POINT_BYTE_LENGTH * 2),
      false,
    )

    const p = p1.add(p2)
    const result = BLS12_381_FromG1Point(p)

    return result
  }

  mulG1(input: Uint8Array): Uint8Array {
    // convert input to G1 points, add them, and convert the output to a Uint8Array.
    const p = BLS12_381_ToG1Point(input.subarray(0, BLS_G1_POINT_BYTE_LENGTH))
    const scalar = BLS12_381_ToFrPoint(input.subarray(BLS_G1_POINT_BYTE_LENGTH, 160))

    if (scalar === BIGINT_0) {
      return BLS_G1_INFINITY_POINT_BYTES
    }
    const result = p.multiplyUnsafe(scalar)
    return BLS12_381_FromG1Point(result)
  }

  addG2(input: Uint8Array): Uint8Array {
    const p1 = BLS12_381_ToG2Point(input.subarray(0, BLS_G2_POINT_BYTE_LENGTH), false)
    const p2 = BLS12_381_ToG2Point(
      input.subarray(BLS_G2_POINT_BYTE_LENGTH, BLS_G2_POINT_BYTE_LENGTH * 2),
      false,
    )
    const p = p1.add(p2)
    const result = BLS12_381_FromG2Point(p)

    return result
  }

  mulG2(input: Uint8Array): Uint8Array {
    // convert input to G2 point/Fr point, add them, and convert the output to a Uint8Array.
    const p = BLS12_381_ToG2Point(input.subarray(0, BLS_G2_POINT_BYTE_LENGTH))
    const scalar = BLS12_381_ToFrPoint(input.subarray(BLS_G2_POINT_BYTE_LENGTH, 288))

    if (scalar === BIGINT_0) {
      return BLS_G2_INFINITY_POINT_BYTES
    }
    const result = p.multiplyUnsafe(scalar)
    return BLS12_381_FromG2Point(result)
  }

  mapFPtoG1(input: Uint8Array): Uint8Array {
    // convert input to Fp1 point
    const FP = BLS12_381_ToFpPoint(input.subarray(0, 64))
    const result = bls12_381.G1.mapToCurve([FP]).toAffine()
    const resultBytes = BLS12_381_FromG1Point(result)
    return resultBytes
  }

  mapFP2toG2(input: Uint8Array): Uint8Array {
    // convert input to Fp2 point
    const Fp2Point = BLS12_381_ToFp2Point(input.subarray(0, 64), input.subarray(64, 128))
    const result = bls12_381.G2.mapToCurve([Fp2Point.c0, Fp2Point.c1]).toAffine()
    const resultBytes = BLS12_381_FromG2Point(result)
    return resultBytes
  }

  msmG1(input: Uint8Array): Uint8Array {
    // Note: This implementation is using the naive "algorithm" of just doing
    // p1G1*v1F1 + p2G1*v1F1 + ... while the EIP is suggesting to use an optimized
    // algorithm (Pippenger's algorithm, see https://eips.ethereum.org/EIPS/eip-2537#g1g2-msm).
    //
    // While this functionally works the approach is not "gas-cost-competitive" and an
    // optimization should be considered in the future.
    const pairLength = 160
    const numPairs = input.length / pairLength

    let pRes = G1_ZERO
    for (let k = 0; k < numPairs; k++) {
      const pairStart = pairLength * k
      const G1 = BLS12_381_ToG1Point(
        input.subarray(pairStart, pairStart + BLS_G1_POINT_BYTE_LENGTH),
      )
      const Fr = BLS12_381_ToFrPoint(
        input.subarray(pairStart + BLS_G1_POINT_BYTE_LENGTH, pairStart + pairLength),
      )
      let pMul
      if (Fr === BIGINT_0) {
        pMul = G1_ZERO
      } else {
        pMul = G1.multiplyUnsafe(Fr)
      }

      pRes = pRes.add(pMul)
    }

    return BLS12_381_FromG1Point(pRes)
  }

  msmG2(input: Uint8Array): Uint8Array {
    // Note: This implementation is using the naive "algorithm" of just doing
    // p1G1*v1F1 + p2G1*v1F1 + ... while the EIP is suggesting to use an optimized
    // algorithm (Pippenger's algorithm, see https://eips.ethereum.org/EIPS/eip-2537#g1g2-msm).
    //
    // While this functionally works the approach is not "gas-cost-competitive" and an
    // optimization should be considered in the future.
    const pairLength = 288
    const numPairs = input.length / pairLength

    let pRes = G2_ZERO
    for (let k = 0; k < numPairs; k++) {
      const pairStart = pairLength * k
      const G2 = BLS12_381_ToG2Point(
        input.subarray(pairStart, pairStart + BLS_G2_POINT_BYTE_LENGTH),
      )
      const Fr = BLS12_381_ToFrPoint(
        input.subarray(pairStart + BLS_G2_POINT_BYTE_LENGTH, pairStart + pairLength),
      )
      let pMul
      if (Fr === BIGINT_0) {
        pMul = G2_ZERO
      } else {
        pMul = G2.multiplyUnsafe(Fr)
      }

      pRes = pRes.add(pMul)
    }

    return BLS12_381_FromG2Point(pRes)
  }

  pairingCheck(input: Uint8Array): Uint8Array {
    // Extract the pairs from the input
    const pairLength = 384
    const pairs = []
    for (let k = 0; k < input.length / pairLength; k++) {
      const pairStart = pairLength * k
      const G1 = BLS12_381_ToG1Point(
        input.subarray(pairStart, pairStart + BLS_G1_POINT_BYTE_LENGTH),
      )

      const g2start = pairStart + BLS_G1_POINT_BYTE_LENGTH
      const G2 = BLS12_381_ToG2Point(input.subarray(g2start, g2start + BLS_G2_POINT_BYTE_LENGTH))

      pairs.push({ g1: G1, g2: G2 })
    }

    // NOTE: check for point of infinity should happen only after all points parsed (in case they are malformed)
    for (const { g1, g2 } of pairs) {
      const _g2 = g2 as unknown as any
      // EIP: "If any input is the infinity point, pairing result will be 1"
      if (g1.equals(G1_ZERO) || (_g2.equals(G2_ZERO) as boolean)) {
        return BLS_ONE_BUFFER
      }
    }

    // @ts-ignore
    const FP12 = bls12_381.pairingBatch(pairs, true)

    if (bls12_381.fields.Fp12.eql(FP12, bls12_381.fields.Fp12.ONE)) {
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
