import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import {
  Address,
  concatBytes,
  createAddressFromString,
  equalsBytes,
  hexToBytes,
  privateToAddress,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createEVM } from '../../src/index.js'

const pkey = hexToBytes(`0x${'20'.repeat(32)}`)
const sender = new Address(privateToAddress(pkey))

describe('EIP 3860 tests', () => {
  it('code exceeds max initcode size', async () => {
    const common = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [3860],
    })
    const evm = await createEVM({
      common,
    })

    const buffer = new Uint8Array(1000000).fill(0x60)

    // setup the call arguments
    const runCallArgs = {
      sender, // call address
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
      // Simple test, PUSH <big number> PUSH 0 RETURN
      // It tries to deploy a contract too large, where the code is all zeros
      // (since memory which is not allocated/resized to yet is always defaulted to 0)
      data: concatBytes(
        hexToBytes(
          '0x7F6000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060005260206000F3',
        ),
        buffer,
      ),
    }
    const result = await evm.runCall(runCallArgs)
    assert.ok(
      result.execResult.exceptionError?.type.code === 'initcode exceeds max initcode size',
      'initcode exceeds max size',
    )
  })

  it('ensure EIP-3860 gas is applied on CREATE calls', async () => {
    // Transaction/Contract data taken from https://github.com/ethereum/tests/pull/990
    const commonWith3860 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [3860],
    })
    const commonWithout3860 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [],
    })
    const caller = createAddressFromString('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b')
    const evm = await createEVM({
      common: commonWith3860,
    })
    const evmWithout3860 = await createEVM({
      common: commonWithout3860,
    })
    const contractFactory = createAddressFromString('0xb94f5374fce5edbc8e2a8697c15331677e6ebf0b')
    const contractAccount = await evm.stateManager.getAccount(contractFactory)
    await evm.stateManager.putAccount(contractFactory, contractAccount!)
    await evmWithout3860.stateManager.putAccount(contractFactory, contractAccount!)
    const factoryCode = hexToBytes(
      '0x7f600a80600080396000f3000000000000000000000000000000000000000000006000526000355a8160006000f05a8203600a55806000556001600155505050',
    )

    await evm.stateManager.putCode(contractFactory, factoryCode)
    await evmWithout3860.stateManager.putCode(contractFactory, factoryCode)
    const data = hexToBytes('0x000000000000000000000000000000000000000000000000000000000000c000')
    const runCallArgs = {
      from: caller,
      to: contractFactory,
      data,
      gasLimit: BigInt(0xfffffffff),
    }
    const res = await evm.runCall(runCallArgs)
    const res2 = await evmWithout3860.runCall(runCallArgs)
    assert.ok(
      res.execResult.executionGasUsed > res2.execResult.executionGasUsed,
      'execution gas used is higher with EIP 3860 active',
    )
  })

  it('ensure EIP-3860 gas is applied on CREATE2 calls', async () => {
    // Transaction/Contract data taken from https://github.com/ethereum/tests/pull/990
    const commonWith3860 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [3860],
    })
    const commonWithout3860 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [],
    })
    const caller = createAddressFromString('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b')
    const evm = await createEVM({
      common: commonWith3860,
    })
    const evmWithout3860 = await createEVM({
      common: commonWithout3860,
    })
    const contractFactory = createAddressFromString('0xb94f5374fce5edbc8e2a8697c15331677e6ebf0b')
    const contractAccount = await evm.stateManager.getAccount(contractFactory)
    await evm.stateManager.putAccount(contractFactory, contractAccount!)
    await evmWithout3860.stateManager.putAccount(contractFactory, contractAccount!)
    const factoryCode = hexToBytes(
      '0x7f600a80600080396000f3000000000000000000000000000000000000000000006000526000355a60008260006000f55a8203600a55806000556001600155505050',
    )

    await evm.stateManager.putCode(contractFactory, factoryCode)
    await evmWithout3860.stateManager.putCode(contractFactory, factoryCode)
    const data = hexToBytes('0x000000000000000000000000000000000000000000000000000000000000c000')
    const runCallArgs = {
      from: caller,
      to: contractFactory,
      data,
      gasLimit: BigInt(0xfffffffff),
    }
    const res = await evm.runCall(runCallArgs)
    const res2 = await evmWithout3860.runCall(runCallArgs)
    assert.ok(
      res.execResult.executionGasUsed > res2.execResult.executionGasUsed,
      'execution gas used is higher with EIP 3860 active',
    )
  })

  it('code exceeds max initcode size: allowUnlimitedInitCodeSize active', async () => {
    const common = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [3860],
    })
    const evm = await createEVM({
      common,
      allowUnlimitedInitCodeSize: true,
    })

    const bytes = new Uint8Array(1000000).fill(0x60)

    // setup the call arguments
    const runCallArgs = {
      sender, // call address
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
      // Simple test, PUSH <big number> PUSH 0 RETURN
      // It tries to deploy a contract too large, where the code is all zeros
      // (since memory which is not allocated/resized to yet is always defaulted to 0)
      data: concatBytes(
        hexToBytes(`0x${'00'.repeat(Number(common.param('maxInitCodeSize')) + 1)}`),
        bytes,
      ),
    }
    const result = await evm.runCall(runCallArgs)
    assert.ok(
      result.execResult.exceptionError === undefined,
      'successfully created a contract with data size > MAX_INITCODE_SIZE and allowUnlimitedInitCodeSize active',
    )
  })

  it('CREATE with MAX_INITCODE_SIZE+1, allowUnlimitedContractSize active', async () => {
    const commonWith3860 = new Common({
      chain: Mainnet,
      hardfork: Hardfork.London,
      eips: [3860],
    })
    const caller = createAddressFromString('0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b')
    for (const code of ['F0', 'F5']) {
      const evm = await createEVM({
        common: commonWith3860,

        allowUnlimitedInitCodeSize: true,
      })
      const evmDisabled = await createEVM({
        common: commonWith3860,
        allowUnlimitedInitCodeSize: false,
      })
      const contractFactory = createAddressFromString('0xb94f5374fce5edbc8e2a8697c15331677e6ebf0b')
      const contractAccount = await evm.stateManager.getAccount(contractFactory)
      await evm.stateManager.putAccount(contractFactory, contractAccount!)
      await evmDisabled.stateManager.putAccount(contractFactory, contractAccount!)
      // This factory code:
      // -> reads 32 bytes from the calldata (X)
      // Attempts to create a contract of X size
      // (the initcode of this contract is just zeros, so STOP opcode
      // It stores the topmost stack item of this CREATE(2) at slot 0
      // This is either the contract address if it was successful, or 0 in case of error
      const factoryCode = hexToBytes(`0x600060003560006000${code}600055`)

      await evm.stateManager.putCode(contractFactory, factoryCode)
      await evmDisabled.stateManager.putCode(contractFactory, factoryCode)

      const runCallArgs = {
        from: caller,
        to: contractFactory,
        gasLimit: BigInt(0xfffffffff),
        data: hexToBytes(`0x${'00'.repeat(30)}C001`),
      }

      const res = await evm.runCall(runCallArgs)
      await evmDisabled.runCall(runCallArgs)

      const key0 = hexToBytes(`0x${'00'.repeat(32)}`)
      const storageActive = await evm.stateManager.getStorage(contractFactory, key0)
      const storageInactive = await evmDisabled.stateManager.getStorage(contractFactory, key0)

      assert.ok(
        !equalsBytes(storageActive, new Uint8Array()),
        'created contract with MAX_INITCODE_SIZE + 1 length, allowUnlimitedInitCodeSize=true',
      )
      assert.ok(
        equalsBytes(storageInactive, new Uint8Array()),
        'did not create contract with MAX_INITCODE_SIZE + 1 length, allowUnlimitedInitCodeSize=false',
      )

      // gas check

      const runCallArgs2 = {
        from: caller,
        to: contractFactory,
        gasLimit: BigInt(0xfffffffff),
        data: hexToBytes(`0x${'00'.repeat(30)}C000`),
      }

      // Test:
      // On the `allowUnlimitedInitCodeSize = true`, create contract with MAX_INITCODE_SIZE + 1
      // On `allowUnlimitedInitCodeSize = false`, create contract with MAX_INITCODE_SIZE
      // Verify that the gas cost on the prior one is higher than the first one
      const res2 = await evmDisabled.runCall(runCallArgs2)

      assert.ok(
        res.execResult.executionGasUsed > res2.execResult.executionGasUsed,
        'charged initcode analysis gas cost on both allowUnlimitedCodeSize=true, allowUnlimitedInitCodeSize=false',
      )
    }
  })
})
