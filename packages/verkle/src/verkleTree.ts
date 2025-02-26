import {
  EthereumJSErrorWithoutCode,
  Lock,
  bytesToHex,
  equalsBytes,
  intToHex,
  matchingBytesLength,
} from '@ethereumjs/util'
import debug from 'debug'

import { CheckpointDB } from './db/checkpoint.js'
import { InternalVerkleNode } from './node/internalNode.js'
import { LeafVerkleNode } from './node/leafNode.js'
import { LeafVerkleNodeValue, type VerkleNode } from './node/types.js'
import { createZeroesLeafValue, decodeVerkleNode, isLeafVerkleNode } from './node/util.js'
import { type Proof, ROOT_DB_KEY, type VerkleTreeOpts } from './types.js'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { createVerkleTree } from './constructors.js' // Imported so intellisense can display docs
import type { PutBatch, VerkleCrypto } from '@ethereumjs/util'
import type { Debugger } from 'debug'
interface Path {
  node: VerkleNode | null
  remaining: Uint8Array
  stack: Array<[VerkleNode, Uint8Array]>
}

/**
 * The basic verkle tree interface, use with `import { VerkleTree } from '@ethereumjs/verkle'`.
 */
export class VerkleTree {
  _opts: VerkleTreeOpts

  /** The root for an empty tree */
  EMPTY_TREE_ROOT: Uint8Array

  /** The backend DB */
  protected _db!: CheckpointDB
  protected _hashLen: number
  protected _lock = new Lock()
  protected _root: Uint8Array

  protected verkleCrypto: VerkleCrypto

  /** Debug logging */
  protected DEBUG: boolean
  protected _debug: Debugger = debug('verkle:#')
  protected debug: (...args: any) => void
  /**
   * Creates a new verkle tree.
   * @param opts Options for instantiating the verkle tree
   *
   * Note: in most cases, the static {@link createVerkleTree} constructor should be used. It uses the same API but provides sensible defaults
   */
  constructor(opts: VerkleTreeOpts) {
    this._opts = opts

    if (opts.db instanceof CheckpointDB) {
      throw EthereumJSErrorWithoutCode('Cannot pass in an instance of CheckpointDB')
    }
    this._db = new CheckpointDB({ db: opts.db, cacheSize: opts.cacheSize })

    this.EMPTY_TREE_ROOT = new Uint8Array(32)
    this._hashLen = this.EMPTY_TREE_ROOT.length
    this._root = this.EMPTY_TREE_ROOT

    if (opts?.root) {
      this.root(opts.root)
    }

    this.verkleCrypto = opts.verkleCrypto

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

    this.DEBUG &&
      this.debug(`Trie created:
    || Root: ${bytesToHex(this._root)}
    || Persistent: ${this._opts.useRootPersistence}
    || CacheSize: ${this._opts.cacheSize}
    || ----------------`)
  }

  /**
   * Gets and/or Sets the current root of the `tree`
   */
  root(value?: Uint8Array | null): Uint8Array {
    if (value !== undefined) {
      if (value === null) {
        value = this.EMPTY_TREE_ROOT
      }

      if (value.length !== this._hashLen) {
        throw EthereumJSErrorWithoutCode(`Invalid root length. Roots are ${this._hashLen} bytes`)
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
      const value = await this._db.get(root)
      return value !== null
    } catch (error: any) {
      if (error.message === 'Missing node in DB') {
        return equalsBytes(root, this.EMPTY_TREE_ROOT)
      } else {
        throw error
      }
    }
  }

  /**
   * Gets values at a given verkle `stem` and set of suffixes
   * @param stem - the stem of the leaf node where we're seeking values
   * @param suffixes - an array of suffixes corresponding to the values desired
   * @returns A Promise that resolves to an array of `Uint8Array`s if a value
   * was found or `undefined` if no value was found at a given suffixes.
   */
  async get(stem: Uint8Array, suffixes: number[]): Promise<(Uint8Array | undefined)[]> {
    if (stem.length !== 31)
      throw EthereumJSErrorWithoutCode(`expected stem with length 31; got ${stem.length}`)
    this.DEBUG && this.debug(`Stem: ${bytesToHex(stem)}; Suffix: ${suffixes}`, ['get'])
    const res = await this.findPath(stem)
    if (res.node instanceof LeafVerkleNode) {
      // The retrieved leaf node contains an array of 256 possible values.
      // We read all the suffixes to get the desired values
      const values = []
      for (const suffix of suffixes) {
        const value = res.node.getValue(suffix)
        this.DEBUG &&
          this.debug(
            `Suffix: ${suffix}; Value: ${value === undefined ? 'undefined' : bytesToHex(value)}`,
            ['get'],
          )
        values.push(value)
      }
      return values
    }

    return []
  }

  /**
   * Stores given `values` at the given `stem` and `suffixes` or do a delete if `value` is empty Uint8Array
   * @param key - the stem to store the value at (must be 31 bytes long)
   * @param suffixes - array of suffixes at which to store individual values
   * @param value - the value(s) to store
   * @returns A Promise that resolves once value(s) are stored.
   */
  async put(
    stem: Uint8Array,
    suffixes: number[],
    values: (Uint8Array | LeafVerkleNodeValue.Untouched)[] = [],
  ): Promise<void> {
    if (stem.length !== 31)
      throw EthereumJSErrorWithoutCode(`expected stem with length 31, got ${stem.length}`)
    if (values.length > 0 && values.length !== suffixes.length) {
      // Must have an equal number of values and suffixes
      throw EthereumJSErrorWithoutCode(
        `expected number of values; ${values.length} to equal ${suffixes.length}`,
      )
    }
    this.DEBUG && this.debug(`Stem: ${bytesToHex(stem)}`, ['put'])

    const putStack: [Uint8Array, VerkleNode | null][] = []
    // Find path to nearest node
    const foundPath = await this.findPath(stem)

    // Sanity check - we should at least get the root node back
    if (foundPath.stack.length === 0) {
      throw EthereumJSErrorWithoutCode(`Root node not found in trie`)
    }

    // Step 1) Create or update the leaf node
    let leafNode: LeafVerkleNode
    // First see if leaf node already exists
    if (foundPath.node !== null) {
      // Sanity check to verify we have the right node type
      if (!isLeafVerkleNode(foundPath.node)) {
        throw EthereumJSErrorWithoutCode(
          `expected leaf node found at ${bytesToHex(stem)}. Got internal node instead`,
        )
      }
      leafNode = foundPath.node
      // Sanity check to verify we have the right leaf node
      if (!equalsBytes(leafNode.stem, stem)) {
        throw EthereumJSErrorWithoutCode(
          `invalid leaf node found. Expected stem: ${bytesToHex(stem)}; got ${bytesToHex(
            foundPath.node.stem,
          )}`,
        )
      }
    } else {
      // Leaf node doesn't exist, create a new one
      leafNode = await LeafVerkleNode.create(stem, this.verkleCrypto)
      this.DEBUG && this.debug(`Creating new leaf node at stem: ${bytesToHex(stem)}`, ['put'])
    }
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      const suffix = suffixes[i]
      // Update value(s) in leaf node
      if (value !== LeafVerkleNodeValue.Untouched && equalsBytes(value, createZeroesLeafValue())) {
        // Special case for when the deleted leaf value or zeroes is passed to `put`
        // Writing the deleted leaf value to the suffix
        leafNode.setValue(suffix, LeafVerkleNodeValue.Deleted)
      } else {
        leafNode.setValue(suffix, value)
      }
      this.DEBUG &&
        this.debug(
          `Updating value for suffix: ${suffix} to value: ${value instanceof Uint8Array ? bytesToHex(value) : value} at leaf node with stem: ${bytesToHex(stem)}`,
          ['put'],
        )
    }
    if (leafNode.values.every((val) => val === LeafVerkleNodeValue.Untouched)) {
      // If all of the values are "untouched", this node should be deleted if it was previously created
      if (foundPath.node !== null) {
        // If the node previously existed, we need to delete it
        this.DEBUG && this.debug(`Deleting leaf node at stem: ${bytesToHex(stem)}`, ['put'])
        putStack.push([leafNode.hash(), null])
      } else {
        // If the leaf node doesn't exist in the tree, we shouldn't insert it and should just return
        return
      }
    } else {
      // Push new/updated leafNode to putStack
      putStack.push([leafNode.hash(), leafNode])
    }

    // `path` is the path to the last node pushed to the `putStack`
    let lastPath = leafNode.stem

    // Step 2) Determine if a new internal node is needed
    if (foundPath.stack.length > 1) {
      // Only insert new internal node if we have more than 1 node in the path
      // since a single node indicates only the root node is in the path
      const nearestNodeTuple = foundPath.stack.pop()!
      const nearestNode = nearestNodeTuple[0]
      lastPath = nearestNodeTuple[1]
      const updatedParentTuple = await this.updateParent(leafNode, nearestNode, lastPath)
      if (updatedParentTuple !== undefined) {
        putStack.push([updatedParentTuple.node.hash(), updatedParentTuple.node])
        lastPath = updatedParentTuple.lastPath
      }

      // Step 3) Walk up trie and update child references in parent internal nodes
      while (foundPath.stack.length > 1) {
        const [nextNode, nextPath] = foundPath.stack.pop()! as [InternalVerkleNode, Uint8Array]
        // Compute the child index to be updated on `nextNode`
        const childIndex = lastPath[matchingBytesLength(lastPath, nextPath)]
        // Update child reference
        const childReference = putStack[putStack.length - 1][1]

        if (childReference !== null) {
          nextNode.setChild(childIndex, {
            commitment: childReference.commitment,
            path: lastPath,
          })
          this.DEBUG &&
            this.debug(
              `Updating child reference for node with path: ${bytesToHex(
                lastPath,
              )} at index ${childIndex} in internal node at path ${bytesToHex(nextPath)}`,
              ['put'],
            )
          putStack.push([nextNode.hash(), nextNode])
        } else {
          nextNode.setChild(childIndex, null)
          if (equalsBytes(nextNode.commitment, this.verkleCrypto.zeroCommitment)) {
            // If the node's commitment is the zero commitment, it has no child nodes and should be removed from the tree
            putStack.push([nextNode.hash(), null])
          } else {
            putStack.push([nextNode.hash(), nextNode])
          }
          this.DEBUG &&
            this.debug(
              `Deleting child reference for node with path: ${bytesToHex(
                lastPath,
              )} at index ${childIndex} in internal node at path ${bytesToHex(nextPath)}`,
              ['put'],
            )
        }
        // Hold onto `path` to current node for updating next parent node child index
        lastPath = nextPath
      }
    }

    // Step 4) Update root node
    const rootNode = foundPath.stack.pop()![0] as InternalVerkleNode
    const childReference = putStack[putStack.length - 1][1]
    if (childReference !== null) {
      rootNode.setChild(stem[0], {
        commitment: childReference.commitment,
        path: lastPath,
      })
    } else {
      // Set child reference to null if the child node was deleted
      rootNode.setChild(stem[0], null)
    }
    this.root(this.verkleCrypto.serializeCommitment(rootNode.commitment))
    this.DEBUG &&
      this.debug(
        `Updating child reference for node with path: ${bytesToHex(lastPath)} at index ${
          lastPath[0]
        } in root node`,
        ['put'],
      )
    this.DEBUG && this.debug(`Updating root node hash to ${bytesToHex(this._root)}`, ['put'])
    putStack.push([this._root, rootNode])
    await this.saveStack(putStack)
  }

  async del(stem: Uint8Array, suffixes: number[]): Promise<void> {
    this.DEBUG && this.debug(`Stem: ${bytesToHex(stem)}; Suffix(es): ${suffixes}`, ['del'])
    await this.put(stem, suffixes, new Array(suffixes.length).fill(createZeroesLeafValue()))
  }
  /**
   * Helper method for updating or creating the parent internal node for a given leaf node
   * @param leafNode the child leaf node that will be referenced by the new/updated internal node
   * returned by this method
   * @param nearestNode the nearest node to the new leaf node
   * @param pathToNode the path to `nearestNode`
   * @returns a tuple of the updated parent node and the path to that parent (i.e. the partial stem of the leaf node that leads to the parent)
   */
  async updateParent(
    leafNode: LeafVerkleNode,
    nearestNode: VerkleNode,
    pathToNode: Uint8Array,
  ): Promise<{ node: VerkleNode; lastPath: Uint8Array } | undefined> {
    const leafNodeWasDeleted =
      leafNode.values.filter((val) => val !== LeafVerkleNodeValue.Untouched).length === 0

    // Compute the portion of leafNode.stem and nearestNode.path that match (i.e. the partial path closest to leafNode.stem)
    const partialMatchingStemIndex = matchingBytesLength(leafNode.stem, pathToNode)
    let internalNode: InternalVerkleNode
    if (isLeafVerkleNode(nearestNode) && !leafNodeWasDeleted) {
      // We need to create a new internal node and set nearestNode and leafNode as child nodes of it
      // Create new internal node
      internalNode = InternalVerkleNode.create(this.verkleCrypto)
      // Set leafNode and nextNode as children of the new internal node
      internalNode.setChild(leafNode.stem[partialMatchingStemIndex], {
        commitment: leafNode.commitment,
        path: leafNode.stem,
      })
      internalNode.setChild(nearestNode.stem[partialMatchingStemIndex], {
        commitment: nearestNode.commitment,
        path: nearestNode.stem,
      })
      // Find the path to the new internal node (the matching portion of the leaf node and next node's stems)
      pathToNode = leafNode.stem.slice(0, partialMatchingStemIndex)
      this.DEBUG &&
        this.debug(`Creating new internal node at path ${bytesToHex(pathToNode)}`, ['put'])
    } else if (!isLeafVerkleNode(nearestNode)) {
      // Nearest node is an internal node.  We need to update the appropriate child reference
      // to the new leaf node
      internalNode = nearestNode
      internalNode.setChild(
        leafNode.stem[partialMatchingStemIndex],
        leafNodeWasDeleted
          ? null
          : {
              commitment: leafNode.commitment,
              path: leafNode.stem,
            },
      )
      if (leafNodeWasDeleted) {
        // Check to see if the internal node has only one other child node
        const children = internalNode.children.filter((el) => el !== null)
        if (children.length === 1) {
          // If the internal node has only one child, we can replace the internal node with its child
          const rawNode = await this._db.get(
            this.verkleCrypto.hashCommitment(children[0]!.commitment),
          )
          if (rawNode === undefined)
            throw EthereumJSErrorWithoutCode(
              `missing node in DB at ${bytesToHex(children[0]!.path)}`,
            )
          return {
            node: decodeVerkleNode(rawNode, this.verkleCrypto) as VerkleNode,
            lastPath: children[0]!.path,
          }
        }
      }

      this.DEBUG &&
        this.debug(
          `Updating child reference for leaf node with stem: ${bytesToHex(
            leafNode.stem,
          )} at index ${
            leafNode.stem[partialMatchingStemIndex]
          } in internal node at path ${bytesToHex(
            leafNode.stem.slice(0, partialMatchingStemIndex),
          )}`,
          ['put'],
        )
    } else {
      // Nearest node is a leaf node and new leaf node is actually being deleted
      return
    }
    return { node: internalNode, lastPath: pathToNode }
  }
  /**
   * Tries to find a path to the node for the given key.
   * It returns a `stack` of nodes to the closest node.
   * @param key - the search key
   * @param throwIfMissing - if true, throws if any nodes are missing. Used for verifying proofs. (default: false)
   */
  async findPath(key: Uint8Array): Promise<Path> {
    this.DEBUG && this.debug(`Path (${key.length}): [${bytesToHex(key)}]`, ['find_path'])
    const result: Path = {
      node: null,
      stack: [],
      remaining: key,
    }

    // TODO: Decide if findPath should return an empty stack if we have an empty trie or a path with just the empty root node
    // if (equalsBytes(this.root(), this.EMPTY_TREE_ROOT)) return result

    // Get root node
    let rawNode = await this._db.get(this.root())
    if (rawNode === undefined) throw EthereumJSErrorWithoutCode('root node should exist')

    const rootNode = decodeVerkleNode(rawNode, this.verkleCrypto) as InternalVerkleNode

    this.DEBUG && this.debug(`Starting with Root Node: [${bytesToHex(this.root())}]`, ['find_path'])
    result.stack.push([rootNode, this.root()])
    let child = rootNode.children[key[0]]

    // Root node doesn't contain a child node's commitment on the first byte of the path so we're done
    if (child === null) {
      this.DEBUG && this.debug(`Partial Path ${intToHex(key[0])} - found no child.`, ['find_path'])
      return result
    }
    let finished = false
    while (!finished) {
      // Look up child node by node hash
      rawNode = await this._db.get(this.verkleCrypto.hashCommitment(child!.commitment))
      // We should always find the node if the path is specified in child.path
      if (rawNode === undefined)
        throw EthereumJSErrorWithoutCode(`missing node at ${bytesToHex(child!.path)}`)
      const decodedNode = decodeVerkleNode(rawNode, this.verkleCrypto)

      // Calculate the index of the last matching byte in the key
      const matchingKeyLength = matchingBytesLength(key, child!.path)
      const foundNode = equalsBytes(key, child!.path)
      if (foundNode || child!.path.length >= key.length || isLeafVerkleNode(decodedNode)) {
        // If the key and child.path are equal, then we found the node
        // If the child.path is the same length or longer than the key but doesn't match it
        // or the found node is a leaf node, we've found another node where this node should
        // be if it existed in the trie
        // i.e. the node doesn't exist in the trie
        finished = true
        if (foundNode) {
          this.DEBUG &&
            this.debug(
              `Path ${bytesToHex(key)} - found full path to node ${bytesToHex(
                decodedNode.hash(),
              )}.`,
              ['find_path'],
            )
          result.node = decodedNode
          result.remaining = new Uint8Array()
          return result
        }
        // We found a different node than the one specified by `key`
        // so the sought node doesn't exist
        result.remaining = key.slice(matchingKeyLength)
        const pathToNearestNode = isLeafVerkleNode(decodedNode) ? decodedNode.stem : child!.path
        this.DEBUG &&
          this.debug(
            `Path ${bytesToHex(pathToNearestNode)} - found path to nearest node ${bytesToHex(
              decodedNode.hash(),
            )} but target node not found.`,
            ['find_path'],
          )
        result.stack.push([decodedNode, pathToNearestNode])
        return result
      }
      // Push internal node to path stack
      result.stack.push([decodedNode, key.slice(0, matchingKeyLength)])
      this.DEBUG &&
        this.debug(
          `Partial Path ${bytesToHex(
            key.slice(0, matchingKeyLength),
          )} - found next node in path ${bytesToHex(decodedNode.hash())}.`,
          ['find_path'],
        )
      // Get the next child node in the path
      const childIndex = key[matchingKeyLength]
      child = decodedNode.children[childIndex]
      if (child === null) break
    }
    this.DEBUG &&
      this.debug(
        `Found partial path ${key.slice(
          31 - result.remaining.length,
        )} but sought node is not present in trie.`,
        ['find_path'],
      )
    return result
  }

  /**
   * Create empty root node for initializing an empty tree.
   */

  async createRootNode(): Promise<void> {
    const rootNode = new InternalVerkleNode({
      commitment: this.verkleCrypto.zeroCommitment,
      verkleCrypto: this.verkleCrypto,
    })

    this.DEBUG && this.debug(`No root node. Creating new root node`, ['initialize'])
    // Set trie root to serialized (aka compressed) commitment for later use in verkle proof
    this.root(this.verkleCrypto.serializeCommitment(rootNode.commitment))
    await this.saveStack([[this.root(), rootNode]])
    return
  }

  /**
   * Saves a stack of nodes to the database.
   *
   * @param putStack - an array of tuples of keys (the partial path of the node in the trie) and nodes (VerkleNodes)
   */

  async saveStack(putStack: [Uint8Array, VerkleNode | null][]): Promise<void> {
    const opStack = putStack.map(([key, node]) => {
      return {
        type: node !== null ? 'put' : 'del',
        key,
        value: node !== null ? node.serialize() : null,
      } as PutBatch
    })
    await this._db.batch(opStack)
  }

  /**
   * Saves the nodes from a proof into the tree.
   * @param proof
   */
  async fromProof(_proof: Proof): Promise<void> {
    throw EthereumJSErrorWithoutCode('Not implemented')
  }

  /**
   * Creates a proof from a tree and key that can be verified using {@link VerkleTree.verifyVerkleProof}.
   * @param key
   */
  async createVerkleProof(_key: Uint8Array): Promise<Proof> {
    throw EthereumJSErrorWithoutCode('Not implemented')
  }

  /**
   * Verifies a proof.
   * @param rootHash
   * @param key
   * @param proof
   * @throws If proof is found to be invalid.
   * @returns The value from the key, or null if valid proof of non-existence.
   */
  async verifyVerkleProof(
    _rootHash: Uint8Array,
    _key: Uint8Array,
    _proof: Proof,
  ): Promise<Uint8Array | null> {
    throw EthereumJSErrorWithoutCode('Not implemented')
  }

  /**
   * The `data` event is given an `Object` that has two properties; the `key` and the `value`. Both should be Uint8Arrays.
   * @return Returns a [stream](https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_class_stream_readable) of the contents of the `tree`
   */
  createReadStream(): any {
    throw EthereumJSErrorWithoutCode('Not implemented')
  }

  /**
   * Returns a copy of the underlying tree.
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
  shallowCopy(includeCheckpoints = true): VerkleTree {
    const tree = new VerkleTree({
      ...this._opts,
      db: this._db.db.shallowCopy(),
      root: this.root(),
      cacheSize: 0,
      verkleCrypto: this.verkleCrypto,
    })
    if (includeCheckpoints && this.hasCheckpoints()) {
      tree._db.setCheckpoints(this._db.checkpoints)
    }
    return tree
  }

  /**
   * Persists the root hash in the underlying database
   */
  async persistRoot() {
    if (this._opts.useRootPersistence === true) {
      await this._db.put(ROOT_DB_KEY, this.root())
    }
  }

  /**
   * Is the tree during a checkpoint phase?
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
      throw EthereumJSErrorWithoutCode('trying to commit when not checkpointed')
    }

    await this._lock.acquire()
    await this._db.commit()
    await this.persistRoot()
    this._lock.release()
  }

  /**
   * Reverts the tree to the state it was at when `checkpoint` was first called.
   * If during a nested checkpoint, sets root to most recent checkpoint, and sets
   * parent checkpoint as current.
   */
  async revert(): Promise<void> {
    if (!this.hasCheckpoints()) {
      throw EthereumJSErrorWithoutCode('trying to revert when not checkpointed')
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
