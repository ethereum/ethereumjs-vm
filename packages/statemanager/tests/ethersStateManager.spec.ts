import { normalizeTxParams } from '@ethereumjs/block/dist/from-rpc'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'
import { Address, bigIntToBuffer, bigIntToHex, bufferToHex, setLengthLeft } from '@ethereumjs/util'
import { VM } from '@ethereumjs/vm'
import { BaseProvider, CloudflareProvider, JsonRpcProvider } from '@ethersproject/providers'
import * as tape from 'tape'

import { EthersStateManager } from '../src/ethersStateManager'

import { MockProvider } from './testdata/providerData/mockProvider'

import type { Proof } from '../src'

// Hack to detect if running in browser or not
const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')

tape('Ethers State Manager initialization tests', (t) => {
  const provider = new MockProvider()
  let state = new EthersStateManager({ provider })
  t.ok(
    state instanceof EthersStateManager,
    'was able to instantiate state manager with JsonRpcProvider subclass'
  )
  t.equal(
    (state as any).blockTag,
    'latest',
    'State manager starts with default block tag of "latest"'
  )

  state = new EthersStateManager({ provider, blockTag: 1n })
  t.equal((state as any).blockTag, '0x1', 'State Manager instantiated with predefined blocktag')

  state = new EthersStateManager({ provider: 'http://localhost:8545' })
  t.ok(state instanceof EthersStateManager, 'was able to instantiate state manager with valid url')

  const invalidProvider = new BaseProvider('mainnet')
  t.throws(
    () => new EthersStateManager({ provider: invalidProvider as any }),
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
      process.env.PROVIDER !== undefined ? new CloudflareProvider() : new MockProvider()
    const state = new EthersStateManager({ provider })
    const vitalikDotEth = Address.fromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const account = await state.getAccount(vitalikDotEth)
    t.ok(account.nonce > 0n, 'Vitalik.eth returned a valid nonce')

    await state.putAccount(vitalikDotEth, account)

    t.ok(
      (state as any)._cache.get(vitalikDotEth).nonce > 0,
      'Vitalik.eth is stored in accountCache'
    )
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

    try {
      await state.getBlockFromProvider('fakeBlockTag', {} as any)
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

    t.equal((state as any).blockTag, 'latest', 'blockTag defaults to latest')
    state.setBlockTag(5n)
    t.equal((state as any).blockTag, '0x5', 'blockTag set to 0x5')
    state.setBlockTag('latest')
    t.equal((state as any).blockTag, 'latest', 'blockTag set back to latest')
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
      process.env.PROVIDER !== undefined ? new CloudflareProvider() : new MockProvider()
    const state = new EthersStateManager({ provider })
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
    const txData = await provider.send('eth_getTransactionByHash', [
      '0xed1960aa7d0d7b567c946d94331dddb37a1c67f51f30bf51f256ea40db88cfb0',
    ])

    const normedTx = normalizeTxParams(txData)
    const state = new EthersStateManager({
      provider,
      // Set the state manager to look at the state of the chain before the block has been executed
      blockTag: blockTag - 1n,
    })
    const vm = await VM.create({ common, stateManager: state })
    const tx = FeeMarketEIP1559Transaction.fromTxData(normedTx, { common })
    const res = await vm.runTx({ tx })
    t.equal(res.totalGasSpent, 21000n, 'calculated correct total gas spent for simple transfer')
    t.end()
  }
})

/** To run the block test with an actual provider, you will need a provider URL (like alchemy or infura) that provides access to an archive node.
 *  Pass it in the PROVIDER=[provider url] npm run tape -- 'tests/ethersStateManager.spec.ts'
 *  Note: Cloudflare only provides access to the last 128 blocks on these tests so will fail on these tests.
 */

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
    const previousStateRoot = Buffer.from(
      (
        await provider.send('eth_getBlockByNumber', [bigIntToHex(blockTag - 1n), true])
      ).stateRoot.slice(2),
      'hex'
    )

    const block = await state.getBlockFromProvider(blockTag, common)
    try {
      const res = await vm.runBlock({
        block,
        root: previousStateRoot,
        generate: true,
        skipHeaderValidation: true,
      })

      t.equal(
        bufferToHex(res.stateRoot),
        bufferToHex(block.header.stateRoot),
        'was able to run block and computed correct state root'
      )
    } catch (err: any) {
      t.fail(`should have successfully ran block; got error ${err.message}`)
    }

    const proof = (await provider.send('eth_getProof', [
      block.header.coinbase.toString(),
      [],
      bigIntToHex(block.header.number),
    ])) as Proof
    const localproof = await state.getProof(block.header.coinbase)

    for (let j = 0; j < proof.accountProof.length; j++) {
      t.deepEqual(
        localproof.accountProof[j],
        proof.accountProof[j],
        'proof nodes for account match proof from provider'
      )
    }
    t.end()
  }
})
