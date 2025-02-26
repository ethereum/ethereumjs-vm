import { createBlockFromBytesArray, createBlockHeaderFromBytesArray } from '@ethereumjs/block'
import { RLP } from '@ethereumjs/rlp'
import {
  EthereumJSErrorWithoutCode,
  KECCAK256_RLP,
  KECCAK256_RLP_ARRAY,
  bytesToBigInt,
  bytesToHex,
  equalsBytes,
  unprefixedHexToBytes,
} from '@ethereumjs/util'

import { Cache } from './cache.js'
import { DBOp, DBTarget } from './operation.js'

import type { DatabaseKey } from './operation.js'
import type { Block, BlockBodyBytes, BlockBytes, BlockOptions } from '@ethereumjs/block'
import type { Common } from '@ethereumjs/common'
import type { BatchDBOp, DB, DBObject, DelBatch, PutBatch } from '@ethereumjs/util'

/**
 * @hidden
 */
export interface GetOpts {
  keyEncoding?: string
  valueEncoding?: string
  cache?: string
}

export type CacheMap = { [key: string]: Cache<Uint8Array> }

/**
 * Abstraction over a DB to facilitate storing/fetching blockchain-related
 * data, such as blocks and headers, indices, and the head block.
 * @hidden
 */
export class DBManager {
  private _cache: CacheMap
  public readonly common: Common
  private _db: DB<Uint8Array | string, Uint8Array | string | DBObject>

  constructor(db: DB<Uint8Array | string, Uint8Array | string | DBObject>, common: Common) {
    this._db = db
    this.common = common
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
  async getHeads(): Promise<{ [key: string]: Uint8Array }> {
    const heads = (await this.get(DBTarget.Heads)) as DBObject
    if (heads === undefined) return heads
    const decodedHeads: { [key: string]: Uint8Array } = {}
    for (const key of Object.keys(heads)) {
      // Heads are stored in DB as hex strings since Level converts Uint8Arrays
      // to nested JSON objects when they are included in a value being stored
      // in the DB
      decodedHeads[key] = unprefixedHexToBytes(heads[key] as string)
    }
    return decodedHeads
  }

  /**
   * Fetches header of the head block.
   */
  async getHeadHeader(): Promise<Uint8Array | undefined> {
    return this.get(DBTarget.HeadHeader)
  }

  /**
   * Fetches head block.
   */
  async getHeadBlock(): Promise<Uint8Array | undefined> {
    return this.get(DBTarget.HeadBlock)
  }

  /**
   * Fetches a block (header and body) given a block id,
   * which can be either its hash or its number.
   */
  async getBlock(blockId: Uint8Array | bigint | number): Promise<Block | undefined> {
    if (typeof blockId === 'number' && Number.isInteger(blockId)) {
      blockId = BigInt(blockId)
    }

    let number
    let hash
    if (blockId === undefined) return undefined
    if (blockId instanceof Uint8Array) {
      hash = blockId
      number = await this.hashToNumber(blockId)
    } else if (typeof blockId === 'bigint') {
      number = blockId
      hash = await this.numberToHash(blockId)
    } else {
      throw EthereumJSErrorWithoutCode('Unknown blockId type')
    }

    if (hash === undefined || number === undefined) return undefined
    const header = await this.getHeader(hash, number)
    let body = await this.getBody(hash, number)

    // be backward compatible where we didn't use to store a body with no txs, uncles, withdrawals
    // otherwise the body is never partially stored and if we have some body, its in entirety
    if (body === undefined) {
      body = [[], []] as BlockBodyBytes
      // Do extra validations on the header since we are assuming empty transactions and uncles
      if (!equalsBytes(header.transactionsTrie, KECCAK256_RLP)) {
        throw EthereumJSErrorWithoutCode('transactionsTrie root should be equal to hash of null')
      }

      if (!equalsBytes(header.uncleHash, KECCAK256_RLP_ARRAY)) {
        throw EthereumJSErrorWithoutCode('uncle hash should be equal to hash of empty array')
      }

      // If this block had empty withdrawals push an empty array in body
      if (header.withdrawalsRoot !== undefined) {
        // Do extra validations for withdrawal before assuming empty withdrawals
        if (!equalsBytes(header.withdrawalsRoot, KECCAK256_RLP)) {
          throw EthereumJSErrorWithoutCode(
            'withdrawals root shoot be equal to hash of null when no withdrawals',
          )
        } else {
          body.push([])
        }
      }
    }

    const blockData = [header.raw(), ...body] as BlockBytes
    const opts: BlockOptions = { common: this.common, setHardfork: true }
    return createBlockFromBytesArray(blockData, opts)
  }

  /**
   * Fetches body of a block given its hash and number.
   */
  async getBody(blockHash: Uint8Array, blockNumber: bigint): Promise<BlockBodyBytes | undefined> {
    const body = await this.get(DBTarget.Body, { blockHash, blockNumber })
    return body !== undefined ? (RLP.decode(body) as BlockBodyBytes) : undefined
  }

  /**
   * Fetches header of a block given its hash and number.
   */
  async getHeader(blockHash: Uint8Array, blockNumber: bigint) {
    const encodedHeader = await this.get(DBTarget.Header, { blockHash, blockNumber })
    const headerValues = RLP.decode(encodedHeader)

    const opts: BlockOptions = { common: this.common, setHardfork: true }
    return createBlockHeaderFromBytesArray(headerValues as Uint8Array[], opts)
  }

  /**
   * Fetches total difficulty for a block given its hash and number.
   */
  async getTotalDifficulty(blockHash: Uint8Array, blockNumber: bigint): Promise<bigint> {
    const td = await this.get(DBTarget.TotalDifficulty, { blockHash, blockNumber })
    return bytesToBigInt(RLP.decode(td) as Uint8Array)
  }

  /**
   * Performs a block hash to block number lookup.
   */
  async hashToNumber(blockHash: Uint8Array): Promise<bigint | undefined> {
    const value = await this.get(DBTarget.HashToNumber, { blockHash })
    if (value === undefined) {
      throw EthereumJSErrorWithoutCode(`value for ${bytesToHex(blockHash)} not found in DB`)
    }
    return value !== undefined ? bytesToBigInt(value) : undefined
  }

  /**
   * Performs a block number to block hash lookup.
   */
  async numberToHash(blockNumber: bigint): Promise<Uint8Array | undefined> {
    const value = await this.get(DBTarget.NumberToHash, { blockNumber })
    return value
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

    if (cacheString !== undefined) {
      if (this._cache[cacheString] === undefined) {
        throw EthereumJSErrorWithoutCode(`Invalid cache: ${cacheString}`)
      }
      let value = this._cache[cacheString].get(dbKey)
      if (value === undefined) {
        value = (await this._db.get(dbKey, {
          keyEncoding: dbGetOperation.baseDBOp.keyEncoding,
          valueEncoding: dbGetOperation.baseDBOp.valueEncoding,
        })) as Uint8Array | undefined
        if (value !== undefined) {
          this._cache[cacheString].set(dbKey, value)
        }
      }

      return value
    }
    return this._db.get(dbKey, {
      keyEncoding: dbGetOperation.baseDBOp.keyEncoding,
      valueEncoding: dbGetOperation.baseDBOp.valueEncoding,
    })
  }

  /**
   * Performs a batch operation on db.
   */
  async batch(ops: DBOp[]) {
    const convertedOps: BatchDBOp[] = ops.map((op) => {
      const type =
        op.baseDBOp.type !== undefined
          ? op.baseDBOp.type
          : op.baseDBOp.value !== undefined
            ? 'put'
            : 'del'
      const convertedOp = {
        key: op.baseDBOp.key,
        value: op.baseDBOp.value,
        type,
        opts: {
          keyEncoding: op.baseDBOp.keyEncoding,
          valueEncoding: op.baseDBOp.valueEncoding,
        },
      }
      if (type === 'put') return convertedOp as PutBatch
      else return convertedOp as DelBatch
    })
    // update the current cache for each operation
    ops.map((op) => op.updateCache(this._cache))
    return this._db.batch(convertedOps)
  }
}
