import {
  generateAddress,
  generateAddress2,
  isValidAddress,
  privateToAddress,
  pubToAddress,
} from './account.js'
import {
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
} from './bytes.js'
import { BIGINT_0 } from './constants.js'
import { EthereumJSErrorWithoutCode } from './errors.js'

import type { PrefixedHexString } from './types.js'

/**
 * Handling and generating Ethereum addresses
 */
export class Address {
  public readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    if (bytes.length !== 20) {
      throw EthereumJSErrorWithoutCode('Invalid address length')
    }
    this.bytes = bytes
  }

  /**
   * Is address equal to another.
   */
  equals(address: Address): boolean {
    return equalsBytes(this.bytes, address.bytes)
  }

  /**
   * Is address zero.
   */
  isZero(): boolean {
    return this.equals(new Address(new Uint8Array(20)))
  }

  /**
   * True if address is in the address range defined
   * by EIP-1352
   */
  isPrecompileOrSystemAddress(): boolean {
    const address = bytesToBigInt(this.bytes)
    const rangeMin = BIGINT_0
    const rangeMax = BigInt('0xffff')
    return address >= rangeMin && address <= rangeMax
  }

  /**
   * Returns hex encoding of address.
   */
  toString(): PrefixedHexString {
    return bytesToHex(this.bytes)
  }

  /**
   * Returns a new Uint8Array representation of address.
   */
  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

/**
 * Returns the zero address.
 */
export function createZeroAddress(): Address {
  return new Address(new Uint8Array(20))
}

/**
 * Returns an Address object from a bigint address (they are stored as bigints on the stack)
 * @param value The bigint address
 */
export function createAddressFromBigInt(value: bigint): Address {
  const bytes = bigIntToBytes(value)
  if (bytes.length > 20) {
    throw EthereumJSErrorWithoutCode(`Invalid address, too long: ${bytes.length}`)
  }
  return new Address(setLengthLeft(bytes, 20))
}

/**
 * Returns an Address object from a hex-encoded string.
 * @param str - Hex-encoded address
 */
export function createAddressFromString(str: string): Address {
  if (!isValidAddress(str)) {
    throw EthereumJSErrorWithoutCode(`Invalid address input=${str}`)
  }
  return new Address(hexToBytes(str))
}

/**
 * Returns an address for a given public key.
 * @param pubKey The two points of an uncompressed key
 */
export function createAddressFromPublicKey(pubKey: Uint8Array): Address {
  if (!(pubKey instanceof Uint8Array)) {
    throw EthereumJSErrorWithoutCode('Public key should be Uint8Array')
  }
  const bytes = pubToAddress(pubKey)
  return new Address(bytes)
}

/**
 * Returns an address for a given private key.
 * @param privateKey A private key must be 256 bits wide
 */
export function createAddressFromPrivateKey(privateKey: Uint8Array): Address {
  if (!(privateKey instanceof Uint8Array)) {
    throw EthereumJSErrorWithoutCode('Private key should be Uint8Array')
  }
  const bytes = privateToAddress(privateKey)
  return new Address(bytes)
}

/**
 * Generates an address for a newly created contract.
 * @param from The address which is creating this new address
 * @param nonce The nonce of the from account
 */
export function createContractAddress(from: Address, nonce: bigint): Address {
  if (typeof nonce !== 'bigint') {
    throw EthereumJSErrorWithoutCode('Expected nonce to be a bigint')
  }
  return new Address(generateAddress(from.bytes, bigIntToBytes(nonce)))
}

/**
 * Generates an address for a contract created using CREATE2.
 * @param from The address which is creating this new address
 * @param salt A salt
 * @param initCode The init code of the contract being created
 */
export function createContractAddress2(
  from: Address,
  salt: Uint8Array,
  initCode: Uint8Array,
): Address {
  if (!(salt instanceof Uint8Array)) {
    throw EthereumJSErrorWithoutCode('Expected salt to be a Uint8Array')
  }
  if (!(initCode instanceof Uint8Array)) {
    throw EthereumJSErrorWithoutCode('Expected initCode to be a Uint8Array')
  }
  return new Address(generateAddress2(from.bytes, salt, initCode))
}
