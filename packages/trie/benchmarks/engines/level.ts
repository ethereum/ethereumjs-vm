import { KeyEncoding, ValueEncoding } from '@ethereumjs/util'
import { MemoryLevel } from 'memory-level'

import type { BatchDBOp, DB, DBObject, EncodingOpts } from '@ethereumjs/util'
import type { AbstractLevel } from 'abstract-level'

// Helper to infer the `valueEncoding` option for `putting` a value in a levelDB
const getEncodings = (opts: EncodingOpts = {}) => {
  const encodings = { keyEncoding: '', valueEncoding: '' }
  switch (opts.valueEncoding) {
    case ValueEncoding.String:
      encodings.valueEncoding = 'utf8'
      break
    case ValueEncoding.Bytes:
      encodings.valueEncoding = 'view'
      break
    case ValueEncoding.JSON:
      encodings.valueEncoding = 'json'
      break
    default:
      encodings.valueEncoding = 'view'
  }
  switch (opts.keyEncoding) {
    case KeyEncoding.Bytes:
      encodings.keyEncoding = 'view'
      break
    case KeyEncoding.Number:
    case KeyEncoding.String:
      encodings.keyEncoding = 'utf8'
      break
    default:
      encodings.keyEncoding = 'utf8'
  }

  return encodings
}

/**
 * LevelDB is a thin wrapper around the underlying levelup db,
 * corresponding to the {@link DB}
 */
export class LevelDB<
  TKey extends Uint8Array | string = Uint8Array | string,
  TValue extends Uint8Array | string | DBObject = Uint8Array | string | DBObject,
> implements DB<TKey, TValue>
{
  _leveldb: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>

  /**
   * Initialize a DB instance. If `leveldb` is not provided, DB
   * defaults to an [in-memory store](https://github.com/Level/memdown).
   * @param leveldb - An abstract-leveldown compliant store
   */
  constructor(
    leveldb?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>,
  ) {
    this._leveldb = leveldb ?? new MemoryLevel()
  }

  /**
   * @inheritDoc
   */
  async get(key: TKey, opts?: EncodingOpts): Promise<TValue | undefined> {
    let value
    const encodings = getEncodings(opts)

    try {
      value = await this._leveldb.get(key, encodings)
      if (value === null) return undefined
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
    if (value instanceof Buffer) value = Uint8Array.from(value)
    return value as TValue
  }

  /**
   * @inheritDoc
   */
  async put(key: TKey, val: TValue, opts?: {}): Promise<void> {
    const encodings = getEncodings(opts)
    await this._leveldb.put(key, val, encodings)
  }

  /**
   * @inheritDoc
   */
  async del(key: TKey): Promise<void> {
    await this._leveldb.del(key)
  }

  /**
   * @inheritDoc
   */
  async batch(opStack: BatchDBOp<TKey, TValue>[]): Promise<void> {
    const levelOps: {
      keyEncoding: string
      valueEncoding: string
    }[] = []
    for (const op of opStack) {
      const encodings = getEncodings(op.opts)
      levelOps.push({ ...op, ...encodings })
    }

    // TODO: Investigate why as any is necessary
    await this._leveldb.batch(levelOps as any)
  }

  /**
   * @inheritDoc
   */
  shallowCopy(): DB<TKey, TValue> {
    return new LevelDB<TKey, TValue>(this._leveldb)
  }

  open() {
    return this._leveldb.open()
  }
}
