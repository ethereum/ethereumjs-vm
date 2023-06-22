import { RLP } from '@ethereumjs/rlp'
import { bytesToPrefixedHexString } from '@ethereumjs/util'
import { equalsBytes } from 'ethereum-cryptography/utils'

import { addHexPrefix } from '../../util/hex.js'
import { bytesToNibbles, doKeysMatch, nibblestoBytes } from '../../util/nibbles.js'

import { BaseNode, NullNode } from './node.js'

import type { NodeInterface, NodeType, TNode, TNodeOptions } from './types.js'

export class LeafNode extends BaseNode implements NodeInterface<'LeafNode'> {
  type = 'LeafNode' as const
  keyNibbles: number[]
  value: Uint8Array | null
  constructor(options: TNodeOptions<'LeafNode'>) {
    super(options)
    this.keyNibbles = options.key
    this.value = options.value
    this.debug && this.debug(`nibbles: ${this.keyNibbles}`)
    this.debug && this.debug(`value: ${this.value}`)
    this.debug && this.debug(`hash: ${bytesToPrefixedHexString(this.hash())}`)
  }
  prefixedNibbles(): number[] {
    const nibbles = this.keyNibbles
    return addHexPrefix(nibbles, true)
  }
  encodedKey(): Uint8Array {
    return nibblestoBytes(this.prefixedNibbles())
  }
  raw(): Uint8Array[] {
    return [this.encodedKey(), this.getValue()]
  }
  rlpEncode(): Uint8Array {
    const encodedNode = RLP.encode(this.raw())
    return encodedNode
  }
  hash(): Uint8Array {
    const hashed = this.hashFunction(this.rlpEncode())
    return hashed
  }
  async get(rawKey: Uint8Array): Promise<Uint8Array | null> {
    const result = equalsBytes(this.encodedKey(), rawKey) ? this.value : null
    return result
  }
  async getChildren(): Promise<Map<number, TNode>> {
    throw new Error('LeafNode does not have children')
  }
  async getChild(_key: number): Promise<TNode> {
    throw new Error('LeafNode does not have children')
  }
  getValue(): Uint8Array {
    return this.value ?? Uint8Array.from([])
  }
  getPartialKey(): number[] {
    return this.keyNibbles
  }
  getType(): NodeType {
    return 'LeafNode'
  }
  async update(value: Uint8Array | null): Promise<LeafNode> {
    return this.updateValue(value)
  }
  updateValue(value: Uint8Array | null): LeafNode {
    this.markDirty()
    this.debug && this.debug.extend('updateValue')(`value=${value}`)
    this.value = value
    return new LeafNode({ key: this.keyNibbles, value, hashFunction: this.hashFunction })
  }
  updateChild(_node: TNode = new NullNode({ hashFunction: this.hashFunction })): TNode {
    throw new Error('LeafNode does not have children')
  }
  async deleteChild(_nibble: number): Promise<TNode> {
    return this
  }
  updateKey(newKeyNibbles: number[]): LeafNode {
    this.markDirty()
    this.keyNibbles = newKeyNibbles
    return this
  }
  async delete(rawKey: Uint8Array): Promise<TNode> {
    const key = bytesToNibbles(rawKey)
    if (doKeysMatch(this.getPartialKey(), key)) {
      return new NullNode({ hashFunction: this.hashFunction })
    }
    return this
  }
  copy(): TNode {
    return new LeafNode({
      key: this.keyNibbles,
      value: this.getValue(),
      hashFunction: this.hashFunction,
    })
  }
}
