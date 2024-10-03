import {
  cliqueSigner,
  cliqueVerifySignature,
  createBlock,
  createSealedCliqueBlock,
} from '@ethereumjs/block'
import { EthashConsensus, createBlockchain } from '@ethereumjs/blockchain'
import {
  Common,
  ConsensusAlgorithm,
  Hardfork,
  Mainnet,
  createCommonFromGethGenesis,
} from '@ethereumjs/common'
import { Ethash } from '@ethereumjs/ethash'
import { createFeeMarket1559Tx, createLegacyTx } from '@ethereumjs/tx'
import {
  Address,
  concatBytes,
  createAccount,
  createAddressFromPrivateKey,
  createZeroAddress,
  hexToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { buildBlock, createVM, runBlock } from '../../src/index.js'

import { setBalance } from './utils.js'

import type { Blockchain, ConsensusDict } from '@ethereumjs/blockchain'

const privateKey = hexToBytes('0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109')
const pKeyAddress = createAddressFromPrivateKey(privateKey)

describe('BlockBuilder', () => {
  it('should build a valid block', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = createBlock({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await createBlockchain({ genesisBlock, common, validateConsensus: false })
    const vm = await createVM({ common, blockchain })

    await setBalance(vm, pKeyAddress)

    const vmCopy = await vm.shallowCopy()

    const blockBuilder = await buildBlock(vm, {
      parentBlock: genesisBlock,
      headerData: { coinbase: '0x96dc73c8b5969608c77375f085949744b5177660' },
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    // Set up tx
    const tx = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false },
    ).sign(privateKey)

    await blockBuilder.addTransaction(tx)
    const block = await blockBuilder.build()
    assert.equal(
      blockBuilder.transactionReceipts.length,
      1,
      'should have the correct number of tx receipts',
    )
    const result = await runBlock(vmCopy, { block })
    assert.equal(result.gasUsed, block.header.gasUsed)
    assert.deepEqual(result.receiptsRoot, block.header.receiptTrie)
    assert.deepEqual(result.stateRoot, block.header.stateRoot)
    assert.deepEqual(result.logsBloom, block.header.logsBloom)
  })

  it('should throw if adding a transaction exceeds the block gas limit', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const vm = await createVM({ common })
    const genesis = createBlock({}, { common })

    const blockBuilder = await buildBlock(vm, { parentBlock: genesis })
    const gasLimit = genesis.header.gasLimit + BigInt(1)
    const tx = createLegacyTx({ gasLimit }, { common })
    try {
      await blockBuilder.addTransaction(tx)
      assert.fail('should throw error')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if (
        (error.message as string).includes(
          'tx has a higher gas limit than the remaining gas in the block',
        )
      ) {
        assert.ok(true, 'correct error thrown')
      } else {
        assert.fail('wrong error thrown')
      }
    }
    assert.equal(
      blockBuilder.transactionReceipts.length,
      0,
      'should have the correct number of tx receipts',
    )
  })

  it('should correctly seal a PoW block', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = createBlock({ header: { gasLimit: 50000 } }, { common })

    const consensusDict: ConsensusDict = {}
    consensusDict[ConsensusAlgorithm.Ethash] = new EthashConsensus(new Ethash())
    const blockchain = await createBlockchain({
      genesisBlock,
      common,
      validateConsensus: false,
      consensusDict,
    })
    const vm = await createVM({ common, blockchain })

    await setBalance(vm, pKeyAddress)

    const blockBuilder = await buildBlock(vm, {
      parentBlock: genesisBlock,
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    // Set up tx
    const tx = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false },
    ).sign(privateKey)

    await blockBuilder.addTransaction(tx)

    const sealOpts = {
      mixHash: new Uint8Array(32),
      nonce: new Uint8Array(8),
    }
    const block = await blockBuilder.build(sealOpts)

    assert.deepEqual(block.header.mixHash, sealOpts.mixHash)
    assert.deepEqual(block.header.nonce, sealOpts.nonce)
    assert.doesNotThrow(async () =>
      (vm.blockchain as Blockchain).consensus!.validateDifficulty(block.header),
    )
  })

  it('should correctly seal a PoA block', async () => {
    const signer = {
      address: new Address(hexToBytes('0x0b90087d864e82a284dca15923f3776de6bb016f')),
      privateKey: hexToBytes('0x64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
      publicKey: hexToBytes(
        '0x40b2ebdf4b53206d2d3d3d59e7e2f13b1ea68305aec71d5d24cefe7f24ecae886d241f9267f04702d7f693655eb7b4aa23f30dcd0c3c5f2b970aad7c8a828195',
      ),
    }

    // const common = new Common({ chain: Chain.Rinkeby, hardfork: Hardfork.Istanbul })
    const consensusConfig = {
      clique: {
        period: 10,
        epoch: 30000,
      },
    }
    const defaultChainData = {
      config: {
        chainId: 123456,
        homesteadBlock: 0,
        eip150Block: 0,
        eip150Hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        eip155Block: 0,
        eip158Block: 0,
        byzantiumBlock: 0,
        constantinopleBlock: 0,
        petersburgBlock: 0,
        istanbulBlock: 0,
        berlinBlock: 0,
        londonBlock: 0,
        ...consensusConfig,
      },
      nonce: '0x0',
      timestamp: '0x614b3731',
      gasLimit: '0x47b760',
      difficulty: '0x1',
      mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      coinbase: '0x0000000000000000000000000000000000000000',
      number: '0x0',
      gasUsed: '0x0',
      parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      baseFeePerGas: 7,
    }

    const A = {
      address: new Address(hexToBytes('0x0b90087d864e82a284dca15923f3776de6bb016f')),
      privateKey: hexToBytes('0x64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
    }
    const addr = A.address.toString().slice(2)

    const extraData2 = '0x' + '0'.repeat(64) + addr + '0'.repeat(130)
    const chainData = {
      ...defaultChainData,
      extraData: extraData2,
      alloc: { [addr]: { balance: '0x10000000000000000000' } },
    }
    const common = createCommonFromGethGenesis(chainData, {
      chain: 'devnet',
      hardfork: Hardfork.Istanbul,
    })

    // extraData: [vanity, activeSigner, seal]
    const extraData = concatBytes(new Uint8Array(32), signer.address.toBytes(), new Uint8Array(65))
    const cliqueSignerKey = signer.privateKey
    const genesisBlock = createSealedCliqueBlock(
      { header: { gasLimit: 50000, extraData } },
      cliqueSignerKey,
      { common },
    )
    const blockchain = await createBlockchain({ genesisBlock, common })
    const vm = await createVM({ common, blockchain })

    // add balance for tx
    await vm.stateManager.putAccount(signer.address, createAccount({ balance: 100000 }))

    const blockBuilder = await buildBlock(vm, {
      parentBlock: genesisBlock,
      headerData: { difficulty: 2, extraData: new Uint8Array(97) },
      blockOpts: { cliqueSigner: cliqueSignerKey, freeze: false },
    })

    // Set up tx
    const tx = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false },
    ).sign(signer.privateKey)

    await blockBuilder.addTransaction(tx)

    const block = await blockBuilder.build()

    assert.ok(cliqueVerifySignature(block.header, [signer.address]), 'should verify signature')
    assert.deepEqual(
      cliqueSigner(block.header),
      signer.address,
      'should recover the correct signer address',
    )
  })

  it('should throw if block already built or reverted', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = createBlock({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await createBlockchain({ genesisBlock, common, validateConsensus: false })
    const vm = await createVM({ common, blockchain })

    await setBalance(vm, pKeyAddress)

    let blockBuilder = await buildBlock(vm, {
      parentBlock: genesisBlock,
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header },
    })

    const tx = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false },
    ).sign(privateKey)

    await blockBuilder.addTransaction(tx)
    await blockBuilder.build()

    try {
      await blockBuilder.revert()
      assert.equal(
        blockBuilder.getStatus().status,
        'reverted',
        'block should be in reverted status',
      )
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail('should not throw')
    }

    blockBuilder = await buildBlock(vm, { parentBlock: genesisBlock })

    const tx2 = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 1, nonce: 1 },
      { common, freeze: false },
    ).sign(privateKey)

    await blockBuilder.addTransaction(tx2)
    await blockBuilder.revert()

    try {
      await blockBuilder.revert()
      assert.equal(
        blockBuilder.getStatus().status,
        'reverted',
        'block should be in reverted status',
      )
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail('should not throw')
    }
  })

  it('should build a block without any txs', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = createBlock({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await createBlockchain({ genesisBlock, common, validateConsensus: false })
    const vm = await createVM({ common, blockchain })
    const vmCopy = await vm.shallowCopy()

    const blockBuilder = await buildBlock(vm, {
      parentBlock: genesisBlock,
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    const block = await blockBuilder.build()

    // block should successfully execute with VM.runBlock and have same outputs
    const result = await runBlock(vmCopy, { block })
    assert.equal(result.gasUsed, block.header.gasUsed)
    assert.deepEqual(result.receiptsRoot, block.header.receiptTrie)
    assert.deepEqual(result.stateRoot, block.header.stateRoot)
    assert.deepEqual(result.logsBloom, block.header.logsBloom)
  })

  it('should build a 1559 block with legacy and 1559 txs', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London, eips: [1559] })
    const genesisBlock = createBlock(
      { header: { gasLimit: 50000, baseFeePerGas: 100 } },
      { common },
    )
    const blockchain = await createBlockchain({ genesisBlock, common, validateConsensus: false })
    const vm = await createVM({ common, blockchain })

    await setBalance(vm, pKeyAddress)

    const vmCopy = await vm.shallowCopy()

    const blockBuilder = await buildBlock(vm, {
      parentBlock: genesisBlock,
      headerData: { coinbase: '0x96dc73c8b5969608c77375f085949744b5177660' },
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    // Set up underpriced txs to test error response
    const tx1 = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false },
    ).sign(privateKey)

    const tx2 = createFeeMarket1559Tx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, maxFeePerGas: 10 },
      { common, freeze: false },
    ).sign(privateKey)

    for (const tx of [tx1, tx2]) {
      try {
        await blockBuilder.addTransaction(tx)
        assert.fail('should throw error')
      } catch (error) {
        if (!(error instanceof Error)) {
          error = new Error(error)
        }
        assert.ok(
          (error.message as string).includes("is less than the block's baseFeePerGas"),
          'should fail with appropriate error',
        )
      }
    }

    // Set up correctly priced txs
    const tx3 = createLegacyTx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, gasPrice: 101 },
      { common, freeze: false },
    ).sign(privateKey)

    const tx4 = createFeeMarket1559Tx(
      { to: createZeroAddress(), value: 1000, gasLimit: 21000, maxFeePerGas: 101, nonce: 1 },
      { common, freeze: false },
    ).sign(privateKey)

    for (const tx of [tx3, tx4]) {
      await blockBuilder.addTransaction(tx)
      assert.ok('should pass')
    }

    const block = await blockBuilder.build()
    assert.equal(
      blockBuilder.transactionReceipts.length,
      2,
      'should have the correct number of tx receipts',
    )

    assert.ok(
      block.header.baseFeePerGas! === genesisBlock.header.calcNextBaseFee(),
      "baseFeePerGas should equal parentHeader's calcNextBaseFee",
    )

    const result = await runBlock(vmCopy, { block })
    assert.equal(result.gasUsed, block.header.gasUsed)
    assert.deepEqual(result.receiptsRoot, block.header.receiptTrie)
    assert.deepEqual(result.stateRoot, block.header.stateRoot)
    assert.deepEqual(result.logsBloom, block.header.logsBloom)
  })
})
