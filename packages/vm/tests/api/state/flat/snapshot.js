const tape = require('tape')
const promisify = require('util-promisify')
const BN = require('bn.js')
const Account = require('ethereumjs-account').default
const { keccak256, KECCAK256_RLP } = require('ethereumjs-util')
const Trie = require('merkle-patricia-tree/secure')
const { Snapshot } = require('../../../../dist/state/flat/snapshot')
const StateManager = require('../../../../dist/state/stateManager').default

tape('snapshot simple get/put', (t) => {
  t.test('should return null for non-existent key', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const res = await snapshot.getAccount(addr)
    st.equal(res, null)
    st.end()
  })

  t.test('should put/get account', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const val = (new Account()).serialize()
    await snapshot.putAccount(addr, val)
    const res = await snapshot.getAccount(addr)
    st.ok(res.equals(val))
    st.end()
  })

  t.test('should put/get storage slot', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const slot = Buffer.from('01', 'hex')
    const val = Buffer.from('2222', 'hex')
    await snapshot.putStorageSlot(addr, slot, val)
    const res = await snapshot.getStorageSlot(addr, slot)
    st.ok(res.equals(val))
    st.end()
  })

  t.test('should put and get contract code', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    await snapshot.putAccount(addr, (new Account()).serialize())
    const code = Buffer.from('6000', 'hex')
    const codeHash = keccak256(code)
    await snapshot.putCode(addr, code)
    const res = await snapshot.getCode(addr)
    st.ok(res.equals(code))

    // Check that account's codeHash's field has been updated
    const rawAccount = await snapshot.getAccount(addr)
    const account = new Account(rawAccount)
    st.ok(account.codeHash.equals(codeHash))
    st.end()
  })
  // TODO: what if we insert slot without having inserted account first?
})

tape('snapshot get storage slots for address', (t) => {
  t.test('should return empty for non-existent key', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    snapshot.getStorageSlots(addr)
    st.end()
  })

  t.test('should return all slots for account', async (st) => {
    const snapshot = new Snapshot()
    const addrs = [
      new BN(3).toArrayLike(Buffer, 'be', 20), // Hash starts with 0x5b
      new BN(4).toArrayLike(Buffer, 'be', 20), // Hash starts with 0xa8
      new BN(5).toArrayLike(Buffer, 'be', 20) // Hash starts with 0x42
    ]

    // Insert an empty account for all the addresses
    const acc = (new Account()).serialize()
    for (const addr of addrs) {
      await snapshot.putAccount(addr, acc)
    }

    snapshot.getAccounts()

    // Insert these slots to every address
    const slots = [[Buffer.from('01', 'hex'), Buffer.from('2222', 'hex')], [Buffer.from('02', 'hex'), Buffer.from('3333', 'hex')]]
    for (const slot of slots) {
      await snapshot.putStorageSlot(addrs[0], slot[0], slot[1])
      await snapshot.putStorageSlot(addrs[1], slot[0], slot[1])
      await snapshot.putStorageSlot(addrs[2], slot[0], slot[1])
    }

    // Should only get slots for given address
    snapshot.getStorageSlots(addrs[0])

    st.end()
  })
})

tape('snapshot merkleize', (t) => {
  t.test('should merkleize empty snapshot', async (st) => {
    const snapshot = new Snapshot()
    const root = await snapshot.merkleize()
    st.ok(root.equals(KECCAK256_RLP))
    st.end()
  })

  t.test('should merkleize multiple eoa accounts', async (st) => {
    const snapshot = new Snapshot()
    const addrs = [
      new BN(3).toArrayLike(Buffer, 'be', 20), // Hash starts with 0x5b
      new BN(4).toArrayLike(Buffer, 'be', 20), // Hash starts with 0xa8
      new BN(5).toArrayLike(Buffer, 'be', 20) // Hash starts with 0x42
    ]

    // Insert an empty account for all the addresses
    const acc = (new Account()).serialize()
    for (const addr of addrs) {
      await snapshot.putAccount(addr, acc)
    }

    const expectedRoot = await merkleizeViaTrie(addrs.map((v) => [v, acc]))
    const root = await snapshot.merkleize()
    st.ok(root.equals(expectedRoot), `Merkleized root ${root.toString('hex')} should match expected ${expectedRoot.toString('hex')}`)
    st.end()
  })

  t.test('should merkleize accounts with storage', async (st) => {
    const snapshot = new Snapshot()
    const addrs = [
      new BN(3).toArrayLike(Buffer, 'be', 20), // Hash starts with 0x5b
      new BN(4).toArrayLike(Buffer, 'be', 20), // Hash starts with 0xa8
      new BN(5).toArrayLike(Buffer, 'be', 20) // Hash starts with 0x42
    ]

    // Insert an empty account for all the addresses
    const acc = (new Account()).serialize()
    for (const addr of addrs) {
      await snapshot.putAccount(addr, acc)
    }

    const state = new StateManager()
    await state.checkpoint()
    for (const addr of addrs) {
      await state.putAccount(addr, new Account())
    }

    // Insert two of these slots for each account
    const slots = [
      [new BN(21).toArrayLike(Buffer, 'be', 32), Buffer.from('2222', 'hex')],
      [new BN(22).toArrayLike(Buffer, 'be', 32), Buffer.from('3333', 'hex')],
      [new BN(23).toArrayLike(Buffer, 'be', 32), Buffer.from('4444', 'hex')]
    ]
    for (let i = 0; i < addrs.length; i++) {
      let j1 = i
      let j2 = (i + 1) % addrs.length
      await snapshot.putStorageSlot(addrs[i], slots[j1][0], slots[j1][1])
      await state.putContractStorage(addrs[i], slots[j1][0], slots[j1][1])
      await snapshot.putStorageSlot(addrs[i], slots[j2][0], slots[j2][1])
      await state.putContractStorage(addrs[i], slots[j2][0], slots[j2][1])
    }

    await state.commit()
    const expectedRoot = await state.getStateRoot()

    const root = await snapshot.merkleize()
    st.ok(root.equals(expectedRoot), `Merkleized root ${root.toString('hex')} should match expected ${expectedRoot.toString('hex')}`)
    st.end()
  })
})

tape('snapshot checkpointing', t => {
  t.test('should checkpoint and get value from parent', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const val = (new Account()).serialize()
    await snapshot.putAccount(addr, val)

    snapshot.checkpoint()

    const res = await snapshot.getAccount(addr)
    st.ok(val.equals(res))
    st.end()
  })

  t.test('should get recent version after checkpoint update', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const acc = new Account()
    const val = acc.serialize()
    await snapshot.putAccount(addr, val)

    snapshot.checkpoint()

    acc.codeHash = keccak256(Buffer.from('abab', 'hex'))
    await snapshot.putAccount(addr, acc.serialize())

    const res = await snapshot.getAccount(addr)
    st.ok(res.equals(acc.serialize()))
    st.end()
  })

  t.test('should revert change after checkpoint', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const acc = new Account()
    const val = acc.serialize()
    await snapshot.putAccount(addr, val)

    snapshot.checkpoint()

    acc.codeHash = keccak256(Buffer.from('abab', 'hex'))
    await snapshot.putAccount(addr, acc.serialize())

    await snapshot.revert()

    const res = await snapshot.getAccount(addr)
    st.ok(res.equals(val))
    st.end()
  })

  t.test('should commit change after checkpoint', async (st) => {
    const snapshot = new Snapshot()
    const addr = new BN(3).toArrayLike(Buffer, 'be', 20)
    const acc = new Account()
    const val = acc.serialize()
    await snapshot.putAccount(addr, val)

    snapshot.checkpoint()

    acc.codeHash = keccak256(Buffer.from('abab', 'hex'))
    await snapshot.putAccount(addr, acc.serialize())

    await snapshot.commit()

    const res = await snapshot.getAccount(addr)
    st.ok(res.equals(acc.serialize()))
    st.end()
  })
})

async function merkleizeViaTrie (leaves) {
  const trie = new Trie()
  const put = promisify(trie.put.bind(trie))
  for (let leaf of leaves) {
    await put(leaf[0], leaf[1])
  }
  return trie.root
}
