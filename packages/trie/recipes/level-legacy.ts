import level from 'level-mem'

import type { BatchDBOp, DB } from '@ethereumjs/util'
import type { LevelUp } from 'levelup'

const ENCODING_OPTS = { keyEncoding: 'view', valueEncoding: 'view' }

export class LevelDB implements DB {
  readonly _leveldb: LevelUp

  constructor(leveldb?: LevelUp | null) {
    this._leveldb = leveldb ?? level()
  }

  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    let value
    try {
      value = await this._leveldb.get(key, ENCODING_OPTS)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      // https://github.com/Level/abstract-level/blob/915ad1317694d0ce8c580b5ab85d81e1e78a3137/abstract-level.js#L309
      // This should be `true` if the error came from LevelDB
      // so we can check for `NOT true` to identify any non-404 errors
      if (error.notFound !== true) {
        throw error
      }
    }
    return value
  }

  async put(key: Uint8Array, val: Uint8Array): Promise<void> {
    await this._leveldb.put(key, val, ENCODING_OPTS)
  }

  async del(key: Uint8Array): Promise<void> {
    await this._leveldb.del(key, ENCODING_OPTS)
  }

  async batch(opStack: BatchDBOp[]): Promise<void> {
    await this._leveldb.batch(opStack, ENCODING_OPTS)
  }

  shallowCopy(): DB {
    return new LevelDB(this._leveldb)
  }

  open() {
    return Promise.resolve()
  }
}
