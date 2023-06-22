import { Block } from '@ethereumjs/block'
import { Blockchain } from '@ethereumjs/blockchain'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction, LegacyTransaction } from '@ethereumjs/tx'
import { Account, Address, concatBytesNoTypeCheck } from '@ethereumjs/util'
import { hexToBytes } from 'ethereum-cryptography/utils'
import { assert, describe, it } from 'vitest'

import { VM } from '../../../src/vm'
import { setBalance } from '../utils'

describe('BlockBuilder', () => {
  it('should build a valid block', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = Block.fromBlockData({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await Blockchain.create({ genesisBlock, common, validateConsensus: false })
    const vm = await VM.create({ common, blockchain })

    const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    const vmCopy = await vm.copy()

    const blockBuilder = await vm.buildBlock({
      parentBlock: genesisBlock,
      headerData: { coinbase: '0x96dc73c8b5969608c77375f085949744b5177660' },
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    // Set up tx
    const tx = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false }
    )
    tx.getSenderAddress = () => {
      return address
    }

    await blockBuilder.addTransaction(tx)
    const block = await blockBuilder.build()
    assert.equal(
      blockBuilder.transactionReceipts.length,
      1,
      'should have the correct number of tx receipts'
    )

    // block should successfully execute with VM.runBlock and have same outputs
    block.transactions[0].getSenderAddress = () => {
      return address
    }
    const result = await vmCopy.runBlock({ block })
    assert.equal(result.gasUsed, block.header.gasUsed)
    assert.deepEqual(result.receiptsRoot, block.header.receiptTrie)
    assert.deepEqual(result.stateRoot, block.header.stateRoot)
    assert.deepEqual(result.logsBloom, block.header.logsBloom)
  })

  it('should throw if adding a transaction exceeds the block gas limit', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const vm = await VM.create({ common })
    const genesis = Block.fromBlockData({}, { common })

    const blockBuilder = await vm.buildBlock({ parentBlock: genesis })
    const gasLimit = genesis.header.gasLimit + BigInt(1)
    const tx = LegacyTransaction.fromTxData({ gasLimit }, { common })
    try {
      await blockBuilder.addTransaction(tx)
      assert.fail('should throw error')
    } catch (error: any) {
      if (
        (error.message as string).includes(
          'tx has a higher gas limit than the remaining gas in the block'
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
      'should have the correct number of tx receipts'
    )
  })

  it('should correctly seal a PoW block', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = Block.fromBlockData({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await Blockchain.create({ genesisBlock, common, validateConsensus: false })
    const vm = await VM.create({ common, blockchain })

    const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    const blockBuilder = await vm.buildBlock({
      parentBlock: genesisBlock,
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    // Set up tx
    const tx = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false }
    )
    tx.getSenderAddress = () => {
      return address
    }

    await blockBuilder.addTransaction(tx)

    const sealOpts = {
      mixHash: new Uint8Array(32),
      nonce: new Uint8Array(8),
    }
    const block = await blockBuilder.build(sealOpts)

    assert.deepEqual(block.header.mixHash, sealOpts.mixHash)
    assert.deepEqual(block.header.nonce, sealOpts.nonce)
    assert.doesNotThrow(async () => vm.blockchain.consensus.validateDifficulty(block.header))
  })

  it('should correctly seal a PoA block', async () => {
    const signer = {
      address: new Address(hexToBytes('0b90087d864e82a284dca15923f3776de6bb016f')),
      privateKey: hexToBytes('64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
      publicKey: hexToBytes(
        '40b2ebdf4b53206d2d3d3d59e7e2f13b1ea68305aec71d5d24cefe7f24ecae886d241f9267f04702d7f693655eb7b4aa23f30dcd0c3c5f2b970aad7c8a828195'
      ),
    }

    const common = new Common({ chain: Chain.Rinkeby, hardfork: Hardfork.Istanbul })
    // extraData: [vanity, activeSigner, seal]
    const extraData = concatBytesNoTypeCheck(
      new Uint8Array(32),
      signer.address.toBytes(),
      new Uint8Array(65)
    )
    const cliqueSigner = signer.privateKey
    const genesisBlock = Block.fromBlockData(
      { header: { gasLimit: 50000, extraData } },
      { common, cliqueSigner }
    )
    const blockchain = await Blockchain.create({ genesisBlock, common })
    const vm = await VM.create({ common, blockchain })

    // add balance for tx
    await vm.stateManager.putAccount(signer.address, Account.fromAccountData({ balance: 100000 }))

    const blockBuilder = await vm.buildBlock({
      parentBlock: genesisBlock,
      headerData: { difficulty: 2, extraData: new Uint8Array(97) },
      blockOpts: { cliqueSigner, freeze: false },
    })

    // Set up tx
    const tx = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false }
    ).sign(signer.privateKey)

    await blockBuilder.addTransaction(tx)

    const block = await blockBuilder.build()

    assert.ok(block.header.cliqueVerifySignature([signer.address]), 'should verify signature')
    assert.deepEqual(
      block.header.cliqueSigner(),
      signer.address,
      'should recover the correct signer address'
    )
  })

  it('should throw if block already built or reverted', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = Block.fromBlockData({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await Blockchain.create({ genesisBlock, common, validateConsensus: false })
    const vm = await VM.create({ common, blockchain })

    const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    let blockBuilder = await vm.buildBlock({
      parentBlock: genesisBlock,
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header },
    })

    const tx = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false }
    )
    tx.getSenderAddress = () => {
      return address
    }

    await blockBuilder.addTransaction(tx)
    await blockBuilder.build()

    try {
      await blockBuilder.revert()
      assert.equal(
        blockBuilder.getStatus().status,
        'reverted',
        'block should be in reverted status'
      )
    } catch (error: any) {
      assert.fail('shoud not throw')
    }

    blockBuilder = await vm.buildBlock({ parentBlock: genesisBlock })

    const tx2 = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 1, nonce: 1 },
      { common, freeze: false }
    )
    tx2.getSenderAddress = () => {
      return address
    }

    await blockBuilder.addTransaction(tx2)
    await blockBuilder.revert()

    try {
      await blockBuilder.revert()
      assert.equal(
        blockBuilder.getStatus().status,
        'reverted',
        'block should be in reverted status'
      )
    } catch (error: any) {
      assert.fail('shoud not throw')
    }
  })

  it('should build a block without any txs', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const genesisBlock = Block.fromBlockData({ header: { gasLimit: 50000 } }, { common })
    const blockchain = await Blockchain.create({ genesisBlock, common, validateConsensus: false })
    const vm = await VM.create({ common, blockchain })
    const vmCopy = await vm.copy()

    const blockBuilder = await vm.buildBlock({
      parentBlock: genesisBlock,
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    const block = await blockBuilder.build()

    // block should successfully execute with VM.runBlock and have same outputs
    const result = await vmCopy.runBlock({ block })
    assert.equal(result.gasUsed, block.header.gasUsed)
    assert.deepEqual(result.receiptsRoot, block.header.receiptTrie)
    assert.deepEqual(result.stateRoot, block.header.stateRoot)
    assert.deepEqual(result.logsBloom, block.header.logsBloom)
  })

  it('should build a 1559 block with legacy and 1559 txs', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London, eips: [1559] })
    const genesisBlock = Block.fromBlockData(
      { header: { gasLimit: 50000, baseFeePerGas: 100 } },
      { common }
    )
    const blockchain = await Blockchain.create({ genesisBlock, common, validateConsensus: false })
    const vm = await VM.create({ common, blockchain })

    const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    const vmCopy = await vm.copy()

    const blockBuilder = await vm.buildBlock({
      parentBlock: genesisBlock,
      headerData: { coinbase: '0x96dc73c8b5969608c77375f085949744b5177660' },
      blockOpts: { calcDifficultyFromHeader: genesisBlock.header, freeze: false },
    })

    // Set up underpriced txs to test error response
    const tx1 = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 1 },
      { common, freeze: false }
    )
    tx1.getSenderAddress = () => {
      return address
    }
    const tx2 = FeeMarketEIP1559Transaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, maxFeePerGas: 10 },
      { common, freeze: false }
    )
    tx2.getSenderAddress = () => {
      return address
    }

    for (const tx of [tx1, tx2]) {
      it(`should throw with error: is less than the block's baseFeePerGas`, async () => {
        try {
          await blockBuilder.addTransaction(tx)
          assert.fail('should throw error')
        } catch (error: any) {
          assert.ok(
            (error.message as string).includes("is less than the block's baseFeePerGas"),
            'should fail with appropriate error'
          )
        }
      })
    }

    // Set up correctly priced txs
    const tx3 = LegacyTransaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, gasPrice: 101 },
      { common, freeze: false }
    )
    tx3.getSenderAddress = () => {
      return address
    }
    const tx4 = FeeMarketEIP1559Transaction.fromTxData(
      { to: Address.zero(), value: 1000, gasLimit: 21000, maxFeePerGas: 101, nonce: 1 },
      { common, freeze: false }
    )
    tx4.getSenderAddress = () => {
      return address
    }

    for (const tx of [tx3, tx4]) {
      await blockBuilder.addTransaction(tx)
      assert.ok('should pass')
    }

    const block = await blockBuilder.build()
    assert.equal(
      blockBuilder.transactionReceipts.length,
      2,
      'should have the correct number of tx receipts'
    )

    assert.ok(
      block.header.baseFeePerGas! === genesisBlock.header.calcNextBaseFee(),
      "baseFeePerGas should equal parentHeader's calcNextBaseFee"
    )

    // block should successfully execute with VM.runBlock and have same outputs
    block.transactions[0].getSenderAddress = () => {
      return address
    }
    block.transactions[1].getSenderAddress = () => {
      return address
    }
    const result = await vmCopy.runBlock({ block })
    assert.equal(result.gasUsed, block.header.gasUsed)
    assert.deepEqual(result.receiptsRoot, block.header.receiptTrie)
    assert.deepEqual(result.stateRoot, block.header.stateRoot)
    assert.deepEqual(result.logsBloom, block.header.logsBloom)
  })
})
