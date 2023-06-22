import { Block } from '@ethereumjs/block'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  AccessListEIP2930Transaction,
  Capability,
  FeeMarketEIP1559Transaction,
  LegacyTransaction,
} from '@ethereumjs/tx'
import { Account, Address, KECCAK256_RLP, toBytes } from '@ethereumjs/util'
import { hexToBytes, utf8ToBytes } from 'ethereum-cryptography/utils'
import { assert, describe, it } from 'vitest'

import { VM } from '../../../src/vm'
import { getDAOCommon, setupPreConditions } from '../../util'
import testData from '../testdata/blockchain.json'
import * as testnet from '../testdata/testnet.json'
import { createAccount, setBalance, setupVM } from '../utils'

import type {
  AfterBlockEvent,
  PostByzantiumTxReceipt,
  PreByzantiumTxReceipt,
  RunBlockOpts,
} from '../../../src/types'
import type { TypedTransaction } from '@ethereumjs/tx'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin })
describe('runBlock tests', () => {
  it('runBlock() -> successful API parameter usage', async () => {
    async function simpleRun(vm: VM) {
      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
      const genesisRlp = toBytes(testData.genesisRLP)
      const genesis = Block.fromRLPSerializedBlock(genesisRlp, { common })

      const blockRlp = toBytes(testData.blocks[0].rlp)
      const block = Block.fromRLPSerializedBlock(blockRlp, { common })

      //@ts-ignore
      await setupPreConditions(vm.stateManager, testData)

      assert.deepEqual(
        //@ts-ignore
        vm.stateManager._trie.root(),
        genesis.header.stateRoot,
        'genesis state root should match calculated state root'
      )

      const res = await vm.runBlock({
        block,
        // @ts-ignore
        root: vm.stateManager._trie.root(),
        skipBlockValidation: true,
        skipHardForkValidation: true,
      })

      assert.equal(
        res.results[0].totalGasSpent.toString(16),
        '5208',
        'actual gas used should equal blockHeader gasUsed'
      )
    }

    async function uncleRun(vm: VM) {
      const testData = require('./testdata/uncleData.json')

      //@ts-ignore
      await setupPreConditions(vm.stateManager, testData)

      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
      const block1Rlp = toBytes(testData.blocks[0].rlp)
      const block1 = Block.fromRLPSerializedBlock(block1Rlp, { common })
      await vm.runBlock({
        block: block1,
        // @ts-ignore
        root: vm.stateManager._trie.root(),
        skipBlockValidation: true,
        skipHardForkValidation: true,
      })

      const block2Rlp = toBytes(testData.blocks[1].rlp)
      const block2 = Block.fromRLPSerializedBlock(block2Rlp, { common })
      await vm.runBlock({
        block: block2,
        // @ts-ignore
        root: vm.stateManager._trie.root(),
        skipBlockValidation: true,
        skipHardForkValidation: true,
      })

      const block3Rlp = toBytes(testData.blocks[2].rlp)
      const block3 = Block.fromRLPSerializedBlock(block3Rlp, { common })
      await vm.runBlock({
        block: block3,
        // @ts-ignore
        root: vm.stateManager._trie.root(),
        skipBlockValidation: true,
        skipHardForkValidation: true,
      })

      const uncleReward = (await vm.stateManager.getAccount(
        Address.fromString('0xb94f5374fce5ed0000000097c15331677e6ebf0b')
      ))!.balance.toString(16)

      assert.equal(
        `0x${uncleReward}`,
        testData.postState['0xb94f5374fce5ed0000000097c15331677e6ebf0b'].balance,
        'calculated balance should equal postState balance'
      )
    }

    it('PoW block, unmodified options', async () => {
      const vm = await setupVM({ common })
      await simpleRun(vm)
    })

    it('Uncle blocks, compute uncle rewards', async () => {
      const vm = await setupVM({ common })
      it('should run uncle run', async () => {
        await uncleRun(vm)
      })
    })

    it('PoW block, Common custom chain (Common.custom() static constructor)', async () => {
      const customChainParams = { name: 'custom', chainId: 123, networkId: 678 }
      const common = Common.custom(customChainParams, { baseChain: 'mainnet', hardfork: 'berlin' })
      const vm = await setupVM({ common })
      await simpleRun(vm)
    })

    it('PoW block, Common custom chain (Common customChains constructor option)', async () => {
      const customChains = [testnet]
      const common = new Common({ chain: 'testnet', hardfork: Hardfork.Berlin, customChains })
      const vm = await setupVM({ common })
      await simpleRun(vm)
    })

    it('setHardfork option', async () => {
      const common1 = new Common({
        chain: Chain.Mainnet,
        hardfork: Hardfork.MuirGlacier,
      })

      // Have to use an unique common, otherwise the HF will be set to muirGlacier and then will not change back to chainstart.
      const common2 = new Common({
        chain: Chain.Mainnet,
        hardfork: Hardfork.Chainstart,
      })

      const privateKey = hexToBytes(
        'e331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109'
      )

      function getBlock(common: Common): Block {
        return Block.fromBlockData(
          {
            header: {
              number: BigInt(10000000),
            },
            transactions: [
              LegacyTransaction.fromTxData(
                {
                  data: '0x600154', // PUSH 01 SLOAD
                  gasLimit: BigInt(100000),
                },
                { common }
              ).sign(privateKey),
            ],
          },
          { common }
        )
      }

      const vm = await VM.create({ common: common1, setHardfork: true })
      const vm_noSelect = await VM.create({ common: common2 })

      const txResultMuirGlacier = await vm.runBlock({
        block: getBlock(common1),
        skipBlockValidation: true,
        generate: true,
      })
      const txResultChainstart = await vm_noSelect.runBlock({
        block: getBlock(common2),
        skipBlockValidation: true,
        generate: true,
      })
      assert.equal(
        txResultChainstart.results[0].totalGasSpent,
        BigInt(21000) + BigInt(68) * BigInt(3) + BigInt(3) + BigInt(50),
        'tx charged right gas on chainstart hard fork'
      )
      assert.equal(
        txResultMuirGlacier.results[0].totalGasSpent,
        BigInt(21000) + BigInt(32000) + BigInt(16) * BigInt(3) + BigInt(3) + BigInt(800),
        'tx charged right gas on muir glacier hard fork'
      )
    })
  })

  it('runBlock() -> API parameter usage/data errors', async () => {
    const vm = await VM.create({ common })

    it('should fail when runTx fails', async () => {
      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
      const blockRlp = toBytes(testData.blocks[0].rlp)
      const block = Block.fromRLPSerializedBlock(blockRlp, { common })

      // The mocked VM uses a mocked runTx
      // which always returns an error.
      await vm
        .runBlock({ block, skipBlockValidation: true, skipHardForkValidation: true })
        .then(() => assert.fail('should have returned error'))
        .catch((e) => assert.ok(e.message.includes("sender doesn't have enough funds to send tx")))
    })

    it('should fail when block gas limit higher than 2^63-1', async () => {
      const vm = await VM.create({ common })

      const block = Block.fromBlockData({
        header: {
          ...testData.blocks[0].blockHeader,
          gasLimit: hexToBytes('8000000000000000'),
        },
      })
      await vm
        .runBlock({ block })
        .then(() => assert.fail('should have returned error'))
        .catch((e) => assert.ok(e.message.includes('Invalid block')))
    })

    it('should fail when block validation fails', async () => {
      const vm = await VM.create({ common })

      const blockRlp = toBytes(testData.blocks[0].rlp)
      const block = Object.create(Block.fromRLPSerializedBlock(blockRlp, { common }))

      await vm
        .runBlock({ block })
        .then(() => assert.fail('should have returned error'))
        .catch((e) => {
          assert.ok(
            e.message.includes('not found in DB'),
            'block failed validation due to no parent header'
          )
        })
    })

    it('should fail when no `validateHeader` method exists on blockchain class', async () => {
      const vm = await VM.create({ common })
      const blockRlp = toBytes(testData.blocks[0].rlp)
      const block = Object.create(Block.fromRLPSerializedBlock(blockRlp, { common }))
      ;(vm.blockchain as any).validateHeader = undefined
      try {
        await vm.runBlock({ block })
      } catch (err: any) {
        assert.equal(
          err.message,
          'cannot validate header: blockchain has no `validateHeader` method',
          'should error'
        )
      }
    })

    it('should fail when tx gas limit higher than block gas limit', async () => {
      const vm = await VM.create({ common })

      const blockRlp = toBytes(testData.blocks[0].rlp)
      const block = Object.create(Block.fromRLPSerializedBlock(blockRlp, { common }))
      // modify first tx's gasLimit
      const { nonce, gasPrice, to, value, data, v, r, s } = block.transactions[0]

      const gasLimit = BigInt('0x3fefba')
      const opts = { common: block._common }
      block.transactions[0] = new LegacyTransaction(
        { nonce, gasPrice, gasLimit, to, value, data, v, r, s },
        opts
      )

      await vm
        .runBlock({ block, skipBlockValidation: true })
        .then(() => assert.fail('should have returned error'))
        .catch((e) => assert.ok(e.message.includes('higher gas limit')))
    })
  })

  it('runBlock() -> runtime behavior', async () => {
    // this test actually checks if the DAO fork works. This is not checked in ethereum/tests
    it('DAO fork behavior', async () => {
      const common = getDAOCommon(1)

      const vm = await setupVM({ common })

      const block1: any = RLP.decode(testData.blocks[0].rlp)
      // edit extra data of this block to "dao-hard-fork"
      block1[0][12] = utf8ToBytes('dao-hard-fork')
      const block = Block.fromValuesArray(block1, { common })
      // @ts-ignore
      await setupPreConditions(vm.stateManager, testData)

      // fill two original DAO child-contracts with funds and the recovery account with funds in order to verify that the balance gets summed correctly
      const fundBalance1 = BigInt('0x1111')
      const accountFunded1 = createAccount(BigInt(0), fundBalance1)
      const DAOFundedContractAddress1 = new Address(
        hexToBytes('d4fe7bc31cedb7bfb8a345f31e668033056b2728')
      )
      await vm.stateManager.putAccount(DAOFundedContractAddress1, accountFunded1)

      const fundBalance2 = BigInt('0x2222')
      const accountFunded2 = createAccount(BigInt(0), fundBalance2)
      const DAOFundedContractAddress2 = new Address(
        hexToBytes('b3fb0e5aba0e20e5c49d252dfd30e102b171a425')
      )
      await vm.stateManager.putAccount(DAOFundedContractAddress2, accountFunded2)

      const DAORefundAddress = new Address(hexToBytes('bf4ed7b27f1d666546e30d74d50d173d20bca754'))
      const fundBalanceRefund = BigInt('0x4444')
      const accountRefund = createAccount(BigInt(0), fundBalanceRefund)
      await vm.stateManager.putAccount(DAORefundAddress, accountRefund)

      await vm.runBlock({
        block,
        skipBlockValidation: true,
        generate: true,
      })

      const DAOFundedContractAccount1 =
        (await vm.stateManager.getAccount(DAOFundedContractAddress1)) ?? new Account()
      assert.equal(DAOFundedContractAccount1!.balance, BigInt(0)) // verify our funded account now has 0 balance
      const DAOFundedContractAccount2 =
        (await vm.stateManager.getAccount(DAOFundedContractAddress2)) ?? new Account()
      assert.equal(DAOFundedContractAccount2!.balance, BigInt(0)) // verify our funded account now has 0 balance

      const DAORefundAccount = await vm.stateManager.getAccount(DAORefundAddress)
      // verify that the refund account gets the summed balance of the original refund account + two child DAO accounts
      const msg =
        'should transfer balance from DAO children to the Refund DAO account in the DAO fork'
      assert.equal(DAORefundAccount!.balance, BigInt(0x7777), msg)
    })

    it('should allocate to correct clique beneficiary', async () => {
      const common = new Common({ chain: Chain.Goerli, hardfork: Hardfork.Istanbul })
      const vm = await setupVM({ common })

      const signer = {
        address: new Address(hexToBytes('0b90087d864e82a284dca15923f3776de6bb016f')),
        privateKey: hexToBytes('64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
        publicKey: hexToBytes(
          '40b2ebdf4b53206d2d3d3d59e7e2f13b1ea68305aec71d5d24cefe7f24ecae886d241f9267f04702d7f693655eb7b4aa23f30dcd0c3c5f2b970aad7c8a828195'
        ),
      }

      const otherUser = {
        address: new Address(hexToBytes('6f62d8382bf2587361db73ceca28be91b2acb6df')),
        privateKey: hexToBytes('2a6e9ad5a6a8e4f17149b8bc7128bf090566a11dbd63c30e5a0ee9f161309cd6'),
        publicKey: hexToBytes(
          'ca0a55f6e81cb897aee6a1c390aa83435c41048faa0564b226cfc9f3df48b73e846377fb0fd606df073addc7bd851f22547afbbdd5c3b028c91399df802083a2'
        ),
      }

      // add balance to otherUser to send two txs to zero address
      await vm.stateManager.putAccount(otherUser.address, new Account(BigInt(0), BigInt(42000)))
      const tx = LegacyTransaction.fromTxData(
        { to: Address.zero(), gasLimit: 21000, gasPrice: 1 },
        { common }
      ).sign(otherUser.privateKey)

      // create block with the signer and txs
      const block = Block.fromBlockData(
        { header: { extraData: new Uint8Array(97) }, transactions: [tx, tx] },
        { common, cliqueSigner: signer.privateKey }
      )

      await vm.runBlock({ block, skipNonce: true, skipBlockValidation: true, generate: true })
      const account = await vm.stateManager.getAccount(signer.address)
      assert.equal(
        account!.balance,
        BigInt(42000),
        'beneficiary balance should equal the cost of the txs'
      )
    })
  })

  async function runBlockAndGetAfterBlockEvent(
    vm: VM,
    runBlockOpts: RunBlockOpts
  ): Promise<AfterBlockEvent> {
    let results: AfterBlockEvent
    function handler(event: AfterBlockEvent) {
      results = event
    }

    try {
      vm.events.once('afterBlock', handler)
      await vm.runBlock(runBlockOpts)
    } finally {
      // We need this in case `runBlock` throws before emitting the event.
      // Otherwise we'd be leaking the listener until the next call to runBlock.
      vm.events.removeListener('afterBlock', handler)
    }

    return results!
  }

  it('should correctly reflect generated fields', async () => {
    const vm = await VM.create()

    // We create a block with a receiptTrie and transactionsTrie
    // filled with 0s and no txs. Once we run it we should
    // get a receipt trie root of for the empty receipts set,
    // which is a well known constant.
    const bytes32Zeros = new Uint8Array(32)
    const block = Block.fromBlockData({
      header: { receiptTrie: bytes32Zeros, transactionsTrie: bytes32Zeros, gasUsed: BigInt(1) },
    })

    const results = await runBlockAndGetAfterBlockEvent(vm, {
      block,
      generate: true,
      skipBlockValidation: true,
    })

    assert.deepEqual(results.block.header.receiptTrie, KECCAK256_RLP)
    assert.deepEqual(results.block.header.transactionsTrie, KECCAK256_RLP)
    assert.equal(results.block.header.gasUsed, BigInt(0))
  })

  async function runWithHf(hardfork: string) {
    const common = new Common({ chain: Chain.Mainnet, hardfork })
    const vm = await setupVM({ common })

    const blockRlp = toBytes(testData.blocks[0].rlp)
    const block = Block.fromRLPSerializedBlock(blockRlp, { common })

    // @ts-ignore
    await setupPreConditions(vm.stateManager, testData)

    const res = await vm.runBlock({
      block,
      generate: true,
      skipBlockValidation: true,
    })
    return res
  }

  // TODO: complete on result values and add more usage scenario test cases
  it('runBlock() -> API return values', () => {
    it('should return correct HF receipts', async () => {
      let res = await runWithHf('byzantium')
      assert.equal(
        (res.receipts[0] as PostByzantiumTxReceipt).status,
        1,
        'should return correct post-Byzantium receipt format'
      )

      res = await runWithHf('spuriousDragon')
      assert.deepEqual(
        (res.receipts[0] as PreByzantiumTxReceipt).stateRoot,
        hexToBytes('4477e2cfaf9fd2eed4f74426798b55d140f6a9612da33413c4745f57d7a97fcc'),
        'should return correct pre-Byzantium receipt format'
      )
    })
  })

  it('runBlock() -> tx types', async () => {
    async function simpleRun(vm: VM, transactions: TypedTransaction[]) {
      const common = vm._common

      const blockRlp = toBytes(testData.blocks[0].rlp)
      const block = Block.fromRLPSerializedBlock(blockRlp, { common, freeze: false })

      //@ts-ignore overwrite transactions
      block.transactions = transactions

      if (transactions.some((t) => t.supports(Capability.EIP1559FeeMarket))) {
        // @ts-ignore overwrite read-only property
        block.header.baseFeePerGas = BigInt(7)
      }

      //@ts-ignore
      await setupPreConditions(vm.stateManager, testData)

      const res = await vm.runBlock({
        block,
        skipBlockValidation: true,
        generate: true,
      })

      assert.equal(
        res.gasUsed,
        res.receipts
          .map((r) => r.cumulativeBlockGasUsed)
          .reduce((prevValue: bigint, currValue: bigint) => prevValue + currValue, BigInt(0)),
        "gas used should equal transaction's total gasUsed"
      )
    }

    it('legacy tx', async () => {
      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin })
      const vm = await setupVM({ common })

      const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
      await setBalance(vm, address)

      const tx = LegacyTransaction.fromTxData(
        { gasLimit: 53000, value: 1 },
        { common, freeze: false }
      )

      tx.getSenderAddress = () => {
        return address
      }

      await simpleRun(vm, [tx])
    })

    it('access list tx', async () => {
      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin })
      const vm = await setupVM({ common })

      const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
      await setBalance(vm, address)

      const tx = AccessListEIP2930Transaction.fromTxData(
        { gasLimit: 53000, value: 1, v: 1, r: 1, s: 1 },
        { common, freeze: false }
      )

      tx.getSenderAddress = () => {
        return address
      }

      await simpleRun(vm, [tx])
    })

    it('fee market tx', async () => {
      const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
      const vm = await setupVM({ common })

      const address = Address.fromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
      await setBalance(vm, address)

      const tx = FeeMarketEIP1559Transaction.fromTxData(
        { maxFeePerGas: 10, maxPriorityFeePerGas: 4, gasLimit: 100000, value: 6 },
        { common, freeze: false }
      )

      tx.getSenderAddress = () => {
        return address
      }

      await simpleRun(vm, [tx])
    })
  })
})
