import { Hardfork } from '@ethereumjs/common'
import {
  BIGINT_0,
  BIGINT_1,
  BIGINT_160,
  BIGINT_2,
  BIGINT_32,
  BIGINT_64,
  BIGINT_NEG1,
  bytesToHex,
  createAddressFromBigInt,
  equalsBytes,
  setLengthLeft,
  setLengthRight,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import type { EVMError } from '../errors.js'
import type { RunState } from '../interpreter.js'
import type { Common } from '@ethereumjs/common'
import type { Address } from '@ethereumjs/util'

const MASK_160 = (BIGINT_1 << BIGINT_160) - BIGINT_1

export function mod(a: bigint, b: bigint) {
  let r = a % b
  if (r < BIGINT_0) {
    r = b + r
  }
  return r
}

export function fromTwos(a: bigint) {
  return BigInt.asIntN(256, a)
}

export function toTwos(a: bigint) {
  return BigInt.asUintN(256, a)
}

export function abs(a: bigint) {
  if (a > 0) {
    return a
  }
  return a * BIGINT_NEG1
}

const N = BigInt(115792089237316195423570985008687907853269984665640564039457584007913129639936)
export function exponentiation(bas: bigint, exp: bigint) {
  let t = BIGINT_1
  while (exp > BIGINT_0) {
    if (exp % BIGINT_2 !== BIGINT_0) {
      t = (t * bas) % N
    }
    bas = (bas * bas) % N
    exp = exp / BIGINT_2
  }
  return t
}

/**
 * Create an address from a stack item (256 bit integer).
 * This wrapper ensures that the value is masked to 160 bits.
 * @param value 160-bit integer
 */
export function createAddressFromStackBigInt(value: bigint): Address {
  const maskedValue = value & MASK_160
  return createAddressFromBigInt(maskedValue)
}

/**
 * Proxy function for @ethereumjs/util's setLengthLeft, except it returns a zero
 * length Uint8Array in case the Uint8Array is full of zeros.
 * @param value Uint8Array which we want to pad
 */
export function setLengthLeftStorage(value: Uint8Array) {
  if (equalsBytes(value, new Uint8Array(value.length))) {
    // return the empty Uint8Array (the value is zero)
    return new Uint8Array(0)
  } else {
    return setLengthLeft(value, 32)
  }
}

/**
 * Wraps error message as EvmError
 */
export function trap(err: EVMError) {
  // TODO: accept EVMError constructor args instead of the error
  // TODO: facilitate extra data along with errors
  throw err
}

/**
 * Error message helper - generates location string
 */
export function describeLocation(runState: RunState): string {
  const keccakFunction = runState.interpreter._evm.common.customCrypto.keccak256 ?? keccak256
  const hash = bytesToHex(keccakFunction(runState.interpreter.getCode()))
  const address = runState.interpreter.getAddress().toString()
  const pc = runState.programCounter - 1
  return `${hash}/${address}:${pc}`
}

/**
 * Find Ceil(a / b)
 *
 * @param {bigint} a
 * @param {bigint} b
 * @return {bigint}
 */
export function divCeil(a: bigint, b: bigint): bigint {
  const div = a / b
  const modulus = mod(a, b)

  // Fast case - exact division
  if (modulus === BIGINT_0) return div

  // Round up
  return div < BIGINT_0 ? div - BIGINT_1 : div + BIGINT_1
}

/**
 * Returns an overflow-safe slice of an array. It right-pads
 * the data with zeros to `length`.
 */
export function getDataSlice(data: Uint8Array, offset: bigint, length: bigint): Uint8Array {
  const len = BigInt(data.length)
  if (offset > len) {
    offset = len
  }

  let end = offset + length
  if (end > len) {
    end = len
  }

  data = data.subarray(Number(offset), Number(end))
  // Right-pad with zeros to fill dataLength bytes
  data = setLengthRight(data, Number(length))

  return data
}

/**
 * Get full opcode name from its name and code.
 *
 * @param code Integer code of opcode.
 * @param name Short name of the opcode.
 * @returns Full opcode name
 */
export function getFullname(code: number, name: string): string {
  switch (name) {
    case 'LOG':
      name += code - 0xa0
      break
    case 'PUSH':
      name += code - 0x5f
      break
    case 'DUP':
      name += code - 0x7f
      break
    case 'SWAP':
      name += code - 0x8f
      break
  }
  return name
}

/**
 * Checks if a jump is valid given a destination (defined as a 1 in the validJumps array)
 */
export function jumpIsValid(runState: RunState, dest: number): boolean {
  return runState.validJumps[dest] === 1
}

/**
 * Returns an overflow-safe slice of an array. It right-pads
 * the data with zeros to `length`.
 * @param gasLimit requested gas Limit
 * @param gasLeft current gas left
 * @param runState the current runState
 * @param common the common
 */
export function maxCallGas(
  gasLimit: bigint,
  gasLeft: bigint,
  runState: RunState,
  common: Common,
): bigint {
  if (common.gteHardfork(Hardfork.TangerineWhistle)) {
    const gasAllowed = gasLeft - gasLeft / BIGINT_64
    return gasLimit > gasAllowed ? gasAllowed : gasLimit
  } else {
    return gasLimit
  }
}

/**
 * Subtracts the amount needed for memory usage from `runState.gasLeft`
 */
export function subMemUsage(runState: RunState, offset: bigint, length: bigint, common: Common) {
  // YP (225): access with zero length will not extend the memory
  if (length === BIGINT_0) return BIGINT_0

  const newMemoryWordCount = divCeil(offset + length, BIGINT_32)
  if (newMemoryWordCount <= runState.memoryWordCount) return BIGINT_0

  const words = newMemoryWordCount
  const fee = common.param('memoryGas')
  const quadCoefficient = common.param('quadCoefficientDivGas')
  // words * 3 + words ^2 / 512
  let cost = words * fee + (words * words) / quadCoefficient

  if (cost > runState.highestMemCost) {
    const currentHighestMemCost = runState.highestMemCost
    runState.highestMemCost = cost
    cost -= currentHighestMemCost
  }

  runState.memoryWordCount = newMemoryWordCount

  return cost
}

/**
 * Writes data returned by evm.call* methods to memory
 */
export function writeCallOutput(runState: RunState, outOffset: bigint, outLength: bigint) {
  const returnData = runState.interpreter.getReturnData()
  if (returnData.length > 0) {
    const memOffset = Number(outOffset)
    let dataLength = Number(outLength)
    if (BigInt(returnData.length) < dataLength) {
      dataLength = returnData.length
    }
    const data = getDataSlice(returnData, BIGINT_0, BigInt(dataLength))
    runState.memory.extend(memOffset, dataLength)
    runState.memory.write(memOffset, dataLength, data)
  }
}

/**
 * The first rule set of SSTORE rules, which are the rules pre-Constantinople and in Petersburg
 */
export function updateSstoreGas(
  runState: RunState,
  currentStorage: Uint8Array,
  value: Uint8Array,
  common: Common,
): bigint {
  if (
    (value.length === 0 && currentStorage.length === 0) ||
    (value.length > 0 && currentStorage.length > 0)
  ) {
    const gas = common.param('sstoreResetGas')
    return gas
  } else if (value.length === 0 && currentStorage.length > 0) {
    const gas = common.param('sstoreResetGas')
    runState.interpreter.refundGas(common.param('sstoreRefundGas'), 'updateSstoreGas')
    return gas
  } else {
    /*
      The situations checked above are:
      -> Value/Slot are both 0
      -> Value/Slot are both nonzero
      -> Value is zero, but slot is nonzero
      Thus, the remaining case is where value is nonzero, but slot is zero, which is this clause
    */
    return common.param('sstoreSetGas')
  }
}
