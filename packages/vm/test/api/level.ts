import { MemoryLevel } from 'memory-level'

import type { BatchDBOp, DB } from '@ethereumjs/util'
import type { AbstractLevel } from 'abstract-level'

export const ENCODING_OPTS = { keyEncoding: 'view', valueEncoding: 'view' }

/**
 * LevelDB is a thin wrapper around the underlying levelup db,
 * which validates inputs and sets encoding type.
 */
export class LevelDB implements DB {
  _leveldb: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  /**
   * Initialize a DB instance. If `leveldb` is not provided, DB
   * defaults to an [in-memory store](https://github.com/Level/memdown).
   * @param leveldb - An abstract-leveldown compliant store
   */
  constructor(
    leveldb?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>,
  ) {
    this._leveldb = leveldb ?? new MemoryLevel(ENCODING_OPTS)
  }

  /**
   * @inheritDoc
   */
  // @ts-expect-error
  async get(key: Uint8Array): Promise<Uint8Array | string | undefined> {
    let value
    try {
      value = await this._leveldb.get(key, ENCODING_OPTS)
      if (value === null) return undefined
    } catch (error) {
      // https://github.com/Level/abstract-level/blob/915ad1317694d0ce8c580b5ab85d81e1e78a3137/abstract-level.js#L309
      // This should be `true` if the error came from LevelDB
      // so we can check for `NOT true` to identify any non-404 errors
      if (error.notFound !== true) {
        throw error
      }
    }
    return value
  }

  /**
   * @inheritDoc
   */
  async put(key: Uint8Array, val: Uint8Array): Promise<void> {
    await this._leveldb.put(key, val, ENCODING_OPTS)
  }

  /**
   * @inheritDoc
   */
  async del(key: Uint8Array): Promise<void> {
    await this._leveldb.del(key, ENCODING_OPTS)
  }

  /**
   * @inheritDoc
   */
  async batch(opStack: BatchDBOp[]): Promise<void> {
    await this._leveldb.batch(opStack, ENCODING_OPTS)
  }

  /**
   * @inheritDoc
   */
  shallowCopy(): DB {
    //@ts-expect-error
    return new LevelDB(this._leveldb)
  }

  open() {
    return this._leveldb.open()
  }
}
