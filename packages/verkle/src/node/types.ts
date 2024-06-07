import type { InternalNode } from './internalNode.js'
import type { LeafNode } from './leafNode.js'
import type { VerkleCrypto } from 'verkle-cryptography-wasm'

export enum VerkleNodeType {
  Internal,
  Leaf,
}

export interface TypedVerkleNode {
  [VerkleNodeType.Internal]: InternalNode
  [VerkleNodeType.Leaf]: LeafNode
}

export type VerkleNode = TypedVerkleNode[VerkleNodeType]

export interface VerkleNodeInterface {
  commit(): Uint8Array
  hash(verkleCrypto: VerkleCrypto): any
  serialize(): Uint8Array
}

interface BaseVerkleNodeOptions {
  // Value of the commitment
  commitment: Uint8Array
  depth: number
  verkleCrypto: VerkleCrypto
}

interface VerkleInternalNodeOptions extends BaseVerkleNodeOptions {
  // Children nodes of this internal node.
  children?: VerkleNode[]

  // Values of the child commitments before the tree is modified by inserts.
  // This is useful because the delta of the child commitments can be used to efficiently update the node's commitment
  copyOnWrite?: Record<string, Uint8Array>
}
interface VerkleLeafNodeOptions extends BaseVerkleNodeOptions {
  stem: Uint8Array
  values: Uint8Array[]
  c1?: Uint8Array
  c2?: Uint8Array
}

export interface VerkleNodeOptions {
  [VerkleNodeType.Internal]: VerkleInternalNodeOptions
  [VerkleNodeType.Leaf]: VerkleLeafNodeOptions
}

export const NODE_WIDTH = 256
