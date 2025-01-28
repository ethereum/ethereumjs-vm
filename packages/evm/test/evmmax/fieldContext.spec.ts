import { bigIntToBytes, bytesToBigInt } from '@ethereumjs/util'
import { randomBytes } from 'crypto'
import { assert, describe, it } from 'vitest'

import { FieldContext } from '../../src/index.js'

function randomBigInt(size: number, limit: bigint): bigint {
  return bytesToBigInt(randomBytes(size)) % limit
}

function randomBinaryModulus(size: number): bigint {
  return 1n << BigInt(size * 8)
}

export function randomOddModulus(size: number): bigint {
  let num
  let bytes
  while (true) {
    bytes = randomBytes(size)
    num = bytesToBigInt(bytes)
    if (bytes[bytes.length - 1] % 2 !== 0) return num
  }
}

function padBigIntBytes(val: bigint, byteLen: number): Uint8Array {
  const raw = bigIntToBytes(val)
  if (raw.length === byteLen) return raw
  const out = new Uint8Array(byteLen)
  out.set(raw, byteLen - raw.length)
  return out
}

function testModulus(mod: bigint) {
  const modBytes = bigIntToBytes(mod)
  const fieldCtx = new FieldContext(modBytes, 256n)

  const xInt = randomBigInt(modBytes.length, mod)
  const yInt = randomBigInt(modBytes.length, mod)

  // const xInt = 170553633158n
  // const yInt = 832050944357n

  // convert operands to padded bytes for storing
  const elemByteLen = Number(fieldCtx.elemSize)
  const xBytes = padBigIntBytes(xInt, elemByteLen * 8)
  const yBytes = padBigIntBytes(yInt, elemByteLen * 8)
  const outBytes = new Uint8Array(elemByteLen * 8)

  // console.log('dbg200')
  // console.log(fieldCtx)
  // console.log(elemByteLen)
  // console.log(xInt)
  // console.log(xBytes)
  // console.log(yInt)
  // console.log(yBytes)
  // console.log(fieldCtx.scratchSpace.slice(0, 10))

  fieldCtx.store(1, 1, xBytes)

  // console.log('dbg201')
  // console.log(fieldCtx.scratchSpace.slice(0, 10))

  fieldCtx.store(2, 1, yBytes)

  // console.log('dbg202')
  // console.log(fieldCtx.scratchSpace.slice(0, 10))

  fieldCtx.addM(0, 1, 1, 1, 2, 1, 1)
  fieldCtx.Load(outBytes, 0, 1)
  const expectedAdd = (xInt + yInt) % mod
  const actualAdd = bytesToBigInt(outBytes)
  assert.deepEqual(actualAdd, expectedAdd)

  fieldCtx.subM(0, 1, 1, 1, 2, 1, 1)
  fieldCtx.Load(outBytes, 0, 1)
  let expectedSub = (xInt - yInt) % mod
  if (expectedSub < 0n) expectedSub += mod
  const actualSub = bytesToBigInt(outBytes)
  assert.deepEqual(actualSub, expectedSub)

  fieldCtx.mulM(0, 1, 1, 1, 2, 1, 1)

  // console.log('dbg203')
  // console.log(fieldCtx.scratchSpace.slice(0, 10))

  fieldCtx.Load(outBytes, 0, 1)
  const expectedMul = (xInt * yInt) % mod
  const actualMul = bytesToBigInt(outBytes)

  // console.log('dbg204')
  // console.log(actualMul)
  // console.log(expectedMul)
  // console.log(outBytes)

  assert.deepEqual(actualMul, expectedMul)
}

describe('FieldContext modular arithmetic', () => {
  for (let i = 1; i < 96; i++) {
    it(`should do add, sub, mul under a random modulus of size ${i} bytes`, () => {
      const binaryMod = randomBinaryModulus(i)
      testModulus(binaryMod)

      const oddMod = randomOddModulus(i)
      // const oddMod = 1050354439901n

      // console.log('dbg199')
      // console.log(oddMod)

      testModulus(oddMod)
    })
  }
})
