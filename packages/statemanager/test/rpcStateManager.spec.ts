import { createBlockFromJSONRPCProvider, createBlockFromRPC } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { type EVMRunCallOpts, createEVM } from '@ethereumjs/evm'
import { verifyMPTProof } from '@ethereumjs/trie'
import { createFeeMarket1559Tx, createTxFromRPC } from '@ethereumjs/tx'
import {
  Address,
  bigIntToBytes,
  bytesToHex,
  bytesToUnprefixedHex,
  createAccountFromRLP,
  createAddressFromString,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
  utf8ToBytes,
} from '@ethereumjs/util'
import { createVM, runBlock, runTx } from '@ethereumjs/vm'
import { assert, describe, expect, it, vi } from 'vitest'

import { MerkleStateManager } from '../src/merkleStateManager.js'
import { getRPCStateProof } from '../src/proofs/index.js'
import { RPCBlockChain, RPCStateManager } from '../src/rpcStateManager.js'

import { block as blockData } from './testdata/providerData/blocks/block0x7a120.js'
import { getValues } from './testdata/providerData/mockProvider.js'
import { tx as txData } from './testdata/providerData/transactions/0xed1960aa7d0d7b567c946d94331dddb37a1c67f51f30bf51f256ea40db88cfb0.js'

import type { EVMMockBlockchainInterface } from '@ethereumjs/evm'

const provider = process.env.PROVIDER ?? 'http://cheese'
// To run the tests with a live provider, set the PROVIDER environmental variable with a valid provider url
// from Infura/Alchemy or your favorite web3 provider when running the test.  Below is an example command:
// `PROVIDER=https://mainnet.infura.io/v3/[mySuperS3cretproviderKey] npx vitest run test/rpcStateManager.spec.ts

describe('RPC State Manager initialization tests', async () => {
  vi.mock('@ethereumjs/util', async () => {
    const util = await vi.importActual('@ethereumjs/util')
    return {
      ...util,
      fetchFromProvider: vi.fn().mockImplementation(async (url, { method, params }: any) => {
        const res = await getValues(method, 1, params)
        return res.result
      }),
    }
  })
  await import('@ethereumjs/util')

  it('should work', () => {
    let state = new RPCStateManager({ provider, blockTag: 1n })
    assert.ok(state instanceof RPCStateManager, 'was able to instantiate state manager')
    assert.equal(state['_blockTag'], '0x1', 'State manager starts with default block tag of 1')

    state = new RPCStateManager({ provider, blockTag: 1n })
    assert.equal(state['_blockTag'], '0x1', 'State Manager instantiated with predefined blocktag')

    state = new RPCStateManager({ provider: 'https://google.com', blockTag: 1n })
    assert.ok(
      state instanceof RPCStateManager,
      'was able to instantiate state manager with valid url',
    )

    const invalidProvider = 'google.com'
    assert.throws(
      () => new RPCStateManager({ provider: invalidProvider as any, blockTag: 1n }),
      undefined,
      undefined,
      'cannot instantiate state manager with invalid provider',
    )
  })
})

describe('RPC State Manager API tests', () => {
  it('should work', async () => {
    const state = new RPCStateManager({ provider, blockTag: 1n })
    const vitalikDotEth = createAddressFromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const account = await state.getAccount(vitalikDotEth)

    assert.ok(account!.nonce > 0n, 'Vitalik.eth returned a valid nonce')

    await state.putAccount(vitalikDotEth, account!)

    const retrievedVitalikAccount = createAccountFromRLP(
      state['_caches'].account?.get(vitalikDotEth)?.accountRLP!,
    )

    assert.ok(retrievedVitalikAccount.nonce > 0n, 'Vitalik.eth is stored in cache')
    const address = createAddressFromString('0xccAfdD642118E5536024675e776d32413728DD07')
    const proof = await getRPCStateProof(state, address)
    const proofBuf = proof.accountProof.map((proofNode) => hexToBytes(proofNode))
    const doesThisAccountExist = await verifyMPTProof(address.bytes, proofBuf, {
      useKeyHashing: true,
    })
    assert.ok(!doesThisAccountExist, 'getAccount returns undefined for non-existent account')

    assert.ok(state.getAccount(vitalikDotEth) !== undefined, 'vitalik.eth does exist')

    const UniswapERC20ContractAddress = createAddressFromString(
      '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    )
    const UNIContractCode = await state.getCode(UniswapERC20ContractAddress)
    assert.ok(UNIContractCode.length > 0, 'was able to retrieve UNI contract code')

    await state.putCode(UniswapERC20ContractAddress, UNIContractCode)
    assert.ok(
      state['_caches'].code?.get(UniswapERC20ContractAddress) !== undefined,
      'UNI ERC20 contract code was found in cache',
    )

    const storageSlot = await state.getStorage(
      UniswapERC20ContractAddress,
      setLengthLeft(bigIntToBytes(1n), 32),
    )
    assert.ok(storageSlot.length > 0, 'was able to retrieve storage slot 1 for the UNI contract')

    await expect(async () => {
      await state.getStorage(UniswapERC20ContractAddress, setLengthLeft(bigIntToBytes(1n), 31))
    }).rejects.toThrowError('Storage key must be 32 bytes long')

    await state.putStorage(
      UniswapERC20ContractAddress,
      setLengthLeft(bigIntToBytes(2n), 32),
      utf8ToBytes('abcd'),
    )
    const slotValue = await state.getStorage(
      UniswapERC20ContractAddress,
      setLengthLeft(bigIntToBytes(2n), 32),
    )
    assert.ok(equalsBytes(slotValue, utf8ToBytes('abcd')), 'should retrieve slot 2 value')

    const dumpedStorage = await state.dumpStorage(UniswapERC20ContractAddress)
    assert.deepEqual(dumpedStorage, {
      [bytesToUnprefixedHex(setLengthLeft(bigIntToBytes(1n), 32))]: '0xabcd',
      [bytesToUnprefixedHex(setLengthLeft(bigIntToBytes(2n), 32))]: bytesToHex(utf8ToBytes('abcd')),
    })

    const spy = vi.spyOn(state, 'getAccountFromProvider')
    spy.mockImplementation(() => {
      throw new Error("shouldn't call me")
    })

    await state.checkpoint()

    await state.putStorage(
      UniswapERC20ContractAddress,
      setLengthLeft(bigIntToBytes(2n), 32),
      new Uint8Array(0),
    )

    await state.modifyAccountFields(vitalikDotEth, { nonce: 39n })
    assert.equal(
      (await state.getAccount(vitalikDotEth))?.nonce,
      39n,
      'modified account fields successfully',
    )

    assert.doesNotThrow(
      async () => state.getAccount(vitalikDotEth),
      'does not call getAccountFromProvider',
    )

    try {
      await state.getAccount(createAddressFromString('0x9Cef824A8f4b3Dc6B7389933E52e47F010488Fc8'))
    } catch (err) {
      assert.ok(true, 'calls getAccountFromProvider for non-cached account')
    }

    const deletedSlot = await state.getStorage(
      UniswapERC20ContractAddress,
      setLengthLeft(bigIntToBytes(2n), 32),
    )

    assert.equal(deletedSlot.length, 0, 'deleted slot from storage cache')

    await state.deleteAccount(vitalikDotEth)
    assert.ok(
      (await state.getAccount(vitalikDotEth)) === undefined,
      'account should not exist after being deleted',
    )

    await state.revert()
    assert.ok(
      (await state.getAccount(vitalikDotEth)) !== undefined,
      'account deleted since last checkpoint should exist after revert called',
    )

    const deletedSlotAfterRevert = await state.getStorage(
      UniswapERC20ContractAddress,
      setLengthLeft(bigIntToBytes(2n), 32),
    )

    assert.equal(
      deletedSlotAfterRevert.length,
      4,
      'slot deleted since last checkpoint should exist in storage cache after revert',
    )

    const cacheStorage = await state.dumpStorage(UniswapERC20ContractAddress)
    assert.equal(
      2,
      Object.keys(cacheStorage).length,
      'should have 2 storage slots in cache before clear',
    )
    await state.clearStorage(UniswapERC20ContractAddress)
    const clearedStorage = await state.dumpStorage(UniswapERC20ContractAddress)
    assert.deepEqual({}, clearedStorage, 'storage cache should be empty after clear')

    try {
      await createBlockFromJSONRPCProvider(provider, 'fakeBlockTag', {} as any)
      assert.fail('should have thrown')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('expected blockTag to be block hash, bigint, hex prefixed string'),
        'threw with correct error when invalid blockTag provided',
      )
    }

    assert.equal(
      state['_caches'].account?.get(UniswapERC20ContractAddress),
      undefined,
      'should not have any code for contract after cache is reverted',
    )

    assert.equal(state['_blockTag'], '0x1', 'blockTag defaults to 1')
    state.setBlockTag(5n)
    assert.equal(state['_blockTag'], '0x5', 'blockTag set to 0x5')
    state.setBlockTag('earliest')
    assert.equal(state['_blockTag'], 'earliest', 'blockTag set to earliest')

    await state.checkpoint()
  })
})

describe('runTx custom transaction test', () => {
  it('should work', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })

    const state = new RPCStateManager({ provider, blockTag: 1n })
    const vm = await createVM({ common, stateManager: <any>state }) // TODO fix the type MerkleStateManager back to StateManagerInterface in VM

    const vitalikDotEth = createAddressFromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const privateKey = hexToBytes(
      '0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109',
    )
    const tx = createFeeMarket1559Tx(
      { to: vitalikDotEth, value: '0x100', gasLimit: 500000n, maxFeePerGas: 7 },
      { common },
    ).sign(privateKey)

    const result = await runTx(vm, {
      skipBalance: true,
      skipNonce: true,
      tx,
    })

    assert.equal(result.totalGasSpent, 21000n, 'sent some ETH to vitalik.eth')
  })
})

describe('runTx test: replay mainnet transactions', () => {
  it('should work', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })

    const blockTag = 15496077n
    common.setHardforkBy({ blockNumber: blockTag })
    const tx = await createTxFromRPC(txData as any, { common })
    const state = new RPCStateManager({
      provider,
      // Set the state manager to look at the state of the chain before the block has been executed
      blockTag: blockTag - 1n,
    })
    const vm = await createVM({ common, stateManager: state })
    const res = await runTx(vm, { tx })
    assert.equal(
      res.totalGasSpent,
      21000n,
      'calculated correct total gas spent for simple transfer',
    )
  })
})

describe('runBlock test', () => {
  it('should work', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })

    const blockTag = 500000n
    const state = new RPCStateManager({
      provider,
      // Set the state manager to look at the state of the chain before the block has been executed
      blockTag: blockTag - 1n,
    })

    // Set the common to HF, doesn't impact this specific blockTag, but will impact much recent
    // blocks, also for post merge network, ttd should also be passed
    common.setHardforkBy({ blockNumber: blockTag - 1n })

    const vm = await createVM({ common, stateManager: state })
    const block = createBlockFromRPC(blockData, [], { common })
    try {
      const res = await runBlock(vm, {
        block,
        generate: true,
        skipHeaderValidation: true,
      })
      assert.equal(
        res.gasUsed,
        block.header.gasUsed,
        'should compute correct cumulative gas for block',
      )
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.fail(`should have successfully ran block; got error ${err.message}`)
    }
  })
})

describe('blockchain', () =>
  it('uses blockhash', async () => {
    const blockchain = new RPCBlockChain(provider) as unknown as EVMMockBlockchainInterface
    const blockTag = 1n
    const state = new RPCStateManager({ provider, blockTag })
    const evm = await createEVM({ blockchain, stateManager: state })
    // Bytecode for returning the blockhash of the block previous to `blockTag`
    const code = '0x600143034060005260206000F3'
    const contractAddress = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))

    const caller = createAddressFromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    await evm.stateManager.setStateRoot(
      hexToBytes('0xf8506f559699a58a4724df4fcf2ad4fd242d20324db541823f128f5974feb6c7'),
    )
    const block = await createBlockFromJSONRPCProvider(provider, 500000n, { setHardfork: true })
    await evm.stateManager.putCode(contractAddress, hexToBytes(code))
    const runCallArgs: Partial<EVMRunCallOpts> = {
      caller,
      gasLimit: BigInt(0xffffffffff),
      to: contractAddress,
      block,
    }
    const res = await evm.runCall(runCallArgs)
    assert.ok(
      bytesToHex(res.execResult.returnValue),
      '0xd5ba853bc7151fc044b9d273a57e3f9ed35e66e0248ab4a571445650cc4fcaa6',
    )
  }))

describe('Should return same value as MerkleStateManager when account does not exist', () => {
  it('should work', async () => {
    const rpcState = new RPCStateManager({ provider, blockTag: 1n })
    const defaultState = new MerkleStateManager()

    const account0 = await rpcState.getAccount(new Address(hexToBytes(`0x${'01'.repeat(20)}`)))
    const account1 = await defaultState.getAccount(new Address(hexToBytes(`0x${'01'.repeat(20)}`)))
    assert.equal(
      account0,
      account1,
      'Should return same value as MerkleStateManager when account does not exist',
    )
  })
})
