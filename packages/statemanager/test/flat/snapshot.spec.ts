import { RLP } from '@ethereumjs/rlp'
import { Trie } from '@ethereumjs/trie'
import {
  Account,
  Address,
  KECCAK256_RLP,
  createAccountFromRLP,
  bytesToHex,
  hexToBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { assert, describe, it } from 'vitest'

import { FlatStateManager, Snapshot } from '../../src/index.js'
;(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

async function merkleizeViaTrie(leaves: [Address, Uint8Array][]) {
  const trie = new Trie({ useKeyHashing: true })
  for (const leaf of leaves) {
    await trie.put(leaf[0].bytes, leaf[1])
  }
  return trie.root()
}

describe('snapshot simple get/put', () => {
  it('should return null for non-existent key', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const res = await snapshot.getAccount(addr)
    assert.equal(res, null)
  })

  it('should put/get account', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const val = new Account()
    await snapshot.putAccount(addr, val)
    const res = await snapshot.getAccount(addr)
    assert.equal(JSON.stringify(res), JSON.stringify(val.serialize()))
  })

  it('should put/get storage slot', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const slot = hexToBytes('0x' + '01')
    const val = hexToBytes('0x' + '2222')
    await snapshot.putStorageSlot(addr, slot, val)
    const res = await snapshot.getStorageSlot(addr, slot)
    assert.equal(JSON.stringify(res), JSON.stringify(val))
  })

  it('should put and get contract code', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    await snapshot.putAccount(addr, new Account())
    const code = hexToBytes('0x' + '6000')
    const codeHash = keccak256(code)
    await snapshot.putCode(addr, code)
    const res = await snapshot.getCode(addr)
    assert.equal(JSON.stringify(res), JSON.stringify(code))

    // Check that account's codeHash's field has been updated
    const rawAccount = await snapshot.getAccount(addr)
    assert.ok(rawAccount, 'account should exist')
    const account = createAccountFromRLP(rawAccount as Uint8Array)
    assert.equal(JSON.stringify(account.codeHash), JSON.stringify(codeHash))
  })
  // TODO: what if we insert slot without having inserted account first?
})

describe('snapshot get storage slots for address', () => {
  it('should return empty for non-existent key', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    assert.equal(JSON.stringify(await snapshot.getStorageSlots(addr)), JSON.stringify([]))
  })

  it('should return all slots for account', async () => {
    const snapshot = new Snapshot()
    const addrs = [
      hexToBytes('0x' + '3'.repeat(40)), // Hash starts with 0x5b
      hexToBytes('0x' + '4'.repeat(40)), // Hash starts with 0xa8
      hexToBytes('0x' + '5'.repeat(40)), // Hash starts with 0x42
    ].map((e) => new Address(e))

    // Insert an empty account for all the addresses
    const acc = new Account()
    for (const addr of addrs) {
      await snapshot.putAccount(addr, acc)
    }

    // Insert these slots to every address
    const slots = [
      [hexToBytes('0x' + '1'), hexToBytes('0x' + '2222')],
      [hexToBytes('0x' + '2'), hexToBytes('0x' + '3333')],
    ]
    for (const slot of slots) {
      await snapshot.putStorageSlot(addrs[0], slot[0], slot[1])
      await snapshot.putStorageSlot(addrs[1], slot[0], slot[1])
      await snapshot.putStorageSlot(addrs[2], slot[0], slot[1])
    }

    // TODO assert to check accuracy of returned accounts
    // Should only get slots for given address
    // for (let i = 0; i < addrs.length; i++) {
    //   const actualSlots = await snapshot.getStorageSlots(addrs[0])
    //   assert.ok(slots.length === actualSlots.length)
    //   for (let j = 0; j < actualSlots.length; j++) {
    //     const s = actualSlots[j]
    //     assert.deepEqual(bytesToHex(s[0]), bytesToHex(slots[i][0]))
    //     assert.deepEqual(bytesToHex(s[1]), bytesToHex(slots[i][1]))
    //   }
    // }
  })
})

describe('snapshot merkleize', () => {
  it('should merkleize empty snapshot', async () => {
    const snapshot = new Snapshot()
    const root = await snapshot.merkleize()
    assert.deepEqual(root, KECCAK256_RLP)
  })

  it('should merkleize multiple eoa accounts', async () => {
    const snapshot = new Snapshot()
    const addrs = [
      hexToBytes('0x' + '3'.repeat(40)), // Hash starts with 0x5b
      hexToBytes('0x' + '4'.repeat(40)), // Hash starts with 0xa8
      hexToBytes('0x' + '5'.repeat(40)), // Hash starts with 0x42
    ].map((e) => new Address(e))

    // Insert an empty account for all the addresses
    const acc = new Account()
    for (const addr of addrs) {
      await snapshot.putAccount(addr, acc)
    }

    const expectedRoot = await merkleizeViaTrie(addrs.map((v) => [v, acc.serialize()]))
    const root = await snapshot.merkleize()
    assert.deepEqual(
      root,
      expectedRoot,
      `Merkleized root ${bytesToHex(root)} should match expected ${bytesToHex(expectedRoot)}`,
    )
  })

  it('should merkleize accounts with storage', async () => {
    const addrs = [
      hexToBytes('0x' + '3'.repeat(40)), // Hash starts with 0x5b
      hexToBytes('0x' + '4'.repeat(40)), // Hash starts with 0xa8
      hexToBytes('0x' + '5'.repeat(40)), // Hash starts with 0x42
    ].map((e) => new Address(e))
    const acc = new Account()

    // Insert an empty account for all the addresses
    const snapshot = new Snapshot()
    for (const addr of addrs) {
      await snapshot.putAccount(addr, acc)
    }

    const state = new FlatStateManager()
    await state.checkpoint()
    for (const addr of addrs) {
      await state.putAccount(addr, acc)
    }

    const defaultState = new FlatStateManager()
    await defaultState.checkpoint()
    for (const addr of addrs) {
      await defaultState.putAccount(addr, acc)
    }

    // Insert two of these slots for each account
    const slots = [
      [hexToBytes('0x' + '21'.repeat(32)), hexToBytes('0x' + '2222')],
      [hexToBytes('0x' + '22'.repeat(32)), hexToBytes('0x' + '3333')],
      [hexToBytes('0x' + '23'.repeat(32)), hexToBytes('0x' + '4444')],
    ]
    for (let i = 0; i < addrs.length; i++) {
      const j1 = i
      const j2 = (i + 1) % addrs.length
      await state.putStorage(addrs[i], slots[j1][0], slots[j1][1])
      await state.putStorage(addrs[i], slots[j2][0], slots[j2][1])

      // Have to RLP encode slot values before directly putting them into a snapshot
      await snapshot.putStorageSlot(addrs[i], slots[j1][0], RLP.encode(slots[j1][1]))
      await snapshot.putStorageSlot(addrs[i], slots[j2][0], RLP.encode(slots[j2][1]))
    }

    await state.commit()

    const expectedRoot = await state.getStateRoot()
    const root = await snapshot.merkleize()
    assert.equal(
      bytesToHex(root),
      bytesToHex(expectedRoot),
      `Merkleized root ${bytesToHex(root)} should match expected ${bytesToHex(expectedRoot)}`,
    )
  })
})

describe('snapshot checkpointing', () => {
  it('should checkpoint and get value from parent', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const val = new Account()
    await snapshot.putAccount(addr, val)

    snapshot.checkpoint()

    const res = await snapshot.getAccount(addr)
    assert.deepEqual(res, val.serialize())
  })

  it('should get recent version after checkpoint update', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const acc = new Account()
    const val = acc
    await snapshot.putAccount(addr, val)

    snapshot.checkpoint()

    acc.codeHash = keccak256(hexToBytes('0x' + 'abab'))
    await snapshot.putAccount(addr, acc)

    const res = await snapshot.getAccount(addr)
    assert.deepEqual(res, acc.serialize())
  })

  it('should revert change after checkpoint', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const acc = new Account()

    await snapshot.putAccount(addr, acc)

    snapshot.checkpoint()

    acc.codeHash = keccak256(hexToBytes('0x' + 'abab'))
    await snapshot.putAccount(addr, acc)

    await snapshot.revert()

    const res = await snapshot.getAccount(addr)
    assert.deepEqual(res, new Account().serialize())
  })

  it('should commit change after checkpoint', async () => {
    const snapshot = new Snapshot()
    const addr = new Address(hexToBytes('0x' + '3'.repeat(40)))
    const acc = new Account()

    await snapshot.putAccount(addr, acc)

    snapshot.checkpoint()

    acc.codeHash = keccak256(hexToBytes('0x' + 'abab'))
    await snapshot.putAccount(addr, acc)

    snapshot.checkpoint()

    acc.codeHash = keccak256(hexToBytes('0x' + 'cdcd'))
    await snapshot.putAccount(addr, acc)

    await snapshot.commit()

    const res = await snapshot.getAccount(addr)
    assert.ok(res !== undefined, 'Account exists in snapshot')

    console.log(acc._codeSize)
    console.log(acc.code)
    console.log(res._codeSize)
    console.log(res.code)
    acc._codeSize = acc.code?.length ?? 0
    assert.deepEqual(createAccountFromRLP(res as Uint8Array), acc)
  })
})
