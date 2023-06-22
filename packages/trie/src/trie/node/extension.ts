import { RLP } from '@ethereumjs/rlp'
import { bytesToPrefixedHexString } from '@ethereumjs/util'

import { addHexPrefix } from '../../util/hex'
import {
  bytesToNibbles,
  concatNibbles,
  hasMatchingNibbles,
  nibblestoBytes,
} from '../../util/nibbles.js'

import { LeafNode } from './leaf.js'
import { BaseNode, NullNode } from './node.js'

import type {
  EncodedChild,
  EncodedKey,
  NodeInterface,
  NodeType,
  TNode,
  TNodeOptions,
} from './types.js'

export class ExtensionNode extends BaseNode implements NodeInterface<'ExtensionNode'> {
  type = 'ExtensionNode' as const
  keyNibbles: number[]
  child: TNode
  // _subNode: Uint8Array | Uint8Array[]

  constructor(options: TNodeOptions<'ExtensionNode'>) {
    super(options)
    this.keyNibbles = options.keyNibbles
    this.child = options.subNode
    // this._subNode = this.child.raw()
    if (options.source) {
      options.source = options.source.extend('ExtensionNode').extend(`[${this.keyNibbles}]`)

      options.source(`child={${this.child.getType()}: [${this.child.getPartialKey()}]}`)
      options.source.extend('ExtensionNode')(`hash=${bytesToPrefixedHexString(this.hash())}`)
    } else if (this.debug) {
      this.debug(`key=[${this.keyNibbles}]`)
      this.debug(`child={${this.child.getType()}: [${this.child.getPartialKey()}]}`)
      if (this.child.getType() === 'LeafNode' || this.child.getType() === 'BranchNode') {
        this.debug(
          `child.value=${
            this.child.getValue() ? bytesToPrefixedHexString(this.child.getValue()!) : 'null'
          }`
        )
      }
      this.debug(`childHash={${bytesToPrefixedHexString(this.child.hash())}`)
      this.debug(`hash=${bytesToPrefixedHexString(this.hash())}`)
    }
  }
  prefixedNibbles(): number[] {
    const nibbles = this.keyNibbles
    return addHexPrefix(nibbles, false)
  }
  encodedKey(): Uint8Array {
    return nibblestoBytes(this.prefixedNibbles())
  }
  encodedChild(): EncodedChild {
    switch (this.child.getType()) {
      case 'BranchNode':
        return this.child.rlpEncode().length >= 32 ? this.child.hash() : this.child.raw()
      case 'LeafNode':
        return this.child.rlpEncode().length >= 32 ? this.child.hash() : this.child.raw()
      case 'ExtensionNode':
        return this.child.rlpEncode().length >= 32 ? this.child.hash() : this.child.raw()
      case 'ProofNode':
        return this.child.hash()
      case 'NullNode':
      default:
        throw new Error('Invalid node type')
    }
  }
  raw(): [EncodedKey, EncodedChild] {
    return [this.encodedKey(), this.encodedChild()]
  }
  rlpEncode(): Uint8Array {
    return RLP.encode(this.raw())
  }
  hash(): Uint8Array {
    return this.hashFunction(this.rlpEncode())
  }
  async getChildren(): Promise<Map<number, TNode>> {
    return new Map().set(0, this.child)
  }
  async getChild(_key: number = 0): Promise<TNode> {
    return this.child
  }
  getType(): NodeType {
    return 'ExtensionNode'
  }
  async deleteChild(_nibble: number): Promise<TNode> {
    return new NullNode({ hashFunction: this.hashFunction })
  }
  updateKey(newKey: number[]): TNode {
    this.markDirty()
    this.keyNibbles = newKey
    return this
  }
  updateChild(newNode: TNode): TNode {
    this.markDirty()
    this.child = newNode
    return this
  }
  updateValue(_newValue: Uint8Array | null): TNode {
    throw new Error('method does not exist')
  }

  getValue(): Uint8Array | null {
    return null
  }
  getPartialKey(): number[] {
    return this.keyNibbles
  }
  async get(_rawKey: Uint8Array): Promise<Uint8Array | null> {
    throw new Error('method to be deleted')
  }

  async update(value: Uint8Array): Promise<TNode> {
    this.debug && this.debug.extend('update')(`value=${value}`)
    const updatedChild = this.child.updateValue(value)
    return this.updateChild(updatedChild)
  }

  async delete(rawKey: Uint8Array): Promise<TNode> {
    const key = bytesToNibbles(rawKey)
    this.debug && this.debug.extend('delete')(`[${key}]`)

    if (!hasMatchingNibbles(this.keyNibbles, key)) {
      this.debug && this.debug.extend('delete')(`key does not match`)
      return this
    }
    const remainingKey = key.slice(this.keyNibbles.length)
    this.debug && this.debug.extend('delete')(`remainingKey=${remainingKey}`)
    const updatedChild = await this.child.delete(nibblestoBytes(remainingKey))
    if (updatedChild instanceof NullNode) {
      return updatedChild
    }
    if (updatedChild instanceof LeafNode) {
      const newPartialKey = concatNibbles(this.getPartialKey(), updatedChild.getPartialKey())
      this.updateKey(newPartialKey)
      this.updateChild(updatedChild)
      return this
    }
    this.updateChild(updatedChild)
    return this
  }
  copy(): ExtensionNode {
    return new ExtensionNode({
      keyNibbles: this.keyNibbles,
      subNode: this.child,
      hashFunction: this.hashFunction,
    })
  }
}
