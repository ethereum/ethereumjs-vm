import { createBlock, createBlockHeader } from '@ethereumjs/block'
import { Blockchain, createBlockchain } from '@ethereumjs/blockchain'
import { Common, Goerli, Hardfork, Mainnet, createCommonFromGethGenesis } from '@ethereumjs/common'
import {
  Blob4844Tx,
  EOACode7702Transaction,
  FeeMarket1559Tx,
  TransactionType,
  createFeeMarket1559Tx,
  createLegacyTx,
  createTx,
} from '@ethereumjs/tx'
import {
  Account,
  Address,
  KECCAK256_NULL,
  MAX_INTEGER,
  bytesToHex,
  createAccount,
  createAddressFromPrivateKey,
  createAddressFromString,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
} from '@ethereumjs/util'
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'
import { assert, describe, it } from 'vitest'

import { createVM, runTx } from '../../src/index.js'

import { createAccountWithDefaults, getTransaction, setBalance } from './utils.js'

import type { VM } from '../../src/vm.js'
import type { FeeMarketEIP1559TxData, LegacyTx, TypedTxData } from '@ethereumjs/tx'

const TRANSACTION_TYPES = [
  {
    type: TransactionType.Legacy,
    name: 'legacy tx',
  },
  {
    type: TransactionType.AccessListEIP2930,
    name: 'EIP2930 tx',
  },
  {
    type: TransactionType.FeeMarketEIP1559,
    name: 'EIP1559 tx',
  },
]

const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
common.events.setMaxListeners(100)
describe('runTx() -> successful API parameter usage', async () => {
  async function simpleRun(vm: VM, msg: string) {
    for (const txType of TRANSACTION_TYPES) {
      const tx = getTransaction(vm.common, txType.type, true)

      const caller = tx.getSenderAddress()
      const acc = createAccountWithDefaults()
      await vm.stateManager.putAccount(caller, acc)
      let block
      if (vm.common.consensusType() === 'poa') {
        // Setup block with correct extraData for POA
        block = createBlock({ header: { extraData: new Uint8Array(97) } }, { common: vm.common })
      }

      const res = await runTx(vm, { tx, block })
      assert.isTrue(res.totalGasSpent > BigInt(0), `${msg} (${txType.name})`)
    }
  }

  it('simple run (unmodified options)', async () => {
    let common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    let vm = await createVM({ common })
    await simpleRun(vm, 'mainnet (PoW), london HF, default SM - should run without errors')

    common = new Common({ chain: Goerli, hardfork: Hardfork.London })
    vm = await createVM({
      common,
      blockchain: await createBlockchain({ validateConsensus: false, validateBlocks: false }),
    })
    await simpleRun(vm, 'goerli (PoA), london HF, default SM - should run without errors')
  })

  it('test successful hardfork matching', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const vm = await createVM({
      common,
      blockchain: await createBlockchain({ validateConsensus: false, validateBlocks: false }),
    })
    const tx = getTransaction(vm.common, 0, true)
    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)
    const block = createBlock({}, { common: vm.common.copy() })
    await runTx(vm, { tx, block })
    assert.ok(true, 'matched hardfork should run without throwing')
  })

  it('test hardfork mismatch', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const vm = await createVM({
      common,
      blockchain: await createBlockchain({ validateConsensus: false, validateBlocks: false }),
    })
    const tx = getTransaction(vm.common, 0, true)
    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)
    const block = createBlock({}, { common: vm.common.copy() })

    block.common.setHardfork(Hardfork.Paris)
    try {
      await runTx(vm, { tx, block })
      assert.fail('vm/block mismatched hardfork should have failed')
    } catch (e) {
      assert.equal(
        (e as Error).message.includes('block has a different hardfork than the vm'),
        true,
        'block has a different hardfork than the vm',
      )
      assert.ok(true, 'vm/tx mismatched hardfork correctly failed')
    }

    tx.common.setHardfork(Hardfork.London)
    block.common.setHardfork(Hardfork.Paris)
    try {
      await runTx(vm, { tx, block })
      assert.fail('vm/tx mismatched hardfork should have failed')
    } catch (e) {
      assert.equal(
        (e as Error).message.includes('block has a different hardfork than the vm'),
        true,
        'block has a different hardfork than the vm',
      )
      assert.ok(true, 'vm/tx mismatched hardfork correctly failed')
    }

    await runTx(vm, { tx, block, skipHardForkValidation: true })
    assert.ok(true, 'runTx should not fail with mismatching hardforks if validation skipped')
  })

  it('should use passed in blockGasUsed to generate tx receipt', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const vm = await createVM({ common })

    const tx = getTransaction(vm.common, 0, true)

    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)

    const blockGasUsed = BigInt(1000)
    const res = await runTx(vm, { tx, blockGasUsed })
    assert.equal(
      res.receipt.cumulativeBlockGasUsed,
      blockGasUsed + res.totalGasSpent,
      'receipt.gasUsed should equal block gas used + tx gas used',
    )
  })

  it('Legacy Transaction with HF set to pre-Berlin', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const vm = await createVM({ common })

    const tx = getTransaction(vm.common, 0, true)

    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)

    const res = await runTx(vm, { tx })
    assert.isTrue(
      res.totalGasSpent > BigInt(0),
      `mainnet (PoW), istanbul HF, default SM - should run without errors (${TRANSACTION_TYPES[0].name})`,
    )
  })

  it('custom block (block option), disabled block gas limit validation (skipBlockGasLimitValidation: true)', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })

      const privateKey = hexToBytes(
        '0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109',
      )
      const address = createAddressFromPrivateKey(privateKey)
      const initialBalance = BigInt(10) ** BigInt(18)

      const account = await vm.stateManager.getAccount(address)
      await vm.stateManager.putAccount(
        address,
        createAccount({ ...account, balance: initialBalance }),
      )

      const transferCost = 21000
      const unsignedTx = createTx(
        {
          to: address,
          gasLimit: transferCost,
          gasPrice: 100,
          nonce: 0,
          type: txType.type,
          maxPriorityFeePerGas: 50,
          maxFeePerGas: 50,
        } as TypedTxData,
        { common },
      )
      const tx = unsignedTx.sign(privateKey)

      const coinbase = hexToBytes('0x00000000000000000000000000000000000000ff')
      const block = createBlock(
        {
          header: {
            gasLimit: transferCost - 1,
            coinbase,
            baseFeePerGas: 7,
          },
        },
        { common },
      )

      const result = await runTx(vm, {
        tx,
        block,
        skipBlockGasLimitValidation: true,
      })

      const coinbaseAccount = await vm.stateManager.getAccount(new Address(coinbase))

      // calculate expected coinbase balance
      const baseFee = block.header.baseFeePerGas!
      const inclusionFeePerGas =
        tx instanceof FeeMarket1559Tx ||
        tx instanceof Blob4844Tx ||
        tx instanceof EOACode7702Transaction
          ? tx.maxPriorityFeePerGas < tx.maxFeePerGas - baseFee
            ? tx.maxPriorityFeePerGas
            : tx.maxFeePerGas - baseFee
          : tx.gasPrice - baseFee
      const expectedCoinbaseBalance = common.isActivatedEIP(1559)
        ? result.totalGasSpent * inclusionFeePerGas
        : result.amountSpent

      assert.equal(
        coinbaseAccount!.balance,
        expectedCoinbaseBalance,
        `should use custom block (${txType.name})`,
      )

      assert.equal(
        result.execResult.exceptionError,
        undefined,
        `should run ${txType.name} without errors`,
      )
    }
  })
})

describe('runTx() -> API parameter usage/data errors', () => {
  it('Typed Transaction with HF set to pre-Berlin', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    const vm = await createVM({ common })

    const tx = getTransaction(new Common({ chain: Mainnet, hardfork: Hardfork.Berlin }), 1, true)

    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)

    try {
      await runTx(vm, { tx, skipHardForkValidation: true })
      // TODO uncomment:
      // assert.fail('should throw error')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('(EIP-2718) not activated'),
        `should fail for ${TRANSACTION_TYPES[1].name}`,
      )
    }
  })

  it('simple run (reportAccessList option)', async () => {
    const vm = await createVM({ common })

    const tx = getTransaction(vm.common, 0, true)

    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)

    const res = await runTx(vm, { tx, reportAccessList: true })
    assert.isTrue(
      res.totalGasSpent > BigInt(0),
      `mainnet (PoW), istanbul HF, default SM - should run without errors (${TRANSACTION_TYPES[0].name})`,
    )
    assert.deepEqual(res.accessList, [])
  })

  it('simple run (reportPreimages option)', async () => {
    const vm = await createVM({ common })

    const tx = getTransaction(vm.common, 0, true)

    const caller = tx.getSenderAddress()
    const acc = createAccountWithDefaults()
    await vm.stateManager.putAccount(caller, acc)

    const res = await runTx(vm, { tx, reportPreimages: true })

    const hashedCallerKey = vm.stateManager.getAppliedKey!(caller.bytes)

    const retrievedPreimage = res.preimages?.get(bytesToHex(hashedCallerKey))

    assert.ok(retrievedPreimage !== undefined && equalsBytes(retrievedPreimage, caller.bytes))
  })

  it('run without signature', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, false)
      try {
        await runTx(vm, { tx })
        assert.fail('should throw error')
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        assert.ok(
          e.message.includes('not signed') === true ||
            e.message.includes('Invalid Signature') === true,
          `should fail for ${txType.name}`,
        )
      }
    }
  })

  it('run with insufficient funds', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, true)
      try {
        await runTx(vm, { tx })
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        assert.ok(
          e.message.toLowerCase().includes('enough funds'),
          `should fail for ${txType.name}`,
        )
      }
    }

    // EIP-1559
    // Fail if signer.balance < gas_limit * max_fee_per_gas
    const vm = await createVM({ common })
    let tx = getTransaction(vm.common, 2, true) as FeeMarket1559Tx
    const address = tx.getSenderAddress()
    tx = Object.create(tx)
    const maxCost: bigint = tx.gasLimit * tx.maxFeePerGas
    await vm.stateManager.putAccount(
      address,
      createAccountWithDefaults(BigInt(0), maxCost - BigInt(1)),
    )
    try {
      await runTx(vm, { tx })
      assert.fail('should throw error')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.toLowerCase().includes('max cost'),
        `should fail if max cost exceeds balance`,
      )
    }
    // set sufficient balance
    await vm.stateManager.putAccount(address, createAccountWithDefaults(BigInt(0), maxCost))
    const res = await runTx(vm, { tx })
    assert.ok(res, 'should pass if balance is sufficient')
  })

  it('run with insufficient eip1559 funds', async () => {
    const vm = await createVM({ common })
    const tx = getTransaction(common, 2, true, '0x0', false)
    const address = tx.getSenderAddress()
    await vm.stateManager.putAccount(address, new Account())
    const account = await vm.stateManager.getAccount(address)
    account!.balance = BigInt(9000000) // This is the maxFeePerGas multiplied with the gasLimit of 90000
    await vm.stateManager.putAccount(address, account!)
    await runTx(vm, { tx })
    account!.balance = BigInt(9000000)
    await vm.stateManager.putAccount(address, account!)
    const tx2 = getTransaction(common, 2, true, '0x64', false) // Send 100 wei; now balance < maxFeePerGas*gasLimit + callvalue
    try {
      await runTx(vm, { tx: tx2 })
      assert.fail('cannot reach this')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(true, 'successfully threw on insufficient balance for transaction')
    }
  })

  it('should throw on wrong nonces', async () => {
    const vm = await createVM({ common })
    const tx = getTransaction(common, 2, true, '0x0', false)
    const address = tx.getSenderAddress()
    await vm.stateManager.putAccount(address, new Account())
    const account = await vm.stateManager.getAccount(address)
    account!.balance = BigInt(9000000) // This is the maxFeePerGas multiplied with the gasLimit of 90000
    account!.nonce = BigInt(1)
    await vm.stateManager.putAccount(address, account!)
    try {
      await runTx(vm, { tx })
      assert.fail('cannot reach this')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(true, 'successfully threw on wrong nonces')
    }
  })

  it("run with maxBaseFee less than block's baseFee", async () => {
    // EIP-1559
    // Fail if transaction.maxFeePerGas < block.baseFeePerGas
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, true)
      const block = createBlock({ header: { baseFeePerGas: 100000 } }, { common })
      try {
        await runTx(vm, { tx, block })
        assert.fail('should fail')
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        assert.ok(
          e.message.includes("is less than the block's baseFeePerGas"),
          'should fail with appropriate error',
        )
      }
    }
  })
})

describe('runTx() -> runtime behavior', () => {
  it('storage cache', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
      const vm = await createVM({ common })
      const privateKey = hexToBytes(
        '0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109',
      )
      /* Code which is deployed here:
        PUSH1 01
        PUSH1 00
        SSTORE
        INVALID
      */
      const code = hexToBytes('0x6001600055FE')
      const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
      await vm.stateManager.putCode(address, code)
      await vm.stateManager.putStorage(
        address,
        hexToBytes(`0x${'00'.repeat(32)}`),
        hexToBytes(`0x${'00'.repeat(31)}01`),
      )
      const txParams: any = {
        nonce: '0x00',
        gasPrice: 1,
        gasLimit: 100000,
        to: address,
      }
      if (txType.type === TransactionType.AccessListEIP2930) {
        txParams['chainId'] = common.chainId()
        txParams['accessList'] = []
        txParams['type'] = txType.type
      }
      const tx = createTx(txParams, { common }).sign(privateKey)

      await vm.stateManager.putAccount(tx.getSenderAddress(), createAccountWithDefaults())

      await runTx(vm, { tx }) // this tx will fail, but we have to ensure that the cache is cleared

      assert.equal(
        (<any>vm.stateManager).originalStorageCache.map.size,
        0,
        `should clear storage cache after every ${txType.name}`,
      )
    }
  })
})

describe('runTx() -> runtime errors', () => {
  it('account balance overflows (call)', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, true, '0x01')

      const caller = tx.getSenderAddress()
      const from = createAccountWithDefaults()
      await vm.stateManager.putAccount(caller, from)

      const to = createAccountWithDefaults(BigInt(0), MAX_INTEGER)
      await vm.stateManager.putAccount(tx.to!, to)

      const res = await runTx(vm, { tx })

      assert.equal(
        res.execResult!.exceptionError!.error,
        'value overflow',
        `result should have 'value overflow' error set (${txType.name})`,
      )
      assert.equal(
        (<any>vm.stateManager)._checkpointCount,
        0,
        `checkpoint count should be 0 (${txType.name})`,
      )
    }
  })

  it('account balance overflows (create)', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, true, '0x01', true)

      const caller = tx.getSenderAddress()
      const from = createAccountWithDefaults()
      await vm.stateManager.putAccount(caller, from)

      const contractAddress = createAddressFromString('0x61de9dc6f6cff1df2809480882cfd3c2364b28f7')
      const to = createAccountWithDefaults(BigInt(0), MAX_INTEGER)
      await vm.stateManager.putAccount(contractAddress, to)

      const res = await runTx(vm, { tx })

      assert.equal(
        res.execResult!.exceptionError!.error,
        'value overflow',
        `result should have 'value overflow' error set (${txType.name})`,
      )
      assert.equal(
        (<any>vm.stateManager)._checkpointCount,
        0,
        `checkpoint count should be 0 (${txType.name})`,
      )
    }
  })
})

// TODO: complete on result values and add more usage scenario test cases
describe('runTx() -> API return values', () => {
  it('simple run, common return values', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, true)

      const caller = tx.getSenderAddress()
      const acc = createAccountWithDefaults()
      await vm.stateManager.putAccount(caller, acc)

      const res = await runTx(vm, { tx })
      assert.equal(
        res.execResult.executionGasUsed,
        BigInt(0),
        `execution result -> gasUsed -> 0 (${txType.name})`,
      )
      assert.equal(
        res.execResult.exceptionError,
        undefined,
        `execution result -> exception error -> undefined (${txType.name})`,
      )
      assert.deepEqual(
        res.execResult.returnValue,
        Uint8Array.from([]),
        `execution result -> return value -> empty Uint8Array (${txType.name})`,
      )
      assert.equal(res.gasRefund, BigInt(0), `gasRefund -> 0 (${txType.name})`)
    }
  })

  it('simple run, runTx default return values', async () => {
    for (const txType of TRANSACTION_TYPES) {
      const vm = await createVM({ common })
      const tx = getTransaction(vm.common, txType.type, true)

      const caller = tx.getSenderAddress()
      const acc = createAccountWithDefaults()
      await vm.stateManager.putAccount(caller, acc)

      const res = await runTx(vm, { tx })

      assert.equal(
        res.totalGasSpent,
        tx.getIntrinsicGas(),
        `runTx result -> gasUsed -> tx.getIntrinsicGas() (${txType.name})`,
      )
      if (tx instanceof FeeMarket1559Tx) {
        const baseFee = BigInt(7)
        const inclusionFeePerGas =
          tx.maxPriorityFeePerGas < tx.maxFeePerGas - baseFee
            ? tx.maxPriorityFeePerGas
            : tx.maxFeePerGas - baseFee
        const gasPrice = inclusionFeePerGas + baseFee
        assert.equal(
          res.amountSpent,
          res.totalGasSpent * gasPrice,
          `runTx result -> amountSpent -> gasUsed * gasPrice (${txType.name})`,
        )
      } else {
        assert.equal(
          res.amountSpent,
          res.totalGasSpent * (<LegacyTx>tx).gasPrice,
          `runTx result -> amountSpent -> gasUsed * gasPrice (${txType.name})`,
        )
      }

      assert.deepEqual(
        res.bloom.bitvector,
        hexToBytes(`0x${'00'.repeat(256)}`),
        `runTx result -> bloom.bitvector -> should be empty (${txType.name})`,
      )
      assert.equal(
        res.receipt.cumulativeBlockGasUsed,
        res.totalGasSpent,
        `runTx result -> receipt.gasUsed -> result.gasUsed (${txType.name})`,
      )
      assert.deepEqual(
        res.receipt.bitvector,
        res.bloom.bitvector,
        `runTx result -> receipt.bitvector -> result.bloom.bitvector (${txType.name})`,
      )
      assert.deepEqual(
        res.receipt.logs,
        [],
        `runTx result -> receipt.logs -> empty array (${txType.name})`,
      )
    }
  })
})

describe('runTx() -> consensus bugs', () => {
  it('validate out-of-gas does not give any refunds', async () => {
    // There was a consensus bug in the following mainnet tx:
    // 0xe3b0fb0a45bc905d1f98baabaadd194901267d02de74cdad187b7feb8920d7b3
    // This tx does not access any other accounts and creates a new contract,
    // so we are safe to setup the account which creates this contract
    // and just re-use the tx.
    const txData = {
      blockHash: '0x78046e1c8f7956f2b654033c02f348b1c1d111701ec83cd9b5bf690e92efdedd',
      blockNumber: 2772981,
      gasLimit: 489999,
      gasPrice: 41000000000,
      data: '0x6060604052604060405190810160405280600981526020017f546f6b656e20302e31000000000000000000000000000000000000000000000081526020015060009080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200008b57805160ff1916838001178555620000bc565b82800160010185558215620000bc579182015b82811115620000bb5782518255916020019190600101906200009e565b5b509050620000e491905b80821115620000e0576000816000905550600101620000c6565b5090565b5050604060405190810160405280600d81526020017f7472616c616c6120746f6b656e0000000000000000000000000000000000000081526020015060019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200016d57805160ff19168380011785556200019e565b828001600101855582156200019e579182015b828111156200019d57825182559160200191906001019062000180565b5b509050620001c691905b80821115620001c2576000816000905550600101620001a8565b5090565b5050604060405190810160405280600481526020017f476f6c640000000000000000000000000000000000000000000000000000000081526020015060029080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200024f57805160ff191683800117855562000280565b8280016001018555821562000280579182015b828111156200027f57825182559160200191906001019062000262565b5b509050620002a891905b80821115620002a45760008160009055506001016200028a565b5090565b50506002600360006101000a81548160ff02191690837f0100000000000000000000000000000000000000000000000000000000000000908102040217905550621e84806004553462000000576040516200107638038062001076833981016040528080519060200190919080518201919060200180519060200190919080518201919060200150505b83600560003373ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002081905550836004819055508260019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10620003b557805160ff1916838001178555620003e6565b82800160010185558215620003e6579182015b82811115620003e5578251825591602001919060010190620003c8565b5b5090506200040e91905b808211156200040a576000816000905550600101620003f0565b5090565b50508060029080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200045e57805160ff19168380011785556200048f565b828001600101855582156200048f579182015b828111156200048e57825182559160200191906001019062000471565b5b509050620004b791905b80821115620004b357600081600090555060010162000499565b5090565b505081600360006101000a81548160ff02191690837f01000000000000000000000000000000000000000000000000000000000000009081020402179055505b505050505b610b6b806200050b6000396000f3606060405236156100a7576000357c01000000000000000000000000000000000000000000000000000000009004806306fdde03146100b9578063095ea7b31461013457806318160ddd1461017057806323b872dd14610193578063313ce567146101d85780635a3b7e42146101fe57806370a082311461027957806395d89b41146102aa578063a9059cbb14610325578063cae9ca511461034b578063dd62ed3e146103ca575b34610000576100b75b610000565b565b005b34610000576100c6610404565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156101265780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b346100005761015860048080359060200190919080359060200190919050506104a2565b60405180821515815260200191505060405180910390f35b346100005761017d610504565b6040518082815260200191505060405180910390f35b34610000576101c0600480803590602001909190803590602001909190803590602001909190505061050a565b60405180821515815260200191505060405180910390f35b34610000576101e561073d565b604051808260ff16815260200191505060405180910390f35b346100005761020b610750565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f16801561026b5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b346100005761029460048080359060200190919050506107ee565b6040518082815260200191505060405180910390f35b34610000576102b7610806565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156103175780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b346100005761034960048080359060200190919080359060200190919050506108a4565b005b34610000576103b2600480803590602001909190803590602001909190803590602001908201803590602001908080601f01602080910402602001604051908101604052809392919081815260200183838082843782019150505050505091905050610a13565b60405180821515815260200191505060405180910390f35b34610000576103ee6004808035906020019091908035906020019091905050610b46565b6040518082815260200191505060405180910390f35b60018054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561049a5780601f1061046f5761010080835404028352916020019161049a565b820191906000526020600020905b81548152906001019060200180831161047d57829003601f168201915b505050505081565b600081600660003373ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008573ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002081905550600190505b92915050565b60045481565b600081600560008673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054101561054257610000565b600560008473ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205482600560008673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020540110156105a357610000565b600660008573ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205482111561060057610000565b81600560008673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000828254039250508190555081600560008573ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000828254019250508190555081600660008673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055508273ffffffffffffffffffffffffffffffffffffffff168473ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef846040518082815260200191505060405180910390a3600190505b9392505050565b600360009054906101000a900460ff1681565b60008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156107e65780601f106107bb576101008083540402835291602001916107e6565b820191906000526020600020905b8154815290600101906020018083116107c957829003601f168201915b505050505081565b60056020528060005260406000206000915090505481565b60028054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561089c5780601f106108715761010080835404028352916020019161089c565b820191906000526020600020905b81548152906001019060200180831161087f57829003601f168201915b505050505081565b80600560003373ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205410156108da57610000565b600560008373ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205481600560008573ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205401101561093b57610000565b80600560003373ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000828254039250508190555080600560008473ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055508173ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef836040518082815260200191505060405180910390a35b5050565b60006000849050610a2485856104a2565b15610b3d578073ffffffffffffffffffffffffffffffffffffffff16638f4ffcb133863087604051857c0100000000000000000000000000000000000000000000000000000000028152600401808573ffffffffffffffffffffffffffffffffffffffff1681526020018481526020018373ffffffffffffffffffffffffffffffffffffffff168152602001806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f168015610b0c5780820380516001836020036101000a031916815260200191505b5095505050505050600060405180830381600087803b156100005760325a03f1156100005750505060019150610b3e565b5b509392505050565b600660205281600052604060002060205280600052604060002060009150915050548156',
      nonce: 2,
      r: '0x79d4e717d1249512572b90ca87fe545dde24815e33eb74064bdd7336463f6d8',
      s: '0x4a16b7d119cdc34e454fa2cc0a152904f7deb23e2a5f2966f70981361c853874',
      v: '0x26',
      value: '0x0',
    } as TypedTxData
    const beforeBalance = BigInt(149123788000000000)
    const afterBalance = BigInt(129033829000000000)

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.SpuriousDragon })
    common.setHardforkBy({ blockNumber: 2772981 })
    const vm = await createVM({ common })

    const addr = createAddressFromString('0xd3563d8f19a85c95beab50901fd59ca4de69174c')
    await vm.stateManager.putAccount(addr, new Account())
    const acc = await vm.stateManager.getAccount(addr)
    acc!.balance = beforeBalance
    acc!.nonce = BigInt(2)
    await vm.stateManager.putAccount(addr, acc!)

    const tx = createLegacyTx(txData, { common })
    await runTx(vm, { tx })

    const newBalance = (await vm.stateManager.getAccount(addr))!.balance
    assert.equal(newBalance, afterBalance)
  })

  it('validate REVERT opcode does not consume all gas', async () => {
    /* This test simulates the Kintsugi devnet transaction: 0x1fb8a5ac000196a54dfe63dfda60542340b790a874b1d319b0aa834ef2ea1425.
       This transaction will try to create a contract, but it will REVERT.
       REVERT puts an "error message" in the RETURNDATA buffer. This buffer would contain the contract code to deploy if the message would not fail.
       In this case, REVERT puts a message in the RETURNDATA buffer which is larger than the `maxCodeSize`
       This should not consume all gas: it should only consume the gas spent by the attempt to create the contract */
    const pkey = new Uint8Array(32).fill(1)
    const txData: FeeMarketEIP1559TxData = {
      gasLimit: 100000,
      maxPriorityFeePerGas: 1000,
      maxFeePerGas: 1000,
      data: '0x5a600060085548fd896000606e5591b1e13d6000593e596000208055600060e5557fce5f47d3286fafb6fd28e73513c7671cd3ade974d1c1d898b43f07f89c82aee960aa527f4a97c424e9050663e203c27528f85ca5b0348980d5e61cc3e062d253a246f95760ca52606660ea53605060eb53607360ec53602960ed5360a460',
      nonce: 0,
      accessList: [
        {
          address: '0x32dcab0ef3fb2de2fce1d2e0799d36239671f04a',
          storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000008'],
        },
      ],
    }

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const vm = await createVM({ common })

    const addr = createAddressFromPrivateKey(pkey)
    await vm.stateManager.putAccount(addr, new Account())
    const acc = await vm.stateManager.getAccount(addr)
    acc!.balance = BigInt(10000000000000)
    await vm.stateManager.putAccount(addr, acc!)

    const tx = createFeeMarket1559Tx(txData, { common }).sign(pkey)

    const block = createBlock({ header: { baseFeePerGas: 0x0c } }, { common })
    const result = await runTx(vm, { tx, block })

    assert.equal(
      result.totalGasSpent,
      BigInt(66382),
      'should use the right amount of gas and not consume all',
    )
  })
})

describe('runTx() -> RunTxOptions', () => {
  it('should throw on negative value args', async () => {
    const vm = await createVM({ common })
    await setBalance(vm, createZeroAddress(), BigInt(10000000000))
    for (const txType of TRANSACTION_TYPES) {
      const tx = getTransaction(vm.common, txType.type, false)
      tx.getSenderAddress = () => createZeroAddress()
      // @ts-ignore overwrite read-only property
      tx.value -= BigInt(1)

      for (const skipBalance of [true, false]) {
        try {
          await runTx(vm, {
            tx,
            skipBalance,
          })
          assert.fail('should not accept a negative call value')
        } catch (err) {
          if (!(err instanceof Error)) {
            err = new Error(err)
          }
          assert.ok(
            err.message.includes('value field cannot be negative'),
            'throws on negative call value',
          )
        }
      }
    }
  })
})

it('runTx() -> skipBalance behavior', async () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
  const vm = await createVM({ common })
  const senderKey = hexToBytes('0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109')
  const sender = createAddressFromPrivateKey(senderKey)

  for (const balance of [undefined, BigInt(5)]) {
    if (balance !== undefined) {
      await vm.stateManager.modifyAccountFields(sender, { nonce: BigInt(0), balance })
    }
    const tx = createLegacyTx({
      gasLimit: BigInt(21000),
      value: BigInt(1),
      to: createZeroAddress(),
    }).sign(senderKey)

    const res = await runTx(vm, { tx, skipBalance: true, skipHardForkValidation: true })
    assert.ok(true, 'runTx should not throw with no balance and skipBalance')
    const afterTxBalance = (await vm.stateManager.getAccount(sender))!.balance
    assert.equal(
      afterTxBalance,
      balance !== undefined ? balance - 1n : BigInt(0),
      `sender balance should be >= 0 after transaction with skipBalance`,
    )
    assert.equal(res.execResult.exceptionError, undefined, 'no exceptionError with skipBalance')
  }
})

it('Validate EXTCODEHASH puts KECCAK256_NULL on stack if calling account has no balance and zero nonce (but it did exist)', async () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
  const vm = await createVM({ common })

  const pkey = new Uint8Array(32).fill(1)

  // CALLER EXTCODEHASH PUSH 0 SSTORE STOP
  // Puts EXTCODEHASH of CALLER into slot 0
  const code = hexToBytes('0x333F60005500')
  const codeAddr = createAddressFromString('0x' + '20'.repeat(20))
  await vm.stateManager.putCode(codeAddr, code)

  const tx = createLegacyTx({
    gasLimit: 100000,
    gasPrice: 1,
    to: codeAddr,
  }).sign(pkey)

  const addr = createAddressFromPrivateKey(pkey)
  await vm.stateManager.putAccount(addr, new Account())
  const acc = await vm.stateManager.getAccount(addr)
  acc!.balance = BigInt(tx.gasLimit * tx.gasPrice)
  await vm.stateManager.putAccount(addr, acc!)
  await runTx(vm, { tx, skipHardForkValidation: true })

  const hash = await vm.stateManager.getStorage(codeAddr, new Uint8Array(32))
  assert.deepEqual(hash, KECCAK256_NULL, 'hash ok')
})

it('Validate CALL does not charge new account gas when calling CALLER and caller is non-empty', async () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
  const vm = await createVM({ common })

  const pkey = new Uint8Array(32).fill(1)

  // PUSH 0 DUP DUP DUP
  // CALLVALUE CALLER GAS
  // CALL
  // STOP

  // Calls CALLER and sends back the ETH just sent with the transaction
  const code = hexToBytes('0x600080808034335AF100')
  const codeAddr = createAddressFromString('0x' + '20'.repeat(20))
  await vm.stateManager.putCode(codeAddr, code)

  const tx = createLegacyTx({
    gasLimit: 100000,
    gasPrice: 1,
    value: 1,
    to: codeAddr,
  }).sign(pkey)

  const addr = createAddressFromPrivateKey(pkey)
  await vm.stateManager.putAccount(addr, new Account())
  const acc = await vm.stateManager.getAccount(addr)
  acc!.balance = BigInt(tx.gasLimit * tx.gasPrice + tx.value)
  await vm.stateManager.putAccount(addr, acc!)
  assert.equal(
    (await runTx(vm, { tx, skipHardForkValidation: true })).totalGasSpent,
    BigInt(27818),
    'did not charge callNewAccount',
  )
})

it('Validate SELFDESTRUCT does not charge new account gas when calling CALLER and caller is non-empty', async () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin })
  const vm = await createVM({ common })

  const pkey = new Uint8Array(32).fill(1)

  // CALLER EXTCODEHASH PUSH 0 SSTORE STOP
  // Puts EXTCODEHASH of CALLER into slot 0
  const code = hexToBytes('0x33FF')
  const codeAddr = createAddressFromString('0x' + '20'.repeat(20))
  await vm.stateManager.putCode(codeAddr, code)

  const tx = createLegacyTx({
    gasLimit: 100000,
    gasPrice: 1,
    value: 1,
    to: codeAddr,
  }).sign(pkey)

  const addr = createAddressFromPrivateKey(pkey)
  await vm.stateManager.putAccount(addr, new Account())
  const acc = await vm.stateManager.getAccount(addr)
  acc!.balance = BigInt(tx.gasLimit * tx.gasPrice + tx.value)
  await vm.stateManager.putAccount(addr, acc!)
  assert.equal(
    (await runTx(vm, { tx, skipHardForkValidation: true })).totalGasSpent,
    BigInt(13001),
    'did not charge callNewAccount',
  )
})

describe('EIP 4844 transaction tests', () => {
  const kzg = new microEthKZG(trustedSetup)
  it('should work', async () => {
    const { hardfork4844Data } = await import('../../../block/test/testdata/4844-hardfork.js')
    const common = createCommonFromGethGenesis(hardfork4844Data, {
      chain: 'customChain',
      hardfork: Hardfork.Cancun,
      customCrypto: { kzg },
    })

    common.setHardfork(Hardfork.Cancun)
    const oldGetBlockFunction = Blockchain.prototype.getBlock

    // Stub getBlock to produce a valid parent header under EIP 4844
    Blockchain.prototype.getBlock = async () => {
      return createBlock(
        {
          header: createBlockHeader(
            {
              excessBlobGas: 0n,
              number: 1,
              parentHash: blockchain.genesisBlock.hash(),
            },
            {
              common,
              skipConsensusFormatValidation: true,
            },
          ),
        },
        {
          common,
          skipConsensusFormatValidation: true,
        },
      )
    }
    const blockchain = await createBlockchain({
      validateBlocks: false,
      validateConsensus: false,
    })
    const vm = await createVM({ common, blockchain })

    const tx = getTransaction(common, 3, true) as Blob4844Tx

    const block = createBlock(
      {
        header: createBlockHeader(
          {
            excessBlobGas: 1n,
            number: 2,
            parentHash: (await blockchain.getBlock(1n)).hash(), // Faking parent hash with getBlock stub
          },
          {
            common,
            skipConsensusFormatValidation: true,
          },
        ),
      },
      { common, skipConsensusFormatValidation: true },
    )
    const res = await runTx(vm, { tx, block, skipBalance: true })
    assert.ok(res.execResult.exceptionError === undefined, 'simple blob tx run succeeds')
    assert.equal(res.blobGasUsed, 131072n, 'returns correct blob gas used for 1 blob')
    Blockchain.prototype.getBlock = oldGetBlockFunction
  })
})
