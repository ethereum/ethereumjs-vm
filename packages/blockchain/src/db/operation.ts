import { EthereumJSErrorWithoutCode, KeyEncoding, ValueEncoding } from '@ethereumjs/util'

import {
  HEADS_KEY,
  HEAD_BLOCK_KEY,
  HEAD_HEADER_KEY,
  bodyKey,
  hashToNumberKey,
  headerKey,
  numberToHashKey,
  tdKey,
} from './constants.js'

import type { CacheMap } from './manager.js'

export enum DBTarget {
  Heads,
  HeadHeader,
  HeadBlock,
  HashToNumber,
  NumberToHash,
  TotalDifficulty,
  Body,
  Header,
  CliqueSignerStates,
  CliqueVotes,
  CliqueBlockSigners,
}

/**
 * DBOpData is a type which has the purpose of holding the actual data of the Database Operation.
 * @hidden
 */
export interface DBOpData {
  type?: 'put' | 'del'
  key: Uint8Array | string
  keyEncoding: KeyEncoding
  valueEncoding?: ValueEncoding
  value?: Uint8Array | object
}

// a Database Key is identified by a block hash, a block number, or both
export type DatabaseKey = {
  blockNumber?: bigint
  blockHash?: Uint8Array
}

/**
 * The DBOp class aids creating database operations which is used by `level` using a more high-level interface
 */
export class DBOp {
  public operationTarget: DBTarget
  public baseDBOp: DBOpData
  public cacheString: string | undefined

  private constructor(operationTarget: DBTarget, key?: DatabaseKey) {
    this.operationTarget = operationTarget

    this.baseDBOp = {
      key: '',
      keyEncoding: KeyEncoding.Bytes,
      valueEncoding: ValueEncoding.Bytes,
    }

    switch (operationTarget) {
      case DBTarget.Heads: {
        this.baseDBOp.key = HEADS_KEY
        this.baseDBOp.valueEncoding = ValueEncoding.JSON
        break
      }
      case DBTarget.HeadHeader: {
        this.baseDBOp.key = HEAD_HEADER_KEY
        this.baseDBOp.keyEncoding = KeyEncoding.String
        break
      }
      case DBTarget.HeadBlock: {
        this.baseDBOp.key = HEAD_BLOCK_KEY
        this.baseDBOp.keyEncoding = KeyEncoding.String
        break
      }
      case DBTarget.HashToNumber: {
        this.baseDBOp.key = hashToNumberKey(key!.blockHash!)
        this.cacheString = 'hashToNumber'
        break
      }
      case DBTarget.NumberToHash: {
        this.baseDBOp.key = numberToHashKey(key!.blockNumber!)
        this.cacheString = 'numberToHash'
        break
      }
      case DBTarget.TotalDifficulty: {
        this.baseDBOp.key = tdKey(key!.blockNumber!, key!.blockHash!)
        this.cacheString = 'td'
        break
      }
      case DBTarget.Body: {
        this.baseDBOp.key = bodyKey(key!.blockNumber!, key!.blockHash!)
        this.cacheString = 'body'
        break
      }
      case DBTarget.Header: {
        this.baseDBOp.key = headerKey(key!.blockNumber!, key!.blockHash!)
        this.cacheString = 'header'
        break
      }
    }
  }

  public static get(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
    return new DBOp(operationTarget, key)
  }

  // set operation: note: value/key is not in default order
  public static set(
    operationTarget: DBTarget,
    value: Uint8Array | object,
    key?: DatabaseKey,
  ): DBOp {
    const dbOperation = new DBOp(operationTarget, key)
    dbOperation.baseDBOp.value = value
    dbOperation.baseDBOp.type = 'put'

    if (operationTarget === DBTarget.Heads) {
      dbOperation.baseDBOp.valueEncoding = ValueEncoding.JSON
    } else {
      dbOperation.baseDBOp.valueEncoding = ValueEncoding.Bytes
    }

    return dbOperation
  }

  public static del(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
    const dbOperation = new DBOp(operationTarget, key)
    dbOperation.baseDBOp.type = 'del'
    return dbOperation
  }

  public updateCache(cacheMap: CacheMap) {
    if (this.cacheString !== undefined && cacheMap[this.cacheString] !== undefined) {
      if (this.baseDBOp.type === 'put') {
        this.baseDBOp.value instanceof Uint8Array &&
          cacheMap[this.cacheString].set(this.baseDBOp.key, this.baseDBOp.value)
      } else if (this.baseDBOp.type === 'del') {
        cacheMap[this.cacheString].del(this.baseDBOp.key)
      } else {
        throw EthereumJSErrorWithoutCode('unsupported db operation on cache')
      }
    }
  }
}
