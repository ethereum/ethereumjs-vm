import type { HashFunction } from '../../types'
import type { Debugger } from 'debug'

export const nodeType = {
  NullNode: 'NullNode',
  ProofNode: 'ProofNode',
  LeafNode: 'LeafNode',
  BranchNode: 'BranchNode',
  ExtensionNode: 'ExtensionNode',
} as const

export type EncodedValue = Uint8Array
export type EncodedKey = Uint8Array
export type EncodedChild = Uint8Array | Uint8Array[]
export type NodeType = keyof typeof nodeType
export interface NodeOptions {
  source?: Debugger
  hashFunction?: HashFunction
  value?: Uint8Array | null
}

export type TNodeOptions<T extends NodeType> = T extends 'LeafNode'
  ? { key: number[]; value: Uint8Array | null } & NodeOptions
  : T extends 'BranchNode'
  ? {
      // children?: (TNode | undefined)[]
      branches?: (Uint8Array | Uint8Array[])[]
      value: Uint8Array | null
    } & NodeOptions
  : T extends 'ExtensionNode'
  ? { keyNibbles: number[]; subNode: TNode } & NodeOptions
  : T extends 'ProofNode'
  ? {
      hash: Uint8Array
      load: () => Promise<TNode | undefined>
      nibbles: number[]
      rlp?: Uint8Array
      next?: Uint8Array
    } & NodeOptions
  : T extends 'NullNode'
  ? NodeOptions
  : never

export interface NodeInterface<T extends NodeType> {
  debug?: Debugger
  type: T | undefined
  hashFunction: HashFunction
  keyNibbles: number[]
  dirty: boolean
  markDirty(): void
  isDirty(): boolean
  getPartialKey(): number[]
  raw(): any
  rlpEncode(): Uint8Array
  hash(): Uint8Array
  get(rawKey: Uint8Array): Promise<Uint8Array | null>
  getChildren(): Promise<Map<number, TNode>>
  getChild(key?: number): Promise<TNode>
  deleteChild(nibble: number): Promise<TNode>
  updateChild(newChild: TNode, nibble?: number): TNode
  updateValue(newValue: Uint8Array | null): TNode
  updateKey(key: number[]): TNode
  getValue(): Uint8Array | null
  getType(): NodeType
  update(value: Uint8Array | null): Promise<TNode>
  delete(rawKey?: Uint8Array): Promise<TNode>
  copy(): TNode
}

export interface NullNodeInterface extends Omit<NodeInterface<'NullNode'>, 'keyNibbles'> {}

export interface LeafInterface extends NodeInterface<'LeafNode'> {
  value: Uint8Array | null
}
export interface BranchInterface extends NodeInterface<'BranchNode'> {
  childNodes(): Promise<Map<number, TNode>>
  childCount(): number
  // children: (TNode | undefined)[]
  value: Uint8Array | null
}
export interface ExtensionInterface extends NodeInterface<'ExtensionNode'> {
  child: TNode
}

export interface ProofNodeInterface extends NodeInterface<'ProofNode'> {
  load: () => Promise<TNode | undefined>
}

export type TNode =
  | LeafInterface
  | BranchInterface
  | ExtensionInterface
  | NullNodeInterface
  | ProofNodeInterface
