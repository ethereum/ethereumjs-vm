import { Mainnet, Common } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { Trie, merkleizeList, createMerkleProof, verifyTrieProof } from '@ethereumjs/trie'
import {
  Account,
  KECCAK256_NULL,
  KECCAK256_NULL_S,
  KECCAK256_RLP,
  KECCAK256_RLP_S,
  createAccountFromRLP,
  bigIntToHex,
  bytesToHex,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
  unpadBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'

import { OriginalStorageCache } from '../cache/originalStorageCache.js'

import { ACCOUNT_PREFIX, STORAGE_PREFIX, Snapshot } from './snapshot.js'

import type { Proof } from '../index.js'
import type {
  AccountFields,
  StateManagerInterface,
  StorageDump,
  StorageProof,
  StorageRange,
} from '@ethereumjs/common'
import type { Address, PrefixedHexString } from '@ethereumjs/util'
import type { Debugger } from 'debug'

const { debug: createDebugLogger } = debugDefault

/**
 * Options for constructing a {@link StateManager}.
 */
export interface FlatStateManagerOpts {
  snapshot?: Snapshot

  /**
   * The common to use
   */
  common?: Common
}

/**
 * Default StateManager implementation for the VM.
 *
 * The state manager abstracts from the underlying data store
 * by providing higher level access to accounts, contract code
 * and storage slots.
 *
 * The default state manager implementation uses a
 * `@ethereumjs/trie` trie as a data backend.
 */
export class FlatStateManager implements StateManagerInterface {
  protected _debug: Debugger
  // protected _accountCache?: AccountCache
  // protected _storageCache?: StorageCache
  // protected _codeCache?: CodeCache

  originalStorageCache: OriginalStorageCache

  // protected readonly _accountCacheSettings: CacheSettings
  // protected readonly _storageCacheSettings: CacheSettings
  // protected readonly _codeCacheSettings: CacheSettings

  public readonly common: Common

  protected _checkpointCount: number

  /**
   * StateManager is run in DEBUG mode (default: false)
   * Taken from DEBUG environment variable
   *
   * Safeguards on debug() calls are added for
   * performance reasons to avoid string literal evaluation
   * @hidden
   */
  protected readonly DEBUG: boolean = false

  _snapshot: Snapshot

  /**
   * Instantiate the StateManager interface.
   */
  constructor(opts: FlatStateManagerOpts = {}) {
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false

    this._debug = createDebugLogger('statemanager:statemanager')

    this.common = opts.common ?? new Common({ chain: Mainnet })

    this._snapshot = opts.snapshot ?? new Snapshot()

    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))

    this._checkpointCount = 0
  }

  /**
   * Gets the account associated with `address` or `undefined` if account does not exist
   * @param address - Address of the `account` to get
   */
  async getAccount(address: Address): Promise<Account | undefined> {
    const res = await this._snapshot.getAccount(address)
    const account = res ? createAccountFromRLP(res) : undefined
    return account
  }

  /**
   * Saves an account into state under the provided `address`.
   * @param address - Address under which to store `account`
   * @param account - The account to store or undefined if to be deleted
   */
  async putAccount(address: Address, account: Account | undefined): Promise<void> {
    if (account === undefined) {
      await this._snapshot.delAccount(address)
    } else {
      await this._snapshot.putAccount(address, account)
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
    let account = await this.getAccount(address)
    if (!account) {
      account = new Account()
    }
    account.nonce = accountFields.nonce ?? account.nonce
    account.balance = accountFields.balance ?? account.balance
    account.storageRoot = accountFields.storageRoot ?? account.storageRoot
    account.codeHash = accountFields.codeHash ?? account.codeHash
    await this.putAccount(address, account)
  }

  /**
   * Deletes an account from state under the provided `address`.
   * @param address - Address of the account which should be deleted
   */
  async deleteAccount(address: Address) {
    await this._snapshot.delAccount(address)
  }

  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this. If account does not exist, a
   * new account will be created.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putCode(address: Address, value: Uint8Array): Promise<void> {
    if ((await this.getAccount(address)) === undefined) {
      await this.putAccount(address, new Account())
    }
    await this._snapshot.putCode(address, value)
  }

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Uint8Array>} -  Resolves with the code corresponding to the provided address.
   * Returns an empty `Uint8Array` if the account has no associated code.
   */
  async getCode(address: Address): Promise<Uint8Array> {
    const code = (await this._snapshot.getCode(address)) ?? new Uint8Array(0)
    return code
  }

  async getCodeSize(address: Address): Promise<number> {
    const code = (await this._snapshot.getCode(address)) ?? new Uint8Array(0)
    return code.length
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
      throw new Error('Storage key must be 32 bytes long')
    }

    const value = await this._snapshot.getStorageSlot(address, key)
    if (!value) return new Uint8Array(0)

    const decoded = RLP.decode(value ?? new Uint8Array(0)) as Uint8Array
    return decoded
  }

  removeStorageSlotKeyPrefix(leaf: Uint8Array[]) {
    leaf[0] = leaf[0].slice(STORAGE_PREFIX.length + 32)
    return leaf
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
      throw new Error('Storage key must be 32 bytes long')
    }

    if (value.length > 32) {
      throw new Error('Storage value cannot be longer than 32 bytes')
    }

    const account = await this.getAccount(address)
    if (!account) {
      throw new Error('putContractStorage() called on non-existing account')
    }

    value = unpadBytes(value)
    if (value instanceof Uint8Array && value.length) {
      const encodedValue = RLP.encode(value)
      await this._snapshot.putStorageSlot(address, key, encodedValue)
    } else {
      await this._snapshot.delStorageSlot(address, key)
    }

    const slots = (await this._snapshot.getStorageSlots(address)) as Uint8Array[][]

    // remove any prefixes from keys to ensure raw keys are being used for root calcuation
    slots.map((leaf) => {
      this.removeStorageSlotKeyPrefix(leaf)
    })

    // update contract storageRoot
    account.storageRoot = merkleizeList(slots) // TODO merkleizing like this is an expensive operation - see if it's possible to use a trie for updating roots

    await this.putAccount(address, account)
  }

  /**
   * Clears all storage entries for the account corresponding to `address`.
   * @param address - Address to clear the storage of
   */
  async clearStorage(address: Address): Promise<void> {
    return this._snapshot.clearAccountStorage(address)
  }

  /**
   * Checkpoints the current state of the StateManager instance.
   * State changes that follow can then be committed by calling
   * `commit` or `reverted` by calling rollback.
   */
  async checkpoint(): Promise<void> {
    this._snapshot.checkpoint()
    this._checkpointCount++
  }

  /**
   * Commits the current change-set to the instance since the
   * last call to checkpoint.
   */
  async commit(): Promise<void> {
    await this._snapshot.commit()
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
    await this._snapshot.revert()

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
    // currently, not using any caches, and so flush doesn't do anything
    return
  }

  /**
   * Get an EIP-1186 proof
   * @param address address to get proof of
   * @param storageSlots storage slots to get proof of
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getProof(address: Address, storageSlots: Uint8Array[] = []): Promise<Proof> {
    // TODO currenlty, just use a trie to produce proofs, and later implement proofs on stackTries similar to tries to optimize this
    await this.flush()

    // generate trie from all accounts to help with proof generation
    const accountTrie = new Trie({ useKeyHashing: true, common: this.common })

    const accounts = await this._snapshot._getAccounts()
    await Promise.all(
      accounts.map(async ([key, value]) => {
        const accountKey = key.slice(ACCOUNT_PREFIX.length)
        await accountTrie.put(accountKey, value ?? KECCAK256_NULL, true)
      }),
    )

    const account = await this.getAccount(address)
    if (!account) {
      const returnValue: Proof = {
        address: address.toString(),
        balance: '0x0',
        codeHash: KECCAK256_NULL_S,
        nonce: '0x0',
        storageHash: KECCAK256_RLP_S,
        accountProof: (await createMerkleProof(accountTrie, address.bytes)).map((p) =>
          bytesToHex(p),
        ),
        storageProof: [],
      }
      return returnValue
    }
    const accountProof: PrefixedHexString[] = (
      await createMerkleProof(accountTrie, address.bytes)
    ).map((p) => bytesToHex(p))

    const storageProof: StorageProof[] = []
    const storageTrie = new Trie({ useKeyHashing: true, common: this.common })

    const slots = await this._snapshot.getStorageSlots(address)
    await Promise.all(
      slots.map(async ([key, value]) => {
        const storageKey = key.slice(-32)
        await storageTrie.put(storageKey, RLP.encode(value) ?? KECCAK256_RLP, true)
      }),
    )

    for (const storageKey of storageSlots) {
      const proof = (await createMerkleProof(storageTrie, storageKey)).map((p) => bytesToHex(p))
      const value = bytesToHex(await this.getStorage(address, storageKey))
      const proofItem: StorageProof = {
        key: bytesToHex(storageKey),
        value: value === '0x' ? '0x0' : value, // Return '0x' values as '0x0' since this is a JSON RPC response
        proof,
      }
      storageProof.push(proofItem)
    }

    const returnValue: Proof = {
      address: address.toString(),
      balance: bigIntToHex(account.balance),
      codeHash: bytesToHex(account.codeHash),
      nonce: bigIntToHex(account.nonce),
      storageHash: bytesToHex(account.storageRoot),
      accountProof,
      storageProof,
    }
    return returnValue
  }

  /**
   * Verify an EIP-1186 proof. Throws if proof is invalid, otherwise returns true.
   * @param proof the proof to prove
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyProof(proof: Proof): Promise<boolean> {
    // TODO make the verifyProof implementation in the DSM static and just reuse it here
    const key = hexToBytes(proof.address)
    const accountProof = proof.accountProof.map((rlpString: PrefixedHexString) =>
      hexToBytes(rlpString),
    )

    // This returns the account if the proof is valid.
    // Verify that it matches the reported account.
    const value = await verifyTrieProof(key, accountProof, {
      useKeyHashing: true,
    })

    if (value === null) {
      // Verify that the account is empty in the proof.
      const emptyBytes = new Uint8Array(0)
      const notEmptyErrorMsg = 'Invalid proof provided: account is not empty'
      const nonce = unpadBytes(hexToBytes(proof.nonce))
      if (!equalsBytes(nonce, emptyBytes)) {
        throw new Error(`${notEmptyErrorMsg} (nonce is not zero)`)
      }
      const balance = unpadBytes(hexToBytes(proof.balance))
      if (!equalsBytes(balance, emptyBytes)) {
        throw new Error(`${notEmptyErrorMsg} (balance is not zero)`)
      }
      const storageHash = hexToBytes(proof.storageHash)
      if (!equalsBytes(storageHash, KECCAK256_RLP)) {
        throw new Error(`${notEmptyErrorMsg} (storageHash does not equal KECCAK256_RLP)`)
      }
      const codeHash = hexToBytes(proof.codeHash)
      if (!equalsBytes(codeHash, KECCAK256_NULL)) {
        throw new Error(`${notEmptyErrorMsg} (codeHash does not equal KECCAK256_NULL)`)
      }
    } else {
      const account = createAccountFromRLP(value)
      const { nonce, balance, storageRoot, codeHash } = account
      const invalidErrorMsg = 'Invalid proof provided:'
      if (nonce !== BigInt(proof.nonce)) {
        throw new Error(`${invalidErrorMsg} nonce does not match`)
      }
      if (balance !== BigInt(proof.balance)) {
        throw new Error(`${invalidErrorMsg} balance does not match`)
      }
      if (!equalsBytes(storageRoot, hexToBytes(proof.storageHash))) {
        throw new Error(`${invalidErrorMsg} storageHash does not match`)
      }
      if (!equalsBytes(codeHash, hexToBytes(proof.codeHash))) {
        throw new Error(`${invalidErrorMsg} codeHash does not match`)
      }
    }

    for (const stProof of proof.storageProof) {
      const storageProof = stProof.proof.map((value: PrefixedHexString) => hexToBytes(value))
      const storageValue = setLengthLeft(hexToBytes(stProof.value), 32)
      const storageKey = hexToBytes(stProof.key)
      const proofValue = await verifyTrieProof(storageKey, storageProof, {
        useKeyHashing: true,
      })
      const reportedValue = setLengthLeft(
        RLP.decode(proofValue ?? new Uint8Array(0)) as Uint8Array,
        32,
      )
      if (!equalsBytes(reportedValue, storageValue)) {
        throw new Error(
          `Reported trie value does not match storage, key: ${stProof.key}, reported: ${bytesToHex(
            reportedValue,
          )}, actual: ${bytesToHex(storageValue)}`,
        )
      }
    }
    return true
  }

  /**
   * Gets the state-root of the Merkle-Patricia trie representation
   * of the state of this StateManager. Will error if there are uncommitted
   * checkpoints on the instance.
   * @returns {Promise<Uint8Array>} - Returns the state-root of the `StateManager`
   */
  async getStateRoot(checkpointStateRoot = false): Promise<Uint8Array> {
    await this.flush()
    return this._snapshot.merkleize(checkpointStateRoot)
  }

  /**
   * Sets the state of the instance to that represented
   * by the provided `stateRoot`. Will error if there are uncommitted
   * checkpoints on the instance or if the state root does not exist in
   * the state trie.
   * @param stateRoot - The state-root to reset the instance to
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setStateRoot(stateRoot: Uint8Array, clearCache: boolean = true): Promise<void> {
    // potentially don't need setStateRoot and can stub it out like in ethersStateManager
    //
    // can keep the supported state roots of the last n blocks in a set to check if root is valid and supported
    // then can set a class field
    await this._snapshot.setStateRoot(stateRoot)
  }

  /**
   * Dumps the RLP-encoded storage values for an `account` specified by `address`.
   * @param address - The address of the `account` to return storage for
   * @returns {Promise<StorageDump>} - The state of the account as an `Object` map.
   * Keys are are the storage keys, values are the storage values as strings.
   * Both are represented as hex strings without the `0x` prefix.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async dumpStorage(address: Address): Promise<StorageDump> {
    // TODO the "Both are represented as hex strings without the `0x` prefix." is untrue
    await this.flush()
    const account = await this.getAccount(address)
    if (!account) {
      throw new Error(`dumpStorage f() can only be called for an existing account`)
    }
    const slots = await this._snapshot.getStorageSlots(address)

    return new Promise((resolve, _) => {
      const storage: StorageDump = {}
      for (const s of slots) {
        // TODO we are slicing by 64 to remove key prefix... this should be handled inside of the snapshot implementation
        storage['0x' + bytesToHex(s[0]).slice(-64)] =
          s[1] !== undefined ? bytesToHex(s[1]) : KECCAK256_RLP_S
      }
      resolve(storage)
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async dumpStorageRange(address: Address, startKey: bigint, limit: number): Promise<StorageRange> {
    throw new Error('Not yet implemented')
  }

  /**
   * Initializes the provided genesis state into the state trie.
   * Will error if there are uncommitted checkpoints on the instance.
   * @param initState address -> balance | [balance, code, storage]
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generateCanonicalGenesis(initState: any): Promise<void> {
    throw new Error('Not yet implemented')
  }

  /**
   * Checks whether there is a state corresponding to a stateRoot
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async hasStateRoot(root: Uint8Array): Promise<boolean> {
    throw new Error('Not yet implemented')
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
   * instead, since copied instantances are mostly used in
   * short-term usage contexts and LRU cache instantation would create
   * a large overhead here.
   * 2. The underlying trie object is initialized with 0 cache size
   *
   * Both adoptions can be deactivated by setting `downlevelCaches` to
   * `false`.
   *
   * Cache values are generally not copied along regardless of the
   * `downlevelCaches` setting.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shallowCopy(downlevelCaches: boolean = true): FlatStateManager {
    const common = this.common.copy()
    common.setHardfork(this.common.hardfork())

    const snapshot = new Snapshot(this._snapshot._db)

    return new FlatStateManager({
      common,
      snapshot,
    })
  }

  /**
   * Clears all underlying caches
   */
  clearCaches() {
    // currently, not using any caches, and so clearCaches doesn't do anything
    return
  }
}
