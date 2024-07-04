import { Account, bytesToHex } from '@ethereumjs/util'

import type {
  AccountFields,
  EVMStateManagerInterface,
  Proof,
  StorageDump,
  StorageRange,
} from './interfaces.js'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

class OriginalStorageCache {
  async get(): Promise<Uint8Array> {
    return new Uint8Array([128])
  }
  clear() {}
}

export class SimpleStateManager implements EVMStateManagerInterface {
  public accountStack: Map<PrefixedHexString, Account | undefined>[] = []
  public codeStack: Map<PrefixedHexString, Uint8Array>[] = []
  public storageStack: Map<string, Uint8Array>[] = []

  originalStorageCache: {
    get(address: Address, key: Uint8Array): Promise<Uint8Array>
    clear(): void
  }

  constructor() {
    this.add()
    this.originalStorageCache = new OriginalStorageCache()
  }

  topA() {
    return this.accountStack[this.accountStack.length - 1]
  }
  topC() {
    return this.codeStack[this.codeStack.length - 1]
  }
  topS() {
    return this.storageStack[this.storageStack.length - 1]
  }

  add() {
    this.accountStack.push(new Map(this.topA()))
    this.codeStack.push(new Map(this.topC()))
    this.storageStack.push(new Map(this.topS()))
  }

  async getAccount(address: Address): Promise<Account | undefined> {
    return this.topA().get(address.toString())
  }

  async putAccount(address: Address, account?: Account | undefined): Promise<void> {
    this.topA().set(address.toString(), account)
  }

  async deleteAccount(address: Address): Promise<void> {
    this.topA().set(address.toString(), undefined)
  }

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

  async getContractCode(address: Address): Promise<Uint8Array> {
    return this.topC().get(address.toString()) ?? new Uint8Array(0)
  }

  async putContractCode(address: Address, value: Uint8Array): Promise<void> {
    this.topC().set(address.toString(), value)
  }

  async getContractCodeSize(address: Address): Promise<number> {
    const contractCode = await this.getContractCode(address)
    return contractCode.length
  }

  async getContractStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    return this.topS().get(`${address.toString()}_${bytesToHex(key)}`) ?? new Uint8Array(0)
  }

  async putContractStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    this.topS().set(`${address.toString()}_${bytesToHex(key)}`, value)
  }

  async checkpoint(): Promise<void> {
    this.add()
  }
  async commit(): Promise<void> {
    const topA = this.accountStack.pop()
    const topC = this.codeStack.pop()
    const topS = this.storageStack.pop()
    this.accountStack.pop()
    this.codeStack.pop()
    this.storageStack.pop()
    this.accountStack.push(topA!)
    this.codeStack.push(topC!)
    this.storageStack.push(topS!)
  }

  async revert(): Promise<void> {
    this.accountStack.pop()
    this.codeStack.pop()
    this.storageStack.pop()
  }

  shallowCopy(): EVMStateManagerInterface {
    const copy = new SimpleStateManager()
    for (let i = 0; i < this.accountStack.length; i++) {
      copy.accountStack.push(new Map(this.accountStack[i]))
      copy.codeStack.push(new Map(this.codeStack[i]))
      copy.storageStack.push(new Map(this.storageStack[i]))
    }
    return copy
  }

  // State root functionality not implemented
  getStateRoot(): Promise<Uint8Array> {
    throw new Error('Method not implemented.')
  }
  setStateRoot(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  hasStateRoot(): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  // Only goes for long term create situations, skip
  async clearContractStorage(): Promise<void> {}

  // Only "core" methods implemented
  checkChunkWitnessPresent?(): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
  dumpStorage(): Promise<StorageDump> {
    throw new Error('Method not implemented.')
  }
  dumpStorageRange(): Promise<StorageRange> {
    throw new Error('Method not implemented.')
  }
  generateCanonicalGenesis(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  getProof(): Promise<Proof> {
    throw new Error('Method not implemented.')
  }
  getAppliedKey?(): Uint8Array {
    throw new Error('Method not implemented.')
  }
}
