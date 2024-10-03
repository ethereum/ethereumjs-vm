import { Chain } from '@ethereumjs/common'
import { getGenesis } from '@ethereumjs/genesis'
import { Account, Address, hexToBytes, utf8ToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { MerkleStateManager } from '../src/index.js'

export function createAccount(nonce = BigInt(0), balance = BigInt(0xfff384)) {
  return new Account(nonce, balance)
}

// Hack to detect if running in browser or not
const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')

const StateManager = MerkleStateManager

describe('stateManager', () => {
  it(`should generate the genesis state root correctly for mainnet from common`, async () => {
    if (isBrowser() === true) {
      return
    }
    const expectedStateRoot = hexToBytes(
      '0xd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544',
    )
    const stateManager = new StateManager()

    await stateManager.generateCanonicalGenesis(getGenesis(Chain.Mainnet))
    const stateRoot = await stateManager.getStateRoot()

    assert.deepEqual(
      stateRoot,
      expectedStateRoot,
      `generateCanonicalGenesis should produce correct state root for mainnet from common`,
    )
  })

  it(`should generate the genesis state root correctly for all other chains`, async () => {
    const chains: [Chain, Uint8Array][] = [
      [
        Chain.Goerli,
        hexToBytes('0x5d6cded585e73c4e322c30c2f782a336316f17dd85a4863b9d838d2d4b8b3008'),
      ],
      [
        Chain.Sepolia,
        hexToBytes('0x5eb6e371a698b8d68f665192350ffcecbbbf322916f4b51bd79bb6887da3f494'),
      ],
    ]

    for (const [chain, expectedStateRoot] of chains) {
      const stateManager = new MerkleStateManager()

      await stateManager.generateCanonicalGenesis(getGenesis(chain))
      const stateRoot = await stateManager.getStateRoot()

      assert.deepEqual(
        stateRoot,
        expectedStateRoot,
        `generateCanonicalGenesis should produce correct state root for ${Chain[chain]}`,
      )
    }
  })
})

describe('Original storage cache', async () => {
  const stateManager = new MerkleStateManager()

  const address = new Address(hexToBytes('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
  const account = createAccount()
  await stateManager.putAccount(address, account)

  const key = hexToBytes('0x1234567890123456789012345678901234567890123456789012345678901234')
  const value = hexToBytes('0x1234')

  it(`should initially have empty storage value`, async () => {
    await stateManager.checkpoint()
    const res = await stateManager.getStorage(address, key)
    assert.deepEqual(res, new Uint8Array(0))

    const origRes = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(origRes, new Uint8Array(0))

    await stateManager.commit()
  })

  it(`should set original storage value`, async () => {
    await stateManager.putStorage(address, key, value)
    const res = await stateManager.getStorage(address, key)
    assert.deepEqual(res, value)
  })

  it(`should get original storage value`, async () => {
    const res = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(res, value)
  })

  it(`should return correct original value after modification`, async () => {
    const newValue = hexToBytes('0x1235')
    await stateManager.putStorage(address, key, newValue)
    const res = await stateManager.getStorage(address, key)
    assert.deepEqual(res, newValue)

    const origRes = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(origRes, value)
  })

  it(`should cache keys separately`, async () => {
    const key2 = hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000012')
    const value2 = utf8ToBytes('12')
    const value3 = utf8ToBytes('123')
    await stateManager.putStorage(address, key2, value2)

    let res = await stateManager.getStorage(address, key2)
    assert.deepEqual(res, value2)
    let origRes = await stateManager.originalStorageCache.get(address, key2)
    assert.deepEqual(origRes, value2)

    await stateManager.putStorage(address, key2, value3)

    res = await stateManager.getStorage(address, key2)
    assert.deepEqual(res, value3)
    origRes = await stateManager.originalStorageCache.get(address, key2)
    assert.deepEqual(origRes, value2)

    // Check previous key
    res = await stateManager.getStorage(address, key)
    assert.deepEqual(res, hexToBytes('0x1235'))
    origRes = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(origRes, value)
  })

  it("getOriginalContractStorage should validate the key's length", async () => {
    try {
      await stateManager.originalStorageCache.get(address, new Uint8Array(12))
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.equal(e.message, 'Storage key must be 32 bytes long')
      return
    }

    assert.fail('Should have failed')
  })
})
