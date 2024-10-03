import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { genPrivateKey } from '@ethereumjs/devp2p'
import { type Address, BIGINT_0, BIGINT_1, BIGINT_2, BIGINT_256 } from '@ethereumjs/util'
import { Level } from 'level'

import { getLogger } from './logging.js'
import { RlpxServer } from './net/server/index.js'
import { Event, EventBus } from './types.js'
import { isBrowser, short } from './util/index.js'

import type { Logger } from './logging.js'
import type { EventBusType, MultiaddrLike, PrometheusMetrics } from './types.js'
import type { BlockHeader } from '@ethereumjs/block'
import type { VM, VMProfilerOpts } from '@ethereumjs/vm'
import type { Multiaddr } from '@multiformats/multiaddr'

export enum DataDirectory {
  Chain = 'chain',
  State = 'state',
  Meta = 'meta',
}

export enum SyncMode {
  Full = 'full',
  Light = 'light',
  None = 'none',
}

export interface ConfigOptions {
  /**
   * Specify the chain by providing a {@link Common} instance,
   * the common instance will not be modified by client
   *
   * Default: 'mainnet' Common
   */
  common?: Common

  /**
   * Synchronization mode ('full', 'light', 'none')
   *
   * Default: 'full'
   */
  syncmode?: SyncMode

  /**
   * Whether to enable and run snapSync, currently experimental
   *
   * Default: false
   */
  enableSnapSync?: boolean

  /**
   * A temporary option to offer backward compatibility with already-synced databases that are
   * using non-prefixed keys for storage tries
   *
   * Default: true
   */
  prefixStorageTrieKeys?: boolean

  /**
   * A temporary option to offer backward compatibility with already-synced databases that stores
   * trie items as `string`, instead of the more performant `Uint8Array`
   */
  useStringValueTrieDB?: boolean

  /**
   * Provide a custom VM instance to process blocks
   *
   * Default: VM instance created by client
   */
  vm?: VM

  /**
   * Serve light peer requests
   *
   * Default: `false`
   */
  lightserv?: boolean

  /**
   * Root data directory for the blockchain
   */
  datadir?: string

  /**
   * Private key for the client.
   * Use return value of {@link Config.getClientKey}.
   * If left blank, a random key will be generated and used.
   */
  key?: Uint8Array

  /**
   * Network bootnodes
   * (e.g. abc@18.138.108.67 or /ip4/127.0.0.1/tcp/50505/p2p/QmABC)
   */
  bootnodes?: Multiaddr[]

  /**
   * RLPx listening port
   *
   * Default: `30303`
   */
  port?: number

  /**
   * RLPx external IP
   */
  extIP?: string

  /**
   * Network multiaddrs for libp2p
   * (e.g. /ip4/127.0.0.1/tcp/50505/p2p/QmABC)
   */
  multiaddrs?: Multiaddr[]

  /**
   * Transport servers (RLPx)
   * Only used for testing purposes
   */
  server?: RlpxServer

  /**
   * Save tx receipts and logs in the meta db (default: false)
   */
  saveReceipts?: boolean

  /**
   * Number of recent blocks to maintain transactions index for
   * (default = 2350000 = about one year, 0 = entire chain)
   */
  txLookupLimit?: number

  /**
   * A custom winston logger can be provided
   * if setting logging verbosity is not sufficient
   *
   * Default: Logger with loglevel 'info'
   */
  logger?: Logger

  /**
   * Max items per block or header request
   *
   * Default: `100`
   */
  maxPerRequest?: number

  /**
   * Max jobs to be enqueued in the fetcher at any given time
   *
   * Default: `100`
   */
  maxFetcherJobs?: number

  /**
   * Max outgoing multi-peer requests by the fetcher at any given time
   */
  maxFetcherRequests?: number

  /**
   * Number of peers needed before syncing
   *
   * Default: `1`
   */
  minPeers?: number

  /**
   * Maximum peers allowed
   *
   * Default: `25`
   */
  maxPeers?: number

  /**
   * DNS server to query DNS TXT records from for peer discovery
   *
   * Default `8.8.8.8` (Google)
   */
  dnsAddr?: string

  /**
   * EIP-1459 ENR Tree urls to query via DNS for peer discovery
   */
  dnsNetworks?: string[]

  /**
   * Start continuous VM execution (pre-Merge setting)
   */
  execution?: boolean

  /**
   * Number of blocks to execute in batch mode and logged to console
   */
  numBlocksPerIteration?: number

  /**
   * Size for the account cache (max number of accounts)
   */
  accountCache?: number

  /**
   * Size for the storage cache (max number of contracts)
   */
  storageCache?: number

  /**
   * Size for the code cache (max number of contracts)
   */
  codeCache?: number

  /**
   * Size for the trie cache (max number of trie nodes)
   */
  trieCache?: number

  /**
   * Generate code for local debugging, currently providing a
   * code snippet which can be used to run blocks on the
   * EthereumJS VM on execution errors
   *
   * (meant to be used internally for the most part)
   */
  debugCode?: boolean

  /**
   * Query EIP-1459 DNS TXT records for peer discovery
   *
   * Default: `true` for testnets, false for mainnet
   */
  discDns?: boolean

  /**
   * Use v4 ("findneighbour" node requests) for peer discovery
   *
   * Default: `false` for testnets, true for mainnet
   */
  discV4?: boolean

  /**
   * Enable mining
   *
   * Default: `false`
   */
  mine?: boolean

  /**
   * Is a single node and doesn't need peers for synchronization
   *
   * Default: `false`
   */
  isSingleNode?: boolean

  /**
   * Whether to profile VM blocks
   */
  vmProfileBlocks?: boolean

  /**
   * Whether to profile VM txs
   */
  vmProfileTxs?: boolean

  /**
   * Unlocked accounts of form [address, privateKey]
   * Currently only the first account is used to seal mined PoA blocks
   *
   * Default: []
   */
  accounts?: [address: Address, privKey: Uint8Array][]

  /**
   * Address for mining rewards (etherbase)
   * If not provided, defaults to the primary account.
   */
  minerCoinbase?: Address

  /**
   * If there is a reorg, this is a safe distance from which
   * to try to refetch and re-feed the blocks.
   */
  safeReorgDistance?: number

  /**
   * If there is a skeleton fillCanonicalChain block lookup errors
   * because of closing chain conditions, this allows skeleton
   * to backstep and fill again using reverse block fetcher.
   */
  skeletonFillCanonicalBackStep?: number

  /**
   * If skeleton subchains can be merged, what is the minimum tail
   * gain, as subchain merge will lead to the ReverseBlockFetcher
   * reset
   */
  skeletonSubchainMergeMinimum?: number

  maxRangeBytes?: number

  maxAccountRange?: bigint
  /**
   * The time after which synced state is downgraded to unsynced
   */
  syncedStateRemovalPeriod?: number

  /**
   * Max depth for parent lookups in engine's newPayload and forkchoiceUpdated
   */
  engineParentLookupMaxDepth?: number

  /**
   * Max blocks including unexecuted parents to be executed in engine's newPayload
   */
  engineNewpayloadMaxExecute?: number

  /**
   * Limit max transactions per block to execute in engine's newPayload for responsive engine api
   */
  engineNewpayloadMaxTxsExecute?: number

  maxStorageRange?: bigint

  /**
   * Cache size of invalid block hashes and their errors
   */
  maxInvalidBlocksErrorCache?: number
  pruneEngineCache?: boolean
  snapAvailabilityDepth?: bigint
  snapTransitionSafeDepth?: bigint

  /**
   * Save account keys preimages in the meta db (default: false)
   */
  savePreimages?: boolean

  /**
   * Enables stateless verkle block execution (default: false)
   */
  statelessVerkle?: boolean
  startExecution?: boolean
  ignoreStatelessInvalidExecs?: boolean

  /**
   * Enables Prometheus Metrics that can be collected for monitoring client health
   */
  prometheusMetrics?: PrometheusMetrics
}

export class Config {
  /**
   * Central event bus for events emitted by the different
   * components of the client
   */
  public readonly events: EventBusType

  public static readonly CHAIN_DEFAULT = Mainnet
  public static readonly SYNCMODE_DEFAULT = SyncMode.Full
  public static readonly LIGHTSERV_DEFAULT = false
  public static readonly DATADIR_DEFAULT = `./datadir`
  public static readonly PORT_DEFAULT = 30303
  public static readonly MAXPERREQUEST_DEFAULT = 100
  public static readonly MAXFETCHERJOBS_DEFAULT = 100
  public static readonly MAXFETCHERREQUESTS_DEFAULT = 5
  public static readonly MINPEERS_DEFAULT = 1
  public static readonly MAXPEERS_DEFAULT = 25
  public static readonly DNSADDR_DEFAULT = '8.8.8.8'
  public static readonly EXECUTION = true
  public static readonly NUM_BLOCKS_PER_ITERATION = 100
  public static readonly ACCOUNT_CACHE = 400000
  public static readonly STORAGE_CACHE = 200000
  public static readonly CODE_CACHE = 200000
  public static readonly TRIE_CACHE = 200000
  public static readonly DEBUGCODE_DEFAULT = false
  public static readonly SAFE_REORG_DISTANCE = 100
  public static readonly SKELETON_FILL_CANONICAL_BACKSTEP = 100
  public static readonly SKELETON_SUBCHAIN_MERGE_MINIMUM = 1000

  public static readonly MAX_RANGE_BYTES = 50000
  // This should get like 100 accounts in this range
  public static readonly MAX_ACCOUNT_RANGE = (BIGINT_2 ** BIGINT_256 - BIGINT_1) / BigInt(1_000)
  // Larger ranges used for storage slots since assumption is slots should be much sparser than accounts
  public static readonly MAX_STORAGE_RANGE = (BIGINT_2 ** BIGINT_256 - BIGINT_1) / BigInt(10)

  public static readonly MAX_INVALID_BLOCKS_ERROR_CACHE = 128
  public static readonly PRUNE_ENGINE_CACHE = true

  public static readonly SYNCED_STATE_REMOVAL_PERIOD = 60000
  // engine new payload calls can come in batch of 64, keeping 128 as the lookup factor
  public static readonly ENGINE_PARENT_LOOKUP_MAX_DEPTH = 128
  public static readonly ENGINE_NEWPAYLOAD_MAX_EXECUTE = 2
  public static readonly ENGINE_NEWPAYLOAD_MAX_TXS_EXECUTE = 200
  public static readonly SNAP_AVAILABILITY_DEPTH = BigInt(128)
  // distance from head at which we can safely transition from a synced snapstate to vmexecution
  // randomly kept it at 5 for fast testing purposes but ideally should be >=32 slots
  public static readonly SNAP_TRANSITION_SAFE_DEPTH = BigInt(5)

  public readonly logger: Logger
  public readonly syncmode: SyncMode
  public readonly vm?: VM
  public readonly lightserv: boolean
  public readonly datadir: string
  public readonly key: Uint8Array
  public readonly bootnodes?: Multiaddr[]
  public readonly port?: number
  public readonly extIP?: string
  public readonly multiaddrs?: Multiaddr[]
  public readonly saveReceipts: boolean
  public readonly txLookupLimit: number
  public readonly maxPerRequest: number
  public readonly maxFetcherJobs: number
  public readonly maxFetcherRequests: number
  public readonly minPeers: number
  public readonly maxPeers: number
  public readonly dnsAddr: string
  public readonly execution: boolean
  public readonly numBlocksPerIteration: number
  public readonly accountCache: number
  public readonly storageCache: number
  public readonly codeCache: number
  public readonly trieCache: number
  public readonly debugCode: boolean
  public readonly discDns: boolean
  public readonly discV4: boolean
  public readonly mine: boolean
  public readonly isSingleNode: boolean
  public readonly accounts: [address: Address, privKey: Uint8Array][]
  public readonly minerCoinbase?: Address
  public readonly vmProfilerOpts?: VMProfilerOpts

  public readonly safeReorgDistance: number
  public readonly skeletonFillCanonicalBackStep: number
  public readonly skeletonSubchainMergeMinimum: number
  public readonly maxRangeBytes: number
  public readonly maxAccountRange: bigint
  public readonly maxStorageRange: bigint
  public readonly maxInvalidBlocksErrorCache: number
  public readonly pruneEngineCache: boolean
  public readonly syncedStateRemovalPeriod: number
  public readonly engineParentLookupMaxDepth: number
  public readonly engineNewpayloadMaxExecute: number
  public readonly engineNewpayloadMaxTxsExecute: number
  public readonly snapAvailabilityDepth: bigint
  public readonly snapTransitionSafeDepth: bigint

  public readonly prefixStorageTrieKeys: boolean
  // Defaulting to false as experimental as of now
  public readonly enableSnapSync: boolean
  public readonly useStringValueTrieDB: boolean
  public readonly savePreimages: boolean

  public readonly statelessVerkle: boolean
  public readonly startExecution: boolean
  public readonly ignoreStatelessInvalidExecs: boolean

  public synchronized: boolean
  public lastSynchronized?: boolean
  /** lastSyncDate in ms */
  public lastSyncDate: number
  /** Best known block height */
  public syncTargetHeight?: bigint
  /** Client is in the process of shutting down */
  public shutdown: boolean = false

  public readonly chainCommon: Common
  public readonly execCommon: Common

  public readonly server: RlpxServer | undefined = undefined

  public readonly metrics: PrometheusMetrics | undefined

  constructor(options: ConfigOptions = {}) {
    this.events = new EventBus() as EventBusType

    this.syncmode = options.syncmode ?? Config.SYNCMODE_DEFAULT
    this.vm = options.vm
    this.lightserv = options.lightserv ?? Config.LIGHTSERV_DEFAULT
    this.bootnodes = options.bootnodes
    this.port = options.port ?? Config.PORT_DEFAULT
    this.extIP = options.extIP
    this.multiaddrs = options.multiaddrs
    this.datadir = options.datadir ?? Config.DATADIR_DEFAULT
    this.key = options.key ?? genPrivateKey()
    this.saveReceipts = options.saveReceipts ?? false
    this.txLookupLimit = options.txLookupLimit ?? 2350000
    this.maxPerRequest = options.maxPerRequest ?? Config.MAXPERREQUEST_DEFAULT
    this.maxFetcherJobs = options.maxFetcherJobs ?? Config.MAXFETCHERJOBS_DEFAULT
    this.maxFetcherRequests = options.maxFetcherRequests ?? Config.MAXFETCHERREQUESTS_DEFAULT
    this.minPeers = options.minPeers ?? Config.MINPEERS_DEFAULT
    this.maxPeers = options.maxPeers ?? Config.MAXPEERS_DEFAULT
    this.dnsAddr = options.dnsAddr ?? Config.DNSADDR_DEFAULT
    this.execution = options.execution ?? Config.EXECUTION
    this.numBlocksPerIteration = options.numBlocksPerIteration ?? Config.NUM_BLOCKS_PER_ITERATION
    this.accountCache = options.accountCache ?? Config.ACCOUNT_CACHE
    this.storageCache = options.storageCache ?? Config.STORAGE_CACHE
    this.codeCache = options.codeCache ?? Config.CODE_CACHE
    this.trieCache = options.trieCache ?? Config.TRIE_CACHE
    this.debugCode = options.debugCode ?? Config.DEBUGCODE_DEFAULT
    this.mine = options.mine ?? false
    this.isSingleNode = options.isSingleNode ?? false
    this.savePreimages = options.savePreimages ?? false

    if (options.vmProfileBlocks !== undefined || options.vmProfileTxs !== undefined) {
      this.vmProfilerOpts = {
        reportAfterBlock: options.vmProfileBlocks !== false,
        reportAfterTx: options.vmProfileTxs !== false,
      }
    }

    this.accounts = options.accounts ?? []
    this.minerCoinbase = options.minerCoinbase

    this.safeReorgDistance = options.safeReorgDistance ?? Config.SAFE_REORG_DISTANCE
    this.skeletonFillCanonicalBackStep =
      options.skeletonFillCanonicalBackStep ?? Config.SKELETON_FILL_CANONICAL_BACKSTEP
    this.skeletonSubchainMergeMinimum =
      options.skeletonSubchainMergeMinimum ?? Config.SKELETON_SUBCHAIN_MERGE_MINIMUM

    this.maxRangeBytes = options.maxRangeBytes ?? Config.MAX_RANGE_BYTES
    this.maxAccountRange = options.maxAccountRange ?? Config.MAX_ACCOUNT_RANGE
    this.maxStorageRange = options.maxStorageRange ?? Config.MAX_STORAGE_RANGE

    this.maxInvalidBlocksErrorCache =
      options.maxInvalidBlocksErrorCache ?? Config.MAX_INVALID_BLOCKS_ERROR_CACHE
    this.pruneEngineCache = options.pruneEngineCache ?? Config.PRUNE_ENGINE_CACHE

    this.syncedStateRemovalPeriod =
      options.syncedStateRemovalPeriod ?? Config.SYNCED_STATE_REMOVAL_PERIOD
    this.engineParentLookupMaxDepth =
      options.engineParentLookupMaxDepth ?? Config.ENGINE_PARENT_LOOKUP_MAX_DEPTH
    this.engineNewpayloadMaxExecute =
      options.engineNewpayloadMaxExecute ?? Config.ENGINE_NEWPAYLOAD_MAX_EXECUTE
    this.engineNewpayloadMaxTxsExecute =
      options.engineNewpayloadMaxTxsExecute ?? Config.ENGINE_NEWPAYLOAD_MAX_TXS_EXECUTE
    this.snapAvailabilityDepth = options.snapAvailabilityDepth ?? Config.SNAP_AVAILABILITY_DEPTH
    this.snapTransitionSafeDepth =
      options.snapTransitionSafeDepth ?? Config.SNAP_TRANSITION_SAFE_DEPTH

    this.prefixStorageTrieKeys = options.prefixStorageTrieKeys ?? true
    this.enableSnapSync = options.enableSnapSync ?? false
    this.useStringValueTrieDB = options.useStringValueTrieDB ?? false

    this.statelessVerkle = options.statelessVerkle ?? true
    this.startExecution = options.startExecution ?? false
    this.ignoreStatelessInvalidExecs = options.ignoreStatelessInvalidExecs ?? false

    this.metrics = options.prometheusMetrics

    // Start it off as synchronized if this is configured to mine or as single node
    this.synchronized = this.isSingleNode ?? this.mine
    this.lastSyncDate = 0

    const common =
      options.common ?? new Common({ chain: Config.CHAIN_DEFAULT, hardfork: Hardfork.Chainstart })
    this.chainCommon = common.copy()
    this.execCommon = common.copy()

    this.discDns = this.getDnsDiscovery(options.discDns)
    this.discV4 = options.discV4 ?? true

    this.logger = options.logger ?? getLogger({ logLevel: 'error' })

    this.logger.info(`Sync Mode ${this.syncmode}`)
    if (this.syncmode !== SyncMode.None) {
      if (options.server !== undefined) {
        this.server = options.server
      } else if (isBrowser() !== true) {
        // Otherwise start server
        const bootnodes: MultiaddrLike =
          this.bootnodes ?? (this.chainCommon.bootstrapNodes() as any)
        const dnsNetworks = options.dnsNetworks ?? this.chainCommon.dnsNetworks()
        this.server = new RlpxServer({ config: this, bootnodes, dnsNetworks })
      }
    }

    this.events.once(Event.CLIENT_SHUTDOWN, () => {
      this.shutdown = true
    })
  }

  /**
   * Update the synchronized state of the chain
   * @param option latest to update the sync state with
   * @emits {@link Event.SYNC_SYNCHRONIZED}
   */
  updateSynchronizedState(latest?: BlockHeader | null, emitSyncEvent?: boolean) {
    // If no syncTargetHeight has been discovered from peer and neither the client is set
    // for mining/single run (validator), then sync state can't be updated
    if ((this.syncTargetHeight ?? BIGINT_0) === BIGINT_0 && !this.mine && !this.isSingleNode) {
      return
    }

    if (latest !== null && latest !== undefined) {
      const height = latest.number
      if (height >= (this.syncTargetHeight ?? BIGINT_0)) {
        this.syncTargetHeight = height
        this.lastSyncDate =
          typeof latest.timestamp === 'bigint' && latest.timestamp > 0n
            ? Number(latest.timestamp) * 1000
            : Date.now()

        const diff = Date.now() - this.lastSyncDate
        // update synchronized
        if (diff < this.syncedStateRemovalPeriod) {
          if (!this.synchronized) {
            this.synchronized = true
            // Log to console the sync status
            this.superMsg(
              `Synchronized blockchain at height=${height} hash=${short(latest.hash())} 🎉`,
            )
          }

          if (emitSyncEvent === true) {
            this.events.emit(Event.SYNC_SYNCHRONIZED, height)
          }
        }
      }
    } else {
      if (this.synchronized && !this.mine && !this.isSingleNode) {
        const diff = Date.now() - this.lastSyncDate
        if (diff >= this.syncedStateRemovalPeriod) {
          this.synchronized = false
          this.logger.info(
            `Sync status reset (no chain updates for ${Math.round(diff / 1000)} seconds).`,
          )
        }
      }
    }

    if (this.synchronized !== this.lastSynchronized) {
      this.logger.debug(
        `Client synchronized=${this.synchronized}${
          latest !== null && latest !== undefined ? ' height=' + latest.number : ''
        } syncTargetHeight=${this.syncTargetHeight} lastSyncDate=${
          (Date.now() - this.lastSyncDate) / 1000
        } secs ago`,
      )
      this.lastSynchronized = this.synchronized
    }
  }

  /**
   * Returns the network directory for the chain.
   */
  getNetworkDirectory(): string {
    const networkDirName = this.chainCommon.chainName()
    return `${this.datadir}/${networkDirName}`
  }

  getInvalidPayloadsDir(): string {
    return `${this.getNetworkDirectory()}/invalidPayloads`
  }

  /**
   * Returns the location for each {@link DataDirectory}
   */
  getDataDirectory(dir: DataDirectory): string {
    const networkDir = this.getNetworkDirectory()
    switch (dir) {
      case DataDirectory.Chain: {
        const chainDataDirName = this.syncmode === SyncMode.Light ? 'lightchain' : 'chain'
        return `${networkDir}/${chainDataDirName}`
      }
      case DataDirectory.State:
        return `${networkDir}/state`
      case DataDirectory.Meta:
        return `${networkDir}/meta`
    }
  }

  /**
   * Returns the config level db.
   */
  static getConfigDB(networkDir: string) {
    return new Level<string | Uint8Array, Uint8Array>(`${networkDir}/config`)
  }

  /**
   * Gets the client private key from the config db.
   */
  static async getClientKey(datadir: string, common: Common) {
    const networkDir = `${datadir}/${common.chainName()}`
    const db = this.getConfigDB(networkDir)
    const encodingOpts = { keyEncoding: 'utf8', valueEncoding: 'view' }
    const dbKey = 'config:client_key'
    let key
    try {
      key = await db.get(dbKey, encodingOpts)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if (error.code === 'LEVEL_NOT_FOUND') {
        // generate and save a new key
        key = genPrivateKey()
        await db.put(dbKey, key, encodingOpts)
      }
    }
    return key
  }

  superMsg(msgs: string | string[], meta?: any) {
    if (typeof msgs === 'string') {
      msgs = [msgs]
    }
    let len = 0
    for (const msg of msgs) {
      len = msg.length > len ? msg.length : len
    }
    this.logger.info('-'.repeat(len), meta)
    for (const msg of msgs) {
      this.logger.info(msg, meta)
    }
    this.logger.info('-'.repeat(len), meta)
  }

  /**
   * Returns specified option or the default setting for whether DNS-based peer discovery
   * is enabled based on chainName. `true` for goerli
   */
  getDnsDiscovery(option: boolean | undefined): boolean {
    if (option !== undefined) return option
    const dnsNets = ['goerli', 'sepolia', 'holesky']
    return dnsNets.includes(this.chainCommon.chainName())
  }
}
