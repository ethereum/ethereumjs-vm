import { Address, hexStringToBytes, unpadBytes, zeros } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { bytesToHex, concatBytes, equalsBytes } from 'ethereum-cryptography/utils.js'
import { assert, describe, it } from 'vitest'
// explicitly import `inherits` to fix karma-typescript issue
// eslint-disable-next-line @typescript-eslint/no-unused-vars

import { DefaultStateManager } from '../src/index.js'

import { createAccount } from './util.js'

describe('StateManager -> Storage', async () => {
  for (const storageCacheOpts of [{ deactivate: false }, { deactivate: true }]) {
    it('should run tests', async () => {
      it(`should dump storage`, async () => {
        const stateManager = new DefaultStateManager({ storageCacheOpts })
        const address = new Address(hexStringToBytes('a94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccount()

        await stateManager.putAccount(address, account)

        const key = hexStringToBytes(
          '1234567890123456789012345678901234567890123456789012345678901234'
        )
        const value = hexStringToBytes('0a') // We used this value as its RLP encoding is also 0a
        await stateManager.putContractStorage(address, key, value)

        const data = await stateManager.dumpStorage(address)
        const expect = { [bytesToHex(keccak256(key))]: '0a' }
        assert.deepEqual(data, expect, 'should dump storage value')
      })

      it("should validate the key's length when modifying a contract's storage", async () => {
        const stateManager = new DefaultStateManager({ storageCacheOpts })
        const address = new Address(hexStringToBytes('a94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccount()
        await stateManager.putAccount(address, account)

        try {
          await stateManager.putContractStorage(
            address,
            new Uint8Array(12),
            hexStringToBytes('1231')
          )
        } catch (e: any) {
          assert.equal(e.message, 'Storage key must be 32 bytes long')
          return
        }

        assert.fail('Should have failed')
      })

      it("should validate the key's length when reading a contract's storage", async () => {
        const stateManager = new DefaultStateManager({ storageCacheOpts })
        const address = new Address(hexStringToBytes('a94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
        const account = createAccount()
        await stateManager.putAccount(address, account)

        try {
          await stateManager.getContractStorage(address, new Uint8Array(12))
        } catch (e: any) {
          assert.equal(e.message, 'Storage key must be 32 bytes long')
          return
        }

        assert.fail('Should have failed')
      })

      it(`should throw on storage values larger than 32 bytes`, async () => {
        const stateManager = new DefaultStateManager({ storageCacheOpts })
        const address = Address.zero()
        const account = createAccount()
        await stateManager.putAccount(address, account)

        const key = zeros(32)
        const value = hexStringToBytes('aa'.repeat(33))
        try {
          await stateManager.putContractStorage(address, key, value)
          assert.fail('did not throw')
        } catch (e: any) {
          assert.ok(true, 'threw on trying to set storage values larger than 32 bytes')
        }
      })

      it(`should strip zeros of storage values`, async () => {
        const stateManager = new DefaultStateManager({ storageCacheOpts })
        const address = Address.zero()
        const account = createAccount()
        await stateManager.putAccount(address, account)

        const key0 = zeros(32)
        const value0 = hexStringToBytes('00' + 'aa'.repeat(30)) // put a value of 31-bytes length with a leading zero byte
        const expect0 = unpadBytes(value0)
        await stateManager.putContractStorage(address, key0, value0)
        const slot0 = await stateManager.getContractStorage(address, key0)
        assert.ok(equalsBytes(slot0, expect0), 'value of 31 bytes padded correctly')

        const key1 = concatBytes(zeros(31), hexStringToBytes('01'))
        const value1 = hexStringToBytes('0000' + 'aa'.repeat(1)) // put a value of 1-byte length with two leading zero bytes
        const expect1 = unpadBytes(value1)
        await stateManager.putContractStorage(address, key1, value1)
        const slot1 = await stateManager.getContractStorage(address, key1)

        assert.ok(equalsBytes(slot1, expect1), 'value of 1 byte padded correctly')
      })

      it(`should delete storage values which only consist of zero bytes`, async () => {
        const address = Address.zero()
        const key = zeros(32)

        const startValue = hexStringToBytes('01')

        const zeroLengths = [0, 1, 31, 32] // checks for arbitrary-length zeros

        for (const length of zeroLengths) {
          const stateManager = new DefaultStateManager({ storageCacheOpts })
          const account = createAccount()
          await stateManager.putAccount(address, account)

          const value = zeros(length)
          await stateManager.putContractStorage(address, key, startValue)
          const currentValue = await stateManager.getContractStorage(address, key)
          if (!equalsBytes(currentValue, startValue)) {
            // sanity check
            assert.fail('contract value not set correctly')
          } else {
            // delete the value
            await stateManager.putContractStorage(address, key, value)
            const deleted = await stateManager.getContractStorage(address, key)
            assert.ok(equalsBytes(deleted, zeros(0)), 'the storage key should be deleted')
          }
        }
      })

      it(`should not strip trailing zeros`, async () => {
        const stateManager = new DefaultStateManager({ storageCacheOpts })
        const address = Address.zero()
        const account = createAccount()
        await stateManager.putAccount(address, account)

        const key = zeros(32)
        const value = hexStringToBytes('0000aabb00')
        const expect = hexStringToBytes('aabb00')

        await stateManager.putContractStorage(address, key, value)
        const contractValue = await stateManager.getContractStorage(address, key)
        assert.ok(equalsBytes(contractValue, expect), 'trailing zeros are not stripped')
      })
    })
  }
})
