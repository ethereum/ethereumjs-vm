import { createBlockFromBytesArray, createBlockHeaderFromBytesArray } from '@ethereumjs/block'
import { CliqueConsensus, createBlockchain } from '@ethereumjs/blockchain'
import { ConsensusAlgorithm, Hardfork } from '@ethereumjs/common'
import { BIGINT_0, EthereumJSErrorWithoutCode, equalsBytes } from '@ethereumjs/util'

import { LevelDB } from '../execution/level.js'
import { Event } from '../types.js'

import type { Config } from '../config.js'
import type { Block, BlockHeader } from '@ethereumjs/block'
import type { Blockchain, ConsensusDict } from '@ethereumjs/blockchain'
import type { DB, DBObject, GenesisState } from '@ethereumjs/util'
import type { AbstractLevel } from 'abstract-level'

/**
 * The options that the Blockchain constructor can receive.
 */
export interface ChainOptions {
  /**
   * Client configuration instance
   */
  config: Config

  /**
   * Database to store blocks and metadata. Should be an abstract-leveldown compliant store.
   */
  chainDB?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  /**
   * Specify a blockchain which implements the Chain interface
   */
  blockchain?: Blockchain

  genesisState?: GenesisState

  genesisStateRoot?: Uint8Array
}

/**
 * Returns properties of the canonical blockchain.
 */
export interface ChainBlocks {
  /**
   * The latest block in the chain
   */
  latest: Block | null

  /**
   * The block as signalled `finalized` in the fcU
   * This corresponds to the last finalized beacon block
   */
  finalized: Block | null

  /**
   * The block as signalled `safe` in the fcU
   * This corresponds to the last justified beacon block
   */
  safe: Block | null

  /**
   * The header signalled as `vm` head
   * This corresponds to the last executed block in the canonical chain
   */
  vm: Block | null

  /**
   * The total difficulty of the blockchain
   */
  td: bigint

  /**
   * The height of the blockchain
   */
  height: bigint
}

/**
 * Returns properties of the canonical headerchain.
 */
export interface ChainHeaders {
  /**
   * The latest header in the chain
   */
  latest: BlockHeader | null

  /**
   * The header as signalled `finalized` in the fcU
   * This corresponds to the last finalized beacon block
   */
  finalized: BlockHeader | null

  /**
   * The header as signalled `safe` in the fcU
   * This corresponds to the last justified beacon block
   */
  safe: BlockHeader | null

  /**
   * The header signalled as `vm` head
   * This corresponds to the last executed block in the canonical chain
   */
  vm: BlockHeader | null

  /**
   * The total difficulty of the headerchain
   */
  td: bigint

  /**
   * The height of the headerchain
   */
  height: bigint
}

type BlockCache = {
  remoteBlocks: Map<String, Block>
  executedBlocks: Map<String, Block>
  invalidBlocks: Map<String, Error>
}

/**
 * Blockchain
 * @memberof module:blockchain
 */
export class Chain {
  public config: Config
  public chainDB: DB<string | Uint8Array, string | Uint8Array | DBObject>
  public blockchain: Blockchain
  public blockCache: BlockCache
  public _customGenesisState?: GenesisState
  public _customGenesisStateRoot?: Uint8Array

  public opened: boolean

  private _headers: ChainHeaders = {
    latest: null,
    finalized: null,
    safe: null,
    vm: null,
    td: BIGINT_0,
    height: BIGINT_0,
  }

  private _blocks: ChainBlocks = {
    latest: null,
    finalized: null,
    safe: null,
    vm: null,
    td: BIGINT_0,
    height: BIGINT_0,
  }

  /**
   * Safe creation of a Chain object awaiting the initialization
   * of the underlying Blockchain object.
   *
   * @param options
   */
  public static async create(options: ChainOptions) {
    let validateConsensus = false
    const consensusDict: ConsensusDict = {}
    if (options.config.chainCommon.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      consensusDict[ConsensusAlgorithm.Clique] = new CliqueConsensus()
      validateConsensus = true
    }

    options.blockchain =
      options.blockchain ??
      (await createBlockchain({
        db: new LevelDB(options.chainDB),
        common: options.config.chainCommon,
        hardforkByHeadBlockNumber: true,
        validateBlocks: true,
        validateConsensus,
        consensusDict,
        genesisState: options.genesisState,
        genesisStateRoot: options.genesisStateRoot,
      }))

    return new this(options)
  }

  /**
   * Creates new chain
   *
   * Do not use directly but instead use the static async `create()` constructor
   * for concurrency safe initialization.
   *
   * @param options
   */
  protected constructor(options: ChainOptions) {
    this.config = options.config
    this.blockchain = options.blockchain!
    this.blockCache = {
      remoteBlocks: new Map(),
      executedBlocks: new Map(),
      invalidBlocks: new Map(),
    }

    this.chainDB = this.blockchain.db
    this._customGenesisState = options.genesisState
    this._customGenesisStateRoot = options.genesisStateRoot
    this.opened = false
  }

  /**
   * Resets _header, _blocks
   */
  private reset() {
    this._headers = {
      latest: null,
      finalized: null,
      safe: null,
      vm: null,
      td: BIGINT_0,
      height: BIGINT_0,
    }
    this._blocks = {
      latest: null,
      finalized: null,
      safe: null,
      vm: null,
      td: BIGINT_0,
      height: BIGINT_0,
    }
  }

  /**
   * Chain ID
   */
  get chainId(): bigint {
    return this.config.chainCommon.chainId()
  }

  /**
   * Genesis block for the chain
   */
  get genesis() {
    return this.blockchain.genesisBlock
  }

  /**
   * Returns properties of the canonical headerchain.
   */
  get headers(): ChainHeaders {
    return { ...this._headers }
  }

  /**
   * Returns properties of the canonical blockchain.
   */
  get blocks(): ChainBlocks {
    return { ...this._blocks }
  }

  /**
   * Open blockchain and wait for database to load
   * @returns false if chain is already open, otherwise void
   */
  async open(): Promise<boolean | void> {
    if (this.opened) return false
    await this.blockchain.db.open()
    this.opened = true
    await this.update(false)

    this.config.chainCommon.events.on('hardforkChanged', async (hardfork: string) => {
      const block = this.config.chainCommon.hardforkBlock()
      this.config.superMsg(
        `New hardfork reached 🪢 ! hardfork=${hardfork} ${block !== null ? `block=${block}` : ''}`,
      )
    })
  }

  /**
   * Closes chain
   * @returns false if chain is closed, otherwise void
   */
  async close(): Promise<boolean | void> {
    if (!this.opened) return false
    this.reset()
    await (this.blockchain.db as any)?.close?.()
    this.opened = false
  }

  /**
   * Resets the chain to canonicalHead number
   */
  async resetCanonicalHead(canonicalHead: bigint): Promise<boolean | void> {
    if (!this.opened) return false
    await this.blockchain.resetCanonicalHead(canonicalHead)
    return this.update(false)
  }

  /**
   * Update blockchain properties (latest block, td, height, etc...)
   * @param emit Emit a `CHAIN_UPDATED` event
   * @returns false if chain is closed, otherwise void
   */
  async update(emit = true): Promise<boolean | void> {
    if (!this.opened) return false

    const headers: ChainHeaders = {
      latest: null,
      finalized: null,
      safe: null,
      vm: null,
      td: BIGINT_0,
      height: BIGINT_0,
    }
    const blocks: ChainBlocks = {
      latest: null,
      finalized: null,
      safe: null,
      vm: null,
      td: BIGINT_0,
      height: BIGINT_0,
    }

    blocks.latest = await this.getCanonicalHeadBlock()
    blocks.finalized = (await this.getCanonicalFinalizedBlock()) ?? null
    blocks.safe = (await this.getCanonicalSafeBlock()) ?? null
    blocks.vm = await this.getCanonicalVmHead()

    headers.latest = await this.getCanonicalHeadHeader()
    // finalized and safe are always blocks since they have to have valid execution
    // before they can be saved in chain
    headers.finalized = blocks.finalized?.header ?? null
    headers.safe = blocks.safe?.header ?? null
    headers.vm = blocks.vm.header

    headers.height = headers.latest.number
    blocks.height = blocks.latest.header.number

    headers.td = await this.getTd(headers.latest.hash(), headers.height)
    blocks.td = await this.getTd(blocks.latest.hash(), blocks.height)

    this._headers = headers
    this._blocks = blocks

    this.config.chainCommon.setHardforkBy({
      blockNumber: headers.latest.number,
      timestamp: headers.latest.timestamp,
    })

    if (emit) {
      this.config.events.emit(Event.CHAIN_UPDATED)
    }
  }

  /**
   * Get blocks from blockchain
   * @param block hash or number to start from
   * @param max maximum number of blocks to get
   * @param skip number of blocks to skip
   * @param reverse get blocks in reverse
   * @returns an array of the blocks
   */
  async getBlocks(
    block: Uint8Array | bigint,
    max = 1,
    skip = 0,
    reverse = false,
  ): Promise<Block[]> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getBlocks(block, max, skip, reverse)
  }

  /**
   * Get a block by its hash or number
   * @param block block hash or number
   * @throws if block is not found
   */
  async getBlock(block: Uint8Array | bigint): Promise<Block> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getBlock(block)
  }

  /**
   * Insert new blocks into blockchain
   * @param blocks list of blocks to add
   * @param fromEngine pass true to process post-merge blocks, otherwise they will be skipped
   * @returns number of blocks added
   */
  async putBlocks(blocks: Block[], fromEngine = false, skipUpdateEmit = false): Promise<number> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    if (blocks.length === 0) return 0

    let numAdded = 0
    // filter out finalized blocks
    const newBlocks = []
    for (const block of blocks) {
      if (this.headers.finalized !== null && block.header.number <= this.headers.finalized.number) {
        const canonicalBlock = await this.getBlock(block.header.number)
        if (!equalsBytes(canonicalBlock.hash(), block.hash())) {
          throw Error(
            `Invalid putBlock for block=${block.header.number} before finalized=${this.headers.finalized.number}`,
          )
        }
      } else {
        newBlocks.push(block)
      }
    }

    for (const [i, b] of newBlocks.entries()) {
      if (!fromEngine && this.config.chainCommon.gteHardfork(Hardfork.Paris)) {
        if (i > 0) {
          // emitOnLast below won't be reached, so run an update here
          await this.update(!skipUpdateEmit)
        }
        break
      }

      if (b.header.number <= this.headers.height) {
        await this.blockchain.checkAndTransitionHardForkByNumber(
          b.header.number,
          b.header.timestamp,
        )
        await this.blockchain.consensus?.setup({ blockchain: this.blockchain })
      }

      const block = createBlockFromBytesArray(b.raw(), {
        common: this.config.chainCommon,
        setHardfork: true,
      })

      await this.blockchain.putBlock(block)
      numAdded++
      const emitOnLast = newBlocks.length === numAdded
      await this.update(emitOnLast && !skipUpdateEmit)
    }
    return numAdded
  }

  /**
   * Get headers from blockchain
   * @param block hash or number to start from
   * @param max maximum number of headers to get
   * @param skip number of headers to skip
   * @param reverse get headers in reverse
   * @returns list of block headers
   */
  async getHeaders(
    block: Uint8Array | bigint,
    max: number,
    skip: number,
    reverse: boolean,
  ): Promise<BlockHeader[]> {
    const blocks = await this.getBlocks(block, max, skip, reverse)
    return blocks.map((b) => b.header)
  }

  /**
   * Insert new headers into blockchain
   * @param headers
   * @param mergeIncludes skip adding headers after merge
   * @returns number of headers added
   */
  async putHeaders(headers: BlockHeader[], mergeIncludes = false): Promise<number> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    if (headers.length === 0) return 0

    let numAdded = 0
    for (const [i, h] of headers.entries()) {
      if (!mergeIncludes && this.config.chainCommon.gteHardfork(Hardfork.Paris)) {
        if (i > 0) {
          // emitOnLast below won't be reached, so run an update here
          await this.update(true)
        }
        break
      }
      const header = createBlockHeaderFromBytesArray(h.raw(), {
        common: this.config.chainCommon,
        setHardfork: true,
      })
      await this.blockchain.putHeader(header)
      numAdded++
      const emitOnLast = headers.length === numAdded
      await this.update(emitOnLast)
    }
    return numAdded
  }

  /**
   * Gets the latest header in the canonical chain
   */
  async getCanonicalHeadHeader(): Promise<BlockHeader> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getCanonicalHeadHeader()
  }

  /**
   * Gets the latest block in the canonical chain
   */
  async getCanonicalHeadBlock(): Promise<Block> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getCanonicalHeadBlock()
  }

  /**
   * Gets the latest block in the canonical chain
   */
  async getCanonicalSafeBlock(): Promise<Block | undefined> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getIteratorHeadSafe('safe')
  }

  /**
   * Gets the latest block in the canonical chain
   */
  async getCanonicalFinalizedBlock(): Promise<Block | undefined> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getIteratorHeadSafe('finalized')
  }

  /**
   * Gets the latest block in the canonical chain
   */
  async getCanonicalVmHead(): Promise<Block> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getIteratorHead()
  }

  /**
   * Gets total difficulty for a block
   * @param hash the block hash
   * @param num the block number
   * @returns the td
   */
  async getTd(hash: Uint8Array, num: bigint): Promise<bigint> {
    if (!this.opened) throw EthereumJSErrorWithoutCode('Chain closed')
    return this.blockchain.getTotalDifficulty(hash, num)
  }
}
