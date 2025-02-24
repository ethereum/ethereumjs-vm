import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { StatefulVerkleStateManager } from '@ethereumjs/statemanager'
import {
  bigIntToBytes,
  bytesToHex,
  createAccount,
  createAddressFromString,
  decodeVerkleLeafBasicData,
  getVerkleStem,
  hexToBytes,
  setLengthLeft,
} from '@ethereumjs/util'
import { createVerkleTree } from '@ethereumjs/verkle'
import * as verkle from 'micro-eth-signer/verkle'
import { assert, describe, it } from 'vitest'

import { VerkleAccessWitness, createEVM, generateExecutionWitness } from '../src/index.js'

describe('verkle tests', () => {
  it('should execute bytecode and update the state', async () => {
    // This tests executes some very simple bytecode that stores the value 1 in slot 2
    const common = new Common({
      chain: Mainnet,
      customCrypto: { verkle },
      eips: [6800],
      hardfork: Hardfork.Cancun,
    })
    const trie = await createVerkleTree()
    const sm = new StatefulVerkleStateManager({ common, trie })
    const address = createAddressFromString('0x9e5ef720fa2cdfa5291eb7e711cfd2e62196f4b3')
    const account = createAccount({ nonce: 3n, balance: 0xffffffffn })
    await sm.putAccount(address, account)
    const evm = await createEVM({ common, stateManager: sm })
    // Initialize verkleAccess Witness manually (in real context, it is done by the VM, but we are bypassing that here)
    evm.verkleAccessWitness = new VerkleAccessWitness({
      verkleCrypto: verkle,
    })
    const code = hexToBytes('0x6001600255') // PUSH1 01 PUSH1 02 SSTORE
    const res = await evm.runCall({
      code,
      caller: address,
      to: address,
    })
    assert.deepEqual(res.execResult.returnValue, new Uint8Array())
    const retrievedValue = await sm.getStorage(address, setLengthLeft(bigIntToBytes(2n), 32))
    assert.deepEqual(retrievedValue, setLengthLeft(bigIntToBytes(1n), 32))
  })

  it('should revert and access witness should not contain a write access due to OOG', async () => {
    // This tests executes some very simple bytecode that stores the value 1 in slot 2
    const common = new Common({
      chain: Mainnet,
      customCrypto: { verkle },
      eips: [6800],
      hardfork: Hardfork.Cancun,
    })
    const trie = await createVerkleTree()
    const sm = new StatefulVerkleStateManager({ common, trie })
    const address = createAddressFromString('0x9e5ef720fa2cdfa5291eb7e711cfd2e62196f4b3')
    const account = createAccount({ nonce: 3n, balance: 0xffffffffn })
    await sm.putAccount(address, account)
    const evm = await createEVM({ common, stateManager: sm })
    // Initialize verkleAccess Witness manually (in real context, it is done by the VM, but we are bypassing that here)
    evm.verkleAccessWitness = new VerkleAccessWitness({
      verkleCrypto: verkle,
    })
    const code = hexToBytes('0x6001600255') // PUSH1 01 PUSH1 02 SSTORE
    const res = await evm.runCall({
      code,
      caller: address,
      to: address,
      gasLimit: BigInt(5), // too little gas for bytecode
      gasPrice: BigInt(1),
    })
    const writtenChunks = Array.from(evm.verkleAccessWitness.chunks.entries()).filter(
      ([_, chunk]) => chunk.write !== undefined,
    )
    assert.ok(writtenChunks.length === 0)
    assert.equal(res.execResult.exceptionError?.type.code, 'out of gas')
  })

  it('access witness should contain a write access', async () => {
    // This tests executes some very simple bytecode that stores the value 1 in slot 2
    const common = new Common({
      chain: Mainnet,
      customCrypto: { verkle },
      eips: [6800],
      hardfork: Hardfork.Cancun,
    })
    const trie = await createVerkleTree()
    const sm = new StatefulVerkleStateManager({ common, trie })
    const address = createAddressFromString('0x9e5ef720fa2cdfa5291eb7e711cfd2e62196f4b3')
    const account = createAccount({ nonce: 3n, balance: 0xffffffffn })
    await sm.putAccount(address, account)
    const evm = await createEVM({ common, stateManager: sm })
    // Initialize verkleAccess Witness manually (in real context, it is done by the VM, but we are bypassing that here)
    evm.verkleAccessWitness = new VerkleAccessWitness({
      verkleCrypto: verkle,
    })
    const code = hexToBytes('0x6001600255') // PUSH1 01 PUSH1 02 SSTORE
    const res = await evm.runCall({
      code,
      caller: address,
      to: address,
      gasLimit: BigInt(21000), // sufficient gas for bytecode
      gasPrice: BigInt(1),
    })
    const writtenChunks = Array.from(evm.verkleAccessWitness.chunks.entries()).filter(
      ([_, chunk]) => chunk.write !== undefined,
    )
    assert.ok(writtenChunks.length === 1)
    assert.equal(res.execResult.exceptionError?.type.code, undefined)
  })
})
describe('generate an execution witness', () => {
  it('should generate the correct execution witness from a prestate and changes', async () => {
    const preStateVKT = {
      '0x0365b079a274a1808d56484ce5bd97914629907d75767f51439102e22cd50d00':
        '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
      '0x0365b079a274a1808d56484ce5bd97914629907d75767f51439102e22cd50d01':
        '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      '0x5b5fdfedd6a0e932da408ac7d772a36513d1eee9b9926e52620c43a433aad700':
        '0x0000000000000036000000000000000100000000000000000000000000000000',
      '0x5b5fdfedd6a0e932da408ac7d772a36513d1eee9b9926e52620c43a433aad701':
        '0xdf61faef43babbb1ebde8fd82ab9cb4cb74c240d0025138521477e073f72080a',
      '0x5b5fdfedd6a0e932da408ac7d772a36513d1eee9b9926e52620c43a433aad780':
        '0x0060203611603157600143035f35116029575f35612000014311602957612000',
      '0x5b5fdfedd6a0e932da408ac7d772a36513d1eee9b9926e52620c43a433aad781':
        '0x005f3506545f5260205ff35b5f5f5260205ff35b5f5ffd000000000000000000',
    }
    const tx = {
      type: '0x0',
      chainId: '0x1',
      nonce: '0x0',
      gasPrice: '0xa',
      gas: '0x5f5e100',
      to: '0x8a0a19589531694250d570040a0c4b74576919b8',
      value: '0x0',
      input: '0x',
      v: '0x25',
      r: '0x50ae258f0b1f7c44e5227b43c338aa7f2d9805115b90a6baeaaee2358796e074',
      s: '0xec910ad0244580c17e1d6a512b3574c62e92840184109e3037760d39b20cb94',
      sender: '0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b',
    }

    const common = new Common({
      chain: Mainnet,
      customCrypto: { verkle },
      eips: [6800],
      hardfork: Hardfork.Prague,
    })
    const trie = await createVerkleTree()
    // Setup prestate
    for (const [key, value] of Object.entries(preStateVKT)) {
      const stem = hexToBytes(key).slice(0, 31)
      const suffix = parseInt(key.slice(64), 16)
      await trie.put(stem, [suffix], [hexToBytes(value)])
    }
    const preStateRoot = trie.root()
    const sm = new StatefulVerkleStateManager({ common, trie })
    const evm = await createEVM({ common, stateManager: sm })
    evm.verkleAccessWitness = new VerkleAccessWitness({
      verkleCrypto: verkle,
    })
    evm.systemVerkleAccessWitness = new VerkleAccessWitness({
      verkleCrypto: verkle,
    })
    // Run tx
    await evm.runCall({
      code: hexToBytes(tx.input),
      caller: createAddressFromString(tx.sender),
      to: createAddressFromString(tx.to),
      gasLimit: BigInt(tx.gas),
      gasPrice: BigInt(tx.gasPrice),
    })
    const executionWitness = await generateExecutionWitness(
      sm,
      evm.verkleAccessWitness,
      preStateRoot,
    )
    const stem = bytesToHex(getVerkleStem(verkle, createAddressFromString(tx.sender)))
    assert.ok(executionWitness.stateDiff.findIndex((diff) => diff.stem === stem) !== -1)
    const stemDiff =
      executionWitness.stateDiff[executionWitness.stateDiff.findIndex((diff) => diff.stem === stem)]
    const suffixDiff = stemDiff.suffixDiffs.find((diff) => diff.suffix === 0)
    assert.ok(suffixDiff?.newValue !== undefined)
    // Ensure sender account nonce is 1 in execution witness
    assert.equal(decodeVerkleLeafBasicData(hexToBytes(suffixDiff!.newValue!)).nonce, 1n)
  })
})
