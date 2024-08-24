import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createZeroAddress } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { TransactionType, createTxFromTxData, paramsTx } from '../src/index.js'

const common = new Common({
  chain: Mainnet,
  hardfork: Hardfork.Paris,
  eips: [3860, 4844, 4895],
  params: paramsTx,
})

const maxInitCodeSize = common.param('maxInitCodeSize')
const txTypes = [
  TransactionType.Legacy,
  TransactionType.AccessListEIP2930,
  TransactionType.FeeMarketEIP1559,
  //TransactionType.BlobEIP4844, // Explicitly commented out: BlobEIP4844 txs cannot create contracts
]
const addressZero = createZeroAddress()

describe('[EIP3860 tests]', () => {
  it(`Should instantiate create txs with MAX_INITCODE_SIZE`, () => {
    const data = new Uint8Array(Number(maxInitCodeSize))
    for (const txType of txTypes) {
      try {
        createTxFromTxData({ data, type: txType }, { common })
        assert.ok('Instantiated create tx with MAX_INITCODE_SIZE data')
      } catch {
        assert.fail('Did not instantiate create tx with MAX_INITCODE_SIZE')
      }
    }
  })

  it(`Should instantiate txs with MAX_INITCODE_SIZE data`, () => {
    const data = new Uint8Array(Number(maxInitCodeSize))
    for (const txType of txTypes) {
      try {
        createTxFromTxData({ data, type: txType, to: addressZero }, { common })
        assert.ok('Instantiated tx with MAX_INITCODE_SIZE')
      } catch {
        assert.fail('Did not instantiated tx with MAX_INITCODE_SIZE')
      }
    }
  })

  it(`Should not instantiate create txs with MAX_INITCODE_SIZE+1 data`, () => {
    const data = new Uint8Array(Number(maxInitCodeSize) + 1)
    for (const txType of txTypes) {
      try {
        createTxFromTxData({ data, type: txType }, { common })
        assert.fail('Instantiated create tx with MAX_INITCODE_SIZE+1')
      } catch {
        assert.ok('Did not instantiate create tx with MAX_INITCODE_SIZE+1')
      }
    }
  })

  it(`Should instantiate txs with MAX_INITCODE_SIZE+1 data`, () => {
    const data = new Uint8Array(Number(maxInitCodeSize) + 1)
    for (const txType of txTypes) {
      try {
        createTxFromTxData({ data, type: txType, to: addressZero }, { common })
        assert.ok('Instantiated tx with MAX_INITCODE_SIZE+1')
      } catch {
        assert.fail('Did not instantiate tx with MAX_INITCODE_SIZE+1')
      }
    }
  })

  describe('Should allow txs with MAX_INITCODE_SIZE+1 data if allowUnlimitedInitCodeSize is active', () => {
    it('should work', () => {
      const data = new Uint8Array(Number(maxInitCodeSize) + 1)
      for (const txType of txTypes) {
        try {
          createTxFromTxData({ data, type: txType }, { common, allowUnlimitedInitCodeSize: true })
          assert.ok('Instantiated create tx with MAX_INITCODE_SIZE+1')
        } catch {
          assert.fail('Did not instantiate tx with MAX_INITCODE_SIZE+1')
        }
      }
    })
  })

  describe('Should charge initcode analysis gas is allowUnlimitedInitCodeSize is active', () => {
    it('should work', () => {
      const data = new Uint8Array(Number(maxInitCodeSize))
      for (const txType of txTypes) {
        const eip3860ActiveTx = createTxFromTxData(
          { data, type: txType },
          { common, allowUnlimitedInitCodeSize: true },
        )
        const eip3860DeactivatedTx = createTxFromTxData(
          { data, type: txType },
          { common, allowUnlimitedInitCodeSize: false },
        )
        assert.ok(
          eip3860ActiveTx.getDataGas() === eip3860DeactivatedTx.getDataGas(),
          'charged initcode analysis gas',
        )
      }
    })
  })
})
