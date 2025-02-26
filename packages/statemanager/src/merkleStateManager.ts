import { Common, Mainnet } from '@ethereumjs/common'
import { MerklePatriciaTrie } from '@ethereumjs/mpt'
import { RLP } from '@ethereumjs/rlp'
import {
  Account,
  EthereumJSErrorWithoutCode,
  bytesToUnprefixedHex,
  concatBytes,
  createAccount,
  createAccountFromRLP,
  createAddressFromString,
  equalsBytes,
  hexToBytes,
  short,
  toBytes,
  unpadBytes,
  unprefixedHexToBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { OriginalStorageCache } from './cache/index.js'
import { modifyAccountFields } from './util.js'

import { type MerkleStateManagerOpts } from './index.js'

import type { Caches } from './index.js'
import type {
  AccountFields,
  StateManagerInterface,
  StorageDump,
  StorageRange,
} from '@ethereumjs/common'
import type { Address, DB } from '@ethereumjs/util'
import type { Debugger } from 'debug'

/**
 * Prefix to distinguish between a contract deployed with code `0x80`
 * and `RLP([])` (also having the value `0x80`).
 *
 * Otherwise the creation of the code hash for the `0x80` contract
 * will be the same as the hash of the empty trie which leads to
 * misbehaviour in the underlying trie library.
 */
export const CODEHASH_PREFIX = utf8ToBytes('c')

/**
 * Default StateManager implementation for the VM.
 *
 * The state manager abstracts from the underlying data store
 * by providing higher level access to accounts, contract code
 * and storage slots.
 *
 * The default state manager implementation uses a
 * `@ethereumjs/mpt` trie as a data backend.
 *
 * Note that there is a `SimpleStateManager` dependency-free state
 * manager implementation available shipped with the `@ethereumjs/statemanager`
 * package which might be an alternative to this implementation
 * for many basic use cases.
 */
export class MerkleStateManager implements StateManagerInterface {
  protected _debug: Debugger
  protected _caches?: Caches

  originalStorageCache: OriginalStorageCache

  protected _trie: MerklePatriciaTrie
  protected _storageTries: { [key: string]: MerklePatriciaTrie }

  protected readonly _prefixCodeHashes: boolean
  protected readonly _prefixStorageTrieKeys: boolean

  public readonly common: Common

  protected _checkpointCount: number

  private keccakFunction: Function

  /**
   * StateManager is run in DEBUG mode (default: false)
   * Taken from DEBUG environment variable
   *
   * Safeguards on debug() calls are added for
   * performance reasons to avoid string literal evaluation
   * @hidden
   */
  protected readonly DEBUG: boolean = false

  /**
   * Instantiate the StateManager interface.
   */
  constructor(opts: MerkleStateManagerOpts = {}) {
    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    // Additional window check is to prevent vite browser bundling (and potentially other) to break
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false

    this._debug = debugDefault('statemanager:merkle')

    this.common = opts.common ?? new Common({ chain: Mainnet })

    this._checkpointCount = 0

    this._trie = opts.trie ?? new MerklePatriciaTrie({ useKeyHashing: true, common: this.common })
    this._storageTries = {}

    this.keccakFunction = opts.common?.customCrypto.keccak256 ?? keccak256

    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))

    this._prefixCodeHashes = opts.prefixCodeHashes ?? true
    this._prefixStorageTrieKeys = opts.prefixStorageTrieKeys ?? false

    this._caches = opts.caches
  }

  /**
   * Gets the account associated with `address` or `undefined` if account does not exist
   * @param address - Address of the `account` to get
   */
  async getAccount(address: Address): Promise<Account | undefined> {
    const elem = this._caches?.account?.get(address)
    if (elem !== undefined) {
      return elem.accountRLP !== undefined ? createAccountFromRLP(elem.accountRLP) : undefined
    }

    const rlp = await this._trie.get(address.bytes)
    const account = rlp !== null ? createAccountFromRLP(rlp) : undefined
    if (this.DEBUG) {
      this._debug(`Get account ${address} from DB (${account ? 'exists' : 'non-existent'})`)
    }
    this._caches?.account?.put(address, account)
    return account
  }

  /**
   * Saves an account into state under the provided `address`.
   * @param address - Address under which to store `account`
   * @param account - The account to store or undefined if to be deleted
   */
  async putAccount(address: Address, account: Account | undefined): Promise<void> {
    if (this.DEBUG) {
      this._debug(
        `Save account address=${address} nonce=${account?.nonce} balance=${
          account?.balance
        } contract=${account && account.isContract() ? 'yes' : 'no'} empty=${
          account && account.isEmpty() ? 'yes' : 'no'
        }`,
      )
    }
    if (this._caches?.account === undefined) {
      const trie = this._trie
      if (account !== undefined) {
        await trie.put(address.bytes, account.serialize())
      } else {
        await trie.del(address.bytes)
      }
    } else {
      if (account !== undefined) {
        this._caches.account?.put(address, account)
      } else {
        this._caches.account?.del(address)
      }
    }
  }

  /**
   * Gets the account associated with `address`, modifies the given account
   * fields, then saves the account into state. Account fields can include
   * `nonce`, `balance`, `storageRoot`, and `codeHash`.
   * @param address - Address of the account to modify
   * @param accountFields - Object containing account fields and values to modify
   */
  async modifyAccountFields(address: Address, accountFields: AccountFields): Promise<void> {
    await modifyAccountFields(this, address, accountFields)
  }

  /**
   * Deletes an account from state under the provided `address`.
   * @param address - Address of the account which should be deleted
   */
  async deleteAccount(address: Address) {
    if (this.DEBUG) {
      this._debug(`Delete account ${address}`)
    }

    this._caches?.deleteAccount(address)

    if (this._caches?.account === undefined) {
      await this._trie.del(address.bytes)
    }
  }

  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putCode(address: Address, value: Uint8Array): Promise<void> {
    const codeHash = this.keccakFunction(value)

    if (this._caches?.code !== undefined) {
      this._caches!.code!.put(address, value)
    } else {
      const key = this._prefixCodeHashes ? concatBytes(CODEHASH_PREFIX, codeHash) : codeHash
      await this._getCodeDB().put(key, value)
    }

    if (this.DEBUG) {
      this._debug(`Update codeHash (-> ${short(codeHash)}) for account ${address}`)
    }

    if ((await this.getAccount(address)) === undefined) {
      await this.putAccount(address, new Account())
    }
    await this.modifyAccountFields(address, { codeHash })
  }

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Uint8Array>} -  Resolves with the code corresponding to the provided address.
   * Returns an empty `Uint8Array` if the account has no associated code.
   */
  async getCode(address: Address): Promise<Uint8Array> {
    const elem = this._caches?.code?.get(address)
    if (elem !== undefined) {
      return elem.code ?? new Uint8Array(0)
    }
    const account = await this.getAccount(address)
    if (!account) {
      return new Uint8Array(0)
    }
    if (!account.isContract()) {
      return new Uint8Array(0)
    }
    const key = this._prefixCodeHashes
      ? concatBytes(CODEHASH_PREFIX, account.codeHash)
      : account.codeHash
    const code = (await this._trie.database().get(key)) ?? new Uint8Array(0)

    this._caches?.code?.put(address, code)
    return code
  }

  async getCodeSize(address: Address): Promise<number> {
    const contractCode = await this.getCode(address)
    return contractCode.length
  }

  /**
   * Gets the storage trie for the EVM-internal account identified by the provided address/hash.
   * If the storage trie is not in the local cache ('this._storageTries'),
   *   generates a new storage trie object based on a lookup (shallow copy from 'this._trie'),
   *   applies the storage root of the provided rootAccount (or an
   *   empty trie root if no rootAccount is provided), and stores the new entry
   *   in the local cache.
   * @param addressOrHash Address (or other object) with populated 'bytes', or a raw Uint8Array.
   *   Used to identify the requested storage trie in the local cache and define the
   *   prefix used when creating a new storage trie.
   * @param  rootAccount (Optional) Account object whose 'storageRoot' is to be used as
   *   the root of the new storageTrie returned when there is no pre-existing trie.
   *   If left undefined, the EMPTY_TRIE_ROOT will be used as the root instead.
   * @returns storage MerklePatriciaTrie object
   * @private
   */
  // TODO PR: have a better interface for hashed address pull?
  protected _getStorageTrie(
    addressOrHash: Address | { bytes: Uint8Array } | Uint8Array,
    rootAccount?: Account,
  ): MerklePatriciaTrie {
    // use hashed key for lookup from storage cache
    const addressBytes: Uint8Array =
      addressOrHash instanceof Uint8Array ? addressOrHash : this.keccakFunction(addressOrHash.bytes)
    const addressHex: string = bytesToUnprefixedHex(addressBytes)
    let storageTrie = this._storageTries[addressHex]
    if (storageTrie === undefined) {
      const keyPrefix = this._prefixStorageTrieKeys ? addressBytes.slice(0, 7) : undefined
      storageTrie = this._trie.shallowCopy(false, { keyPrefix })
      if (rootAccount !== undefined) {
        storageTrie.root(rootAccount.storageRoot)
      } else {
        storageTrie.root(storageTrie.EMPTY_TRIE_ROOT)
      }
      storageTrie.flushCheckpoints()
      this._storageTries[addressHex] = storageTrie
    }
    return storageTrie
  }

  /**
   * Gets the storage trie for an account from the storage
   * cache or does a lookup.
   * @private
   */
  protected _getAccountTrie(): MerklePatriciaTrie {
    return this._trie
  }

  /**
   * Gets the storage trie for an account from the storage
   * cache or does a lookup.
   * @private
   */
  protected _getCodeDB(): DB {
    return this._trie.database()
  }

  /**
   * Gets the storage value associated with the provided `address` and `key`. This method returns
   * the shortest representation of the stored value.
   * @param address -  Address of the account to get the storage for
   * @param key - Key in the account's storage to get the value for. Must be 32 bytes long.
   * @returns - The storage value for the account
   * corresponding to the provided address at the provided key.
   * If this does not exist an empty `Uint8Array` is returned.
   */
  async getStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    if (key.length !== 32) {
      throw EthereumJSErrorWithoutCode('Storage key must be 32 bytes long')
    }
    const cachedValue = this._caches?.storage?.get(address, key)
    if (cachedValue !== undefined) {
      const decoded = RLP.decode(cachedValue ?? new Uint8Array(0)) as Uint8Array
      return decoded
    }

    const account = await this.getAccount(address)
    if (!account) {
      return new Uint8Array()
    }
    const trie = this._getStorageTrie(address, account)
    const value = await trie.get(key)
    this._caches?.storage?.put(address, key, value ?? hexToBytes('0x80'))
    const decoded = RLP.decode(value ?? new Uint8Array(0)) as Uint8Array
    return decoded
  }

  /**
   * Modifies the storage trie of an account.
   * @private
   * @param address -  Address of the account whose storage is to be modified
   * @param modifyTrie - Function to modify the storage trie of the account
   */
  protected async _modifyContractStorage(
    address: Address,
    account: Account,
    modifyTrie: (storageTrie: MerklePatriciaTrie, done: Function) => void,
  ): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve) => {
      const storageTrie = this._getStorageTrie(address, account)

      modifyTrie(storageTrie, async () => {
        // update storage cache
        const addressHex = bytesToUnprefixedHex(address.bytes)
        this._storageTries[addressHex] = storageTrie

        // update contract storageRoot
        account.storageRoot = storageTrie.root()
        await this.putAccount(address, account)
        resolve()
      })
    })
  }

  protected async _writeContractStorage(
    address: Address,
    account: Account,
    key: Uint8Array,
    value: Uint8Array,
  ) {
    await this._modifyContractStorage(address, account, async (storageTrie, done) => {
      if (value instanceof Uint8Array && value.length) {
        // format input
        const encodedValue = RLP.encode(value)
        if (this.DEBUG) {
          this._debug(`Update contract storage for account ${address} to ${short(value)}`)
        }
        await storageTrie.put(key, encodedValue)
      } else {
        // deleting a value
        if (this.DEBUG) {
          this._debug(`Delete contract storage for account`)
        }
        await storageTrie.del(key)
      }
      done()
    })
  }

  /**
   * Adds value to the state trie for the `account`
   * corresponding to `address` at the provided `key`.
   * @param address -  Address to set a storage value for
   * @param key - Key to set the value at. Must be 32 bytes long.
   * @param value - Value to set at `key` for account corresponding to `address`.
   * Cannot be more than 32 bytes. Leading zeros are stripped.
   * If it is a empty or filled with zeros, deletes the value.
   */
  async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    if (key.length !== 32) {
      throw EthereumJSErrorWithoutCode('Storage key must be 32 bytes long')
    }

    if (value.length > 32) {
      throw EthereumJSErrorWithoutCode('Storage value cannot be longer than 32 bytes')
    }

    const account = await this.getAccount(address)
    if (!account) {
      throw EthereumJSErrorWithoutCode('putStorage() called on non-existing account')
    }

    value = unpadBytes(value)
    this._caches?.storage?.put(address, key, RLP.encode(value)) ??
      (await this._writeContractStorage(address, account, key, value))
  }

  /**
   * Clears all storage entries for the account corresponding to `address`.
   * @param address - Address to clear the storage of
   */
  async clearStorage(address: Address): Promise<void> {
    let account = await this.getAccount(address)
    if (!account) {
      account = new Account()
    }
    this._caches?.storage?.clearStorage(address)
    await this._modifyContractStorage(address, account, (storageTrie, done) => {
      storageTrie.root(storageTrie.EMPTY_TRIE_ROOT)
      done()
    })
  }

  /**
   * Checkpoints the current state of the StateManager instance.
   * State changes that follow can then be committed by calling
   * `commit` or `reverted` by calling rollback.
   */
  async checkpoint(): Promise<void> {
    this._trie.checkpoint()
    this._caches?.checkpoint()
    this._checkpointCount++
  }

  /**
   * Commits the current change-set to the instance since the
   * last call to checkpoint.
   */
  async commit(): Promise<void> {
    // setup trie checkpointing
    await this._trie.commit()
    this._caches?.commit()
    this._checkpointCount--

    if (this._checkpointCount === 0) {
      await this.flush()
      this.originalStorageCache.clear()
    }

    if (this.DEBUG) {
      this._debug(`state checkpoint committed`)
    }
  }

  /**
   * Reverts the current change-set to the instance since the
   * last call to checkpoint.
   */
  async revert(): Promise<void> {
    // setup trie checkpointing
    await this._trie.revert()
    this._caches?.revert()

    this._storageTries = {}

    this._checkpointCount--

    if (this._checkpointCount === 0) {
      await this.flush()
      this.originalStorageCache.clear()
    }
  }

  /**
   * Writes all cache items to the trie
   */
  async flush(): Promise<void> {
    const codeItems = this._caches?.code?.flush() ?? []
    for (const item of codeItems) {
      const addr = createAddressFromString(`0x${item[0]}`)

      const code = item[1].code
      if (code === undefined) {
        continue
      }

      // update code in database
      const codeHash = this.keccakFunction(code)
      const key = this._prefixCodeHashes ? concatBytes(CODEHASH_PREFIX, codeHash) : codeHash
      await this._getCodeDB().put(key, code)

      // update code root of associated account
      if ((await this.getAccount(addr)) === undefined) {
        await this.putAccount(addr, new Account())
      }
      await this.modifyAccountFields(addr, { codeHash })
    }
    const storageItems = this._caches?.storage?.flush() ?? []
    for (const item of storageItems) {
      const address = createAddressFromString(`0x${item[0]}`)
      const keyHex = item[1]
      const keyBytes = unprefixedHexToBytes(keyHex)
      const value = item[2]

      const decoded = RLP.decode(value ?? new Uint8Array(0)) as Uint8Array
      const account = await this.getAccount(address)
      if (account) {
        await this._writeContractStorage(address, account, keyBytes, decoded)
      }
    }

    const accountItems = this._caches?.account?.flush() ?? []
    for (const item of accountItems) {
      const addressHex = item[0]
      const addressBytes = unprefixedHexToBytes(addressHex)
      const elem = item[1]
      if (elem.accountRLP === undefined) {
        const trie = this._trie
        await trie.del(addressBytes)
      } else {
        const trie = this._trie
        await trie.put(addressBytes, elem.accountRLP)
      }
    }
  }

  /**
   * Gets the state-root of the Merkle-Patricia trie representation
   * of the state of this StateManager. Will error if there are uncommitted
   * checkpoints on the instance.
   * @returns {Promise<Uint8Array>} - Returns the state-root of the `StateManager`
   */
  async getStateRoot(): Promise<Uint8Array> {
    await this.flush()
    return this._trie.root()
  }

  /**
   * Sets the state of the instance to that represented
   * by the provided `stateRoot`. Will error if there are uncommitted
   * checkpoints on the instance or if the state root does not exist in
   * the state trie.
   * @param stateRoot - The state-root to reset the instance to
   */
  async setStateRoot(stateRoot: Uint8Array, clearCache: boolean = true): Promise<void> {
    await this.flush()

    if (!equalsBytes(stateRoot, this._trie.EMPTY_TRIE_ROOT)) {
      const hasRoot = await this._trie.checkRoot(stateRoot)
      if (!hasRoot) {
        throw EthereumJSErrorWithoutCode('State trie does not contain state root')
      }
    }

    this._trie.root(stateRoot)
    if (clearCache) {
      this._caches?.clear()
    }
    this._storageTries = {}
  }

  /**
   * Dumps the RLP-encoded storage values for an `account` specified by `address`.
   * @param address - The address of the `account` to return storage for
   * @returns {Promise<StorageDump>} - The state of the account as an `Object` map.
   * Keys are are the storage keys, values are the storage values as strings.
   * Both are represented as hex strings without the `0x` prefix.
   */
  async dumpStorage(address: Address): Promise<StorageDump> {
    await this.flush()
    const account = await this.getAccount(address)
    if (!account) {
      throw EthereumJSErrorWithoutCode(`dumpStorage f() can only be called for an existing account`)
    }
    const trie = this._getStorageTrie(address, account)

    return trie.getValueMap().then((value) => {
      return value.values
    })
  }

  /**
   Dumps a limited number of RLP-encoded storage values for an account specified by `address`,
   starting from `startKey` or greater.
   @param address - The address of the `account` to return storage for.
   @param startKey - The bigint representation of the smallest storage key that will be returned.
   @param limit - The maximum number of storage values that will be returned.
   @returns {Promise<StorageRange>} - A {@link StorageRange} object that will contain at most `limit` entries in its `storage` field.
   The object will also contain `nextKey`, the next (hashed) storage key after the range included in `storage`.
   */
  async dumpStorageRange(address: Address, startKey: bigint, limit: number): Promise<StorageRange> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw EthereumJSErrorWithoutCode(`Limit is not a proper uint.`)
    }

    await this.flush()
    const account = await this.getAccount(address)
    if (!account) {
      throw EthereumJSErrorWithoutCode(`Account does not exist.`)
    }

    const trie = this._getStorageTrie(address, account)

    return trie.getValueMap(startKey, limit).then((value) => {
      const values = value.values
      const dump = Object.create(null)
      for (const key of Object.keys(values)) {
        const val = values[key]
        dump[key] = {
          key: null,
          value: val,
        }
      }

      return {
        storage: dump,
        nextKey: value.nextKey,
      }
    })
  }

  /**
   * Initializes the provided genesis state into the state trie.
   * Will error if there are uncommitted checkpoints on the instance.
   * @param initState address -> balance | [balance, code, storage]
   */
  async generateCanonicalGenesis(initState: any): Promise<void> {
    if (this._checkpointCount !== 0) {
      throw EthereumJSErrorWithoutCode('Cannot create genesis state with uncommitted checkpoints')
    }
    if (this.DEBUG) {
      this._debug(`Save genesis state into the state trie`)
    }
    const addresses = Object.keys(initState)
    for (const address of addresses) {
      const addr = createAddressFromString(address)
      const state = initState[address]
      if (!Array.isArray(state)) {
        // Prior format: address -> balance
        const account = createAccount({ balance: state })
        await this.putAccount(addr, account)
      } else {
        // New format: address -> [balance, code, storage]
        const [balance, code, storage, nonce] = state
        const account = createAccount({ balance, nonce })
        await this.putAccount(addr, account)
        if (code !== undefined) {
          await this.putCode(addr, toBytes(code))
        }
        if (storage !== undefined) {
          for (const [key, value] of storage) {
            await this.putStorage(addr, toBytes(key), toBytes(value))
          }
        }
      }
    }
    await this.flush()
  }

  /**
   * Checks whether there is a state corresponding to a stateRoot
   */
  async hasStateRoot(root: Uint8Array): Promise<boolean> {
    return this._trie.checkRoot(root)
  }

  /**
   * Copies the current instance of the `StateManager`
   * at the last fully committed point, i.e. as if all current
   * checkpoints were reverted.
   *
   * Caches are downleveled (so: adopted for short-term usage)
   * by default.
   *
   * This means in particular:
   * 1. For caches instantiated as an LRU cache type
   * the copy() method will instantiate with an ORDERED_MAP cache
   * instead, since copied instances are mostly used in
   * short-term usage contexts and LRU cache instantiation would create
   * a large overhead here.
   * 2. The underlying trie object is initialized with 0 cache size
   *
   * Both adoptions can be deactivated by setting `downlevelCaches` to
   * `false`.
   *
   * Cache values are generally not copied along regardless of the
   * `downlevelCaches` setting.
   */
  shallowCopy(downlevelCaches = true): MerkleStateManager {
    const common = this.common.copy()
    common.setHardfork(this.common.hardfork())

    const cacheSize = !downlevelCaches ? this._trie['_opts']['cacheSize'] : 0
    const trie = this._trie.shallowCopy(false, { cacheSize })
    const prefixCodeHashes = this._prefixCodeHashes
    const prefixStorageTrieKeys = this._prefixStorageTrieKeys

    return new MerkleStateManager({
      common,
      trie,
      prefixStorageTrieKeys,
      prefixCodeHashes,
      caches: this._caches?.shallowCopy(downlevelCaches),
    })
  }

  /**
   * Clears all underlying caches
   */
  clearCaches() {
    this._caches?.clear()
  }

  /**
   * Returns the applied key for a given address
   * Used for saving preimages
   * @param address - The address to return the applied key
   * @returns {Uint8Array} - The applied key (e.g. hashed address)
   */
  getAppliedKey(address: Uint8Array): Uint8Array {
    return this._trie['appliedKey'](address)
  }
}
