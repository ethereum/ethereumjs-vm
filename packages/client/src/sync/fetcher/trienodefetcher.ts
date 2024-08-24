import { DefaultStateManager } from '@ethereumjs/statemanager'
import {
  BranchNode,
  ExtensionNode,
  LeafNode,
  Trie,
  decodeNode,
  mergeAndFormatKeyPaths,
  pathToHexKey,
} from '@ethereumjs/trie'
import {
  BIGINT_0,
  KECCAK256_NULL,
  KECCAK256_RLP,
  createAccountFromRLP,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import { OrderedMap } from '@js-sdsl/ordered-map'
import debug from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { bytesToHex, equalsBytes, hexToBytes } from 'ethereum-cryptography/utils'

import { Fetcher } from './fetcher.js'
import { getInitFetcherDoneFlags } from './types.js'

import type { Peer } from '../../net/peer/index.js'
import type { FetcherOptions } from './fetcher.js'
import type { Job, SnapFetcherDoneFlags } from './types.js'
import type { BatchDBOp, DB } from '@ethereumjs/util'
import type { Debugger } from 'debug'

type TrieNodesResponse = Uint8Array[] & { completed?: boolean }

/**
 * Implements an snap1 based trie node fetcher
 * @memberof module:sync/fetcher
 */
export interface TrieNodeFetcherOptions extends FetcherOptions {
  root: Uint8Array
  accountToStorageTrie?: Map<String, Trie>
  stateManager?: DefaultStateManager

  /** Destroy fetcher once all tasks are done */
  destroyWhenDone?: boolean

  fetcherDoneFlags?: SnapFetcherDoneFlags
}

export type JobTask = {
  pathStrings: string[]
  paths: Uint8Array[][] // paths to nodes for requesting from SNAP API kept in compact encoding
}

type FetchedNodeData = {
  parentHash: string
  deps: number
  nodeData: Uint8Array
  path: string
  pathToStorageNode?: Map<string, Uint8Array>
}

type NodeRequestData = {
  nodeHash: string
  nodeParentHash: string
  parentAccountHash?: string // for leaf account nodes that contain a storage component
}

export class TrieNodeFetcher extends Fetcher<JobTask, Uint8Array[], Uint8Array> {
  protected debug: Debugger
  root: Uint8Array

  stateManager: DefaultStateManager
  fetcherDoneFlags: SnapFetcherDoneFlags
  accountTrie: Trie
  codeDB: DB

  /**
   * Holds all paths and nodes that need to be requested
   *
   * A path is represented as a string of variable length between 0 to 129 characters.
   * The first 64 are used to represent the hex-encoded path in the account trie. The
   * final 64 are used to represent the hex-encoded path in the storage trie. A forward
   * slash ('/') is used as a separator. This format is referred to as a "sync" or
   * "stacked" path, representing the full path to a node in an account or storage trie.
   * All keys in pathToNodeRequestData are sync paths.
   */
  pathToNodeRequestData: OrderedMap<string, NodeRequestData>

  // Holds active requests to remove after storing
  requestedNodeToPath: Map<string, string>
  fetchedAccountNodes: Map<string, FetchedNodeData> // key is node hash

  nodeCount: number

  keccakFunction: Function

  /**
   * Create new trie node fetcher
   */
  constructor(options: TrieNodeFetcherOptions) {
    super(options)
    this.root = options.root
    this.fetcherDoneFlags = options.fetcherDoneFlags ?? getInitFetcherDoneFlags()
    this.pathToNodeRequestData = new OrderedMap<string, NodeRequestData>()
    this.requestedNodeToPath = new Map<string, string>()
    this.fetchedAccountNodes = new Map<string, FetchedNodeData>()

    this.stateManager = options.stateManager ?? new DefaultStateManager()
    this.accountTrie = this.stateManager['_getAccountTrie']()
    this.codeDB = this.stateManager['_getCodeDB']()

    this.nodeCount = 0
    this.debug = debug('client:TrieNodeFetcher')

    this.keccakFunction = this.config.chainCommon.customCrypto.keccak256 ?? keccak256

    // will always start with root node as first set of node requests
    this.pathToNodeRequestData.setElement('', {
      nodeHash: bytesToHex(this.root),
      nodeParentHash: '', // root node does not have a parent
    } as NodeRequestData)

    this.debug(
      `Trie node fetcher instantiated with ${this.pathToNodeRequestData.size()} node requests destroyWhenDone=${
        this.destroyWhenDone
      }`,
    )
  }

  setDestroyWhenDone() {
    this.destroyWhenDone = true
  }

  /**
   * Request results from peer for the given job.
   * Resolves with the raw result
   * If `undefined` is returned, re-queue the job.
   * @param job
   * @param peer
   */
  async request(
    job: Job<JobTask, Uint8Array[], Uint8Array>,
  ): Promise<TrieNodesResponse | undefined> {
    const { task, peer } = job
    // Currently this is the only safe place to call peer.latest() without interfering with the fetcher
    // TODOs:
    // 1. Properly rewrite Fetcher with async/await -> allow to at least place in Fetcher.next()
    // 2. Properly implement ETH request IDs -> allow to call on non-idle in Peer Pool
    await peer?.latest()

    const { paths, pathStrings } = task

    const rangeResult = await peer!.snap!.getTrieNodes({
      root: this.root,
      paths,
      bytes: BigInt(this.config.maxRangeBytes),
    })

    // Response is valid, but check if peer is signalling that it does not have
    // the requested data. For trie node range queries that means the peer is not
    // yet synced.
    const requestedNodeCount = pathStrings.length
    if (rangeResult === undefined || requestedNodeCount < rangeResult.nodes.length) {
      this.debug(`Peer rejected trienode request`)

      return undefined
    }

    try {
      // While results are in the same order as requested hashes but there could be gaps/misses in the results
      // if the node doesn't has all of the requested trie nodes. We need an index to move forward through the hashes which are
      // absent in the received responses
      const receivedNodes: Uint8Array[] = []
      for (let i = 0; i < rangeResult.nodes.length; i++) {
        const receivedNode = rangeResult.nodes[i]
        const receivedHash = bytesToHex(this.keccakFunction(receivedNode) as Uint8Array)
        if (this.requestedNodeToPath.has(receivedHash)) {
          receivedNodes.push(rangeResult.nodes[i])
        }
      }
      return Object.assign([], [receivedNodes], { completed: true })
    } catch (e) {
      this.debug(e)
    }
  }

  /**
   * Process the reply for the given job.
   * If the reply contains unexpected data, return `undefined`,
   * this re-queues the job.
   * @param job fetch job
   * @param result result data
   */
  process(
    job: Job<JobTask, Uint8Array[], Uint8Array>,
    result: TrieNodesResponse,
  ): Uint8Array[] | undefined {
    const fullResult = (job.partialResult ?? []).concat(result)
    job.partialResult = undefined
    if (result.completed === true) {
      return fullResult
    } else {
      // Save partial result to re-request missing items.
      job.partialResult = fullResult
    }
  }

  /**
   * Store fetch result. Resolves once store operation is complete.
   * @param result fetch result
   */
  async store(result: Uint8Array[]): Promise<void> {
    this.debug('At start of store phase')

    try {
      // process received node data and request unknown child nodes
      for (const nodeData of result[0]) {
        const node = decodeNode(nodeData as unknown as Uint8Array)
        const nodeHash = bytesToHex(this.keccakFunction(nodeData as unknown as Uint8Array))
        const pathString = this.requestedNodeToPath.get(nodeHash) ?? ''
        const [accountPath, storagePath] = pathString.split('/')
        const nodePath = storagePath ?? accountPath
        const childNodes = []
        let unknownChildNodeCount = 0
        let hasStorageComponent = false

        // get all children of received node
        if (node instanceof BranchNode) {
          const children = (node as BranchNode).getChildren()
          for (const [i, embeddedNode] of children) {
            if (embeddedNode !== null) {
              const newStoragePath = nodePath.concat(bytesToHex(Uint8Array.from([i])))
              const syncPath =
                storagePath === undefined ? newStoragePath : [accountPath, newStoragePath].join('/')
              this.debug('branch node found')
              childNodes.push({
                nodeHash: embeddedNode,
                path: syncPath,
              })
            }
          }
        } else if (node instanceof ExtensionNode) {
          this.debug('extension node found')
          const stringPath = bytesToHex(pathToHexKey(nodePath, node.key(), 'hex'))
          const syncPath =
            storagePath === undefined ? stringPath : [accountPath, stringPath].join('/')
          const val = {
            nodeHash: node.value(),
            path: syncPath,
          }
          childNodes.push(val)
        } else {
          this.debug('leaf node found')
          if (storagePath === undefined) {
            this.debug('account leaf node found')
            const account = createAccountFromRLP(node.value())
            const storageRoot: Uint8Array = account.storageRoot
            if (equalsBytes(storageRoot, KECCAK256_RLP) === false) {
              this.debug('storage component found')
              const syncPath = [
                bytesToHex(pathToHexKey(accountPath, node.key(), 'hex')),
                storagePath,
              ].join('/')
              this.pathToNodeRequestData.setElement(syncPath, {
                nodeHash: bytesToHex(storageRoot),
                nodeParentHash: nodeHash,
                parentAccountHash: nodeHash,
              })
              hasStorageComponent = true
            }
            const codeHash: Uint8Array = account.codeHash
            if (!(equalsBytes(codeHash, KECCAK256_NULL) === true)) {
              // TODO
            }
          } else {
            this.debug('Storage leaf node found')
          }
        }

        // TODO this for loop and contained logic is not verified - have to set up a sync where we pivot to a new state to see if unknown nodes are correctly identified
        // request unknown child nodes that have been freshly discovered
        for (const childNode of childNodes) {
          try {
            if (storagePath !== undefined) {
              // look up node in storage trie, accountPath is hashed key/applied key
              // TODO PR: optimized out the conversion from string to bytes?
              const accountHash = unprefixedHexToBytes(accountPath)
              const storageTrie = this.stateManager['_getStorageTrie'](accountHash)
              await storageTrie!.lookupNode(childNode.nodeHash as Uint8Array)
            } else {
              // look up node in account trie
              await this.accountTrie.lookupNode(childNode.nodeHash as Uint8Array)
            }
          } catch {
            // if error is thrown, than the node is unknown and should be queued for fetching
            unknownChildNodeCount++
            const { parentAccountHash } = this.pathToNodeRequestData.getElementByKey(
              pathString,
            ) as NodeRequestData
            this.pathToNodeRequestData.setElement(childNode.path, {
              nodeHash: bytesToHex(childNode.nodeHash as Uint8Array),
              nodeParentHash: nodeHash, // TODO root node does not have a parent, so handle that in the leaf callback when checking if dependencies are met recursively
              parentAccountHash,
            } as NodeRequestData)
          }
        }

        // record new node for batched storing after all subtrie nodes have been received
        const { nodeParentHash, parentAccountHash } = this.pathToNodeRequestData.getElementByKey(
          pathString,
        ) as NodeRequestData
        if (storagePath !== undefined) {
          // if fetched node has a storagePath, it's storage node data and should be stored with
          // account leaf node data from where it originates
          const { pathToStorageNode } = this.fetchedAccountNodes.get(
            parentAccountHash as string,
          ) as unknown as FetchedNodeData
          pathToStorageNode!.set(storagePath, nodeData as unknown as Uint8Array)
        } else {
          this.fetchedAccountNodes.set(nodeHash, {
            parentHash: nodeParentHash,
            deps: unknownChildNodeCount,
            nodeData,
            path: pathString,
            pathToStorageNode: hasStorageComponent ? new Map<string, Uint8Array>() : undefined,
          } as unknown as FetchedNodeData)
        }

        // remove filled requests
        this.requestedNodeToPath.delete(nodeHash)
        this.pathToNodeRequestData.eraseElementByKey(pathString)
      }

      // for an initial implementation, just put nodes into trie and see if root matches stateRoot
      if (this.pathToNodeRequestData.length === 0) {
        this.debug('All requests for current heal phase have been filled')
        const ops: BatchDBOp[] = []
        for (const [_, data] of this.fetchedAccountNodes) {
          const { nodeData, path, pathToStorageNode } = data

          // add account node data to account trie
          const node = decodeNode(nodeData)
          if (node instanceof LeafNode) {
            const key = bytesToHex(pathToHexKey(path, node.key(), 'keybyte'))
            ops.push({
              type: 'put',
              key: hexToBytes(key),
              value: node.value(),
            })

            // add storage data for account if it has fetched nodes
            // TODO figure out what the key should be for mapping accounts to storage tries
            const storageTrie = new Trie({ useKeyHashing: true, common: this.config.chainCommon })
            const storageTrieOps: BatchDBOp[] = []
            if (pathToStorageNode !== undefined && pathToStorageNode.size > 0) {
              for (const [path, data] of pathToStorageNode) {
                const storageNode = decodeNode(data)
                if (storageNode instanceof LeafNode) {
                  const storageKey = bytesToHex(pathToHexKey(path, storageNode.key(), 'keybyte'))
                  storageTrieOps.push({
                    type: 'put',
                    key: hexToBytes(storageKey),
                    value: storageNode.value(),
                  })
                }
              }
              await storageTrie.batch(storageTrieOps, true)
              await storageTrie.persistRoot()
              const a = createAccountFromRLP(node.value())
              this.debug(
                `Stored storageTrie with root actual=${bytesToHex(
                  storageTrie.root(),
                )} expected=${bytesToHex(a.storageRoot)}`,
              )
            }
          }
        }
        await this.accountTrie.batch(ops, true)
        await this.accountTrie.persistRoot()
        this.debug(
          `Stored accountTrie with root actual=${bytesToHex(
            this.accountTrie.root(),
          )} expected=${bytesToHex(this.root)}`,
        )
      }
    } catch (e) {
      this.debug(e)
    }
  }

  // TODO take a parameter to indicate how many paths to return and refactor tasks function to use it
  getSortedPathStrings() {
    const pathStrings = []
    // TODO have to keep track of which requests are in progress, efficiently, or remove them from pathToNodeRequestData
    // so that getSortedPathStrings doesn't return duplicates
    for (const [pathString, _] of this.pathToNodeRequestData) {
      pathStrings.push(pathString)
    }
    return { pathStrings }
  }

  /**
   * Generate list of tasks to fetch. Modifies `first` and `count` to indicate
   * remaining items apart from the tasks it pushes in the queue
   */
  tasks(maxTasks = this.config.maxFetcherJobs): JobTask[] {
    const max = this.config.maxPerRequest
    const tasks: JobTask[] = []
    try {
      if (this.pathToNodeRequestData.size() > 0) {
        let { pathStrings } = this.getSortedPathStrings() // TODO pass in number of paths to return
        while (tasks.length < maxTasks && pathStrings.length > 0) {
          const requestedPathStrings = pathStrings.slice(0, max)
          pathStrings = pathStrings.slice(max + 1)
          for (const pathString of requestedPathStrings) {
            const nodeHash = this.pathToNodeRequestData.getElementByKey(pathString)?.nodeHash // TODO return node set too from sorted function and avoid lookups here
            if (nodeHash === undefined) throw Error('Path should exist')
            this.requestedNodeToPath.set(nodeHash as unknown as string, pathString)
          }
          this.debug('At start of mergeAndFormatPaths')
          const paths = mergeAndFormatKeyPaths(requestedPathStrings) as unknown as Uint8Array[][]
          tasks.push({
            pathStrings: requestedPathStrings,
            paths,
          })
          this.debug(`Created new tasks num=${tasks.length}`)
        }
      }
      this.debug(`Created new tasks num=${tasks.length}`)
    } catch (e) {
      this.debug(e)
    }

    return tasks
  }

  nextTasks(): void {
    try {
      if (this.in.length === 0) {
        if (this.pathToNodeRequestData.size() > 0) {
          const tasks = this.tasks()
          let count = 0
          for (const task of tasks) {
            count += task.pathStrings.length
            this.enqueueTask(task, true)
          }
          this.debug(`Fetcher pending with ${count} path requested`)
        }
      }
    } catch (err) {
      this.debug(err)
    }
  }

  /**
   * Clears all outstanding tasks from the fetcher
   */
  clear() {
    return
  }

  /**
   * Returns an idle peer that can process a next job.
   */
  peer(): Peer | undefined {
    return this.pool.idle((peer) => 'snap' in peer)
  }

  processStoreError(
    error: Error,
    _task: JobTask,
  ): { destroyFetcher: boolean; banPeer: boolean; stepBack: bigint } {
    const stepBack = BIGINT_0
    const destroyFetcher =
      !(error.message as string).includes(`InvalidRangeProof`) &&
      !(error.message as string).includes(`InvalidAccountRange`)
    const banPeer = true
    return { destroyFetcher, banPeer, stepBack }
  }

  /**
   * Job log format helper.
   * @param job
   * @param withIndex pass true to additionally output job.index
   */
  jobStr(job: Job<JobTask, Uint8Array[], Uint8Array>, withIndex = false) {
    let str = ''
    if (withIndex) {
      str += `index=${job.index} `
    }

    str += `${job.task.paths.length} node requests`
    return str
  }
}
