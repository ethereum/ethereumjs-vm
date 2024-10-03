import {
  createBlock,
  createBlockFromRLP,
  createBlockHeader,
  createBlockHeaderFromBytesArray,
} from '@ethereumjs/block'
import { Common, Goerli, Hardfork, Holesky, Mainnet, Sepolia } from '@ethereumjs/common'
import { MapDB, bytesToHex, equalsBytes, hexToBytes, utf8ToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Blockchain, createBlockchain, createBlockchainFromBlocksData } from '../src/index.js'

import { blocksMainnetData } from './testdata/blocks_mainnet.js'
import { preLondonData } from './testdata/testdata_pre-london.js'
import { createTestDB, generateBlockchain, generateBlocks, isConsecutive } from './util.js'

import type { Block, BlockOptions } from '@ethereumjs/block'
import type { PrefixedHexString } from '@ethereumjs/util'

describe('blockchain test', () => {
  it('should not crash on getting head of a blockchain without a genesis', async () => {
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
    })
    await blockchain.getIteratorHead()
  })

  it('should initialize correctly', async () => {
    const common = new Common({ chain: Mainnet })
    let blockchain = await createBlockchain({ common })

    const iteratorHead = await blockchain.getIteratorHead()

    assert.deepEqual(
      iteratorHead.hash(),
      blockchain.genesisBlock.hash(),
      'correct genesis hash (getIteratorHead())',
    )

    blockchain = await createBlockchain({ common, hardforkByHeadBlockNumber: true })
    assert.equal(
      common.hardfork(),
      'chainstart',
      'correct HF setting with hardforkByHeadBlockNumber option',
    )
  })

  it('should initialize holesky correctly', async () => {
    // Taken from: https://github.com/eth-clients/holesky/blob/f1d14b9a80085c3f0cb9d729fea9172cde445588/README.md#hole%C5%A1ky-hole%C5%A1ovice-testnet
    const holeskyHash = '0xb5f7f912443c940f21fd611f12828d75b534364ed9e95ca4e307729a4661bde4'
    const common = new Common({ chain: Holesky })
    const blockchain = await createBlockchain({
      common,
    })
    const genesisHash = blockchain.genesisBlock.hash()

    assert.deepEqual(bytesToHex(genesisHash), holeskyHash, 'correct genesis hash for holesky')
  })

  it('should initialize correctly with createBlockchainFromBlocksData()', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const blockchain = await createBlockchainFromBlocksData(blocksMainnetData, {
      validateBlocks: true,
      validateConsensus: false,
      common,
    })
    const head = await blockchain.getIteratorHead()
    assert.equal(head.header.number, BigInt(0), 'correct block number')
  })

  it('should only initialize with supported consensus validation options', async () => {
    let common = new Common({ chain: Mainnet })
    try {
      await createBlockchain({ common, validateConsensus: true })
      await createBlockchain({ common, validateBlocks: true })
      common = new Common({ chain: Goerli })
      await createBlockchain({ common, validateConsensus: true })
      const chain = await createBlockchain({ common, validateBlocks: true })
      assert.ok(chain instanceof Blockchain, 'should not throw')
    } catch (error) {
      assert.fail('show not have thrown')
    }
  })

  it('should add a genesis block without errors', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const genesisBlock = createBlock({ header: { number: 0 } }, { common })
    const blockchain = await createBlockchain({
      common,
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })
    assert.deepEqual(
      genesisBlock.hash(),
      (await blockchain.getCanonicalHeadHeader()).hash(),
      'genesis block hash should be correct',
    )
  })

  it('should not validate a block incorrectly flagged as genesis', async () => {
    const genesisBlock = createBlock({ header: { number: BigInt(8) } })
    try {
      await createBlockchain({
        validateBlocks: true,
        validateConsensus: false,
        genesisBlock,
      })
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(error, 'returned with error')
    }
  })

  it('should initialize with a genesis block', async () => {
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
    })
    const blocks = await blockchain.getBlocks(0, 5, 0, false)
    assert.equal(blocks!.length, 1)
  })

  it('should add 12 blocks, one at a time', async () => {
    const blocks: Block[] = []
    const gasLimit = 8000000
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })

    const genesisBlock = createBlock({ header: { gasLimit } }, { common })
    blocks.push(genesisBlock)

    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
      common,
      hardforkByHeadBlockNumber: true,
    })

    const addNextBlock = async (number: number) => {
      const lastBlock = blocks[number - 1]
      const blockData = {
        header: {
          number,
          parentHash: lastBlock.hash(),
          timestamp: lastBlock.header.timestamp + BigInt(1),
          gasLimit,
        },
      }
      const block = createBlock(blockData, {
        calcDifficultyFromHeader: lastBlock.header,
        common,
      })
      await blockchain.putBlock(block)
      blocks.push(block)

      if (blocks.length < 12) {
        await addNextBlock(number + 1)
      } else {
        const getBlocks = await blockchain.getBlocks(blocks[0].hash(), 12, 0, false)
        assert.equal(getBlocks.length, 12)
        assert.equal(common.hardfork(), 'chainstart', 'correct HF updates along block additions')
      }
    }

    await addNextBlock(1)
  })

  it('getBlock(): should get block by number', async () => {
    const blocks: Block[] = []
    const gasLimit = 8000000
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })

    const genesisBlock = createBlock({ header: { gasLimit } }, { common })
    blocks.push(genesisBlock)

    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
      common,
    })

    const blockData = {
      header: {
        number: 1,
        parentHash: genesisBlock.hash(),
        timestamp: genesisBlock.header.timestamp + BigInt(1),
        gasLimit,
      },
    }
    const block = createBlock(blockData, {
      calcDifficultyFromHeader: genesisBlock.header,
      common,
    })
    blocks.push(block)
    await blockchain.putBlock(block)

    const returnedBlock = await blockchain.getBlock(1)
    if (typeof returnedBlock !== 'undefined') {
      assert.deepEqual(returnedBlock.hash(), blocks[1].hash())
    } else {
      assert.fail('block is not defined!')
    }
  })

  it('getBlock(): should get block by hash / not existing', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const gasLimit = 8000000
    const genesisBlock = createBlock({ header: { gasLimit } }, { common })

    const blockchain = await createBlockchain({
      common,
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })
    const block = await blockchain.getBlock(genesisBlock.hash())
    assert.deepEqual(block.hash(), genesisBlock.hash())

    try {
      await blockchain.getBlock(5)
      assert.fail('should throw an exception')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('not found in DB'),
        `should throw for non-existing block-by-number request`,
      )
    }

    try {
      await blockchain.getBlock(hexToBytes('0x1234'))
      assert.fail('should throw an exception')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('not found in DB'),
        `should throw for non-existing block-by-hash request`,
      )
    }
  })

  it('should get 5 consecutive blocks, starting from genesis hash', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: genesisHash, max: 5, skip: 0, reverse: false
    const getBlocks = await blockchain.getBlocks(blocks[0].hash(), 5, 0, false)
    assert.equal(getBlocks!.length, 5)
    assert.equal(blocks[0].header.number, getBlocks[0].header.number)
    assert.ok(isConsecutive(getBlocks!), 'blocks should be consecutive')

    const canonicalHeaderOriginal = await blockchain.getCanonicalHeadHeader()
    assert.equal(canonicalHeaderOriginal.number, BigInt(24), 'block 24 should be canonical header')
    const block22 = await blockchain.getBlock(22)
    assert.equal(block22.header.number, BigInt(22), 'should fetch block by number')

    await blockchain.resetCanonicalHead(BigInt(4))
    let canonicalHeader = await blockchain.getCanonicalHeadHeader()
    assert.equal(canonicalHeader.number, BigInt(4), 'block 4 should be new canonical header')

    try {
      await blockchain.getBlock(22)
      assert.fail('canonical references should have been deleted')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('not found in DB'), 'canonical references correctly deleted')
    }

    try {
      await blockchain.getCanonicalHeader(BigInt(22))
      assert.fail('canonical references should have been deleted')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(
        err.message,
        'header with number 22 not found in canonical chain',
        'canonical references correctly deleted',
      )
    }

    await blockchain.putHeader(canonicalHeaderOriginal)
    canonicalHeader = await blockchain.getCanonicalHeadHeader()
    assert.equal(canonicalHeader.number, BigInt(24), 'block 24 should be new canonical header')

    const newblock22 = await blockchain.getBlock(22)
    assert.equal(newblock22.header.number, BigInt(22), 'canonical references should be restored')
    const newheader22 = await blockchain.getCanonicalHeader(BigInt(22))
    assert.equal(newheader22.number, BigInt(22), 'canonical references should be restored')
    assert.equal(
      bytesToHex(newblock22.hash()),
      bytesToHex(newheader22.hash()),
      'fetched block should match',
    )
  })

  it('should get 5 blocks, skipping 1 apart, starting from genesis hash', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: genesisHash, max: 5, skip: 1, reverse: false
    const getBlocks = await blockchain.getBlocks(blocks[0].hash(), 5, 1, false)
    assert.equal(getBlocks!.length, 5, 'should get 5 blocks')
    assert.equal(getBlocks![1].header.number, blocks[2].header.number, 'should skip second block')
    assert.ok(!isConsecutive(getBlocks!), 'blocks should not be consecutive')
  })

  it('should get 4 blocks, skipping 2 apart, starting from genesis hash', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: genesisHash, max: 4, skip: 2, reverse: false
    const getBlocks = await blockchain.getBlocks(blocks[0].hash(), 4, 2, false)
    assert.equal(getBlocks!.length, 4, 'should get 4 blocks')
    assert.equal(
      getBlocks![1].header.number,
      blocks[3].header.number,
      'should skip two blocks apart',
    )
    assert.ok(!isConsecutive(getBlocks!), 'blocks should not be consecutive')
  })

  it('should get 10 consecutive blocks, starting from genesis hash', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(15)
    assert.equal(error, null, 'no error')
    // start: genesisHash, max: 17, skip: 0, reverse: false
    const getBlocks = await blockchain.getBlocks(blocks[0].hash(), 17, 0, false)
    assert.equal(getBlocks!.length, 15)
    assert.equal(getBlocks![0].header.number, blocks[0].header.number)
    assert.ok(isConsecutive(getBlocks!), 'blocks should be consecutive')
  })

  it('should get 5 consecutive blocks, starting from block 0', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 0, max: 5, skip: 0, reverse: false
    const getBlocks = await blockchain.getBlocks(0, 5, 0, false)
    assert.equal(getBlocks!.length, 5)
    assert.equal(getBlocks![0].header.number, blocks[0].header.number)
    assert.ok(isConsecutive(getBlocks!), 'blocks should be consecutive')
  })

  it('should get 5 blocks, skipping 1 apart, starting from block 1', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 1, max: 5, skip: 1, reverse: false
    const getBlocks = await blockchain.getBlocks(1, 5, 1, false)
    assert.equal(getBlocks!.length, 5)
    assert.equal(getBlocks![1].header.number, blocks[3].header.number, 'should skip one block')
    assert.ok(!isConsecutive(getBlocks!), 'blocks should not be consecutive')
  })

  it('should get 5 blocks, skipping 2 apart, starting from block 0', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 0, max: 5, skip: 2, reverse: false
    const getBlocks = await blockchain.getBlocks(0, 5, 2, false)
    assert.equal(getBlocks!.length, 5)
    assert.equal(getBlocks![1].header.number, blocks[3].header.number, 'should skip two blocks')
    assert.ok(!isConsecutive(getBlocks!), 'blocks should not be consecutive')
  })

  it('should get 15 consecutive blocks, starting from block 0', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(15)
    assert.equal(error, null, 'no error')
    // start: 0, max: 17, skip: 0, reverse: false
    const getBlocks = await blockchain.getBlocks(0, 17, 0, false)
    assert.equal(getBlocks!.length, 15)
    assert.equal(getBlocks![0].header.number, blocks[0].header.number)
    assert.ok(isConsecutive(getBlocks!), 'blocks should be consecutive')
  })

  it('should get 5 consecutive blocks, starting from block 1', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 1, max: 5, skip: 0, reverse: false
    const getBlocks = await blockchain.getBlocks(1, 5, 0, false)
    assert.equal(getBlocks!.length, 5)
    assert.equal(getBlocks![0].header.number, blocks[1].header.number)
    assert.ok(isConsecutive(getBlocks!), 'blocks should be consecutive')
  })

  it('should get 5 consecutive blocks, starting from block 5', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 5, max: 5, skip: 0, reverse: false
    const getBlocks = await blockchain.getBlocks(5, 5, 0, false)
    assert.equal(getBlocks!.length, 5)
    assert.equal(getBlocks![0].header.number, blocks[5].header.number)
    assert.ok(isConsecutive(getBlocks!), 'blocks should be consecutive')
  })

  it('should get 5 consecutive blocks, starting from block 5, reversed', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 5, max: 5, skip: 0, reverse: true
    const getBlocks = await blockchain.getBlocks(5, 5, 0, true)
    assert.equal(getBlocks!.length, 5)
    assert.equal(getBlocks![0].header.number, blocks[5].header.number)
    assert.ok(isConsecutive(getBlocks!.reverse()), 'blocks should be consecutive')
  })

  it('should get 6 consecutive blocks, starting from block 5, reversed', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(15)
    assert.equal(error, null, 'no error')
    // start: 5, max: 15, skip: 0, reverse: true
    const getBlocks = await blockchain.getBlocks(5, 15, 0, true)
    assert.equal(getBlocks!.length, 6)
    assert.equal(getBlocks![0].header.number, blocks[5].header.number)
    assert.ok(isConsecutive(getBlocks!.reverse()), 'blocks should be consecutive')
  })

  it('should get 6 blocks, starting from block 10, reversed, skipping 1 apart', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    // start: 10, max: 10, skip: 1, reverse: true
    const getBlocks = await blockchain.getBlocks(10, 10, 1, true)
    assert.equal(getBlocks!.length, 6)
    assert.equal(getBlocks![1].header.number, blocks[8].header.number, 'should skip one block')
    assert.ok(!isConsecutive(getBlocks!.reverse()), 'blocks should not be consecutive')
  })

  it('should find needed hashes', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    const neededHash = hexToBytes('0xabcdef')
    const hashes = await blockchain.selectNeededHashes([
      blocks[0].hash(),
      blocks[9].hash(),
      neededHash,
    ])
    assert.deepEqual(hashes[0], neededHash)
  })

  it('should add fork header and reset stale heads', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(15)
    assert.equal(error, null, 'no error')

    await blockchain.putBlocks(blocks.slice(1))

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const headerData = {
      number: 15,
      parentHash: blocks[14].hash(),
      gasLimit: 8000000,
      timestamp: BigInt(blocks[14].header.timestamp) + BigInt(1),
    }
    const forkHeader = createBlockHeader(headerData, {
      common,
      calcDifficultyFromHeader: blocks[14].header,
    })

    blockchain._heads['staleTest'] = blockchain._headHeaderHash

    await blockchain.putHeader(forkHeader)

    assert.deepEqual(blockchain._heads['staleTest'], blocks[14].hash(), 'should update stale head')
    assert.deepEqual(blockchain._headBlockHash, blocks[14].hash(), 'should update stale headBlock')
  })

  it('should delete fork header', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(15)
    assert.equal(error, null, 'no error')

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const headerData = {
      number: 15,
      parentHash: blocks[14].hash(),
      gasLimit: 8000000,
      //eslint-disable-next-line
      timestamp: BigInt(blocks[14].header.timestamp) + BigInt(1),
    }
    const forkHeader = createBlockHeader(headerData, {
      common,
      calcDifficultyFromHeader: blocks[14].header,
    })

    blockchain._heads['staleTest'] = blockchain._headHeaderHash

    await blockchain.putHeader(forkHeader)

    assert.deepEqual(blockchain._heads['staleTest'], blocks[14].hash(), 'should update stale head')
    assert.deepEqual(blockchain._headBlockHash, blocks[14].hash(), 'should update stale headBlock')

    await blockchain.delBlock(forkHeader.hash())

    assert.deepEqual(blockchain._headHeaderHash, blocks[14].hash(), 'should reset headHeader')
    assert.deepEqual(blockchain._headBlockHash, blocks[14].hash(), 'should not change headBlock')
  })

  it('should delete blocks', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')

    const delNextBlock = async (number: number): Promise<any> => {
      const block = blocks[number]
      await blockchain.delBlock(block.hash())
      if (number > 6) {
        return delNextBlock(--number)
      }
    }

    await delNextBlock(9)
    assert.deepEqual(blockchain._headHeaderHash, blocks[5].hash(), 'should have block 5 as head')
  })

  it('should delete blocks and children', async () => {
    const { blockchain, blocks, error } = await generateBlockchain(25)
    assert.equal(error, null, 'no error')
    await blockchain.delBlock(blocks[1].hash())
    assert.deepEqual(blockchain._headHeaderHash, blocks[0].hash(), 'should have genesis as head')
  })

  it('should put one block at a time', async () => {
    const blocks = generateBlocks(15)
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock: blocks[0],
    })
    await blockchain.putBlock(blocks[1])
    await blockchain.putBlock(blocks[2])
    await blockchain.putBlock(blocks[3])
  })

  it('should test nil bodies / throw', async () => {
    const blocks = generateBlocks(3)
    const blockchain = await createBlockchain({
      validateBlocks: false,
      validateConsensus: false,
      genesisBlock: blocks[0],
    })
    await blockchain.putHeader(blocks[1].header)
    // Should be able to get the block
    await blockchain.getBlock(BigInt(1))

    const block2HeaderValuesArray = blocks[2].header.raw()

    block2HeaderValuesArray[1] = new Uint8Array(32)
    const block2Header = createBlockHeaderFromBytesArray(block2HeaderValuesArray, {
      common: blocks[2].common,
    })
    await blockchain.putHeader(block2Header)
    try {
      await blockchain.getBlock(BigInt(2))
      assert.fail('block should not be constructed')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.equal(
        e.message,
        'uncle hash should be equal to hash of empty array',
        'block not constructed from empty bodies',
      )
    }
  })

  it('should put multiple blocks at once', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const blocks: Block[] = []
    const genesisBlock = createBlock({ header: { gasLimit: 8000000 } }, { common })
    blocks.push(...generateBlocks(15, [genesisBlock]))
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })
    await blockchain.putBlocks(blocks.slice(1))
  })

  it('should validate', async () => {
    const genesisBlock = createBlock({ header: { gasLimit: 8000000 } })
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })

    const invalidBlock = createBlock({ header: { number: 50 } })
    try {
      await blockchain.putBlock(invalidBlock)
      assert.fail('should not validate an invalid block')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(error, 'should not validate an invalid block')
    }
  })

  it('should add block with body', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const genesisRlp = hexToBytes(preLondonData.genesisRLP as PrefixedHexString)
    const genesisBlock = createBlockFromRLP(genesisRlp, { common })
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })

    const blockRlp = hexToBytes(preLondonData.blocks[0].rlp as PrefixedHexString)
    const block = createBlockFromRLP(blockRlp, { common })
    await blockchain.putBlock(block)
  })

  it('uncached db ops', async () => {
    const [db, genesis] = await createTestDB()
    if (typeof genesis === 'undefined') {
      return assert.fail('genesis not defined!')
    }
    const blockchain = await createBlockchain({ db, genesisBlock: genesis })

    const number = await blockchain.dbManager.hashToNumber(genesis?.hash())
    assert.equal(number, BigInt(0), 'should perform _hashToNumber correctly')

    const hash = await blockchain.dbManager.numberToHash(BigInt(0))
    assert.deepEqual(genesis.hash(), hash, 'should perform _numberToHash correctly')

    // cast the blockchain as <any> in order to get access to the private getTotalDifficulty
    const td = await (<any>blockchain).getTotalDifficulty(genesis.hash(), BigInt(0))
    assert.equal(td, genesis.header.difficulty, 'should perform getTotalDifficulty correctly')
  })

  it('should save headers', async () => {
    const db = new MapDB()
    const gasLimit = 8000000

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = createBlock({ header: { gasLimit } }, { common })
    let blockchain = await createBlockchain({
      db,
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })

    const headerData = {
      number: 1,
      parentHash: genesisBlock.hash(),
      gasLimit,
      timestamp: genesisBlock.header.timestamp + BigInt(1),
    }
    const header = createBlockHeader(headerData, {
      calcDifficultyFromHeader: genesisBlock.header,
      common,
    })
    await blockchain.putHeader(header)

    blockchain = await createBlockchain({
      db,
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })

    const latestHeader = await blockchain.getCanonicalHeadHeader()
    assert.deepEqual(latestHeader.hash(), header.hash(), 'should save headHeader')

    const latestBlock = await blockchain.getCanonicalHeadBlock()
    assert.deepEqual(latestBlock.hash(), genesisBlock.hash(), 'should save headBlock')
  })

  it('should get latest', async () => {
    const gasLimit = 8000000
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const opts: BlockOptions = { common }

    const genesisBlock = createBlock({ header: { gasLimit } }, opts)
    const blockchain = await createBlockchain({
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })

    const blockData = {
      header: {
        number: 1,
        parentHash: genesisBlock.hash(),
        timestamp: genesisBlock.header.timestamp + BigInt(3),
        gasLimit,
      },
    }
    opts.calcDifficultyFromHeader = genesisBlock.header
    const block = createBlock(blockData, opts)

    const headerData1 = {
      number: 1,
      parentHash: genesisBlock.hash(),
      timestamp: genesisBlock.header.timestamp + BigInt(1),
      gasLimit,
    }
    opts.calcDifficultyFromHeader = genesisBlock.header
    const header1 = createBlockHeader(headerData1, opts)
    const headers = [header1]

    const headerData2 = {
      number: 2,
      parentHash: header1.hash(),
      timestamp: header1.timestamp + BigInt(1),
      gasLimit,
    }
    opts.calcDifficultyFromHeader = block.header
    const header2 = createBlockHeader(headerData2, opts)
    headers.push(header2)

    await blockchain.putHeaders(headers)

    const latestHeader = await blockchain.getCanonicalHeadHeader()
    assert.deepEqual(latestHeader.hash(), headers[1].hash(), 'should update latest header')

    const latestBlock = await blockchain.getCanonicalHeadBlock()
    assert.deepEqual(latestBlock.hash(), genesisBlock.hash(), 'should not change latest block')

    await blockchain.putBlock(block)

    const latestHeader2 = await blockchain.getCanonicalHeadHeader()
    assert.deepEqual(latestHeader2.hash(), headers[1].hash(), 'should not change latest header')

    const getBlock = await blockchain.getCanonicalHeadBlock()
    assert.deepEqual(getBlock!.hash(), block.hash(), 'should update latest block')
  })

  it('mismatched chains', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const gasLimit = 8000000

    const genesisBlock = createBlock({ header: { gasLimit } }, { common })

    const blockData1 = {
      header: {
        number: 1,
        parentHash: genesisBlock.hash(),
        timestamp: genesisBlock.header.timestamp + BigInt(1),
        gasLimit,
      },
    }
    const blockData2 = {
      ...blockData1,
      number: 2,
      timestamp: genesisBlock.header.timestamp + BigInt(2),
    }

    const blocks = [
      genesisBlock,
      createBlock(blockData1, {
        common,
        calcDifficultyFromHeader: genesisBlock.header,
      }),
      createBlock(blockData2, {
        common: new Common({ chain: Sepolia, hardfork: Hardfork.Chainstart }),
        calcDifficultyFromHeader: genesisBlock.header,
      }),
    ]

    const blockchain = await createBlockchain({
      common,
      validateBlocks: true,
      validateConsensus: false,
      genesisBlock,
    })

    for (let i = 1; i < blocks.length; i++) {
      let error
      try {
        await blockchain.putBlock(blocks[i])
      } catch (err) {
        if (!(err instanceof Error)) {
          err = new Error(err)
        }
        error = err
      }
      if (i === 2) {
        assert.ok(error.message.match('Chain mismatch'), 'should return chain mismatch error')
      } else {
        assert.isUndefined(error, 'should not return mismatch error')
      }
    }
  })
})

describe('initialization tests', () => {
  it('should read genesis from database', async () => {
    const common = new Common({
      chain: Mainnet,
      hardfork: Hardfork.Chainstart,
    })
    const blockchain = await createBlockchain({ common })
    const genesisHash = blockchain.genesisBlock.hash()

    assert.deepEqual(
      (await blockchain.getIteratorHead()).hash(),
      genesisHash,
      'head hash should equal expected mainnet genesis hash',
    )

    const db = blockchain.db

    const newBlockchain = await createBlockchain({ db, common })

    assert.deepEqual(
      (await newBlockchain.getIteratorHead()).hash(),
      genesisHash,
      'head hash should be read from the provided db',
    )
  })

  it('should allow to put a custom genesis block', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const genesisBlock = createBlock(
      {
        header: {
          extraData: utf8ToBytes('custom extra data'),
        },
      },
      { common },
    )
    const hash = genesisBlock.hash()
    const blockchain = await createBlockchain({ common, genesisBlock })
    const db = blockchain.db

    assert.deepEqual(
      (await blockchain.getIteratorHead()).hash(),
      hash,
      'blockchain should put custom genesis block',
    )

    const newBlockchain = await createBlockchain({ db, genesisBlock })
    assert.deepEqual(
      (await newBlockchain.getIteratorHead()).hash(),
      hash,
      'head hash should be read from the provided db',
    )
  })

  it('should not allow to change the genesis block in the database', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    const genesisBlock = createBlock(
      {
        header: {
          extraData: utf8ToBytes('custom extra data'),
        },
      },
      { common },
    )
    const hash = genesisBlock.hash()
    const blockchain = await createBlockchain({ common, genesisBlock })
    const db = blockchain.db

    const otherGenesisBlock = createBlock(
      {
        header: {
          extraData: utf8ToBytes('other extra data'),
        },
      },
      { common },
    )

    // assert that this is a block with a new hash
    if (equalsBytes(otherGenesisBlock.hash(), hash)) {
      assert.fail('other genesis block should have a different hash than the genesis block')
    }

    // try to put a new genesis block should throw
    try {
      await blockchain.putBlock(otherGenesisBlock)
      assert.fail('putting a genesis block did not throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.equal(
        e.message,
        'Cannot put a different genesis block than current blockchain genesis: create a new Blockchain',
        'putting a genesis block did throw (otherGenesisBlock not found in chain)',
      )
    }

    // trying to input a genesis block which differs from the one in db should throw on creation
    try {
      await createBlockchain({ genesisBlock: otherGenesisBlock, db })
      assert.fail('creating blockchain with different genesis block than in db did not throw')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.equal(
        e.message,
        'The genesis block in the DB has a different hash than the provided genesis block.',
        'creating blockchain with different genesis block than in db throws',
      )
    }
  })
})

it('should correctly derive mainnet genesis block hash and stateRoot', async () => {
  const common = new Common({ chain: Mainnet })
  const blockchain = await createBlockchain({ common })
  const mainnetGenesisBlockHash = hexToBytes(
    '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
  )
  const mainnetGenesisStateRoot = hexToBytes(
    '0xd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544',
  )
  assert.deepEqual(blockchain.genesisBlock.hash(), mainnetGenesisBlockHash)
  assert.deepEqual(blockchain.genesisBlock.header.stateRoot, mainnetGenesisStateRoot)
})
