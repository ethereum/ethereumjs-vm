import {
  Lock,
  bitsToBytes,
  bytesToBits,
  bytesToHex,
  concatBytes,
  equalsBits,
  equalsBytes,
  matchingBitsLength,
  setLengthRight,
} from '@ethereumjs/util'
import debug from 'debug'

import { CheckpointDB } from './db/index.js'
import { InternalBinaryNode } from './node/internalNode.js'
import { StemBinaryNode } from './node/stemNode.js'
import { decodeBinaryNode, isInternalBinaryNode, isStemBinaryNode } from './node/util.js'
import { binaryTreeFromProof, verifyBinaryProof } from './proof.js'
import { type BinaryTreeOpts, ROOT_DB_KEY } from './types.js'

import type { BinaryNode } from './node/types.js'
import type { PutBatch } from '@ethereumjs/util'
import type { Debugger } from 'debug'

interface Path {
  node: BinaryNode | null
  remaining: number[]
  stack: Array<[BinaryNode, number[]]>
}

/**
 * The basic binary tree interface, use with `import { BinaryTree } from '@ethereumjs/binarytree'`.
 */
export class BinaryTree {
  /** The options for instantiating the binary tree */
  protected _opts: BinaryTreeOpts

  /** The root for an empty tree */
  EMPTY_TREE_ROOT: Uint8Array

  protected _db!: CheckpointDB
  protected _hashLen: number
  protected _lock = new Lock()
  protected _root: Uint8Array

  protected DEBUG: boolean
  protected _debug: Debugger = debug('binarytree:#')
  protected debug: (...args: any) => void
  /**
   * Creates a new binary tree.
   * @param opts Options for instantiating the binary tree
   *
   * Note: in most cases, the static {@link createBinaryTree} constructor should be used. It uses the same API but provides sensible defaults
   */
  constructor(opts: BinaryTreeOpts) {
    this._opts = opts

    if (opts.db instanceof CheckpointDB) {
      throw new Error('Cannot pass in an instance of CheckpointDB')
    }
    this._db = new CheckpointDB({ db: opts.db, cacheSize: opts.cacheSize })

    this.EMPTY_TREE_ROOT = new Uint8Array(32)
    this._hashLen = 32
    this._root = this.EMPTY_TREE_ROOT

    if (opts?.root) {
      this.root(opts.root as any)
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
      const value = await this._db.get(root)
      return value !== undefined
    } catch (error: any) {
      if (error.message === 'Missing node in DB') {
        return equalsBytes(root, this.EMPTY_TREE_ROOT)
      } else {
        throw error
      }
    }
  }

  /**
   * Gets values at a given binary tree `stem` and set of suffixes
   * @param stem - the stem of the stem node where we're seeking values
   * @param suffixes - an array of suffixes corresponding to the values desired
   * @returns A Promise that resolves to an array of `Uint8Array`s or `null` depending on if values were found.
   * If the stem is not found, will return an empty array.
   */
  async get(stem: Uint8Array, suffixes: number[]): Promise<(Uint8Array | null)[]> {
    if (stem.length !== 31) throw new Error(`expected stem with length 31; got ${stem.length}`)
    this.DEBUG && this.debug(`Stem: ${bytesToHex(stem)}; Suffix: ${suffixes}`, ['get'])
    const stemPath = await this.findPath(stem)
    if (stemPath.node instanceof StemBinaryNode) {
      // The retrieved stem node contains an array of 256 possible values.
      // We read all the suffixes to get the desired values
      const values = []
      for (const suffix of suffixes) {
        const value = stemPath.node.getValue(suffix)
        this.DEBUG &&
          this.debug(`Suffix: ${suffix}; Value: ${value === null ? 'null' : bytesToHex(value)}`, [
            'get',
          ])
        values.push(value)
      }
      return values
    }

    return []
  }

  /**
   * Stores a given `value` at the given `key` or performs a deletion if `value` is null.
   * @param stem - the stem (must be 31 bytes) to store the value at.
   * @param suffixes - array of suffixes at which to store individual values.
   * @param values - the value(s) to store (or null for deletion).
   * @returns A Promise that resolves once the value is stored.
   */
  async put(stem: Uint8Array, suffixes: number[], values: (Uint8Array | null)[]): Promise<void> {
    if (stem.length !== 31) throw new Error(`expected stem with length 31, got ${stem.length}`)
    if (values.length > 0 && values.length !== suffixes.length)
      throw new Error(
        `expected number of values (${values.length}) to equal number of suffixes (${suffixes.length})`,
      )

    this.DEBUG && this.debug(`Stem: ${bytesToHex(stem)}`, ['put'])
    const putStack: [Uint8Array, BinaryNode | null][] = [] // A stack of updated nodes starting with the stem node being updated/created to be saved to the DB

    // If the tree is empty, initialize it.
    if (equalsBytes(this.root(), this.EMPTY_TREE_ROOT)) {
      await this._createInitialNode(stem, suffixes, values)
      return
    }

    // Find the path to the node (or the nearest node) for the given stem.
    const foundPath = await this.findPath(stem)

    // We should always at least get the root node back
    if (foundPath.stack.length === 0) throw new Error(`Root node not found in trie`)

    // Step 1) Create or update the stem node
    let stemNode: StemBinaryNode
    let newStem = false
    // If we found a stem node with the same stem, we'll update it.
    if (
      foundPath.node &&
      isStemBinaryNode(foundPath.node) &&
      equalsBytes(foundPath.node.stem, stem)
    ) {
      stemNode = foundPath.node
    } else {
      // Otherwise, we'll create a new stem node.
      newStem = true
      stemNode = StemBinaryNode.create(stem)
      this.DEBUG && this.debug(`Creating new stem node for stem: ${bytesToHex(stem)}`, ['put'])
    }

    // Update the values in the stem node.
    for (let i = 0; i < suffixes.length; i++) {
      const suffix = suffixes[i]
      const value = values[i]
      stemNode.setValue(suffix, value)
      this.DEBUG &&
        this.debug(
          `Setting value for suffix: ${suffix} to value: ${value instanceof Uint8Array ? bytesToHex(value) : value} at stem node with stem: ${bytesToHex(stem)}`,
          ['put'],
        )
    }

    // If all values are null then we treat this as a deletion.
    if (stemNode.values.every((val) => val === null)) {
      if (foundPath.node !== null) {
        this.DEBUG && this.debug(`Deleting stem node for stem: ${bytesToHex(stem)}`, ['put'])
        putStack.push([this.merkelize(stemNode), null])
      } else {
        return // nothing to delete
      }
    } else {
      // Otherwise, we add the new or updated stemNode to the putStack
      putStack.push([this.merkelize(stemNode), stemNode])
    }

    // Get the bit representation of the stem.
    const stemBits = bytesToBits(stemNode.stem)
    // We keep a reference to the current "parent" node path as we update up the tree.
    let lastUpdatedParentPath: number[] = []

    // Step 2: Add any needed new internal nodes if inserting a new stem.
    if (foundPath.stack.length > 1 && newStem) {
      // Pop the nearest node on the path.
      const [nearestNode, nearestNodePath] = foundPath.stack.pop()!
      const parentPath = foundPath.stack[foundPath.stack.length - 1]?.[1] ?? []
      this.DEBUG && this.debug(`Adding necessary internal nodes.`, ['put'])
      // Update the parent branch if necessary.
      // If an update was necessary, updateBranch returns a stack of internal nodes
      // that connect the new stem node to the previous parent inner node
      const updated = this.updateBranch(stemNode, nearestNode, nearestNodePath, parentPath)
      if (updated !== undefined) {
        for (const update of updated) {
          putStack.push([this.merkelize(update.node), update.node])
          lastUpdatedParentPath = update.parentPath
        }
      }
    }

    // Step 3: Update remaining parent node hashes
    while (foundPath.stack.length > 1) {
      const [node, path] = foundPath.stack.pop()!
      if (isInternalBinaryNode(node)) {
        // Set child pointer to the last internal node  in the putStack (last updated internal node)
        node.setChild(lastUpdatedParentPath[lastUpdatedParentPath.length - 1], {
          hash: putStack[putStack.length - 1][0], // Reuse hash already computed above
          path: lastUpdatedParentPath,
        })
        putStack.push([this.merkelize(node), node]) // Update node hash and add to putStack
        lastUpdatedParentPath = path
        this.DEBUG &&
          this.debug(`Updated parent internal node hash for path ${path.join(',')}`, ['put'])
      } else {
        throw new Error(`Expected internal node at path ${path.join(',')}, got ${node}`)
      }
    }

    // Step 4: Update the root node.
    let rootNode = foundPath.stack.pop()![0] // The root node.
    const childReference = putStack[putStack.length - 1][1]

    if (isStemBinaryNode(rootNode)) {
      // If the root is a stem node but its stem differs from the one we're updating,
      // then we need to split the root. Per the spec, when two stems share a common prefix,
      // we create one internal node per bit in that common prefix, and then at the first
      // divergence, an internal node that points to both stem nodes.
      if (!equalsBytes(rootNode.stem, stem)) {
        this.DEBUG && this.debug(`Root stem differs from new stem. Splitting root.`, ['put'])
        const rootBits = bytesToBits(rootNode.stem)
        const commonPrefixLength = matchingBitsLength(rootBits, stemBits)
        // Create the split node at the divergence bit.
        const splitNode = InternalBinaryNode.create()
        const branchForNew = stemBits[commonPrefixLength]
        const branchForExisting = rootBits[commonPrefixLength]
        splitNode.setChild(branchForNew, {
          hash: this.merkelize(stemNode),
          path: stemBits,
        })
        splitNode.setChild(branchForExisting, {
          hash: this.merkelize(rootNode),
          path: rootBits,
        })

        let newRoot = splitNode

        // If there is a common prefix (i.e. commonPrefixLength > 0), we build a chain
        // of internal nodes representing that prefix.
        for (let depth = commonPrefixLength - 1; depth >= 0; depth--) {
          this.DEBUG && this.debug(`Creating internal node at depth ${depth}`, ['put'])
          putStack.push([this.merkelize(newRoot), newRoot])
          const parent = InternalBinaryNode.create()
          // At each level, the branch is determined by the bit of the new stem at position i.
          parent.setChild(stemBits[depth], {
            hash: this.merkelize(newRoot),
            path: stemBits.slice(0, depth + 1),
          })
          newRoot = parent
        }
        // Now newRoot is an internal node chain that represents the entire common prefix,
        // ending in a split node that distinguishes the two different stems.
        rootNode = newRoot
      }
    } else {
      // For an internal root node, we assign the last update child reference to the root.
      if (childReference !== null) {
        rootNode.setChild(
          stemBits[0],
          childReference !== null
            ? {
                hash: this.merkelize(childReference),
                path: isStemBinaryNode(childReference) ? stemBits : lastUpdatedParentPath,
              }
            : null,
        )
      }
    }

    this.root(this.merkelize(rootNode))
    putStack.push([this._root, rootNode])
    this.DEBUG && this.debug(`Updated root hash to ${bytesToHex(this._root)}`, ['put'])
    await this.saveStack(putStack)
  }

  /**
   * Helper method for updating or creating the parent internal node for a given stem node.
   * If the nearest node is a stem node with a different stem, a new internal node is created
   * to branch at the first differing bit.
   * If the nearest node is an internal node, its child reference is updated.
   *
   * @param stemNode - The child stem node that will be referenced by the new/updated internal node.
   * @param nearestNode - The nearest node to the new stem node.
   * @param pathToNode - The path (in bits) to `nearestNode` as known from the trie.
   * @returns An array of nodes and their partial paths from the new stem node to the branch parent node
   *          or `undefined` if no changes were made.
   */
  updateBranch(
    stemNode: StemBinaryNode,
    nearestNode: BinaryNode,
    pathToNode: number[],
    pathToParent: number[],
  ): { node: BinaryNode; parentPath: number[] }[] | undefined {
    const stemBits = bytesToBits(stemNode.stem)
    if (isStemBinaryNode(nearestNode)) {
      // For two different stems, find the first differing bit.
      const nearestNodeStemBits = bytesToBits(nearestNode.stem)
      const diffIndex = matchingBitsLength(stemBits, nearestNodeStemBits)
      const parentDiffIndex = matchingBitsLength(pathToNode, pathToParent)

      const newInternal = InternalBinaryNode.create()
      // Set the child pointer for the new stem node using the bit at diffIndex.
      newInternal.setChild(stemBits[diffIndex], {
        hash: this.merkelize(stemNode),
        path: stemBits,
      })

      // Set the child pointer for the existing stem node.
      newInternal.setChild(nearestNodeStemBits[diffIndex], {
        hash: this.merkelize(nearestNode),
        path: nearestNodeStemBits,
      })
      const putStack = [{ node: newInternal, parentPath: stemBits.slice(0, diffIndex) }]

      let parent = newInternal
      for (let depth = diffIndex - 1; depth > parentDiffIndex; depth--) {
        this.DEBUG && this.debug(`Creating internal node at depth ${depth}`, ['put'])
        const newParent = InternalBinaryNode.create()
        // At each level, the branch is determined by the bit of the new stem at position i.
        newParent.setChild(stemBits[depth], {
          hash: this.merkelize(parent),
          path: stemBits.slice(0, depth + 1),
        })
        putStack.push({ node: newParent, parentPath: stemBits.slice(0, depth) })
        parent = newParent
      }

      // Return the stack of new internal nodes that connect the new stem node to the previous parent inner node
      return putStack
    } else if (isInternalBinaryNode(nearestNode)) {
      // For an internal node, determine the branch index using the parent's known path length.
      const branchIndex = stemBits[pathToNode.length]
      nearestNode.setChild(branchIndex, {
        hash: this.merkelize(stemNode),
        path: stemBits,
      })
      return [{ node: nearestNode, parentPath: pathToNode }]
    }
    return undefined
  }

  /**
   * Tries to find a path to the node for the given key.
   * It returns a `Path` object containing:
   *   - `node`: the found node (if any),
   *   - `stack`: an array of tuples [node, path] representing the nodes encountered,
   *   - `remaining`: the bits of the key that were not matched.
   *
   * @param keyInBytes - the search key as a byte array.
   * @returns A Promise that resolves to a Path object.
   */
  async findPath(keyInBytes: Uint8Array): Promise<Path> {
    const keyInBits = bytesToBits(keyInBytes)
    this.DEBUG && this.debug(`Searching for key: ${bytesToHex(keyInBytes)}`, ['find_path'])
    const result: Path = {
      node: null,
      stack: [],
      remaining: keyInBits,
    }

    // If tree is empty, return empty path.
    if (equalsBytes(this.root(), this.EMPTY_TREE_ROOT)) return result

    // Get the root node.
    let rawNode = await this._db.get(this.root())
    if (rawNode === undefined) throw new Error('root node should exist')
    const rootNode = decodeBinaryNode(rawNode)

    this.DEBUG && this.debug(`Starting with Root Node: [${bytesToHex(this.root())}]`, ['find_path'])
    // Treat the root as being at an empty path.
    result.stack.push([rootNode, []])

    // If the root node is a stem node, we're done.
    if (isStemBinaryNode(rootNode)) {
      this.DEBUG && this.debug(`Found stem node at root.`, ['find_path'])
      if (equalsBytes(keyInBytes, rootNode.stem)) {
        result.node = rootNode
        result.remaining = []
      }
      return result
    }

    // The root is an internal node. Determine the branch to follow using the first bit of the key
    let childNode = rootNode.getChild(keyInBits[0])

    // If no child exists on that branch, return what we have.
    if (childNode === null) {
      this.DEBUG && this.debug(`Partial Path ${keyInBits[0]} - found no child.`, ['find_path'])
      return result
    }
    let finished = false
    while (!finished) {
      if (childNode === null) break

      // Look up child node by its node hash.
      rawNode = await this._db.get(childNode.hash)
      if (rawNode === undefined) throw new Error(`missing node at ${childNode.path}`)
      const decodedNode = decodeBinaryNode(rawNode)

      // Determine how many bits match between keyInBits and the stored path in childNode.
      const matchingKeyLength = matchingBitsLength(keyInBits, childNode.path)

      // If we have an exact match (i.e. the stored path equals a prefix of the key)
      // and either the key is fully consumed or we have reached a stem node, we stop.
      if (
        matchingKeyLength === childNode.path.length &&
        (matchingKeyLength === keyInBits.length || isStemBinaryNode(decodedNode))
      ) {
        finished = true
        if (
          matchingKeyLength === keyInBits.length &&
          equalsBits(keyInBits, childNode.path) === true
        ) {
          this.DEBUG &&
            this.debug(
              `Path ${bytesToHex(keyInBytes)} - found full path to node ${bytesToHex(
                this.merkelize(decodedNode),
              )}.`,
              ['find_path'],
            )
          result.node = decodedNode
          result.remaining = []
          return result
        }
        // Otherwise, record the unmatched tail of the key.
        result.remaining = keyInBits.slice(matchingKeyLength)
        result.stack.push([decodedNode, childNode.path])
        return result
      }
      // Otherwise, push this internal node and continue.
      result.stack.push([decodedNode, keyInBits.slice(0, matchingKeyLength)])
      this.DEBUG &&
        this.debug(
          `Partial Path ${keyInBits.slice(0, matchingKeyLength)} - found next node in path ${bytesToHex(
            this.merkelize(decodedNode),
          )}.`,
          ['find_path'],
        )

      // If the decoded node is not internal, then we cannot traverse further.
      if (!isInternalBinaryNode(decodedNode)) {
        result.remaining = keyInBits.slice(matchingKeyLength)
        finished = true
        break
      }
      // The next branch is determined by the next bit after the matched prefix.
      const childIndex = keyInBits[matchingKeyLength]
      childNode = decodedNode.getChild(childIndex)
      if (childNode === null) {
        result.remaining = keyInBits.slice(matchingKeyLength)
        finished = true
      }
    }
    this.DEBUG &&
      this.debug(
        `Found partial path ${bytesToHex(bitsToBytes(keyInBits.slice(256 - result.remaining.length)))} but sought node is not present in trie.`,
        ['find_path'],
      )
    return result
  }

  /**
   * Deletes a given `key` from the tree.
   * @param stem - the stem of the stem node to delete from
   * @param suffixes - the suffixes to delete
   * @returns A Promise that resolves once the key is deleted.
   */
  async del(stem: Uint8Array, suffixes: number[]): Promise<void> {
    this.DEBUG && this.debug(`Stem: ${bytesToHex(stem)}; Suffix(es): ${suffixes}`, ['del'])
    await this.put(stem, suffixes, new Array(suffixes.length).fill(null))
  }

  /**
   * Create empty root node for initializing an empty tree.
   */
  async createRootNode(): Promise<void> {
    const rootNode = null
    this.DEBUG && this.debug(`No root node. Creating new root node`, ['initialize'])
    this.root(this.merkelize(rootNode))
    await this.saveStack([[this.root(), rootNode]])
    return
  }

  /**
   * Creates the initial node from an empty tree.
   * @private
   */
  protected async _createInitialNode(
    stem: Uint8Array,
    indexes: number[],
    values: (Uint8Array | null)[],
  ): Promise<void> {
    const initialNode = StemBinaryNode.create(stem)
    for (let i = 0; i < indexes.length; i++) {
      initialNode.setValue(indexes[i], values[i])
    }
    this.root(this.merkelize(initialNode))
    await this._db.put(this.root(), initialNode.serialize())
    await this.persistRoot()
  }

  /**
   * Saves a stack of nodes to the database.
   *
   * @param putStack - an array of tuples of keys (the partial path of the node in the trie) and nodes (BinaryNodes)
   */

  async saveStack(putStack: [Uint8Array, BinaryNode | null][]): Promise<void> {
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
  async fromProof(_proof: Uint8Array[]): Promise<BinaryTree> {
    return binaryTreeFromProof(_proof)
  }

  /**
   * Creates a proof from a tree and key that can be verified using {@link BinaryTree.verifyBinaryProof}.
   * @param key
   */
  async createBinaryProof(_key: Uint8Array): Promise<Uint8Array[]> {
    const { stack } = await this.findPath(_key)
    return stack.map(([node, _]) => node.serialize())
  }

  /**
   * Verifies a proof.
   * @param rootHash
   * @param key
   * @param proof
   * @throws If proof is found to be invalid.
   * @returns The value from the key, or null if valid proof of non-existence.
   */
  async verifyBinaryProof(
    _rootHash: Uint8Array,
    _key: Uint8Array,
    _proof: Uint8Array[],
  ): Promise<Uint8Array | null> {
    return verifyBinaryProof(_rootHash, _key, _proof)
  }

  /**
   * The `data` event is given an `Object` that has two properties; the `key` and the `value`. Both should be Uint8Arrays.
   * @return Returns a [stream](https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_class_stream_readable) of the contents of the `tree`
   */
  createReadStream(): any {
    throw new Error('Not implemented')
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
  shallowCopy(includeCheckpoints = true): BinaryTree {
    const tree = new BinaryTree({
      ...this._opts,
      db: this._db.db.shallowCopy(),
      root: this.root(),
      cacheSize: 0,
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
      throw new Error('trying to commit when not checkpointed')
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

  protected hash(msg: Uint8Array | null): Uint8Array {
    // As per spec, if value is null or a 64-byte array of 0s, hash(msg) is a 32-byte array of 0s
    if (msg === null || (msg.length === 64 && msg.every((byte) => byte === 0))) {
      return new Uint8Array(32)
    }

    if (msg.length !== 32 && msg.length !== 64) {
      throw new Error('Data must be 32 or 64 bytes')
    }

    return Uint8Array.from(this._opts.hashFunction.call(undefined, msg))
  }

  protected merkelize(node: BinaryNode | null): Uint8Array {
    if (node === null) {
      return new Uint8Array(32)
    }

    if (isInternalBinaryNode(node)) {
      const [leftChild, rightChild] = node.children

      return this.hash(
        concatBytes(
          leftChild === null ? this.hash(null) : leftChild.hash,
          rightChild === null ? this.hash(null) : rightChild.hash,
        ),
      )
    }

    // Otherwise, it's a stem node.
    // Map each value in node.values through the hash function.
    let currentLayerHashes = node.values.map((value) => this.hash(value))

    // While there is more than one hash at the current layer, combine them pairwise.
    while (currentLayerHashes.length > 1) {
      const newLayerHashes = []
      for (let i = 0; i < currentLayerHashes.length; i += 2) {
        newLayerHashes.push(
          this.hash(concatBytes(currentLayerHashes[i], currentLayerHashes[i + 1])),
        )
      }
      currentLayerHashes = newLayerHashes
    }

    // Return the hash of the concatenation of node.stem appended with 00 and the final level hash.
    return this.hash(concatBytes(setLengthRight(node.stem, 32), currentLayerHashes[0]))
  }
}
