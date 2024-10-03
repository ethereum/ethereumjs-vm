import {
  Address,
  bytesToHex,
  concatBytes,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
  unpadBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { assert, describe, it } from 'vitest'

import { Caches, MerkleStateManager } from '../src/index.js'

import { createAccountWithDefaults } from './util.js'

const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')
describe('StateManager -> Storage', () => {
  for (const storageCacheOpts of [{ size: 1000 }, { size: 0 }]) {
    for (const prefixStorageTrieKeys of [false, true]) {
      it.skipIf(isBrowser() === true)(`should dump storage`, async () => {
        const stateManager = new MerkleStateManager({
          prefixStorageTrieKeys,
          caches: new Caches({ storage: storageCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccountWithDefaults()

        await stateManager.putAccount(address, account)

        const key = hexToBytes('0x1234567890123456789012345678901234567890123456789012345678901234')
        const value = hexToBytes('0x0a') // We used this value as its RLP encoding is also 0a
        await stateManager.putStorage(address, key, value)

        const data = await stateManager.dumpStorage(address)
        const expect = { [bytesToHex(keccak256(key))]: '0x0a' }
        assert.deepEqual(data, expect, 'should dump storage value')
      })

      it("should validate the key's length when modifying a contract's storage", async () => {
        const stateManager = new MerkleStateManager({
          prefixStorageTrieKeys,
          caches: new Caches({ storage: storageCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccountWithDefaults()
        await stateManager.putAccount(address, account)

        try {
          await stateManager.putStorage(address, new Uint8Array(12), hexToBytes('0x1231'))
        } catch (e) {
          if (!(e instanceof Error)) {
            e = new Error(e)
          }
          assert.equal(e.message, 'Storage key must be 32 bytes long')
          return
        }

        assert.fail('Should have failed')
      })

      it("should validate the key's length when reading a contract's storage", async () => {
        const stateManager = new MerkleStateManager({
          prefixStorageTrieKeys,
          caches: new Caches({ storage: storageCacheOpts }),
        })
        const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccountWithDefaults()
        await stateManager.putAccount(address, account)

        try {
          await stateManager.getStorage(address, new Uint8Array(12))
        } catch (e) {
          if (!(e instanceof Error)) {
            e = new Error(e)
          }
          assert.equal(e.message, 'Storage key must be 32 bytes long')
          return
        }

        assert.fail('Should have failed')
      })

      it(`should throw on storage values larger than 32 bytes`, async () => {
        const stateManager = new MerkleStateManager({
          prefixStorageTrieKeys,
          caches: new Caches({ storage: storageCacheOpts }),
        })
        const address = createZeroAddress()
        const account = createAccountWithDefaults()
        await stateManager.putAccount(address, account)

        const key = new Uint8Array(32)
        const value = hexToBytes(`0x${'aa'.repeat(33)}`)
        try {
          await stateManager.putStorage(address, key, value)
          assert.fail('did not throw')
        } catch (e) {
          if (!(e instanceof Error)) {
            e = new Error(e)
          }
          assert.ok(true, 'threw on trying to set storage values larger than 32 bytes')
        }
      })

      it(`should strip zeros of storage values`, async () => {
        const stateManager = new MerkleStateManager({
          prefixStorageTrieKeys,
          caches: new Caches({ storage: storageCacheOpts }),
        })
        const address = createZeroAddress()
        const account = createAccountWithDefaults()
        await stateManager.putAccount(address, account)

        const key0 = new Uint8Array(32)
        const value0 = hexToBytes(`0x00${'aa'.repeat(30)}`) // put a value of 31-bytes length with a leading zero byte
        const expect0 = unpadBytes(value0)
        await stateManager.putStorage(address, key0, value0)
        const slot0 = await stateManager.getStorage(address, key0)
        assert.ok(equalsBytes(slot0, expect0), 'value of 31 bytes padded correctly')

        const key1 = concatBytes(new Uint8Array(31), hexToBytes('0x01'))
        const value1 = hexToBytes(`0x0000${'aa'.repeat(1)}`) // put a value of 1-byte length with two leading zero bytes
        const expect1 = unpadBytes(value1)
        await stateManager.putStorage(address, key1, value1)
        const slot1 = await stateManager.getStorage(address, key1)

        assert.ok(equalsBytes(slot1, expect1), 'value of 1 byte padded correctly')
      })

      it(`should delete storage values which only consist of zero bytes`, async () => {
        const address = createZeroAddress()
        const key = new Uint8Array(32)

        const startValue = hexToBytes('0x01')

        const zeroLengths = [0, 1, 31, 32] // checks for arbitrary-length zeros

        for (const length of zeroLengths) {
          const stateManager = new MerkleStateManager({
            prefixStorageTrieKeys,
            caches: new Caches({ storage: storageCacheOpts }),
          })
          const account = createAccountWithDefaults()
          await stateManager.putAccount(address, account)

          const value = new Uint8Array(length)
          await stateManager.putStorage(address, key, startValue)
          const currentValue = await stateManager.getStorage(address, key)
          if (!equalsBytes(currentValue, startValue)) {
            // sanity check
            assert.fail('contract value not set correctly')
          } else {
            // delete the value
            await stateManager.putStorage(address, key, value)
            const deleted = await stateManager.getStorage(address, key)
            assert.ok(equalsBytes(deleted, new Uint8Array()), 'the storage key should be deleted')
          }
        }
      })

      it(`should not strip trailing zeros`, async () => {
        const stateManager = new MerkleStateManager({
          prefixStorageTrieKeys,
          caches: new Caches({ storage: storageCacheOpts }),
        })
        const address = createZeroAddress()
        const account = createAccountWithDefaults()
        await stateManager.putAccount(address, account)

        const key = new Uint8Array(32)
        const value = hexToBytes('0x0000aabb00')
        const expect = hexToBytes('0xaabb00')

        await stateManager.putStorage(address, key, value)
        const contractValue = await stateManager.getStorage(address, key)
        assert.ok(equalsBytes(contractValue, expect), 'trailing zeros are not stripped')
      })
    }
  }
})
