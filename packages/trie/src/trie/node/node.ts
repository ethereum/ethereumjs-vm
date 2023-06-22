import { RLP } from '@ethereumjs/rlp'
import debug from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak'

import { bytesToNibbles } from '../../util/nibbles.js'

import { LeafNode } from './leaf'

import type { HashFunction } from '../../types.js'
import type { NodeInterface, NodeType, TNode, TNodeOptions } from './types.js'
import type { Debugger } from 'debug'

export abstract class BaseNode {
  public type: NodeType
  debug: Debugger | undefined
  hashFunction: HashFunction
  dirty: boolean
  constructor(_args: TNodeOptions<NodeType>) {
    this.type = 'NullNode'
    this.debug = debug(this.constructor.name)
    if (!this.debug.enabled) {
      this.debug = undefined
    }
    this.hashFunction = _args.hashFunction ?? keccak256
    this.dirty = false
    _args.source && _args.source(`creating ${this.constructor.name}`)
  }
  abstract get(rawKey?: Uint8Array): Promise<Uint8Array | null>
  abstract rlpEncode(): Uint8Array
  abstract update(value: Uint8Array): Promise<TNode>
  abstract getChild(key?: number): Promise<TNode | undefined>
  abstract deleteChild(nibble: number): Promise<TNode>
  abstract updateChild(newChild: TNode, nibble?: number): TNode
  abstract updateValue(newValue: Uint8Array | null): TNode
  abstract updateKey(key: number[]): TNode
  abstract getChildren(): Promise<Map<number, TNode>>
  abstract getValue(): Uint8Array | null
  abstract getPartialKey(): number[]
  abstract getType(): NodeType
  abstract delete(rawKey?: Uint8Array): Promise<TNode>
  abstract copy(): TNode
  markDirty(): void {
    this.dirty = true
  }
  isDirty(): boolean {
    return this.dirty
  }
}

export class NullNode extends BaseNode {
  type: 'NullNode' = 'NullNode'
  constructor(options: TNodeOptions<'NullNode'>) {
    super(options)
  }
  raw(): Uint8Array {
    return Uint8Array.from([])
  }
  rlpEncode(): Uint8Array {
    return RLP.encode(Uint8Array.from(0x80))
  }
  hash(): Uint8Array {
    return this.hashFunction(this.rlpEncode())
  }
  async get(): Promise<Uint8Array | null> {
    return null
  }
  async getChildren(): Promise<Map<number, TNode>> {
    throw new Error('Cannot get children of NullNode')
  }
  async getChild(_key: number): Promise<TNode> {
    throw new Error('Cannot get child of NullNode')
  }
  getType(): NodeType {
    return 'NullNode'
  }
  updateChild(_newChild: TNode, _nibble?: number): TNode {
    throw new Error('Cannot update child of NullNode')
  }
  async deleteChild(_nibble: number) {
    return this
  }
  updateValue(_newValue: Uint8Array | null): TNode {
    return this
  }
  getPartialKey(): number[] {
    return []
  }
  getValue(): Uint8Array | null {
    return null
  }
  updateKey(_newKey: number[]): TNode {
    return this
  }
  async update(value: Uint8Array): Promise<TNode> {
    const newNode = new LeafNode({
      key: bytesToNibbles(this.hashFunction(value)),
      value,
      hashFunction: this.hashFunction,
    })
    return newNode
  }
  async delete() {
    return this
  }
  copy(): TNode {
    return this
  }
}

export class ProofNode extends BaseNode implements NodeInterface<'ProofNode'> {
  type: 'ProofNode' = 'ProofNode'
  _hash: Uint8Array
  keyNibbles: number[]
  load: () => Promise<TNode | undefined>
  next: Uint8Array
  _rlp?: Uint8Array
  constructor(options: TNodeOptions<'ProofNode'>) {
    super({})
    this._hash = options.hash
    this._rlp = options.rlp
    this.load = options.load
    this.keyNibbles = []
    this.next = options.next ?? Uint8Array.from([])
  }

  copy(): TNode {
    return new ProofNode({
      hash: this._hash,
      nibbles: this.keyNibbles,
      next: this.next,
      load: this.load,
      hashFunction: this.hashFunction,
    })
  }
  hash(): Uint8Array {
    return this._hash
  }
  raw(): Uint8Array {
    throw new Error('Method does not exist for proofnode')
  }
  rlpEncode(): Uint8Array {
    throw new Error('Method does not exist for proofnode')
  }
  encodeAsChild(): Uint8Array {
    return this.hash()
  }
  async get(): Promise<Uint8Array | null> {
    throw new Error('Method does not exist for proofnode')
  }
  async getChildren(): Promise<Map<number, TNode>> {
    throw new Error('Method does not exist for proofnode')
  }
  async getChild(_key: number): Promise<TNode> {
    throw new Error('Method does not exist for proofnode')
  }
  getType(): NodeType {
    return 'ProofNode'
  }
  updateChild(_newChild: TNode, _nibble?: number): TNode {
    throw new Error('Method does not exist for proofnode')
  }
  async deleteChild(_nibble: number): Promise<TNode> {
    throw new Error('Method does not exist for proofnode')
  }
  updateValue(_newValue: Uint8Array | null): TNode {
    throw new Error('Method does not exist for proofnode')
  }
  getPartialKey(): number[] {
    return []
  }
  getValue(): Uint8Array | null {
    return null
  }
  updateKey(_newKey: number[]): TNode {
    throw new Error('Method does not exist for proofnode')
  }
  async update(_value: Uint8Array): Promise<Exclude<TNode, NullNode>> {
    throw new Error('Method does not exist for proofnode')
  }
  async delete() {
    return this
  }
}
