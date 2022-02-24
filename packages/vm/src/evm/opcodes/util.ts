import Common from '@ethereumjs/common'
import { keccak256, setLengthRight, setLengthLeft, bigIntToBuffer } from 'ethereumjs-util'
import { handlers } from '.'
import { ERROR, VmError } from './../../exceptions'
import { RunState } from './../interpreter'

const MASK_160 = (BigInt(1) << BigInt(160)) - BigInt(1)

/**
 * Proxy function for ethereumjs-util's setLengthLeft, except it returns a zero
 *
 * length buffer in case the buffer is full of zeros.
 * @param {Buffer} value Buffer which we want to pad
 */
export function setLengthLeftStorage(value: Buffer) {
  if (value.equals(Buffer.alloc(value.length, 0))) {
    // return the empty buffer (the value is zero)
    return Buffer.alloc(0)
  } else {
    return setLengthLeft(value, 32)
  }
}

/**
 * Wraps error message as VMError
 *
 * @param {string} err
 */
export function trap(err: string) {
  // TODO: facilitate extra data along with errors
  throw new VmError(err as ERROR)
}

/**
 * Converts bigint address (they're stored like this on the stack) to buffer address
 *
 * @param  {BN}     address
 * @return {Buffer}
 */
export function addressToBuffer(address: bigint | Buffer) {
  if (Buffer.isBuffer(address)) return address
  return setLengthLeft(bigIntToBuffer(address & MASK_160), 20)
}

/**
 * Error message helper - generates location string
 *
 * @param  {RunState} runState
 * @return {string}
 */
export function describeLocation(runState: RunState): string {
  const hash = keccak256(runState.eei.getCode()).toString('hex')
  const address = runState.eei.getAddress().buf.toString('hex')
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
  if (modulus === BigInt(0)) return div

  // Round up
  return div < BigInt(0) ? div - BigInt(1) : div + BigInt(1)
}

export function short(buffer: Buffer): string {
  const MAX_LENGTH = 50
  const bufferStr = buffer.toString('hex')
  if (bufferStr.length <= MAX_LENGTH) {
    return bufferStr
  }
  return bufferStr.slice(0, MAX_LENGTH) + '...'
}

/**
/**
 * Returns an overflow-safe slice of an array. It right-pads
 * the data with zeros to `length`.
 *
 * @param {BN} offset
 * @param {BN} length
 * @param {Buffer} data
 * @returns {Buffer}
 */
export function getDataSlice(data: Buffer, offset: bigint, length: bigint): Buffer {
  const len = BigInt(data.length)
  if (offset > len) {
    offset = len
  }

  let end = offset + length
  if (end > len) {
    end = len
  }

  data = data.slice(Number(offset), Number(end))
  // Right-pad with zeros to fill dataLength bytes
  data = setLengthRight(data, Number(length))

  return data
}

/**
 * Get full opcode name from its name and code.
 *
 * @param code {number} Integer code of opcode.
 * @param name {string} Short name of the opcode.
 * @returns {string} Full opcode name
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
 *
 * @param  {RunState} runState
 * @param  {number}   dest
 * @return {boolean}
 */
export function jumpIsValid(runState: RunState, dest: number): boolean {
  return runState.validJumps[dest] === 1
}

/**
 * Checks if a jumpsub is valid given a destination (defined as a 2 in the validJumps array)
 *
 * @param  {RunState} runState
 * @param  {number}   dest
 * @return {boolean}
 */
export function jumpSubIsValid(runState: RunState, dest: number): boolean {
  return runState.validJumps[dest] === 2
}

/**
 * Returns an overflow-safe slice of an array. It right-pads
 *
 * the data with zeros to `length`.
 * @param {BN} gasLimit - requested gas Limit
 * @param {BN} gasLeft - current gas left
 * @param {RunState} runState - the current runState
 * @param {Common} common - the common
 */
export function maxCallGas(
  gasLimit: bigint,
  gasLeft: bigint,
  runState: RunState,
  common: Common
): bigint {
  const isTangerineWhistleOrLater = common.gteHardfork('tangerineWhistle')
  if (isTangerineWhistleOrLater) {
    const gasAllowed = gasLeft - gasLeft / BigInt(64)
    return gasLimit > gasAllowed ? gasAllowed : gasLimit
  } else {
    return gasLimit
  }
}

/**
 * Subtracts the amount needed for memory usage from `runState.gasLeft`
 *
 * @method subMemUsage
 * @param {Object} runState
 * @param {BN} offset
 * @param {BN} length
 */
export function subMemUsage(runState: RunState, offset: bigint, length: bigint, common: Common) {
  // YP (225): access with zero length will not extend the memory
  if (length === BigInt(0)) return BigInt(0)

  const newMemoryWordCount = divCeil(offset + length, BigInt(32))
  if (newMemoryWordCount <= runState.memoryWordCount) return BigInt(0)

  const words = newMemoryWordCount
  const fee = BigInt(common.param('gasPrices', 'memory'))
  const quadCoeff = BigInt(common.param('gasPrices', 'quadCoeffDiv'))
  // words * 3 + words ^2 / 512
  let cost = words * fee + (words * words) / quadCoeff

  if (cost > runState.highestMemCost) {
    const currentHighestMemCost = runState.highestMemCost
    runState.highestMemCost = cost
    cost -= currentHighestMemCost
  }

  runState.memoryWordCount = newMemoryWordCount

  return cost
}

/**
 * Writes data returned by eei.call* methods to memory
 *
 * @param {RunState} runState
 * @param {BN}       outOffset
 * @param {BN}       outLength
 */
export function writeCallOutput(runState: RunState, outOffset: bigint, outLength: bigint) {
  const returnData = runState.eei.getReturnData()
  if (returnData.length > 0) {
    const memOffset = Number(outOffset)
    let dataLength = Number(outLength)
    if (BigInt(returnData.length) < dataLength) {
      dataLength = returnData.length
    }
    const data = getDataSlice(returnData, BigInt(0), BigInt(dataLength))
    runState.memory.extend(memOffset, dataLength)
    runState.memory.write(memOffset, dataLength, data)
  }
}

/** The first rule set of SSTORE rules, which are the rules pre-Constantinople and in Petersburg
 * @param {RunState} runState
 * @param {Buffer}   currentStorage
 * @param {Buffer}   value
 * @param {Buffer}   keyBuf
 */
export function updateSstoreGas(
  runState: RunState,
  currentStorage: Buffer,
  value: Buffer,
  common: Common
): bigint {
  if (
    (value.length === 0 && currentStorage.length === 0) ||
    (value.length > 0 && currentStorage.length > 0)
  ) {
    const gas = BigInt(common.param('gasPrices', 'sstoreReset'))
    return gas
  } else if (value.length === 0 && currentStorage.length > 0) {
    const gas = BigInt(common.param('gasPrices', 'sstoreReset'))
    runState.eei.refundGas(BigInt(common.param('gasPrices', 'sstoreRefund')), 'updateSstoreGas')
    return gas
  } else {
    /*
      The situations checked above are:
      -> Value/Slot are both 0
      -> Value/Slot are both nonzero
      -> Value is zero, but slot is nonzero
      Thus, the remaining case is where value is nonzero, but slot is zero, which is this clause
    */
    return BigInt(common.param('gasPrices', 'sstoreSet'))
  }
}

export function mod(a: bigint, b: bigint) {
  let r = a % b
  if (r < BigInt(0)) {
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
  return a * BigInt(-1)
}

const N = BigInt(115792089237316195423570985008687907853269984665640564039457584007913129639936)
export function exponentation(bas: bigint, exp: bigint) {
  let t = BigInt(1)
  while (exp > BigInt(0)) {
    if (exp % BigInt(2) != BigInt(0)) {
      t = (t * bas) % N
    }
    bas = (bas * bas) % N
    exp = exp / BigInt(2)
  }
  return t
}

export const eof1CodeAnalysis = (container: Buffer) => {
  const magic = 0x00
  const version = 0x01
  const secCode = 0x01
  const secData = 0x02
  const secTerminator = 0x00
  let computedContainerSize = 0
  const sectionSizes = {
    code: 0,
    data: 0,
  }
  if (container[1] === magic && container[2] === version) {
    if (container.length > 7 && container[3] === secCode && container[6] === secTerminator) {
      sectionSizes.code = (container[4] << 8) | container[5]
      computedContainerSize = 7 + sectionSizes.code
      // Code size cannot be 0
      if (sectionSizes.code < 1) return
    } else if (
      container.length > 10 &&
      container[3] === secCode &&
      container[6] === secData &&
      container[9] === secTerminator
    ) {
      sectionSizes.code = (container[4] << 8) | container[5]
      sectionSizes.data = (container[7] << 8) | container[8]
      computedContainerSize = 10 + sectionSizes.code + sectionSizes.data
      // Code & Data sizes cannot be 0
      if (sectionSizes.code < 1 || sectionSizes.data < 1) return
    }
    if (container.length !== computedContainerSize) {
      // Scanned code does not match length of contract byte code
      return
    }
    return sectionSizes
  }
}

export const eof1ValidOpcodes = (code: Buffer) => {
  // EIP-3670 - validate all opcodes
  const opcodes = new Set(handlers.keys())
  opcodes.add(0xfe) // Add INVALID opcode to set

  let x = 0
  while (x < code.length) {
    const opcode = code[x]
    x++
    if (!opcodes.has(opcode)) {
      // No invalid/undefined opcodes
      return false
    }
    if (opcode >= 0x60 && opcode <= 0x7f) {
      // Skip data block following push
      x += opcode - 0x5f
      if (x > code.length - 1) {
        // Push blocks mmust not exceed end of code section
        return false
      }
    }
  }
  const terminatingOpcodes = new Set([0x00, 0xd3, 0xfd, 0xfe, 0xff])
  if (!terminatingOpcodes.has(code[code.length - 1])) {
    // Final opcode of code section must be terminating opcode
    return false
  }
  return true
}
