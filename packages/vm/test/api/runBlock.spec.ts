import {
  createBlock,
  createBlockFromBytesArray,
  createBlockFromRLP,
  createSealedCliqueBlock,
} from '@ethereumjs/block'
import { createBlockchain } from '@ethereumjs/blockchain'
import { Common, Goerli, Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  Capability,
  LegacyTx,
  createAccessList2930Tx,
  createEOACode7702Tx,
  createFeeMarket1559Tx,
  createLegacyTx,
} from '@ethereumjs/tx'
import {
  Account,
  Address,
  BIGINT_1,
  KECCAK256_RLP,
  concatBytes,
  createAddressFromString,
  createZeroAddress,
  ecsign,
  equalsBytes,
  hexToBytes,
  privateToAddress,
  toBytes,
  unpadBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { assert, describe, it } from 'vitest'

import { createVM, runBlock } from '../../src/index.js'
import { getDAOCommon, setupPreConditions } from '../util.js'

import { blockchainData } from './testdata/blockchain.js'
import { testnetData } from './testdata/testnet.js'
import { createAccountWithDefaults, setBalance, setupVM } from './utils.js'

import type { VM } from '../../src/index.js'
import type {
  AfterBlockEvent,
  PostByzantiumTxReceipt,
  PreByzantiumTxReceipt,
  RunBlockOpts,
} from '../../src/types.js'
import type { Block, BlockBytes } from '@ethereumjs/block'
import type { MerkleStateManager } from '@ethereumjs/statemanager'
import type { AuthorizationListBytesItem, TypedTransaction } from '@ethereumjs/tx'
import type { NestedUint8Array, PrefixedHexString } from '@ethereumjs/util'

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
describe('runBlock() -> successful API parameter usage', async () => {
  async function simpleRun(vm: VM) {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const genesisRlp = hexToBytes(blockchainData.genesisRLP as PrefixedHexString)
    const genesis = createBlockFromRLP(genesisRlp, { common })

    const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
    const block = createBlockFromRLP(blockRlp, { common })

    await setupPreConditions(vm.stateManager, blockchainData)

    assert.deepEqual(
      (vm.stateManager as MerkleStateManager)['_trie'].root(),
      genesis.header.stateRoot,
      'genesis state root should match calculated state root',
    )

    const res = await runBlock(vm, {
      block,
      root: (vm.stateManager as MerkleStateManager)['_trie'].root(),
      skipBlockValidation: true,
      skipHardForkValidation: true,
    })

    assert.equal(
      res.results[0].totalGasSpent.toString(16),
      '5208',
      'actual gas used should equal blockHeader gasUsed',
    )
  }

  async function uncleRun(vm: VM) {
    const { uncleData } = await import('./testdata/uncleData.js')

    await setupPreConditions(vm.stateManager, uncleData)

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const block1Rlp = hexToBytes(uncleData.blocks[0].rlp as PrefixedHexString)
    const block1 = createBlockFromRLP(block1Rlp, { common })
    await runBlock(vm, {
      block: block1,
      root: (vm.stateManager as MerkleStateManager)['_trie'].root(),
      skipBlockValidation: true,
      skipHardForkValidation: true,
    })

    const block2Rlp = hexToBytes(uncleData.blocks[1].rlp as PrefixedHexString)
    const block2 = createBlockFromRLP(block2Rlp, { common })
    await runBlock(vm, {
      block: block2,

      root: (vm.stateManager as MerkleStateManager)['_trie'].root(),
      skipBlockValidation: true,
      skipHardForkValidation: true,
    })

    const block3Rlp = toBytes(uncleData.blocks[2].rlp as PrefixedHexString)
    const block3 = createBlockFromRLP(block3Rlp, { common })
    await runBlock(vm, {
      block: block3,

      root: (vm.stateManager as MerkleStateManager)['_trie'].root(),
      skipBlockValidation: true,
      skipHardForkValidation: true,
    })

    const uncleReward = (await vm.stateManager.getAccount(
      createAddressFromString('0xb94f5374fce5ed0000000097c15331677e6ebf0b'),
    ))!.balance.toString(16)

    assert.equal(
      `0x${uncleReward}`,
      uncleData.postState['0xb94f5374fce5ed0000000097c15331677e6ebf0b'].balance,
      'calculated balance should equal postState balance',
    )
  }

  it('PoW block, unmodified options', async () => {
    const vm = await setupVM({ common })
    await simpleRun(vm)
  })

  it('Uncle blocks, compute uncle rewards', async () => {
    const vm = await setupVM({ common })
    await uncleRun(vm)
  })

  it('PoW block, Common custom chain (createCustomCommon() static constructor)', async () => {
    const customChainParams = { name: 'custom', chainId: 123 }
    const common = createCustomCommon(customChainParams, Mainnet, {
      hardfork: 'berlin',
    })
    const vm = await setupVM({ common })
    await simpleRun(vm)
  })

  it('PoW block, Common custom chain (Common customChains constructor option)', async () => {
    const common = createCustomCommon(testnetData, Mainnet, {
      hardfork: Hardfork.Berlin,
    })
    const vm = await setupVM({ common })
    await simpleRun(vm)
  })

  it('setHardfork option', async () => {
    const common1 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.MuirGlacier,
    })

    // Have to use an unique common, otherwise the HF will be set to muirGlacier and then will not change back to chainstart.
    const common2 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.Chainstart,
    })

    const privateKey = hexToBytes(
      '0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109',
    )

    function getBlock(common: Common): Block {
      return createBlock(
        {
          header: {
            number: BigInt(10000000),
          },
          transactions: [
            createLegacyTx(
              {
                data: '0x600154', // PUSH 01 SLOAD
                gasLimit: BigInt(100000),
              },
              { common },
            ).sign(privateKey),
          ],
        },
        { common },
      )
    }

    const vm = await createVM({ common: common1, setHardfork: true })
    const vm_noSelect = await createVM({ common: common2 })

    const txResultMuirGlacier = await runBlock(vm, {
      block: getBlock(common1),
      skipBlockValidation: true,
      generate: true,
    })
    const txResultChainstart = await runBlock(vm_noSelect, {
      block: getBlock(common2),
      skipBlockValidation: true,
      generate: true,
    })
    assert.equal(
      txResultChainstart.results[0].totalGasSpent,
      BigInt(21000) + BigInt(68) * BigInt(3) + BigInt(3) + BigInt(50),
      'tx charged right gas on chainstart hard fork',
    )
    assert.equal(
      txResultMuirGlacier.results[0].totalGasSpent,
      BigInt(21000) + BigInt(32000) + BigInt(16) * BigInt(3) + BigInt(3) + BigInt(800),
      'tx charged right gas on muir glacier hard fork',
    )
  })
})

describe('runBlock() -> API parameter usage/data errors', async () => {
  const vm = await createVM({ common })

  it('should fail when runTx fails', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
    const block = createBlockFromRLP(blockRlp, { common })

    // The mocked VM uses a mocked runTx
    // which always returns an error.
    await runBlock(vm, { block, skipBlockValidation: true, skipHardForkValidation: true })
      .then(() => assert.fail('should have returned error'))
      .catch((e) => assert.ok(e.message.includes("sender doesn't have enough funds to send tx")))
  })

  it('should fail when block gas limit higher than 2^63-1', async () => {
    const vm = await createVM({ common })

    const block = createBlock({
      header: {
        gasLimit: hexToBytes('0x8000000000000000'),
      },
    })
    await runBlock(vm, { block })
      .then(() => assert.fail('should have returned error'))
      .catch((e) => assert.ok(e.message.includes('Invalid block')))
  })

  it('should fail when block validation fails', async () => {
    const blockchain = await createBlockchain()
    const vm = await createVM({ common, blockchain })

    const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
    const block = Object.create(createBlockFromRLP(blockRlp, { common }))

    await runBlock(vm, { block })
      .then(() => assert.fail('should have returned error'))
      .catch((e) => {
        assert.ok(
          e.message.includes('not found in DB'),
          'block failed validation due to no parent header',
        )
      })
  })

  it('should fail when no `validateHeader` method exists on blockchain class', async () => {
    const vm = await createVM({ common })
    const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
    const block = Object.create(createBlockFromRLP(blockRlp, { common }))
    ;(vm.blockchain as any).validateHeader = undefined
    try {
      await runBlock(vm, { block })
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(
        err.message,
        'cannot validate header: blockchain has no `validateHeader` method',
        'should error',
      )
    }
  })

  it('should fail when tx gas limit higher than block gas limit', async () => {
    const vm = await createVM({ common })

    const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
    const block = Object.create(createBlockFromRLP(blockRlp, { common }))
    // modify first tx's gasLimit
    const { nonce, gasPrice, to, value, data, v, r, s } = block.transactions[0]

    const gasLimit = BigInt('0x3fefba')
    const opts = { common: block.common }
    block.transactions[0] = new LegacyTx(
      { nonce, gasPrice, gasLimit, to, value, data, v, r, s },
      opts,
    )

    await runBlock(vm, { block, skipBlockValidation: true })
      .then(() => assert.fail('should have returned error'))
      .catch((e) => assert.ok(e.message.includes('higher gas limit')))
  })
})

describe('runBlock() -> runtime behavior', async () => {
  // this test actually checks if the DAO fork works. This is not checked in ethereum/tests
  it('DAO fork behavior', async () => {
    const common = getDAOCommon(1)

    const vm = await setupVM({ common })

    const block1 = RLP.decode(blockchainData.blocks[0].rlp as PrefixedHexString) as NestedUint8Array
    // edit extra data of this block to "dao-hard-fork"
    block1[0][12] = utf8ToBytes('dao-hard-fork')
    const block = createBlockFromBytesArray(block1 as BlockBytes, { common })
    await setupPreConditions(vm.stateManager, blockchainData)

    // fill two original DAO child-contracts with funds and the recovery account with funds in order to verify that the balance gets summed correctly
    const fundBalance1 = BigInt('0x1111')
    const accountFunded1 = createAccountWithDefaults(BigInt(0), fundBalance1)
    const DAOFundedContractAddress1 = new Address(
      hexToBytes('0xd4fe7bc31cedb7bfb8a345f31e668033056b2728'),
    )
    await vm.stateManager.putAccount(DAOFundedContractAddress1, accountFunded1)

    const fundBalance2 = BigInt('0x2222')
    const accountFunded2 = createAccountWithDefaults(BigInt(0), fundBalance2)
    const DAOFundedContractAddress2 = new Address(
      hexToBytes('0xb3fb0e5aba0e20e5c49d252dfd30e102b171a425'),
    )
    await vm.stateManager.putAccount(DAOFundedContractAddress2, accountFunded2)

    const DAORefundAddress = new Address(hexToBytes('0xbf4ed7b27f1d666546e30d74d50d173d20bca754'))
    const fundBalanceRefund = BigInt('0x4444')
    const accountRefund = createAccountWithDefaults(BigInt(0), fundBalanceRefund)
    await vm.stateManager.putAccount(DAORefundAddress, accountRefund)

    await runBlock(vm, {
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
    const common = new Common({ chain: Goerli, hardfork: Hardfork.Istanbul })
    const vm = await setupVM({ common })

    const signer = {
      address: new Address(hexToBytes('0x0b90087d864e82a284dca15923f3776de6bb016f')),
      privateKey: hexToBytes('0x64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
      publicKey: hexToBytes(
        '0x40b2ebdf4b53206d2d3d3d59e7e2f13b1ea68305aec71d5d24cefe7f24ecae886d241f9267f04702d7f693655eb7b4aa23f30dcd0c3c5f2b970aad7c8a828195',
      ),
    }

    const otherUser = {
      address: new Address(hexToBytes('0x6f62d8382bf2587361db73ceca28be91b2acb6df')),
      privateKey: hexToBytes('0x2a6e9ad5a6a8e4f17149b8bc7128bf090566a11dbd63c30e5a0ee9f161309cd6'),
      publicKey: hexToBytes(
        '0xca0a55f6e81cb897aee6a1c390aa83435c41048faa0564b226cfc9f3df48b73e846377fb0fd606df073addc7bd851f22547afbbdd5c3b028c91399df802083a2',
      ),
    }

    // add balance to otherUser to send two txs to zero address
    await vm.stateManager.putAccount(otherUser.address, new Account(BigInt(0), BigInt(42000)))
    const tx = createLegacyTx(
      { to: createZeroAddress(), gasLimit: 21000, gasPrice: 1 },
      { common },
    ).sign(otherUser.privateKey)

    // create block with the signer and txs
    const block = createSealedCliqueBlock(
      { header: { extraData: new Uint8Array(97) }, transactions: [tx, tx] },
      signer.privateKey,
      { common },
    )

    await runBlock(vm, { block, skipNonce: true, skipBlockValidation: true, generate: true })
    const account = await vm.stateManager.getAccount(signer.address)
    assert.equal(
      account!.balance,
      BigInt(42000),
      'beneficiary balance should equal the cost of the txs',
    )
  })
})

async function runBlockAndGetAfterBlockEvent(
  vm: VM,
  runBlockOpts: RunBlockOpts,
): Promise<AfterBlockEvent> {
  let results: AfterBlockEvent
  function handler(event: AfterBlockEvent) {
    results = event
  }

  try {
    vm.events.once('afterBlock', handler)
    await runBlock(vm, runBlockOpts)
  } finally {
    // We need this in case `runBlock` throws before emitting the event.
    // Otherwise we'd be leaking the listener until the next call to runBlock.
    vm.events.removeListener('afterBlock', handler)
  }

  return results!
}

it('should correctly reflect generated fields', async () => {
  const vm = await createVM()

  // We create a block with a receiptTrie and transactionsTrie
  // filled with 0s and no txs. Once we run it we should
  // get a receipt trie root of for the empty receipts set,
  // which is a well known constant.
  const bytes32Zeros = new Uint8Array(32)
  const block = createBlock({
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
  const common = new Common({ chain: Mainnet, hardfork })
  const vm = await setupVM({ common })

  const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
  const block = createBlockFromRLP(blockRlp, { common })

  await setupPreConditions(vm.stateManager, blockchainData)

  const res = await runBlock(vm, {
    block,
    generate: true,
    skipBlockValidation: true,
  })
  return res
}

// TODO: complete on result values and add more usage scenario test cases
describe('runBlock() -> API return values', () => {
  it('should return correct HF receipts', async () => {
    let res = await runWithHf('byzantium')
    assert.equal(
      (res.receipts[0] as PostByzantiumTxReceipt).status,
      1,
      'should return correct post-Byzantium receipt format',
    )

    res = await runWithHf('spuriousDragon')
    assert.deepEqual(
      (res.receipts[0] as PreByzantiumTxReceipt).stateRoot,
      hexToBytes('0x4477e2cfaf9fd2eed4f74426798b55d140f6a9612da33413c4745f57d7a97fcc'),
      'should return correct pre-Byzantium receipt format',
    )
  })
})

describe('runBlock() -> tx types', async () => {
  async function simpleRun(vm: VM, transactions: TypedTransaction[]) {
    const common = vm.common

    const blockRlp = hexToBytes(blockchainData.blocks[0].rlp as PrefixedHexString)
    const block = createBlockFromRLP(blockRlp, { common, freeze: false })

    //@ts-ignore read-only property
    block.transactions = transactions

    if (transactions.some((t) => t.supports(Capability.EIP1559FeeMarket))) {
      // @ts-ignore read-only property
      block.header.baseFeePerGas = BigInt(7)
    }

    await setupPreConditions(vm.stateManager, blockchainData)

    const res = await runBlock(vm, {
      block,
      skipBlockValidation: true,
      generate: true,
    })

    assert.equal(
      res.gasUsed,
      res.receipts
        .map((r) => r.cumulativeBlockGasUsed)
        .reduce((prevValue: bigint, currValue: bigint) => prevValue + currValue, BigInt(0)),
      "gas used should equal transaction's total gasUsed",
    )
  }

  it('legacy tx', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
    const vm = await setupVM({ common })

    const address = createAddressFromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    const tx = createLegacyTx({ gasLimit: 53000, value: 1 }, { common, freeze: false })

    tx.getSenderAddress = () => {
      return address
    }

    await simpleRun(vm, [tx])
  })

  it('access list tx', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
    const vm = await setupVM({ common })

    const address = createAddressFromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    const tx = createAccessList2930Tx(
      { gasLimit: 53000, value: 1, v: 1, r: 1, s: 1 },
      { common, freeze: false },
    )

    tx.getSenderAddress = () => {
      return address
    }

    await simpleRun(vm, [tx])
  })

  it('fee market tx', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const vm = await setupVM({ common })

    const address = createAddressFromString('0xccfd725760a68823ff1e062f4cc97e1360e8d997')
    await setBalance(vm, address)

    const tx = createFeeMarket1559Tx(
      { maxFeePerGas: 10, maxPriorityFeePerGas: 4, gasLimit: 100000, value: 6 },
      { common, freeze: false },
    )

    tx.getSenderAddress = () => {
      return address
    }

    await simpleRun(vm, [tx])
  })

  it('eip7702 txs', async () => {
    /**
     * This test setups a block with 2 7702-txs. There are two codes:
     * Code1: stores "1" in slot 0
     * Code2: stores "2" in slot 0
     * The first tx will send from address A into address B. Address B will authorize Code1
     * -> So, after this tx, "1" is stored in address B key 0
     * The second tx will send from address A into address B. Address B will authorize Code2
     * -> So, after this tx, "2" is stored in address B key 0
     * After the block is ran, it is verified that "2" is stored in key 0 of address B
     */
    const defaultAuthPkey = hexToBytes(`0x${'20'.repeat(32)}`)
    const defaultAuthAddr = new Address(privateToAddress(defaultAuthPkey))

    const defaultSenderPkey = hexToBytes(`0x${'40'.repeat(32)}`)
    const defaultSenderAddr = new Address(privateToAddress(defaultSenderPkey))

    const code1Addr = createAddressFromString(`0x${'01'.repeat(20)}`)
    const code2Addr = createAddressFromString(`0x${'02'.repeat(20)}`)

    type GetAuthListOpts = {
      chainId?: number
      nonce?: number
      address: Address
      pkey?: Uint8Array
    }

    function getAuthorizationListItem(opts: GetAuthListOpts): AuthorizationListBytesItem {
      const actualOpts = {
        ...{ chainId: 0, pkey: defaultAuthPkey },
        ...opts,
      }

      const { chainId, nonce, address, pkey } = actualOpts

      const chainIdBytes = unpadBytes(hexToBytes(`0x${chainId.toString(16)}`))
      const nonceBytes =
        nonce !== undefined ? unpadBytes(hexToBytes(`0x${nonce.toString(16)}`)) : new Uint8Array()
      const addressBytes = address.toBytes()

      const rlpdMsg = RLP.encode([chainIdBytes, addressBytes, nonceBytes])
      const msgToSign = keccak256(concatBytes(new Uint8Array([5]), rlpdMsg))
      const signed = ecsign(msgToSign, pkey)

      const yParity = signed.v === BigInt(27) ? new Uint8Array() : new Uint8Array([1])

      return [chainIdBytes, addressBytes, nonceBytes, yParity, signed.r, signed.s]
    }

    const common = new Common({
      chain: Mainnet,
      hardfork: Hardfork.Cancun,
      eips: [7702],
    })
    const vm = await setupVM({ common })

    await setBalance(vm, defaultSenderAddr, 0xfffffffffffffn)

    const code1 = hexToBytes('0x600160005500')
    await vm.stateManager.putCode(code1Addr, code1)

    const code2 = hexToBytes('0x600260005500')
    await vm.stateManager.putCode(code2Addr, code2)
    const authorizationListOpts = [
      {
        address: code1Addr,
      },
    ]
    const authorizationListOpts2 = [
      {
        address: code2Addr,
        nonce: 1,
      },
    ]

    const authList = authorizationListOpts.map((opt) => getAuthorizationListItem(opt))
    const authList2 = authorizationListOpts2.map((opt) => getAuthorizationListItem(opt))
    const tx1 = createEOACode7702Tx(
      {
        gasLimit: 1000000000,
        maxFeePerGas: 100000,
        maxPriorityFeePerGas: 100,
        authorizationList: authList,
        to: defaultAuthAddr,
        value: BIGINT_1,
      },
      { common },
    ).sign(defaultSenderPkey)
    const tx2 = createEOACode7702Tx(
      {
        gasLimit: 1000000000,
        maxFeePerGas: 100000,
        maxPriorityFeePerGas: 100,
        authorizationList: authList2,
        to: defaultAuthAddr,
        value: BIGINT_1,
        nonce: 1,
      },
      { common },
    ).sign(defaultSenderPkey)
    const block = createBlock(
      {
        transactions: [tx1, tx2],
      },
      { common, setHardfork: false, skipConsensusFormatValidation: true },
    )

    await runBlock(vm, { block, skipBlockValidation: true, generate: true })
    const storage = await vm.stateManager.getStorage(defaultAuthAddr, new Uint8Array(32))
    assert.ok(equalsBytes(storage, new Uint8Array([2])))
  })
})
