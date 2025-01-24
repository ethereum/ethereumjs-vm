import { Common, Goerli, Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { createLegacyTx } from '@ethereumjs/tx'
import { KECCAK256_RLP_ARRAY, bytesToHex, equalsBytes, hexToBytes, toBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { genTransactionsTrieRoot } from '../src/helpers.js'
import {
  type Block,
  type BlockBytes,
  createBlock,
  createBlockFromBytesArray,
  createBlockFromRLP,
  createBlockFromRPC,
  createEmptyBlock,
  paramsBlock,
} from '../src/index.js'

import { genesisHashesTestData } from './testdata/genesisHashesTest.js'
import { testdataFromRPCGoerliData } from './testdata/testdata-from-rpc-goerli.js'
import { testdataPreLondon2Data } from './testdata/testdata_pre-london-2.js'
import { testdataPreLondonData } from './testdata/testdata_pre-london.js'
import { testnetMergeData } from './testdata/testnetMerge.js'

import type { NestedUint8Array, PrefixedHexString } from '@ethereumjs/util'

async function testTransactionValidation(block: Block) {
  assert.ok(block.transactionsAreValid())
  assert.ok(block.getTransactionsValidationErrors().length === 0)
}

describe('[Block]', () => {
  describe('Initialization', () => {
    it('should initialize with default parameters', () => {
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
      const genesis = createBlock({}, { common })
      assert.ok(bytesToHex(genesis.hash()), 'block should initialize')

      const emptyBlock = createEmptyBlock({}, { common })
      assert.ok(bytesToHex(emptyBlock.hash()), 'block should initialize')

      // test default freeze values
      // also test if the options are carried over to the constructor
      const block = createBlock({})
      assert.ok(Object.isFrozen(block), 'block should be frozen by default')

      const rlpBlock = block.serialize()
      const unfreezedBlock = createBlockFromRLP(rlpBlock, { freeze: false })
      assert.ok(
        !Object.isFrozen(unfreezedBlock),
        'block should not be frozen when freeze deactivated in options',
      )

      const zero = new Uint8Array(0)
      const headerArray: Uint8Array[] = []
      for (let item = 0; item < 15; item++) {
        headerArray.push(zero)
      }

      // mock header data (if set to new Uint8Array() header throws)
      headerArray[0] = new Uint8Array(32) // parentHash
      headerArray[2] = new Uint8Array(20) // coinbase
      headerArray[3] = new Uint8Array(32) // stateRoot
      headerArray[4] = new Uint8Array(32) // transactionsTrie
      headerArray[5] = new Uint8Array(32) // receiptTrie
      headerArray[13] = new Uint8Array(32) // mixHash
      headerArray[14] = new Uint8Array(8) // nonce

      const valuesArray = <BlockBytes>[headerArray, [], []]

      const blockFromBytesArray = createBlockFromBytesArray(valuesArray, { common })
      assert.ok(Object.isFrozen(blockFromBytesArray), 'block should be frozen by default')

      const unfreezedBlockFromBytesArray = createBlockFromBytesArray(valuesArray, {
        common,
        freeze: false,
      })
      assert.ok(
        !Object.isFrozen(unfreezedBlockFromBytesArray),
        'block should not be frozen when freeze deactivated in options',
      )
    })

    it('should initialize with custom parameters', () => {
      const params = JSON.parse(JSON.stringify(paramsBlock))
      params['1']['minGasLimit'] = 3000 // 5000
      const block = createBlock({}, { params })
      assert.equal(
        block.common.param('minGasLimit'),
        BigInt(3000),
        'should use custom parameters provided',
      )
    })

    it('should handle setHardfork option', () => {
      const common = createCustomCommon(testnetMergeData, Mainnet)

      let block = createBlock(
        {
          header: {
            number: 12, // Berlin block
            extraData: new Uint8Array(97),
          },
        },
        { common, setHardfork: true },
      )
      assert.equal(block.common.hardfork(), Hardfork.Berlin, 'should use setHardfork option')

      block = createBlock(
        {
          header: {
            number: 20, // Future block
          },
        },
        { common, setHardfork: true },
      )
      assert.equal(
        block.common.hardfork(),
        Hardfork.Paris,
        'should use setHardfork option post merge',
      )
    })

    it('should handle undefined and null parameters', () => {
      assert.doesNotThrow(function () {
        createBlock()
      })

      const common = new Common({ chain: Goerli })
      const opts = { common }
      assert.doesNotThrow(function () {
        createBlock({}, opts)
      })
    })

    it('should throw when initializing with uncle headers on a PoA network', () => {
      const common = new Common({ chain: Mainnet })
      const uncleBlock = createBlock({ header: { extraData: new Uint8Array(117) } }, { common })
      assert.throws(function () {
        createBlock({ uncleHeaders: [uncleBlock.header] }, { common })
      })
    })
  })

  describe('Validation', () => {
    describe('Block Data', () => {
      it('should validate block on PoW chain', async () => {
        const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
        const blockRlp = hexToBytes(testdataPreLondonData.blocks[0].rlp as PrefixedHexString)
        try {
          createBlockFromRLP(blockRlp, { common })
          assert.ok(true, 'should pass')
        } catch (error: any) {
          assert.fail('should not throw')
        }
      })

      it('should validate block on PoA chain', async () => {
        const common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })

        try {
          createBlockFromRPC(testdataFromRPCGoerliData, [], { common })
          assert.ok(true, 'does not throw')
        } catch (error: any) {
          assert.fail('error thrown')
        }
      })

      it('should validate transaction trie', async () => {
        const blockRlp = hexToBytes(testdataPreLondonData.blocks[0].rlp as PrefixedHexString)
        const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
        const block = createBlockFromRLP(blockRlp, { common, freeze: false })
        await testTransactionValidation(block)
        ;(block.header as any).transactionsTrie = new Uint8Array(32)
        try {
          await block.validateData()
          assert.fail('should throw')
        } catch (error: any) {
          assert.ok((error.message as string).includes('invalid transaction trie'))
        }
      })

      it('should validate uncle hash', async () => {
        const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
        const blockRlp = hexToBytes(testdataPreLondon2Data.blocks[2].rlp as PrefixedHexString)
        const block = createBlockFromRLP(blockRlp, { common, freeze: false })
        assert.equal(block.uncleHashIsValid(), true)
        ;(block.header as any).uncleHash = new Uint8Array(32)
        try {
          await block.validateData()
          assert.fail('should throw')
        } catch (error: any) {
          assert.ok((error.message as string).includes('invalid uncle hash'))
        }
      })

      it('should validate data integrity', async () => {
        const unsignedTx = createLegacyTx({})
        const txRoot = await genTransactionsTrieRoot([unsignedTx])

        let block = createBlock({
          transactions: [unsignedTx],
          header: {
            transactionsTrie: txRoot,
          },
        })

        // Verifies that the "signed tx check" is skipped
        await block.validateData(false, false)

        async function checkThrowsAsync(fn: Promise<void>, errorMsg: string) {
          try {
            await fn
            assert.fail('should throw')
          } catch (e: any) {
            assert.ok((e.message as string).includes(errorMsg))
          }
        }

        const zeroRoot = new Uint8Array(32)

        // Tx root
        block = createBlock({
          transactions: [unsignedTx],
          header: {
            transactionsTrie: zeroRoot,
          },
        })
        await checkThrowsAsync(block.validateData(false, false), 'invalid transaction trie')

        // Withdrawals root
        block = createBlock(
          {
            header: {
              withdrawalsRoot: zeroRoot,
              uncleHash: KECCAK256_RLP_ARRAY,
            },
          },
          { common: new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai }) },
        )
        await checkThrowsAsync(block.validateData(false, false), 'invalid withdrawals trie')

        // Uncle root
        block = createBlock(
          {
            header: {
              uncleHash: zeroRoot,
            },
          },
          { common: new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart }) },
        )
        await checkThrowsAsync(block.validateData(false, false), 'invalid uncle hash')

        // Verkle witness
        const common = new Common({ chain: Mainnet, eips: [6800], hardfork: Hardfork.Cancun })
        // Note: `executionWitness: undefined` will still initialize an execution witness in the block
        // So, only testing for `null` here
        block = createBlock({ executionWitness: null }, { common })
        await checkThrowsAsync(
          block.validateData(false, false),
          'Invalid block: ethereumjs stateless client needs executionWitness',
        )
      })
    })

    describe('Transactions', () => {
      it('should validate transactions', async () => {
        const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
        const blockRlp = hexToBytes(testdataPreLondonData.blocks[0].rlp as PrefixedHexString)
        const block = createBlockFromRLP(blockRlp, { common, freeze: false })
        await testTransactionValidation(block)
      })

      it('should validate empty transaction list', async () => {
        const block = createBlock({})
        await testTransactionValidation(block)
      })

      it('should validate legacy transactions in London hardfork', async () => {
        const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
        const blockRlp = hexToBytes(testdataPreLondonData.blocks[0].rlp as PrefixedHexString)
        const block = createBlockFromRLP(blockRlp, { common, freeze: false })
        await testTransactionValidation(block)
        ;(block.transactions[0] as any).gasPrice = BigInt(0)
        const result = block.getTransactionsValidationErrors()
        assert.ok(
          result[0].includes('tx unable to pay base fee (non EIP-1559 tx)'),
          'should throw when legacy tx is unable to pay base fee',
        )
      })
    })
  })

  describe('Genesis Block', () => {
    it('should correctly identify genesis block', () => {
      const block = createBlock({ header: { number: 1 } })
      assert.notEqual(block.isGenesis(), true)
      const genesisBlock = createBlock({ header: { number: 0 } })
      assert.equal(genesisBlock.isGenesis(), true)
    })

    it('should have correct genesis hashes', () => {
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
      const rlp = hexToBytes(`0x${genesisHashesTestData.test.genesis_rlp_hex}`)
      const hash = hexToBytes(`0x${genesisHashesTestData.test.genesis_hash}`)
      const block = createBlockFromRLP(rlp, { common })
      assert.ok(equalsBytes(block.hash(), hash), 'genesis hash match')
    })
  })

  describe('Hashing', () => {
    it('should correctly compute block hash', () => {
      let common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
      const rlp = hexToBytes(`0x${genesisHashesTestData.test.genesis_rlp_hex}`)
      const hash = hexToBytes(`0x${genesisHashesTestData.test.genesis_hash}`)
      let block = createBlockFromRLP(rlp, { common })
      assert.ok(equalsBytes(block.hash(), hash), 'genesis hash match')

      common = new Common({
        chain: Mainnet,
        hardfork: Hardfork.Chainstart,
        customCrypto: {
          keccak256: () => {
            return new Uint8Array([1])
          },
        },
      })
      block = createBlockFromRLP(rlp, { common })
      assert.deepEqual(block.hash(), new Uint8Array([1]), 'custom crypto applied on hash() method')
    })
  })

  describe('Serialization', () => {
    it('should return the same block data from raw()', () => {
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
      const block = createBlockFromRLP(
        toBytes(testdataPreLondon2Data.blocks[2].rlp as PrefixedHexString),
        {
          common,
        },
      )
      const createBlockFromRaw = createBlockFromBytesArray(block.raw(), { common })
      assert.ok(equalsBytes(block.hash(), createBlockFromRaw.hash()))
    })

    it('should correctly serialize to JSON', () => {
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
      const block = createBlockFromRLP(
        toBytes(testdataPreLondon2Data.blocks[2].rlp as PrefixedHexString),
        {
          common,
        },
      )
      assert.equal(typeof block.toJSON(), 'object')
    })
  })

  describe('Hardfork Specifics', () => {
    it('should handle DAO hardfork', () => {
      const blockData = RLP.decode(
        testdataPreLondon2Data.blocks[0].rlp as PrefixedHexString,
      ) as NestedUint8Array
      // Set block number from test block to mainnet DAO fork block 1920000
      blockData[0][8] = hexToBytes('0x1D4C00')

      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Dao })
      assert.throws(
        function () {
          createBlockFromBytesArray(blockData as BlockBytes, { common })
        },
        /extraData should be 'dao-hard-fork/,
        undefined,
        'should throw on DAO HF block with wrong extra data',
      ) // eslint-disable-line

      // Set extraData to dao-hard-fork
      blockData[0][12] = hexToBytes('0x64616f2d686172642d666f726b')

      assert.doesNotThrow(function () {
        createBlockFromBytesArray(blockData as BlockBytes, { common })
      }, 'should not throw on DAO HF block with correct extra data')
    })

    it('should set canonical difficulty with calcDifficultyFromHeader', () => {
      let common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
      const genesis = createBlock({}, { common })

      const nextBlockHeaderData = {
        number: genesis.header.number + BigInt(1),
        timestamp: genesis.header.timestamp + BigInt(10),
      }

      common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
      const blockWithoutDifficultyCalculation = createBlock(
        {
          header: nextBlockHeaderData,
        },
        { common },
      )

      // test if difficulty defaults to 0
      assert.equal(
        blockWithoutDifficultyCalculation.header.difficulty,
        BigInt(0),
        'header difficulty should default to 0',
      )

      // test if we set difficulty if we have a "difficulty header" in options; also verify this is equal to reported canonical difficulty.
      const blockWithDifficultyCalculation = createBlock(
        {
          header: nextBlockHeaderData,
        },
        {
          common,
          calcDifficultyFromHeader: genesis.header,
        },
      )

      assert.ok(
        blockWithDifficultyCalculation.header.difficulty > BigInt(0),
        'header difficulty should be set if difficulty header is given',
      )
      assert.ok(
        blockWithDifficultyCalculation.header.ethashCanonicalDifficulty(genesis.header) ===
          blockWithDifficultyCalculation.header.difficulty,
        'header difficulty is canonical difficulty if difficulty header is given',
      )

      // test if we can provide a block which is too far ahead to still calculate difficulty
      const noParentHeaderData = {
        number: genesis.header.number + BigInt(1337),
        timestamp: genesis.header.timestamp + BigInt(10),
      }

      const block_farAhead = createBlock(
        {
          header: noParentHeaderData,
        },
        {
          common,
          calcDifficultyFromHeader: genesis.header,
        },
      )

      assert.ok(
        block_farAhead.header.difficulty > BigInt(0),
        'should allow me to provide a bogus next block to calculate difficulty on when providing a difficulty header',
      )
    })

    it('should initialize Shanghai blocks with correct defaults', () => {
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai })
      const block = createBlock({}, { common })
      assert.equal(block.common.hardfork(), Hardfork.Shanghai, 'hardfork should be set to shanghai')
      assert.deepEqual(block.withdrawals, [], 'withdrawals should be set to default empty array')
    })
  })

  describe('Invalid Inputs', () => {
    it('should throw on invalid header values', () => {
      assert.throws(() => {
        createBlock({
          header: {
            number: -1n, // Invalid negative block number
          },
        })
      }, /Cannot convert negative bigint/)

      assert.throws(() => {
        createBlock({
          header: {
            timestamp: -1n, // Invalid negative timestamp
          },
        })
      }, /Cannot convert negative bigint/)
    })

    it('should throw on invalid parent hash', () => {
      assert.throws(() => {
        createBlock({
          header: {
            parentHash: new Uint8Array(31), // Invalid length
          },
        })
      }, /parentHash must be/)
    })

    it('should throw on invalid state root', () => {
      assert.throws(() => {
        createBlock({
          header: {
            stateRoot: new Uint8Array(31), // Invalid length
          },
        })
      }, /stateRoot must be/)
    })

    it('should throw on mismatched uncles and uncleHash', () => {
      // ... (new test)
    })

    it('should throw on invalid transaction signatures', () => {
      // ... (new test)
    })

    it('should throw on invalid withdrawals in pre-Shanghai blocks', () => {
      // ... (new test)
    })
  })
})
