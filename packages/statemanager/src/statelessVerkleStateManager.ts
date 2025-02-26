import { VerkleAccessedStateType } from '@ethereumjs/common'
import {
  Account,
  EthereumJSErrorWithoutCode,
  KECCAK256_NULL,
  KECCAK256_NULL_S,
  VERKLE_CODE_CHUNK_SIZE,
  VerkleLeafType,
  bigIntToBytes,
  bytesToHex,
  createPartialAccount,
  createPartialAccountFromRLP,
  decodeVerkleLeafBasicData,
  encodeVerkleLeafBasicData,
  getVerkleKey,
  getVerkleStem,
  getVerkleTreeKeyForCodeChunk,
  getVerkleTreeKeyForStorageSlot,
  hexToBytes,
  padToEven,
  setLengthLeft,
  setLengthRight,
  short,
  toBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { OriginalStorageCache } from './cache/index.js'
import { modifyAccountFields } from './util.js'

import type { Caches } from './cache/index.js'
import type { StatelessVerkleStateManagerOpts, VerkleState } from './index.js'
import type { MerkleStateManager } from './merkleStateManager.js'
import type {
  AccountFields,
  Common,
  StateManagerInterface,
  VerkleAccessWitnessInterface,
  VerkleAccessedStateWithAddress,
} from '@ethereumjs/common'
import type {
  Address,
  PrefixedHexString,
  VerkleCrypto,
  VerkleExecutionWitness,
  VerkleProof,
} from '@ethereumjs/util'
import type { Debugger } from 'debug'

const PUSH_OFFSET = 95
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PUSH1 = PUSH_OFFSET + 1
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PUSH32 = PUSH_OFFSET + 32

const ZEROVALUE = '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Stateless Verkle StateManager implementation for the VM.
 *
 * Experimental.
 *
 * This State Manager enables stateless block execution by building a
 * temporary (1-block) state from the verkle block witness.
 * The Stateless Verkle State Manager then uses that populated state
 * to fetch data requested by the the VM.
 *
 */
export class StatelessVerkleStateManager implements StateManagerInterface {
  _cachedStateRoot?: Uint8Array

  originalStorageCache: OriginalStorageCache

  verkleCrypto: VerkleCrypto

  protected _caches?: Caches

  protected _debug: Debugger

  public readonly common: Common

  /**
   * StateManager is run in DEBUG mode (default: false)
   * Taken from DEBUG environment variable
   *
   * Safeguards on this._debug() calls are added for
   * performance reasons to avoid string literal evaluation
   * @hidden
   */
  protected readonly DEBUG: boolean = false

  private _blockNum = BigInt(0)
  private _executionWitness?: VerkleExecutionWitness

  private _proof: VerkleProof | undefined

  // State along execution (should update)
  private _state: VerkleState = {}

  // Post-state provided from the executionWitness.
  // Should not update. Used for comparing our computed post-state with the canonical one.
  private _postState: VerkleState = {}
  private _preState: VerkleState = {}

  // Checkpointing
  private _checkpoints: VerkleState[] = []

  private keccakFunction: Function

  /**
   * Instantiate the StateManager interface.
   */
  constructor(opts: StatelessVerkleStateManagerOpts) {
    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))

    this._caches = opts.caches

    if (opts.common.isActivatedEIP(6800) === false) {
      throw EthereumJSErrorWithoutCode('EIP-6800 required for stateless verkle state management')
    }

    if (opts.common.customCrypto.verkle === undefined) {
      throw EthereumJSErrorWithoutCode('verkle crypto required')
    }

    this.common = opts.common
    this.keccakFunction = opts.common.customCrypto.keccak256 ?? keccak256
    this.verkleCrypto = opts.common.customCrypto.verkle

    this._debug = debugDefault('statemanager:verkle:stateless')

    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    // Additional window check is to prevent vite browser bundling (and potentially other) to break
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
  }

  async getTransitionStateRoot(_: MerkleStateManager, __: Uint8Array): Promise<Uint8Array> {
    throw Error('not implemented')
  }

  public initVerkleExecutionWitness(
    blockNum: bigint,
    executionWitness?: VerkleExecutionWitness | null,
  ) {
    this._blockNum = blockNum
    if (executionWitness === null || executionWitness === undefined) {
      const errorMsg = `Invalid executionWitness=${executionWitness} for initVerkleExecutionWitness`
      this._debug(errorMsg)
      throw Error(errorMsg)
    }

    this._executionWitness = executionWitness
    this._proof = executionWitness.verkleProof

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

    const preState = preStateRaw.reduce((prevValue, currentValue) => {
      const acc = { ...prevValue, ...currentValue }
      return acc
    }, {})

    this._state = preState

    // also maintain a separate preState unaffected by any changes in _state
    this._preState = preStateRaw.reduce((prevValue, currentValue) => {
      const acc = { ...prevValue, ...currentValue }
      return acc
    }, {})

    const postStateRaw = executionWitness.stateDiff.flatMap(({ stem, suffixDiffs }) => {
      const suffixDiffPairs = suffixDiffs.map(({ newValue, suffix }) => {
        const key = `${stem}${padToEven(Number(suffix).toString(16))}` as PrefixedHexString
        // A postState value of null means there was no change from the preState.
        // In this implementation, we therefore replace null with the preState.
        const value = newValue ?? this._state[key]

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
    this._debug('initVerkleExecutionWitness preState', this._state)
    this._debug('initVerkleExecutionWitness postState', this._postState)
  }

  async checkChunkWitnessPresent(address: Address, codeOffset: number) {
    const chunkId = codeOffset / VERKLE_CODE_CHUNK_SIZE
    const chunkKey = bytesToHex(
      await getVerkleTreeKeyForCodeChunk(address, chunkId, this.verkleCrypto),
    )
    return this._state[chunkKey] !== undefined
  }

  /**
   * Copies the current instance of the `StateManager`
   * at the last fully committed point, i.e. as if all current
   * checkpoints were reverted.
   */
  shallowCopy(downlevelCaches = true): StatelessVerkleStateManager {
    const stateManager = new StatelessVerkleStateManager({
      caches: this._caches?.shallowCopy(downlevelCaches),
      common: this.common,
    })
    return stateManager
  }

  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putCode(address: Address, value: Uint8Array): Promise<void> {
    if (this.DEBUG) {
      this._debug(`putCode address=${address.toString()} value=${short(value)}`)
    }

    this._caches?.code?.put(address, value)
    const codeHash = keccak256(value)
    if (KECCAK256_NULL === codeHash) {
      // If the code hash is the null hash, no code has to be stored
      return
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

    // allocate the code and copy onto it from the available witness chunks
    const codeSize = account.codeSize
    // allocate enough to fit the last chunk
    const accessedCode = new Uint8Array(codeSize + VERKLE_CODE_CHUNK_SIZE)

    const chunks = Math.floor(codeSize / VERKLE_CODE_CHUNK_SIZE) + 1
    for (let chunkId = 0; chunkId < chunks; chunkId++) {
      const chunkKey = bytesToHex(
        await getVerkleTreeKeyForCodeChunk(address, chunkId, this.verkleCrypto),
      )
      const codeChunk = this._state[chunkKey]
      if (codeChunk === null) {
        const errorMsg = `Invalid access to a non existent code chunk with chunkKey=${chunkKey}`
        this.DEBUG && this._debug(errorMsg)
        throw Error(errorMsg)
      }

      const codeOffset = chunkId * VERKLE_CODE_CHUNK_SIZE
      // if code chunk was accessed as per the provided witnesses copy it over
      if (codeChunk !== undefined) {
        // actual code starts from index 1 in chunk, 0th index is if there are any push data bytes
        const actualChunk = hexToBytes(codeChunk).slice(1)
        accessedCode.set(actualChunk, codeOffset)
      } else {
        // else fill this unaccessed segment with invalid opcode since the evm execution shouldn't
        // end up here
        accessedCode.fill(0xfe, codeOffset, VERKLE_CODE_CHUNK_SIZE)
      }
    }

    // Return accessedCode where only accessed code has been copied
    const contactCode = accessedCode.slice(0, codeSize)
    this._caches?.code?.put(address, contactCode)

    return contactCode
  }

  async getCodeSize(address: Address): Promise<number> {
    const elem = this._caches?.account?.get(address)
    if (elem !== undefined) {
      const account =
        elem.accountRLP !== undefined ? createPartialAccountFromRLP(elem.accountRLP) : undefined
      if (account === undefined) {
        const errorMsg = `account=${account} in cache`
        this.DEBUG && this._debug(errorMsg)
        throw Error(errorMsg)
      }
      return account.codeSize
    }

    // load the account basic fields and codeSize should be in it
    const account = await this.getAccount(address)
    if (account === undefined) {
      return 0
    }
    return account.codeSize
  }

  /**
   * Gets the storage value associated with the provided `address` and `key`. This method returns
   * the shortest representation of the stored value.
   * @param address -  Address of the account to get the storage for
   * @param key - Key in the account's storage to get the value for. Must be 32 bytes long.
   * @returns {Promise<Uint8Array>} - The storage value for the account
   * corresponding to the provided address at the provided key.
   * If this does not exist an empty `Uint8Array` is returned.
   */
  async getStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    const value = this._caches?.storage?.get(address, key)
    if (value !== undefined) {
      return value
    }

    const storageKey = await getVerkleTreeKeyForStorageSlot(
      address,
      BigInt(bytesToHex(key)),
      this.verkleCrypto,
    )
    const storageValue = toBytes(this._state[bytesToHex(storageKey)])

    this._caches?.storage?.put(address, key, storageValue ?? hexToBytes('0x80'))

    return storageValue
  }

  /**
   * Adds value to the state for the `account`
   * corresponding to `address` at the provided `key`.
   * @param address -  Address to set a storage value for
   * @param key - Key to set the value at. Must be 32 bytes long.
   * @param value - Value to set at `key` for account corresponding to `address`. Cannot be more than 32 bytes. Leading zeros are stripped. If it is a empty or filled with zeros, deletes the value.
   */
  async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    if (this._caches?.storage !== undefined) {
      this._caches.storage.put(address, key, value)
    } else {
      // TODO: Consider refactoring this in a writeContractStorage function? Like in stateManager.ts
      const storageKey = await getVerkleTreeKeyForStorageSlot(
        address,
        BigInt(bytesToHex(key)),
        this.verkleCrypto,
      )
      this._state[bytesToHex(storageKey)] = bytesToHex(setLengthRight(value, 32))
    }
  }

  // Note from Gabriel: Clearing storage is not actually not possible in Verkle.
  // This is because the storage keys are scattered throughout the verkle tree.
  /**
   * Clears all storage entries for the account corresponding to `address`.
   * @param address -  Address to clear the storage of
   */
  async clearStorage(address: Address): Promise<void> {
    const stem = getVerkleStem(this.verkleCrypto, address, 0)
    const codeHashKey = getVerkleKey(stem, VerkleLeafType.CodeHash)
    this._caches?.storage?.clearStorage(address)
    // Update codeHash to `c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`
    this._state[bytesToHex(codeHashKey)] = KECCAK256_NULL_S
  }

  async getAccount(address: Address): Promise<Account | undefined> {
    const elem = this._caches?.account?.get(address)
    if (elem !== undefined) {
      return elem.accountRLP !== undefined
        ? createPartialAccountFromRLP(elem.accountRLP)
        : undefined
    }

    const stem = getVerkleStem(this.verkleCrypto, address, 0)
    const basicDataKey = getVerkleKey(stem, VerkleLeafType.BasicData)
    const codeHashKey = getVerkleKey(stem, VerkleLeafType.CodeHash)

    const basicDataRaw = this._state[bytesToHex(basicDataKey)]
    const codeHashRaw = this._state[bytesToHex(codeHashKey)]

    // check if the account didn't exist if any of the basic keys have null
    if (basicDataRaw === null || codeHashRaw === null) {
      // check any of the other key shouldn't have string input available as this account didn't exist
      if (typeof basicDataRaw === `string` || typeof codeHashRaw === 'string') {
        const errorMsg = `Invalid witness for a non existing address=${address} stem=${bytesToHex(
          stem,
        )}`
        this.DEBUG && this._debug(errorMsg)
        throw Error(errorMsg)
      } else {
        return undefined
      }
    }

    // check if codehash is correct 32 bytes prefixed hex string
    if (codeHashRaw !== undefined && codeHashRaw !== null && codeHashRaw.length !== 66) {
      const errorMsg = `Invalid codeHashRaw=${codeHashRaw} for address=${address} chunkKey=${bytesToHex(
        codeHashKey,
      )}`
      this.DEBUG && this._debug(errorMsg)
      throw Error(errorMsg)
    }

    if (basicDataRaw === undefined && codeHashRaw === undefined) {
      const errorMsg = `No witness bundled for address=${address} stem=${bytesToHex(stem)}`
      this.DEBUG && this._debug(errorMsg)
      throw Error(errorMsg)
    }

    const { version, balance, nonce, codeSize } = decodeVerkleLeafBasicData(
      hexToBytes(basicDataRaw),
    )

    const account = createPartialAccount({
      version,
      balance,
      nonce,
      codeHash: typeof codeHashRaw === 'string' ? hexToBytes(codeHashRaw) : null,
      // if codeSizeRaw is null, it means account didn't exist or it was EOA either way codeSize is 0
      // if codeSizeRaw is undefined, then we pass in null which in our context of partial account means
      // not specified
      codeSize,
      storageRoot: null,
    })

    if (this.DEBUG) {
      this._debug(`getAccount address=${address.toString()} stem=${short(stem)}`)
    }

    this._caches?.account?.put(address, account, true)

    return account
  }

  async putAccount(address: Address, account: Account): Promise<void> {
    if (this.DEBUG) {
      this._debug(`putAccount address=${address.toString()}`)
    }

    if (this._caches?.account === undefined) {
      const stem = getVerkleStem(this.verkleCrypto, address, 0)
      const basicDataKey = getVerkleKey(stem, VerkleLeafType.BasicData)
      const basicDataBytes = encodeVerkleLeafBasicData(account)

      this._state[bytesToHex(basicDataKey)] = bytesToHex(basicDataBytes)
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
  async deleteAccount(address: Address) {
    if (this.DEBUG) {
      this._debug(`Delete account ${address}`)
    }

    this._caches?.deleteAccount(address)
  }

  async modifyAccountFields(address: Address, accountFields: AccountFields): Promise<void> {
    await modifyAccountFields(this, address, accountFields)
  }

  // Verifies that the witness post-state matches the computed post-state
  verifyPostState(accessWitness: VerkleAccessWitnessInterface): Promise<boolean> {
    // track what all chunks were accessed so as to compare in the end if any chunks were missed
    // in access while comparing against the provided poststate in the execution witness
    const accessedChunks = new Map<string, boolean>()
    // switch to false if postVerify fails
    let postFailures = 0

    for (const accessedState of accessWitness?.accesses() ?? []) {
      const { address, type } = accessedState
      let extraMeta = ''
      if (accessedState.type === VerkleAccessedStateType.Code) {
        extraMeta = `codeOffset=${accessedState.codeOffset}`
      } else if (accessedState.type === VerkleAccessedStateType.Storage) {
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
      if (accessedState.type === VerkleAccessedStateType.Code) {
        // computedValue = computedValue !== null ? `0x${computedValue.slice(4)}` : null
        canonicalValue = canonicalValue !== null ? `0x${canonicalValue.slice(4)}` : null
      } else if (
        accessedState.type === VerkleAccessedStateType.Storage &&
        canonicalValue === null &&
        computedValue === ZEROVALUE
      ) {
        canonicalValue = ZEROVALUE
      }

      if (computedValue !== canonicalValue) {
        this.DEBUG &&
          this._debug(
            `Block accesses mismatch address=${address} type=${type} ${extraMeta} chunkKey=${chunkKey}`,
          )
        this.DEBUG && this._debug(`expected=${canonicalValue}`)
        this.DEBUG && this._debug(`computed=${computedValue}`)
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

    // This is async so the stateful variant can use the same interface method
    return Promise.resolve(verifyPassed)
  }

  getComputedValue(accessedState: VerkleAccessedStateWithAddress): PrefixedHexString | null {
    const { address, type } = accessedState
    switch (type) {
      case VerkleAccessedStateType.BasicData: {
        const encodedAccount = this._caches?.account?.get(address)?.accountRLP
        if (encodedAccount === undefined) {
          return null
        }
        const basicDataBytes = encodeVerkleLeafBasicData(
          createPartialAccountFromRLP(encodedAccount),
        )
        return bytesToHex(basicDataBytes)
      }

      case VerkleAccessedStateType.CodeHash: {
        const encodedAccount = this._caches?.account?.get(address)?.accountRLP
        if (encodedAccount === undefined) {
          return null
        }
        return bytesToHex(createPartialAccountFromRLP(encodedAccount).codeHash)
      }

      case VerkleAccessedStateType.Code: {
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

      case VerkleAccessedStateType.Storage: {
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

  /**
   * Checkpoints the current state of the StateManager instance.
   * State changes that follow can then be committed by calling
   * `commit` or `reverted` by calling rollback.
   */
  async checkpoint(): Promise<void> {
    this._checkpoints.push(this._state)
    this._caches?.checkpoint()
  }

  /**
   * Commits the current change-set to the instance since the
   * last call to checkpoint.
   */
  async commit(): Promise<void> {
    this._checkpoints.pop()
    this._caches?.commit()
  }

  // TODO
  async hasStateRoot(_: Uint8Array): Promise<boolean> {
    return true
  }

  /**
   * Reverts the current change-set to the instance since the
   * last call to checkpoint.
   */
  async revert(): Promise<void> {
    // setup trie checkpointing
    this._checkpoints.pop()
    this._caches?.revert()
  }

  /**
   * Writes all cache items to the trie
   */
  async flush(): Promise<void> {}

  /**
   * Gets the cache state root.
   * This is used to persist the stateRoot between blocks, so that blocks can retrieve the stateRoot of the parent block.
   * This is required to verify and prove verkle execution witnesses.
   * @returns {Promise<Uint8Array>} - Returns the cached state root
   */
  async getStateRoot(): Promise<Uint8Array> {
    if (this._cachedStateRoot === undefined) {
      throw EthereumJSErrorWithoutCode('Cache state root missing')
    }
    return this._cachedStateRoot
  }

  /**
   * Sets the cache state root.
   * This is used to persist the stateRoot between blocks, so that blocks can retrieve the stateRoot of the parent block.
   * @param stateRoot - The stateRoot to set
   */
  async setStateRoot(stateRoot: Uint8Array): Promise<void> {
    this._cachedStateRoot = stateRoot
  }

  /**
   * Clears all underlying caches
   */
  clearCaches() {
    this._caches?.clear()
  }

  // TODO: Removing this causes a Kaustinen6 test in client to fail
  // Seems to point to a more general (non-severe) bug and can likely be fixed
  // by having the `statelessVerkle` config option more properly set by the
  // test for the check in the VM execution to call into this method
  generateCanonicalGenesis(_initState: any): Promise<void> {
    return Promise.resolve()
  }
}
