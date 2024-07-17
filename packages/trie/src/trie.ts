// Some more secure presets when using e.g. JS `call`
'use strict'

import { RLP } from '@ethereumjs/rlp'
import {
  KeyEncoding,
  Lock,
  MapDB,
  RLP_EMPTY_STRING,
  ValueEncoding,
  bytesToHex,
  bytesToUnprefixedHex,
  bytesToUtf8,
  concatBytes,
  equalsBytes,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import debug from 'debug'
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
import { bytesToNibbles, matchingNibbleLength, orderBatch } from './util/nibbles.js'
import { TrieReadStream as ReadStream } from './util/readStream.js'
import { WalkController } from './util/walkController.js'

import type {
  EmbeddedNode,
  FoundNodeFunction,
  Nibbles,
  Path,
  Proof,
  TrieNode,
  TrieOpts,
  TrieOptsWithDefaults,
  TrieShallowCopyOpts,
} from './types.js'
import type { OnFound } from './util/asyncWalk.js'
import type { BatchDBOp, DB, PutBatch } from '@ethereumjs/util'
import type { Debugger } from 'debug'

/**
 * The basic trie interface, use with `import { Trie } from '@ethereumjs/trie'`.
 */
export class Trie {
  protected readonly _opts: TrieOptsWithDefaults = {
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
  protected _debug: Debugger = debug('trie')
  protected debug: (...args: any) => void

  /**
   * Creates a new trie.
   * @param opts Options for instantiating the trie
   *
   * Note: in most cases, the static {@link Trie.create} constructor should be used.  It uses the same API but provides sensible defaults
   */
  constructor(opts?: TrieOpts) {
    let valueEncoding: ValueEncoding
    if (opts !== undefined) {
      // Sanity check: can only set valueEncoding if a db is provided
      // The valueEncoding defaults to `Bytes` if no DB is provided (use a MapDB in memory)
      if (opts?.valueEncoding !== undefined && opts.db === undefined) {
        throw new Error('`valueEncoding` can only be set if a `db` is provided')
      }
      this._opts = { ...this._opts, ...opts }
      this._opts.useKeyHashingFunction =
        opts.common?.customCrypto.keccak256 ?? opts.useKeyHashingFunction ?? keccak256

      valueEncoding =
        opts.db !== undefined ? opts.valueEncoding ?? ValueEncoding.String : ValueEncoding.Bytes
    } else {
      // No opts are given, so create a MapDB later on
      // Use `Bytes` for ValueEncoding
      valueEncoding = ValueEncoding.Bytes
    }

    this.DEBUG =
      typeof window === 'undefined' ? process?.env?.DEBUG?.includes('ethjs') ?? false : false
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

  /**
   * Create a trie from a given (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof. A proof contains the encoded trie nodes
   * from the root node to the leaf node storing state data.
   * @param proof an EIP-1186 proof to create trie from
   * @param shouldVerifyRoot If `true`, verifies that the root key of the proof matches the trie root. Throws if this is not the case.
   * @param trieOpts trie opts to be applied to returned trie
   * @returns new trie created from given proof
   */
  static async createFromProof(
    proof: Proof,
    trieOpts?: TrieOpts,
    shouldVerifyRoot: boolean = false
  ) {
    const trie = new Trie(trieOpts)
    const root = await trie.updateFromProof(proof, shouldVerifyRoot)
    trie.root(root)
    await trie.persistRoot()
    return trie
  }

  /**
   * Static version of verifyProof function with the same behavior. An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes
   * from the root node to the leaf node storing state data.
   * @param rootHash Root hash of the trie that this proof was created from and is being verified for
   * @param key Key that is being verified and that the proof is created for
   * @param proof An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes from the root node to the leaf node storing state data.
   * @param opts optional, the opts may include a custom hashing function to use with the trie for proof verification
   * @throws If proof is found to be invalid.
   * @returns The value from the key, or null if valid proof of non-existence.
   */
  static async verifyProof(
    key: Uint8Array,
    proof: Proof,
    opts?: TrieOpts
  ): Promise<Uint8Array | null> {
    try {
      const proofTrie = await Trie.createFromProof(proof, opts)
      const value = await proofTrie.get(key, true)
      return value
    } catch (err: any) {
      throw new Error('Invalid proof provided')
    }
  }

  /**
   * A range proof is a proof that includes the encoded trie nodes from the root node to leaf node for one or more branches of a trie,
   * allowing an entire range of leaf nodes to be validated. This is useful in applications such as snap sync where contiguous ranges
   * of state trie data is received and validated for constructing world state, locally. Also see {@link verifyRangeProof}. A static
   * version of this function also exists.
   * @param rootHash - root hash of state trie this proof is being verified against.
   * @param firstKey - first key of range being proven.
   * @param lastKey - last key of range being proven.
   * @param keys - key list of leaf data being proven.
   * @param values - value list of leaf data being proven, one-to-one correspondence with keys.
   * @param proof - proof node list, if all-elements-proof where no proof is needed, proof should be null, and both `firstKey` and `lastKey` must be null as well
   * @param opts - optional, the opts may include a custom hashing function to use with the trie for proof verification
   * @returns a flag to indicate whether there exists more trie node in the trie
   */
  static verifyRangeProof(
    rootHash: Uint8Array,
    firstKey: Uint8Array | null,
    lastKey: Uint8Array | null,
    keys: Uint8Array[],
    values: Uint8Array[],
    proof: Uint8Array[] | null,
    opts?: TrieOpts
  ): Promise<boolean> {
    return verifyRangeProof(
      rootHash,
      firstKey && bytesToNibbles(firstKey),
      lastKey && bytesToNibbles(lastKey),
      keys.map((k) => k).map(bytesToNibbles),
      values,
      proof,
      opts?.useKeyHashingFunction ?? keccak256
    )
  }

  /**
   * Static version of fromProof function. If a root is provided in the opts param, the proof will be checked to have the same expected root. An
   * (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes from the root node to the leaf node storing state data.
   * @param proof An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes from the root node to the leaf node storing state data.
   * @deprecated Use `createFromProof`
   */
  static async fromProof(proof: Proof, opts?: TrieOpts): Promise<Trie> {
    const trie = await Trie.create(opts)
    if (opts?.root && !equalsBytes(opts.root, trie.hash(proof[0]))) {
      throw new Error('Invalid proof provided')
    }
    const root = await trie.updateFromProof(proof)
    trie.root(root)
    await trie.persistRoot()
    return trie
  }

  /**
   * A range proof is a proof that includes the encoded trie nodes from the root node to leaf node for one or more branches of a trie,
   * allowing an entire range of leaf nodes to be validated. This is useful in applications such as snap sync where contiguous ranges
   * of state trie data is received and validated for constructing world state, locally. Also see {@link verifyRangeProof}. A static
   * version of this function also exists.
   * @param rootHash - root hash of state trie this proof is being verified against.
   * @param firstKey - first key of range being proven.
   * @param lastKey - last key of range being proven.
   * @param keys - key list of leaf data being proven.
   * @param values - value list of leaf data being proven, one-to-one correspondence with keys.
   * @param proof - proof node list, if all-elements-proof where no proof is needed, proof should be null, and both `firstKey` and `lastKey` must be null as well
   * @returns a flag to indicate whether there exists more trie node in the trie
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

  /**
   * Creates a proof from a trie and key that can be verified using {@link Trie.verifyProof}. An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains
   * the encoded trie nodes from the root node to the leaf node storing state data. The returned proof will be in the format of an array that contains Uint8Arrays of
   * serialized branch, extension, and/or leaf nodes.
   * @param key key to create a proof for
   */
  async createProof(key: Uint8Array): Promise<Proof> {
    this.DEBUG && this.debug(`Creating Proof for Key: ${bytesToHex(key)}`, ['CREATE_PROOF'])
    const { stack } = await this.findPath(this.appliedKey(key))
    const p = stack.map((stackElem) => {
      return stackElem.serialize()
    })
    this.DEBUG && this.debug(`Proof created with (${stack.length}) nodes`, ['CREATE_PROOF'])
    return p
  }

  /**
   * Updates a trie from a proof by putting all the nodes in the proof into the trie. If a trie is being updated with multiple proofs, {@param shouldVerifyRoot} can
   * be passed as false in order to not immediately throw on an unexpected root, so that root verification can happen after all proofs and their nodes have been added.
   * An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof contains the encoded trie nodes from the root node to the leaf node storing state data.
   * @param proof An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof to update the trie from.
   * @param shouldVerifyRoot If `true`, verifies that the root key of the proof matches the trie root. Throws if this is not the case.
   * @returns The root of the proof
   */
  async updateFromProof(proof: Proof, shouldVerifyRoot: boolean = false) {
    this.DEBUG && this.debug(`Saving (${proof.length}) proof nodes in DB`, ['FROM_PROOF'])
    const opStack = proof.map((nodeValue) => {
      let key = Uint8Array.from(this.hash(nodeValue))
      key = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, key) : key
      return {
        type: 'put',
        key,
        value: nodeValue,
      } as PutBatch
    })

    if (shouldVerifyRoot) {
      if (opStack[0] !== undefined && opStack[0] !== null) {
        if (!equalsBytes(this.root(), opStack[0].key)) {
          throw new Error('The provided proof does not have the expected trie root')
        }
      }
    }

    await this._db.batch(opStack)
    if (opStack[0] !== undefined) {
      return opStack[0].key
    }
  }

  /**
   * Verifies a proof by putting all of its nodes into a trie and attempting to get the proven key. An (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof
   * contains the encoded trie nodes from the root node to the leaf node storing state data. A static version of this function exists with the same name.
   * @param rootHash Root hash of the trie that this proof was created from and is being verified for
   * @param key Key that is being verified and that the proof is created for
   * @param proof an EIP-1186 proof to verify the key against
   * @throws If proof is found to be invalid.
   * @returns The value from the key, or null if valid proof of non-existence.
   */
  async verifyProof(
    rootHash: Uint8Array,
    key: Uint8Array,
    proof: Proof
  ): Promise<Uint8Array | null> {
    this.DEBUG &&
      this.debug(
        `Verifying Proof:\n|| Key: ${bytesToHex(key)}\n|| Root: ${bytesToHex(
          rootHash
        )}\n|| Proof: (${proof.length}) nodes
    `,
        ['VERIFY_PROOF']
      )
    const proofTrie = new Trie({
      root: rootHash,
      useKeyHashingFunction: this._opts.useKeyHashingFunction,
      common: this._opts.common,
    })
    try {
      await proofTrie.updateFromProof(proof, true)
    } catch (e: any) {
      throw new Error('Invalid proof nodes given')
    }
    try {
      this.DEBUG &&
        this.debug(`Verifying proof by retrieving key: ${bytesToHex(key)} from proof trie`, [
          'VERIFY_PROOF',
        ])
      const value = await proofTrie.get(this.appliedKey(key), true)
      this.DEBUG && this.debug(`PROOF VERIFIED`, ['VERIFY_PROOF'])
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
   * Create a trie from a given (EIP-1186)[https://eips.ethereum.org/EIPS/eip-1186] proof. An EIP-1186 proof contains the encoded trie nodes from the root
   * node to the leaf node storing state data. This function does not check if the proof has the same expected root. A static version of this function exists
   * with the same name.
   * @param proof an EIP-1186 proof to update the trie from
   * @deprecated Use `updateFromProof`
   */
  async fromProof(proof: Proof): Promise<void> {
    await this.updateFromProof(proof, false)

    if (equalsBytes(this.root(), this.EMPTY_TRIE_ROOT) && proof[0] !== undefined) {
      let rootKey = Uint8Array.from(this.hash(proof[0]))
      // TODO: what if we have keyPrefix and we set root? This should not work, right? (all trie nodes are non-reachable)
      rootKey = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, rootKey) : rootKey
      this.root(rootKey)
      await this.persistRoot()
    }
    return
  }

  static async create(opts?: TrieOpts) {
    const keccakFunction =
      opts?.common?.customCrypto.keccak256 ?? opts?.useKeyHashingFunction ?? keccak256
    let key = ROOT_DB_KEY

    const encoding =
      opts?.valueEncoding === ValueEncoding.Bytes ? ValueEncoding.Bytes : ValueEncoding.String

    if (opts?.useKeyHashing === true) {
      key = keccakFunction.call(undefined, ROOT_DB_KEY) as Uint8Array
    }
    if (opts?.keyPrefix !== undefined) {
      key = concatBytes(opts.keyPrefix, key)
    }

    if (opts?.db !== undefined && opts?.useRootPersistence === true) {
      if (opts?.root === undefined) {
        const root = await opts?.db.get(bytesToUnprefixedHex(key), {
          keyEncoding: KeyEncoding.String,
          valueEncoding: encoding,
        })
        if (typeof root === 'string') {
          opts.root = unprefixedHexToBytes(root)
        } else {
          opts.root = root
        }
      } else {
        await opts?.db.put(
          bytesToUnprefixedHex(key),
          <any>(encoding === ValueEncoding.Bytes ? opts.root : bytesToUnprefixedHex(opts.root)),
          {
            keyEncoding: KeyEncoding.String,
            valueEncoding: encoding,
          }
        )
      }
    }

    return new Trie(opts)
  }

  database(db?: DB<string, string | Uint8Array>, valueEncoding?: ValueEncoding) {
    if (db !== undefined) {
      if (db instanceof CheckpointDB) {
        throw new Error('Cannot pass in an instance of CheckpointDB')
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
        throw new Error(
          `Invalid root length. Roots are ${this._hashLen} bytes, got ${value.length} bytes`
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
    this.DEBUG && this.debug(`Key: ${bytesToHex(key)}`, ['GET'])
    const { node, remaining } = await this.findPath(this.appliedKey(key), throwIfMissing)
    let value: Uint8Array | null = null
    if (node && remaining.length === 0) {
      value = node.value()
    }
    this.DEBUG && this.debug(`Value: ${value === null ? 'null' : bytesToHex(value)}`, ['GET'])
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
    path?: { stack: TrieNode[]; remaining: number[] }
  ): Promise<TrieNode[]> {
    this.DEBUG && this.debug(`Key: ${bytesToHex(key)}`, ['PUT'])
    this.DEBUG && this.debug(`Value: ${value === null ? 'null' : bytesToHex(key)}`, ['PUT'])
    if (this._opts.useRootPersistence && equalsBytes(key, ROOT_DB_KEY) === true) {
      throw new Error(`Attempted to set '${bytesToUtf8(ROOT_DB_KEY)}' key but it is not allowed.`)
    }
    let returnStack: TrieNode[] = []
    // If value is empty, delete
    if (value === null || value.length === 0) {
      return this.del(key)
    }

    await this._lock.acquire()
    const appliedKey = skipKeyTransform ? key : this.appliedKey(key)
    if (equalsBytes(this.root(), this.EMPTY_TRIE_ROOT) === true) {
      // If no root, initialize this trie
      returnStack = [await this._createInitialNode(appliedKey, value)]
    } else {
      // First try to find the given key or its nearest node
      const { remaining, stack } = path ?? (await this.findPath(appliedKey))
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
      returnStack = await this._updateNode(appliedKey, value, remaining, stack)
      if (this._opts.useNodePruning) {
        // Only after updating the node we can delete the keyhashes
        await this._db.batch(ops)
      }
    }
    await this.persistRoot()
    this._lock.release()
    return returnStack
  }

  /**
   * Deletes a value given a `key` from the trie
   * (delete operations are only executed on DB with `deleteFromDB` set to `true`)
   * @param key
   * @returns A Promise that resolves once value is deleted.
   */
  async del(
    key: Uint8Array,
    skipKeyTransform: boolean = false,
    path?: { stack: TrieNode[]; remaining: number[] }
  ): Promise<TrieNode[]> {
    this.DEBUG && this.debug(`Key: ${bytesToHex(key)}`, ['DEL'])
    await this._lock.acquire()
    const appliedKey = skipKeyTransform ? key : this.appliedKey(key)
    const partialPath = path && { stack: path.stack }
    const { node, stack } = await this.findPath(appliedKey, false, partialPath)

    let ops: BatchDBOp[] = []
    // Only delete if the `key` currently has any value
    if (this._opts.useNodePruning && node !== null) {
      const deleteHashes = stack.map((e) => this.hash(e.serialize()))
      // Just as with `put`, the stack items all will have their keyhashes updated
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
      // Only after deleting the node it is possible to delete the keyhashes
      await this._db.batch(ops)
    }
    await this.persistRoot()
    this._lock.release()
    return stack
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
      stack: TrieNode[]
    } = {
      stack: [],
    }
  ): Promise<Path> {
    const targetKey = bytesToNibbles(key)
    const keyLen = targetKey.length
    const stack: TrieNode[] = Array.from({ length: keyLen })
    let progress = 0
    for (let i = 0; i < partialPath.stack.length - 1; i++) {
      stack[i] = partialPath.stack[i]
      progress += stack[i] instanceof BranchNode ? 1 : (<ExtensionNode>stack[i]).keyLength()
    }
    this.DEBUG && this.debug(`Target (${targetKey.length}): [${targetKey}]`, ['FIND_PATH'])
    let result: Path | null = null

    const onFound: FoundNodeFunction = async (_, node, keyProgress, walkController) => {
      stack[progress] = node as TrieNode
      if (node instanceof BranchNode) {
        if (progress === keyLen) {
          result = { node, remaining: [], stack }
        } else {
          const branchIndex = targetKey[progress]
          this.DEBUG &&
            this.debug(`Looking for node on branch index: [${branchIndex}]`, [
              'FIND_PATH',
              'BranchNode',
            ])
          const branchNode = node.getBranch(branchIndex)
          this.DEBUG &&
            this.debug(
              branchNode === null
                ? 'NULL'
                : branchNode instanceof Uint8Array
                ? `NodeHash: ${bytesToHex(branchNode)}`
                : `Raw_Node: ${branchNode.toString()}`,
              ['FIND_PATH', 'BranchNode', branchIndex.toString()]
            )
          if (!branchNode) {
            result = { node: null, remaining: targetKey.slice(progress), stack }
          } else {
            progress++
            walkController.onlyBranchIndex(node, keyProgress, branchIndex)
          }
        }
      } else if (node instanceof LeafNode) {
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
      } else if (node instanceof ExtensionNode) {
        this.DEBUG &&
          this.debug(
            `Comparing node key to expected\n|| Node_Key: [${node.key()}]\n|| Expected: [${targetKey.slice(
              progress,
              progress + node.key().length
            )}]\n|| Matching: [${
              targetKey.slice(progress, progress + node.key().length).toString() ===
              node.key().toString()
            }]
            `,
            ['FIND_PATH', 'ExtensionNode']
          )
        const _progress = progress
        for (const k of node.key()) {
          this.DEBUG && this.debug(`NextNode: ${node.value()}`, ['FIND_PATH', 'ExtensionNode'])
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
    const start = startingNode !== undefined ? this.hash(startingNode?.serialize()) : this.root()
    try {
      this.DEBUG &&
        this.debug(
          `Walking trie from ${startingNode === undefined ? 'ROOT' : 'NODE'}: ${bytesToHex(
            start as Uint8Array
          )}`,
          ['FIND_PATH']
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
        ['FIND_PATH']
      )

    result.stack = result.stack.filter((e) => e !== undefined)
    this.DEBUG &&
      this.debug(
        `Result:
        || Node: ${result.node === null ? 'null' : result.node.constructor.name}
        || Remaining: [${result.remaining}]\n|| Stack: ${result.stack
          .map((e) => e.constructor.name)
          .join(', ')}`,
        ['FIND_PATH']
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
  protected async _createInitialNode(key: Uint8Array, value: Uint8Array): Promise<TrieNode> {
    const newNode = new LeafNode(bytesToNibbles(key), value)

    const encoded = newNode.serialize()
    this.root(this.hash(encoded))
    let rootKey = this.root()
    rootKey = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, rootKey) : rootKey
    await this._db.put(rootKey, encoded)
    await this.persistRoot()
    return newNode
  }

  /**
   * Retrieves a node from db by hash.
   */
  async lookupNode(node: Uint8Array | Uint8Array[]): Promise<TrieNode> {
    if (isRawNode(node)) {
      const decoded = decodeRawNode(node)
      this.DEBUG && this.debug(`${decoded.constructor.name}`, ['LOOKUP_NODE', 'RAW_NODE'])
      return decoded
    }
    this.DEBUG && this.debug(`${`${bytesToHex(node)}`}`, ['LOOKUP_NODE', 'BY_HASH'])
    const key = this._opts.keyPrefix ? concatBytes(this._opts.keyPrefix, node) : node
    const value = (await this._db.get(key)) ?? null

    if (value === null) {
      // Dev note: this error message text is used for error checking in `checkRoot`, `verifyProof`, and `findPath`
      throw new Error('Missing node in DB')
    }

    const decoded = decodeNode(value)
    this.DEBUG && this.debug(`${decoded.constructor.name} found in DB`, ['LOOKUP_NODE', 'BY_HASH'])
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
    stack: TrieNode[]
  ): Promise<TrieNode[]> {
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

    const returnStack = [...stack]
    await this.saveStack(key, stack, toSave)
    return returnStack
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
        // If the branchNode has length < 32, it will be a RawNode (Uint8Array[]) instead of a Uint8Array
        // In that case, we need to serialize and hash it into a Uint8Array, otherwise the operation will throw
        opStack.push({
          type: 'del',
          key: isRawNode(branchNode) ? this.appliedKey(RLP.encode(branchNode)) : branchNode,
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
      const node = stack.pop()
      if (node === undefined) {
        throw new Error('saveStack: missing node')
      }
      if (node instanceof LeafNode || node instanceof ExtensionNode) {
        key.splice(key.length - node.key().length)
      }
      if (node instanceof ExtensionNode && lastRoot !== undefined) {
        node.value(lastRoot)
      }
      if (node instanceof BranchNode && lastRoot !== undefined) {
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
    node: TrieNode,
    topLevel: boolean,
    opStack: BatchDBOp[],
    remove: boolean = false
  ): Uint8Array | (EmbeddedNode | null)[] {
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
   *  , { type: 'put', key: Uint8Array.from('name'), value: Uint8Array.from('Yuri Irsenovich Kim') }
   *  , { type: 'put', key: Uint8Array.from('dob'), value: Uint8Array.from('16 February 1941') }
   *  , { type: 'put', key: Uint8Array.from('spouse'), value: Uint8Array.from('Kim Young-sook') }
   *  , { type: 'put', key: Uint8Array.from('occupation'), value: Uint8Array.from('Clown') }
   * ]
   * await trie.batch(ops)
   * @param ops
   */
  async batch(ops: BatchDBOp[], skipKeyTransform?: boolean): Promise<void> {
    const keyTransform =
      skipKeyTransform === true
        ? undefined
        : (msg: Uint8Array) => {
            return this.appliedKey(msg)
          }
    const sortedOps = orderBatch(ops, keyTransform)
    let stack: TrieNode[] = []
    const stackPathCache: Map<string, TrieNode> = new Map()
    for (const op of sortedOps) {
      const appliedKey = skipKeyTransform === true ? op.key : this.appliedKey(op.key)
      const nibbles = bytesToNibbles(appliedKey)
      stack = []
      let remaining = nibbles
      for (let i = 0; i < nibbles.length; i++) {
        const p: string = JSON.stringify(nibbles.slice(0, i) as number[])
        if (stackPathCache.has(p)) {
          const node = stackPathCache.get(p)!
          stack.push(node)
          remaining = nibbles.slice(i)
        }
      }
      const _path =
        stack.length > 0
          ? {
              stack,
              remaining,
            }
          : undefined
      if (op.type === 'put') {
        stack = await this.put(op.key, op.value, skipKeyTransform, _path)
        const path: number[] = []
        for (const node of stack) {
          stackPathCache.set(JSON.stringify([...path]), node)
          if (node instanceof BranchNode) {
            path.push(nibbles.shift()!)
          } else {
            path.push(...nibbles.splice(0, node.keyLength()))
          }
        }
      } else if (op.type === 'del') {
        stack = await this.put(op.key, null, skipKeyTransform, _path)
        const path: number[] = []
        for (const node of stack) {
          stackPathCache.set(JSON.stringify([...path]), node)
          if (node instanceof BranchNode) {
            path.push(nibbles.shift()!)
          } else {
            path.push(...nibbles.splice(0, node.keyLength()))
          }
        }
      }
    }
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
          if (node instanceof BranchNode) {
            for (const item of node._branches) {
              // If one of the branches matches the key, then it is found
              if (
                item !== null &&
                bytesToUnprefixedHex(
                  isRawNode(item) ? controller.trie.appliedKey(RLP.encode(item)) : item
                ) === dbkey
              ) {
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
   * Note on cache: for memory reasons a copy will by default
   * not recreate a new LRU cache but initialize with cache
   * being deactivated. This behavior can be overwritten by
   * explicitly setting `cacheSize` as an option on the method.
   *
   * @param includeCheckpoints - If true and during a checkpoint, the copy will contain the checkpointing metadata and will use the same scratch as underlying db.
   */
  shallowCopy(includeCheckpoints = true, opts?: TrieShallowCopyOpts): Trie {
    const trie = new Trie({
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
            this.appliedKey(ROOT_DB_KEY)
          )}`,
          ['PERSIST_ROOT']
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
    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['CHECKPOINT'])
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
    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['COMMIT'])
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

    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['REVERT', 'BEFORE'])
    await this._lock.acquire()
    this.root(await this._db.revert())
    await this.persistRoot()
    this._lock.release()
    this.DEBUG && this.debug(`${bytesToHex(this.root())}`, ['REVERT', 'AFTER'])
  }

  /**
   * Flushes all checkpoints, restoring the initial checkpoint state.
   */
  flushCheckpoints() {
    this.DEBUG &&
      this.debug(`Deleting ${this._db.checkpoints.length} checkpoints.`, ['FLUSH_CHECKPOINTS'])
    this._db.checkpoints = []
  }
}
