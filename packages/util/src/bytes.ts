import { getRandomBytesSync } from 'ethereum-cryptography/random.js'
// eslint-disable-next-line no-restricted-imports
import {
  bytesToHex as _bytesToUnprefixedHex,
  hexToBytes as nobleH2B,
} from 'ethereum-cryptography/utils.js'

import { EthereumJSErrorWithoutCode } from './errors.js'
import { assertIsArray, assertIsBytes, assertIsHexString } from './helpers.js'
import { isHexString, padToEven, stripHexPrefix } from './internal.js'

import type { PrefixedHexString, TransformableToBytes } from './types.js'

const BIGINT_0 = BigInt(0)

/**
 * @deprecated
 */
export const bytesToUnprefixedHex = _bytesToUnprefixedHex

/**
 * Converts a {@link PrefixedHexString} to a {@link Uint8Array}
 * @param {PrefixedHexString} hex The 0x-prefixed hex string to convert
 * @returns {Uint8Array} The converted bytes
 * @throws If the input is not a valid 0x-prefixed hex string
 */
export const hexToBytes = (hex: string) => {
  if (!hex.startsWith('0x')) throw EthereumJSErrorWithoutCode('input string must be 0x prefixed')
  return nobleH2B(padToEven(stripHexPrefix(hex)))
}

export const unprefixedHexToBytes = (hex: string) => {
  if (hex.startsWith('0x')) throw EthereumJSErrorWithoutCode('input string cannot be 0x prefixed')
  return nobleH2B(padToEven(hex))
}

export const bytesToHex = (bytes: Uint8Array): PrefixedHexString => {
  if (bytes === undefined || bytes.length === 0) return '0x'
  const unprefixedHex = bytesToUnprefixedHex(bytes)
  return ('0x' + unprefixedHex) as PrefixedHexString
}

// BigInt cache for the numbers 0 - 256*256-1 (two-byte bytes)
const BIGINT_CACHE: bigint[] = []
for (let i = 0; i <= 256 * 256 - 1; i++) {
  BIGINT_CACHE[i] = BigInt(i)
}

/**
 * Converts a {@link Uint8Array} to a {@link bigint}
 * @param {Uint8Array} bytes the bytes to convert
 * @returns {bigint}
 */
export const bytesToBigInt = (bytes: Uint8Array, littleEndian = false): bigint => {
  if (littleEndian) {
    bytes.reverse()
  }
  const hex = bytesToHex(bytes)
  if (hex === '0x') {
    return BIGINT_0
  }
  if (hex.length === 4) {
    // If the byte length is 1 (this is faster than checking `bytes.length === 1`)
    return BIGINT_CACHE[bytes[0]]
  }
  if (hex.length === 6) {
    return BIGINT_CACHE[bytes[0] * 256 + bytes[1]]
  }
  return BigInt(hex)
}

/**
 * Converts a {@link Uint8Array} to a {@link number}.
 * @param {Uint8Array} bytes the bytes to convert
 * @return  {number}
 * @throws If the input number exceeds 53 bits.
 */
export const bytesToInt = (bytes: Uint8Array): number => {
  const res = Number(bytesToBigInt(bytes))
  if (!Number.isSafeInteger(res)) throw EthereumJSErrorWithoutCode('Number exceeds 53 bits')
  return res
}

/******************************************/

/**
 * Converts a {@link number} into a {@link PrefixedHexString}
 * @param {number} i
 * @return {PrefixedHexString}
 */
export const intToHex = (i: number): PrefixedHexString => {
  if (!Number.isSafeInteger(i) || i < 0) {
    throw EthereumJSErrorWithoutCode(`Received an invalid integer type: ${i}`)
  }
  return ('0x' + i.toString(16)) as PrefixedHexString
}

/**
 * Converts an {@link number} to a {@link Uint8Array}
 * @param {Number} i
 * @return {Uint8Array}
 */
export const intToBytes = (i: number): Uint8Array => {
  const hex = intToHex(i)
  return hexToBytes(hex)
}

/**
 * Converts a {@link bigint} to a {@link Uint8Array}
 *  * @param {bigint} num the bigint to convert
 * @returns {Uint8Array}
 */
export const bigIntToBytes = (num: bigint, littleEndian = false): Uint8Array => {
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const bytes = toBytes(`0x${padToEven(num.toString(16))}`)

  return littleEndian ? bytes.reverse() : bytes
}

/**
 * Pads a `Uint8Array` with zeros till it has `length` bytes.
 * Truncates the beginning or end of input if its length exceeds `length`.
 * @param {Uint8Array} msg the value to pad
 * @param {number} length the number of bytes the output should be
 * @param {boolean} right whether to start padding form the left or right
 * @return {Uint8Array}
 */
const setLength = (msg: Uint8Array, length: number, right: boolean): Uint8Array => {
  if (right) {
    if (msg.length < length) {
      return new Uint8Array([...msg, ...new Uint8Array(length - msg.length)])
    }
    return msg.subarray(0, length)
  } else {
    if (msg.length < length) {
      return new Uint8Array([...new Uint8Array(length - msg.length), ...msg])
    }
    return msg.subarray(-length)
  }
}

/**
 * Left Pads a `Uint8Array` with leading zeros till it has `length` bytes.
 * Or it truncates the beginning if it exceeds.
 * @param {Uint8Array} msg the value to pad
 * @param {number} length the number of bytes the output should be
 * @return {Uint8Array}
 */
export const setLengthLeft = (msg: Uint8Array, length: number): Uint8Array => {
  assertIsBytes(msg)
  return setLength(msg, length, false)
}

/**
 * Right Pads a `Uint8Array` with trailing zeros till it has `length` bytes.
 * it truncates the end if it exceeds.
 * @param {Uint8Array} msg the value to pad
 * @param {number} length the number of bytes the output should be
 * @return {Uint8Array}
 */
export const setLengthRight = (msg: Uint8Array, length: number): Uint8Array => {
  assertIsBytes(msg)
  return setLength(msg, length, true)
}

/**
 * Trims leading zeros from a `Uint8Array`, `number[]` or `string`.
 * @param {Uint8Array|number[]|string} a
 * @return {Uint8Array|number[]|string}
 */
const stripZeros = <T extends Uint8Array | number[] | string = Uint8Array | number[] | string>(
  a: T,
): T => {
  let first = a[0]
  while (a.length > 0 && first.toString() === '0') {
    a = a.slice(1) as T
    first = a[0]
  }
  return a
}

/**
 * Trims leading zeros from a `Uint8Array`.
 * @param {Uint8Array} a
 * @return {Uint8Array}
 */
export const unpadBytes = (a: Uint8Array): Uint8Array => {
  assertIsBytes(a)
  return stripZeros(a)
}

/**
 * Trims leading zeros from an `Array` (of numbers).
 * @param  {number[]} a
 * @return {number[]}
 */
export const unpadArray = (a: number[]): number[] => {
  assertIsArray(a)
  return stripZeros(a)
}

/**
 * Trims leading zeros from a `PrefixedHexString`.
 * @param {PrefixedHexString} a
 * @return {PrefixedHexString}
 */
export const unpadHex = (a: PrefixedHexString): PrefixedHexString => {
  assertIsHexString(a)
  return `0x${stripZeros(stripHexPrefix(a))}`
}

export type ToBytesInputTypes =
  | PrefixedHexString
  | number
  | bigint
  | Uint8Array
  | number[]
  | TransformableToBytes
  | null
  | undefined

/**
 * Attempts to turn a value into a `Uint8Array`.
 * Inputs supported: `Buffer`, `Uint8Array`, `String` (hex-prefixed), `Number`, null/undefined, `BigInt` and other objects
 * with a `toArray()` or `toBytes()` method.
 * @param {ToBytesInputTypes} v the value
 * @return {Uint8Array}
 */

export const toBytes = (v: ToBytesInputTypes): Uint8Array => {
  if (v === null || v === undefined) {
    return new Uint8Array()
  }

  if (Array.isArray(v) || v instanceof Uint8Array) {
    return Uint8Array.from(v)
  }

  if (typeof v === 'string') {
    if (!isHexString(v)) {
      throw EthereumJSErrorWithoutCode(
        `Cannot convert string to Uint8Array. toBytes only supports 0x-prefixed hex strings and this string was given: ${v}`,
      )
    }
    return hexToBytes(v)
  }

  if (typeof v === 'number') {
    return intToBytes(v)
  }

  if (typeof v === 'bigint') {
    if (v < BIGINT_0) {
      throw EthereumJSErrorWithoutCode(`Cannot convert negative bigint to Uint8Array. Given: ${v}`)
    }
    let n = v.toString(16)
    if (n.length % 2) n = '0' + n
    return unprefixedHexToBytes(n)
  }

  if (v.toBytes !== undefined) {
    // converts a `TransformableToBytes` object to a Uint8Array
    return v.toBytes()
  }

  throw EthereumJSErrorWithoutCode('invalid type')
}

/**
 * Interprets a `Uint8Array` as a signed integer and returns a `BigInt`. Assumes 256-bit numbers.
 * @param {Uint8Array} num Signed integer value
 * @returns {bigint}
 */
export const fromSigned = (num: Uint8Array): bigint => {
  return BigInt.asIntN(256, bytesToBigInt(num))
}

/**
 * Converts a `BigInt` to an unsigned integer and returns it as a `Uint8Array`. Assumes 256-bit numbers.
 * @param {bigint} num
 * @returns {Uint8Array}
 */
export const toUnsigned = (num: bigint): Uint8Array => {
  return bigIntToBytes(BigInt.asUintN(256, num))
}

/**
 * Adds "0x" to a given `string` if it does not already start with "0x".
 * @param {string} str
 * @return {PrefixedHexString}
 */
export const addHexPrefix = (str: string): PrefixedHexString => {
  if (typeof str !== 'string') {
    return str
  }

  return isHexString(str) ? str : `0x${str}`
}

/**
 * Shortens a string  or Uint8Array's hex string representation to maxLength (default 50).
 *
 * Examples:
 *
 * Input:  '657468657265756d000000000000000000000000000000000000000000000000'
 * Output: '657468657265756d0000000000000000000000000000000000…'
 * @param {Uint8Array | string} bytes
 * @param {number} maxLength
 * @return {string}
 */
export const short = (bytes: Uint8Array | string, maxLength: number = 50): string => {
  const byteStr = bytes instanceof Uint8Array ? bytesToHex(bytes) : bytes
  const len = byteStr.slice(0, 2) === '0x' ? maxLength + 2 : maxLength
  if (byteStr.length <= len) {
    return byteStr
  }
  return byteStr.slice(0, len) + '…'
}

/**
 * Checks provided Uint8Array for leading zeroes and throws if found.
 *
 * Examples:
 *
 * Valid values: 0x1, 0x, 0x01, 0x1234
 * Invalid values: 0x0, 0x00, 0x001, 0x0001
 *
 * Note: This method is useful for validating that RLP encoded integers comply with the rule that all
 * integer values encoded to RLP must be in the most compact form and contain no leading zero bytes
 * @param values An object containing string keys and Uint8Array values
 * @throws if any provided value is found to have leading zero bytes
 */
export const validateNoLeadingZeroes = (values: { [key: string]: Uint8Array | undefined }) => {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && v.length > 0 && v[0] === 0) {
      throw EthereumJSErrorWithoutCode(
        `${k} cannot have leading zeroes, received: ${bytesToHex(v)}`,
      )
    }
  }
}

/**
 * Converts a {@link bigint} to a `0x` prefixed hex string
 * @param {bigint} num the bigint to convert
 * @returns {PrefixedHexString}
 */
export const bigIntToHex = (num: bigint): PrefixedHexString => {
  return `0x${num.toString(16)}`
}

/**
 * Calculates max bigint from an array of bigints
 * @param args array of bigints
 */
export const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m))

/**
 * Calculates min BigInt from an array of BigInts
 * @param args array of bigints
 */
export const bigIntMin = (...args: bigint[]) => args.reduce((m, e) => (e < m ? e : m))

/**
 * Convert value from bigint to an unpadded Uint8Array
 * (useful for RLP transport)
 * @param {bigint} value the bigint to convert
 * @returns {Uint8Array}
 */
export const bigIntToUnpaddedBytes = (value: bigint): Uint8Array => {
  return unpadBytes(bigIntToBytes(value))
}

export const bigIntToAddressBytes = (value: bigint, strict: boolean = true): Uint8Array => {
  const addressBytes = bigIntToBytes(value)
  if (strict && addressBytes.length > 20) {
    throw Error(`Invalid address bytes length=${addressBytes.length} strict=${strict}`)
  }

  // setLength already slices if more than requisite length
  return setLengthLeft(addressBytes, 20)
}

/**
 * Convert value from number to an unpadded Uint8Array
 * (useful for RLP transport)
 * @param {number} value the bigint to convert
 * @returns {Uint8Array}
 */
export const intToUnpaddedBytes = (value: number): Uint8Array => {
  return unpadBytes(intToBytes(value))
}

/**
 * Compares two Uint8Arrays and returns a number indicating their order in a sorted array.
 *
 * @param {Uint8Array} value1 - The first Uint8Array to compare.
 * @param {Uint8Array} value2 - The second Uint8Array to compare.
 * @returns {number} A positive number if value1 is larger than value2,
 *                   A negative number if value1 is smaller than value2,
 *                   or 0 if value1 and value2 are equal.
 */
export const compareBytes = (value1: Uint8Array, value2: Uint8Array): number => {
  const bigIntValue1 = bytesToBigInt(value1)
  const bigIntValue2 = bytesToBigInt(value2)
  return bigIntValue1 > bigIntValue2 ? 1 : bigIntValue1 < bigIntValue2 ? -1 : 0
}

/**
 * Generates a Uint8Array of random bytes of specified length.
 *
 * @param {number} length - The length of the Uint8Array.
 * @returns {Uint8Array} A Uint8Array of random bytes of specified length.
 */
export const randomBytes = (length: number): Uint8Array => {
  return getRandomBytesSync(length)
}

/**
 * This mirrors the functionality of the `ethereum-cryptography` export except
 * it skips the check to validate that every element of `arrays` is indeed a `uint8Array`
 * Can give small performance gains on large arrays
 * @param {Uint8Array[]} arrays an array of Uint8Arrays
 * @returns {Uint8Array} one Uint8Array with all the elements of the original set
 * works like `Buffer.concat`
 */
export const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  if (arrays.length === 1) return arrays[0]
  const length = arrays.reduce((a, arr) => a + arr.length, 0)
  const result = new Uint8Array(length)
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const arr = arrays[i]
    result.set(arr, pad)
    pad += arr.length
  }
  return result
}

/**
 * @notice Convert a Uint8Array to a 32-bit integer
 * @param {Uint8Array} bytes The input Uint8Array from which to read the 32-bit integer.
 * @param {boolean} littleEndian True for little-endian, undefined or false for big-endian.
 * @return {number} The 32-bit integer read from the input Uint8Array.
 */
export function bytesToInt32(bytes: Uint8Array, littleEndian: boolean = false): number {
  if (bytes.length < 4) {
    bytes = setLength(bytes, 4, littleEndian)
  }
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return dataView.getUint32(0, littleEndian)
}

/**
 * @notice Convert a Uint8Array to a 64-bit bigint
 * @param {Uint8Array} bytes The input Uint8Array from which to read the 64-bit bigint.
 * @param {boolean} littleEndian True for little-endian, undefined or false for big-endian.
 * @return {bigint} The 64-bit bigint read from the input Uint8Array.
 */
export function bytesToBigInt64(bytes: Uint8Array, littleEndian: boolean = false): bigint {
  if (bytes.length < 8) {
    bytes = setLength(bytes, 8, littleEndian)
  }
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return dataView.getBigUint64(0, littleEndian)
}

/**
 * @notice Convert a 32-bit integer to a Uint8Array.
 * @param {number} value The 32-bit integer to convert.
 * @param {boolean} littleEndian True for little-endian, undefined or false for big-endian.
 * @return {Uint8Array} A Uint8Array of length 4 containing the integer.
 */
export function int32ToBytes(value: number, littleEndian: boolean = false): Uint8Array {
  const buffer = new ArrayBuffer(4)
  const dataView = new DataView(buffer)
  dataView.setUint32(0, value, littleEndian)
  return new Uint8Array(buffer)
}

/**
 * @notice Convert a 64-bit bigint to a Uint8Array.
 * @param {bigint} value The 64-bit bigint to convert.
 * @param {boolean} littleEndian True for little-endian, undefined or false for big-endian.
 * @return {Uint8Array} A Uint8Array of length 8 containing the bigint.
 */
export function bigInt64ToBytes(value: bigint, littleEndian: boolean = false): Uint8Array {
  const buffer = new ArrayBuffer(8)
  const dataView = new DataView(buffer)
  dataView.setBigUint64(0, value, littleEndian)
  return new Uint8Array(buffer)
}

// eslint-disable-next-line no-restricted-imports
export { bytesToUtf8, equalsBytes, utf8ToBytes } from 'ethereum-cryptography/utils.js'

export function hexToBigInt(input: PrefixedHexString): bigint {
  return bytesToBigInt(hexToBytes(isHexString(input) ? input : `0x${input}`))
}

/**
 * Converts a Uint8Array of bytes into an array of bits.
 * @param {Uint8Array} bytes - The input byte array.
 * @param {number} bitLength - The number of bits to extract from the input bytes.
 * @returns {number[]} An array of bits (each 0 or 1) corresponding to the input bytes.
 */
export function bytesToBits(bytes: Uint8Array, bitLength?: number): number[] {
  const bits: number[] = []

  for (let i = 0; i < (bitLength ?? bytes.length * 8); i++) {
    const byteIndex = Math.floor(i / 8)
    const bitIndex = 7 - (i % 8)
    bits.push((bytes[byteIndex] >> bitIndex) & 1)
  }

  return bits
}

/**
 * Converts an array of bits into a Uint8Array.
 * The input bits are grouped into sets of 8, with the first bit in each group being the most significant.
 * @param {number[]} bits - The input array of bits (each should be 0 or 1). Its length should be a multiple of 8.
 * @returns {Uint8Array} A Uint8Array constructed from the input bits.
 */
export function bitsToBytes(bits: number[]): Uint8Array {
  const numBytes = Math.ceil(bits.length / 8) // Ensure partial byte storage
  const byteData = new Uint8Array(numBytes)

  for (let i = 0; i < bits.length; i++) {
    const byteIndex = Math.floor(i / 8)
    const bitIndex = 7 - (i % 8)
    byteData[byteIndex] |= bits[i] << bitIndex
  }

  return byteData
}

/**
 * Compares two byte arrays and returns the count of consecutively matching items from the start.
 * @param {Uint8Array} bytes1 - The first Uint8Array to compare.
 * @param {Uint8Array} bytes2 - The second Uint8Array to compare.
 * @returns {number} The count of consecutively matching items from the start.
 */
export function matchingBytesLength(bytes1: Uint8Array, bytes2: Uint8Array): number {
  let count = 0
  const minLength = Math.min(bytes1.length, bytes2.length)

  for (let i = 0; i < minLength; i++) {
    if (bytes1[i] === bytes2[i]) {
      count++
    } else {
      // Break early if a mismatch is found
      break
    }
  }
  return count
}

/**
 * Compares two arrays of bits (0 or 1) and returns the count of consecutively matching bits from the start.
 * @param {number[]} bits1 - The first array of bits, in bytes or bits.
 * @param {number[]} bits2 - The second array of bits, in bytes or bits.
 * @returns {number} The count of consecutively matching bits from the start.
 */
export function matchingBitsLength(bits1: number[], bits2: number[]): number {
  let count = 0
  const minLength = Math.min(bits1.length, bits2.length)
  for (let i = 0; i < minLength; i++) {
    if (bits1[i] === bits2[i]) {
      count++
    } else {
      return count
    }
  }
  return count
}

/**
 * Checks whether two arrays of bits are equal.
 *
 * Two arrays are considered equal if they have the same length and each corresponding element is identical.
 *
 * @param {number[]} bits1 - The first bits array.
 * @param {number[]} bits2 - The second bits array.
 * @returns {boolean} True if the arrays are equal; otherwise, false.
 */
export function equalsBits(bits1: number[], bits2: number[]): boolean {
  if (bits1.length !== bits2.length) {
    return false
  }
  for (let i = 0; i < bits1.length; i++) {
    if (bits1[i] !== bits2[i]) {
      return false
    }
  }
  return true
}
