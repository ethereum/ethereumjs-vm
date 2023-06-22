import { Blockchain } from '@ethereumjs/blockchain'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Account, Address } from '@ethereumjs/util'
import { hexToBytes, utf8ToBytes } from 'ethereum-cryptography/utils.js'
import { assert, describe, it } from 'vitest'

import { DefaultStateManager } from '../src/index.js'

export function createAccount(nonce = BigInt(0), balance = BigInt(0xfff384)) {
  return new Account(nonce, balance)
}

export function isBrowser(): boolean {
  // eslint-disable-next-line no-undef
  return typeof (<any>globalThis).window !== 'undefined' && (<any>globalThis).window.__karma__
}

const StateManager = DefaultStateManager

describe('stateManager', async () => {
  it(
    `should generate the genesis state root correctly for mainnet from common`,
    async () => {
      if (isBrowser()) {
        return
      }
      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Petersburg })
      const expectedStateRoot = hexToBytes(
        'd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544'
      )
      const stateManager = new StateManager({})

      const blockchain = await Blockchain.create({ common })
      await stateManager.generateCanonicalGenesis(blockchain.genesisState())
      const stateRoot = await stateManager.getStateRoot()

      assert.deepEqual(
        stateRoot,
        expectedStateRoot,
        `generateCanonicalGenesis should produce correct state root for mainnet from common`
      )
    },
    { timeout: 100000 }
  )

  it(`should generate the genesis state root correctly for all other chains`, async () => {
    const chains: [Chain, Uint8Array][] = [
      [
        Chain.Ropsten,
        hexToBytes('217b0bbcfb72e2d57e28f33cb361b9983513177755dc3f33ce3e7022ed62b77b'),
      ],
      [
        Chain.Rinkeby,
        hexToBytes('53580584816f617295ea26c0e17641e0120cab2f0a8ffb53a866fd53aa8e8c2d'),
      ],
      [
        Chain.Goerli,
        hexToBytes('5d6cded585e73c4e322c30c2f782a336316f17dd85a4863b9d838d2d4b8b3008'),
      ],
      [
        Chain.Sepolia,
        hexToBytes('5eb6e371a698b8d68f665192350ffcecbbbf322916f4b51bd79bb6887da3f494'),
      ],
    ]

    for (const [chain, expectedStateRoot] of chains) {
      it('should generate the genesis root', async () => {
        const common = new Common({ chain, hardfork: Hardfork.Chainstart })
        const stateManager = new DefaultStateManager({})

        const blockchain = await Blockchain.create({ common })
        await stateManager.generateCanonicalGenesis(blockchain.genesisState())
        const stateRoot = await stateManager.getStateRoot()

        assert.deepEqual(
          stateRoot,
          expectedStateRoot,
          `generateCanonicalGenesis should produce correct state root for ${Chain[chain]}`
        )
      })
    }
  })
})

describe('Original storage cache', async () => {
  const stateManager = new DefaultStateManager()

  const address = new Address(hexToBytes('a94f5374fce5edbc8e2a8697c15331677e6ebf0b'))
  const account = createAccount()
  await stateManager.putAccount(address, account)

  const key = hexToBytes('1234567890123456789012345678901234567890123456789012345678901234')
  const value = hexToBytes('1234')

  it(`should initially have empty storage value`, async () => {
    await stateManager.checkpoint()
    const res = await stateManager.getContractStorage(address, key)
    assert.deepEqual(res, new Uint8Array(0))

    const origRes = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(origRes, new Uint8Array(0))

    await stateManager.commit()
  })

  it(`should set original storage value`, async () => {
    await stateManager.putContractStorage(address, key, value)
    const res = await stateManager.getContractStorage(address, key)
    assert.deepEqual(res, value)
  })

  it(`should get original storage value`, async () => {
    const res = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(res, value)
  })

  it(`should return correct original value after modification`, async () => {
    const newValue = hexToBytes('1235')
    await stateManager.putContractStorage(address, key, newValue)
    const res = await stateManager.getContractStorage(address, key)
    assert.deepEqual(res, newValue)

    const origRes = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(origRes, value)
  })

  it(`should cache keys separately`, async () => {
    const key2 = hexToBytes('0000000000000000000000000000000000000000000000000000000000000012')
    const value2 = utf8ToBytes('12')
    const value3 = utf8ToBytes('123')
    await stateManager.putContractStorage(address, key2, value2)

    let res = await stateManager.getContractStorage(address, key2)
    assert.deepEqual(res, value2)
    let origRes = await stateManager.originalStorageCache.get(address, key2)
    assert.deepEqual(origRes, value2)

    await stateManager.putContractStorage(address, key2, value3)

    res = await stateManager.getContractStorage(address, key2)
    assert.deepEqual(res, value3)
    origRes = await stateManager.originalStorageCache.get(address, key2)
    assert.deepEqual(origRes, value2)

    // Check previous key
    res = await stateManager.getContractStorage(address, key)
    assert.deepEqual(res, hexToBytes('1235'))
    origRes = await stateManager.originalStorageCache.get(address, key)
    assert.deepEqual(origRes, value)
  })

  it("getOriginalContractStorage should validate the key's length", async () => {
    try {
      await stateManager.originalStorageCache.get(address, new Uint8Array(12))
    } catch (e: any) {
      assert.equal(e.message, 'Storage key must be 32 bytes long')
      return
    }

    assert.fail('Should have failed')
  })
})
