import { MerklePatriciaTrie, createTrie, createTrieFromProof } from '@ethereumjs/trie'
import {
  Account,
  KECCAK256_RLP,
  bigIntToBytes,
  createAddressFromPrivateKey,
  createAddressFromString,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
  intToBytes,
  setLengthLeft,
  utf8ToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { CacheType, Caches, MerkleStateManager } from '../src/index.js'
import {
  addMerkleStateProofData,
  fromMerkleStateProof,
  getMerkleStateProof,
} from '../src/proofs/index.js'

import type { PrefixedHexString } from '@ethereumjs/util'

export const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')
function verifyAccount(
  account: Account,
  state: {
    balance: BigInt
    codeHash: Uint8Array
    nonce: BigInt
    storageRoot: Uint8Array
  },
) {
  assert.equal(account.balance, state.balance)
  assert.equal(account.nonce, state.nonce)
  assert.ok(equalsBytes(account.codeHash, state.codeHash))
  assert.ok(equalsBytes(account.storageRoot, state.storageRoot))
}

describe('StateManager -> General', () => {
  it(`should instantiate`, async () => {
    const sm = new MerkleStateManager()

    assert.deepEqual(sm['_trie'].root(), KECCAK256_RLP, 'it has default root')
    const res = await sm.getStateRoot()
    assert.deepEqual(res, KECCAK256_RLP, 'it has default root')
  })

  it('should not throw on getContractStorage() on non-existing accounts', async () => {
    const sm = new MerkleStateManager()

    try {
      const storage = await sm.getStorage(createZeroAddress(), new Uint8Array(32))
      assert.ok(equalsBytes(storage, new Uint8Array()))
    } catch {
      assert.fail('should not throw')
    }
  })

  it(`should clear contract storage`, async () => {
    const sm = new MerkleStateManager()

    const contractAddress = createAddressFromString('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')
    const contractCode = Uint8Array.from([0, 1, 2, 3])
    const storageKey = setLengthLeft(bigIntToBytes(2n), 32)
    const storedData = utf8ToBytes('abcd')

    await sm.putCode(contractAddress, contractCode)
    await sm.putStorage(contractAddress, storageKey, storedData)

    let storage = await sm.getStorage(contractAddress, storageKey)
    assert.equal(JSON.stringify(storage), JSON.stringify(storedData), 'contract storage updated')

    await sm.clearStorage(contractAddress)
    storage = await sm.getStorage(contractAddress, storageKey)
    assert.equal(
      JSON.stringify(storage),
      JSON.stringify(new Uint8Array()),
      'clears contract storage',
    )
  })

  it(`copy()`, async () => {
    const trie = new MerklePatriciaTrie({ cacheSize: 1000 })
    let sm = new MerkleStateManager({
      trie,
      prefixCodeHashes: false,
    })

    let smCopy = sm.shallowCopy()
    assert.equal(
      smCopy['_prefixCodeHashes'],
      sm['_prefixCodeHashes'],
      'should retain non-default values',
    )

    sm = new MerkleStateManager({
      trie,
      caches: new Caches({
        account: {
          type: CacheType.LRU,
        },
        storage: {
          type: CacheType.LRU,
        },
      }),
    })

    smCopy = sm.shallowCopy()
    assert.equal(
      smCopy['_caches']?.settings.account.type,
      CacheType.ORDERED_MAP,
      'should switch to ORDERED_MAP account cache on copy()',
    )
    assert.equal(
      smCopy['_caches']?.settings.storage.type,
      CacheType.ORDERED_MAP,
      'should switch to ORDERED_MAP storage cache on copy()',
    )
    assert.equal(smCopy['_trie']['_opts'].cacheSize, 0, 'should set trie cache size to 0')

    smCopy = sm.shallowCopy(false)
    assert.equal(
      smCopy['_caches']?.settings.account.type,
      CacheType.LRU,
      'should retain account cache type when deactivate cache downleveling',
    )
    assert.equal(
      smCopy['_caches']?.settings.storage.type,
      CacheType.LRU,
      'should retain storage cache type when deactivate cache downleveling',
    )
    assert.equal(
      smCopy['_trie']['_opts'].cacheSize,
      1000,
      'should retain trie cache size when deactivate cache downleveling',
    )
  })

  it(`should import proofs from getProof`, async () => {
    interface StateEntry {
      keys: Uint8Array[]
      values: Uint8Array[]
      code: Uint8Array
      balance: bigint
      nonce: bigint
      codeHash?: Uint8Array
      storageRoot?: Uint8Array
    }

    const stateSetup: {
      [address: string]: StateEntry
    } = {}

    type MakeNonOptional<T> = {
      [K in keyof T]-?: T[K]
    }

    const address1Str = '0x1'.padEnd(42, '0')
    const address2Str = '0x2'.padEnd(42, '0')
    const address3Str = '0x3'.padEnd(42, '0')

    const address1 = createAddressFromString(address1Str)
    const address2 = createAddressFromString(address2Str)
    const address3 = createAddressFromString(address3Str)

    const key1 = setLengthLeft(new Uint8Array([1]), 32)
    const key2 = setLengthLeft(new Uint8Array([2]), 32)
    const key3 = setLengthLeft(new Uint8Array([3]), 32)

    const value1 = new Uint8Array([10])
    const value2 = new Uint8Array([20])
    const value3 = new Uint8Array([30])

    stateSetup[address1Str] = {
      keys: [key1, key2, key3],
      values: [value1, value2, value3],
      code: new Uint8Array([1, 2, 3]),
      balance: BigInt(1),
      nonce: BigInt(1),
    }

    stateSetup[address2Str] = {
      keys: [key1, key2, key3],
      values: [value2, value3, value1], // Note: value order changed so different state root
      code: new Uint8Array([4]),
      balance: BigInt(2),
      nonce: BigInt(2),
    }

    stateSetup[address3Str] = {
      keys: [key1, key2, key3],
      values: [value3, value1, value2], // Note: value order changed so different state root
      code: new Uint8Array([5, 6]),
      balance: BigInt(3),
      nonce: BigInt(3),
    }

    const state1 = stateSetup[address1Str] as MakeNonOptional<StateEntry>
    const state2 = stateSetup[address2Str] as MakeNonOptional<StateEntry>

    const stateManager = new MerkleStateManager()

    for (const [addressStr, entry] of Object.entries(stateSetup)) {
      const address = createAddressFromString(addressStr)
      const account = new Account(entry.nonce, entry.balance)
      await stateManager.putAccount(address, account)
      await stateManager.putCode(address, entry.code)
      for (let i = 0; i < entry.keys.length; i++) {
        const key = entry.keys[i]
        const value = entry.values[i]
        await stateManager.putStorage(address, key, value)
      }
      await stateManager.flush()
      stateSetup[addressStr].codeHash = (await stateManager.getAccount(address)!)?.codeHash
      stateSetup[addressStr].storageRoot = (await stateManager.getAccount(address)!)?.storageRoot
    }

    const proof1 = await getMerkleStateProof(stateManager, address1)

    const partialStateManager = await fromMerkleStateProof(proof1)
    let account1 = await partialStateManager.getAccount(address1)!

    verifyAccount(account1!, state1)

    const proof2 = await getMerkleStateProof(stateManager, address2)
    await addMerkleStateProofData(partialStateManager, proof2)

    let account2 = await partialStateManager.getAccount(address2)
    verifyAccount(account2!, state2)

    let account3 = await partialStateManager.getAccount(address3)
    assert.ok(account3 === undefined)

    // Input proofs
    const stProof = await getMerkleStateProof(stateManager, address1, [
      state1.keys[0],
      state1.keys[1],
    ])
    await addMerkleStateProofData(partialStateManager, stProof)

    let stSlot1_0 = await partialStateManager.getStorage(address1, state1.keys[0])
    assert.ok(equalsBytes(stSlot1_0, state1.values[0]))

    let stSlot1_1 = await partialStateManager.getStorage(address1, state1.keys[1])
    assert.ok(equalsBytes(stSlot1_1, state1.values[1]))

    let stSlot1_2 = await partialStateManager.getStorage(address1, state1.keys[2])
    assert.ok(equalsBytes(stSlot1_2, new Uint8Array()))

    // Check Array support as input
    const newPartialStateManager = await fromMerkleStateProof([proof2, stProof])

    async function postVerify(sm: MerkleStateManager) {
      account1 = await sm.getAccount(address1)
      verifyAccount(account1!, state1)

      account2 = await sm.getAccount(address2)
      verifyAccount(account2!, state2)

      account3 = await sm.getAccount(address3)
      assert.ok(account3 === undefined)

      stSlot1_0 = await sm.getStorage(address1, state1.keys[0])
      assert.ok(equalsBytes(stSlot1_0, state1.values[0]))

      stSlot1_1 = await sm.getStorage(address1, state1.keys[1])
      assert.ok(equalsBytes(stSlot1_1, state1.values[1]))

      stSlot1_2 = await sm.getStorage(address1, state1.keys[2])
      assert.ok(equalsBytes(stSlot1_2, new Uint8Array()))
    }

    await postVerify(newPartialStateManager)

    // Check: empty proof input
    const newPartialStateManager2 = await fromMerkleStateProof([])

    try {
      await addMerkleStateProofData(newPartialStateManager2, [proof2, stProof], true)
      assert.fail('cannot reach this')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(e.message.includes('proof does not have the expected trie root'))
    }

    await addMerkleStateProofData(newPartialStateManager2, [proof2, stProof])
    await newPartialStateManager2.setStateRoot(await partialStateManager.getStateRoot())
    await postVerify(newPartialStateManager2)

    const zeroAddressNonce = BigInt(100)
    await stateManager.putAccount(createZeroAddress(), new Account(zeroAddressNonce))
    const zeroAddressProof = await getMerkleStateProof(stateManager, createZeroAddress())

    try {
      await fromMerkleStateProof([proof1, zeroAddressProof], true)
      assert.fail('cannot reach this')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(e.message.includes('proof does not have the expected trie root'))
    }

    await addMerkleStateProofData(newPartialStateManager2, zeroAddressProof)

    let zeroAccount = await newPartialStateManager2.getAccount(createZeroAddress())
    assert.ok(zeroAccount === undefined)

    await newPartialStateManager2.setStateRoot(await stateManager.getStateRoot())
    zeroAccount = await newPartialStateManager2.getAccount(createZeroAddress())
    assert.ok(zeroAccount!.nonce === zeroAddressNonce)
  })
  it.skipIf(isBrowser() === true)(
    'should create a statemanager fromProof with opts preserved',
    async () => {
      const trie = await createTrie({ useKeyHashing: false })
      const sm = new MerkleStateManager({ trie })
      const pk = hexToBytes('0x9f12aab647a25a81f821a5a0beec3330cd057b2346af4fb09d7a807e896701ea')
      const pk2 = hexToBytes('0x8724f27e2ce3714af01af3220478849db68a03c0f84edf1721d73d9a6139ad1c')
      const address = createAddressFromPrivateKey(pk)
      const address2 = createAddressFromPrivateKey(pk2)
      const account = new Account()
      const account2 = new Account(undefined, 100n)
      await sm.putAccount(address, account)
      await sm.putAccount(address2, account2)
      await sm.putStorage(address, setLengthLeft(intToBytes(0), 32), intToBytes(32))
      const storage = await sm.dumpStorage(address)
      const keys = Object.keys(storage) as PrefixedHexString[]
      const proof = await getMerkleStateProof(
        sm,
        address,
        keys.map((key) => hexToBytes(key)),
      )
      const proof2 = await getMerkleStateProof(sm, address2)
      const newTrie = await createTrieFromProof(
        proof.accountProof.map((e) => hexToBytes(e)),
        { useKeyHashing: false },
      )
      const partialSM = await fromMerkleStateProof([proof, proof2], true, {
        trie: newTrie,
      })
      assert.equal(
        partialSM['_trie']['_opts'].useKeyHashing,
        false,
        'trie opts are preserved in new sm',
      )
      assert.deepEqual(intToBytes(32), await partialSM.getStorage(address, hexToBytes(keys[0])))
      assert.equal((await partialSM.getAccount(address2))?.balance, 100n)
      const partialSM2 = await fromMerkleStateProof(proof, true, {
        trie: newTrie,
      })
      await addMerkleStateProofData(partialSM2, proof2, true)
      assert.equal(
        partialSM2['_trie']['_opts'].useKeyHashing,
        false,
        'trie opts are preserved in new sm',
      )
      assert.deepEqual(intToBytes(32), await partialSM2.getStorage(address, hexToBytes(keys[0])))
      assert.equal((await partialSM2.getAccount(address2))?.balance, 100n)
    },
  )
})
