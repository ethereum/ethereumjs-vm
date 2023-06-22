import { Trie } from '@ethereumjs/trie'
import {
  Account,
  Address,
  bytesToHex,
  hexStringToBytes,
  randomBytes,
  zeros,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { assert, describe, it } from 'vitest'

import { DefaultStateManager } from '../src/index.js'

import * as ropsten_contractWithStorage from './testdata/ropsten_contractWithStorage.json'
import * as ropsten_nonexistentAccount from './testdata/ropsten_nonexistentAccount.json'
import * as ropsten_validAccount from './testdata/ropsten_validAccount.json'

describe('ProofStateManager', async () => {
  it(`should get and verify EIP 1178 proofs`, async () => {
    const address = Address.zero()
    const key = zeros(32)
    const value = hexStringToBytes('0000aabb00')
    const code = hexStringToBytes('6000')
    const stateManager = new DefaultStateManager()
    await stateManager.checkpoint()
    await stateManager.putAccount(address, new Account())
    await stateManager.putContractStorage(address, key, value)
    await stateManager.putContractCode(address, code)
    const account = await stateManager.getAccount(address)
    account!.balance = BigInt(1)
    account!.nonce = BigInt(2)
    await stateManager.putAccount(address, account!)
    const address2 = new Address(hexStringToBytes('20'.repeat(20)))
    const account2 = await stateManager.getAccount(address2)
    account!.nonce = BigInt(2)
    await stateManager.putAccount(address2, account2!)
    await stateManager.commit()
    await stateManager.flush()
    it('should get and verify a proof', async () => {
      const proof = await stateManager.getProof(address, [key])
      const verified = await stateManager.verifyProof(proof)
      assert.ok(verified, 'verified proof')
    })
    it('should get and verify a proof of non-existence', async () => {
      const nonExistenceProof = await stateManager.getProof(Address.fromPrivateKey(randomBytes(32)))
      const verifiedNonExistent = await stateManager.verifyProof(nonExistenceProof)
      assert.equal(verifiedNonExistent, true, 'verified proof of non-existence of account')
    })
  })

  it(`should report data equal to geth output for EIP 1178 proofs`, async () => {
    // Data source: Ropsten, retrieved with Geth eth_getProof
    // Block: 11098094 (hash 0x1d9ea6981b8093a2b63f22f74426ceb6ba1acae3fddd7831442bbeba3fa4f146)
    // Account: 0xc626553e7c821d0f8308c28d56c60e3c15f8d55a
    // Storage slots: empty list
    const address = Address.fromString('0xc626553e7c821d0f8308c28d56c60e3c15f8d55a')
    const trie = await Trie.create({ useKeyHashing: true })
    const stateManager = new DefaultStateManager({ trie })
    // Dump all the account proof data in the DB
    let stateRoot: Uint8Array | undefined
    for (const proofData of ropsten_validAccount.accountProof) {
      const bufferData = hexStringToBytes(proofData)
      const key = keccak256(bufferData)
      if (stateRoot === undefined) {
        stateRoot = key
      }
      // @ts-expect-error
      await trie._db.put(key, bufferData)
    }
    trie.root(stateRoot!)
    it('should create matching proof', async () => {
      const proof = await stateManager.getProof(address)
      assert.deepEqual((ropsten_validAccount as any).default, proof)
    })
    it('should verify valid proof', async () => {
      const verified = await stateManager.verifyProof((ropsten_validAccount as any).default)
      assert.ok(verified, 'verified proof')
    })
    it('should report data equal to geth output for EIP 1178 proofs - nonexistent account', async () => {
      // Data source: Ropsten, retrieved with Geth eth_getProof
      // Block: 11098094 (hash 0x1d9ea6981b8093a2b63f22f74426ceb6ba1acae3fddd7831442bbeba3fa4f146)
      // Account: 0x68268f12253f69f66b188c95b8106b2f847859fc (this account does not exist)
      // Storage slots: empty list
      const address = Address.fromString('0x68268f12253f69f66b188c95b8106b2f847859fc')
      const trie = new Trie({ useKeyHashing: true })
      const stateManager = new DefaultStateManager({ trie })
      // Dump all the account proof data in the DB
      let stateRoot: Uint8Array | undefined
      for (const proofData of ropsten_nonexistentAccount.accountProof) {
        const bufferData = hexStringToBytes(proofData)
        const key = keccak256(bufferData)
        if (stateRoot === undefined) {
          stateRoot = key
        }
        // @ts-expect-error
        await trie._db.put(key, bufferData)
      }
      trie.root(stateRoot!)
      await stateManager.putAccount(address, new Account())
      it('should create matching proof', async () => {
        const proof = await stateManager.getProof(address)
        assert.deepEqual((ropsten_nonexistentAccount as any).default, proof)
      })
      it('should verify valid proof', async () => {
        const verified = await stateManager.verifyProof((ropsten_nonexistentAccount as any).default)
        assert.ok(verified, 'verified proof')
      })
    })

    it('should report data equal to geth output for EIP 1178 proofs - account with storage', async () => {
      // Data source: Ropsten, retrieved with Geth eth_getProof
      // eth.getProof("0x2D80502854FC7304c3E3457084DE549f5016B73f", ["0x1e8bf26b05059b66f11b6e0c5b9fe941f81181d6cc9f2af65ccee86e95cea1ca", "0x1e8bf26b05059b66f11b6e0c5b9fe941f81181d6cc9f2af65ccee86e95cea1cb"], 11098094)
      // Note: the first slot has a value, but the second slot is empty
      // Note: block hash 0x1d9ea6981b8093a2b63f22f74426ceb6ba1acae3fddd7831442bbeba3fa4f146
      const address = Address.fromString('0x2D80502854FC7304c3E3457084DE549f5016B73f')
      const trie = new Trie({ useKeyHashing: true })
      const stateManager = new DefaultStateManager({ trie })
      // Dump all the account proof data in the DB
      let stateRoot: Uint8Array | undefined
      for (const proofData of ropsten_contractWithStorage.accountProof) {
        const bufferData = hexStringToBytes(proofData)
        const key = keccak256(bufferData)
        if (stateRoot === undefined) {
          stateRoot = key
        }
        // @ts-expect-error
        await trie._db.put(key, bufferData)
      }
      const storageRoot = ropsten_contractWithStorage.storageHash
      const storageTrie = new Trie({ useKeyHashing: true })
      const storageKeys: Uint8Array[] = []
      for (const storageProofsData of ropsten_contractWithStorage.storageProof) {
        storageKeys.push(hexStringToBytes(storageProofsData.key))
        for (const storageProofData of storageProofsData.proof) {
          const key = keccak256(hexStringToBytes(storageProofData))
          // @ts-expect-error
          await storageTrie._db.put(key, hexStringToBytes(storageProofData))
        }
      }
      storageTrie.root(hexStringToBytes(storageRoot))
      const addressHex = bytesToHex(address.bytes)
      stateManager._storageTries[addressHex] = storageTrie
      trie.root(stateRoot!)
      it('should create matching proof', async () => {
        const proof = await stateManager.getProof(address, storageKeys)
        assert.deepEqual((ropsten_contractWithStorage as any).default, proof)
      })
      it('should verify a proof', async () => {
        assert.ok(await stateManager.verifyProof(ropsten_contractWithStorage))
      })
    })

    it(`should throw on invalid proofs - existing accounts/slots`, async () => {
      // Data source: Ropsten, retrieved with Geth eth_getProof
      // eth.getProof("0x2D80502854FC7304c3E3457084DE549f5016B73f", ["0x1e8bf26b05059b66f11b6e0c5b9fe941f81181d6cc9f2af65ccee86e95cea1ca", "0x1e8bf26b05059b66f11b6e0c5b9fe941f81181d6cc9f2af65ccee86e95cea1cb"], 11098094)
      // Note: the first slot has a value, but the second slot is empty
      // Note: block hash 0x1d9ea6981b8093a2b63f22f74426ceb6ba1acae3fddd7831442bbeba3fa4f146
      const address = Address.fromString('0x2D80502854FC7304c3E3457084DE549f5016B73f')
      const trie = new Trie({ useKeyHashing: true })
      const stateManager = new DefaultStateManager({ trie })
      // Dump all the account proof data in the DB
      let stateRoot: Uint8Array | undefined
      for (const proofData of ropsten_contractWithStorage.accountProof) {
        const bufferData = hexStringToBytes(proofData)
        const key = keccak256(bufferData)
        if (stateRoot === undefined) {
          stateRoot = key
        }
        // @ts-expect-error
        await trie._db.put(key, bufferData)
      }
      const storageRoot = ropsten_contractWithStorage.storageHash
      const storageTrie = new Trie({ useKeyHashing: true })
      const storageKeys: Uint8Array[] = []
      for (const storageProofsData of ropsten_contractWithStorage.storageProof) {
        storageKeys.push(hexStringToBytes(storageProofsData.key))
        for (const storageProofData of storageProofsData.proof) {
          const key = keccak256(hexStringToBytes(storageProofData))
          // @ts-expect-error
          await storageTrie._db.put(key, hexStringToBytes(storageProofData))
        }
      }
      storageTrie.root(hexStringToBytes(storageRoot))
      const addressHex = bytesToHex(address.bytes)
      stateManager._storageTries[addressHex] = storageTrie
      trie.root(stateRoot!)

      // tamper with account data
      const testdata = { ...(ropsten_contractWithStorage as any) }
      for (const tamper of ['nonce', 'balance', 'codeHash', 'storageHash']) {
        const original = testdata[tamper]
        try {
          const newField = `0x9${original.slice(3)}`
          testdata[tamper] = newField
          await stateManager.verifyProof(testdata)
          // note: this implicitly means that newField !== original,
          // if newField === original then the proof would be valid and test would fail
          assert.fail('should throw')
        } catch (e) {
          assert.ok(true, 'threw on invalid proof')
        } finally {
          testdata[tamper] = original
        }
      }

      // tamper with storage slots
      for (const slot of testdata.storageProof) {
        const original = slot.value
        slot.value = `0x9${original.slice(3)}`
        try {
          await stateManager.verifyProof(testdata)
          assert.fail('should throw')
        } catch {
          assert.ok(true, 'threw on invalid proof')
        } finally {
          slot.value = original
        }
      }
    })

    it(`should throw on invalid proofs - nonexistent account`, async () => {
      // Data source: Ropsten, retrieved with Geth eth_getProof
      // eth.getProof("0x2D80502854FC7304c3E3457084DE549f5016B73f", ["0x1e8bf26b05059b66f11b6e0c5b9fe941f81181d6cc9f2af65ccee86e95cea1ca", "0x1e8bf26b05059b66f11b6e0c5b9fe941f81181d6cc9f2af65ccee86e95cea1cb"], 11098094)
      // Note: the first slot has a value, but the second slot is empty
      // Note: block hash 0x1d9ea6981b8093a2b63f22f74426ceb6ba1acae3fddd7831442bbeba3fa4f146
      const address = Address.fromString('0x68268f12253f69f66b188c95b8106b2f847859fc')
      const trie = new Trie({ useKeyHashing: true })
      const stateManager = new DefaultStateManager({ trie })
      // Dump all the account proof data in the DB
      let stateRoot: Uint8Array | undefined
      for (const proofData of ropsten_nonexistentAccount.accountProof) {
        const bufferData = hexStringToBytes(proofData)
        const key = keccak256(bufferData)
        if (stateRoot === undefined) {
          stateRoot = key
        }
        // @ts-expect-error
        await trie._db.put(key, bufferData)
      }
      const storageRoot = ropsten_nonexistentAccount.storageHash
      const storageTrie = new Trie({ useKeyHashing: true })
      storageTrie.root(hexStringToBytes(storageRoot))
      const addressHex = bytesToHex(address.bytes)
      stateManager._storageTries[addressHex] = storageTrie
      trie.root(stateRoot!)

      // tamper with account data
      const testdata = { ...(ropsten_nonexistentAccount as any) }
      for (const tamper of ['nonce', 'balance', 'codeHash', 'storageHash']) {
        const original = testdata[tamper]
        try {
          const newField = `0x9${original.slice(3)}`
          testdata[tamper] = newField
          await stateManager.verifyProof(testdata)
          // note: this implicitly means that newField !== original,
          // if newField === original then the proof would be valid and test would fail
          assert.fail('should throw')
        } catch (e) {
          assert.ok(true, 'threw on invalid proof')
        } finally {
          // restore original valid proof
          testdata[tamper] = original
        }
      }
    })
  })
})
