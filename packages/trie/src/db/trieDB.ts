import {
  KeyEncoding,
  ValueEncoding,
  bytesToPrefixedHexString,
  hexStringToBytes,
} from '@ethereumjs/util'
import { debug } from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { MemoryLevel } from 'memory-level'

import type { HashFunction } from '../types'
import type { DB, EncodingOpts } from '@ethereumjs/util'
import type { AbstractKeyIterator, AbstractLevel } from 'abstract-level'
import type { Debugger } from 'debug'

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
export class TrieDatabase<
  TKey extends Uint8Array = Uint8Array,
  TValue extends Uint8Array = Uint8Array
> implements DB<TKey, TValue>
{
  _leveldb: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
  private readonly debug: Debugger
  keyIterator: () => AbstractKeyIterator<
    AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>,
    string | Uint8Array
  >

  constructor(
    options: {
      db?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
      _debug?: Debugger
    } = {}
  ) {
    this._leveldb = options.db ?? new MemoryLevel()
    this.keyIterator = this._leveldb.keys
    this.debug = options._debug ? options._debug.extend('db') : debug('trie:db')
  }
  stats(): any {}

  async get(
    key: TKey,
    opts?: EncodingOpts,
    debug: Debugger = this.debug
  ): Promise<TValue | undefined> {
    debug = debug.extend('get')
    let value: string | Uint8Array | null
    const encodings = getEncodings(opts)
    const _key = key instanceof Uint8Array ? bytesToPrefixedHexString(key) : key
    debug(`key: ${_key}`)
    try {
      value = await this._leveldb.get(_key, encodings)
      if (value === null) return undefined
      debug(`value: ${value}`)
      debug(`value type: ${typeof value}`)
      debug(`value u8a: ${value instanceof Uint8Array}`)
      if (typeof value === 'string') {
        value = hexStringToBytes(value)
      }
      return value as TValue
    } catch (error: any) {
      debug(`value: ${error.message}`)
      return undefined
    }
  }
  async put(
    key: TKey,
    value: TValue,
    opts?: EncodingOpts,
    debug: Debugger = this.debug
  ): Promise<void> {
    const _key = key instanceof Uint8Array ? bytesToPrefixedHexString(key) : key
    const _value = value instanceof Uint8Array ? bytesToPrefixedHexString(value) : value
    debug = debug.extend('put')
    debug(`key: ${_key}`)
    await this._leveldb.put(_key, _value)
  }
  async del(key: TKey, opts?: EncodingOpts, debug: Debugger = this.debug): Promise<void> {
    const _key = key instanceof Uint8Array ? bytesToPrefixedHexString(key) : key
    debug.extend('del')(_key)

    await this._leveldb.del(_key)
  }
  async batch(
    operations: { type: 'put' | 'del'; key: TKey; value?: TValue }[],
    debug: Debugger = this.debug
  ): Promise<void> {
    debug = debug.extend('batch')
    debug(`operations: ${operations.length}`)
    const batch = this._leveldb.batch()
    for (const [opIdx, op] of operations.entries()) {
      const key = op.key instanceof Uint8Array ? bytesToPrefixedHexString(op.key) : op.key
      const value = op.value instanceof Uint8Array ? bytesToPrefixedHexString(op.value) : op.value
      debug(`${opIdx + 1} / ${operations.length}: --`)
      if (op.type === 'put' && value !== undefined) {
        batch.put(key, value)
      } else {
        batch.del(key)
      }
    }
    await batch.write()
  }
  shallowCopy(): TrieDatabase<TKey, TValue> {
    return new TrieDatabase({ db: this._leveldb, _debug: this.debug })
  }
  async open(): Promise<void> {
    await this._leveldb.open()
    this.debug('DB opened')
  }
  async keys(): Promise<Uint8Array[]> {
    const keys = []
    for await (const key of this._leveldb.keys()) {
      keys.push(key instanceof Uint8Array ? key : hexStringToBytes(key))
    }
    return keys
  }
  async values(): Promise<Uint8Array[]> {
    const values = []
    for await (const value of this._leveldb.values()) {
      values.push(value instanceof Uint8Array ? value : hexStringToBytes(value))
    }
    return values
  }
  async editKeys(callback?: (key: string) => Promise<any>): Promise<any[]> {
    const edits = []
    for await (const key of this._leveldb.keys()) {
      if (callback) {
        edits.push(callback(key instanceof Uint8Array ? bytesToPrefixedHexString(key) : key))
      }
    }
    return Promise.allSettled(edits)
  }
  async close(): Promise<void> {
    await this._leveldb.close()
    this.debug('DB closed')
  }
}

export class ProofDatabase extends TrieDatabase {
  proof: Map<Uint8Array, Uint8Array>
  hash: HashFunction
  constructor(options: {
    proof: Uint8Array[]
    db?: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
    debug?: Debugger
    hashFunction?: HashFunction
  }) {
    super(options)
    this.hash = options.hashFunction ?? keccak256
    this.proof = new Map(options.proof.map((node) => [this.hash(node), node]))
  }
}
