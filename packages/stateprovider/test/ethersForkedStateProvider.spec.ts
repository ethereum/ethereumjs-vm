import { Transaction } from '@ethereumjs/tx'
import {
  Account,
  Address,
  bigIntToBuffer,
  bufferToHex,
  setLengthLeft,
  toBuffer,
} from '@ethereumjs/util'
import { BaseProvider, StaticJsonRpcProvider } from '@ethersproject/providers'
import { ethers } from 'ethers'
import * as tape from 'tape'

import { EthersForkedStateProvider } from '../src/ethersForkedStateProvider'

import { MockProvider } from './testdata/providerData/mockProvider'
import * as ropsten_contractWithStorage from './testdata/ropsten_contractWithStorage.json'

import type { EthersStateManager } from '@ethereumjs/statemanager'

// Hack to detect if running in browser or not
const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')

// To run the tests with a live provider, set the PROVIDER environmental variable with a valid provider url
// from Infura/Alchemy or your favorite web3 provider when running the test.  Below is an example command:
// `PROVIDER=https://mainnet.infura.io/v3/[mySuperS3cretproviderKey] npm run tape -- 'test/ethersStateManager.spec.ts'
tape('Ethers State Manager initialization tests', (t) => {
  const provider = new MockProvider()
  const state = new EthersForkedStateProvider(provider)
  t.ok(
    state instanceof EthersForkedStateProvider,
    'should instantiate with JsonRpcProvider subclass'
  )
  t.equal(
    (state as any).ethersStateManager.blockTag,
    '0x1',
    'should instantiate with ethersStateManager'
  )

  const _state = new EthersForkedStateProvider('http://localhost:8545')
  t.ok(_state instanceof EthersForkedStateProvider, 'should instantiate with valid url')

  const invalidProvider = new BaseProvider('mainnet')
  try {
    new EthersForkedStateProvider(invalidProvider as any)
    t.fail('should not instantiate with invalid provider')
  } catch (err) {
    t.equal(
      (err as any).message.slice(0, 37),
      'valid JsonRpcProvider or url required',
      'should not instantiate with invalid provider'
    )
  }

  t.test('getCode', async (st) => {
    const address = new Address(Buffer.from('a94f5374fce5edbc8e2a8697c15331677e6ebf0b', 'hex'))
    const code = Buffer.from(
      '73095e7baea6a6c7c4c2dfeb977efac326af552d873173095e7baea6a6c7c4c2dfeb977efac326af552d873157',
      'hex'
    )
    const raw = {
      nonce: '0x0',
      balance: '0x03e7',
      stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      codeHash: '0xb30fb32201fe0486606ad451e1a61e2ae1748343cd3d411ed992ffcc0774edd4',
    }
    const account = Account.fromAccountData(raw)
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(address, account)
    await ((state as any).ethersStateManager as EthersStateManager).putContractCode(address, code)
    const codeRetrieved = await state.getCode('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b')
    st.deepEqual(codeRetrieved, bufferToHex(code))
    st.end()
  })

  t.test('getCode', async (st) => {
    const codeRetrieved = await state.getCode(ropsten_contractWithStorage.address)
    const code = ropsten_contractWithStorage.codeHash
    st.deepEqual(codeRetrieved, code)
    st.end()
  })
  t.test('getStorageAt', async (st) => {
    const retrievedSlot0 = await state.getStorageAt(ropsten_contractWithStorage.address, 0n)
    const slot0 = ropsten_contractWithStorage.storageProof[0].value
    st.equal(retrievedSlot0, slot0, 'should retrieve storage value at slot 0')
    const retrievedSlot1 = await state.getStorageAt(ropsten_contractWithStorage.address, 1n)
    const slot1 = ropsten_contractWithStorage.storageProof[1].value
    st.equal(
      retrievedSlot1,
      bufferToHex(toBuffer(slot1)),
      'should retrieve storage value at slot 1'
    )
    st.end()
  })
  t.end()
})

tape('getCode / getStorageAt', async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const provider =
      process.env.PROVIDER !== undefined
        ? new StaticJsonRpcProvider(process.env.PROVIDER, 1)
        : new MockProvider()
    const state = new EthersForkedStateProvider(provider)
    const contract_str = '0x2d80502854fc7304c3e3457084de549f5016b73f'
    const contractAddress = Address.fromString(contract_str)
    const contractCode = ropsten_contractWithStorage.codeHash

    await ((state as any).ethersStateManager as EthersStateManager).putContractCode(
      contractAddress,
      toBuffer(contractCode)
    )
    const retrievedCode = await state.getCode(contractAddress.toString())
    t.equal(retrievedCode, contractCode, 'was able to retrieve contract code')

    const slotValue = await state.getStorageAt(contract_str, setLengthLeft(bigIntToBuffer(0n), 32))
    t.deepEqual(slotValue, '0x1e4ebdd7', 'should retrieve slot 0 value')
    await ((state as any).ethersStateManager as EthersStateManager).putContractStorage(
      contractAddress,
      setLengthLeft(bigIntToBuffer(0n), 32),
      Buffer.from('')
    )

    const deletedSlot = await state.getStorageAt(
      contract_str,
      setLengthLeft(bigIntToBuffer(0n), 32)
    )

    t.equal(deletedSlot, '0x', 'should return empty buffer for deleted slot')
    t.end()
  }
})

tape(`getTransactionCount / getBalance`, async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const provider =
      process.env.PROVIDER !== undefined
        ? new StaticJsonRpcProvider(process.env.PROVIDER, 1)
        : new MockProvider()
    const state = new EthersForkedStateProvider(provider)

    const address = Address.fromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const account = await ((state as any).ethersStateManager as EthersStateManager).getAccount(
      address
    )
    const nonce = account.nonce
    const balance = account.balance
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(address, account)

    const bal = await state.getBalance(address.toString())
    t.equal(bal.toBigInt(), balance, 'should return the correct balance')

    const count = await state.getTransactionCount(address.toString())
    t.equal(BigInt(count), nonce, `should return the correct nonce ${nonce}`)
    await ((state as any).ethersStateManager as EthersStateManager).modifyAccountFields(address, {
      nonce: nonce + 1n,
      balance: 999999n,
    })
    const _count = await state.getTransactionCount(address.toString())
    t.equal(BigInt(_count), nonce + 1n, `should return correct nonce (${nonce + 1n})`)
    const _bal = await state.getBalance(address.toString())
    t.equal(_bal.toBigInt(), 999999n, 'should return the correct balance')
    t.end()
  }
})
tape(`sendTransaction / getTransactionCount / getBalance`, async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const provider =
      process.env.PROVIDER !== undefined
        ? new StaticJsonRpcProvider(process.env.PROVIDER, 1)
        : new MockProvider()
    const state = new EthersForkedStateProvider(provider)
    const A = {
      address: new Address(Buffer.from('0b90087d864e82a284dca15923f3776de6bb016f', 'hex')),
      privateKey: Buffer.from(
        '64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993',
        'hex'
      ),
    }

    const B = {
      address: new Address(Buffer.from('6f62d8382bf2587361db73ceca28be91b2acb6df', 'hex')),
      privateKey: Buffer.from(
        '2a6e9ad5a6a8e4f17149b8bc7128bf090566a11dbd63c30e5a0ee9f161309cd6',
        'hex'
      ),
    }

    const acc = new Account()
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(A.address, acc)
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(B.address, acc)

    const accountA = await ((state as any).ethersStateManager as EthersStateManager).getAccount(
      A.address
    )

    const accountB = await ((state as any).ethersStateManager as EthersStateManager).getAccount(
      B.address
    )

    const startingBal = 1000000000000n

    accountA.balance = startingBal
    accountB.balance = startingBal

    accountA.nonce = 0n
    accountB.nonce = 0n

    await ((state as any).ethersStateManager as EthersStateManager).putAccount(A.address, accountB)
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(B.address, accountB)

    const balA = await state.getBalance(A.address.toString())
    t.equal(balA.toBigInt(), startingBal, 'should return the correct original balance')
    const balB = await state.getBalance(B.address.toString())
    t.equal(balB.toBigInt(), startingBal, 'should return the correct original balance')
    const countA = await state.getTransactionCount(A.address.toString())
    t.equal(countA, 0, `should return the correct nonce`)

    const txValue = 500000n

    const txData = {
      nonce: 0n,
      gasPrice: 10n,
      gasLimit: 100000n,
      to: B.address,
      value: txValue,
    }
    const tx = Transaction.fromTxData(txData)
    const signedTx = tx.sign(A.privateKey)
    const gas = 210000n
    await state.sendTransaction(bufferToHex(signedTx.serialize()))
    const newBalA = await state.getBalance(A.address.toString())
    const expectedNewBalA = startingBal - txValue - gas
    t.equal(newBalA.toBigInt(), expectedNewBalA, 'should return the correct balance')
    const newBalB = await state.getBalance(B.address.toString())
    t.equal(newBalB.toBigInt(), startingBal + txValue, 'should return the correct balance')

    const newCountA = await state.getTransactionCount(A.address.toString())
    t.equal(newCountA, 1, `should return the correct nonce`)

    t.end()
  }
})

tape(`sendTransaction (contract)`, async (t) => {
  if (isBrowser() === true) {
    // The `MockProvider` is not able to load JSON files dynamically in browser so skipped in browser tests
    t.end()
  } else {
    const provider = new MockProvider()
    const state = new EthersForkedStateProvider(provider)
    const A = {
      address: new Address(Buffer.from('0b90087d864e82a284dca15923f3776de6bb016f', 'hex')),
      privateKey: Buffer.from(
        '64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993',
        'hex'
      ),
    }

    const acc = new Account()
    acc.balance = 1000000000000000n
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(A.address, acc)

    // sample contract from https://ethereum.stackexchange.com/a/70791
    const contract_data =
      '0x608060405234801561001057600080fd5b506040516020806100ef8339810180604052602081101561003057600080fd5b810190808051906020019092919050505080600081905550506098806100576000396000f3fe6080604052600436106039576000357c010000000000000000000000000000000000000000000000000000000090048063a2a9679914603e575b600080fd5b348015604957600080fd5b5060506066565b6040518082815260200191505060405180910390f35b6000548156fea165627a7a72305820fe2ba3506418c87a075f8f3ae19bc636bd4c18ebde0644bcb45199379603a72c00290000000000000000000000000000000000000000000000000000000000000064'
    const contract_code =
      '0x6080604052600436106039576000357c010000000000000000000000000000000000000000000000000000000090048063a2a9679914603e575b600080fd5b348015604957600080fd5b5060506066565b6040518082815260200191505060405180910390f35b6000548156fea165627a7a72305820fe2ba3506418c87a075f8f3ae19bc636bd4c18ebde0644bcb45199379603a72c0029'

    const gasLimit = 2000000
    const contract_tx = Transaction.fromTxData(
      { gasLimit, data: contract_data, gasPrice: 100, nonce: 0 },
      { freeze: false }
    )
    const signedC_tx = contract_tx.sign(A.privateKey)
    const expectedContractAddress = Address.generate(A.address, BigInt(0))
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(
      expectedContractAddress,
      acc
    )
    t.equal(
      await state.getCode(expectedContractAddress.toString()),
      '0x00',
      'contract code should be empty before deploy'
    )
    await state.sendTransaction(bufferToHex(signedC_tx.serialize()))
    t.equal(
      await state.getCode(expectedContractAddress.toString()),
      contract_code,
      'Transaction should deploy contract code'
    )

    const storage = ethers.ContractFactory.fromSolidity(
      await import('./testdata/providerData/simpleStorage.json')
    )

    const nextExpectedAddress = Address.generate(A.address, 2n)
    await ((state as any).ethersStateManager as EthersStateManager).putAccount(
      nextExpectedAddress,
      acc
    )
    const signer = state.getSigner(A.address.toString())
    signer.signTransaction = async (transaction) => {
      const signed = Transaction.fromTxData({
        data: (await transaction.data) as any,
        gasLimit: 210000n,
        gasPrice: 10n,
        nonce: await state.getTransactionCount(A.address.toString()),
        value: (await transaction.value)?.toString(),
        to: (await transaction.to)?.toString(),
      }).sign(A.privateKey)
      return bufferToHex(signed.serialize())
    }
    signer.sendTransaction = async (transaction) => {
      return state.sendTransaction(signer.signTransaction(transaction))
    }
    const contractFactory = storage.connect(signer)
    const contract = await contractFactory.deploy()
    const _deploy = Transaction.fromTxData({
      gasLimit,
      gasPrice: 10,
      nonce: 2,
      data: contract.deployTransaction.data,
    })
    const signed_deploy = _deploy.sign(A.privateKey)
    await state.sendTransaction(bufferToHex(signed_deploy.serialize()))
    t.equal(
      await state.getCode(nextExpectedAddress.toString()),
      '0x608060405234801561001057600080fd5b50600436106100365760003560e01c80632e64cec11461003b5780636057361d14610059575b600080fd5b610043610075565b60405161005091906100d9565b60405180910390f35b610073600480360381019061006e919061009d565b61007e565b005b60008054905090565b8060008190555050565b60008135905061009781610103565b92915050565b6000602082840312156100b3576100b26100fe565b5b60006100c184828501610088565b91505092915050565b6100d3816100f4565b82525050565b60006020820190506100ee60008301846100ca565b92915050565b6000819050919050565b600080fd5b61010c816100f4565b811461011757600080fd5b5056fea26469706673582212209a159a4f3847890f10bfb87871a61eba91c5dbf5ee3cf6398207e292eee22a1664736f6c63430008070033',
      'bytecode added'
    )
    const storageTxData = contract.interface.encodeFunctionData('store', [
      setLengthLeft(bigIntToBuffer(432n), 32),
    ])
    const storage_tx = Transaction.fromTxData({
      gasLimit,
      data: toBuffer(storageTxData),
      gasPrice: 10,
      nonce: 3,
      to: nextExpectedAddress,
    })
    const signed_S_tx = storage_tx.sign(A.privateKey)
    await state.sendTransaction(bufferToHex(signed_S_tx.serialize()))
    const stor = await state.getStorageAt(nextExpectedAddress.toString(), 1)
    t.equal(stor, '0x01b0', 'should return stored uint256')
    t.end()
  }
})
