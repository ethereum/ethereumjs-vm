import { bytesToHex, equalsBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createBlockchain } from '../src/index.js'

import { createTestDB, generateBlockchain, generateConsecutiveBlock } from './util.js'

import type { Block } from '@ethereumjs/block'

describe('blockchain test', () => {
  it('should iterate through 24 blocks without reorg', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    let i = 0
    let reorged = 0
    const iterated = await blockchain.iterator('test', (block: Block, reorg: boolean) => {
      if (reorg) reorged++
      if (equalsBytes(block.hash(), blocks[i + 1].hash()) === true) {
        i++
      }
    })
    assert.equal(iterated, 24)
    assert.equal(i, 24)
    assert.equal(reorged, 0)
  })

  it('should iterate through 24 blocks with reorg', async () => {
    const { blockchain, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    let reorged = 0
    const reorgedBlocks: Block[] = []
    let servedReorged = 0

    const iterated = await blockchain.iterator(
      'test',
      async (block: Block, reorg: boolean) => {
        if (reorg) reorged++
        if (reorged === 0) {
          if (block.header.number === BigInt(10)) {
            // let rewrite the chain from this block onwards to cause a reorg, but first
            // we need to get the parent of this block to build a new chain onwards
            let reorgParent = await blockchain.getBlock(4)
            // Generate and add blocks from block 5 till block num 25 to reorg the chain
            for (let j = 5; j < 26; j++) {
              const reorgedBlock = generateConsecutiveBlock(reorgParent, 1, BigInt(8000001))
              reorgedBlocks.push(reorgedBlock)
              reorgParent = reorgedBlock
            }
            // we can do putBlocks even though it also acquire lock because we started this
            // with releaseLockOnCallback=true, so in this callback there are no pending locks
            await blockchain.putBlocks(reorgedBlocks)
          }
        } else {
          if (equalsBytes(block.hash(), reorgedBlocks[Number(block.header.number) - 5].hash())) {
            servedReorged++
          }
        }
      },
      undefined,
      true,
    )
    assert.equal(reorged, 1, 'should have reorged once')
    assert.equal(
      servedReorged,
      reorgedBlocks.length,
      'should have served all 21 reorged blocks with head resetting',
    )
    assert.equal(iterated, 31, 'should have iterated 10 + 21 blocks in total')
  })

  it('should iterate through maxBlocks blocks if maxBlocks parameter is provided', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    let i = 0
    const iterated = await blockchain.iterator(
      'test',
      (block: Block) => {
        if (equalsBytes(block.hash(), blocks[i + 1].hash())) {
          i++
        }
      },
      5,
    )
    assert.equal(iterated, 5)
    assert.equal(i, 5)
  })

  it('should iterate through 0 blocks in case 0 maxBlocks parameter is provided', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    let i = 0
    const iterated = await blockchain
      .iterator(
        'test',
        (block: Block) => {
          if (equalsBytes(block.hash(), blocks[i + 1].hash())) {
            i++
          }
        },
        0,
      )
      .catch(() => {
        assert.fail('Promise cannot throw when running 0 blocks')
      })
    assert.equal(iterated, 0)
    assert.equal(i, 0)
  })

  it('should throw on a negative maxBlocks parameter in iterator', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    let i = 0
    await blockchain
      .iterator(
        'test',
        (block: Block) => {
          if (equalsBytes(block.hash(), blocks[i + 1].hash())) {
            i++
          }
        },
        -1,
      )
      .catch(() => {})
    // Note: if st.end() is not called (Promise did not throw), then this test fails, as it does not end.
  })

  it('should test setIteratorHead method', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')

    const headBlockIndex = 5

    const headHash = blocks[headBlockIndex].hash()
    await blockchain.setIteratorHead('myHead', headHash)
    const currentHeadBlock = await blockchain.getIteratorHead('myHead')

    assert.deepEqual(headHash, currentHeadBlock.hash(), 'head hash equals the provided head hash')

    let i = 0
    // check that iterator starts from this head block
    await blockchain.iterator(
      'myHead',
      (block: Block) => {
        if (equalsBytes(block.hash(), blocks[headBlockIndex + 1].hash())) {
          i++
        }
      },
      5,
    )

    assert.equal(i, 1)
  })

  it('should catch iterator func error', async () => {
    const { blockchain, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    try {
      await blockchain.iterator('error', () => {
        throw new Error('iterator func error')
      })
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(error)
      assert.equal(error.message, 'iterator func error', 'should return correct error')
    }
  })

  it('should not call iterator function in an empty blockchain', async () => {
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
    })

    const numIterated = await blockchain.iterator('test', () => {
      assert.fail('should not call iterator function')
    })
    assert.equal(numIterated, 0, 'should finish iterating')
  })

  it('should get heads', async () => {
    const [db, genesis] = await createTestDB()
    const blockchain = await createBlockchain({ db, genesisBlock: genesis })
    const head = await blockchain.getIteratorHead()

    if (typeof genesis !== 'undefined') {
      assert.deepEqual(head.hash(), genesis.hash(), 'should get head')
      assert.equal(
        bytesToHex((blockchain as any)._heads['head0']),
        '0xabcd',
        'should get state root heads',
      )
    } else {
      assert.fail()
    }
  })
})
