import { Block } from '@ethereumjs/block'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction, TransactionFactory } from '@ethereumjs/tx'
import { Address, bigIntToBuffer, setLengthLeft } from '@ethereumjs/util'
import { VM } from '@ethereumjs/vm'
import { BaseProvider, JsonRpcProvider, StaticJsonRpcProvider } from '@ethersproject/providers'
import * as tape from 'tape'

import { EthersStateManager } from '../src/ethersStateManager'

import { MockProvider } from './testdata/providerData/mockProvider'

// Hack to detect if running in browser or not
const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')

// To run the tests with a live provider, set the PROVIDER environmental variable with a valid provider url
// from Infura/Alchemy or your favorite web3 provider when running the test.  Below is an example command:
// `PROVIDER=https://mainnet.infura.io/v3/[mySuperS3cretproviderKey] npm run tape -- 'test/ethersStateManager.spec.ts'
tape('Ethers State Manager initialization tests', (t) => {
  const provider = new MockProvider()
  let state = new EthersStateManager({ provider, blockTag: 1n })
  t.ok(
    state instanceof EthersStateManager,
    'was able to instantiate state manager with JsonRpcProvider subclass'
  )
  t.equal((state as any).blockTag, '0x1', 'State manager starts with default block tag of 1')

  state = new EthersStateManager({ provider, blockTag: 1n })
  t.equal((state as any).blockTag, '0x1', 'State Manager instantiated with predefined blocktag')

  state = new EthersStateManager({ provider: 'http://localhost:8545', blockTag: 1n })
  t.ok(state instanceof EthersStateManager, 'was able to instantiate state manager with valid url')

  const invalidProvider = new BaseProvider('mainnet')
  t.throws(
    () => new EthersStateManager({ provider: invalidProvider as any, blockTag: 1n }),
    'cannot instantiate state manager with invalid provider'
  )
  t.end()
})

tape('Ethers State Manager API tests', async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const provider =
      process.env.PROVIDER !== undefined
        ? new StaticJsonRpcProvider(process.env.PROVIDER, 1)
        : new MockProvider()
    const state = new EthersStateManager({ provider, blockTag: 1n })
    const vitalikDotEth = Address.fromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const account = await state.getAccount(vitalikDotEth)
    t.ok(account.nonce > 0n, 'Vitalik.eth returned a valid nonce')

    await state.putAccount(vitalikDotEth, account)

    const retrievedVitalikAccount = (state as any)._cache.get(vitalikDotEth)

    t.ok(retrievedVitalikAccount.nonce > 0n, 'Vitalik.eth is stored in cache')
    const doesThisAccountExist = await state.accountExists(
      Address.fromString('0xccAfdD642118E5536024675e776d32413728DD07')
    )
    t.ok(!doesThisAccountExist, 'accountExists returns false for non-existent account')

    t.ok(state.accountExists(vitalikDotEth), 'vitalik.eth does exist')

    const UNIerc20ContractAddress = Address.fromString('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')
    const UNIContractCode = await state.getContractCode(UNIerc20ContractAddress)
    t.ok(UNIContractCode.length > 0, 'was able to retrieve UNI contract code')

    await state.putContractCode(UNIerc20ContractAddress, UNIContractCode)
    t.ok(
      typeof (state as any).contractCache.get(UNIerc20ContractAddress.toString()) !== 'undefined',
      'UNI ERC20 contract code was found in cache'
    )

    const storageSlot = await state.getContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(1n), 32)
    )
    t.ok(storageSlot.length > 0, 'was able to retrieve storage slot 1 for the UNI contract')

    await state.putContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(2n), 32),
      Buffer.from('abcd')
    )
    const slotValue = await state.getContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(2n), 32)
    )
    t.ok(slotValue.equals(Buffer.from('abcd')), 'should retrieve slot 2 value')

    // Verify that provider is not called for cached data
    ;(provider as any).getStorageAt = function () {
      throw new Error('should not be called!')
    }

    t.doesNotThrow(
      async () =>
        state.getContractStorage(UNIerc20ContractAddress, setLengthLeft(bigIntToBuffer(2n), 32)),
      'should not call provider.getStorageAt'
    )

    await state.putContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(2n), 32),
      Buffer.from('')
    )

    // Verify that provider is not called
    ;(state as any).getAccountFromProvider = function () {
      throw new Error('should not have called this!')
    }
    t.doesNotThrow(
      async () => state.getAccount(vitalikDotEth),
      'does not call getAccountFromProvider'
    )

    try {
      await state.getAccount(Address.fromString('0x9Cef824A8f4b3Dc6B7389933E52e47F010488Fc8'))
    } catch (err) {
      t.pass('calls getAccountFromProvider for non-cached account')
    }

    const deletedSlot = await state.getContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(2n), 32)
    )

    t.equal(deletedSlot.length, 0, 'deleted slot from storage cache')

    await state.putContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(3n), 32),
      Buffer.from('0xfeed')
    )
    const thirdSlot = await state.getContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(3n), 32)
    )

    t.equal(thirdSlot.length > 0, true, 'storage slot has a value')
    await state.putContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(3n), 32),
      Buffer.from('0x0000')
    )
    const _deletedSlot = await state.getContractStorage(
      UNIerc20ContractAddress,
      setLengthLeft(bigIntToBuffer(2n), 32)
    )

    t.equal(
      _deletedSlot.length,
      0,
      'putting buffer of zeros into slot deleted value from storage cache'
    )

    await state.deleteAccount(vitalikDotEth)
    t.ok(await state.accountExists(vitalikDotEth), 'account should not exist after being deleted')

    try {
      await Block.fromEthersProvider(provider, 'fakeBlockTag', {} as any)
      t.fail('should have thrown')
    } catch (err: any) {
      t.ok(
        err.message.includes('expected blockTag to be block hash, bigint, hex prefixed string'),
        'threw with correct error when invalid blockTag provided'
      )
    }

    const newState = state.copy()

    t.equal(
      undefined,
      (state as any).contractCache.get(UNIerc20ContractAddress),
      'should not have any code for contract after cache is cleared'
    )

    t.notEqual(
      undefined,
      (newState as any).contractCache.get(UNIerc20ContractAddress.toString()),
      'state manager copy should have code for contract after cache is cleared on original state manager'
    )

    t.equal((state as any).blockTag, '0x1', 'blockTag defaults to 1')
    state.setBlockTag(5n)
    t.equal((state as any).blockTag, '0x5', 'blockTag set to 0x5')
    state.setBlockTag('earliest')
    t.equal((state as any).blockTag, 'earliest', 'blockTag set to earliest')
    t.end()
  }
})

tape('runTx custom transaction test', async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const common = new Common({ chain: Chain.Mainnet })
    const provider =
      process.env.PROVIDER !== undefined
        ? new StaticJsonRpcProvider(process.env.PROVIDER, 1)
        : new MockProvider()
    const state = new EthersStateManager({ provider, blockTag: 1n })
    const vm = await VM.create({ common, stateManager: state })

    const vitalikDotEth = Address.fromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const privateKey = Buffer.from(
      'e331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109',
      'hex'
    )
    const tx = FeeMarketEIP1559Transaction.fromTxData(
      { to: vitalikDotEth, value: '0x100', gasLimit: 500000n, maxFeePerGas: 7 },
      { common }
    ).sign(privateKey)

    const result = await vm.runTx({
      skipBalance: true,
      skipNonce: true,
      tx,
    })

    t.equal(result.totalGasSpent, 21000n, 'sent some ETH to vitalik.eth')
    t.end()
  }
})

tape('runTx test: replay mainnet transactions', async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })

    const provider =
      process.env.PROVIDER !== undefined
        ? new JsonRpcProvider(process.env.PROVIDER)
        : new MockProvider()

    const blockTag = 15496077n
    common.setHardforkByBlockNumber(blockTag)
    const txHash = '0xed1960aa7d0d7b567c946d94331dddb37a1c67f51f30bf51f256ea40db88cfb0'
    const tx = await TransactionFactory.fromRPCTx(
      await provider.send('eth_getTransactionByHash', [txHash]),
      { common }
    )
    const state = new EthersStateManager({
      provider,
      // Set the state manager to look at the state of the chain before the block has been executed
      blockTag: blockTag - 1n,
    })
    const vm = await VM.create({ common, stateManager: state })
    const res = await vm.runTx({ tx })
    t.equal(res.totalGasSpent, 21000n, 'calculated correct total gas spent for simple transfer')
    t.end()
  }
})

tape('runBlock test', async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Chainstart })
    const provider =
      process.env.PROVIDER !== undefined
        ? new JsonRpcProvider(process.env.PROVIDER)
        : new MockProvider()
    const blockTag = 500000n
    const state = new EthersStateManager({
      provider,
      // Set the state manager to look at the state of the chain before the block has been executed
      blockTag: blockTag - 1n,
    })

    // Set the common to HF, doesn't impact this specific blockTag, but will impact much recent
    // blocks, also for post merge network, ttd should also be passed
    common.setHardforkByBlockNumber(blockTag - 1n)

    const vm = await VM.create({ common, stateManager: state })
    const block = Block.fromRPC(
      await provider.send('eth_getBlockByNumber', ['0x' + blockTag.toString(16)]),
      [],
      {
        common,
      }
    )
    try {
      const res = await vm.runBlock({
        block,
        generate: true,
        skipHeaderValidation: true,
      })
      t.equal(res.gasUsed, block.header.gasUsed, 'should compute correct cumulative gas for block')
    } catch (err: any) {
      t.fail(`should have successfully ran block; got error ${err.message}`)
    }
  }
})
