import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import type { Common } from '@ethereumjs/common'

const BYTE_SIZE = 256

export class Bloom {
  bitvector: Uint8Array
  keccakFunction: (msg: Uint8Array) => Uint8Array

  /**
   * Represents a Bloom filter.
   */
  constructor(bitvector?: Uint8Array, common?: Common) {
    if (common?.customCrypto.keccak256 !== undefined) {
      this.keccakFunction = common.customCrypto.keccak256
    } else {
      this.keccakFunction = keccak256
    }
    if (!bitvector) {
      this.bitvector = new Uint8Array(BYTE_SIZE)
    } else {
      if (bitvector.length !== BYTE_SIZE)
        throw EthereumJSErrorWithoutCode('bitvectors must be 2048 bits long')
      this.bitvector = bitvector
    }
  }

  /**
   * Adds an element to a bit vector of a 64 byte bloom filter.
   * @param e - The element to add
   */
  add(e: Uint8Array) {
    e = this.keccakFunction(e)
    const mask = 2047 // binary 11111111111

    for (let i = 0; i < 3; i++) {
      const first2bytes = new DataView(e.buffer).getUint16(i * 2)
      const loc = mask & first2bytes
      const byteLoc = loc >> 3
      const bitLoc = 1 << (loc % 8)
      this.bitvector[BYTE_SIZE - byteLoc - 1] |= bitLoc
    }
  }

  /**
   * Checks if an element is in the bloom.
   * @param e - The element to check
   */
  check(e: Uint8Array): boolean {
    e = this.keccakFunction(e)
    const mask = 2047 // binary 11111111111
    let match = true

    for (let i = 0; i < 3 && match; i++) {
      const first2bytes = new DataView(e.buffer).getUint16(i * 2)
      const loc = mask & first2bytes
      const byteLoc = loc >> 3
      const bitLoc = 1 << (loc % 8)
      match = (this.bitvector[BYTE_SIZE - byteLoc - 1] & bitLoc) !== 0
    }

    return Boolean(match)
  }

  /**
   * Checks if multiple topics are in a bloom.
   * @returns `true` if every topic is in the bloom
   */
  multiCheck(topics: Uint8Array[]): boolean {
    return topics.every((t: Uint8Array) => this.check(t))
  }

  /**
   * Bitwise or blooms together.
   */
  or(bloom: Bloom) {
    for (let i = 0; i <= BYTE_SIZE; i++) {
      this.bitvector[i] = this.bitvector[i] | bloom.bitvector[i]
    }
  }
}
