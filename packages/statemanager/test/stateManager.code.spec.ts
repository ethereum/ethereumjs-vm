import {
  Address,
  createAccount,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Caches, DefaultStateManager } from '../src/index.js'

import { createAccountWithDefaults } from './util.js'

import type { AccountData } from '@ethereumjs/util'

describe('StateManager -> Code', () => {
  for (const accountCacheOpts of [{ size: 1000 }, { size: 0 }]) {
    for (const codeCacheOpts of [{ size: 1000 }, { size: 0 }]) {
      it(`should store codehashes using a prefix`, async () => {
        /*
          This test is mostly an example of why a code prefix is necessary
          I an address, we put two storage values. The preimage of the (storage trie) root hash is known
          This preimage is used as codeHash

          NOTE: Currently, the only problem which this code prefix fixes, is putting 0x80 as contract code
          -> This hashes to the empty trie node hash (0x80 = RLP([])), so keccak256(0x80) = empty trie node hash
          -> Therefore, each empty state trie now points to 0x80, which is not a valid trie node, which crashes @ethereumjs/trie
        */

        // Setup
        const stateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const codeStateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address1 = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccountWithDefaults()
        const key1 = hexToBytes(`0x${'00'.repeat(32)}`)
        const key2 = hexToBytes(`0x${'00'.repeat(31)}01`)

        await stateManager.putAccount(address1, account)
        await stateManager.putStorage(address1, key1, key2)
        await stateManager.putStorage(address1, key2, key2)
        const root = await stateManager.getStateRoot()
        const rawNode = await stateManager['_trie']['_db'].get(root)

        await codeStateManager.putCode(address1, rawNode!)

        let codeSlot1 = await codeStateManager.getStorage(address1, key1)
        let codeSlot2 = await codeStateManager.getStorage(address1, key2)

        assert.ok(codeSlot1.length === 0, 'slot 0 is empty')
        assert.ok(codeSlot2.length === 0, 'slot 1 is empty')

        const code = await codeStateManager.getCode(address1)
        assert.ok(code.length > 0, 'code deposited correctly')

        const slot1 = await stateManager.getStorage(address1, key1)
        const slot2 = await stateManager.getStorage(address1, key2)

        assert.ok(slot1.length > 0, 'storage key0 deposited correctly')
        assert.ok(slot2.length > 0, 'storage key1 deposited correctly')

        let slotCode = await stateManager.getCode(address1)
        assert.ok(slotCode.length === 0, 'code cannot be loaded')

        // Checks by either setting state root to codeHash, or codeHash to stateRoot
        // The knowledge of the tries should not change
        let account1 = await stateManager.getAccount(address1)
        account1!.codeHash = root

        await stateManager.putAccount(address1, account1!)

        slotCode = await stateManager.getCode(address1)
        assert.ok(slotCode.length === 0, 'code cannot be loaded') // This test fails if no code prefix is used

        account1 = await codeStateManager.getAccount(address1)
        account1!.storageRoot = root

        await codeStateManager.putAccount(address1, account1!)

        codeSlot1 = await codeStateManager.getStorage(address1, key1)
        codeSlot2 = await codeStateManager.getStorage(address1, key2)

        assert.ok(codeSlot1.length === 0, 'slot 0 is empty')
        assert.ok(codeSlot2.length === 0, 'slot 1 is empty')
      })

      it(`should set and get code`, async () => {
        const stateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const code = hexToBytes(
          '0x73095e7baea6a6c7c4c2dfeb977efac326af552d873173095e7baea6a6c7c4c2dfeb977efac326af552d873157',
        )
        const raw: AccountData = {
          nonce: '0x0',
          balance: '0x03e7',
          codeHash: '0xb30fb32201fe0486606ad451e1a61e2ae1748343cd3d411ed992ffcc0774edd4',
        }
        const account = createAccount(raw)
        await stateManager.putAccount(address, account)
        await stateManager.putCode(address, code)
        const codeRetrieved = await stateManager.getCode(address)
        assert.ok(equalsBytes(code, codeRetrieved))
      })

      it(`should not get code if is not contract`, async () => {
        const stateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const raw: AccountData = {
          nonce: '0x0',
          balance: '0x03e7',
        }
        const account = createAccount(raw)
        await stateManager.putAccount(address, account)
        const code = await stateManager.getCode(address)
        assert.ok(equalsBytes(code, new Uint8Array(0)))
      })

      it(`should set empty code`, async () => {
        const stateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const raw: AccountData = {
          nonce: '0x0',
          balance: '0x03e7',
        }
        const account = createAccount(raw)
        const code = new Uint8Array(0)
        await stateManager.putAccount(address, account)
        await stateManager.putCode(address, code)
        const codeRetrieved = await stateManager.getCode(address)
        assert.ok(equalsBytes(codeRetrieved, new Uint8Array(0)))
      })

      it(`should prefix codehashes by default`, async () => {
        const stateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const code = hexToBytes('0x80')
        await stateManager.putCode(address, code)
        const codeRetrieved = await stateManager.getCode(address)
        assert.ok(equalsBytes(codeRetrieved, code))
      })

      it(`should not prefix codehashes if prefixCodeHashes = false`, async () => {
        const stateManager = new DefaultStateManager({
          prefixCodeHashes: false,
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const code = hexToBytes('0x80')
        try {
          await stateManager.putCode(address, code)
          assert.fail('should throw')
        } catch {
          assert.ok(true, 'successfully threw')
        }
      })

      it('putCode with empty code on existing address should correctly propagate', async () => {
        const stateManager = new DefaultStateManager({
          caches: new Caches({ account: accountCacheOpts, code: codeCacheOpts }),
        })
        const address = createZeroAddress()
        await stateManager.putCode(address, new Uint8Array([1]))
        await stateManager.putCode(address, new Uint8Array())
        const account = await stateManager.getAccount(address)
        assert.ok(account !== undefined)
        assert.ok(account?.isEmpty())
      })
    }
  }
})
