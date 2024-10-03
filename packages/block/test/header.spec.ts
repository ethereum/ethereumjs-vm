import { Common, Goerli, Hardfork, Mainnet } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  KECCAK256_RLP,
  KECCAK256_RLP_ARRAY,
  bytesToHex,
  concatBytes,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import {
  Block,
  createBlock,
  createBlockFromRLP,
  createBlockHeader,
  createBlockHeaderFromBytesArray,
  createBlockHeaderFromRLP,
} from '../src/index.js'

import { bcBlockGasLimitTestData } from './testdata/bcBlockGasLimitTest.js'
import { blocksGoerliData } from './testdata/blocks_goerli.js'
import { blocksMainnetData } from './testdata/blocks_mainnet.js'

import type { BlockHeader } from '../src/index.js'
import type { CliqueConfig } from '@ethereumjs/common'
import type { PrefixedHexString } from '@ethereumjs/util'

describe('[Block]: Header functions', () => {
  it('should create with default constructor', () => {
    function compareDefaultHeader(header: BlockHeader) {
      assert.ok(equalsBytes(header.parentHash, new Uint8Array(32)))
      assert.ok(equalsBytes(header.uncleHash, KECCAK256_RLP_ARRAY))
      assert.ok(header.coinbase.equals(createZeroAddress()))
      assert.ok(equalsBytes(header.stateRoot, new Uint8Array(32)))
      assert.ok(equalsBytes(header.transactionsTrie, KECCAK256_RLP))
      assert.ok(equalsBytes(header.receiptTrie, KECCAK256_RLP))
      assert.ok(equalsBytes(header.logsBloom, new Uint8Array(256)))
      assert.equal(header.difficulty, BigInt(0))
      assert.equal(header.number, BigInt(0))
      assert.equal(header.gasLimit, BigInt('0xffffffffffffff'))
      assert.equal(header.gasUsed, BigInt(0))
      assert.equal(header.timestamp, BigInt(0))
      assert.ok(equalsBytes(header.extraData, new Uint8Array(0)))
      assert.ok(equalsBytes(header.mixHash, new Uint8Array(32)))
      assert.ok(equalsBytes(header.nonce, new Uint8Array(8)))
    }

    const header = createBlockHeader()
    compareDefaultHeader(header)

    const block = new Block()
    compareDefaultHeader(block.header)
  })

  it('Initialization -> fromHeaderData()', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    let header = createBlockHeader(undefined, { common })
    assert.ok(bytesToHex(header.hash()), 'genesis block should initialize')
    assert.equal(
      header.common.hardfork(),
      'chainstart',
      'should initialize with correct HF provided',
    )

    common.setHardfork(Hardfork.Byzantium)
    assert.equal(
      header.common.hardfork(),
      'chainstart',
      'should stay on correct HF if outer common HF changes',
    )

    header = createBlockHeader({}, { common })
    assert.ok(bytesToHex(header.hash()), 'default block should initialize')

    // test default freeze values
    // also test if the options are carried over to the constructor
    header = createBlockHeader({})
    assert.ok(Object.isFrozen(header), 'block should be frozen by default')

    header = createBlockHeader({}, { freeze: false })
    assert.ok(
      !Object.isFrozen(header),
      'block should not be frozen when freeze deactivated in options',
    )
  })

  it('Initialization -> fromRLPSerializedHeader()', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    let header = createBlockHeader({}, { common, freeze: false })

    const rlpHeader = header.serialize()
    header = createBlockHeaderFromRLP(rlpHeader, {
      common,
    })
    assert.ok(Object.isFrozen(header), 'block should be frozen by default')

    header = createBlockHeaderFromRLP(rlpHeader, {
      common,
      freeze: false,
    })
    assert.ok(
      !Object.isFrozen(header),
      'block should not be frozen when freeze deactivated in options',
    )

    header = createBlockHeaderFromRLP(
      hexToBytes(
        '0xf90214a00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a0d7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000850400000000808213888080a011bbe8db4e347b4e8c937c1c8370e4b5ed33adb3db69cbdb7a38e1e50b1b82faa00000000000000000000000000000000000000000000000000000000000000000880000000000000042',
      ),
      { common, setHardfork: false },
    )
    assert.equal(
      bytesToHex(header.hash()),
      '0xf0f936910ebf101b7b168bbe08e3f166ce1e75e16f513dd5a97af02fbe7de7c0',
      'genesis block should produce incorrect hash since default hardfork is london',
    )
  })

  it('Initialization -> fromRLPSerializedHeader() -> error cases', () => {
    try {
      createBlockHeaderFromRLP(RLP.encode('a'))
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      const expectedError = 'Invalid serialized header input. Must be array'
      assert.ok(e.message.includes(expectedError), 'should throw with header as rlp encoded string')
    }
  })

  it('Initialization -> createWithdrawalFromBytesArray()', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const zero = new Uint8Array(0)
    const headerArray = []
    for (let item = 0; item < 15; item++) {
      headerArray.push(zero)
    }

    // mock header data (if set to new Uint8Array() header throws)
    headerArray[0] = new Uint8Array(32) //parentHash
    headerArray[2] = new Uint8Array(20) //coinbase
    headerArray[3] = new Uint8Array(32) //stateRoot
    headerArray[4] = new Uint8Array(32) //transactionsTrie
    headerArray[5] = new Uint8Array(32) //receiptTrie
    headerArray[13] = new Uint8Array(32) // mixHash
    headerArray[14] = new Uint8Array(8) // nonce

    let header = createBlockHeaderFromBytesArray(headerArray, { common })
    assert.ok(Object.isFrozen(header), 'block should be frozen by default')

    header = createBlockHeaderFromBytesArray(headerArray, { common, freeze: false })
    assert.ok(
      !Object.isFrozen(header),
      'block should not be frozen when freeze deactivated in options',
    )
  })

  it('Initialization -> createWithdrawalFromBytesArray() -> error cases', () => {
    const headerArray = Array(22).fill(new Uint8Array(0))

    // mock header data (if set to new Uint8Array() header throws)
    headerArray[0] = new Uint8Array(32) //parentHash
    headerArray[2] = new Uint8Array(20) //coinbase
    headerArray[3] = new Uint8Array(32) //stateRoot
    headerArray[4] = new Uint8Array(32) //transactionsTrie
    headerArray[5] = new Uint8Array(32) //receiptTrie
    headerArray[13] = new Uint8Array(32) // mixHash
    headerArray[14] = new Uint8Array(8) // nonce
    headerArray[15] = new Uint8Array(4) // bad data
    try {
      createBlockHeaderFromBytesArray(headerArray)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      const expectedError = 'invalid header. More values than expected were received'
      assert.ok(e.message.includes(expectedError), 'should throw on more values than expected')
    }

    try {
      createBlockHeaderFromBytesArray(headerArray.slice(0, 5))
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      const expectedError = 'invalid header. Less values than expected were received'
      assert.ok(e.message.includes(expectedError), 'should throw on less values than expected')
    }
  })

  it('Initialization -> Clique Blocks', () => {
    const common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
    const header = createBlockHeader({ extraData: new Uint8Array(97) }, { common })
    assert.ok(bytesToHex(header.hash()), 'default block should initialize')
  })

  it('should validate extraData', async () => {
    // PoW
    let common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    let genesis = createBlock({}, { common })

    const number = 1
    let parentHash = genesis.hash()
    const timestamp = Date.now()
    let { gasLimit } = genesis.header
    let data = { number, parentHash, timestamp, gasLimit }
    let opts = { common, calcDifficultyFromHeader: genesis.header }

    // valid extraData: at limit
    let testCase = 'pow block should validate with 32 bytes of extraData'
    let extraData = new Uint8Array(32)

    try {
      createBlockHeader({ ...data, extraData }, opts)
      assert.ok(true, testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail(testCase)
    }

    // valid extraData: fewer than limit
    testCase = 'pow block should validate with 12 bytes of extraData'
    extraData = new Uint8Array(12)

    try {
      createBlockHeader({ ...data, extraData }, opts)
      assert.ok(testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail(testCase)
    }

    // extraData beyond limit
    testCase = 'pow block should throw with excess amount of extraData'
    extraData = new Uint8Array(42)

    try {
      createBlockHeader({ ...data, extraData }, opts)
      assert.fail(testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok((error.message as string).includes('invalid amount of extra data'), testCase)
    }

    // PoA
    common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
    genesis = createBlock({ header: { extraData: new Uint8Array(97) } }, { common })

    parentHash = genesis.hash()
    gasLimit = genesis.header.gasLimit
    data = { number, parentHash, timestamp, gasLimit, difficulty: BigInt(1) } as any
    opts = { common } as any

    // valid extraData (32 byte vanity + 65 byte seal)
    testCase =
      'clique block should validate with valid number of bytes in extraData: 32 byte vanity + 65 byte seal'
    extraData = concatBytes(new Uint8Array(32), new Uint8Array(65))
    try {
      createBlockHeader({ ...data, extraData }, opts)
      assert.ok(true, testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail(testCase)
    }

    // invalid extraData length
    testCase = 'clique block should throw on invalid extraData length'
    extraData = new Uint8Array(32)
    try {
      createBlockHeader({ ...data, extraData }, opts)
      assert.fail(testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(
        (error.message as string).includes(
          'extraData must be 97 bytes on non-epoch transition blocks, received 32 bytes',
        ),
        testCase,
      )
    }

    // signer list indivisible by 20
    testCase = 'clique blocks should throw on invalid extraData length: indivisible by 20'
    extraData = concatBytes(
      new Uint8Array(32),
      new Uint8Array(65),
      new Uint8Array(20),
      new Uint8Array(21),
    )
    const epoch = BigInt((common.consensusConfig() as CliqueConfig).epoch)
    try {
      createBlockHeader({ ...data, number: epoch, extraData }, opts)
      assert.fail(testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(
        (error.message as string).includes(
          'invalid signer list length in extraData, received signer length of 41 (not divisible by 20)',
        ),
        testCase,
      )
    }
  })

  it('should skip consensusFormatValidation if flag is set to false', () => {
    const common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
    const extraData = concatBytes(new Uint8Array(1))

    try {
      createBlockHeader({ extraData }, { common, skipConsensusFormatValidation: true })
      assert.ok(
        true,
        'should instantiate header with invalid extraData when skipConsensusFormatValidation === true',
      )
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail('should not throw')
    }
  })

  it('_genericFormatValidation checks', () => {
    const badHash = new Uint8Array(31)

    assert.throws(
      () => createBlockHeader({ parentHash: badHash }),
      'parentHash must be 32 bytes',
      undefined,
      'throws on invalid parent hash length',
    )
    assert.throws(
      () => createBlockHeader({ stateRoot: badHash }),
      'stateRoot must be 32 bytes',
      undefined,
      'throws on invalid state root hash length',
    )
    assert.throws(
      () => createBlockHeader({ transactionsTrie: badHash }),
      'transactionsTrie must be 32 bytes',
      undefined,
      'throws on invalid transactionsTrie root hash length',
    )

    assert.throws(
      () => createBlockHeader({ nonce: new Uint8Array(5) }),
      'nonce must be 8 bytes',
      undefined,
      'contains nonce length error message',
    )
  })
  /*
  TODO: Decide if we need to move these tests to blockchain
  it('header validation -> poa checks', async () => {
    const headerData = testDataPreLondon.blocks[0].blockHeader

    const common = new Common({ chain: Goerli, hardfork: Hardfork.Istanbul })
    const blockchain = new Mockchain()

    const genesisRlp = toBytes(testDataPreLondon.genesisRLP)
    const block = createBlockFromRLP(genesisRlp, { common })
    await blockchain.putBlock(block)

    headerData.number = 1
    headerData.timestamp = BigInt(1422494850)
    headerData.extraData = new Uint8Array(97)
    headerData.mixHash = new Uint8Array(32)
    headerData.difficulty = BigInt(2)

    let testCase = 'should throw on lower than period timestamp diffs'
    let header = createBlockHeader(headerData, { common })
    try {
      await header.validate(blockchain)
      assert.fail(testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      assert.ok((error.message as string).includes('invalid timestamp diff (lower than period)'), testCase)
    }

    testCase = 'should not throw on timestamp diff equal to period'
    headerData.timestamp = BigInt(1422494864)
    header = createBlockHeader(headerData, { common })
    try {
      await header.validate(blockchain)
      assert.ok(true, testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      assert.fail(testCase)
    }

    testCase = 'should throw on non-zero beneficiary (coinbase) for epoch transition block'
    headerData.number = common.consensusConfig().epoch
    headerData.coinbase = createAddressFromString('0x091dcd914fCEB1d47423e532955d1E62d1b2dAEf')
    header = createBlockHeader(headerData, { common })
    try {
      await header.validate(blockchain)
      assert.fail('should throw')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      if ((error.message as string).includes('coinbase must be filled with zeros on epoch transition blocks')) {
        assert.ok(true, 'error thrown')
      } else {
        assert.fail('should throw with appropriate error')
      }
    }
    headerData.number = 1
    headerData.coinbase = createZeroAddress()

    testCase = 'should throw on non-zero mixHash'
    headerData.mixHash = new Uint8Array(32).fill(1)
    header = createBlockHeader(headerData, { common })
    try {
      await header.validate(blockchain)
      assert.fail('should throw')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      if ((error.message as string).includes('mixHash must be filled with zeros')) {
        assert.ok(true, 'error thrown')
      } else {
        assert.fail('should throw with appropriate error')
      }
    }
    headerData.mixHash = new Uint8Array(32)

    testCase = 'should throw on invalid clique difficulty'
    headerData.difficulty = BigInt(3)
    header = createBlockHeader(headerData, { common })
    try {
      header.validateCliqueDifficulty(blockchain)
      assert.fail(testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      if ((error.message as string).includes('difficulty for clique block must be INTURN (2) or NOTURN (1)')) {
        assert.ok(true, 'error thrown on invalid clique difficulty')
      } else {
        assert.fail('should throw with appropriate error')
      }
    }

    testCase = 'validateCliqueDifficulty() should return true with NOTURN difficulty and one signer'
    headerData.difficulty = BigInt(2)
    const poaBlockchain = new PoaMockchain()
    const cliqueSigner = hexToBytes(
      '64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'
    )
    const poaBlock = createBlockFromRLP(genesisRlp, { common, cliqueSigner })
    await poaBlockchain.putBlock(poaBlock)

    header = createBlockHeader(headerData, { common, cliqueSigner })
    try {
      const res = header.validateCliqueDifficulty(poaBlockchain)
      assert.equal(res, true, testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      assert.fail(testCase)
    }

    testCase =
      'validateCliqueDifficulty() should return false with INTURN difficulty and one signer'
    headerData.difficulty = BigInt(1)
    header = createBlockHeader(headerData, { common, cliqueSigner })
    try {
      const res = header.validateCliqueDifficulty(poaBlockchain)
      assert.equal(res, false, testCase)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error);
      }
      assert.fail(testCase)
    }
      })
*/
  it('should test validateGasLimit()', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const testData = bcBlockGasLimitTestData.tests.BlockGasLimit2p63m1

    for (const key of Object.keys(testData)) {
      const genesisRlp = hexToBytes(
        testData[key as keyof typeof testData].genesisRLP as PrefixedHexString,
      )
      const parentBlock = createBlockFromRLP(genesisRlp, { common })
      const blockRlp = hexToBytes(
        testData[key as keyof typeof testData].blocks[0].rlp as PrefixedHexString,
      )
      const block = createBlockFromRLP(blockRlp, { common })
      assert.doesNotThrow(() => block.validateGasLimit(parentBlock))
    }
  })

  it('should test isGenesis()', () => {
    const header1 = createBlockHeader({ number: 1 })
    assert.equal(header1.isGenesis(), false)

    const header2 = createBlockHeader()
    assert.equal(header2.isGenesis(), true)
  })

  it('should test hash() function', () => {
    let common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    let header = createBlockHeader(blocksMainnetData[0]['header'], { common })
    assert.equal(
      bytesToHex(header.hash()),
      '0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6',
      'correct PoW hash (mainnet block 1)',
    )

    common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
    header = createBlockHeader(blocksGoerliData[0]['header'], { common })
    assert.equal(
      bytesToHex(header.hash()),
      '0x8f5bab218b6bb34476f51ca588e9f4553a3a7ce5e13a66c660a5283e97e9a85a',
      'correct PoA clique hash (goerli block 1)',
    )
  })

  it('should be able to initialize shanghai header with correct hardfork defaults', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai })
    const header = createBlockHeader({}, { common })
    assert.equal(header.common.hardfork(), Hardfork.Shanghai, 'hardfork should be set to shanghai')
    assert.equal(header.baseFeePerGas, BigInt(7), 'baseFeePerGas should be set to minimum default')
    assert.deepEqual(
      header.withdrawalsRoot,
      KECCAK256_RLP,
      'withdrawalsRoot should be set to KECCAK256_RLP',
    )
  })
})
