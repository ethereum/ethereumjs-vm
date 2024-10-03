import { concatBytes, intToBytes } from '@ethereumjs/util'

import type { Chain } from '../blockchain/index.js'
import type { Config } from '../config.js'
import type { AbstractLevel } from 'abstract-level'

const encodingOpts = { keyEncoding: 'view', valueEncoding: 'view' }

/**
 * Number prepended to the db key to avoid collisions
 * when using the meta db for different data.
 *
 * Only append new items to the bottom of the list to
 * remain backward compat.
 */
export enum DBKey {
  Receipts,
  TxHash,
  SkeletonBlock,
  SkeletonBlockHashToNumber,
  SkeletonStatus,
  SkeletonUnfinalizedBlockByHash,
  Preimage,
}

export interface MetaDBManagerOptions {
  /* Chain */
  chain: Chain

  /* Config */
  config: Config

  /* Meta database (receipts, logs, indexes) */
  metaDB: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
}

/**
 * Helper class to access the metaDB with methods `put`, `get`, and `delete`
 */
export class MetaDBManager {
  protected chain: Chain
  protected config: Config
  private metaDB: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  constructor(options: MetaDBManagerOptions) {
    this.chain = options.chain
    this.config = options.config
    this.metaDB = options.metaDB
  }

  private dbKey(type: DBKey, key: Uint8Array) {
    return concatBytes(intToBytes(type), key)
  }

  async put(type: DBKey, hash: Uint8Array, value: Uint8Array) {
    await this.metaDB.put(this.dbKey(type, hash), value, encodingOpts)
  }

  async get(type: DBKey, hash: Uint8Array): Promise<Uint8Array | null> {
    try {
      return await this.metaDB.get(this.dbKey(type, hash), encodingOpts)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null
      }
      throw Error
    }
  }

  async delete(type: DBKey, hash: Uint8Array) {
    await this.metaDB.del(this.dbKey(type, hash), encodingOpts)
  }
}
