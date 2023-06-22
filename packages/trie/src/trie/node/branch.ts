import { RLP } from '@ethereumjs/rlp'

import { ExtensionNode } from './extension.js'
import { LeafNode } from './leaf.js'
import { BaseNode, NullNode } from './node.js'
import { decodeToNode } from './util.js'

import type {
  EncodedChild,
  EncodedValue,
  NodeInterface,
  NodeType,
  TNode,
  TNodeOptions,
} from './types'

export class BranchNode extends BaseNode implements NodeInterface<'BranchNode'> {
  type = 'BranchNode' as const
  keyNibbles: number[]
  value: Uint8Array | null
  branches: (Uint8Array | Uint8Array[])[]
  constructor(options: TNodeOptions<'BranchNode'>) {
    super(options)
    this.keyNibbles = []
    this.branches = options?.branches ?? Array.from({ length: 16 }, () => Uint8Array.from([]))
    this.value = options?.value ?? null
    this.debug && this.debug(`BranchNode created`)
  }
  getType(): NodeType {
    return 'BranchNode'
  }

  encodeChild(child: TNode | undefined): EncodedChild {
    if (child === undefined) return Uint8Array.from([])
    switch (child.getType()) {
      case 'BranchNode':
        return child.rlpEncode().length >= 32 ? child.hash() : (child.raw() as Uint8Array[])
      case 'LeafNode':
        return child.rlpEncode().length >= 32 ? child.hash() : (child.raw() as Uint8Array[])
      case 'ExtensionNode':
        return child.rlpEncode().length >= 32 ? child.hash() : (child.raw() as Uint8Array[])
      case 'ProofNode':
        return child.hash()
      case 'NullNode':
      default:
        return Uint8Array.from([])
    }
  }
  // childrenRlp(): EncodedChild[] {
  //   const children: (Uint8Array | Uint8Array[])[] = Array.from({ length: 16 }, (_, _i) => {
  //     return Uint8Array.from([])
  //   })
  //   const childNodes = await this.getChildren()
  //   for (const [idx, child] of this.getChildren().entries()) {
  //     children[idx] = this.encodeChild(child)
  //   }
  //   return children
  // }
  raw(): [...EncodedChild[], EncodedValue] {
    const childrenRlp = this.branches
    const valueRlp = this.value ?? Uint8Array.from([])
    return [...childrenRlp, valueRlp]
  }
  rlpEncode(): Uint8Array {
    const encodedNode = RLP.encode(this.raw())
    return encodedNode
  }

  hash(): Uint8Array {
    const hashed = this.hashFunction(this.rlpEncode())
    return hashed
  }
  async getChildren(): Promise<Map<number, TNode>> {
    const children: Map<number, TNode> = new Map()
    for (let i = 0; i < 16; i++) {
      const child = await this.getChild(i)
      children.set(i, child)
    }
    return children
  }
  async getChild(key: number): Promise<TNode> {
    const branch = this.branches[key]
    const child = await decodeToNode(RLP.encode(branch))
    return child
  }
  async childNodes(): Promise<Map<number, TNode>> {
    const children: Map<number, TNode> = new Map()
    for (let i = 0; i < 16; i++) {
      const child = await this.getChild(i)
      if (child !== undefined && child.getType() !== 'NullNode') {
        children.set(i, child)
      }
    }
    return children
  }
  childCount(): number {
    return this.branches.filter((b) => b.length > 0).length
  }
  updateChild(newChild: TNode, nibble: number): TNode {
    if (newChild.getType() === 'NullNode' && this.childCount() === 1) {
      this.debug &&
        this.debug.extend('updateChild')(`deleting last child.  node value: ${this.getValue()}`)
      if (this.value instanceof Uint8Array && this.value.length > 0) {
        return new LeafNode({
          key: [],
          value: this.value,
          hashFunction: this.hashFunction,
        })
      } else {
        this.debug && this.debug.extend('updateChild')(`no value, returning NullNode`)
        return new NullNode({ hashFunction: this.hashFunction })
      }
    }
    this.markDirty()
    // this.children[nibble] = newChild.getType() === 'NullNode' ? undefined : newChild
    this.branches[nibble] = this.encodeChild(newChild)
    this.debug &&
      this.debug.extend('updateChild')(
        `updating child on branch:${nibble} to ${newChild.getType()}`
      )
    return this
  }
  async deleteChild(nibble: number): Promise<TNode> {
    this.markDirty()
    return this.updateChild(new NullNode({ hashFunction: this.hashFunction }), nibble)
  }
  updateValue(value: Uint8Array | null): TNode {
    this.markDirty()
    this.debug && this.debug.extend('updateValue')(`value=${value}`)
    this.value = value
    return this
  }
  setChild(slot: number, node: TNode): BranchNode {
    // this.children[slot] = node.getType() === 'NullNode' ? undefined : node
    this.branches[slot] = this.encodeChild(node)
    return this
  }
  getValue(): Uint8Array | null {
    return this.value
  }
  getPartialKey(): number[] {
    return this.keyNibbles
  }
  updateKey(newKeyNibbles: number[]): TNode {
    if (newKeyNibbles.length === 0) {
      return this
    }
    return new ExtensionNode({
      keyNibbles: newKeyNibbles,
      subNode: this,
      hashFunction: this.hashFunction,
    })
  }
  async get(_rawKey: Uint8Array): Promise<Uint8Array | null> {
    throw new Error('Method to be removed.')
  }
  async update(value: Uint8Array): Promise<TNode> {
    return this.updateValue(value)
  }
  async delete(_rawKey: Uint8Array): Promise<TNode> {
    throw new Error('Method to be removed.')
  }
  copy(): TNode {
    return new BranchNode({
      // children: this.children,
      branches: this.branches,
      value: this.value,
      hashFunction: this.hashFunction,
    })
  }
}
