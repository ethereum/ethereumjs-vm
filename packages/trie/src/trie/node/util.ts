import { RLP } from '@ethereumjs/rlp'
import debug from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { isTerminator, removeHexPrefix } from '../../util/hex.js'
import { bytesToNibbles } from '../../util/nibbles.js'

import { BranchNode, ExtensionNode, LeafNode, NullNode, ProofNode } from './index.js'

import type { NodeType, TNode } from './types.js'
import type { Debugger } from 'debug'

export function getNodeType(raw: Uint8Array | Uint8Array[]): NodeType {
  const type =
    raw.length === 32
      ? 'ProofNode'
      : raw.length === 17
      ? 'BranchNode'
      : raw.length === 2 && (raw[1] as Uint8Array).length === 32
      ? 'ExtensionNode'
      : raw.length === 2 && (raw[1] as Uint8Array).length === 17
      ? 'ExtensionNode'
      : raw.length === 2
      ? 'LeafNode'
      : 'NullNode'
  if (!type) {
    throw new Error(`Unknown node type with ${raw.length} parts: ${type}`)
  }
  return type
}
export async function decodeToNode(
  encoded: Uint8Array,
  d_bug: Debugger = debug('Trie:decodeToNode')
): Promise<TNode> {
  if (encoded.length === 0) {
    d_bug(`node=NullNode`)
    return new NullNode({})
  } else {
    const raw = RLP.decode(encoded) as Uint8Array[]
    d_bug(`raw=${raw}`)
    const type = getNodeType(raw)
    d_bug = d_bug.extend(type)
    switch (type) {
      case 'LeafNode': {
        const [encodedkey, value] = raw
        const decodedkey = bytesToNibbles(encodedkey as Uint8Array)
        const key = removeHexPrefix(decodedkey)
        d_bug.extend('LeafNode')(`key=${key}, value=${value}`)
        return new LeafNode({
          key,
          value: value as Uint8Array,
        })
      }
      case 'BranchNode': {
        const value = raw[16] as Uint8Array
        d_bug.extend('BranchNode')(`value=${value}`)
        // const children: TNode[] = []
        // for (let i = 0; i < raw.length - 1; i++) {
        //   const branch = raw[i] as Uint8Array
        //   if (branch.length > 0) {
        //     try {
        //       const node = await decodeToNode(RLP.encode(branch), d_bug)
        //       d_bug.extend(`branch[${branch}]`)(`decoded into ${node.getType()}`)
        //       children.push(node)
        //     } catch {
        //       d_bug(`can't decode branch[${i}]=${branch}`)
        //     }
        //   }
        // }
        const decoded = new BranchNode({
          branches: raw.slice(0, 16),
          value,
        })

        return decoded
      }
      case 'ExtensionNode': {
        const [key, subNodeRlp] = raw
        d_bug.extend('ExtensionNode')(`key=${key}, subNodeRlp=${subNodeRlp}`)
        const subNode = await decodeToNode(RLP.encode(subNodeRlp) as Uint8Array, d_bug)
        d_bug.extend('ExtensionNode')(
          `decoded with keyNibbles=${key} and child=${subNode.getType()}`
        )
        return new ExtensionNode({
          keyNibbles: removeHexPrefix(bytesToNibbles(key as Uint8Array)),
          subNode,
        })
      }
      case 'NullNode': {
        return new NullNode({})
      }
      case 'ProofNode': {
        return new ProofNode({
          hash: RLP.decode(encoded) as Uint8Array,
          nibbles: [],
          load: async () => new NullNode({}),
        })
      }
      default:
        throw new Error(`Unknown node type: ${type}`)
    }
  }
}

export function decodeRawNode(raw: Uint8Array[]): TNode {
  if (raw.length === 17) {
    return new BranchNode({ branches: raw.slice(0, 16), value: raw[16] })
  } else if (raw.length === 2) {
    const nibbles = bytesToNibbles(raw[0])
    if (isTerminator(nibbles)) {
      return new LeafNode({ key: nibbles, value: raw[1] })
    }
    const child = new ProofNode({
      hash: keccak256(raw[1]),
      rlp: raw[1],
      nibbles: [],
      load: async () => {
        throw new Error('method not available')
      },
    })
    return new ExtensionNode({
      keyNibbles: nibbles,
      subNode: child,
    })
  } else {
    throw new Error('Invalid node')
  }
}

export function decodeNode(raw: Uint8Array) {
  const des = RLP.decode(Uint8Array.from(raw)) as Uint8Array[]
  if (!Array.isArray(des)) {
    throw new Error('Invalid node')
  }
  return decodeRawNode(des)
}

export function isRawNode(n: any) {
  return Array.isArray(n) && !(n instanceof Uint8Array)
}
