import { RLP } from '@ethereumjs/rlp'
import { KECCAK256_RLP } from '@ethereumjs/util'
import * as assert from 'assert'
import { keccak256 } from 'ethereum-cryptography/keccak'

import { nibblesTypeToPackedBytes } from '../../util/index.js'
import { bytesToNibbles, matchingNibbleLength } from '../../util/nibbles.js'

import type { Nibbles } from '../../index.js'

function addHexPrefix(key: Nibbles, terminator: boolean): Nibbles {
  // odd
  if (key.length % 2) {
    key.unshift(1)
  } else {
    // even
    key.unshift(0)
    key.unshift(0)
  }

  if (terminator) {
    key[0] += 2
  }

  return key
}

abstract class BaseNode {
  abstract insert(key: Nibbles, value: Uint8Array): BaseNode
  abstract raw(): any
  serialize(): Uint8Array {
    return RLP.encode(this.raw())
  }
  hash(): Uint8Array {
    return keccak256(this.serialize())
  }
}

export class EmptyNode extends BaseNode {
  insert(key: Nibbles, value: Uint8Array): BaseNode {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return new STLeafNode(key, value)
  }

  raw(): (Uint8Array | null)[] | null {
    return null
  }

  serialize(): Uint8Array {
    return new Uint8Array()
  }

  hash(): Uint8Array {
    return KECCAK256_RLP
  }
}

export class HashNode extends BaseNode {
  _ref: BaseNode
  _serialized: Uint8Array
  _hash: Uint8Array

  constructor(ref: BaseNode) {
    super()
    this._ref = ref
    this._serialized = ref.serialize()
    this._hash = keccak256(this._serialized)
  }

  get embedded(): boolean {
    return this._serialized.length < 32
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  insert(key: Nibbles, value: Uint8Array): BaseNode {
    throw new Error("Can't insert into hash node")
  }

  raw(): Uint8Array[] {
    return this._ref.raw()
  }

  serialize(): Uint8Array {
    throw new Error('Cant serialize hashnode')
  }

  hash(): Uint8Array {
    return this._hash
  }
}

export class STBranchNode extends BaseNode {
  _children: (BaseNode | null)[]
  _value: Uint8Array | null

  constructor() {
    super()
    this._children = new Array(16)
    for (let i = 0; i < 16; i++) this._children[i] = null
    this._value = null
  }

  setChild(i: number, child: BaseNode) {
    this._children[i] = child
  }

  insert(key: Nibbles, value: Uint8Array): BaseNode {
    const i = key[0]
    if (!this._children[i]) {
      this._children[i] = new EmptyNode()
    }
    // Hash previously explored branches. We can do this because we assume
    // leaves are being inserted in the ascending key order.
    for (let j = 0; j < i; j++) {
      if (!this._children[j] || this._children[j] instanceof HashNode) continue
      this._children[j] = new HashNode(this._children[j]!)
    }
    this._children[i] = this._children[i]!.insert(key.slice(1), value)
    return this
  }

  raw(): Uint8Array[] {
    const raw = []
    for (let i = 0; i < 16; i++) {
      const child = this._children[i]
      if (!child) {
        raw.push(null)
      } else if (child instanceof HashNode && (<HashNode>child).embedded) {
        raw.push(child.raw())
      } else {
        const childRaw = child.raw()
        const childSerialized = RLP.encode(childRaw)
        if (childSerialized.length < 32) {
          raw.push(childRaw)
        } else {
          raw.push(keccak256(childSerialized))
        }
      }
    }
    raw.push(this._value)
    return raw as []
  }
}

export class STLeafNode extends BaseNode {
  _key: Nibbles
  _value: Uint8Array

  constructor(key: Nibbles, value: Uint8Array) {
    super()
    this._key = key
    this._value = value
  }

  insert(key: Nibbles, value: Uint8Array): BaseNode {
    const commonLen = matchingNibbleLength(this._key, key)
    assert.ok(commonLen < this._key.length, 'replacing leaf is not supported')

    const newLeaf = new STLeafNode(key.slice(commonLen + 1), value)

    const branch = new STBranchNode()
    branch.setChild(key[commonLen], newLeaf)
    branch.setChild(this._key[commonLen], this)

    let root: BaseNode = branch
    // Need extension node for common path
    if (commonLen > 0) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      root = new STExtensionNode(this._key.slice(0, commonLen), branch)
    }

    // Slice common part from current leaf's key
    this._key = this._key.slice(commonLen + 1)

    return root
  }

  raw(): [Uint8Array, Uint8Array] {
    const val: Nibbles = this._key.slice(0)
    const encodedKey = addHexPrefix(val, true) // add terminator value to end of key
    return [nibblesTypeToPackedBytes(encodedKey), this._value]
  }
}

export class STExtensionNode extends BaseNode {
  _key: Nibbles
  _child: BaseNode

  constructor(key: Nibbles, child: BaseNode) {
    super()
    this._key = key
    this._child = child
  }

  insert(key: Nibbles, value: Uint8Array): BaseNode {
    const commonLen = matchingNibbleLength(this._key, key)
    // If matching prefix, recurse into child node
    if (this._key.length === commonLen) {
      this._child = this._child.insert(key.slice(commonLen), value)
      return this
    }

    // Otherwise we'll need a new leaf, a branch and possibly an extension
    const newLeaf = new STLeafNode(key.slice(commonLen + 1), value)

    const branch = new STBranchNode()
    branch.setChild(key[commonLen], newLeaf)

    if (commonLen < this._key.length - 1) {
      branch.setChild(this._key[commonLen], this)
      this._key = this._key.slice(commonLen + 1)
    } else {
      branch.setChild(this._key[commonLen], this._child)
    }

    let root: BaseNode = branch
    // Need extension for common prefix
    if (commonLen > 0) {
      root = new STExtensionNode(key.slice(0, commonLen), branch)
    }

    return root
  }

  raw(): [Uint8Array, Uint8Array] {
    const childRaw = this._child.raw()
    const childSerialized = RLP.encode(childRaw)
    const value = childSerialized.length < 32 ? childRaw : keccak256(childSerialized)
    const encodedKey = addHexPrefix(this._key.slice(0), false)
    return [nibblesTypeToPackedBytes(encodedKey), value]
  }
}

/**
 * Given a list of leaves with keys sorted in the ascending order,
 * re-creates the trie structure hashing up simultaneously the
 * branches that won't be visited again.
 * Implementation based on:
 * https://github.com/holiman/go-ethereum/blob/b7e737bdd87ba51631837f337d128282ff066d24/trie/stacktrie.go
 */
export function merkleizeList(leaves: Uint8Array[][]): Uint8Array {
  let root = new EmptyNode()

  for (const kv of leaves) {
    const key = bytesToNibbles(kv[0])
    root = root.insert(key, kv[1])
  }

  return root.hash()
}
