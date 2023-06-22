import { bytesToPrefixedHexString, equalsBytes, hexStringToBytes } from '@ethereumjs/util'
import { LRUCache } from 'lru-cache'

import { TrieDatabase } from '../db/index.js'
import { ROOT_DB_KEY } from '../types.js'

import { MerklePatriciaTrie } from './merklePatricia.js'
import { NullNode, ProofNode } from './node/index.js'
import {
  _garbageCollect,
  _markReachableNodes,
  _verifyPrunedIntegrity,
} from './operations/garbageCollection.js'

import type { TrieDBOptions } from '../types.js'
import type { TNode } from './node/types.js'
import type { Debugger } from 'debug'

export class TrieWithDB extends MerklePatriciaTrie {
  static async create(options: TrieDBOptions): Promise<TrieWithDB> {
    const trie = new TrieWithDB(options)
    if (trie.persistent && options.rootNodeRLP) {
      await trie.database().put(trie.hashFunction(options.rootNodeRLP), options.rootNodeRLP)
      await trie.database().put(trie.keySecure(ROOT_DB_KEY), options.rootNodeRLP)
      trie.root(trie.keySecure(ROOT_DB_KEY))
    }
    trie.debug(`Created new Trie`)
    trie.debug(`root: ${bytesToPrefixedHexString(trie.root())}`)
    trie.debug(`secure: ${trie.secure}`)
    trie.debug(`persistent: ${trie.persistent}`)
    trie.debug(`hashFunction: ${trie.hashFunction.name}`)
    trie.debug(`useNodePruning: ${trie.useNodePruning}`)
    trie.debug(`maxCheckpoints: ${trie.maxCheckpoints}`)
    return trie
  }
  private _db: TrieDatabase
  _opts: TrieDBOptions
  cache: LRUCache<Uint8Array, TNode>
  checkpoints: Uint8Array[]
  maxCheckpoints: number
  secure: boolean
  persistent: boolean
  useNodePruning: boolean
  keySecure: (key: Uint8Array) => Uint8Array
  constructor(options: TrieDBOptions = { cacheSize: 1000 }) {
    super(options)
    this.cache = options.cache ?? new LRUCache({ max: 1000 })
    if (options.db) {
      this.debug(`Building Trie from DB: ${options.db}`)
    }
    this._opts = options
    this._db =
      options.db && options.db instanceof TrieDatabase
        ? options.db
        : new TrieDatabase({ _debug: this.debug })

    this.checkpoints = options.checkpoints ?? []
    this.maxCheckpoints = options.maxCheckpoints ?? 1000
    this.useNodePruning = options.useNodePruning ?? false
    this.persistent = options.persistent ?? false
    this.secure = options.secure ?? options.useKeyHashing ?? false
    this.keySecure = this.secure ? this.hashFunction : (key: Uint8Array) => key
    this.EMPTY_TRIE_ROOT = this.hashFunction(this.EMPTY_TRIE_ROOT)
  }

  async rootNode(debug: Debugger = this.debug): Promise<TNode> {
    if (equalsBytes(this._rootNode.hash(), this.root())) {
      return this._rootNode
    }
    debug = debug.extend('get_rootNode')
    if (equalsBytes(this.root(), this.EMPTY_TRIE_ROOT)) {
      return new NullNode({})
    }
    const rootHash = this.root()
    const root = await this.lookupNodeByHash(rootHash, debug)
    if (!root) {
      debug(
        `root node not found, returning ProofNode with hash ${bytesToPrefixedHexString(rootHash)}`
      )
      return new ProofNode({
        hash: rootHash,
        nibbles: [],
        load: async () => this.lookupNodeByHash(rootHash, debug),
      })
    }
    debug(`
      root node found: ${root.getType()}`)
    this._rootNode = root
    return root
  }
  database(): TrieDatabase {
    return this._db
  }
  async setDataBase(db: TrieDatabase): Promise<void> {
    const newDB = new TrieDatabase({ _debug: this.debug })
    for await (const key of await db.keys()) {
      let value = await db.get(key)
      if (value === undefined) {
        return
      }
      value = value instanceof Uint8Array ? value : hexStringToBytes(value)
      await newDB.put(key, value)
    }
  }
  checkpoint(): void {
    this.debug.extend('checkpoint')(`${bytesToPrefixedHexString(this.root())}`)
    this.checkpoints.push(this.root())
  }
  hasCheckpoints(): boolean {
    return this.checkpoints.length > 0
  }
  async lookupNodeByHash(
    hash: Uint8Array,
    debug: Debugger = this.debug
  ): Promise<TNode | undefined> {
    debug = debug.extend('lookupNodeByHash')
    debug(`${bytesToPrefixedHexString(hash)}`)
    //  Check if node in cache
    let node = this.cache.get(hash)
    debug.extend('cache')(`Found: ${node !== undefined ? node.getType() : 'undefined'}`)
    if (node === undefined) {
      //  Check if node in db
      let encoded = await this._db.get(hash)
      if (encoded === undefined) {
        return encoded
      }
      encoded = hexStringToBytes(`${encoded}`)
      debug(`found in db: ${bytesToPrefixedHexString(this.hashFunction(encoded))}`)
      node = await this._decodeToNode(encoded, debug)
    }
    debug.extend(`${node.getType()}`)(`decoded hash: ${bytesToPrefixedHexString(node.hash())}`)
    node = node instanceof ProofNode ? await this.resolveProofNode(node) : node
    this.cache.set(hash, node)
    return node
  }
  async storeNode(node: TNode, debug: Debugger = this.debug): Promise<void> {
    debug = debug.extend('storeNode')
    debug(`${bytesToPrefixedHexString(node.hash())}`)
    debug.extend('store').extend(node.getType())(`${bytesToPrefixedHexString(node.hash())}}`)
    if (node instanceof ProofNode) {
      node = await this.resolveProofNode(node)
    }
    if (node instanceof ProofNode) {
      return
    } else {
      const serializedNode = node.rlpEncode()
      const nodeHash = node.hash()
      this.cache.set(nodeHash, node)
      await this._db.put(nodeHash, serializedNode)
    }
  }
  async persistRoot(rootDbKey: Uint8Array = ROOT_DB_KEY): Promise<void> {
    this.debug.extend('persistRoot')(bytesToPrefixedHexString(this.root()))
    await this._withLock(async () => {
      await this._db.put(rootDbKey, this.root())
    })
    if (this.useNodePruning) {
      await this.garbageCollect()
    }
  }
  async commit(): Promise<void> {
    const checkpoint = this.checkpoints.pop()
    if (checkpoint === undefined) {
      return this.garbageCollect()
    }
    this.debug.extend('commit')(
      `Committing changes.  Deleting checkpoint: ${bytesToPrefixedHexString(checkpoint)}`
    )
    if (this.persistent) {
      await this.persistRoot(this.hashFunction(ROOT_DB_KEY))
    }
    if (this.useNodePruning) {
      await this.garbageCollect()
    }
  }
  async revert(): Promise<void> {
    await this._withLock(async () => {
      const fromRoot = await this.rootNode()
      this.debug.extend('revert')(`from: ${bytesToPrefixedHexString(fromRoot.hash())}`)
      if (this.checkpoints.length > 0) {
        const checkpoint = this.checkpoints.pop()
        this.root(checkpoint!)
      } else {
        this.root(this.EMPTY_TRIE_ROOT)
      }
      this.debug.extend('revert')(`to: ${bytesToPrefixedHexString(this.root())}`)
      await this._db.del(fromRoot.hash())
    })
    await this.garbageCollect()
  }
  async _pruneCheckpoints(): Promise<void> {
    while (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.shift()
    }
    await this.garbageCollect()
  }
  flushCheckpoints(): void {
    this.checkpoints = []
  }

  /** {@link _garbageCollect } */
  garbageCollect = _garbageCollect.bind(this)
  /** {@link _verifyPrunedIntegrity } */
  verifyPrunedIntegrity = _verifyPrunedIntegrity.bind(this)
  /** {@link _markReachableNodes } */
  markReachableNodes = _markReachableNodes.bind(this)
}
