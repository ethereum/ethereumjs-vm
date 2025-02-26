// Some more secure presets when using e.g. JS `call`
'use strict'

import { RLP } from '@ethereumjs/rlp'
import {
  BIGINT_0,
  EthereumJSErrorWithoutCode,
  KeyEncoding,
  Lock,
  MapDB,
  RLP_EMPTY_STRING,
  ValueEncoding,
  bytesToBigInt,
  bytesToHex,
  bytesToUnprefixedHex,
  bytesToUtf8,
  concatBytes,
  equalsBytes,
} from '@ethereumjs/util'
import debug from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { CheckpointDB } from './db/checkpointDB.js'
import {
  BranchMPTNode,
  ExtensionMPTNode,
  LeafMPTNode,
  decodeMPTNode,
  decodeRawMPTNode,
  isRawMPTNode,
} from './node/index.js'
import { ROOT_DB_KEY } from './types.js'
import { _walkTrie } from './util/asyncWalk.js'
import { bytesToNibbles, matchingNibbleLength, nibblesTypeToPackedBytes } from './util/nibbles.js'
import { WalkController } from './util/walkController.js'

import type {
  BranchMPTNodeBranchValue,
  FoundNodeFunction,
  MPTNode,
  MPTOpts,
  MPTOptsWithDefaults,
  Nibbles,
  NodeReferenceOrRawMPTNode,
  Path,
  TrieShallowCopyOpts,
} from './types.js'
import type { OnFound } from './util/asyncWalk.js'
import type { BatchDBOp, DB } from '@ethereumjs/util'
import type { Debugger } from 'debug'

/**
 * The basic trie interface, use with `import { MerklePatriciaTrie } from '@ethereumjs/mpt'`.
 */
export class MerklePatriciaTrie {
  protected readonly _opts: MPTOptsWithDefaults = {
    useKeyHashing: false,
    useKeyHashingFunction: keccak256,
    keyPrefix: undefined,
    useRootPersistence: false,
    useNodePruning: false,
    cacheSize: 0,
    valueEncoding: ValueEncoding.String,
  }

  /** The root for an empty trie */
  EMPTY_TRIE_ROOT: Uint8Array

  /** The backend DB */
  protected _db!: CheckpointDB
  protected _hashLen: number
  protected _lock = new Lock()
  protected _root: Uint8Array

  /** Debug logging */
  protected DEBUG: boolean
  protected _debug: Debugger = debug('mpt:#')
  protected debug: (...args: any) => void

  /**
   * Creates a new trie.
   * @param opts Options for instantiating the trie
   *
   * Note: in most cases, {@link createMPT} constructor should be used.  It uses the same API but provides sensible defaults
   */
  constructor(opts?: MPTOpts) {
    let valueEncoding: ValueEncoding
    if (opts !== undefined) {
      // Sanity check: can only set valueEncoding if a db is provided
      // The valueEncoding defaults to `Bytes` if no DB is provided (use a MapDB in memory)
      if (opts?.valueEncoding !== undefined && opts.db === undefined) {
        throw EthereumJSErrorWithoutCode('`valueEncoding` can only be set if a `db` is provided')
      }
      this._opts = { ...this._opts, ...opts }
      this._opts.useKeyHashingFunction =
        opts.common?.customCrypto.keccak256 ?? opts.useKeyHashingFunction ?? keccak256

      valueEncoding =
        opts.db !== undefined ? (opts.valueEncoding ?? ValueEncoding.String) : ValueEncoding.Bytes
    } else {
      // No opts are given, so create a MapDB later on
      // Use `Bytes` for ValueEncoding
      valueEncoding = ValueEncoding.Bytes
    }

    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
    this.debug = this.DEBUG
      ? (message: string, namespaces: string[] = []) => {
          let log = this._debug
          for (const name of namespaces) {
            log = log.extend(name)
          }
          log(message)
        }
      : (..._: any) => {}

    this.database(opts?.db ?? new MapDB<string, Uint8Array>(), valueEncoding)

    this.EMPTY_TRIE_ROOT = this.hash(RLP_EMPTY_STRING)
    this._hashLen = this.EMPTY_TRIE_ROOT.length
    this._root = this.EMPTY_TRIE_ROOT

    if (opts?.root) {
      this.root(opts.root)
    }
    this.DEBUG &&
      this.debug(`Trie created:
    || Root: ${bytesToHex(this.root())}
    || Secure: ${this._opts.useKeyHashing}
    || Persistent: ${this._opts.useRootPersistence}
    || Pruning: ${this._opts.useNodePruning}
    || CacheSize: ${this._opts.cacheSize}
    || ----------------`)
  }

  database(db?: DB<string, string | Uint8Array>, valueEncoding?: ValueEncoding) {
    if (db !== undefined) {
      if (db instanceof CheckpointDB) {
        throw EthereumJSErrorWithoutCode('Cannot pass in an instance of CheckpointDB')
      }

      this._db = new CheckpointDB({ db, cacheSize: this._opts.cacheSize, valueEncoding })
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
      this.DEBUG && this.debug(`Setting root to ${bytesToHex(value)}`)
      if (value.length !== this._hashLen) {
        throw EthereumJSErrorWithoutCode(
          `Invalid root length. Roots are ${this._hashLen} bytes, got ${value.length} bytes`,
        )
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
    this.DEBUG && this.debug(`Key: ${bytesToHex(key)}`, ['get'])
    const { node, remaining } = await this.findPath(this.appliedKey(key), throwIfMissing)
    let value: Uint8Array | null = null
    if (node && remaining.length === 0) {
      value = node.value()
    }
    this.DEBUG && this.debug(`Value: ${value === null ? 'null' : bytesToHex(value)}`, ['get'])
    return value
  }

  /**
   * Stores a given `value` at the given `key` or do a delete if `value` is empty
   * (delete operations are only executed on DB with `deleteFromDB` set to `true`)
   * @param key
   * @param value
   * @returns A Promise that resolves once value is stored.
   */
  async put(
    key: Uint8Array,
    value: Uint8Array | null,
    skipKeyTransform: boolean = false,
  ): Promise<void> {
    this.DEBUG && this.debug(`Key: ${bytesToHex(key)}`, ['put'])
    this.DEBUG && this.debug(`Value: ${value === null ? 'null' : bytesToHex(key)}`, ['put'])
    if (this._opts.useRootPersistence && equalsBytes(key, ROOT_DB_KEY) === true) {
      throw EthereumJSErrorWithoutCode(
        `Attempted to set '${bytesToUtf8(ROOT_DB_KEY)}' key but it is not allowed.`,
      )
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
      const { remaining, stack } = await this.findPath(appliedKey)
      let ops: BatchDBOp[] = []
      if (this._opts.useNodePruning) {
        const val = await this.get(key)
        // Only delete keys if it either does not exist, or if it gets updated
        // (The update will update the hash of the node, thus we can delete the original leaf node)
        if (val === null || equalsBytes(val, value) === false) {
          // All items of the stack are going to change.
          // (This is the path from the root node to wherever it needs to insert nodes)
          // The items change, because the leaf value is updated, thus all keyHashes in the
          // stack should be updated as well, so that it points to the right key/value pairs of the path
          const deleteHashes = stack.map((e) => this.hash(e.serialize()))
          ops = deleteHashes.map((deletedHash) => {
            const key = this._opts.keyPrefix
              ? concatBytes(this._opts.keyPrefix, deletedHash)
              : deletedHash

            return {
              type: 'del',
              key,
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
        // Only after updating the node we can delete the keyHashes
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
    this.DEBUG && this.debug(`Key: ${bytesToHex(key)}`, ['del'])
    await this._lock.acquire()
    const appliedKey = skipKeyTransform ? key : this.appliedKey(key)
    const { node, stack } = await this.findPath(appliedKey)

    let ops: BatchDBOp[] = []
    // Only delete if the `key` currently has any value
    if (this._opts.useNodePruning && node !== null) {
      const deleteHashes = stack.map((e) => this.hash(e.serialize()))
      // Just as with `put`, the stack items all will have their keyHashes updated
      // So after deleting the node, one can safely delete these from the DB

      ops = deleteHashes.map((deletedHash) => {
        const key = this._opts.keyPrefix
          ? concatBytes(this._opts.keyPrefix, deletedHash)
          : deletedHash
        return {
          type: 'del',
          key,
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
      // Only after deleting the node it is possible to delete the keyHashes
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
  async findPath(
    key: Uint8Array,
    throwIfMissing = false,
    partialPath: {
      stack: MPTNode[]
    } = {
      stack: [],
    },
  ): Promise<Path> {
    const targetKey = bytesToNibbles(key)
    const keyLen = targetKey.length
    const stack: MPTNode[] = Array.from({ length: keyLen })
    let progress = 0
    for (let i = 0; i < partialPath.stack.length - 1; i++) {
      stack[i] = partialPath.stack[i]
      progress += stack[i] instanceof BranchMPTNode ? 1 : (<ExtensionMPTNode>stack[i]).keyLength()
    }
    this.DEBUG && this.debug(`Target (${targetKey.length}): [${targetKey}]`, ['find_path'])
    let result: Path | null = null

    const onFound: FoundNodeFunction = async (_, node, keyProgress, walkController) => {
      stack[progress] = node as MPTNode
      if (node instanceof BranchMPTNode) {
        if (progress === keyLen) {
          result = { node, remaining: [], stack }
        } else {
          const branchIndex = targetKey[progress]
          this.DEBUG &&
            this.debug(`Looking for node on branch index: [${branchIndex}]`, [
              'find_path',
              'branch_node',
            ])
          const branchNode = node.getBranch(branchIndex)

          if (this.DEBUG) {
            let debugString: string
            if (branchNode === null) {
              debugString = 'NULL'
            } else {
              debugString = `Branch index: ${branchIndex.toString()} - `
              debugString +=
                branchNode instanceof Uint8Array
                  ? `NodeHash: ${bytesToHex(branchNode)}`
                  : `Raw_Node: ${branchNode.toString()}`
            }

            this.debug(debugString, ['find_path', 'branch_node'])
          }
          if (!branchNode) {
            result = { node: null, remaining: targetKey.slice(progress), stack }
          } else {
            progress++
            walkController.onlyBranchIndex(node, keyProgress, branchIndex)
          }
        }
      } else if (node instanceof LeafMPTNode) {
        const _progress = progress
        if (keyLen - progress > node.key().length) {
          result = { node: null, remaining: targetKey.slice(_progress), stack }
          return
        }
        for (const k of node.key()) {
          if (k !== targetKey[progress]) {
            result = { node: null, remaining: targetKey.slice(_progress), stack }
            return
          }
          progress++
        }
        result = { node, remaining: [], stack }
      } else if (node instanceof ExtensionMPTNode) {
        this.DEBUG &&
          this.debug(
            `Comparing node key to expected\n|| Node_Key: [${node.key()}]\n|| Expected: [${targetKey.slice(
              progress,
              progress + node.key().length,
            )}]\n|| Matching: [${
              targetKey.slice(progress, progress + node.key().length).toString() ===
              node.key().toString()
            }]
            `,
            ['find_path', 'extension_node'],
          )
        const _progress = progress
        for (const k of node.key()) {
          this.DEBUG && this.debug(`NextNode: ${node.value()}`, ['find_path', 'extension_node'])
          if (k !== targetKey[progress]) {
            result = { node: null, remaining: targetKey.slice(_progress), stack }
            return
          }
          progress++
        }
        walkController.allChildren(node, keyProgress)
      }
    }
    const startingNode = partialPath.stack[partialPath.stack.length - 1]
    const start = startingNode !== undefined ? this.hash(startingNode.serialize()) : this.root()
    try {
      this.DEBUG &&
        this.debug(
          `Walking trie from ${startingNode === undefined ? 'ROOT' : 'NODE'}: ${bytesToHex(start)}`,
          ['find_path'],
        )
      await this.walkTrie(start, onFound)
    } catch (error: any) {
      if (error.message !== 'Missing node in DB' || throwIfMissing) {
        throw error
      }
    }

    if (result === null) {
      result = { node: null, remaining: [], stack }
    }
    this.DEBUG &&
      this.debug(
        result.node !== null
          ? `Target Node FOUND for ${bytesToNibbles(key)}`
          : `Target Node NOT FOUND`,
        ['find_path'],
      )

    result.stack = result.stack.filter((e) => e !== undefined)
    this.DEBUG &&
      this.debug(
        `Result:
        || Node: ${result.node === null ? 'null' : result.node.constructor.name}
        || Remaining: [${result.remaining}]\n|| Stack: ${result.stack
          .map((e) => e.constructor.name)
          .join(', ')}`,
        ['find_path'],
      )
    return result
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
        return (
          node instanceof LeafMPTNode || (node instanceof BranchMPTNode && node.value() !== null)
        )
      },
    )) {
      await onFound(node, currentKey)
    }
  }

  /**
   * Creates the initial node from an empty tree.
   * @private
   */
  protected async _createInitialNode(key: Uint8Array, value: Uint8Array): Promise<void> {
    const newNode = new LeafMPTNode(bytesToNibbles(key), value)

    const encoded = newNode.serialize()
    this.root(this.hash(encoded))
    let rootKey = this.root()
    rootKey = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, rootKey) : rootKey
    await this._db.put(rootKey, encoded)
    await this.persistRoot()
  }

  /**
   * Retrieves a node from db by hash.
   */
  async lookupNode(node: Uint8Array | Uint8Array[]): Promise<MPTNode> {
    if (isRawMPTNode(node)) {
      const decoded = decodeRawMPTNode(node)
      this.DEBUG && this.debug(`${decoded.constructor.name}`, ['lookup_node', 'raw_node'])
      return decoded
    }
    this.DEBUG && this.debug(`${`${bytesToHex(node)}`}`, ['lookup_node', 'by_hash'])
    const key = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, node) : node
    const value = (await this._db.get(key)) ?? null

    if (value === null) {
      // Dev note: this error message text is used for error checking in `checkRoot`, `verifyMPTWithMerkleProof`, and `findPath`
      throw EthereumJSErrorWithoutCode('Missing node in DB')
    }

    const decoded = decodeMPTNode(value)
    this.DEBUG && this.debug(`${decoded.constructor.name} found in DB`, ['lookup_node', 'by_hash'])
    return decoded
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
    stack: MPTNode[],
  ): Promise<void> {
    const toSave: BatchDBOp[] = []
    const lastNode = stack.pop()
    if (!lastNode) {
      throw EthereumJSErrorWithoutCode('Stack underflow')
    }

    // add the new nodes
    const key = bytesToNibbles(k)

    // Check if the last node is a leaf and the key matches to this
    let matchLeaf = false

    if (lastNode instanceof LeafMPTNode) {
      let l = 0
      for (let i = 0; i < stack.length; i++) {
        const n = stack[i]
        if (n instanceof BranchMPTNode) {
          l++
        } else {
          l += n.key().length
        }
      }

      if (
        keyRemainder.length === 0 &&
        matchingNibbleLength(lastNode.key(), key.slice(l)) === lastNode.key().length
      ) {
        matchLeaf = true
      }
    }

    if (matchLeaf) {
      // just updating a found value
      lastNode.value(value)
      stack.push(lastNode)
    } else if (lastNode instanceof BranchMPTNode) {
      stack.push(lastNode)
      if (keyRemainder.length !== 0) {
        // add an extension to a branch node
        keyRemainder.shift()
        // create a new leaf
        const newLeaf = new LeafMPTNode(keyRemainder, value)
        stack.push(newLeaf)
      } else {
        lastNode.value(value)
      }
    } else {
      // create a branch node
      const lastKey = lastNode.key()
      const matchingLength = matchingNibbleLength(lastKey, keyRemainder)
      const newBranchMPTNode = new BranchMPTNode()

      // create a new extension node
      if (matchingLength !== 0) {
        const newKey = lastNode.key().slice(0, matchingLength)
        const newExtNode = new ExtensionMPTNode(newKey, value)
        stack.push(newExtNode)
        lastKey.splice(0, matchingLength)
        keyRemainder.splice(0, matchingLength)
      }

      stack.push(newBranchMPTNode)

      if (lastKey.length !== 0) {
        const branchKey = lastKey.shift() as number

        if (lastKey.length !== 0 || lastNode instanceof LeafMPTNode) {
          // shrinking extension or leaf
          lastNode.key(lastKey)
          const formattedNode = this._formatNode(
            lastNode,
            false,
            toSave,
          ) as NodeReferenceOrRawMPTNode
          newBranchMPTNode.setBranch(branchKey, formattedNode)
        } else {
          // remove extension or attaching
          this._formatNode(lastNode, false, toSave, true)
          newBranchMPTNode.setBranch(branchKey, lastNode.value())
        }
      } else {
        newBranchMPTNode.value(lastNode.value())
      }

      if (keyRemainder.length !== 0) {
        keyRemainder.shift()
        // add a leaf node to the new branch node
        const newLeafMPTNode = new LeafMPTNode(keyRemainder, value)
        stack.push(newLeafMPTNode)
      } else {
        newBranchMPTNode.value(value)
      }
    }

    await this.saveStack(key, stack, toSave)
  }

  /**
   * Deletes a node from the trie.
   * @private
   */
  protected async _deleteNode(k: Uint8Array, stack: MPTNode[]): Promise<void> {
    const processBranchMPTNode = (
      key: Nibbles,
      branchKey: number,
      branchNode: MPTNode,
      parentNode: MPTNode,
      stack: MPTNode[],
    ) => {
      // branchNode is the node ON the branch node not THE branch node
      if (parentNode === null || parentNode === undefined || parentNode instanceof BranchMPTNode) {
        // branch->?
        if (parentNode !== null && parentNode !== undefined) {
          stack.push(parentNode)
        }

        if (branchNode instanceof BranchMPTNode) {
          // create an extension node
          // branch->extension->branch
          // We push an extension value with a temporarily empty value to the stack.
          // It will be replaced later on with the correct value in saveStack
          const extensionNode = new ExtensionMPTNode([branchKey], new Uint8Array())
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

        if (branchNode instanceof BranchMPTNode) {
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
    if (lastNode === undefined) throw EthereumJSErrorWithoutCode('missing last node')
    let parentNode = stack.pop()
    const opStack: BatchDBOp[] = []

    let key = bytesToNibbles(k)

    if (parentNode === undefined) {
      // the root here has to be a leaf.
      this.root(this.EMPTY_TRIE_ROOT)
      return
    }

    if (lastNode instanceof BranchMPTNode) {
      lastNode.value(null)
    } else {
      // the lastNode has to be a leaf if it's not a branch.
      // And a leaf's parent, if it has one, must be a branch.
      if (!(parentNode instanceof BranchMPTNode)) {
        throw EthereumJSErrorWithoutCode('Expected branch node')
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
    const branchNodes: [number, NodeReferenceOrRawMPTNode][] = lastNode.getChildren()

    // if there is only one branch node left, collapse the branch node
    if (branchNodes.length === 1) {
      // add the one remaining branch node to node above it
      const branchNode = branchNodes[0][1]
      const branchNodeKey = branchNodes[0][0]

      // Special case where one needs to delete an extra node:
      // In this case, after updating the branch, the branch node has just one branch left
      // However, this violates the trie spec; this should be converted in either an ExtensionMPTNode
      // Or a LeafMPTNode
      // Since this branch is deleted, one can thus also delete this branch from the DB
      // So add this to the `opStack` and mark the keyHash to be deleted
      if (this._opts.useNodePruning) {
        // If the branchNode has length < 32, it will be a RawNode (Uint8Array[]) instead of a Uint8Array
        // In that case, we need to serialize and hash it into a Uint8Array, otherwise the operation will throw
        opStack.push({
          type: 'del',
          key: isRawMPTNode(branchNode) ? this.appliedKey(RLP.encode(branchNode)) : branchNode,
        })
      }

      // look up node
      const foundNode = await this.lookupNode(branchNode)
      key = processBranchMPTNode(key, branchNodeKey, foundNode, parentNode as MPTNode, stack)
      await this.saveStack(key, stack, opStack)
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
  async saveStack(key: Nibbles, stack: MPTNode[], opStack: BatchDBOp[]): Promise<void> {
    let lastRoot

    // update nodes
    while (stack.length) {
      const node = stack.pop()
      if (node === undefined) {
        throw EthereumJSErrorWithoutCode('saveStack: missing node')
      }
      if (node instanceof LeafMPTNode || node instanceof ExtensionMPTNode) {
        key.splice(key.length - node.key().length)
      }
      if (node instanceof ExtensionMPTNode && lastRoot !== undefined) {
        node.value(lastRoot)
      }
      if (node instanceof BranchMPTNode && lastRoot !== undefined) {
        const branchKey = key.pop()
        node.setBranch(branchKey!, lastRoot)
      }
      lastRoot = this._formatNode(node, stack.length === 0, opStack) as Uint8Array
    }

    if (lastRoot !== undefined) {
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
    node: MPTNode,
    topLevel: boolean,
    opStack: BatchDBOp[],
    remove: boolean = false,
  ): Uint8Array | NodeReferenceOrRawMPTNode | BranchMPTNodeBranchValue[] {
    const encoded = node.serialize()

    if (encoded.length >= 32 || topLevel) {
      const lastRoot = this.hash(encoded)
      const key = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, lastRoot) : lastRoot

      if (remove) {
        if (this._opts.useNodePruning) {
          opStack.push({
            type: 'del',
            key,
          })
        }
      } else {
        opStack.push({
          type: 'put',
          key,
          value: encoded,
        })
      }

      return lastRoot
    }

    return node.raw()
  }

  /**
   * The given hash of operations (key additions or deletions) are executed on the trie
   * (delete operations are only executed on DB with `deleteFromDB` set to `true`)
   * @example
   * const ops = [
   *    { type: 'del', key: Uint8Array.from('father') }
   *  , { type: 'put', key: Uint8Array.from('name'), value: Uint8Array.from('Yuri Irsenovich Kim') } // cspell:disable-line
   *  , { type: 'put', key: Uint8Array.from('dob'), value: Uint8Array.from('16 February 1941') }
   *  , { type: 'put', key: Uint8Array.from('spouse'), value: Uint8Array.from('Kim Young-sook') } // cspell:disable-line
   *  , { type: 'put', key: Uint8Array.from('occupation'), value: Uint8Array.from('Clown') }
   * ]
   * await trie.batch(ops)
   * @param ops
   */
  async batch(ops: BatchDBOp[], skipKeyTransform?: boolean): Promise<void> {
    for (const op of ops) {
      if (op.type === 'put') {
        if (op.value === null || op.value === undefined) {
          throw EthereumJSErrorWithoutCode('Invalid batch db operation')
        }
        await this.put(op.key, op.value, skipKeyTransform)
      } else if (op.type === 'del') {
        await this.del(op.key, skipKeyTransform)
      }
    }
    await this.persistRoot()
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
        await this.walkTrie(this.root(), async function (_, node, key, controller) {
          if (found) {
            // Abort all other children checks
            return
          }
          if (node instanceof BranchMPTNode) {
            for (const item of node._branches) {
              // If one of the branches matches the key, then it is found
              if (
                item !== null &&
                bytesToUnprefixedHex(
                  isRawMPTNode(item) ? controller.trie.appliedKey(RLP.encode(item)) : item,
                ) === dbkey
              ) {
                found = true
                return
              }
            }
            // Check all children of the branch
            controller.allChildren(node, key)
          }
          if (node instanceof ExtensionMPTNode) {
            // If the value of the ExtensionMPTNode points to the dbkey, then it is found
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
   * Returns a copy of the underlying trie.
   *
   * Note on db: the copy will create a reference to the
   * same underlying database.
   *
   * Note on cache: for memory reasons a copy will by default
   * not recreate a new LRU cache but initialize with cache
   * being deactivated. This behavior can be overwritten by
   * explicitly setting `cacheSize` as an option on the method.
   *
   * @param includeCheckpoints - If true and during a checkpoint, the copy will contain the checkpointing metadata and will use the same scratch as underlying db.
   */
  shallowCopy(includeCheckpoints = true, opts?: TrieShallowCopyOpts): MerklePatriciaTrie {
    const trie = new MerklePatriciaTrie({
      ...this._opts,
      db: this._db.db.shallowCopy(),
      root: this.root(),
      cacheSize: 0,
      ...(opts ?? {}),
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
      this.DEBUG &&
        this.debug(
          `Persisting root: \n|| RootHash: ${bytesToHex(this.root())}\n|| RootKey: ${bytesToHex(
            this.appliedKey(ROOT_DB_KEY),
          )}`,
          ['persist_root'],
        )
      let key = this.appliedKey(ROOT_DB_KEY)
      key = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, key) : key
      await this._db.put(key, this.root())
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
      if (isRawMPTNode(nodeRef)) {
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
    return Uint8Array.from(this._opts.useKeyHashingFunction.call(undefined, msg))
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
    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['checkpoint'])
    this._db.checkpoint(this.root())
  }

  /**
   * Commits a checkpoint to disk, if current checkpoint is not nested.
   * If nested, only sets the parent checkpoint as current checkpoint.
   * @throws If not during a checkpoint phase
   */
  async commit(): Promise<void> {
    if (!this.hasCheckpoints()) {
      throw EthereumJSErrorWithoutCode('trying to commit when not checkpointed')
    }
    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['commit'])
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
      throw EthereumJSErrorWithoutCode('trying to revert when not checkpointed')
    }

    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['revert', 'before'])
    await this._lock.acquire()
    this.root(await this._db.revert())
    await this.persistRoot()
    this._lock.release()
    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['revert', 'after'])
  }

  /**
   * Flushes all checkpoints, restoring the initial checkpoint state.
   */
  flushCheckpoints() {
    this.DEBUG &&
      this.debug(`Deleting ${this._db.checkpoints.length} checkpoints.`, ['flush_checkpoints'])
    this._db.checkpoints = []
  }

  /**
   * Returns a list of values stored in the trie
   * @param startKey first unhashed key in the range to be returned (defaults to 0).  Note, all keys must be of the same length or undefined behavior will result
   * @param limit - the number of keys to be returned (undefined means all keys)
   * @returns an object with two properties (a map of all key/value pairs in the trie - or in the specified range) and then a `nextKey` reference if a range is specified
   */
  async getValueMap(
    startKey = BIGINT_0,
    limit?: number,
  ): Promise<{ values: { [key: string]: string }; nextKey: null | string }> {
    // If limit is undefined, all keys are inRange
    let inRange = limit !== undefined ? false : true
    let i = 0
    const values: { [key: string]: string } = {}
    let nextKey: string | null = null
    await this.walkAllValueNodes(async (node: MPTNode, currentKey: number[]) => {
      if (node instanceof LeafMPTNode) {
        const keyBytes = nibblesTypeToPackedBytes(currentKey.concat(node.key()))
        if (!inRange) {
          // Check if the key is already in the correct range.
          if (bytesToBigInt(keyBytes) >= startKey) {
            inRange = true
          } else {
            return
          }
        }

        if (limit === undefined || i < limit) {
          values[bytesToHex(keyBytes)] = bytesToHex(node._value)
          i++
        } else if (i === limit) {
          nextKey = bytesToHex(keyBytes)
        }
      }
    })
    return {
      values,
      nextKey,
    }
  }
}
