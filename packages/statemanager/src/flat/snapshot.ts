import { merkleizeList } from '@ethereumjs/trie'
import {
  Account,
  KECCAK256_NULL,
  KECCAK256_RLP_S,
  KeyEncoding,
  LevelDB,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  concatBytes,
  equalsBytes,
  createAccountFromRLP,
  hexToBytes,
  PrefixedHexString,
} from '@ethereumjs/util'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak'

import type { Address } from '@ethereumjs/util'
import type { Debugger } from 'debug'

export const ACCOUNT_PREFIX: Uint8Array = hexToBytes('0x00')
export const STORAGE_PREFIX: Uint8Array = hexToBytes('0x11')
export const CODE_PREFIX: Uint8Array = hexToBytes('0x22')

const { debug: createDebugLogger } = debugDefault

type SnapshotElement = {
  data: Uint8Array | undefined
}

type rootDiffMap = {
  diff: Map<PrefixedHexString, SnapshotElement | undefined>
  root: string
}

// function concatenateUint8Arrays(arrays: Uint8Array[]) {
//   const l = arrays.reduce((prev, curr) => prev + curr.length, 0)
//   const concatenatedArray = new Uint8Array(l)

//   let offset = 0
//   for (const array of arrays) {
//     concatenatedArray.set(array, offset)
//     offset += array.length
//   }

//   return concatenatedArray
// }

export class Snapshot {
  _db: LevelDB<Uint8Array, Uint8Array>
  _debug: Debugger

  /**
   * Diff cache collecting the state of the cache
   * at the beginning of checkpoint height
   * (respectively: before a first modification)
   *
   * If the whole cache element is undefined (in contrast
   * to the data), the element didn't exist in the cache
   * before.
   */
  _diffCache: Map<PrefixedHexString, SnapshotElement | undefined>[] = []
  _checkpoints = 0

  _stateRoot: string = KECCAK256_RLP_S // TODO in case of a rollback to the empty root, skip applying diffs and just clear state to speed this up
  _stateRootDiffCache: rootDiffMap[] = []
  _knownStateRoots: Set<string> = new Set<string>()
  _stateRootCheckpoints = 0

  constructor(db?: LevelDB<Uint8Array, Uint8Array>) {
    this._db = db ?? new LevelDB<Uint8Array, Uint8Array>()
    this._diffCache.push(new Map<PrefixedHexString, SnapshotElement | undefined>())

    this._knownStateRoots.add(this._stateRoot)
    this._stateRootDiffCache.push({
      diff: new Map<PrefixedHexString, SnapshotElement | undefined>(),
      root: this._stateRoot,
    })

    this._debug = createDebugLogger('client:snapshot')
  }

  async _saveCachePreState(key: Uint8Array) {
    const keyHex = bytesToHex(key)
    const stateRootDiffMap = this._stateRootDiffCache[this._stateRootCheckpoints].diff
    const diffMap = this._diffCache[this._checkpoints]

    if (!diffMap.has(keyHex)) {
      const oldElem: SnapshotElement | undefined = {
        data: (await this._db.get(key)) as Uint8Array | undefined,
      }
      diffMap.set(keyHex, oldElem)
    }

    if (!stateRootDiffMap.has(keyHex)) {
      const oldElem: SnapshotElement | undefined = {
        data: (await this._db.get(key)) as Uint8Array | undefined,
      }
      stateRootDiffMap.set(keyHex, oldElem)
    }
  }

  async putAccount(address: Address, account: Account): Promise<void> {
    const key = concatBytes(ACCOUNT_PREFIX, keccak256(address.bytes))
    await this._saveCachePreState(key)
    const value = account.serialize()
    await this._db.put(key, value)
  }

  async getAccount(address: Address): Promise<Uint8Array | undefined> {
    const key = concatBytes(ACCOUNT_PREFIX, keccak256(address.bytes))

    return this._db.get(key)
  }

  _getAccounts(): Promise<[Uint8Array, Uint8Array | undefined][]> {
    const prefix = ACCOUNT_PREFIX
    return this._db.byPrefix(prefix, { keyEncoding: KeyEncoding.Bytes })
  }

  async delAccount(address: Address): Promise<void> {
    const key = concatBytes(ACCOUNT_PREFIX, keccak256(address.bytes))
    await this._saveCachePreState(key)

    return this._db.del(key)
  }

  /**
   * Deletes not only the account itself, but also the code
   * and any storage items if available.
   */
  async clearAccount(address: Address): Promise<void> {
    const rawAccount = await this.getAccount(address)
    if (rawAccount === undefined) return

    await this.delAccount(address)

    const account = createAccountFromRLP(rawAccount)
    if (!equalsBytes(account.codeHash, KECCAK256_NULL)) {
      // TODO figure out if it's necessary/proper to delete the code by codeHash
      // await this.delCode(account.codeHash)
    }

    await this.clearAccountStorage(address)
  }

  async putStorageSlot(address: Address, slot: Uint8Array, value: Uint8Array): Promise<void> {
    const key = concatBytes(STORAGE_PREFIX, keccak256(address.bytes), keccak256(slot))
    await this._saveCachePreState(key)
    await this._db.put(key, value)
  }

  async getStorageSlot(address: Address, slot: Uint8Array): Promise<Uint8Array | undefined> {
    const key = concatBytes(STORAGE_PREFIX, keccak256(address.bytes), keccak256(slot))
    return this._db.get(key)
  }

  async getStorageSlots(address: Address): Promise<[Uint8Array, Uint8Array | undefined][]> {
    const prefix = concatBytes(STORAGE_PREFIX, keccak256(address.bytes))

    return this._db.byPrefix(prefix, { keyEncoding: KeyEncoding.Bytes })
  }

  async delStorageSlot(address: Address, slot: Uint8Array): Promise<void> {
    const key = concatBytes(STORAGE_PREFIX, keccak256(address.bytes), keccak256(slot))
    await this._saveCachePreState(key)
    await this._db.del(key)
  }

  async clearAccountStorage(address: Address): Promise<void> {
    const prefix = concatBytes(STORAGE_PREFIX, keccak256(address.bytes))
    const keys = await this._db.keysByPrefix(prefix, { keyEncoding: KeyEncoding.Bytes })
    for (const key of keys) await this._saveCachePreState(key)
    await this._db.delByPrefix(prefix, { keyEncoding: KeyEncoding.Bytes })
  }

  async putCode(address: Address, code: Uint8Array): Promise<void> {
    const key = concatBytes(CODE_PREFIX, keccak256(address.bytes))
    await this._saveCachePreState(key)
    const codeHash = keccak256(code)
    if (equalsBytes(codeHash, KECCAK256_NULL)) {
      await this._db.del(key)
    } else {
      await this._db.put(key, code)
    }

    // update codeHash field of associated account
    const rawAccount = await this.getAccount(address)
    if (!rawAccount) throw new Error('Creating code for nonexistent account')
    const account = createAccountFromRLP(rawAccount)
    account.codeHash = codeHash
    await this.putAccount(address, account)
  }

  async getCode(address: Address): Promise<Uint8Array | undefined> {
    const rawAccount = await this.getAccount(address)
    if (!rawAccount) return undefined
    const account = createAccountFromRLP(rawAccount)
    if (equalsBytes(account.codeHash, KECCAK256_NULL)) {
      return new Uint8Array(0)
    }

    const key = concatBytes(CODE_PREFIX, keccak256(address.bytes))
    return this._db.get(key)
  }

  async merkleize(checkpointStateRoot = false): Promise<Uint8Array> {
    // Merkleize all the storage tries in the db
    const storageRoots: { [k: string]: Uint8Array } = await this._merkleizeStorageTries()
    const accounts = await this._getAccounts()

    const leaves: [Uint8Array, Uint8Array][] = []
    accounts.map(([key, value]) => {
      const accountKey = key.slice(ACCOUNT_PREFIX.length)
      // TODO update the account's stateRoot field if there exist
      // storage slots for that account in the db (i.e. not EoA).
      // TODO can probably cache stateRoot and re-compute storage

      const storageRoot = storageRoots[bytesToHex(accountKey)]
      let v = value
      if (storageRoot !== undefined) {
        const acc = createAccountFromRLP(v ?? KECCAK256_NULL)
        acc.storageRoot = storageRoot
        v = acc.serialize()
      }
      leaves.push([accountKey, v ?? KECCAK256_NULL])
    })

    const root = merkleizeList(leaves)
    if (checkpointStateRoot === true) {
      this._stateRoot = bytesToHex(root)
      this._knownStateRoots.add(this._stateRoot)
      this._stateRootCheckpoints += 1
      this._stateRootDiffCache.push({
        diff: new Map<PrefixedHexString, SnapshotElement | undefined>(),
        root: this._stateRoot,
      })
    }

    return root
  }

  async _merkleizeStorageTries(): Promise<{ [k: string]: Uint8Array }> {
    const tries: any = {}
    const prefix = STORAGE_PREFIX
    for await (const [key, value] of this._db._leveldb.iterator({
      gte: prefix,
      lt: bigIntToBytes(bytesToBigInt(prefix) + BigInt(1)),
      keyEncoding: 'view',
      valueEncoding: 'view',
    })) {
      const hashedAddr = key.slice(STORAGE_PREFIX.length, STORAGE_PREFIX.length + 32)
      const hashedAddrString = bytesToHex(hashedAddr)
      if (hashedAddrString in tries === false) {
        tries[hashedAddrString] = []
      }
      const slotKey = key.slice(STORAGE_PREFIX.length + 32)
      tries[hashedAddrString].push([slotKey, value])
    }
    const roots: any = {}
    for (const [address, leaves] of Object.entries(tries)) {
      roots[address] = merkleizeList(leaves as Uint8Array[][])
    }
    return roots
  }

  async setStateRoot(root: Uint8Array): Promise<void> {
    const rootString = bytesToHex(root)
    if (this._knownStateRoots.has(rootString) !== true) throw new Error('Root does not exist')
    while (this._stateRootDiffCache.length > 0) {
      this._stateRootCheckpoints -= 1
      const { diff, root } = this._stateRootDiffCache.pop()!
      for (const entry of diff.entries()) {
        const addressHex = entry[0]
        const elem = entry[1]
        if (elem === undefined) {
          await this._db.del(hexToBytes(addressHex))
        } else {
          if (elem.data !== undefined) {
            await this._db.put(hexToBytes(addressHex), elem.data)
          } else {
            await this._db.del(hexToBytes(addressHex))
          }
        }
      }
      if (root === rootString) {
        const calculatedRoot = bytesToHex(await this.merkleize())
        if (calculatedRoot !== rootString)
          throw new Error('Rollback failed to produce expected root')
        this._stateRoot = rootString
        if (rootString === KECCAK256_RLP_S) {
          this._stateRootDiffCache.push({
            diff: new Map<PrefixedHexString, SnapshotElement | undefined>(),
            root: this._stateRoot,
          })
          this._stateRootCheckpoints = 0
        }
        break
      }
    }
  }

  // /**
  //  * Revert changes to cache last checkpoint (no effect on trie).
  //  */
  // TODO need to implement more performant way of deleting by prefix diffs
  async revert(): Promise<void> {
    this._checkpoints -= 1
    const diffMap = this._diffCache.pop()!
    for (const entry of diffMap.entries()) {
      const addressHex = entry[0]
      const elem = entry[1]
      if (elem === undefined) {
        await this._db.del(hexToBytes(addressHex))
      } else {
        if (elem.data !== undefined) {
          await this._db.put(hexToBytes(addressHex), elem.data)
        } else {
          await this._db.del(hexToBytes(addressHex))
        }
      }
    }
  }

  async merge(): Promise<void> {
    const diffMap = this._diffCache.pop()!
    for (const entry of diffMap.entries()) {
      const addressHex = entry[0]
      const oldEntry = this._diffCache[this._checkpoints].has(addressHex)
      if (!oldEntry) {
        const elem = entry[1]
        this._diffCache[this._checkpoints].set(addressHex, elem)
      }
    }
  }

  /**
   * Commits to current state of cache (no effect on trie).
   */
  async commit(): Promise<void> {
    if (this._checkpoints === 0) throw new Error('No outstanding checkpoints to commit')
    this._checkpoints -= 1

    await this.merge()
  }

  /**
   * Marks current state of cache as checkpoint, which can
   * later on be reverted or committed.
   */
  checkpoint(): void {
    this._checkpoints += 1
    this._diffCache.push(new Map<PrefixedHexString, SnapshotElement | undefined>())
  }
}
