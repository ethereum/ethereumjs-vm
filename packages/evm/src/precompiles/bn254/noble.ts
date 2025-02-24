import {
  BIGINT_0,
  bigIntToBytes,
  bytesToBigInt,
  concatBytes,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
} from '@ethereumjs/util'
import { bn254 } from '@noble/curves/bn254'

import { EVMError, EVMErrorCode } from '../../errors.js'

import type { EVMBN254Interface } from '../../types.js'
import type { AffinePoint } from '@noble/curves/abstract/weierstrass'

const G1_INFINITY_POINT_BYTES = new Uint8Array(64)
const G2_INFINITY_POINT_BYTES = new Uint8Array(128)
const G1_POINT_BYTE_LENGTH = 64
const G1_ELEMENT_BYTE_LENGTH = 32
const G2_POINT_BYTE_LENGTH = 128

const ZERO_BUFFER = new Uint8Array(32)
const ONE_BUFFER = concatBytes(new Uint8Array(31), hexToBytes('0x01'))

/**
 * Converts an Uint8Array to a Noble G1 point.
 * @param input Input Uint8Array. Should be 64 bytes
 * @returns Noble G1 point
 */
function toG1Point(input: Uint8Array) {
  if (equalsBytes(input, G1_INFINITY_POINT_BYTES) === true) {
    return bn254.G1.ProjectivePoint.ZERO
  }

  const x = bytesToBigInt(input.subarray(0, G1_ELEMENT_BYTE_LENGTH))
  const y = bytesToBigInt(input.subarray(G1_ELEMENT_BYTE_LENGTH, G1_POINT_BYTE_LENGTH))

  const G1 = bn254.G1.ProjectivePoint.fromAffine({
    x,
    y,
  })
  G1.assertValidity()
  return G1
}

function fromG1Point(input: AffinePoint<bigint>): Uint8Array {
  const xBytes = setLengthLeft(bigIntToBytes(input.x), G1_ELEMENT_BYTE_LENGTH)
  const yBytes = setLengthLeft(bigIntToBytes(input.y), G1_ELEMENT_BYTE_LENGTH)

  return concatBytes(xBytes, yBytes)
}

// input: a 32-byte hex scalar Uint8Array
// output: a Noble Fr point

function toFrPoint(input: Uint8Array): bigint {
  const Fr = bn254.fields.Fr.fromBytes(input)
  if (Fr >= bn254.fields.Fr.ORDER) {
    return Fr % bn254.fields.Fr.ORDER
  }
  return Fr
}

function toFp2Point(fpXCoordinate: Uint8Array, fpYCoordinate: Uint8Array) {
  if (bytesToBigInt(fpXCoordinate) >= bn254.fields.Fp2.ORDER) {
    throw new EVMError({
      code: EVMErrorCode.BN254_FP_NOT_IN_FIELD,
    })
  }
  if (bytesToBigInt(fpYCoordinate) >= bn254.fields.Fp2.ORDER) {
    throw new EVMError({
      code: EVMErrorCode.BN254_FP_NOT_IN_FIELD,
    })
  }

  const fpBytes = concatBytes(fpXCoordinate, fpYCoordinate)

  const FP = bn254.fields.Fp2.fromBytes(fpBytes)
  return FP
}

/**
 * Converts an Uint8Array to a Noble G2 point. Raises errors if the point is not on the curve
 * and (if activated) if the point is in the subgroup / order check.
 * @param input Input Uint8Array. Should be 256 bytes
 * @returns Noble G2 point
 */
function toG2Point(input: Uint8Array) {
  if (equalsBytes(input, G2_INFINITY_POINT_BYTES) === true) {
    return bn254.G2.ProjectivePoint.ZERO
  }

  const p_x_2 = input.subarray(0, G1_ELEMENT_BYTE_LENGTH)
  const p_x_1 = input.subarray(G1_ELEMENT_BYTE_LENGTH, G1_ELEMENT_BYTE_LENGTH * 2)
  const start2 = G1_ELEMENT_BYTE_LENGTH * 2
  const p_y_2 = input.subarray(start2, start2 + G1_ELEMENT_BYTE_LENGTH)
  const p_y_1 = input.subarray(start2 + G1_ELEMENT_BYTE_LENGTH, start2 + G1_ELEMENT_BYTE_LENGTH * 2)

  for (const p of [p_x_1, p_x_2, p_y_1, p_y_2]) {
    const pB = bytesToBigInt(p)
    if (bn254.fields.Fp.create(pB) !== pB) {
      throw new EVMError({
        code: EVMErrorCode.BN254_FP_NOT_IN_FIELD,
      })
    }
  }

  const Fp2X = toFp2Point(p_x_1, p_x_2)
  const Fp2Y = toFp2Point(p_y_1, p_y_2)

  const pG2 = bn254.G2.ProjectivePoint.fromAffine({
    x: Fp2X,
    y: Fp2Y,
  })

  pG2.assertValidity()

  return pG2
}

/**
 * Implementation of the `EVMBN254Interface` using the `ethereum-cryptography (`@noble/curves`)
 * JS library, see https://github.com/ethereum/js-ethereum-cryptography.
 *
 * This is the EVM default implementation.
 */
export class NobleBN254 implements EVMBN254Interface {
  add(input: Uint8Array): Uint8Array {
    const p1 = toG1Point(input.slice(0, G1_POINT_BYTE_LENGTH))
    const p2 = toG1Point(input.slice(G1_POINT_BYTE_LENGTH, G1_POINT_BYTE_LENGTH * 2))

    const result = fromG1Point(p1.add(p2))
    return result
  }

  mul(input: Uint8Array): Uint8Array {
    const p1 = toG1Point(input.slice(0, G1_POINT_BYTE_LENGTH))
    const scalar = toFrPoint(input.slice(G1_POINT_BYTE_LENGTH, 96))

    if (scalar === BIGINT_0) {
      return G1_INFINITY_POINT_BYTES
    }

    const result = fromG1Point(p1.multiply(scalar))
    return result
  }
  pairing(input: Uint8Array): Uint8Array {
    // Extract the pairs from the input
    const pairLength = 192
    const pairs = []
    for (let k = 0; k < input.length / pairLength; k++) {
      const pairStart = pairLength * k
      const G1 = toG1Point(input.subarray(pairStart, pairStart + G1_POINT_BYTE_LENGTH))

      const g2start = pairStart + G1_POINT_BYTE_LENGTH
      const G2 = toG2Point(input.subarray(g2start, g2start + G2_POINT_BYTE_LENGTH))

      if (G1 === bn254.G1.ProjectivePoint.ZERO || G2 === bn254.G2.ProjectivePoint.ZERO) {
        continue
      }

      pairs.push({ g1: G1, g2: G2 })
    }

    const res = bn254.pairingBatch(pairs)
    if (bn254.fields.Fp12.eql(res, bn254.fields.Fp12.ONE) === true) {
      return ONE_BUFFER
    } else {
      return ZERO_BUFFER
    }
  }
}
