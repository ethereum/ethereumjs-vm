import { arrToBufArr, bufferToBigInt } from 'ethereumjs-util'
import RLP from 'rlp'
import { Block, BlockHeader, BlockOptions, BlockBuffer, BlockBodyBuffer } from '@ethereumjs/block'
import Common from '@ethereumjs/common'
import Cache from './cache'
import { DatabaseKey, DBOp, DBTarget, DBOpData } from './operation'

// eslint-disable-next-line implicit-dependencies/no-implicit
import type { LevelUp } from 'levelup'
const level = require('level-mem')

/**
 * @hidden
 */
export interface GetOpts {
  keyEncoding?: string
  valueEncoding?: string
  cache?: string
}

export type CacheMap = { [key: string]: Cache<Buffer> }

/**
 * Abstraction over a DB to facilitate storing/fetching blockchain-related
 * data, such as blocks and headers, indices, and the head block.
 * @hidden
 */
export class DBManager {
  private _cache: CacheMap
  private _common: Common
  private _db: LevelUp

  constructor(db: LevelUp, common: Common) {
    this._db = db
    this._common = common
    this._cache = {
      td: new Cache({ max: 1024 }),
      header: new Cache({ max: 512 }),
      body: new Cache({ max: 256 }),
      numberToHash: new Cache({ max: 2048 }),
      hashToNumber: new Cache({ max: 2048 }),
    }
  }

  /**
   * Fetches iterator heads from the db.
   */
  async getHeads(): Promise<{ [key: string]: Buffer }> {
    const heads = await this.get(DBTarget.Heads)
    Object.keys(heads).forEach((key) => {
      heads[key] = Buffer.from(heads[key])
    })
    return heads
  }

  /**
   * Fetches header of the head block.
   */
  async getHeadHeader(): Promise<Buffer> {
    return this.get(DBTarget.HeadHeader)
  }

  /**
   * Fetches head block.
   */
  async getHeadBlock(): Promise<Buffer> {
    return this.get(DBTarget.HeadBlock)
  }

  /**
   * Fetches a block (header and body) given a block id,
   * which can be either its hash or its number.
   */
  async getBlock(blockId: Buffer | bigint | number): Promise<Block> {
    if (typeof blockId === 'number' && Number.isInteger(blockId)) {
      blockId = BigInt(blockId)
    }

    let number
    let hash
    if (Buffer.isBuffer(blockId)) {
      hash = blockId
      number = await this.hashToNumber(blockId)
    } else if (typeof blockId === 'bigint') {
      number = blockId
      hash = await this.numberToHash(blockId)
    } else {
      throw new Error('Unknown blockId type')
    }

    const header = await this.getHeader(hash, number)
    let body: BlockBodyBuffer = [[], []]
    try {
      body = await this.getBody(hash, number)
    } catch (error: any) {
      if (error.type !== 'NotFoundError') {
        throw error
      }
    }
    const blockData = [header.raw(), ...body] as BlockBuffer
    const opts: BlockOptions = { common: this._common }
    if (number === BigInt(0)) {
      opts.hardforkByBlockNumber = true
    } else {
      opts.hardforkByTD = await this.getTotalDifficulty(header.parentHash, number - BigInt(1))
    }
    return Block.fromValuesArray(blockData, opts)
  }

  /**
   * Fetches body of a block given its hash and number.
   */
  async getBody(blockHash: Buffer, blockNumber: bigint): Promise<BlockBodyBuffer> {
    const body = await this.get(DBTarget.Body, { blockHash, blockNumber })
    return arrToBufArr(RLP.decode(Uint8Array.from(body))) as BlockBodyBuffer
  }

  /**
   * Fetches header of a block given its hash and number.
   */
  async getHeader(blockHash: Buffer, blockNumber: bigint) {
    const encodedHeader = await this.get(DBTarget.Header, { blockHash, blockNumber })
    const opts: BlockOptions = { common: this._common }
    if (blockNumber === BigInt(0)) {
      opts.hardforkByBlockNumber = true
    } else {
      const parentHash = await this.numberToHash(blockNumber - BigInt(1))
      opts.hardforkByTD = await this.getTotalDifficulty(parentHash, blockNumber - BigInt(1))
    }
    return BlockHeader.fromRLPSerializedHeader(encodedHeader, opts)
  }

  /**
   * Fetches total difficulty for a block given its hash and number.
   */
  async getTotalDifficulty(blockHash: Buffer, blockNumber: bigint): Promise<bigint> {
    const td = await this.get(DBTarget.TotalDifficulty, { blockHash, blockNumber })
    return bufferToBigInt(Buffer.from(RLP.decode(Uint8Array.from(td)) as Uint8Array))
  }

  /**
   * Performs a block hash to block number lookup.
   */
  async hashToNumber(blockHash: Buffer): Promise<bigint> {
    const value = await this.get(DBTarget.HashToNumber, { blockHash })
    return bufferToBigInt(value)
  }

  /**
   * Performs a block number to block hash lookup.
   */
  async numberToHash(blockNumber: bigint): Promise<Buffer> {
    if (blockNumber < BigInt(0)) {
      throw new level.errors.NotFoundError()
    }

    return this.get(DBTarget.NumberToHash, { blockNumber })
  }

  /**
   * Fetches a key from the db. If `opts.cache` is specified
   * it first tries to load from cache, and on cache miss will
   * try to put the fetched item on cache afterwards.
   */
  async get(dbOperationTarget: DBTarget, key?: DatabaseKey): Promise<any> {
    const dbGetOperation = DBOp.get(dbOperationTarget, key)

    const cacheString = dbGetOperation.cacheString
    const dbKey = dbGetOperation.baseDBOp.key
    const dbOpts = dbGetOperation.baseDBOp

    if (cacheString) {
      if (!this._cache[cacheString]) {
        throw new Error(`Invalid cache: ${cacheString}`)
      }

      let value = this._cache[cacheString].get(dbKey)
      if (!value) {
        value = <Buffer>await this._db.get(dbKey, dbOpts)
        this._cache[cacheString].set(dbKey, value)
      }

      return value
    }

    return this._db.get(dbKey, dbOpts)
  }

  /**
   * Performs a batch operation on db.
   */
  async batch(ops: DBOp[]) {
    const convertedOps: DBOpData[] = ops.map((op) => op.baseDBOp)
    // update the current cache for each operation
    ops.map((op) => op.updateCache(this._cache))

    return this._db.batch(convertedOps as any)
  }
}
