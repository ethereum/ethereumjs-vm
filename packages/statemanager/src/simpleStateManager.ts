import { Account, EthereumJSErrorWithoutCode, bytesToHex } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { OriginalStorageCache } from './cache/originalStorageCache.js'
import { modifyAccountFields } from './util.js'

import type { SimpleStateManagerOpts } from './index.js'
import type { AccountFields, Common, StateManagerInterface } from '@ethereumjs/common'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

/**
 * Simple and dependency-free state manager for basic state access use cases
 * where a merkle-patricia or verkle tree backed state manager is too heavy-weight.
 *
 * This state manager comes with the basic state access logic for
 * accounts, storage and code (put* and get* methods) as well as a simple
 * implementation of checkpointing but lacks methods implementations of
 * state root related logic as well as some other non-core functions.
 *
 * Functionality provided is sufficient to be used for simple EVM use
 * cases and the state manager is used as default there.
 *
 * For a more full fledged and MPT-backed state manager implementation
 * have a look at the `@ethereumjs/statemanager` package.
 */
export class SimpleStateManager implements StateManagerInterface {
  public accountStack: Map<PrefixedHexString, Account | undefined>[] = []
  public codeStack: Map<PrefixedHexString, Uint8Array>[] = []
  public storageStack: Map<string, Uint8Array>[] = []

  originalStorageCache: {
    get(address: Address, key: Uint8Array): Promise<Uint8Array>
    clear(): void
  }

  public readonly common?: Common

  constructor(opts: SimpleStateManagerOpts = {}) {
    this.checkpointSync()
    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))
    this.common = opts.common
  }

  protected topAccountStack() {
    return this.accountStack[this.accountStack.length - 1]
  }
  protected topCodeStack() {
    return this.codeStack[this.codeStack.length - 1]
  }
  protected topStorageStack() {
    return this.storageStack[this.storageStack.length - 1]
  }

  // Synchronous version of checkpoint() to allow to call from constructor
  protected checkpointSync() {
    const newTopA = new Map(this.topAccountStack())
    for (const [address, account] of newTopA) {
      const accountCopy =
        account !== undefined
          ? Object.assign(Object.create(Object.getPrototypeOf(account)), account)
          : undefined
      newTopA.set(address, accountCopy)
    }
    this.accountStack.push(newTopA)
    this.codeStack.push(new Map(this.topCodeStack()))
    this.storageStack.push(new Map(this.topStorageStack()))
  }

  async getAccount(address: Address): Promise<Account | undefined> {
    return this.topAccountStack().get(address.toString())
  }

  async putAccount(address: Address, account?: Account | undefined): Promise<void> {
    this.topAccountStack().set(address.toString(), account)
  }

  async deleteAccount(address: Address): Promise<void> {
    this.topAccountStack().set(address.toString(), undefined)
  }

  async modifyAccountFields(address: Address, accountFields: AccountFields): Promise<void> {
    await modifyAccountFields(this, address, accountFields)
  }

  async getCode(address: Address): Promise<Uint8Array> {
    return this.topCodeStack().get(address.toString()) ?? new Uint8Array(0)
  }

  async putCode(address: Address, value: Uint8Array): Promise<void> {
    this.topCodeStack().set(address.toString(), value)
    if ((await this.getAccount(address)) === undefined) {
      await this.putAccount(address, new Account())
    }
    await this.modifyAccountFields(address, {
      codeHash: (this.common?.customCrypto.keccak256 ?? keccak256)(value),
    })
  }

  async getCodeSize(address: Address): Promise<number> {
    const contractCode = await this.getCode(address)
    return contractCode.length
  }

  async getStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    return (
      this.topStorageStack().get(`${address.toString()}_${bytesToHex(key)}`) ?? new Uint8Array(0)
    )
  }

  async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    this.topStorageStack().set(`${address.toString()}_${bytesToHex(key)}`, value)
  }

  async clearStorage(): Promise<void> {}

  async checkpoint(): Promise<void> {
    this.checkpointSync()
  }
  async commit(): Promise<void> {
    this.accountStack.splice(-2, 1)
    this.codeStack.splice(-2, 1)
    this.storageStack.splice(-2, 1)
  }

  async revert(): Promise<void> {
    this.accountStack.pop()
    this.codeStack.pop()
    this.storageStack.pop()
  }

  async flush(): Promise<void> {}
  clearCaches(): void {}

  shallowCopy(): StateManagerInterface {
    const copy = new SimpleStateManager({ common: this.common })
    for (let i = 0; i < this.accountStack.length; i++) {
      copy.accountStack.push(new Map(this.accountStack[i]))
      copy.codeStack.push(new Map(this.codeStack[i]))
      copy.storageStack.push(new Map(this.storageStack[i]))
    }
    return copy
  }

  // State root functionality not implemented
  getStateRoot(): Promise<Uint8Array> {
    throw EthereumJSErrorWithoutCode('Method not implemented.')
  }
  setStateRoot(): Promise<void> {
    throw EthereumJSErrorWithoutCode('Method not implemented.')
  }
  hasStateRoot(): Promise<boolean> {
    throw EthereumJSErrorWithoutCode('Method not implemented.')
  }
}
