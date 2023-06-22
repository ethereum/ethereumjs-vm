import { RLP } from '@ethereumjs/rlp'
import { bytesToPrefixedHexString, equalsBytes } from '@ethereumjs/util'
import debug from 'debug'

import { isTerminator, removeHexPrefix } from '../../util/hex.js'
import { bytesToNibbles } from '../../util/nibbles.js'
import { BranchNode, ExtensionNode, LeafNode, NullNode, ProofNode } from '../node/index.js'

import type { MerklePatriciaTrie } from '../merklePatricia.js'
import type { TNode } from '../node/types.js'
import type { Debugger } from 'debug'

export async function decodeNode(
  this: MerklePatriciaTrie,
  encoded: Uint8Array,
  d_bug?: Debugger
): Promise<TNode> {
  const dbug = d_bug ? d_bug.extend('decode') : this.debug.extend('decode')
  const encodedLength = encoded.length
  const decoded = RLP.decode(encoded) as Uint8Array[]
  const decodedLength = decoded.length
  let node: TNode
  let subNode: TNode
  dbug(`encoded: (${encoded})`)
  dbug(
    `decoded: (${decoded.map((d) => {
      return `[${d}]`
    })})`
  )
  switch (decodedLength) {
    case 0: {
      dbug(`encoding as NullNode`)
      return new NullNode({})
    }
    case 2:
      {
        if (isTerminator(bytesToNibbles(decoded[0]))) {
          dbug(`decoding as LeafNode: (${decoded[0]}) => (${decoded[1]})`)
          return new LeafNode({
            key: removeHexPrefix(bytesToNibbles(decoded[0])),
            value: decoded[1],
            hashFunction: this.hashFunction,
            source: dbug,
          })
        }
        dbug(`decoded.length: (${decoded.length})`)
        dbug(`decoded[0].length: (${decoded[0].length})`)
        dbug(`decoded[1].length: (${decoded[1].length})`)
        switch (decoded[1].length) {
          case 32: {
            return this._decodeExtensionNode(encoded, dbug)
          }
          case 17: {
            dbug(`subNode is a BranchNode -- decoding...`)
            subNode = await this._decodeBranchNode(RLP.encode(decoded[1]), dbug)
            return new ExtensionNode({
              keyNibbles: removeHexPrefix(bytesToNibbles(decoded[0])),
              subNode,
            })
          }
          default:
            dbug(`building new LeafNode`)
            node = new LeafNode({
              key: removeHexPrefix(bytesToNibbles(decoded[0])),
              value: decoded[1],
              hashFunction: this.hashFunction,
              source: dbug,
            })
            if (equalsBytes(node.hash(), this.hashFunction(encoded))) {
              return node
            }
        }
      }
      return node
    case 17: {
      node = await this._decodeBranchNode(encoded, dbug)
      dbug(`decoding as BranchNode`)
      return node
    }
    case 32: {
      const node = await this._decodeHashedChild(encoded, dbug)
      dbug(`decoding as ${node.getType()}`)
      return node
    }
    default:
      break
  }
  throw new Error(`encoded length (${encodedLength}) -- decoded length (${decodedLength})`)
}
export async function decodeHashedChild(
  this: MerklePatriciaTrie,
  encoded: Uint8Array,
  d_bug?: Debugger
): Promise<TNode> {
  const dbug = d_bug ? d_bug.extend('_Hashed') : debug('decodeHashed')
  dbug(`branch is a hash`)
  let node = await this.lookupNodeByHash(encoded as Uint8Array, dbug)
  if (node) {
    dbug(`${node.getType()} found node in db`)
    return node
  }
  node = new ProofNode({
    nibbles: [],
    hash: encoded as Uint8Array,
    load: async () => (await this.lookupNodeByHash(encoded as Uint8Array)) ?? node!.copy(),
    hashFunction: this.hashFunction,
    source: dbug,
  })
  dbug(`decoded branch into ProofNode`)
  return node
}

export async function decodeLeafNode(
  this: MerklePatriciaTrie,
  encoded: Uint8Array,
  d_bug?: Debugger
) {
  d_bug = d_bug ? d_bug.extend('decodeLeaf') : debug('decodeLeaf')
  d_bug(`encoded: ${bytesToPrefixedHexString(encoded)}`)
  const [key, value] = RLP.decode(encoded) as Uint8Array[]
  const node = new LeafNode({
    key: bytesToNibbles(key),
    value,
    hashFunction: this.hashFunction,
    source: d_bug,
  })

  return node
}

export async function decodeBranchNode(
  this: MerklePatriciaTrie,
  encoded: Uint8Array,
  dbug?: Debugger
): Promise<BranchNode> {
  dbug = dbug ? dbug.extend('_Branch') : debug('decodeBranch')
  const _decoded = RLP.decode(encoded) as Uint8Array[]
  for (const [i, e] of _decoded.entries()) {
    if (e.length === 32) {
      dbug.extend(`[${i}]`)(` ${bytesToPrefixedHexString(e as Uint8Array)}`)
    } else if (e.length > 0) {
      dbug.extend(`[${i}]`)(`length=${e.length} [${e}]`)
    }
  }
  // const raw = RLP.decode(encoded as Uint8Array) as EncodedChild[]
  const value = _decoded[16] as Uint8Array
  // const branches: EncodedChild[] = Array.from({ length: 16 }, (_, i) => raw[i])
  const decoded = new BranchNode({
    value,
    hashFunction: this.hashFunction,
    source: dbug,
  })
  for await (const [i, branch] of _decoded.slice(0, 16).entries()) {
    dbug.extend(`child[${i}]`)(`(${branch.length})`)
    decoded.branches[i] = branch
  }
  return decoded
}

export async function decodeExtensionNode(
  this: MerklePatriciaTrie,
  encoded: Uint8Array,
  dbug?: Debugger
): Promise<TNode> {
  dbug = dbug ? dbug.extend('_Extension') : debug('decodeExt')
  dbug(`encoded: ${encoded}`)
  const [key, subNode] = RLP.decode(encoded) as Uint8Array[]
  let child: TNode
  if (subNode.length < 32) {
    child = await this._decodeToNode(RLP.encode(subNode))
    dbug(`child: ${child.getType()}`)
  }
  if (subNode.length === 32) {
    child =
      (await this.lookupNodeByHash(subNode, dbug)) ??
      new ProofNode({
        hash: subNode as Uint8Array,
        nibbles: [],
        load: async () => (await this.lookupNodeByHash(subNode)) ?? child.copy(),
        hashFunction: this.hashFunction,
        source: dbug,
      })
  } else {
    child = await decodeNode.bind(this)(subNode, dbug)
  }
  const decoded = new ExtensionNode({
    keyNibbles: removeHexPrefix(bytesToNibbles(key)),
    subNode: child,
    hashFunction: this.hashFunction,
    source: dbug,
  })
  return decoded
}
