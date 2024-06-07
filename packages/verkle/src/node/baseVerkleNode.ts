import { RLP } from '@ethereumjs/rlp'

import { type VerkleNodeInterface, type VerkleNodeOptions, type VerkleNodeType } from './types.js'

import type { VerkleCrypto } from 'verkle-cryptography-wasm'

export abstract class BaseVerkleNode<T extends VerkleNodeType> implements VerkleNodeInterface {
  public commitment: Uint8Array
  public depth: number
  protected verkleCrypto: VerkleCrypto
  constructor(options: VerkleNodeOptions[T]) {
    this.commitment = options.commitment
    this.depth = options.depth
    this.verkleCrypto = options.verkleCrypto
  }

  abstract commit(): Uint8Array

  // Hash returns the field representation of the commitment.
  hash(): Uint8Array {
    return this.verkleCrypto.hashCommitment(this.commitment)
  }

  abstract insert(key: Uint8Array, value: Uint8Array, nodeResolverFn: () => void): void

  abstract raw(): Uint8Array[]

  /**
   * @returns the RLP serialized node
   */
  serialize(): Uint8Array {
    return RLP.encode(this.raw())
  }
}
