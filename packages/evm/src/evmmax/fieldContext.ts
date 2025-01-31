import { BIGINT_8, bigIntToBytes, bytesToBigInt, concatBytes } from '@ethereumjs/util'

import {
  addModBinary,
  addModPreset,
  bytesToLimbs,
  lt,
  mulModBinary,
  mulModPreset,
  negModInverse,
  putUint64BE,
  subModBinary,
  subModPreset,
} from './arith.js'

const MAX_MODULUS_SIZE = 96 // 768 bit max modulus width
const ZERO_BYTE = Uint8Array.from([0])

export function isModulusBinary(modulus: bigint): boolean {
  return modulus > 0n && (modulus & (modulus - 1n)) === 0n
}

export class FieldContext {
  public modulus: bigint[]
  public r2: bigint[] | undefined
  public modInvVal: bigint | undefined

  public useMontgomeryRepr: boolean
  public isModulusBinary: boolean

  public scratchSpace: bigint[]
  public addSubCost: bigint | undefined
  public mulCost: bigint | undefined

  public addMod: Function
  public subMod: Function
  public mulMod: Function

  public one: bigint[] | undefined
  public modulusInt: bigint
  public elemSize: bigint
  public scratchSpaceElemCount: bigint
  public outputWriteBuf: bigint[] | undefined

  constructor(modBytes: Uint8Array, scratchSize: bigint) {
    if (modBytes.length > MAX_MODULUS_SIZE) {
      throw new Error('modulus cannot be greater than 768 bits')
    }
    if (modBytes.length === 0) {
      throw new Error('modulus must be non-empty')
    }
    if (modBytes.subarray(0, 2) === ZERO_BYTE) {
      throw new Error('most significant byte of modulus must not be zero')
    }
    if (scratchSize === 0n) {
      throw new Error('scratch space must have non-zero size')
    }
    if (scratchSize > 256n) {
      throw new Error('scratch space can allocate a maximum of 256 field elements')
    }

    const mod = bytesToBigInt(modBytes)
    const paddedSize = BigInt(Math.ceil(modBytes.length / 8) * 8) // Compute paddedSize as the next multiple of 8 bytes

    if (isModulusBinary(mod)) {
      this.modulus = bytesToLimbs(modBytes)
      this.mulMod = mulModBinary
      this.addMod = addModBinary
      this.subMod = subModBinary
      this.scratchSpace = new Array<bigint>(Number((paddedSize / BIGINT_8) * scratchSize)).fill(0n)
      this.outputWriteBuf = new Array<bigint>(this.scratchSpace.length).fill(0n)
      this.scratchSpaceElemCount = BigInt(scratchSize)
      this.modulusInt = mod
      this.elemSize = paddedSize / 8n
      this.useMontgomeryRepr = false
      this.isModulusBinary = true

      return
    }

    if (modBytes.at(-1)! % 2 === 0) {
      throw new Error('modulus cannot be even')
    }

    const negModInv = negModInverse(mod)
    const paddedSizeBig = BigInt(paddedSize)
    const shiftAmount = paddedSizeBig * 16n
    const r2 = (1n << shiftAmount) % mod

    let r2Bytes = bigIntToBytes(r2)
    if (modBytes.length < paddedSize) {
      modBytes = concatBytes(new Uint8Array(Number(paddedSize) - modBytes.length), modBytes)
    }
    if (r2Bytes.length < paddedSize) {
      r2Bytes = concatBytes(new Uint8Array(Number(paddedSize) - r2Bytes.length), r2Bytes)
    }

    const one = new Array<bigint>(Number(paddedSize / BIGINT_8)).fill(0n)
    one[0] = 1n
    this.modulus = bytesToLimbs(modBytes)
    this.modInvVal = negModInv
    this.r2 = bytesToLimbs(r2Bytes)
    this.mulMod = mulModPreset[Number(paddedSize / 8n - 1n)]
    this.addMod = addModPreset[Number(paddedSize / 8n - 1n)]
    this.subMod = subModPreset[Number(paddedSize / 8n - 1n)]
    this.scratchSpace = new Array<bigint>(Number((paddedSize / BIGINT_8) * scratchSize)).fill(0n)
    this.outputWriteBuf = new Array<bigint>(this.scratchSpace.length).fill(0n) // TODO just globally define outputwritebuf like golang implementation
    this.scratchSpaceElemCount = BigInt(scratchSize)
    this.one = one
    this.modulusInt = mod
    this.elemSize = paddedSize / 8n
    this.useMontgomeryRepr = true
    this.isModulusBinary = false
  }

  store(dst: number, count: number, from: Uint8Array) {
    const elemSize = this.modulus.length

    for (let i = 0; i < count; i++) {
      const srcIdx = i * elemSize * 8
      const dstIdx = dst * elemSize + i * elemSize
      const srcBytes = from.slice(srcIdx, srcIdx + elemSize * 8)
      const val = bytesToLimbs(srcBytes)
      if (!lt(val, this.modulus)) throw new Error(`value being stored must be less than modulus`)
      if (this.useMontgomeryRepr) {
        const tmp = this.scratchSpace.slice(dstIdx + elemSize)
        this.mulMod(tmp, val, this.r2, this.modulus, this.modInvVal)
        for (let i = 0; i < elemSize; i++) {
          this.scratchSpace[dstIdx + i] = tmp[i]
        }
      } else {
        for (let i = 0; i < elemSize; i++) {
          this.scratchSpace[dstIdx + i] = val[i]
        }
      }
    }
  }

  /**
   * Load 'count' field elements from this.scratchSpace (starting at index 'from')
   * into the provided 'dst' Uint8Array.
   */
  public Load(dst: Uint8Array, from: number, count: number): void {
    const elemSize = this.modulus.length
    let dstIdx = 0

    for (let srcIdx = from; srcIdx < from + count; srcIdx++) {
      // temp array to hold limbs
      const res = new Array<bigint>(elemSize)

      // console.log('dbg205')
      // console.log(res)
      // console.log(this.scratchSpace)
      // console.log(this.one)
      // console.log(this.modulus)
      // console.log(this.modInvVal)
      // console.log()

      if (this.useMontgomeryRepr) {
        this.mulMod(
          res,
          this.scratchSpace.slice(srcIdx * elemSize, (srcIdx + 1) * elemSize),
          this.one,
          this.modulus,
          this.modInvVal,
        )
      } else {
        // Directly copy from scratchSpace
        const slice = this.scratchSpace.slice(srcIdx * elemSize, (srcIdx + 1) * elemSize)
        for (let i = 0; i < elemSize; i++) {
          res[i] = slice[i]
        }
      }

      // Write res[] into 'dst'
      for (let i = 0; i < elemSize; i++) {
        const limb = res[elemSize - 1 - i]
        putUint64BE(dst, dstIdx + i * 8, limb)
      }
      dstIdx += elemSize * 8
    }
  }

  /**
   * MulMod computes 'count' modular multiplications, pairwise multiplying values
   * from offsets [x, x+xStride, x+xStride*2, ..., x+xStride*(count - 1)]
   * and [y, y+yStride, y+yStride*2, ..., y+yStride*(count - 1)]
   * placing the result in [out, out+outStride, out+outStride*2, ..., out+outStride*(count - 1)].
   */
  public mulM(
    outIndex: number,
    outStride: number,
    x: number,
    xStride: number,
    y: number,
    yStride: number,
    count: number,
  ): void {
    const elemSize = this.modulus.length

    // perform the multiplications, writing into outputWriteBuf
    for (let i = 0; i < count; i++) {
      const xSrc = (x + i * xStride) * elemSize
      const ySrc = (y + i * yStride) * elemSize
      const dst = (outIndex + i * outStride) * elemSize

      const xSlice = this.scratchSpace.slice(xSrc, xSrc + elemSize)
      const ySlice = this.scratchSpace.slice(ySrc, ySrc + elemSize)

      const outSlice = this.outputWriteBuf!.slice(dst, dst + elemSize)

      this.mulMod(outSlice, xSlice, ySlice, this.modulus, this.modInvVal)

      for (let j = 0; j < elemSize; j++) {
        this.outputWriteBuf![dst + j] = outSlice[j]
      }
    }

    // copy the result from outputWriteBuf into scratchSpace
    for (let i = 0; i < count; i++) {
      const offset = (outIndex + i * outStride) * elemSize
      for (let j = 0; j < elemSize; j++) {
        this.scratchSpace[offset + j] = this.outputWriteBuf![offset + j]
      }
    }
  }

  /**
   * SubMod computes 'count' modular subtractions, pairwise subtracting values
   * at offsets [x, x+xStride, ..., x+xStride*(count - 1)] and
   * [y, y+yStride, ..., y+yStride*(count - 1)]
   * placing the result in [out, out+outStride, ...].
   */
  public subM(
    outIndex: number,
    outStride: number,
    x: number,
    xStride: number,
    y: number,
    yStride: number,
    count: number,
  ): void {
    const elemSize = this.modulus.length

    // perform the subtractions into outputWriteBuf
    for (let i = 0; i < count; i++) {
      const xSrc = (x + i * xStride) * elemSize
      const ySrc = (y + i * yStride) * elemSize
      const dst = (outIndex + i * outStride) * elemSize

      const xSlice = this.scratchSpace.slice(xSrc, xSrc + elemSize)
      const ySlice = this.scratchSpace.slice(ySrc, ySrc + elemSize)
      const outSlice = this.outputWriteBuf!.slice(dst, dst + elemSize)

      this.subMod(outSlice, xSlice, ySlice, this.modulus)

      for (let j = 0; j < elemSize; j++) {
        this.outputWriteBuf![dst + j] = outSlice[j]
      }
    }

    // copy from outputWriteBuf into scratchSpace
    for (let i = 0; i < count; i++) {
      const offset = (outIndex + i * outStride) * elemSize
      for (let j = 0; j < elemSize; j++) {
        this.scratchSpace[offset + j] = this.outputWriteBuf![offset + j]
      }
    }
  }

  /**
   * AddMod computes 'count' modular additions, pairwise adding values
   * at offsets [x, x+xStride, ..., x+xStride*(count - 1)] and
   * [y, y+yStride, ..., y+yStride*(count - 1)]
   * placing the result in [out, out+outStride, ...].
   */
  public addM(
    outIndex: number,
    outStride: number,
    x: number,
    xStride: number,
    y: number,
    yStride: number,
    count: number,
  ): void {
    const elemSize = Number(this.elemSize)

    // perform the additions, writing to outputWriteBuf
    for (let i = 0; i < count; i++) {
      const xSrc = (x + i * xStride) * elemSize
      const ySrc = (y + i * yStride) * elemSize
      const dst = (outIndex + i * outStride) * elemSize

      const xSlice = this.scratchSpace.slice(xSrc, xSrc + elemSize)
      const ySlice = this.scratchSpace.slice(ySrc, ySrc + elemSize)
      const outSlice = this.outputWriteBuf!.slice(dst, dst + elemSize)

      this.addMod(outSlice, xSlice, ySlice, this.modulus)

      for (let j = 0; j < elemSize; j++) {
        this.outputWriteBuf![dst + j] = outSlice[j]
      }
    }

    // copy from outputWriteBuf into scratchSpace
    for (let i = 0; i < count; i++) {
      const offset = (outIndex + i * outStride) * elemSize
      for (let j = 0; j < elemSize; j++) {
        this.scratchSpace[offset + j] = this.outputWriteBuf![offset + j]
      }
    }
  }
}
