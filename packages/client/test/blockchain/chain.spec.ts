import { createBlock } from '@ethereumjs/block'
import { createBlockchain } from '@ethereumjs/blockchain'
import { KeyEncoding, ValueEncoding, bytesToHex, equalsBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Chain } from '../../src/blockchain/index.js'
import { Config } from '../../src/config.js'

import type { LevelDB } from '../../src/execution/level.js'
import type { BlockData, HeaderData } from '@ethereumjs/block'

const config = new Config({ accountCache: 10000, storageCache: 1000 })

describe('[Chain]', () => {
  it('should test blockchain DB is initialized', async () => {
    const chain = await Chain.create({ config })

    const db = chain.chainDB as LevelDB
    const testKey = 'name'
    const testValue = 'test'
    await db.put(testKey, testValue, {
      keyEncoding: KeyEncoding.String,
      valueEncoding: ValueEncoding.String,
    })

    const value = await db.get(testKey, {
      keyEncoding: KeyEncoding.String,
      valueEncoding: ValueEncoding.String,
    })
    assert.equal(value, testValue, 'read value matches written value')
  })

  it('should retrieve chain properties', async () => {
    const chain = await Chain.create({ config })
    await chain.open()
    assert.equal(chain.chainId, BigInt(1), 'get chain.chainId')
    assert.equal(chain.blocks.td.toString(10), '17179869184', 'get chain.blocks.td')
    assert.equal(chain.blocks.height.toString(10), '0', 'get chain.blocks.height')
    assert.equal(
      bytesToHex(chain.genesis.hash()),
      '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
      'get chain.genesis',
    )
    assert.ok(
      equalsBytes(chain.genesis.hash(), chain.blocks.latest!.hash()),
      'get chain.block.latest',
    )
    await chain.close()
  })

  it('should detect unopened chain', async () => {
    const blockchain = await createBlockchain({
      validateBlocks: false,
      validateConsensus: false,
    })
    const chain = await Chain.create({ config, blockchain })
    const headerData: HeaderData = {
      number: BigInt(1),
      difficulty: BigInt(0xabcdffff),
      parentHash: chain.genesis.hash(),
    }
    const block = createBlock({ header: headerData } as BlockData, {
      common: config.chainCommon,
    })

    assert.equal(await chain.update(), false, 'skip update if not opened')
    assert.equal(await chain.close(), false, 'skip close if not opened')
    assert.notOk(chain.opened, 'chain should be closed')
    assert.notOk(chain.blocks.height, 'chain should be empty if not opened')
    try {
      await chain.putHeaders([block.header])
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    await chain.close()
    try {
      await chain.putBlocks([block])
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    await chain.close()
    assert.notOk(chain.opened, 'chain should close')
    try {
      await chain.getBlocks(block.hash())
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    await chain.close()
    try {
      await chain.getBlock(block.hash())
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    try {
      await chain.getCanonicalHeadHeader()
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    await chain.close()
    try {
      await chain.getCanonicalHeadBlock()
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    await chain.close()
    try {
      await chain.getTd(block.hash(), block.header.number)
      assert.fail('should error if chain is closed')
    } catch {
      assert.ok(true, 'threw an error when chain is closed')
    }
    await chain.open()
    assert.equal(await chain.open(), false, 'skip open if already opened')
    await chain.close()
  })

  it('should add block to chain', async () => {
    // TODO: add test cases with activated block validation
    const blockchain = await createBlockchain({
      validateBlocks: false,
      validateConsensus: false,
    })
    const chain = await Chain.create({ config, blockchain })
    await chain.open()
    const headerData: HeaderData = {
      number: BigInt(1),
      difficulty: BigInt(0xabcdffff),
      parentHash: chain.genesis.hash(),
    }
    const block = createBlock({ header: headerData } as BlockData, {
      common: config.chainCommon,
    })
    await chain.putBlocks([block])
    assert.equal(chain.blocks.td.toString(16), '4abcdffff', 'get chain.td')
    assert.equal(chain.blocks.height.toString(10), '1', 'get chain.height')
    await chain.close()
  })
})
