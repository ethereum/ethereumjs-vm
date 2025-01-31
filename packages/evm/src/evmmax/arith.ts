const MASK_64 = (1n << 64n) - 1n

export function putUint64BE(dst: Uint8Array, offset: number, value: bigint): void {
  value = BigInt.asUintN(64, value)
  const hex = value.toString(16).padStart(16, '0')
  for (let i = 0; i < 8; i++) {
    dst[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
}

export function negModInverse(mod: bigint): bigint {
  let k0 = (2n - mod) & MASK_64
  let t = (mod - 1n) & MASK_64

  for (let i = 1; i < 64; i <<= 1) {
    t = (t * t) & MASK_64
    k0 = (k0 * ((t + 1n) & MASK_64)) & MASK_64
  }
  k0 = -k0 & MASK_64

  return k0
}

export function bytesToLimbs(b: Uint8Array): bigint[] {
  const wordCount = Math.ceil(b.length / 8)
  const paddedSize = wordCount * 8

  const paddedBytes = new Uint8Array(paddedSize)
  paddedBytes.set(b, paddedSize - b.length)

  const limbs: bigint[] = new Array(wordCount)

  // Extract each 64-bit word in big-endian order
  for (let i = 0; i < wordCount; i++) {
    const offset = i * 8
    // Construct the 64-bit limb as a bigint
    const limb =
      (BigInt(paddedBytes[offset]) << 56n) |
      (BigInt(paddedBytes[offset + 1]) << 48n) |
      (BigInt(paddedBytes[offset + 2]) << 40n) |
      (BigInt(paddedBytes[offset + 3]) << 32n) |
      (BigInt(paddedBytes[offset + 4]) << 24n) |
      (BigInt(paddedBytes[offset + 5]) << 16n) |
      (BigInt(paddedBytes[offset + 6]) << 8n) |
      BigInt(paddedBytes[offset + 7])
    limbs[i] = limb
  }

  // Reverse the limbs to get little-endian
  limbs.reverse()

  return limbs
}

function limbsToBytes(limbs: bigint[]): Uint8Array {
  const limbCount = limbs.length
  const result = new Uint8Array(limbCount * 8)

  for (let i = 0; i < limbCount; i++) {
    const limb = limbs[limbCount - 1 - i]
    // Extract 8 bytes in big-endian order
    const offset = i * 8
    result[offset] = Number((limb >> 56n) & 0xffn)
    result[offset + 1] = Number((limb >> 48n) & 0xffn)
    result[offset + 2] = Number((limb >> 40n) & 0xffn)
    result[offset + 3] = Number((limb >> 32n) & 0xffn)
    result[offset + 4] = Number((limb >> 24n) & 0xffn)
    result[offset + 5] = Number((limb >> 16n) & 0xffn)
    result[offset + 6] = Number((limb >> 8n) & 0xffn)
    result[offset + 7] = Number(limb & 0xffn)
  }

  // Remove leading zeros
  let firstNonZero = 0
  while (firstNonZero < result.length && result[firstNonZero] === 0) {
    firstNonZero++
  }

  return firstNonZero === result.length ? new Uint8Array([0]) : result.slice(firstNonZero)
}

function limbsToInt(limbs: bigint[]): bigint {
  const numBytes = limbsToBytes(limbs)
  return uint8ArrayToBigint(numBytes)
}

// Helper function to convert a Uint8Array (big-endian) to bigint
function uint8ArrayToBigint(arr: Uint8Array): bigint {
  if (arr.length === 0) return 0n
  const hex = '0x' + Array.from(arr, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return BigInt(hex)
}

function placeBEBytesInOutput(out: bigint[], b: Uint8Array): void {
  const padded = new Uint8Array(out.length * 8)
  padded.set(b, padded.length - b.length)

  const resultLimbs = out.length
  for (let i = 0; i < resultLimbs; i++) {
    const offset = i * 8
    let limb = 0n
    limb |= BigInt(padded[offset]) << 56n
    limb |= BigInt(padded[offset + 1]) << 48n
    limb |= BigInt(padded[offset + 2]) << 40n
    limb |= BigInt(padded[offset + 3]) << 32n
    limb |= BigInt(padded[offset + 4]) << 24n
    limb |= BigInt(padded[offset + 5]) << 16n
    limb |= BigInt(padded[offset + 6]) << 8n
    limb |= BigInt(padded[offset + 7])

    out[resultLimbs - 1 - i] = limb
  }
}

function intToBEBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array([0])
  let hex = value.toString(16)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
  }
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return arr
}

export function mulModBinary(z: bigint[], x: bigint[], y: bigint[], modulus: bigint[]) {
  const X = limbsToInt(x)
  const Y = limbsToInt(y)
  const M = limbsToInt(modulus)

  const result = (X * Y) % M
  const resultBytes = intToBEBytes(result)
  placeBEBytesInOutput(z, resultBytes)
}

export function addModBinary(z: bigint[], x: bigint[], y: bigint[], modulus: bigint[]) {
  const X = limbsToInt(x)
  const Y = limbsToInt(y)
  const M = limbsToInt(modulus)

  const result = (X + Y) % M
  const resultBytes = intToBEBytes(result)
  placeBEBytesInOutput(z, resultBytes)
}

export function subModBinary(z: bigint[], x: bigint[], y: bigint[], modulus: bigint[]) {
  const X = limbsToInt(x)
  const Y = limbsToInt(y)
  const M = limbsToInt(modulus)

  let result = (X - Y) % M
  if (result < 0n) {
    result += M
  }
  const resultBytes = intToBEBytes(result)
  placeBEBytesInOutput(z, resultBytes)
}

export function lt(x: bigint[], y: bigint[]): boolean {
  for (let i = x.length; i > 0; i--) {
    if (x[i - 1] < y[i - 1]) {
      return true
    }
  }
  return false
}

////  odd modulus arithmetic

function mul64(a: bigint, b: bigint): [bigint, bigint] {
  // console.log('dbg100')
  // console.log(a)
  // console.log(b)
  const product = a * b
  const lo = product & MASK_64
  const hi = product >> 64n
  return [hi, lo]
}

function add64(x: bigint, y: bigint, carryIn: bigint): [bigint, bigint] {
  const sum = x + y + carryIn
  const low = sum & MASK_64
  const carryOut = sum >> 64n
  return [low, carryOut]
}

function sub64(x: bigint, y: bigint, borrowIn: bigint): [bigint, bigint] {
  let diff = x - y - borrowIn
  let borrowOut = 0n
  if (diff < 0n) {
    diff &= MASK_64
    borrowOut = 1n
  }
  return [diff & MASK_64, borrowOut]
}

function madd0(a: bigint, b: bigint, c: bigint): bigint {
  const [hi, lo] = mul64(a, b)
  const sum = lo + c
  const carry = sum >> 64n
  const newHi = (hi + carry) & MASK_64
  return newHi
}

function madd1(a: bigint, b: bigint, c: bigint): [bigint, bigint] {
  const [hi, lo] = mul64(a, b)
  const [lo2, carry] = add64(lo, c, 0n)
  const [hi2, _carry2] = add64(hi, 0n, carry)
  return [hi2 & MASK_64, lo2 & MASK_64]
}

function madd2(a: bigint, b: bigint, c: bigint, d: bigint): [bigint, bigint] {
  const [hi, lo] = mul64(a, b)
  const [c2, carry] = add64(c, d, 0n)
  const [hi2, _carry2] = add64(hi, 0n, carry)
  const [lo2, carry2] = add64(lo, c2, 0n)
  const [hi3, _carry3] = add64(hi2, 0n, carry2)
  return [hi3 & MASK_64, lo2 & MASK_64]
}

function montMulMod64(
  z: bigint[],
  x: bigint[],
  y: bigint[],
  modulus: bigint[],
  modInv: bigint,
): void {
  // console.log('dbg102')

  const x0 = x[0] & MASK_64
  const y0 = y[0] & MASK_64
  const m0 = modulus[0] & MASK_64
  const inv = modInv & MASK_64

  let t0 = 0n
  let t1 = 0n

  let D = 0n
  let C = 0n
  let m = 0n

  let res = 0n

  // console.log('dbg103')
  // console.log(x0)
  // console.log(y0)
  // console.log(m0)
  // console.log(t0)
  // console.log(t1)
  // console.log(C)
  // console.log(D)

  {
    const [carryMul, lowMul] = mul64(x0, y0)
    C = carryMul
    t0 = lowMul
  }

  {
    const [sumLow, carryOut] = add64(t1, C, 0n)
    t1 = sumLow
    D = carryOut
  }

  m = (t0 * inv) & MASK_64

  // console.log('dbg104')
  // console.log(x0)
  // console.log(y0)
  // console.log(m)
  // console.log(t0)
  // console.log(t1)
  // console.log(C)
  // console.log(D)

  {
    const C = madd0(m, m0, t0)
    {
      const [sumLow, carryOut] = add64(t1, C, 0n)
      t0 = sumLow
      var newC = carryOut
    }

    {
      const [sumLow2, carryOut2] = add64(0n, D, newC)
      t1 = sumLow2
    }
  }

  {
    const [diff, borrow] = sub64(t0, m0, 0n)
    res = diff
    D = borrow
  }

  let src: bigint
  if (D !== 0n && t1 === 0n) {
    src = t0
  } else {
    src = res
  }

  z[0] = src & MASK_64
}

export function montMulMod128(
  out: bigint[],
  x: bigint[],
  y: bigint[],
  mod: bigint[],
  modInv: bigint,
): void {
  const t = [0n, 0n, 0n]
  let D = 0n
  let m = 0n
  let C = 0n

  const res = [0n, 0n]

  {
    {
      const [hi0, lo0] = mul64(x[0], y[0])
      C = hi0
      t[0] = lo0

      const [hi1, lo1] = madd1(x[0], y[1], C)
      C = hi1
      t[1] = lo1

      const [temp2, tempD] = add64(t[2], C, 0n)
      t[2] = temp2
      D = tempD
    }

    m = (t[0] * modInv) & MASK_64

    {
      C = madd0(m, mod[0], t[0])

      const [c2, t0_] = madd2(m, mod[1], t[1], C)
      C = c2
      t[0] = t0_

      const [t1_, c3] = add64(t[2], C, 0n)
      t[1] = t1_
      C = c3

      const [t2_, _dummy] = add64(0n, D, C)
      t[2] = t2_
    }
  }

  {
    {
      const [c4, t0_] = madd1(x[1], y[0], t[0])
      C = c4
      t[0] = t0_

      const [c5, t1_] = madd2(x[1], y[1], t[1], C)
      C = c5
      t[1] = t1_

      const [t2_, d_] = add64(t[2], C, 0n)
      t[2] = t2_
      D = d_
    }

    m = (t[0] * modInv) & MASK_64

    {
      C = madd0(m, mod[0], t[0])

      const [c6, t0_] = madd2(m, mod[1], t[1], C)
      C = c6
      t[0] = t0_

      const [t1_, c7] = add64(t[2], C, 0n)
      t[1] = t1_
      C = c7

      const [t2_, _dummy2] = add64(0n, D, C)
      t[2] = t2_
    }
  }

  {
    const [r0, d0] = sub64(t[0], mod[0], 0n)
    res[0] = r0
    let D_ = d0

    const [r1, d1] = sub64(t[1], mod[1], D_)
    res[1] = r1
    D_ = d1

    if (D_ !== 0n && t[2] === 0n) {
      out[0] = t[0] & MASK_64
      out[1] = t[1] & MASK_64
    } else {
      out[0] = res[0] & MASK_64
      out[1] = res[1] & MASK_64
    }
  }
}

export function addMod64(z: bigint[], x: bigint[], y: bigint[], modulus: bigint[]): void {
  const MASK_64 = (1n << 64n) - 1n

  const x0 = x[0] & MASK_64
  const y0 = y[0] & MASK_64
  const m0 = modulus[0] & MASK_64

  const fullSum = x0 + y0
  const sumLow64 = fullSum & MASK_64
  const carry = fullSum >> 64n

  let diff = sumLow64 - m0
  let borrow = 0n
  if (diff < 0n) {
    diff &= MASK_64
    borrow = 1n
  }

  if (carry === 0n && borrow !== 0n) {
    z[0] = sumLow64
  } else {
    z[0] = diff
  }
  z[0] &= MASK_64
}

export function addMod128(z: bigint[], x: bigint[], y: bigint[], mod: bigint[]): void {
  let c = 0n
  let tmp0 = 0n
  let tmp1 = 0n

  {
    const [sumLow, carryOut] = add64(x[0], y[0], c)
    tmp0 = sumLow
    c = carryOut
  }
  {
    const [sumLow, carryOut] = add64(x[1], y[1], c)
    tmp1 = sumLow
    c = carryOut
  }

  let c1 = 0n
  let out0 = 0n
  let out1 = 0n

  {
    const [diffLow, borrowOut] = sub64(tmp0, mod[0], c1)
    out0 = diffLow
    c1 = borrowOut
  }
  {
    const [diffLow, borrowOut] = sub64(tmp1, mod[1], c1)
    out1 = diffLow
    c1 = borrowOut
  }

  if (c === 0n && c1 !== 0n) {
    z[0] = tmp0 & MASK_64
    z[1] = tmp1 & MASK_64
  } else {
    z[0] = out0 & MASK_64
    z[1] = out1 & MASK_64
  }
}

export function subMod64(z: bigint[], x: bigint[], y: bigint[], mod: bigint[]): void {
  let c = 0n
  let tmpVal = 0n

  {
    const [subLow, subBorrow] = sub64(x[0] & MASK_64, y[0] & MASK_64, c)
    tmpVal = subLow
    c = subBorrow
  }

  let outVal = 0n
  let c1 = 0n
  {
    const [addLow, addCarry] = add64(tmpVal, mod[0] & MASK_64, 0n)
    outVal = addLow
    c1 = addCarry
  }

  let src: bigint
  if (c === 0n) {
    src = tmpVal
  } else {
    src = outVal
  }

  z[0] = src & MASK_64
}

export function subMod128(z: bigint[], x: bigint[], y: bigint[], mod: bigint[]): void {
  function add64(a: bigint, b: bigint, carryIn: bigint): [bigint, bigint] {
    const sum = a + b + carryIn
    const low = sum & MASK_64
    const carryOut = sum >> 64n
    return [low, carryOut]
  }

  function sub64(a: bigint, b: bigint, borrowIn: bigint): [bigint, bigint] {
    let diff = a - b - borrowIn
    let borrowOut = 0n
    if (diff < 0n) {
      diff &= MASK_64
      borrowOut = 1n
    }
    return [diff & MASK_64, borrowOut]
  }

  let c = 0n
  let tmp0 = 0n
  let tmp1 = 0n

  {
    const [diffLow, borrowOut] = sub64(x[0], y[0], c)
    tmp0 = diffLow
    c = borrowOut
  }
  {
    const [diffLow, borrowOut] = sub64(x[1], y[1], c)
    tmp1 = diffLow
    c = borrowOut
  }

  let c1 = 0n
  let out0 = 0n
  let out1 = 0n

  {
    const [sumLow, carryOut] = add64(tmp0, mod[0], c1)
    out0 = sumLow
    c1 = carryOut
  }
  {
    const [sumLow, carryOut] = add64(tmp1, mod[1], c1)
    out1 = sumLow
    c1 = carryOut
  }

  if (c === 0n) {
    z[0] = tmp0 & MASK_64
    z[1] = tmp1 & MASK_64
  } else {
    z[0] = out0 & MASK_64
    z[1] = out1 & MASK_64
  }
}

export const addModPreset: Function[] = [addMod64, addMod128]

export const subModPreset: Function[] = [subMod64, subMod128]

export const mulModPreset: Function[] = [montMulMod64, montMulMod128]
