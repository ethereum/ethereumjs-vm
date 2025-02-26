import { RLP } from '@ethereumjs/rlp'
import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'

import { InternalBinaryNode } from './internalNode.js'
import { StemBinaryNode } from './stemNode.js'
import { type BinaryNode, BinaryNodeType } from './types.js'

export function decodeRawBinaryNode(raw: Uint8Array[]): BinaryNode {
  const nodeType = raw[0][0]
  switch (nodeType) {
    case BinaryNodeType.Internal:
      return InternalBinaryNode.fromRawNode(raw)
    case BinaryNodeType.Stem:
      return StemBinaryNode.fromRawNode(raw)
    default:
      throw EthereumJSErrorWithoutCode('Invalid node type')
  }
}

export function decodeBinaryNode(raw: Uint8Array) {
  const decoded = RLP.decode(Uint8Array.from(raw)) as Uint8Array[]
  if (!Array.isArray(decoded)) {
    throw EthereumJSErrorWithoutCode('Invalid node')
  }
  return decodeRawBinaryNode(decoded)
}

export function isRawBinaryNode(node: Uint8Array | Uint8Array[]): node is Uint8Array[] {
  return Array.isArray(node) && !(node instanceof Uint8Array)
}

export function isInternalBinaryNode(node: BinaryNode): node is InternalBinaryNode {
  return node.type === BinaryNodeType.Internal
}

export function isStemBinaryNode(node: BinaryNode): node is StemBinaryNode {
  return node.type === BinaryNodeType.Stem
}
