import { bytesToPrefixedHexString, equalsBytes } from '@ethereumjs/util'
import { Mutex } from 'async-mutex'
import debug from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak'

// import { getChildOf, unsetInternal } from '../proof/rangeHelpers'

import { unset, unsetInternal } from '../proof/rangeHelpers'
import { bytesToNibbles } from '../util/index.js'

import { NullNode, ProofNode } from './node/index.js'
import { _cleanupBranchNode, _cleanupExtensionNode, _cleanupNode } from './operations/cleanup.js'
import {
  decodeBranchNode,
  decodeExtensionNode,
  decodeHashedChild,
  decodeLeafNode,
  decodeNode,
} from './operations/decode.js'
import { _deleteAtNode } from './operations/delete.js'
import { _getNodePath } from './operations/getNode.js'
import { _insertAtNode } from './operations/insert.js'
import { _walk } from './operations/walkTrie.js'

import type { MerklePatriciaTrieOptions, PathToNode } from '../types.js'
import type { TNode } from './node/types.js'
import type { Debugger } from 'debug'

export class MerklePatriciaTrie {
  static async create(options: MerklePatriciaTrieOptions): Promise<MerklePatriciaTrie> {
    return new MerklePatriciaTrie(options)
  }
  private _operationMutex: Mutex
  EMPTY_TRIE_ROOT: Uint8Array = Uint8Array.from([0x80])
  debug: Debugger
  hashFunction: (data: Uint8Array) => Uint8Array
  _rootNode: TNode
  nodes?: Map<Uint8Array, TNode>
  _root: Uint8Array

  constructor(options: MerklePatriciaTrieOptions = {}) {
    this.hashFunction = options.hashFunction ?? keccak256
    this._root = options.rootHash ?? this.EMPTY_TRIE_ROOT
    this._rootNode = options.root
      ? options.root
      : options.rootHash
      ? new ProofNode({
          hash: options.rootHash,
          load: async () => this.lookupNodeByHash(options.rootHash!),
          nibbles: [],
          hashFunction: this.hashFunction,
        })
      : new NullNode({ hashFunction: this.hashFunction })
    this.nodes = new Map()
    this.debug = options.debug ? options.debug.extend(`Trie`) : debug('Trie')
    this._operationMutex = new Mutex()
  }
  async _withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this._operationMutex.acquire()
    try {
      return await operation()
    } finally {
      this._operationMutex.release()
    }
  }
  root(hash?: Uint8Array) {
    if (hash && equalsBytes(hash, this.EMPTY_TRIE_ROOT)) {
      this.debug(`Setting root to EMPTY (${bytesToPrefixedHexString(hash)})`)
      this._root = hash
      this._rootNode = new NullNode({})
      return this.EMPTY_TRIE_ROOT
    }
    this._root = hash ?? this._root
    return this._root
  }
  async rootNode(): Promise<TNode> {
    return this._rootNode
  }
  async lookupNodeByHash(
    hash: Uint8Array,
    debug: Debugger = this.debug
  ): Promise<TNode | undefined> {
    debug.extend(`lookupNodeByHash`)(
      `node for ${bytesToPrefixedHexString(hash)}${this.nodes!.has(hash) ? 'found' : 'not found'}`
    )
    return this.nodes!.get(hash)
  }
  async setRootByHash(rootHash: Uint8Array): Promise<Uint8Array> {
    const debug = this.debug.extend('setRootByHash')
    debug(`Setting root by hash: ${bytesToPrefixedHexString(rootHash)}`)
    if (equalsBytes(rootHash, this.EMPTY_TRIE_ROOT)) {
      this._rootNode = new NullNode({ hashFunction: this.hashFunction })
      return this._rootNode.hash()
    }

    const newRoot = await this.lookupNodeByHash(rootHash)
    if (!newRoot) {
      debug(
        `key: ${bytesToPrefixedHexString(
          rootHash
        )} returned null from DB -- setting ProofNode as root`
      )
      const proofRoot = new ProofNode({
        hash: rootHash,
        load: async () => this.lookupNodeByHash(rootHash),
        nibbles: [],
        next: Uint8Array.from([]),
        hashFunction: this.hashFunction,
      })
      this._rootNode = proofRoot
      return proofRoot.hash()
    }
    debug(`Setting root to ${newRoot.getType()}: ${newRoot.hash()}`)
    this._rootNode = newRoot
    return this._rootNode.hash()
  }
  async checkRoot(root: Uint8Array): Promise<boolean> {
    const node = await this.lookupNodeByHash(root)
    return node !== null ? true : false
  }
  async resolveProofNode(node: TNode): Promise<TNode> {
    if (node instanceof ProofNode) {
      const lookup = await this.lookupNodeByHash(node.hash())
      if (lookup) {
        return lookup
      }
      throw new Error(`ProofNode ${bytesToPrefixedHexString(node.hash())} not found in DB`)
    }
    return node
  }
  async storeNode(node: TNode, debug: Debugger = this.debug): Promise<void> {
    if (node.getType() === 'NullNode') {
      return
    }
    debug.extend('storeNode')(
      `[${node.getPartialKey()}] with hash: ${bytesToPrefixedHexString(node.hash())}`
    )
    this.nodes!.set(node.hash(), node)
  }
  async getPath(key: Uint8Array): Promise<PathToNode> {
    const { path, remainingNibbles } = await this._getNodePath(bytesToNibbles(key), this.debug)
    return { path, remainingNibbles }
  }
  async getNode(key: Uint8Array, debug: Debugger = this.debug): Promise<TNode> {
    const { node } = await this._getNodePath(bytesToNibbles(key), debug)
    return node
  }

  /** {@link decodeNode} */
  _decodeToNode = decodeNode.bind(this)
  _decodeHashedChild = decodeHashedChild.bind(this)
  _decodeLeafNode = decodeLeafNode.bind(this)
  _decodeExtensionNode = decodeExtensionNode.bind(this)
  _decodeBranchNode = decodeBranchNode.bind(this)

  /** {@link getChildOf} */
  // _getChildOf = getChildOf.bind(this)
  /** {@link _getNodePath} */
  _getNodePath = _getNodePath.bind(this)
  /** {@link _insertAtNode }*/
  _insertAtNode = _insertAtNode.bind(this)
  /** {@link _deleteAtNode }*/
  _deleteAtNode = _deleteAtNode.bind(this)
  /** {@link _cleanupNode }*/
  _cleanupNode = _cleanupNode.bind(this)
  /** {@link _cleanupBranchNode }*/
  _cleanupBranchNode = _cleanupBranchNode.bind(this)
  /** {@link _cleanupExtensionNode }*/
  _cleanupExtensionNode = _cleanupExtensionNode.bind(this)
  /** {@link unset } */
  unset = unset.bind(this)
  /** {@link unsetInternal } */
  unsetInternal = unsetInternal
  /** {@link _walk } */
  _walk = _walk.bind(this)
}
