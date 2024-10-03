import { createBlock } from '@ethereumjs/block'
import { Common, Hardfork } from '@ethereumjs/common'
import { bytesToHex } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createBlockchain } from '../src/index.js'

import { testnetData } from './testdata/testnet.js'

import type { Consensus, ConsensusDict } from '../src/index.js'
import type { Block, BlockHeader } from '@ethereumjs/block'

class fibonacciConsensus implements Consensus {
  algorithm: string
  constructor() {
    this.algorithm = 'fibonacciConsensus'
  }
  genesisInit(_genesisBlock: Block): Promise<void> {
    return new Promise<void>((resolve) => resolve())
  }
  setup(): Promise<void> {
    return new Promise<void>((resolve) => resolve())
  }
  validateConsensus(_block: Block): Promise<void> {
    if (bytesToHex(_block.header.extraData) !== '0x12358d') {
      throw new Error(
        'header contains invalid extradata - must match first 6 elements of fibonacci sequence',
      )
    }
    return new Promise<void>((resolve) => resolve())
  }
  validateDifficulty(_header: BlockHeader): Promise<void> {
    if (_header.number === 1n && _header.difficulty === 1n) {
      return new Promise<void>((resolve) => resolve())
    }
    if (_header.difficulty !== _header.number - 1n + _header.number - 2n) {
      throw new Error('invalid difficulty - must be sum of previous two block numbers')
    }
    return new Promise<void>((resolve) => resolve())
  }
  newBlock(): Promise<void> {
    return new Promise<void>((resolve) => resolve())
  }
}

testnetData.consensus.algorithm = 'fibonacci'
const consensusDict: ConsensusDict = {}
consensusDict['fibonacci'] = new fibonacciConsensus()

describe('Optional consensus parameter in blockchain constructor', () => {
  it('blockchain constructor should work with custom consensus', async () => {
    const common = new Common({ chain: testnetData, hardfork: Hardfork.Chainstart })
    try {
      const blockchain = await createBlockchain({ common, validateConsensus: true, consensusDict })
      assert.equal(
        (blockchain.consensus as fibonacciConsensus).algorithm,
        'fibonacciConsensus',
        'consensus algorithm matches',
      )
    } catch (err) {
      assert.fail('blockchain should instantiate successfully')
    }
  })
})

describe('Custom consensus validation rules', () => {
  it('should validate custom consensus rules', async () => {
    const common = new Common({ chain: testnetData, hardfork: Hardfork.Chainstart })
    const blockchain = await createBlockchain({ common, validateConsensus: true, consensusDict })
    const block = createBlock(
      {
        header: {
          number: 1n,
          difficulty: 1n,
          extraData: '0x12358d',
          parentHash: blockchain.genesisBlock.hash(),
          timestamp: blockchain.genesisBlock.header.timestamp + 1n,
          gasLimit: blockchain.genesisBlock.header.gasLimit + 1n,
        },
      },
      { common },
    )

    try {
      await blockchain.putBlock(block)
      assert.deepEqual(
        (await blockchain.getBlock(block.header.number)).header.hash(),
        block.header.hash(),
        'put block with valid difficulty and extraData',
      )
    } catch {
      assert.fail('should have put block with valid difficulty and extraData')
    }

    const blockWithBadDifficulty = createBlock(
      {
        header: {
          number: 2n,
          difficulty: 2n,
          extraData: '0x12358d',
          parentHash: block.hash(),
          timestamp: block.header.timestamp + 1n,
        },
      },
      { common },
    )
    try {
      await blockchain.putBlock(blockWithBadDifficulty)
      assert.fail('should throw')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('invalid difficulty'),
        'failed to put block with invalid difficulty',
      )
    }

    const blockWithBadExtraData = createBlock(
      {
        header: {
          number: 2n,
          difficulty: 1n,
          extraData: '0x12358c',
          parentHash: block.hash(),
          timestamp: block.header.timestamp + 1n,
          gasLimit: block.header.gasLimit + 1n,
        },
      },
      { common },
    )
    try {
      await blockchain.putBlock(blockWithBadExtraData)
      assert.fail('should throw')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message ===
          'header contains invalid extradata - must match first 6 elements of fibonacci sequence',
        'failed to put block with invalid extraData',
      )
    }
  })
})

describe('consensus transition checks', () => {
  it('should transition correctly', async () => {
    const common = new Common({ chain: testnetData, hardfork: Hardfork.Chainstart })
    const blockchain = await createBlockchain({ common, validateConsensus: true, consensusDict })

    try {
      await blockchain.checkAndTransitionHardForkByNumber(5n)
      assert.ok('checkAndTransitionHardForkByNumber does not throw with custom consensus')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.fail(
        `checkAndTransitionHardForkByNumber should not throw with custom consensus, error=${err.message}`,
      )
    }

    blockchain.common.consensusAlgorithm = () => 'ethash'

    try {
      await blockchain.checkAndTransitionHardForkByNumber(5n)
      assert.fail(
        'checkAndTransitionHardForkByNumber should throw when using standard consensus (ethash, clique, casper) but consensus algorithm defined in common is different',
      )
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('Consensus object for ethash must be passed'))
    }
  })
})
