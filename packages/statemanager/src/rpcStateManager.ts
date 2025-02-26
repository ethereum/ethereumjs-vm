import { Common, Mainnet } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  Account,
  EthereumJSErrorWithoutCode,
  bigIntToHex,
  bytesToHex,
  createAccount,
  createAccountFromRLP,
  equalsBytes,
  fetchFromProvider,
  hexToBytes,
  intToHex,
  toBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { Caches, OriginalStorageCache } from './cache/index.js'
import { modifyAccountFields } from './util.js'

import type { RPCStateManagerOpts } from './index.js'
import type { AccountFields, StateManagerInterface, StorageDump } from '@ethereumjs/common'
import type { Address } from '@ethereumjs/util'
import type { Debugger } from 'debug'

const KECCAK256_RLP_EMPTY_ACCOUNT = RLP.encode(new Account().serialize()).slice(2)

export class RPCStateManager implements StateManagerInterface {
  protected _provider: string
  protected _caches: Caches
  protected _blockTag: string
  originalStorageCache: OriginalStorageCache
  protected _debug: Debugger
  protected DEBUG: boolean
  private keccakFunction: Function
  public readonly common: Common

  constructor(opts: RPCStateManagerOpts) {
    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    // Additional window check is to prevent vite browser bundling (and potentially other) to break
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false

    this._debug = debugDefault('statemanager:rpc')
    if (typeof opts.provider === 'string' && opts.provider.startsWith('http')) {
      this._provider = opts.provider
    } else {
      throw EthereumJSErrorWithoutCode(`valid RPC provider url required; got ${opts.provider}`)
    }

    this._blockTag = opts.blockTag === 'earliest' ? opts.blockTag : bigIntToHex(opts.blockTag)

    this._caches = new Caches({ storage: { size: 100000 }, code: { size: 100000 } })

    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))
    this.common = opts.common ?? new Common({ chain: Mainnet })
    this.keccakFunction = opts.common?.customCrypto.keccak256 ?? keccak256
  }

  /**
   * Note that the returned statemanager will share the same JSONRPCProvider as the original
   *
   * @returns RPCStateManager
   */
  shallowCopy(): RPCStateManager {
    const newState = new RPCStateManager({
      provider: this._provider,
      blockTag: BigInt(this._blockTag),
    })
    newState._caches = new Caches({ storage: { size: 100000 } })

    return newState
  }

  /**
   * Sets the new block tag used when querying the provider and clears the
   * internal cache.
   * @param blockTag - the new block tag to use when querying the provider
   */
  setBlockTag(blockTag: bigint | 'earliest'): void {
    this._blockTag = blockTag === 'earliest' ? blockTag : bigIntToHex(blockTag)
    this.clearCaches()
    if (this.DEBUG) this._debug(`setting block tag to ${this._blockTag}`)
  }

  /**
   * Clears the internal cache so all accounts, contract code, and storage slots will
   * initially be retrieved from the provider
   */
  clearCaches(): void {
    this._caches.clear()
  }

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Uint8Array>} - Resolves with the code corresponding to the provided address.
   * Returns an empty `Uint8Array` if the account has no associated code.
   */
  async getCode(address: Address): Promise<Uint8Array> {
    let codeBytes = this._caches.code?.get(address)?.code
    if (codeBytes !== undefined) return codeBytes
    const code = await fetchFromProvider(this._provider, {
      method: 'eth_getCode',
      params: [address.toString(), this._blockTag],
    })
    codeBytes = toBytes(code)
    this._caches.code?.put(address, codeBytes)
    return codeBytes
  }

  async getCodeSize(address: Address): Promise<number> {
    const contractCode = await this.getCode(address)
    return contractCode.length
  }

  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putCode(address: Address, value: Uint8Array): Promise<void> {
    // Store contract code in the cache
    this._caches.code?.put(address, value)
  }

  /**
   * Gets the storage value associated with the provided `address` and `key`. This method returns
   * the shortest representation of the stored value.
   * @param address - Address of the account to get the storage for
   * @param key - Key in the account's storage to get the value for. Must be 32 bytes long.
   * @returns {Uint8Array} - The storage value for the account
   * corresponding to the provided address at the provided key.
   * If this does not exist an empty `Uint8Array` is returned.
   */
  async getStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    // Check storage slot in cache
    if (key.length !== 32) {
      throw EthereumJSErrorWithoutCode('Storage key must be 32 bytes long')
    }

    let value = this._caches.storage?.get(address, key)
    if (value !== undefined) {
      return value
    }

    // Retrieve storage slot from provider if not found in cache
    const storage = await fetchFromProvider(this._provider, {
      method: 'eth_getStorageAt',
      params: [address.toString(), bytesToHex(key), this._blockTag],
    })
    value = toBytes(storage)

    await this.putStorage(address, key, value)
    return value
  }

  /**
   * Adds value to the cache for the `account`
   * corresponding to `address` at the provided `key`.
   * @param address - Address to set a storage value for
   * @param key - Key to set the value at. Must be 32 bytes long.
   * @param value - Value to set at `key` for account corresponding to `address`.
   * Cannot be more than 32 bytes. Leading zeros are stripped.
   * If it is empty or filled with zeros, deletes the value.
   */
  async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    this._caches.storage?.put(address, key, value)
  }

  /**
   * Clears all storage entries for the account corresponding to `address`.
   * @param address - Address to clear the storage of
   */
  async clearStorage(address: Address): Promise<void> {
    this._caches.storage?.clearStorage(address)
  }

  /**
   * Dumps the RLP-encoded storage values for an `account` specified by `address`.
   * @param address - The address of the `account` to return storage for
   * @returns {Promise<StorageDump>} - The state of the account as an `Object` map.
   * Keys are the storage keys, values are the storage values as strings.
   * Both are represented as `0x` prefixed hex strings.
   */
  dumpStorage(address: Address): Promise<StorageDump> {
    const storageMap = this._caches.storage?.dump(address)
    const dump: StorageDump = {}
    if (storageMap !== undefined) {
      for (const slot of storageMap) {
        dump[slot[0]] = bytesToHex(slot[1])
      }
    }
    return Promise.resolve(dump)
  }

  /**
   * Gets the account associated with `address` or `undefined` if account does not exist
   * @param address - Address of the `account` to get
   */
  async getAccount(address: Address): Promise<Account | undefined> {
    const elem = this._caches.account?.get(address)
    if (elem !== undefined) {
      return elem.accountRLP !== undefined ? createAccountFromRLP(elem.accountRLP) : undefined
    }

    const accountFromProvider = await this.getAccountFromProvider(address)
    const account =
      equalsBytes(accountFromProvider.codeHash, new Uint8Array(32)) ||
      equalsBytes(accountFromProvider.serialize(), KECCAK256_RLP_EMPTY_ACCOUNT)
        ? undefined
        : createAccountFromRLP(accountFromProvider.serialize())

    this._caches.account?.put(address, account)

    return account
  }

  /**
   * Retrieves an account from the provider and stores in the local trie
   * @param address Address of account to be retrieved from provider
   * @private
   */
  async getAccountFromProvider(address: Address): Promise<Account> {
    if (this.DEBUG) this._debug(`retrieving account data from ${address.toString()} from provider`)
    const accountData = await fetchFromProvider(this._provider, {
      method: 'eth_getProof',
      params: [address.toString(), [] as any, this._blockTag],
    })
    const account = createAccount({
      balance: BigInt(accountData.balance),
      nonce: BigInt(accountData.nonce),
      codeHash: toBytes(accountData.codeHash),
      storageRoot: toBytes(accountData.storageHash),
    })
    return account
  }

  /**
   * Saves an account into state under the provided `address`.
   * @param address - Address under which to store `account`
   * @param account - The account to store
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
    if (account !== undefined) {
      this._caches.account!.put(address, account)
    } else {
      this._caches.account!.del(address)
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
    if (this.DEBUG) {
      this._debug(`modifying account fields for ${address.toString()}`)
      this._debug(
        JSON.stringify(
          accountFields,
          (k, v) => {
            if (k === 'nonce') return v.toString()
            return v
          },
          2,
        ),
      )
    }
    await modifyAccountFields(this, address, accountFields)
  }

  /**
   * Deletes an account from state under the provided `address`.
   * @param address - Address of the account which should be deleted
   */
  async deleteAccount(address: Address) {
    if (this.DEBUG) {
      this._debug(`deleting account corresponding to ${address.toString()}`)
    }
    this._caches.account?.del(address)
  }

  /**
   * Returns the applied key for a given address
   * Used for saving preimages
   * @param address - The address to return the applied key
   * @returns {Uint8Array} - The applied key (e.g. hashed address)
   */
  getAppliedKey(address: Uint8Array): Uint8Array {
    return this.keccakFunction(address)
  }

  /**
   * Checkpoints the current state of the StateManager instance.
   * State changes that follow can then be committed by calling
   * `commit` or `reverted` by calling rollback.
   */
  async checkpoint(): Promise<void> {
    this._caches.checkpoint()
  }

  /**
   * Commits the current change-set to the instance since the
   * last call to checkpoint.
   *
   * Partial implementation, called from the subclass.
   */
  async commit(): Promise<void> {
    // setup cache checkpointing
    this._caches.account?.commit()
  }

  /**
   * Reverts the current change-set to the instance since the
   * last call to checkpoint.
   *
   * Partial implementation , called from the subclass.
   */
  async revert(): Promise<void> {
    this._caches.revert()
  }

  async flush(): Promise<void> {
    this._caches.account?.flush()
  }

  /**
   * @deprecated This method is not used by the RPC State Manager and is a stub required by the State Manager interface
   */
  getStateRoot = async () => {
    return new Uint8Array(32)
  }

  /**
   * @deprecated This method is not used by the RPC State Manager and is a stub required by the State Manager interface
   */
  setStateRoot = async (_root: Uint8Array) => {}

  /**
   * @deprecated This method is not used by the RPC State Manager and is a stub required by the State Manager interface
   */
  hasStateRoot = () => {
    throw EthereumJSErrorWithoutCode('function not implemented')
  }
}

export class RPCBlockChain {
  readonly provider: string
  constructor(provider: string) {
    if (provider === undefined || provider === '')
      throw EthereumJSErrorWithoutCode('provider URL is required')
    this.provider = provider
  }
  async getBlock(blockId: number) {
    const block = await fetchFromProvider(this.provider, {
      method: 'eth_getBlockByNumber',
      params: [intToHex(blockId), false],
    })
    return {
      hash: () => hexToBytes(block.hash),
    }
  }

  shallowCopy() {
    return this
  }
}
