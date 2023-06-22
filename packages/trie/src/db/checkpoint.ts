import { KeyEncoding, ValueEncoding, bytesToHex, hexStringToBytes } from '@ethereumjs/util'
import { hexToBytes } from 'ethereum-cryptography/utils.js'
import { LRUCache } from 'lru-cache'

import type { Checkpoint } from '../types.js'
import type { BatchDBOp, DB, DelBatch, PutBatch } from '@ethereumjs/util'

/**
 * DB is a thin wrapper around the underlying levelup db,
 * which validates inputs and sets encoding type.
 */
export class CheckpointDB implements DB<Uint8Array, Uint8Array> {
  public checkpoints: Checkpoint[]
  public db: DB<string, string>
  public readonly cacheSize: number


  // Starting with lru-cache v8 undefined and null are not allowed any more
  // as cache values. At the same time our design works well, since undefined
  // indicates for us that we know that the value is not present in the
  // underlying trie database as well (so it carries real value).
  //
  // Solution here seems therefore adequate, other solutions would rather
  // be some not so clean workaround.
  //
  // (note that @ts-ignore doesn't work since stripped on declaration (.d.ts) files)
  protected _cache?: LRUCache<string, any>
  // protected _cache?: LRUCache<string, Uint8Array | undefined>

  _stats = {
    cache: {
      reads: 0,
      hits: 0,
      writes: 0,
    },
    db: {
      reads: 0,
      hits: 0,
      writes: 0,
    },
  }

  /**
   * Initialize a DB instance.
   */
  constructor(opts: any) {
    this.db = opts.db
    this.cacheSize = opts.cacheSize ?? 0
    // Roots of trie at the moment of checkpoint
    this.checkpoints = []

    if (this.cacheSize > 0) {
      this._cache = new LRUCache({
        max: this.cacheSize,
        updateAgeOnGet: true,
      })
    }
  }

  /**
   * Flush the checkpoints and use the given checkpoints instead.
   * @param {Checkpoint[]} checkpoints
   */
  setCheckpoints(checkpoints: Checkpoint[]) {
    this.checkpoints = []

    for (let i = 0; i < checkpoints.length; i++) {
      this.checkpoints.push({
        root: checkpoints[i].root,
        keyValueMap: new Map(checkpoints[i].keyValueMap),
      })
    }
  }

  /**
   * Is the DB during a checkpoint phase?
   */
  hasCheckpoints() {
    return this.checkpoints.length > 0
  }

  /**
   * Adds a new checkpoint to the stack
   * @param root
   */
  checkpoint(root: Uint8Array) {
    this.checkpoints.push({ keyValueMap: new Map<string, Uint8Array>(), root })
  }

  /**
   * Commits the latest checkpoint
   */
  async commit() {
    const { keyValueMap } = this.checkpoints.pop()!
    if (!this.hasCheckpoints()) {
      // This was the final checkpoint, we should now commit and flush everything to disk
      const batchOp: BatchDBOp[] = []
      for (const [key, value] of keyValueMap.entries()) {
        if (value === undefined) {
          batchOp.push({
            type: 'del',
            key: hexStringToBytes(key),
          })
        } else {
          batchOp.push({
            type: 'put',
            key: hexStringToBytes(key),
            value: value!,
          })
        }
      }
      await this.batch(batchOp)
    } else {
      // dump everything into the current (higher level) diff cache
      const currentKeyValueMap = this.checkpoints[this.checkpoints.length - 1].keyValueMap
      for (const [key, value] of keyValueMap.entries()) {
        currentKeyValueMap.set(key, value)
      }
    }
  }

  /**
   * Reverts the latest checkpoint
   */
  async revert() {
    const { root } = this.checkpoints.pop()!
    return root
  }

  /**
   * @inheritDoc
   */
  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    const keyHex = bytesToHex(key)
    if (this._cache !== undefined) {
      const value = this._cache.get(keyHex)
      this._stats.cache.reads += 1
      if (value !== undefined) {
        this._stats.cache.hits += 1
        return value
      }
    }

    // Lookup the value in our diff cache. We return the latest checkpointed value (which should be the value on disk)
    for (let index = this.checkpoints.length - 1; index >= 0; index--) {
      if (this.checkpoints[index].keyValueMap.has(keyHex)) {
        return this.checkpoints[index].keyValueMap.get(keyHex) ?? undefined
      }
    }
    // Nothing has been found in diff cache, look up from disk
    const valueHex = await this.db.get(keyHex, {
      keyEncoding: KeyEncoding.String,
      valueEncoding: ValueEncoding.String,
    })
    this._stats.db.reads += 1
    if (valueHex !== undefined) {
      this._stats.db.hits += 1
    }
    const value = valueHex !== undefined ? hexToBytes(valueHex) : undefined
    this._cache?.set(keyHex, value)
    if (this.hasCheckpoints()) {
      // Since we are a checkpoint, put this value in diff cache,
      // so future `get` calls will not look the key up again from disk.
      this.checkpoints[this.checkpoints.length - 1].keyValueMap.set(keyHex, value!)
    }

    return value
  }

  /**
   * @inheritDoc
   */
  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    const keyHex = bytesToHex(key)
    const valueHex = bytesToHex(value)
    if (this.hasCheckpoints()) {
      // put value in diff cache
      this.checkpoints[this.checkpoints.length - 1].keyValueMap.set(keyHex, value)
    } else {
      await this.db.put(keyHex, valueHex, {
        keyEncoding: KeyEncoding.String,
        valueEncoding: ValueEncoding.String,
      })
      this._stats.db.writes += 1

      if (this._cache !== undefined) {
        this._cache.set(keyHex, value)
        this._stats.cache.writes += 1
      }
    }
  }

  /**
   * @inheritDoc
   */
  async del(key: Uint8Array): Promise<void> {
    const keyHex = bytesToHex(key)
    if (this.hasCheckpoints()) {
      // delete the value in the current diff cache
      this.checkpoints[this.checkpoints.length - 1].keyValueMap.set(keyHex, undefined)
    } else {
      // delete the value on disk
      await this.db.del(keyHex, {
        keyEncoding: KeyEncoding.String,
      })
      this._stats.db.writes += 1

      if (this._cache !== undefined) {
        this._cache.set(keyHex, undefined)
        this._stats.cache.writes += 1
      }
    }
  }

  /**
   * @inheritDoc
   */
  async batch(opStack: BatchDBOp[]): Promise<void> {
    if (this.hasCheckpoints()) {
      for (const op of opStack) {
        if (op.type === 'put') {
          await this.put(op.key, op.value)
        } else if (op.type === 'del') {
          await this.del(op.key)
        }
      }
    } else {
      const convertedOps = opStack.map((op) => {
        const convertedOp = {
          key: bytesToHex(op.key),
          value: op.type === 'put' ? bytesToHex(op.value) : undefined,
          type: op.type,
          opts: op.opts,
        }
        if (op.type === 'put') return convertedOp as PutBatch<string, string>
        else return convertedOp as DelBatch<string>
      })
      await this.db.batch(convertedOps)
    }
  }

  stats(reset = true) {
    const stats = { ...this._stats, size: this._cache?.size ?? 0 }
    if (reset) {
      this._stats = {
        cache: {
          reads: 0,
          hits: 0,
          writes: 0,
        },
        db: {
          reads: 0,
          hits: 0,
          writes: 0,
        },
      }
    }
    return stats
  }

  /**
   * @inheritDoc
   */
  shallowCopy(): CheckpointDB {
    return new CheckpointDB({ db: this.db, cacheSize: this.cacheSize })
  }

  open() {
    return Promise.resolve()
  }
}
