import type { TrieDatabase } from '../db'
import type { FoundNodeFunction, WalkFilterFunction } from '../types'
import type { TNode } from './node/types'
import type { Mutex } from 'async-mutex'
import type { Debugger } from 'debug'
import type { LRUCache } from 'lru-cache'

export interface TrieInterface {
  /** The root node of the trie */
  rootNode: TNode

  /** The database used to store trie nodes */
  db: TrieDatabase

  /** An array of all checkpoint hashes in the trie */
  checkpoints: Uint8Array[]

  /** A debugger for logging debug messages */
  debug: Debugger

  /** A mutex for locking operations on the trie */
  _operationMutex: Mutex

  /** A cache for storing recently accessed nodes */
  cache: LRUCache<Uint8Array, TNode>

  /**
   * Retrieves the value associated with the given key in the trie
   * @param key - the key to retrieve
   * @returns the value associated with the key, or `null` if not found
   */
  get(key: Uint8Array): Promise<Uint8Array | null>

  /**
   * Inserts the given key-value pair into the trie
   * @param key - the key to insert
   * @param value - the value to insert
   */
  put(key: Uint8Array, value: Uint8Array): Promise<void>

  /**
   * Deletes the value associated with the given key from the trie
   * @param key - the key to delete
   */
  del(key: Uint8Array): Promise<void>

  /**
   * Walks the trie, starting from the given node (or the root node if no node is given),
   * and calling the `onFound` function on each node encountered that passes the `filter` function.
   * The function is asynchronous and returns an iterable of all nodes encountered.
   * @param startNode - the node to start the walk from (default: root node)
   * @param currentKey - the current key being walked (internal use only)
   * @param onFound - a function to call when a node is found
   * @param filter - a function to filter nodes during the walk
   * @returns an iterable of all nodes encountered during the walk
   */
  walkTrie: (
    startNode: TNode | null,
    currentKey?: Uint8Array,
    onFound?: FoundNodeFunction,
    filter?: WalkFilterFunction
  ) => AsyncIterable<TNode>

  /**
   * Finds the path in the trie to the node associated with the given key
   * @param keyNibbles - the nibble representation of the key
   * @returns an object containing the stack of nodes from the root to the node, and the remaining nibbles in the key
   */
  getPath(keyNibbles: number[]): Promise<{ stack: TNode[]; remainingNibbles: number[] }>

  /**
   * Creates a checkpoint of the current state of the trie
   *
   * @returns A Promise that resolves once the checkpoint has been successfully created
   */
  checkpoint(): Promise<void>

  /**
   * Commits any changes made since the last checkpoint to the trie
   *
   * @returns A Promise that resolves once the changes have been successfully committed
   */
  commit(): Promise<void>

  /**
   * Reverts the trie to the last checkpointed state
   * @returns A promise that resolves when the trie has been reverted to the last checkpoint
   */
  revert(): Promise<void>

  /**
   * Reverts the trie to a specific checkpoint
   * @param checkpoint The hash of the checkpoint to which to revert the trie
   * @returns A promise that resolves when the trie has been reverted to the specified checkpoint
   */
  revertTo(checkpoint: Uint8Array): Promise<void>

  /**
   * Creates a Merkle proof for a given key
   * @param key The key for which to create the proof
   * @returns A promise that resolves to an array of hashes that constitute the proof
   */
  createProof(key: Uint8Array): Promise<Uint8Array[]>

  /**
   * Creates a multiproof for a set of keys
   * @param keys An array of keys for which to create a multiproof
   * @returns A promise that resolves to an array of hashes that constitute the multiproof
   */
  createMultiProof(keys: Uint8Array[]): Promise<Uint8Array[]>

  /**
   * Updates the trie state by applying a proof to the trie
   * @param proof The proof to apply to the trie
   * @param node The node to which the proof applies
   * @returns A promise that resolves when the proof has been applied to the trie
   */
  updateFromProof(proof: Uint8Array[], node: Uint8Array): Promise<void>

  /**
   * Updates the trie state by applying a multiproof to the trie
   * @param proof The multiproof to apply to the trie
   * @returns A promise that resolves when the multiproof has been applied to the trie
   */
  updateFromMultiProof(proof: Uint8Array[]): Promise<void>

  /**
   * Updates the trie with a key-value pair
   * @param key The key for the new or updated value
   * @param value The new or updated value
   * @returns A promise that resolves when the key-value pair has been added or updated in the trie
   */
  update(key: Uint8Array, value: Uint8Array | null): Promise<void>

  /**
   * Locks the trie to ensure mutual exclusion for a given operation
   * @param operation The operation to perform while the trie is locked
   * @returns A promise that resolves with the result of the operation
   */
  _withLock<T>(operation: () => Promise<T>): Promise<T>
  /**
   * Recursively marks all reachable nodes in the trie
   * @param node The node to start marking reachable nodes from
   * @param reachableHashes A set of all reachable hashes in the trie
   * @returns A promise that resolves when all reachable
   */
  _markReachableNodes(node: TNode | null, reachableHashes: Set<Uint8Array>): Promise<void>

  /**
   * Recursively collects all reachable nodes from a given node and stores them in the visitedNodes set.
   * @param node The node to start collecting reachable nodes from
   * @param visitedNodes A set of all nodes that have been visited
   */
  _collectReachableNodes(node: TNode, visitedNodes: Set<TNode>): Promise<void>

  /**
   * Removes all unreachable nodes from the trie
   */
  garbageCollect(): Promise<void>

  /**
   * Stores a node in the node cache and in the database.
   *
   * @param node - The node to be stored.
   */
  storeNode(node: TNode): Promise<void>

  /**
   * Deletes a node from the node cache and from the database.
   *
   * @param node - The node to be deleted.
   */
  _deleteNode(node: TNode): Promise<void>

  /**
   * Inserts a node into the node cache and database.
   *
   * @param node - The node to be inserted.
   * @returns The new RootNode.
   */
  _insertNode(node: TNode): Promise<TNode>

  /**
   * Retrieves a node from a given node, using the provided key.
   *
   * @param node - The node to start the search from.
   * @param key - The key to search for.
   */
  getNode(node: TNode, key: Uint8Array): Promise<TNode | null>

  /**
   * Looks up a node in the node cache and database using the provided key.
   *
   * @param key - The key to search for.
   */
  _lookupNode(key: Uint8Array): Promise<TNode | null>

  /**
   * Converts a hash to a key.
   *
   * @param hash - The hash to convert.
   */
  _hashToKey(hash: Uint8Array): Uint8Array

  /**
   * Updates a key-value pair in the trie.
   *
   * @param keyNibbles - The nibbles of the key.
   * @param value - The value to set at the key.
   */
  _update(keyNibbles: number[], value: Uint8Array | null): Promise<Uint8Array>
}
