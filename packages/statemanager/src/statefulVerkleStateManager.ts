import { Common, Mainnet } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  Account,
  type Address,
  KECCAK256_NULL,
  MapDB,
  VERKLE_CODE_CHUNK_SIZE,
  VERKLE_CODE_OFFSET,
  VERKLE_NODE_WIDTH,
  VerkleLeafType,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  chunkifyCode,
  createAddressFromString,
  createPartialAccount,
  createPartialAccountFromRLP,
  decodeVerkleLeafBasicData,
  encodeVerkleLeafBasicData,
  equalsBytes,
  generateChunkSuffixes,
  generateCodeStems,
  getVerkleStem,
  getVerkleTreeKeyForStorageSlot,
  hexToBytes,
  padToEven,
  setLengthLeft,
  setLengthRight,
  short,
  unpadBytes,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import { VerkleTree } from '@ethereumjs/verkle'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { AccessWitness, AccessedStateType, decodeValue } from './accessWitness.js'
import { OriginalStorageCache } from './cache/originalStorageCache.js'
import { modifyAccountFields } from './util.js'

import type { AccessedStateWithAddress } from './accessWitness.js'
import type { Caches } from './cache/caches.js'
import type { StatefulVerkleStateManagerOpts, VerkleState } from './types.js'
import type {
  AccountFields,
  StateManagerInterface,
  StorageDump,
  StorageRange,
} from '@ethereumjs/common'
import type { PrefixedHexString, VerkleCrypto, VerkleExecutionWitness } from '@ethereumjs/util'
import type { Debugger } from 'debug'

const ZEROVALUE = '0x0000000000000000000000000000000000000000000000000000000000000000'
export class StatefulVerkleStateManager implements StateManagerInterface {
  protected _debug: Debugger
  protected _caches?: Caches

  originalStorageCache: OriginalStorageCache

  protected _trie: VerkleTree

  public readonly common: Common

  protected _checkpointCount: number

  // Post-state provided from the executionWitness.
  // Should not update. Used for comparing our computed post-state with the canonical one.
  private _postState: VerkleState = {}
  private _preState: VerkleState = {}

  protected verkleCrypto: VerkleCrypto
  /**
   * StateManager is run in DEBUG mode (default: false)
   * Taken from DEBUG environment variable
   *
   * Safeguards on debug() calls are added for
   * performance reasons to avoid string literal evaluation
   * @hidden
   */
  protected readonly DEBUG: boolean = false

  private keccakFunction: Function

  accessWitness?: AccessWitness
  constructor(opts: StatefulVerkleStateManagerOpts) {
    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    // Additional window check is to prevent vite browser bundling (and potentially other) to break
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false

    this._checkpointCount = 0

    if (opts.common?.isActivatedEIP(6800) === false)
      throw new Error('EIP-6800 required for verkle state management')

    this.common = opts.common ?? new Common({ chain: Mainnet, eips: [6800] })
    this._trie =
      opts.trie ??
      new VerkleTree({ verkleCrypto: opts.verkleCrypto, db: new MapDB<Uint8Array, Uint8Array>() })
    this._debug = debugDefault('statemanager:verkle:stateful')
    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))
    this._caches = opts.caches
    this.keccakFunction = opts.common?.customCrypto.keccak256 ?? keccak256
    this.verkleCrypto = opts.verkleCrypto
    this.accessWitness = new AccessWitness({ verkleCrypto: this.verkleCrypto })
  }

  /**
   * Gets the account associated with `address` or `undefined` if account does not exist
   * @param address - Address of the `account` to get
   */
  getAccount = async (address: Address): Promise<Account | undefined> => {
    const elem = this._caches?.account?.get(address)
    if (elem !== undefined) {
      return elem.accountRLP !== undefined
        ? createPartialAccountFromRLP(elem.accountRLP)
        : undefined
    }

    const stem = getVerkleStem(this.verkleCrypto, address, 0)

    // First retrieve the account "header" values from the trie
    const accountValues = await this._trie.get(stem, [
      VerkleLeafType.BasicData,
      VerkleLeafType.CodeHash,
    ])

    let account
    if (accountValues[0] !== undefined) {
      const basicData = decodeVerkleLeafBasicData(accountValues[0]!)
      account = createPartialAccount({
        version: basicData.version,
        balance: basicData.balance,
        nonce: basicData.nonce,
        // Codehash is either untouched (i.e. undefined) or deleted (i.e. overwritten with zeros)
        codeHash:
          accountValues[1] === undefined || equalsBytes(accountValues[1], new Uint8Array(32))
            ? KECCAK256_NULL
            : accountValues[1],
        codeSize: basicData.codeSize,
        storageRoot: KECCAK256_NULL, // TODO: Add storage stuff
      })
    } else if (accountValues[1] === undefined) {
      // account does not exist if both basic fields and codehash are undefined
      if (this.DEBUG) {
        this._debug(`getAccount address=${address.toString()} from DB (non-existent)`)
      }
      this._caches?.account?.put(address, account)
    }

    if (this.DEBUG) {
      this._debug(`getAccount address=${address.toString()} stem=${short(stem)}`)
    }
    return account
  }

  public initVerkleExecutionWitness(
    _blockNum: bigint,
    executionWitness?: VerkleExecutionWitness | null,
    accessWitness?: AccessWitness,
  ) {
    if (executionWitness === null || executionWitness === undefined) {
      const errorMsg = `Invalid executionWitness=${executionWitness} for initVerkleExecutionWitness`
      this._debug(errorMsg)
      throw Error(errorMsg)
    }

    // Populate the pre-state and post-state from the executionWitness
    const preStateRaw = executionWitness.stateDiff.flatMap(({ stem, suffixDiffs }) => {
      const suffixDiffPairs = suffixDiffs.map(({ currentValue, suffix }) => {
        const key = `${stem}${padToEven(Number(suffix).toString(16))}`
        return {
          [key]: currentValue,
        }
      })

      return suffixDiffPairs
    })

    // also maintain a separate preState unaffected by any changes in _state
    this._preState = preStateRaw.reduce((prevValue, currentValue) => {
      const acc = { ...prevValue, ...currentValue }
      return acc
    }, {})

    this.accessWitness = accessWitness ?? new AccessWitness({ verkleCrypto: this.verkleCrypto })

    const postStateRaw = executionWitness.stateDiff.flatMap(({ stem, suffixDiffs }) => {
      const suffixDiffPairs = suffixDiffs.map(({ newValue, currentValue, suffix }) => {
        const key = `${stem}${padToEven(Number(suffix).toString(16))}` as PrefixedHexString
        // A postState value of null means there was no change from the preState.
        // In this implementation, we therefore replace null with the preState.
        const value = newValue ?? currentValue

        return {
          [key]: value,
        }
      })

      return suffixDiffPairs
    })

    const postState = postStateRaw.reduce((prevValue, currentValue) => {
      const acc = { ...prevValue, ...currentValue }
      return acc
    }, {})

    this._postState = postState
    this._debug('initVerkleExecutionWitness postState', this._postState)
  }

  /**
   * Saves an account into state under the provided `address`.
   * @param address - Address under which to store `account`
   * @param account - The account to store or undefined if to be deleted
   */
  putAccount = async (address: Address, account?: Account): Promise<void> => {
    if (this.DEBUG) {
      this._debug(
        `putAccount address=${address} nonce=${account?.nonce} balance=${
          account?.balance
        } contract=${account && account.isContract() ? 'yes' : 'no'} empty=${
          account && account.isEmpty() ? 'yes' : 'no'
        }`,
      )
    }
    if (this._caches?.account === undefined) {
      if (account !== undefined) {
        const stem = getVerkleStem(this.verkleCrypto, address, 0)
        const basicDataBytes = encodeVerkleLeafBasicData(account)
        await this._trie.put(
          stem,
          [VerkleLeafType.BasicData, VerkleLeafType.CodeHash],
          [basicDataBytes, account.codeHash],
        )
      } else {
        // Delete account
        await this.deleteAccount(address)
      }
    } else {
      if (account !== undefined) {
        this._caches?.account?.put(address, account, true)
      } else {
        this._caches?.account?.del(address)
      }
    }
  }

  /**
   * Deletes an account from state under the provided `address`.
   * @param address - Address of the account which should be deleted
   */
  deleteAccount = async (address: Address): Promise<void> => {
    if (this.DEBUG) {
      this._debug(`Delete account ${address}`)
    }

    this._caches?.deleteAccount(address)

    if (this._caches?.account === undefined) {
      const stem = getVerkleStem(this.verkleCrypto, address)
      // TODO: Determine the best way to clear code/storage for an account when deleting
      // Will need to inspect all possible code and storage keys to see if it's anything
      // other than untouched leaf values
      await this._trie.del(stem, [VerkleLeafType.BasicData, VerkleLeafType.CodeHash])
    }
  }

  modifyAccountFields = async (address: Address, accountFields: AccountFields): Promise<void> => {
    await modifyAccountFields(this, address, accountFields)
  }
  putCode = async (address: Address, value: Uint8Array): Promise<void> => {
    if (this.DEBUG) {
      this._debug(`putCode address=${address.toString()} value=${short(value)}`)
    }

    this._caches?.code?.put(address, value)

    const codeHash = keccak256(value)
    if (equalsBytes(codeHash, KECCAK256_NULL)) {
      // If the code hash is the null hash, no code has to be stored
      return
    }

    if ((await this.getAccount(address)) === undefined) {
      await this.putAccount(address, new Account())
    }
    if (this.DEBUG) {
      this._debug(`Update codeHash (-> ${short(codeHash)}) for account ${address}`)
    }

    const codeChunks = chunkifyCode(value)
    const chunkStems = await generateCodeStems(codeChunks.length, address, this.verkleCrypto)

    const chunkSuffixes: number[] = generateChunkSuffixes(codeChunks.length)
    // Put the code chunks corresponding to the first stem (up to 128 chunks)
    await this._trie.put(
      chunkStems[0],
      chunkSuffixes.slice(
        0,
        codeChunks.length <= VERKLE_CODE_OFFSET ? codeChunks.length : VERKLE_CODE_OFFSET,
      ),
      codeChunks.slice(
        0,
        codeChunks.length <= VERKLE_CODE_OFFSET ? codeChunks.length : VERKLE_CODE_OFFSET,
      ),
    )

    // Put additional chunks under additional stems as applicable
    for (let stem = 1; stem < chunkStems.length; stem++) {
      const sliceStart = VERKLE_CODE_OFFSET + VERKLE_NODE_WIDTH * (stem - 1)
      const sliceEnd =
        value.length <= VERKLE_CODE_OFFSET + VERKLE_NODE_WIDTH * stem
          ? value.length
          : VERKLE_CODE_OFFSET + VERKLE_NODE_WIDTH * stem
      await this._trie.put(
        chunkStems[stem],
        chunkSuffixes.slice(sliceStart, sliceEnd),
        codeChunks.slice(sliceStart, sliceEnd),
      )
    }
    await this.modifyAccountFields(address, { codeHash, codeSize: value.length })
  }

  getCode = async (address: Address): Promise<Uint8Array> => {
    if (this.DEBUG) {
      this._debug(`getCode address=${address.toString()}`)
    }

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

    // allocate the code
    const codeSize = account.codeSize

    const stems = await generateCodeStems(
      Math.ceil(codeSize / VERKLE_CODE_CHUNK_SIZE),
      address,
      this.verkleCrypto,
    )
    const chunkSuffixes = generateChunkSuffixes(Math.ceil(codeSize / VERKLE_CODE_CHUNK_SIZE))

    const chunksByStem = new Array(stems.length)
    // Retrieve the code chunks stored in the first leaf node
    chunksByStem[0] = await this._trie.get(
      stems[0],
      chunkSuffixes.slice(0, codeSize <= VERKLE_CODE_OFFSET ? codeSize : VERKLE_CODE_OFFSET),
    )

    // Retrieve code chunks on any additional stems
    for (let stem = 1; stem < stems.length; stem++) {
      const sliceStart = VERKLE_CODE_OFFSET + VERKLE_NODE_WIDTH * (stem - 1)
      const sliceEnd =
        codeSize <= VERKLE_CODE_OFFSET + VERKLE_NODE_WIDTH * stem
          ? codeSize
          : VERKLE_CODE_OFFSET + VERKLE_NODE_WIDTH * stem
      chunksByStem[stem] = await this._trie.get(
        stems[stem],
        chunkSuffixes.slice(sliceStart, sliceEnd),
      )
    }
    const chunks = chunksByStem.flat()
    const code = new Uint8Array(codeSize)
    // Insert code chunks into final array (skipping PUSHDATA overflow indicator byte)
    for (let x = 0; x < chunks.length; x++) {
      if (chunks[x] === undefined) throw new Error(`expected code chunk at ID ${x}, got undefined`)

      // Determine code ending byte (if we're on the last chunk)
      let sliceEnd = 32
      if (x === chunks.length - 1) {
        sliceEnd = (codeSize % VERKLE_CODE_CHUNK_SIZE) + 1
      }

      code.set(chunks[x]!.slice(1, sliceEnd), code.byteOffset + x * VERKLE_CODE_CHUNK_SIZE)
    }
    this._caches?.code?.put(address, code)

    return code
  }

  getCodeSize = async (address: Address): Promise<number> => {
    const accountBytes = (
      await this._trie.get(getVerkleStem(this.verkleCrypto, address), [VerkleLeafType.BasicData])
    )[0]
    if (accountBytes === undefined) return 0
    return decodeVerkleLeafBasicData(accountBytes).codeSize
  }
  getStorage = async (address: Address, key: Uint8Array): Promise<Uint8Array> => {
    if (key.length !== 32) {
      throw new Error('Storage key must be 32 bytes long')
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
    const storageKey = await getVerkleTreeKeyForStorageSlot(
      address,
      bytesToBigInt(key, true),
      this.verkleCrypto,
    )
    const value = await this._trie.get(storageKey.slice(0, 31), [storageKey[31]])

    this._caches?.storage?.put(address, key, value[0] ?? hexToBytes('0x80'))
    const decoded = RLP.decode(value[0] ?? new Uint8Array(0)) as Uint8Array
    return decoded
  }

  putStorage = async (address: Address, key: Uint8Array, value: Uint8Array): Promise<void> => {
    value = unpadBytes(value)
    this._caches?.storage?.put(address, key, RLP.encode(value))
    if (this._caches?.storage === undefined) {
      const storageKey = await getVerkleTreeKeyForStorageSlot(
        address,
        bytesToBigInt(key, true),
        this.verkleCrypto,
      )
      await this._trie.put(storageKey.slice(0, 31), [storageKey[31]], [RLP.encode(value)])
    }
  }

  clearStorage = async (address: Address): Promise<void> => {
    // TODO: Determine if it's possible to clear the actual slots in the trie
    // since the EIP doesn't seem to state how to handle this
    // The main concern I have is that we have no way of identifying all storage slots
    // for a given account so we can't correctly update the trie's root hash
    // (since presumably "clearStorage" would imply writing over all of the storage slots with zeros)
    // Also, do we still need a storageRoot? - presumably not since we don't have separate storage tries
    this._caches?.storage?.clearStorage(address)
  }

  checkpoint = async (): Promise<void> => {
    this._trie.checkpoint()
    this._caches?.checkpoint()
    this._checkpointCount++
  }
  commit = async (): Promise<void> => {
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
  revert = async (): Promise<void> => {
    await this._trie.revert()
    this._caches?.revert()

    this._checkpointCount--

    if (this._checkpointCount === 0) {
      await this.flush()
      this.originalStorageCache.clear()
    }
  }

  flush = async (): Promise<void> => {
    const codeItems = this._caches?.code?.flush() ?? []
    for (const item of codeItems) {
      const addr = createAddressFromString(`0x${item[0]}`)

      const code = item[1].code
      if (code === undefined) {
        continue
      }

      await this.putCode(addr, code)
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
        await this.putStorage(address, keyBytes, decoded)
      }
    }

    const accountItems = this._caches?.account?.flush() ?? []
    for (const item of accountItems) {
      const address = createAddressFromString(`0x${item[0]}`)
      const elem = item[1]
      if (elem.accountRLP === undefined) {
        await this.deleteAccount(address)
      } else {
        const account = createPartialAccountFromRLP(elem.accountRLP)
        await this.putAccount(address, account)
      }
    }
  }

  getComputedValue(accessedState: AccessedStateWithAddress): PrefixedHexString | null {
    const { address, type } = accessedState
    switch (type) {
      case AccessedStateType.BasicData: {
        const encodedAccount = this._caches?.account?.get(address)?.accountRLP
        if (encodedAccount === undefined) {
          return null
        }
        const basicDataBytes = encodeVerkleLeafBasicData(
          createPartialAccountFromRLP(encodedAccount),
        )
        return bytesToHex(basicDataBytes)
      }

      case AccessedStateType.CodeHash: {
        const encodedAccount = this._caches?.account?.get(address)?.accountRLP
        if (encodedAccount === undefined) {
          return null
        }
        return bytesToHex(createPartialAccountFromRLP(encodedAccount).codeHash)
      }

      case AccessedStateType.Code: {
        const { codeOffset } = accessedState
        const code = this._caches?.code?.get(address)?.code
        if (code === undefined) {
          return null
        }

        // we can only compare the actual code because to compare the first byte would
        // be very tricky and impossible in certain scenarios like when the previous code chunk
        // was not accessed and hence not even provided in the witness
        return bytesToHex(
          setLengthRight(
            code.slice(codeOffset, codeOffset + VERKLE_CODE_CHUNK_SIZE),
            VERKLE_CODE_CHUNK_SIZE,
          ),
        )
      }

      case AccessedStateType.Storage: {
        const { slot } = accessedState
        const key = setLengthLeft(bigIntToBytes(slot), 32)

        const storage = this._caches?.storage?.get(address, key)
        if (storage === undefined) {
          return null
        }
        return bytesToHex(setLengthLeft(storage, 32))
      }
    }
  }

  // Verifies that the witness post-state matches the computed post-state
  verifyPostState(): boolean {
    // track what all chunks were accessed so as to compare in the end if any chunks were missed
    // in access while comparing against the provided poststate in the execution witness
    const accessedChunks = new Map<string, boolean>()
    // switch to false if postVerify fails
    let postFailures = 0

    for (const accessedState of this.accessWitness?.accesses() ?? []) {
      const { address, type } = accessedState
      let extraMeta = ''
      if (accessedState.type === AccessedStateType.Code) {
        extraMeta = `codeOffset=${accessedState.codeOffset}`
      } else if (accessedState.type === AccessedStateType.Storage) {
        extraMeta = `slot=${accessedState.slot}`
      }

      const { chunkKey } = accessedState
      accessedChunks.set(chunkKey, true)
      const computedValue = this.getComputedValue(accessedState) ?? this._preState[chunkKey]
      if (computedValue === undefined) {
        this.DEBUG &&
          this._debug(
            `Block accesses missing in canonical address=${address} type=${type} ${extraMeta} chunkKey=${chunkKey}`,
          )
        postFailures++
        continue
      }

      let canonicalValue: PrefixedHexString | null | undefined = this._postState[chunkKey]

      if (canonicalValue === undefined) {
        this.DEBUG &&
          this._debug(
            `Block accesses missing in canonical address=${address} type=${type} ${extraMeta} chunkKey=${chunkKey}`,
          )
        postFailures++
        continue
      }

      // if the access type is code, then we can't match the first byte because since the computed value
      // doesn't has the first byte for push data since previous chunk code itself might not be available
      if (accessedState.type === AccessedStateType.Code) {
        // computedValue = computedValue !== null ? `0x${computedValue.slice(4)}` : null
        canonicalValue = canonicalValue !== null ? `0x${canonicalValue.slice(4)}` : null
      } else if (
        accessedState.type === AccessedStateType.Storage &&
        canonicalValue === null &&
        computedValue === ZEROVALUE
      ) {
        canonicalValue = ZEROVALUE
      }

      if (computedValue !== canonicalValue) {
        const decodedComputedValue = decodeValue(accessedState.type, computedValue)
        const decodedCanonicalValue = decodeValue(accessedState.type, canonicalValue)

        const displayComputedValue =
          computedValue === decodedComputedValue
            ? computedValue
            : `${computedValue} (${decodedComputedValue})`
        const displayCanonicalValue =
          canonicalValue === decodedCanonicalValue
            ? canonicalValue
            : `${canonicalValue} (${decodedCanonicalValue})`

        this.DEBUG &&
          this._debug(
            `Block accesses mismatch address=${address} type=${type} ${extraMeta} chunkKey=${chunkKey}`,
          )
        this.DEBUG && this._debug(`expected=${displayCanonicalValue}`)
        this.DEBUG && this._debug(`computed=${displayComputedValue}`)
        postFailures++
      }
    }

    for (const canChunkKey of Object.keys(this._postState)) {
      if (accessedChunks.get(canChunkKey) === undefined) {
        this.DEBUG && this._debug(`Missing chunk access for canChunkKey=${canChunkKey}`)
        postFailures++
      }
    }

    const verifyPassed = postFailures === 0
    this.DEBUG &&
      this._debug(`verifyPostState verifyPassed=${verifyPassed} postFailures=${postFailures}`)

    return verifyPassed
  }

  getStateRoot(): Promise<Uint8Array> {
    return Promise.resolve(this._trie.root())
  }

  setStateRoot(stateRoot: Uint8Array, clearCache?: boolean): Promise<void> {
    this._trie.root(stateRoot)
    clearCache === true && this.clearCaches()
    return Promise.resolve()
  }
  hasStateRoot(_root: Uint8Array): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
  dumpStorage?(_address: Address): Promise<StorageDump> {
    throw new Error('Method not implemented.')
  }
  dumpStorageRange?(_address: Address, _startKey: bigint, _limit: number): Promise<StorageRange> {
    throw new Error('Method not implemented.')
  }
  clearCaches(): void {
    this._caches?.clear()
  }
  shallowCopy(_downlevelCaches?: boolean): StateManagerInterface {
    throw new Error('Method not implemented.')
  }
  async checkChunkWitnessPresent(_address: Address, _codeOffset: number): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
}
