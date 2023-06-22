import { KECCAK256_RLP, bytesToPrefixedHexString } from '@ethereumjs/util'
import debug from 'debug'
import { equalsBytes } from 'ethereum-cryptography/utils'

import { getChildOf, proofToPath } from '../proof/rangeHelpers.js'
import { _verifyRangeProof } from '../proof/rangeProof.js'
import { ROOT_DB_KEY } from '../types.js'
import { bulkInsert } from '../util/index.js'
import { bytesToNibbles } from '../util/nibbles.js'

import { NullNode } from './node/index.js'
import { createProof, updateFromProof } from './operations/proof.js'
import { TrieReadStream } from './operations/readStream.js'
import { _walkTrieRecursively, walkTrie } from './operations/walkTrie.js'
import { TrieWithDB } from './trieDB.js'

import { Trie } from './index.js'

import type { TrieWrapOptions } from '../types.js'
// import type { TNode } from './node/types'
import type { Debugger } from 'debug'

export class TrieWrap extends TrieWithDB {
  static async create(options: TrieWrapOptions): Promise<TrieWrap> {
    const trie = new TrieWrap(options)
    if (options.rootNodeRLP) {
      if (!equalsBytes(options.rootNodeRLP, KECCAK256_RLP)) {
        // const rootHash = trie.hashFunction(options.rootNodeRLP)
        await trie.database().put(trie.hashFunction(options.rootNodeRLP), options.rootNodeRLP)
        // const rootNode = await trie._decodeToNode(options.rootNodeRLP)
        trie.root(trie.hashFunction(options.rootNodeRLP))
      }
      if (trie.persistent) {
        await trie.persistRoot(trie.keySecure(ROOT_DB_KEY))
      }
    }
    // if (options.root) {
    //   await trie.setRootNode(options.root)
    // }
    if (options.rootHash) {
      await trie.setRootByHash(options.rootHash)
    }
    options.debug?.extend(`create`)(`Created new Trie`)
    options.debug?.extend(`create`)(`root: ${bytesToPrefixedHexString(trie.root())}`)
    options.debug?.extend(`create`)(`secure: ${trie.secure}`)
    options.debug?.extend(`create`)(`persistent: ${trie.persistent}`)
    options.debug?.extend(`create`)(`hashFunction: ${trie.hashFunction.name}`)
    options.debug?.extend(`create`)(`useNodePruning: ${trie.useNodePruning}`)
    options.debug?.extend(`create`)(`maxCheckpoints: ${trie.maxCheckpoints}`)
    return trie
  }
  static async fromProof(
    proof: Uint8Array[],
    options: TrieWrapOptions = {},
    dbug: Debugger = debug('Trie')
  ): Promise<TrieWrap> {
    dbug = dbug.extend('fromProof')
    dbug(`Creating new Trie from proof (length: ${proof.length})`)
    const trie = new Trie({ ...options, debug: dbug })
    const root = trie.hashFunction(proof[0])
    trie.root(root)
    dbug(`Created new Trie: ${bytesToPrefixedHexString(trie.root())}`)
    dbug(`Target Trie hash: ${bytesToPrefixedHexString(root)}`)
    for await (const [idx, p] of proof.entries()) {
      dbug(`Storing ProofNode [${idx}]: ${p}`)
      // const node = await trie._decodeToNode(p)
      // await trie.storeNode(node)
      await trie.database().put(trie.hashFunction(p), p)
    }
    if (options.persistent === true || options.useRootPersistence === true) {
      dbug(`Persisting RootNode: ${bytesToPrefixedHexString(trie.root())}`)
      await trie.database().put(trie.keySecure(ROOT_DB_KEY), root)
    }
    return trie
  }
  static async verifyProof(
    root: Uint8Array,
    key: Uint8Array,
    proof: Uint8Array[],
    secure: boolean = false,
    dbug: Debugger = debug('')
  ): Promise<Uint8Array | null> {
    dbug = dbug.extend('verifyProof')
    try {
      const trie = await TrieWrap.fromProof(proof, { secure })
      if (!equalsBytes(trie.root(), root)) {
        dbug.extend('ERROR:')('Proof Invalid: root mismatch')
        throw new Error('Proof Invalid: root mismatch')
      }
      dbug(`Trie from Proof -- RootNode: ${bytesToPrefixedHexString(trie.root())}`)
      const value = await trie.get(key)
      dbug(
        `Found in ProofTrie for key [${bytesToNibbles(key)}]: ${
          value ? bytesToPrefixedHexString(value) : null
        }`
      )
      return value
    } catch (err: any) {
      debug(`Failed to verify proof: ${err.message}`)
      return null
    }
  }
  _root: Uint8Array

  constructor(options: TrieWrapOptions = {}) {
    super(options)
    this._root = options.rootHash ?? this.EMPTY_TRIE_ROOT
    this._opts = {
      cacheSize: options.cacheSize ?? 0,
      ...options,
    }
  }
  bulkInsert = bulkInsert.bind(this)
  getChildOf = getChildOf.bind(this)
  proofToPath = proofToPath.bind(this)
  updateFromProof = updateFromProof.bind(this)
  verifyRangeProof = _verifyRangeProof.bind(this)
  walkTrie = walkTrie.bind(this)
  createProof = createProof.bind(this)
  _walkTrieRecursively = _walkTrieRecursively.bind(this)

  async batch(
    batch: { type: string; key: Uint8Array; value?: Uint8Array }[],
    debug: Debugger = this.debug
  ): Promise<void> {
    debug.extend('batch')(`processing batch of ${batch.length} operations`)
    for (const [idx, b] of batch.entries()) {
      const dbug = debug.extend('batch').extend(`[${idx + 1} / ${batch.length}]`)
      if (b.type === 'put' && b.value !== undefined) {
        // await this.put(b.key, b.value ?? null)
        const _key = this.keySecure(b.key)
        await this._withLock(async () => {
          const rootNode = await this.rootNode()
          const keyNibbles = bytesToNibbles(_key)
          dbug(`inserting new key/value node`)
          dbug.extend('from ROOT_NODE')(`${rootNode.getType()}: ${rootNode.getPartialKey()}`)
          dbug.extend('Insert Key')(`[${keyNibbles}]`)
          dbug.extend('Value')(`${b.value}`)
          const newNode = await this._insertAtNode(rootNode, keyNibbles, b.value!, debug)
          this.root(newNode.hash())
          dbug.extend(`**NEW_ROOT**`)(`${bytesToPrefixedHexString(this.root())}`)
          await this.storeNode(rootNode)
        })
      } else if (b.type === 'del') {
        await this.del(b.key)
      }
    }
  }

  copy(includeCheckpoints: boolean = true): TrieWrap {
    this.debug.extend('copy')(`Creating copy of Trie: ${bytesToPrefixedHexString(this.root())}`)
    this.debug.extend('copy')('include checkpoints: ' + includeCheckpoints)
    this.debug.extend('copy')('checkpoints: ' + this.checkpoints.length)
    const dbCopy = this.database().shallowCopy()
    // const cacheCopy = new LRUCache<Uint8Array, TNode>({ max: this.cache.max })
    // for (const [key, value] of this.cache.entries()) {
    //   cacheCopy.set(key, value)
    // }
    this.debug.extend('copy')(this.checkpoints.map((c) => bytesToPrefixedHexString(c)))
    const trieCopy = new TrieWrap({
      rootHash: this.root(),
      debug: debug(this.debug.namespace).extend('copy'),
      secure: this.secure,
      useKeyHashing: this.secure,
      db: dbCopy,
      // cache: cacheCopy,
      checkpoints: includeCheckpoints ? [...this.checkpoints.slice()] : undefined,
      useRootPersistence: this.persistent,
      hashFunction: this.hashFunction,
    })
    if (!equalsBytes(trieCopy.root(), this.root())) {
      throw new Error('Failed to copy trie')
    }
    return trieCopy
  }
  async verifyProof(
    root: Uint8Array,
    key: Uint8Array,
    proof: Uint8Array[]
  ): Promise<Uint8Array | null> {
    this.debug.extend(`verifyProof`)(`verify proof for key: ${bytesToPrefixedHexString(key)}`)
    this.debug.extend(`verifyProof`)(`in trie with root: ${bytesToPrefixedHexString(root)}`)
    const trie = new TrieWrap({
      rootHash: this.hashFunction(proof[0]),
      persistent: this.persistent,
      useNodePruning: this.useNodePruning,
      secure: this.secure,
    })
    try {
      await trie.updateFromProof(proof, this.debug.extend('verifyProof'))
      const trieValue = await trie.get(key)
      return trieValue
    } catch (err: any) {
      this.debug.extend(`verifyProof`)(`Failed to verify proof: ${err.message}`)
      throw new Error('Invalid proof provided')
    }
  }
  // async setRootNode(root: TNode) {
  //   this.rootNode = root
  //   this.useNodePruning && (await this.garbageCollect())
  //   const addNode: FoundNodeFunction = async (node: TNode, _) => {
  //     await this.storeNode(node)
  //   }
  //   const walk = this.walkTrie(this.rootNode, this.rootNode.getPartialKey(), addNode)
  //   for await (const _ of walk) {
  //     // leave empty
  //   }
  // }

  public async put(
    _key: Uint8Array,
    _value: Uint8Array | null,
    debug: Debugger = this.debug
  ): Promise<void> {
    const fromRoot = this.root()
    let rootNode = await this.rootNode()
    debug.extend('ROOT_NODE').extend(rootNode.getType()).extend(`[${rootNode.getPartialKey()}]`)(
      `${bytesToPrefixedHexString(this.root())}`
    )
    if (_value === null) {
      debug.extend('put')(`null value`)
      debug(`deleting key: ${bytesToPrefixedHexString(_key)}`)
      return this.del(_key, debug)
    }
    await this._withLock(async () => {
      debug = debug.extend('put')
      if (equalsBytes(_key, ROOT_DB_KEY)) {
        throw new Error(`Attempted to set '__root__' key but it is not allowed.`)
      }
      debug.extend(`Key`)(`${bytesToPrefixedHexString(_key)}`)
      if (this.secure) {
        debug.extend(`Key`)(`secure: ${bytesToPrefixedHexString(this.keySecure(_key))}`)
      }
      _key = this.keySecure(_key)
      const keyNibbles = bytesToNibbles(_key)
      debug.extend('Value')(`${_value}`)
      // const oldNode = await this.getNode(_key, debug)
      rootNode = await this._insertAtNode(rootNode, keyNibbles, _value, debug)
      // await this.storeNode(rootNode)
      if (this.useNodePruning) {
        this.cache.delete(this.root())
        await this.database().del(fromRoot)
      }
      this.root(rootNode.hash())
      debug.extend(`**NEW_ROOT**`).extend(rootNode.getType())(
        `${bytesToPrefixedHexString(this.root())}`
      )
    })
    if (this.useNodePruning) {
      await this.garbageCollect()
    }
    if (this.persistent) {
      await this.persistRoot(this.keySecure(ROOT_DB_KEY))
    }
  }
  public async del(key: Uint8Array, debug: Debugger = this.debug): Promise<void> {
    key = this.keySecure(key)
    await this._withLock(async () => {
      debug = debug.extend('del')
      const rootNode = await this.rootNode()
      const keyNibbles = bytesToNibbles(key)
      debug(`deleting key: ${bytesToPrefixedHexString(key)}`)
      let newNode = await this._deleteAtNode(rootNode, keyNibbles, debug)
      debug.extend('TRIE_UPDATE')(
        `${newNode.getType()}: ${bytesToPrefixedHexString(newNode.hash())}`
      )
      if (newNode.getType() === 'NullNode') {
        this.debug.extend('NEW_ROOT')(`Empty trie`)
        this.root(this.EMPTY_TRIE_ROOT)
        this._rootNode = new NullNode({})
        return
      } else {
        newNode = await this._cleanupNode(newNode, debug)
        await this.storeNode(newNode)
        this.root(newNode.hash())
        debug.extend('NEW_ROOT')(`${newNode.getType()}: ${bytesToPrefixedHexString(this.root())}`)
      }
      // if (this.useNodePruning) {
      //   await this.garbageCollect()
      // }
    })
    if (this.persistent) {
      await this.persistRoot(this.keySecure(ROOT_DB_KEY))
    }
    if (this.useNodePruning) {
      await this.garbageCollect()
    }
  }
  public async get(key: Uint8Array, debug: Debugger = this.debug): Promise<Uint8Array | null> {
    debug = debug.extend('get')
    key = this.keySecure(key)
    const lastNode = await this.getNode(key, debug)
    debug(`Found node: ${lastNode.getType()} with value ${lastNode.getValue()}`)
    const value = lastNode.getValue()
    debug(`Returning: ${value}`)
    return value
  }
  createReadStream(): TrieReadStream {
    return new TrieReadStream(this)
  }
}
