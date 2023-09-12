import {
  KeyEncoding,
  MapDB,
  RLP_EMPTY_STRING,
  ValueEncoding,
  bytesToUnprefixedHex,
  bytesToUtf8,
  equalsBytes,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { CheckpointDB } from './db/index.js'
import {
  BranchNode,
  ExtensionNode,
  LeafNode,
  decodeNode,
  decodeRawNode,
  isRawNode,
} from './node/index.js'
import { verifyRangeProof } from './proof/range.js'
import { ROOT_DB_KEY } from './types.js'
import { _walkTrie } from './util/asyncWalk.js'
import { Lock } from './util/lock.js'
import { bytesToNibbles, doKeysMatch, matchingNibbleLength } from './util/nibbles.js'
import { TrieReadStream as ReadStream } from './util/readStream.js'
import { WalkController } from './util/walkController.js'

import type {
  EmbeddedNode,
  FoundNodeFunction,
  Nibbles,
  Proof,
  TrieNode,
  TrieOpts,
  TrieOptsWithDefaults,
} from './types.js'
import type { OnFound } from './util/asyncWalk.js'
import type { BatchDBOp, DB, PutBatch } from '@ethereumjs/util'

interface Path {
  node: TrieNode | null
  remaining: Nibbles
  stack: TrieNode[]
}

/**
 * The basic trie interface, use with `import { Trie } from '@ethereumjs/trie'`.
 */
export class Trie {
  protected readonly _opts: TrieOptsWithDefaults = {
    useKeyHashing: false,
    useKeyHashingFunction: keccak256,
    useRootPersistence: false,
    useNodePruning: false,
    cacheSize: 0,
  }

  /** The root for an empty trie */
  EMPTY_TRIE_ROOT: Uint8Array

  /** The backend DB */
  protected _db!: CheckpointDB
  protected _hashLen: number
  protected _lock = new Lock()
  protected _root: Uint8Array

  /**
   * Creates a new trie.
   * @param opts Options for instantiating the trie
   *
   * Note: in most cases, the static {@link Trie.create} constructor should be used.  It uses the same API but provides sensible defaults
   */
  constructor(opts?: TrieOpts) {
    if (opts !== undefined) {
      this._opts = { ...this._opts, ...opts }
    }

    this.database(opts?.db ?? new MapDB<string, string>())

    this.EMPTY_TRIE_ROOT = this.hash(RLP_EMPTY_STRING)
    this._hashLen = this.EMPTY_TRIE_ROOT.length
    this._root = this.EMPTY_TRIE_ROOT

    if (opts?.root) {
      this.root(opts.root)
    }
  }

  static async create(opts?: TrieOpts) {
    let key = ROOT_DB_KEY

    if (opts?.useKeyHashing === true) {
      key = (opts?.useKeyHashingFunction ?? keccak256)(ROOT_DB_KEY) as Uint8Array
    }

    if (opts?.db !== undefined && opts?.useRootPersistence === true) {
      if (opts?.root === undefined) {
        const rootHex = await opts?.db.get(bytesToUnprefixedHex(key), {
          keyEncoding: KeyEncoding.String,
          valueEncoding: ValueEncoding.String,
        })
        opts.root = rootHex !== undefined ? unprefixedHexToBytes(rootHex) : undefined
      } else {
        await opts?.db.put(bytesToUnprefixedHex(key), bytesToUnprefixedHex(opts.root), {
          keyEncoding: KeyEncoding.String,
          valueEncoding: ValueEncoding.String,
        })
      }
    }

    return new Trie(opts)
  }

  database(db?: DB<string, string>) {
    if (db !== undefined) {
      if (db instanceof CheckpointDB) {
        throw new Error('Cannot pass in an instance of CheckpointDB')
      }

      this._db = new CheckpointDB({ db, cacheSize: this._opts.cacheSize })
    }

    return this._db
  }

  /**
   * Gets and/or Sets the current root of the `trie`
   */
  root(value?: Uint8Array | null): Uint8Array {
    if (value !== undefined) {
      if (value === null) {
        value = this.EMPTY_TRIE_ROOT
      }

      if (value.length !== this._hashLen) {
        throw new Error(`Invalid root length. Roots are ${this._hashLen} bytes`)
      }

      this._root = value
    }

    return this._root
  }

  /**
   * Checks if a given root exists.
   */
  async checkRoot(root: Uint8Array): Promise<boolean> {
    try {
      const value = await this.lookupNode(root)
      return value !== null
    } catch (error: any) {
      if (error.message === 'Missing node in DB') {
        return equalsBytes(root, this.EMPTY_TRIE_ROOT)
      } else {
        throw error
      }
    }
  }

  /**
   * Gets a value given a `key`
   * @param key - the key to search for
   * @param throwIfMissing - if true, throws if any nodes are missing. Used for verifying proofs. (default: false)
   * @returns A Promise that resolves to `Uint8Array` if a value was found or `null` if no value was found.
   */
  async get(key: Uint8Array, throwIfMissing = false): Promise<Uint8Array | null> {
    const { node, remaining } = await this.findPath2(this.appliedKey(key), throwIfMissing)
    let value: Uint8Array | null = null
    if (node && remaining.length === 0) {
      value = node.value()
    }
    return value
  }

  /**
   * Stores a given `value` at the given `key` or do a delete if `value` is empty
   * (delete operations are only executed on DB with `deleteFromDB` set to `true`)
   * @param key
   * @param value
   * @returns A Promise that resolves once value is stored.
   */
  async put(key: Uint8Array, value: Uint8Array, skipKeyTransform: boolean = false): Promise<void> {
    if (this._opts.useRootPersistence && equalsBytes(key, ROOT_DB_KEY) === true) {
      throw new Error(`Attempted to set '${bytesToUtf8(ROOT_DB_KEY)}' key but it is not allowed.`)
    }

    // If value is empty, delete
    if (value === null || value.length === 0) {
      return this.del(key)
    }

    await this._lock.acquire()
    const appliedKey = skipKeyTransform ? key : this.appliedKey(key)
    if (equalsBytes(this.root(), this.EMPTY_TRIE_ROOT) === true) {
      // If no root, initialize this trie
      await this._createInitialNode(appliedKey, value)
    } else {
      // First try to find the given key or its nearest node
      const { remaining, stack } = await this.findPath2(appliedKey)
      let ops: BatchDBOp[] = []
      if (this._opts.useNodePruning) {
        const val = await this.get(key)
        // Only delete keys if it either does not exist, or if it gets updated
        // (The update will update the hash of the node, thus we can delete the original leaf node)
        if (val === null || equalsBytes(val, value) === false) {
          // All items of the stack are going to change.
          // (This is the path from the root node to wherever it needs to insert nodes)
          // The items change, because the leaf value is updated, thus all keyhashes in the
          // stack should be updated as well, so that it points to the right key/value pairs of the path
          const deleteHashes = stack.map((e) => this.hash(e.serialize()))
          ops = deleteHashes.map((e) => {
            return {
              type: 'del',
              key: e,
              opts: {
                keyEncoding: KeyEncoding.Bytes,
              },
            }
          })
        }
      }
      // then update
      await this._updateNode(appliedKey, value, remaining, stack)
      if (this._opts.useNodePruning) {
        // Only after updating the node we can delete the keyhashes
        await this._db.batch(ops)
      }
    }
    await this.persistRoot()
    this._lock.release()
  }

  /**
   * Deletes a value given a `key` from the trie
   * (delete operations are only executed on DB with `deleteFromDB` set to `true`)
   * @param key
   * @returns A Promise that resolves once value is deleted.
   */
  async del(key: Uint8Array, skipKeyTransform: boolean = false): Promise<void> {
    await this._lock.acquire()
    const appliedKey = skipKeyTransform ? key : this.appliedKey(key)
    const { node, stack } = await this.findPath2(appliedKey)

    let ops: BatchDBOp[] = []
    // Only delete if the `key` currently has any value
    if (this._opts.useNodePruning && node !== null) {
      const deleteHashes = stack.map((e) => this.hash(e.serialize()))
      // Just as with `put`, the stack items all will have their keyhashes updated
      // So after deleting the node, one can safely delete these from the DB
      ops = deleteHashes.map((e) => {
        return {
          type: 'del',
          key: e,
          opts: {
            keyEncoding: KeyEncoding.Bytes,
          },
        }
      })
    }
    if (node) {
      await this._deleteNode(appliedKey, stack)
    }
    if (this._opts.useNodePruning) {
      // Only after deleting the node it is possible to delete the keyhashes
      await this._db.batch(ops)
    }
    await this.persistRoot()
    this._lock.release()
  }

  /**
   * Tries to find a path to the node for the given key.
   * It returns a `stack` of nodes to the closest node.
   * @param key - the search key
   * @param throwIfMissing - if true, throws if any nodes are missing. Used for verifying proofs. (default: false)
   */
  async findPath(key: Uint8Array, throwIfMissing = false): Promise<Path> {
    const stack: TrieNode[] = []
    const targetKey = bytesToNibbles(key)
    let result: Path | null = null

    const onFound: FoundNodeFunction = async (_, node, keyProgress, walkController) => {
      // If we already have a result, exit early
      if (result) return

      if (node === null) {
        result = { node: null, remaining: [], stack }
        return
      }

      const keyRemainder = targetKey.slice(matchingNibbleLength(keyProgress, targetKey))
      stack.push(node)

      if (node instanceof BranchNode) {
        if (keyRemainder.length === 0) {
          result = { node, remaining: [], stack }
        } else {
          const branchIndex = keyRemainder[0]
          const branchNode = node.getBranch(branchIndex)
          if (!branchNode) {
            result = { node: null, remaining: keyRemainder, stack }
          } else {
            walkController.onlyBranchIndex(node, keyProgress, branchIndex)
          }
        }
      } else if (node instanceof LeafNode) {
        if (doKeysMatch(keyRemainder, node.key())) {
          result = { node, remaining: [], stack }
        } else {
          result = { node: null, remaining: keyRemainder, stack }
        }
      } else if (node instanceof ExtensionNode) {
        const matchingLen = matchingNibbleLength(keyRemainder, node.key())
        if (matchingLen !== node.key().length) {
          result = { node: null, remaining: keyRemainder, stack }
        } else {
          walkController.allChildren(node, keyProgress)
        }
      }
    }

    try {
      await this.walkTrie(this.root(), onFound)
    } catch (error: any) {
      if (error.message !== 'Missing node in DB' || throwIfMissing) {
        throw error
      }
    }

    if (result === null) {
      result = { node: null, remaining: [], stack }
    }

    return result
  }

  async processPathNode(
    nodeKey: Uint8Array | Uint8Array[],
    stack: TrieNode[],
    progress: Nibbles,
    remaining: Nibbles
  ): Promise<Path> {
    let node: TrieNode | null
    try {
      node = await this.lookupNode(nodeKey)
    } catch {
      throw new Error('Missing node in DB')
    }
    stack.push(node)
    if (node instanceof LeafNode) {
      const matching = doKeysMatch(remaining, node.key())
      if (matching) {
        return { node, remaining: [], stack }
      }
      return { node: null, remaining, stack }
    }
    const nibbleLen = 'key' in node ? node.key().length : 1
    const current = remaining.slice(0, nibbleLen)
    progress.push(...current)
    if (node instanceof BranchNode) {
      if (remaining.length === 0) {
        return { node, remaining, stack }
      } else {
        const encodedBranch = node.getBranch(current[0])
        if (encodedBranch === null) {
          return { node: null, remaining, stack }
        }
        try {
          await this.lookupNode(encodedBranch)
        } catch {
          throw new Error('Missing node in DB')
        }
        remaining = remaining.slice(1)
        return this.processPathNode(encodedBranch!, stack, progress, remaining)
      }
    } else if (node instanceof ExtensionNode) {
      if (!doKeysMatch(current, node.key())) {
        return { node: null, remaining, stack }
      }
      const childRef = node.value()
      try {
        await this.lookupNode(childRef)
      } catch {
        return { node: null, remaining: [], stack }
      }
      remaining = remaining.slice(nibbleLen)
      return this.processPathNode(childRef, stack, progress, remaining)
    } else {
      throw new Error('Unknown node type')
    }
  }

  /**
   * Tries to find a path to the node for the given key.
   * It returns a `stack` of nodes to the closest node.
   * @param key - the search key
   * @param throwIfMissing - if true, throws if any nodes are missing. Used for verifying proofs. (default: false)
   */
  async findPath2(key: Uint8Array, throwIfMissing: boolean = false): Promise<Path> {
    if (equalsBytes(this.root(), this.EMPTY_TRIE_ROOT)) {
      if (throwIfMissing) {
        throw new Error('Missing node in DB')
      }
      return { node: null, stack: [], remaining: [] }
    }

    let path: Path = {
      node: null,
      remaining: bytesToNibbles(key),
      stack: [],
    }
    try {
      path = await this.processPathNode(this.root(), path.stack, [], path.remaining)
    } catch (error: any) {
      if (error.message === 'Missing node in DB' && !throwIfMissing) {
        // pass
      } else {
        throw error
      }
    }
    return path
  }

  /**
   * Walks a trie until finished.
   * @param root
   * @param onFound - callback to call when a node is found. This schedules new tasks. If no tasks are available, the Promise resolves.
   * @returns Resolves when finished walking trie.
   */
  async walkTrie(root: Uint8Array, onFound: FoundNodeFunction): Promise<void> {
    await WalkController.newWalk(onFound, this, root)
  }

  walkTrieIterable = _walkTrie.bind(this)

  /**
   * Executes a callback for each node in the trie.
   * @param onFound - callback to call when a node is found.
   * @returns Resolves when finished walking trie.
   */
  async walkAllNodes(onFound: OnFound): Promise<void> {
    for await (const { node, currentKey } of this.walkTrieIterable(this.root())) {
      await onFound(node, currentKey)
    }
  }

  /**
   * Executes a callback for each value node in the trie.
   * @param onFound - callback to call when a node is found.
   * @returns Resolves when finished walking trie.
   */
  async walkAllValueNodes(onFound: OnFound): Promise<void> {
    for await (const { node, currentKey } of this.walkTrieIterable(
      this.root(),
      [],
      undefined,
      async (node) => {
        return node instanceof LeafNode || (node instanceof BranchNode && node.value() !== null)
      }
    )) {
      await onFound(node, currentKey)
    }
  }

  /**
   * Creates the initial node from an empty tree.
   * @private
   */
  protected async _createInitialNode(key: Uint8Array, value: Uint8Array): Promise<void> {
    const newNode = new LeafNode(bytesToNibbles(key), value)

    const encoded = newNode.serialize()
    this.root(this.hash(encoded))
    await this._db.put(this.root(), encoded)
    await this.persistRoot()
  }

  /**
   * Retrieves a node from db by hash.
   */
  async lookupNode(node: Uint8Array | Uint8Array[]): Promise<TrieNode> {
    if (isRawNode(node)) {
      return decodeRawNode(node)
    }
    const value = (await this._db.get(node)) ?? null

    if (value === null) {
      // Dev note: this error message text is used for error checking in `checkRoot`, `verifyProof`, and `findPath`
      throw new Error('Missing node in DB')
    }

    return decodeNode(value)
  }

  /**
   * Updates a node.
   * @private
   * @param key
   * @param value
   * @param keyRemainder
   * @param stack
   */
  protected async _updateNode(
    k: Uint8Array,
    value: Uint8Array,
    keyRemainder: Nibbles,
    stack: TrieNode[]
  ): Promise<void> {
    const toSave: BatchDBOp[] = []
    const lastNode = stack.pop()
    if (!lastNode) {
      throw new Error('Stack underflow')
    }

    // add the new nodes
    const key = bytesToNibbles(k)

    // Check if the last node is a leaf and the key matches to this
    let matchLeaf = false

    if (lastNode instanceof LeafNode) {
      let l = 0
      for (let i = 0; i < stack.length; i++) {
        const n = stack[i]
        if (n instanceof BranchNode) {
          l++
        } else {
          l += n.key().length
        }
      }

      if (
        matchingNibbleLength(lastNode.key(), key.slice(l)) === lastNode.key().length &&
        keyRemainder.length === 0
      ) {
        matchLeaf = true
      }
    }

    if (matchLeaf) {
      // just updating a found value
      lastNode.value(value)
      stack.push(lastNode as TrieNode)
    } else if (lastNode instanceof BranchNode) {
      stack.push(lastNode)
      if (keyRemainder.length !== 0) {
        // add an extension to a branch node
        keyRemainder.shift()
        // create a new leaf
        const newLeaf = new LeafNode(keyRemainder, value)
        stack.push(newLeaf)
      } else {
        lastNode.value(value)
      }
    } else {
      // create a branch node
      const lastKey = lastNode.key()
      const matchingLength = matchingNibbleLength(lastKey, keyRemainder)
      const newBranchNode = new BranchNode()

      // create a new extension node
      if (matchingLength !== 0) {
        const newKey = lastNode.key().slice(0, matchingLength)
        const newExtNode = new ExtensionNode(newKey, value)
        stack.push(newExtNode)
        lastKey.splice(0, matchingLength)
        keyRemainder.splice(0, matchingLength)
      }

      stack.push(newBranchNode)

      if (lastKey.length !== 0) {
        const branchKey = lastKey.shift() as number

        if (lastKey.length !== 0 || lastNode instanceof LeafNode) {
          // shrinking extension or leaf
          lastNode.key(lastKey)
          const formattedNode = this._formatNode(lastNode, false, toSave)
          newBranchNode.setBranch(branchKey, formattedNode as EmbeddedNode)
        } else {
          // remove extension or attaching
          this._formatNode(lastNode, false, toSave, true)
          newBranchNode.setBranch(branchKey, lastNode.value())
        }
      } else {
        newBranchNode.value(lastNode.value())
      }

      if (keyRemainder.length !== 0) {
        keyRemainder.shift()
        // add a leaf node to the new branch node
        const newLeafNode = new LeafNode(keyRemainder, value)
        stack.push(newLeafNode)
      } else {
        newBranchNode.value(value)
      }
    }

    await this.saveStack(key, stack, toSave)
  }

  /**
   * Deletes a node from the trie.
   * @private
   */
  protected async _deleteNode(k: Uint8Array, stack: TrieNode[]): Promise<void> {
    const processBranchNode = (
      key: Nibbles,
      branchKey: number,
      branchNode: TrieNode,
      parentNode: TrieNode,
      stack: TrieNode[]
    ) => {
      // branchNode is the node ON the branch node not THE branch node
      if (parentNode === null || parentNode === undefined || parentNode instanceof BranchNode) {
        // branch->?
        if (parentNode !== null && parentNode !== undefined) {
          stack.push(parentNode)
        }

        if (branchNode instanceof BranchNode) {
          // create an extension node
          // branch->extension->branch
          // @ts-ignore
          const extensionNode = new ExtensionNode([branchKey], null)
          stack.push(extensionNode)
          key.push(branchKey)
        } else {
          const branchNodeKey = branchNode.key()
          // branch key is an extension or a leaf
          // branch->(leaf or extension)
          branchNodeKey.unshift(branchKey)
          branchNode.key(branchNodeKey.slice(0))
          key = key.concat(branchNodeKey)
        }
        stack.push(branchNode)
      } else {
        // parent is an extension
        let parentKey = parentNode.key()

        if (branchNode instanceof BranchNode) {
          // ext->branch
          parentKey.push(branchKey)
          key.push(branchKey)
          parentNode.key(parentKey)
          stack.push(parentNode)
        } else {
          const branchNodeKey = branchNode.key()
          // branch node is an leaf or extension and parent node is an extension
          // add two keys together
          // don't push the parent node
          branchNodeKey.unshift(branchKey)
          key = key.concat(branchNodeKey)
          parentKey = parentKey.concat(branchNodeKey)
          branchNode.key(parentKey)
        }

        stack.push(branchNode)
      }

      return key
    }

    let lastNode = stack.pop()
    if (lastNode === undefined) throw new Error('missing last node')
    let parentNode = stack.pop()
    const opStack: BatchDBOp[] = []

    let key = bytesToNibbles(k)

    if (!parentNode) {
      // the root here has to be a leaf.
      this.root(this.EMPTY_TRIE_ROOT)
      return
    }

    if (lastNode instanceof BranchNode) {
      lastNode.value(null)
    } else {
      // the lastNode has to be a leaf if it's not a branch.
      // And a leaf's parent, if it has one, must be a branch.
      if (!(parentNode instanceof BranchNode)) {
        throw new Error('Expected branch node')
      }
      const lastNodeKey = lastNode.key()
      key.splice(key.length - lastNodeKey.length)
      // delete the value
      this._formatNode(lastNode, false, opStack, true)
      parentNode.setBranch(key.pop() as number, null)
      lastNode = parentNode
      parentNode = stack.pop()
    }

    // nodes on the branch
    // count the number of nodes on the branch
    const branchNodes: [number, EmbeddedNode][] = lastNode.getChildren()

    // if there is only one branch node left, collapse the branch node
    if (branchNodes.length === 1) {
      // add the one remaining branch node to node above it
      const branchNode = branchNodes[0][1]
      const branchNodeKey = branchNodes[0][0]

      // Special case where one needs to delete an extra node:
      // In this case, after updating the branch, the branch node has just one branch left
      // However, this violates the trie spec; this should be converted in either an ExtensionNode
      // Or a LeafNode
      // Since this branch is deleted, one can thus also delete this branch from the DB
      // So add this to the `opStack` and mark the keyhash to be deleted
      if (this._opts.useNodePruning) {
        opStack.push({
          type: 'del',
          key: branchNode as Uint8Array,
        })
      }

      // look up node
      const foundNode = await this.lookupNode(branchNode)
      // if (foundNode) {
      key = processBranchNode(key, branchNodeKey, foundNode, parentNode as TrieNode, stack)
      await this.saveStack(key, stack, opStack)
      // }
    } else {
      // simple removing a leaf and recalculation the stack
      if (parentNode) {
        stack.push(parentNode)
      }

      stack.push(lastNode)
      await this.saveStack(key, stack, opStack)
    }
  }

  /**
   * Saves a stack of nodes to the database.
   *
   * @param key - the key. Should follow the stack
   * @param stack - a stack of nodes to the value given by the key
   * @param opStack - a stack of levelup operations to commit at the end of this function
   */
  async saveStack(key: Nibbles, stack: TrieNode[], opStack: BatchDBOp[]): Promise<void> {
    let lastRoot

    // update nodes
    while (stack.length) {
      const node = stack.pop() as TrieNode
      if (node instanceof LeafNode) {
        key.splice(key.length - node.key().length)
      } else if (node instanceof ExtensionNode) {
        key.splice(key.length - node.key().length)
        if (lastRoot) {
          node.value(lastRoot)
        }
      } else if (node instanceof BranchNode) {
        if (lastRoot) {
          const branchKey = key.pop()
          node.setBranch(branchKey!, lastRoot)
        }
      }
      lastRoot = this._formatNode(node, stack.length === 0, opStack) as Uint8Array
    }

    if (lastRoot) {
      this.root(lastRoot)
    }

    await this._db.batch(opStack)
    await this.persistRoot()
  }

  /**
   * Formats node to be saved by `levelup.batch`.
   * @private
   * @param node - the node to format.
   * @param topLevel - if the node is at the top level.
   * @param opStack - the opStack to push the node's data.
   * @param remove - whether to remove the node
   * @returns The node's hash used as the key or the rawNode.
   */
  _formatNode(
    node: TrieNode,
    topLevel: boolean,
    opStack: BatchDBOp[],
    remove: boolean = false
  ): Uint8Array | (EmbeddedNode | null)[] {
    const encoded = node.serialize()

    if (encoded.length >= 32 || topLevel) {
      const hashRoot = this.hash(encoded)

      if (remove) {
        if (this._opts.useNodePruning) {
          opStack.push({
            type: 'del',
            key: hashRoot,
          })
        }
      } else {
        opStack.push({
          type: 'put',
          key: hashRoot,
          value: encoded,
        })
      }

      return hashRoot
    }

    return node.raw()
  }

  /**
   * The given hash of operations (key additions or deletions) are executed on the trie
   * (delete operations are only executed on DB with `deleteFromDB` set to `true`)
   * @example
   * const ops = [
   *    { type: 'del', key: Uint8Array.from('father') }
   *  , { type: 'put', key: Uint8Array.from('name'), value: Uint8Array.from('Yuri Irsenovich Kim') }
   *  , { type: 'put', key: Uint8Array.from('dob'), value: Uint8Array.from('16 February 1941') }
   *  , { type: 'put', key: Uint8Array.from('spouse'), value: Uint8Array.from('Kim Young-sook') }
   *  , { type: 'put', key: Uint8Array.from('occupation'), value: Uint8Array.from('Clown') }
   * ]
   * await trie.batch(ops)
   * @param ops
   */
  async batch(ops: BatchDBOp[], skipKeyTransform?: boolean): Promise<void> {
    for (const op of ops) {
      if (op.type === 'put') {
        if (op.value === null || op.value === undefined) {
          throw new Error('Invalid batch db operation')
        }
        await this.put(op.key, op.value, skipKeyTransform)
      } else if (op.type === 'del') {
        await this.del(op.key, skipKeyTransform)
      }
    }
    await this.persistRoot()
  }

  /**
   * Saves the nodes from a proof into the trie.
   * @param proof
   */
  async fromProof(proof: Proof): Promise<void> {
    const opStack = proof.map((nodeValue) => {
      return {
        type: 'put',
        key: Uint8Array.from(this.hash(nodeValue)),
        value: nodeValue,
      } as PutBatch
    })

    if (
      equalsBytes(this.root(), this.EMPTY_TRIE_ROOT) &&
      opStack[0] !== undefined &&
      opStack[0] !== null
    ) {
      this.root(opStack[0].key)
    }

    await this._db.batch(opStack)
    await this.persistRoot()
    return
  }

  /**
   * Creates a proof from a trie and key that can be verified using {@link Trie.verifyProof}.
   * @param key
   */
  async createProof(key: Uint8Array): Promise<Proof> {
    const { stack } = await this.findPath2(this.appliedKey(key))
    const p = stack.map((stackElem) => {
      return stackElem.serialize()
    })
    return p
  }

  /**
   * Verifies a proof.
   * @param rootHash
   * @param key
   * @param proof
   * @throws If proof is found to be invalid.
   * @returns The value from the key, or null if valid proof of non-existence.
   */
  async verifyProof(
    rootHash: Uint8Array,
    key: Uint8Array,
    proof: Proof
  ): Promise<Uint8Array | null> {
    const proofTrie = new Trie({
      root: rootHash,
      useKeyHashingFunction: this._opts.useKeyHashingFunction,
    })
    try {
      await proofTrie.fromProof(proof)
    } catch (e: any) {
      throw new Error('Invalid proof nodes given')
    }
    try {
      const value = await proofTrie.get(this.appliedKey(key), true)
      return value
    } catch (err: any) {
      if (err.message === 'Missing node in DB') {
        throw new Error('Invalid proof provided')
      } else {
        throw err
      }
    }
  }

  /**
   * {@link verifyRangeProof}
   */
  verifyRangeProof(
    rootHash: Uint8Array,
    firstKey: Uint8Array | null,
    lastKey: Uint8Array | null,
    keys: Uint8Array[],
    values: Uint8Array[],
    proof: Uint8Array[] | null
  ): Promise<boolean> {
    return verifyRangeProof(
      rootHash,
      firstKey && bytesToNibbles(this.appliedKey(firstKey)),
      lastKey && bytesToNibbles(this.appliedKey(lastKey)),
      keys.map((k) => this.appliedKey(k)).map(bytesToNibbles),
      values,
      proof,
      this._opts.useKeyHashingFunction
    )
  }

  // This method verifies if all keys in the trie (except the root) are reachable
  // If one of the key is not reachable, then that key could be deleted from the DB
  // (i.e. the Trie is not correctly pruned)
  // If this method returns `true`, the Trie is correctly pruned and all keys are reachable
  async verifyPrunedIntegrity(): Promise<boolean> {
    const roots = [
      bytesToUnprefixedHex(this.root()),
      bytesToUnprefixedHex(this.appliedKey(ROOT_DB_KEY)),
    ]
    for (const dbkey of (<any>this)._db.db._database.keys()) {
      if (roots.includes(dbkey)) {
        // The root key can never be found from the trie, otherwise this would
        // convert the tree from a directed acyclic graph to a directed cycling graph
        continue
      }

      // Track if key is found
      let found = false
      try {
        await this.walkTrie(this.root(), async function (nodeRef, node, key, controller) {
          if (found) {
            // Abort all other children checks
            return
          }
          if (node instanceof BranchNode) {
            for (const item of node._branches) {
              // If one of the branches matches the key, then it is found
              if (item !== null && bytesToUnprefixedHex(item as Uint8Array) === dbkey) {
                found = true
                return
              }
            }
            // Check all children of the branch
            controller.allChildren(node, key)
          }
          if (node instanceof ExtensionNode) {
            // If the value of the ExtensionNode points to the dbkey, then it is found
            if (bytesToUnprefixedHex(node.value()) === dbkey) {
              found = true
              return
            }
            controller.allChildren(node, key)
          }
        })
      } catch {
        return false
      }
      if (!found) {
        return false
      }
    }
    return true
  }

  /**
   * The `data` event is given an `Object` that has two properties; the `key` and the `value`. Both should be Uint8Arrays.
   * @return Returns a [stream](https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_class_stream_readable) of the contents of the `trie`
   */
  createReadStream(): ReadStream {
    return new ReadStream(this)
  }

  /**
   * Returns a copy of the underlying trie.
   *
   * Note on db: the copy will create a reference to the
   * same underlying database.
   *
   * Note on cache: for memory reasons a copy will not
   * recreate a new LRU cache but initialize with cache
   * being deactivated.
   *
   * @param includeCheckpoints - If true and during a checkpoint, the copy will contain the checkpointing metadata and will use the same scratch as underlying db.
   */
  shallowCopy(includeCheckpoints = true): Trie {
    const trie = new Trie({
      ...this._opts,
      db: this._db.db.shallowCopy(),
      root: this.root(),
      cacheSize: 0,
    })
    if (includeCheckpoints && this.hasCheckpoints()) {
      trie._db.setCheckpoints(this._db.checkpoints)
    }
    return trie
  }

  /**
   * Persists the root hash in the underlying database
   */
  async persistRoot() {
    if (this._opts.useRootPersistence) {
      await this._db.put(this.appliedKey(ROOT_DB_KEY), this.root())
    }
  }

  /**
   * Finds all nodes that are stored directly in the db
   * (some nodes are stored raw inside other nodes)
   * called by {@link ScratchReadStream}
   * @private
   */
  protected async _findDbNodes(onFound: FoundNodeFunction): Promise<void> {
    const outerOnFound: FoundNodeFunction = async (nodeRef, node, key, walkController) => {
      if (isRawNode(nodeRef)) {
        if (node !== null) {
          walkController.allChildren(node, key)
        }
      } else {
        onFound(nodeRef, node, key, walkController)
      }
    }
    await this.walkTrie(this.root(), outerOnFound)
  }

  /**
   * Returns the key practically applied for trie construction
   * depending on the `useKeyHashing` option being set or not.
   * @param key
   */
  protected appliedKey(key: Uint8Array) {
    if (this._opts.useKeyHashing) {
      return this.hash(key)
    }
    return key
  }

  protected hash(msg: Uint8Array): Uint8Array {
    return Uint8Array.from(this._opts.useKeyHashingFunction(msg))
  }

  /**
   * Is the trie during a checkpoint phase?
   */
  hasCheckpoints() {
    return this._db.hasCheckpoints()
  }

  /**
   * Creates a checkpoint that can later be reverted to or committed.
   * After this is called, all changes can be reverted until `commit` is called.
   */
  checkpoint() {
    this._db.checkpoint(this.root())
  }

  /**
   * Commits a checkpoint to disk, if current checkpoint is not nested.
   * If nested, only sets the parent checkpoint as current checkpoint.
   * @throws If not during a checkpoint phase
   */
  async commit(): Promise<void> {
    if (!this.hasCheckpoints()) {
      throw new Error('trying to commit when not checkpointed')
    }

    await this._lock.acquire()
    await this._db.commit()
    await this.persistRoot()
    this._lock.release()
  }

  /**
   * Reverts the trie to the state it was at when `checkpoint` was first called.
   * If during a nested checkpoint, sets root to most recent checkpoint, and sets
   * parent checkpoint as current.
   */
  async revert(): Promise<void> {
    if (!this.hasCheckpoints()) {
      throw new Error('trying to revert when not checkpointed')
    }

    await this._lock.acquire()
    this.root(await this._db.revert())
    await this.persistRoot()
    this._lock.release()
  }

  /**
   * Flushes all checkpoints, restoring the initial checkpoint state.
   */
  flushCheckpoints() {
    this._db.checkpoints = []
  }
}
