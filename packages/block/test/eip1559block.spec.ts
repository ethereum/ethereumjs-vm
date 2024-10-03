import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import { hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createBlock, createBlockHeader } from '../src/index.js'
// Test data from Besu (retrieved via Discord)
// Older version at https://github.com/abdelhamidbakhta/besu/blob/bf54b6c0b40d3015fc85ff9b078fbc26592d80c0/ethereum/core/src/test/resources/org/hyperledger/besu/ethereum/core/fees/basefee-test.json
import { paramsBlock } from '../src/params.js'

import { eip1559baseFeeData } from './testdata/eip1559baseFee.js'

const common = new Common({
  eips: [1559],
  chain: Mainnet,
  hardfork: Hardfork.London,
  params: paramsBlock,
})

const genesis = createBlock({})

// Small hack to hack in the activation block number
// (Otherwise there would be need for a custom chain only for testing purposes)
common.hardforkBlock = function (hardfork: string | undefined) {
  if (hardfork === 'london') {
    return BigInt(1)
  } else if (hardfork === 'dao') {
    // Avoid DAO HF side-effects
    return BigInt(99)
  }
  return BigInt(0)
}

describe('EIP1559 tests', () => {
  it('Header -> Initialization', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    assert.throws(
      () => {
        createBlockHeader(
          {
            number: BigInt(1),
            parentHash: genesis.hash(),
            timestamp: BigInt(1),
            gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
            baseFeePerGas: BigInt(5),
          },
          {
            common,
          },
        )
      },
      undefined,
      undefined,
      'should throw when setting baseFeePerGas with EIP1559 not being activated',
    )
  })

  it('Header -> genericFormatValidation checks', async () => {
    try {
      createBlockHeader(
        {
          number: BigInt(1),
          parentHash: genesis.hash(),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          timestamp: BigInt(1),
          baseFeePerGas: 100,
        },
        {
          calcDifficultyFromHeader: genesis.header,
          common,
          freeze: false,
        },
      )
      assert.fail('should throw when baseFeePerGas is not set to initial base fee')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      const expectedError = 'Initial EIP1559 block does not have initial base fee'
      assert.ok(
        e.message.includes(expectedError),
        'should throw if base fee is not set to initial value',
      )
    }

    try {
      const header = createBlockHeader(
        {
          number: BigInt(1),
          parentHash: genesis.hash(),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          timestamp: BigInt(1),
        },
        {
          calcDifficultyFromHeader: genesis.header,
          common,
          freeze: false,
        },
      )
      ;(header as any).baseFeePerGas = undefined
      await (header as any)._genericFormatValidation()
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      const expectedError = 'EIP1559 block has no base fee field'
      assert.ok(
        e.message.includes(expectedError),
        'should throw with no base fee field when EIP1559 is activated',
      )
    }
  })

  it('Header -> _genericFormValidation -> success case', async () => {
    createBlock(
      {
        header: {
          number: BigInt(1),
          parentHash: genesis.hash(),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          timestamp: BigInt(1),
          baseFeePerGas: common.param('initialBaseFee'),
        },
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )

    assert.ok(true, 'Valid initial EIP1559 header should be valid')
  })

  it('Header -> validate()', async () => {
    try {
      createBlockHeader(
        {
          baseFeePerGas: BigInt(1000),
          number: BigInt(1),
          parentHash: genesis.hash(),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          timestamp: BigInt(1),
        },
        {
          calcDifficultyFromHeader: genesis.header,
          common,
        },
      )
      assert.fail('should throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(e.message.includes('base fee'), 'should throw on wrong initial base fee')
    }
  })

  it('Header -> validate() -> success cases', async () => {
    const block1 = createBlock(
      {
        header: {
          number: BigInt(1),
          parentHash: genesis.hash(),
          timestamp: BigInt(1),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          baseFeePerGas: BigInt(1000000000),
        },
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )
    createBlock(
      {
        header: {
          number: BigInt(2),
          parentHash: block1.hash(),
          timestamp: BigInt(2),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          baseFeePerGas: hexToBytes('0x342770c0'),
        },
      },
      {
        calcDifficultyFromHeader: block1.header,
        common,
      },
    )
    assert.ok(true, 'should correctly validate subsequent EIP-1559 blocks')
  })

  it('Header -> validate() -> gas usage', async () => {
    try {
      createBlockHeader(
        {
          number: BigInt(1),
          parentHash: genesis.hash(),
          timestamp: BigInt(1),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          gasUsed:
            genesis.header.gasLimit * (common.param('elasticityMultiplier') ?? BigInt(0)) +
            BigInt(1),
          baseFeePerGas: common.param('initialBaseFee'),
        },
        {
          calcDifficultyFromHeader: genesis.header,
          common,
        },
      )
      assert.fail('should throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(e.message.includes('too much gas used'), 'should throw when elasticity is exceeded')
    }
  })

  it('Header -> validate() -> gas usage', async () => {
    createBlockHeader(
      {
        number: BigInt(1),
        parentHash: genesis.hash(),
        timestamp: BigInt(1),
        gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
        gasUsed: genesis.header.gasLimit * BigInt(2),
        baseFeePerGas: common.param('initialBaseFee'),
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )

    assert.ok(true, 'should not throw when elasticity is exactly matched')
  })

  const block1 = createBlock(
    {
      header: {
        number: BigInt(1),
        parentHash: genesis.hash(),
        gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
        timestamp: BigInt(1),
        baseFeePerGas: common.param('initialBaseFee'),
      },
    },
    {
      calcDifficultyFromHeader: genesis.header,
      common,
    },
  )

  it('Header -> validate() -> gasLimit -> success cases', async () => {
    let parentGasLimit = genesis.header.gasLimit * BigInt(2)
    createBlockHeader(
      {
        number: BigInt(1),
        parentHash: genesis.hash(),
        timestamp: BigInt(1),
        gasLimit: parentGasLimit + parentGasLimit / BigInt(1024) - BigInt(1),
        baseFeePerGas: common.param('initialBaseFee'),
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )

    assert.ok(true, 'should not throw if gas limit is between bounds (HF transition block)')

    createBlockHeader(
      {
        number: BigInt(1),
        parentHash: genesis.hash(),
        timestamp: BigInt(1),
        gasLimit: parentGasLimit - parentGasLimit / BigInt(1024) + BigInt(1),
        baseFeePerGas: common.param('initialBaseFee'),
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )

    assert.ok(true, 'should not throw if gas limit is between bounds (HF transition block)')

    parentGasLimit = block1.header.gasLimit
    createBlockHeader(
      {
        number: BigInt(2),
        parentHash: block1.hash(),
        timestamp: BigInt(2),
        gasLimit: parentGasLimit + parentGasLimit / BigInt(1024) - BigInt(1),
        baseFeePerGas: hexToBytes('0x342770c0'),
      },
      {
        calcDifficultyFromHeader: block1.header,
        common,
      },
    )

    assert.ok(true, 'should not throw if gas limit is between bounds (post-HF transition block)')

    createBlockHeader(
      {
        number: BigInt(2),
        parentHash: block1.hash(),
        timestamp: BigInt(2),
        gasLimit: parentGasLimit - parentGasLimit / BigInt(1024) + BigInt(1),
        baseFeePerGas: hexToBytes('0x342770c0'),
      },
      {
        calcDifficultyFromHeader: block1.header,
        common,
      },
    )

    assert.ok(true, 'should not throw if gas limit is between bounds (post-HF transition block)')
  })

  it('Header -> validateGasLimit() -> error cases', async () => {
    let parentGasLimit = genesis.header.gasLimit * BigInt(2)
    let header = createBlockHeader(
      {
        number: BigInt(1),
        parentHash: genesis.hash(),
        timestamp: BigInt(1),
        gasLimit: parentGasLimit + parentGasLimit,
        baseFeePerGas: common.param('initialBaseFee'),
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )
    try {
      header.validateGasLimit(genesis.header)
      assert.fail('should throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('gas limit increased too much'),
        'should throw if gas limit is increased too much (HF transition block)',
      )
    }

    parentGasLimit = block1.header.gasLimit
    header = createBlockHeader(
      {
        number: BigInt(2),
        parentHash: block1.hash(),
        timestamp: BigInt(2),
        gasLimit: parentGasLimit + parentGasLimit / BigInt(1024),
        baseFeePerGas: hexToBytes('0x342770c0'),
      },
      {
        calcDifficultyFromHeader: block1.header,
        common,
      },
    )
    try {
      header.validateGasLimit(block1.header)
      assert.fail('should throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('gas limit increased too much'),
        'should throw if gas limit is increased too much (post-HF transition block)',
      )
    }
  })

  it('Header -> validateGasLimit() -> error cases', async () => {
    let parentGasLimit = genesis.header.gasLimit * BigInt(2)
    let header = createBlockHeader(
      {
        number: BigInt(1),
        parentHash: genesis.hash(),
        timestamp: BigInt(1),
        gasLimit: parentGasLimit - parentGasLimit / BigInt(1024),
        baseFeePerGas: common.param('initialBaseFee'),
      },
      {
        calcDifficultyFromHeader: genesis.header,
        common,
      },
    )
    try {
      header.validateGasLimit(genesis.header)
      assert.fail('should throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('gas limit decreased too much'),
        'should throw if gas limit is decreased too much (HF transition block)',
      )
    }

    parentGasLimit = block1.header.gasLimit
    header = createBlockHeader(
      {
        number: BigInt(2),
        parentHash: block1.hash(),
        timestamp: BigInt(2),
        gasLimit: parentGasLimit - parentGasLimit / BigInt(1024),
        baseFeePerGas: hexToBytes('0x342770c0'),
      },
      {
        calcDifficultyFromHeader: block1.header,
        common,
      },
    )
    try {
      header.validateGasLimit(block1.header)
      assert.fail('should throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('gas limit decreased too much'),
        'should throw if gas limit is decreased too much (post-HF transition block)',
      )
    }
  })

  it('Header -> validateTransactions() -> tx', async () => {
    const transaction = createFeeMarket1559Tx(
      {
        maxFeePerGas: BigInt(0),
        maxPriorityFeePerGas: BigInt(0),
      },
      { common },
    ).sign(hexToBytes(`0x${'46'.repeat(32)}`))
    const block = createBlock(
      {
        header: {
          number: BigInt(1),
          parentHash: genesis.hash(),
          gasLimit: genesis.header.gasLimit * BigInt(2), // Special case on EIP-1559 transition block
          timestamp: BigInt(1),
          baseFeePerGas: common.param('initialBaseFee'),
        },
        transactions: [
          {
            maxFeePerGas: BigInt(0),
            maxPriorityFeePerGas: BigInt(0),
            type: 2,
            v: transaction.v,
            r: transaction.r,
            s: transaction.s,
            gasLimit: 53000,
          },
        ],
      },
      {
        common,
        calcDifficultyFromHeader: genesis.header,
      },
    )

    const errs = block.getTransactionsValidationErrors()
    assert.ok(
      errs[0].includes('unable to pay base fee'),
      'should throw if transaction is unable to pay base fee',
    )
  })

  it('Header -> calcNextBaseFee()', () => {
    for (let index = 0; index < eip1559baseFeeData.length; index++) {
      const item = eip1559baseFeeData[index]
      const result = createBlockHeader(
        {
          baseFeePerGas: BigInt(item.parentBaseFee),
          gasUsed: BigInt(item.parentGasUsed),
          gasLimit: BigInt(item.parentTargetGasUsed) * BigInt(2),
        },
        { common },
      ).calcNextBaseFee()
      const expected = BigInt(item.expectedBaseFee)
      assert.equal(expected, result, 'base fee correct')
    }
  })

  it('Header -> toJSON()', () => {
    const header = createBlockHeader(
      {
        number: BigInt(3),
        parentHash: genesis.hash(),
        timestamp: BigInt(1),
        gasLimit: genesis.header.gasLimit,
        baseFeePerGas: BigInt(5),
      },
      {
        common,
      },
    )
    assert.equal(header.toJSON().baseFeePerGas, '0x5')
  })
})
