import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { DefaultStateManager } from '@ethereumjs/statemanager'
import {
  Account,
  Address,
  MAX_UINT64,
  bytesToHex,
  concatBytesNoTypeCheck,
  hexToBytes,
  padToEven,
  unpadBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { assert, describe, it } from 'vitest'

import genesisJSON from '../../client/test/testdata/geth-genesis/eip4844.json'
import { ERROR } from '../src/exceptions.js'
import { EVM } from '../src/index.js'

import type { EVMRunCallOpts } from '../src/types.js'

// Non-protected Create2Address generator. Does not check if Uint8Arrays have the right padding.
function create2address(sourceAddress: Address, codeHash: Uint8Array, salt: Uint8Array): Address {
  const rlp_proc_bytes = hexToBytes('0xff')
  const hashBytes = concatBytesNoTypeCheck(rlp_proc_bytes, sourceAddress.bytes, salt, codeHash)
  return new Address(keccak256(hashBytes).slice(12))
}

describe('RunCall tests', () => {
  it('Create where FROM account nonce is 0', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Constantinople })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    const res = await evm.runCall({ to: undefined })
    assert.equal(
      res.createdAddress?.toString(),
      '0xbd770416a3345f91e4b34576cb804a576fa48eb1',
      'created valid address when FROM account nonce is 0'
    )
  })

  /*
    This test:
        Setups a contract at address 0x00..ff
        Instantiates the EVM at the Constantinople fork
        Calls the address with various arguments (callvalue is used as argument). VMs `runCall` is used.
        The CREATE2 address which the contract creates is checked against the expected CREATE2 value.
*/

  it('Constantinople: EIP-1014 CREATE2 creates the right contract address', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const contractAddress = new Address(hexToBytes('0x00000000000000000000000000000000000000ff')) // contract address
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Constantinople })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    const code = '0x3460008080F560005260206000F3'
    /*
      code:             remarks: (top of the stack is at the zero index)
        CALLVALUE
        PUSH1 0x00
        DUP1
        DUP1
        CREATE2         [0, 0, 0, CALLVALUE]
        PUSH1 0x00
        MSTORE          [0x00, <created address>]
        PUSH1 0x20
        PUSH1 0x00
        RETURN          [0x00, 0x20]
    */

    await evm.stateManager.putContractCode(contractAddress, hexToBytes(code)) // setup the contract code
    await evm.stateManager.putAccount(caller, new Account(BigInt(0), BigInt(0x11111111))) // give the calling account a big balance so we don't run out of funds
    const codeHash = keccak256(new Uint8Array())
    for (let value = 0; value <= 1000; value += 20) {
      // setup the call arguments
      const runCallArgs = {
        caller, // call address
        gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
        to: contractAddress, // call to the contract address
        value: BigInt(value), // call with this value (the value is used in the contract as an argument, see above's code)
      }

      const hexString = '0x' + padToEven(value.toString(16))
      let valueBytes = hexToBytes(hexString)
      // pad bytes
      if (valueBytes.length < 32) {
        const diff = 32 - valueBytes.length
        valueBytes = concatBytesNoTypeCheck(new Uint8Array(diff), valueBytes)
      }
      // calculate expected CREATE2 address
      const expectedAddress = create2address(contractAddress, codeHash, valueBytes)
      // run the actual call
      const res = await evm.runCall(runCallArgs)
      // retrieve the return value and convert it to an address (remove the first 12 bytes from the 32-byte return value)
      const executionReturnValue = new Address(res.execResult.returnValue.slice(12))
      if (!expectedAddress.equals(executionReturnValue)) {
        assert.fail('contract address not equal')
      }
    }

    assert.ok(true, 'CREATE2 creates (empty) contracts at the expected address')
  })

  it('Byzantium cannot access Constantinople opcodes', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const contractAddress = new Address(hexToBytes('0x00000000000000000000000000000000000000ff')) // contract address
    // setup the evm
    const evmByzantium = await EVM.create({
      common: new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Byzantium }),
      stateManager: new DefaultStateManager(),
    })
    const evmConstantinople = await EVM.create({
      common: new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Constantinople }),
      stateManager: new DefaultStateManager(),
    })
    const code = '0x600160011B00'
    /*
      code:             remarks: (top of the stack is at the zero index)
        PUSH1 0x01
        PUSH1 0x01
        SHL
        STOP
    */

    await evmByzantium.stateManager.putContractCode(contractAddress, hexToBytes(code)) // setup the contract code
    await evmConstantinople.stateManager.putContractCode(contractAddress, hexToBytes(code)) // setup the contract code

    const runCallArgs = {
      caller, // call address
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
      to: contractAddress, // call to the contract address
    }

    const byzantiumResult = await evmByzantium.runCall(runCallArgs)
    const constantinopleResult = await evmConstantinople.runCall(runCallArgs)

    assert.ok(
      byzantiumResult.execResult.exceptionError &&
        byzantiumResult.execResult.exceptionError.error === 'invalid opcode',
      'byzantium cannot accept constantinople opcodes (SHL)'
    )
    assert.ok(
      !constantinopleResult.execResult.exceptionError,
      'constantinople can access the SHL opcode'
    )
  })

  it('Ensure that Istanbul sstoreCleanRefundEIP2200 gas is applied correctly', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    const code = '0x61000260005561000160005500'
    /*
      idea: store the original value in the storage slot, except it is now a 1-length Uint8Array instead of a 32-length Uint8Array
      code:
        PUSH2 0x0002
        PUSH1 0x00
        SSTORE              -> make storage slot 0 "dirty"
        PUSH2 0x0001
        PUSH1 0x00
        SSTORE              -> -> restore it to the original storage value (refund sstoreCleanRefundEIP2200)
        STOP
      gas cost:
        4x PUSH                                         12
        2x SSTORE (slot is nonzero, so charge 5000): 10000
        net                                          10012
      gas refund
        sstoreCleanRefundEIP2200                      4200
      gas used
                                                     10012 - 4200 = 5812

    */

    await evm.stateManager.putContractCode(address, hexToBytes(code))
    await evm.stateManager.putContractStorage(
      address,
      new Uint8Array(32),
      hexToBytes('0x' + '00'.repeat(31) + '01')
    )

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      to: address,
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
    }

    const result = await evm.runCall(runCallArgs)

    assert.equal(result.execResult.executionGasUsed, BigInt(5812), 'gas used correct')
    assert.equal(result.execResult.gasRefund, BigInt(4200), 'gas refund correct')
  })

  it('ensure correct gas for pre-constantinople sstore', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Chainstart })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    // push 1 push 0 sstore stop
    const code = '0x600160015500'

    await evm.stateManager.putContractCode(address, hexToBytes(code))

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      to: address,
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
    }

    const result = await evm.runCall(runCallArgs)

    assert.equal(result.execResult.executionGasUsed, BigInt(20006), 'gas used correct')
    assert.equal(result.execResult.gasRefund, BigInt(0), 'gas refund correct')
  })

  it('ensure correct gas for calling non-existent accounts in homestead', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Homestead })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    // code to call 0x00..00dd, which does not exist
    const code = '0x6000600060006000600060DD61FFFF5A03F100'

    await evm.stateManager.putContractCode(address, hexToBytes(code))

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      to: address,
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
    }

    const result = await evm.runCall(runCallArgs)

    // 7x push + gas + sub + call + callNewAccount
    // 7*3 + 2 + 3 + 40 + 25000 = 25066
    assert.equal(result.execResult.executionGasUsed, BigInt(25066), 'gas used correct')
    assert.equal(result.execResult.gasRefund, BigInt(0), 'gas refund correct')
  })

  it('ensure callcode goes OOG if the gas argument is more than the gas left in the homestead fork', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Homestead })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    // code to call back into the calling account (0x00..00EE),
    // but using too much memory
    const code = '0x61FFFF60FF60006000600060EE6000F200'

    await evm.stateManager.putContractCode(address, hexToBytes(code))

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      to: address,
      gasLimit: BigInt(200),
    }

    const result = await evm.runCall(runCallArgs)

    assert.equal(runCallArgs.gasLimit, result.execResult.executionGasUsed, 'gas used correct')
    assert.equal(result.execResult.gasRefund, BigInt(0), 'gas refund correct')
    assert.ok(result.execResult.exceptionError!.error === ERROR.OUT_OF_GAS, 'call went out of gas')
  })

  it('ensure selfdestruct pays for creating new accounts', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.TangerineWhistle })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    // code to call 0x00..00fe, with the GAS opcode used as gas
    // this cannot be paid, since we also have to pay for CALL (40 gas)
    // this should thus go OOG
    const code = '0x60FEFF'

    await evm.stateManager.putContractCode(address, hexToBytes(code))

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      to: address,
      gasLimit: BigInt(0xffffffffff),
    }

    const result = await evm.runCall(runCallArgs)
    // gas: 5000 (selfdestruct) + 25000 (call new account)  + push (1) = 30003
    assert.equal(result.execResult.executionGasUsed, BigInt(30003), 'gas used correct')
    // selfdestruct refund
    assert.equal(result.execResult.gasRefund, BigInt(24000), 'gas refund correct')
  })

  it('ensure that sstores pay for the right gas costs pre-byzantium', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Chainstart })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    // code to call 0x00..00fe, with the GAS opcode used as gas
    // this cannot be paid, since we also have to pay for CALL (40 gas)
    // this should thus go OOG
    const code = '0x3460005500'

    await evm.stateManager.putAccount(caller, new Account())
    await evm.stateManager.putContractCode(address, hexToBytes(code))

    const account = await evm.stateManager.getAccount(caller)
    account!.balance = BigInt(100)
    await evm.stateManager.putAccount(caller, account!)

    /*
    Situation:
    Storage slot changes from 0 -> 0 (reset cost, 5000)
    Changes 0 -> 1 (set cost, 20000)
    Changes 1 -> 2 ("reset" cost, 5000)
    Changes 2 -> 0 ("reset" cost, 5000 + 15000 refund)
  */

    const data = [
      {
        value: 0,
        gas: 5005,
        refund: 0,
      },
      {
        value: 1,
        gas: 20005,
        refund: 0,
      },
      {
        value: 2,
        gas: 5005,
        refund: 0,
      },
      {
        value: 0,
        gas: 5005,
        refund: 15000,
      },
    ]

    for (const callData of data) {
      // setup the call arguments
      const runCallArgs = {
        caller, // call address
        to: address,
        gasLimit: BigInt(0xffffffffff),
        value: BigInt(callData.value),
      }

      const result = await evm.runCall(runCallArgs)
      assert.equal(result.execResult.executionGasUsed, BigInt(callData.gas), 'gas used correct')
      assert.equal(result.execResult.gasRefund, BigInt(callData.refund), 'gas refund correct')
    }
  })

  it('Ensure that contracts cannot exceed nonce of MAX_UINT64 when creating new contracts (EIP-2681)', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    const address = new Address(hexToBytes('0x00000000000000000000000000000000000000ff'))
    const slot = hexToBytes('0x' + '00'.repeat(32))
    const emptyBytes = hexToBytes('0x')
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    const code = '0x60008080F060005500'
    /*
      This simple code tries to create an empty contract and then stores the address of the contract in the zero slot.
        CODE:
          PUSH 0
          DUP1
          DUP1
          CREATE -> Stack is now [0,0,0] ([value, offset, length])
          PUSH 0
          SSTORE -> stack is now [0, <Created Address>], so this stores the <Created Address> at slot 0
          STOP
    */

    await evm.stateManager.putContractCode(address, hexToBytes(code))

    const account = await evm.stateManager.getAccount(address)
    account!.nonce = MAX_UINT64 - BigInt(1)
    await evm.stateManager.putAccount(address, account!)

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      to: address,
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
    }

    await evm.runCall(runCallArgs)
    let storage = await evm.stateManager.getContractStorage(address, slot)

    // The nonce is MAX_UINT64 - 1, so we are allowed to create a contract (nonce of creating contract is now MAX_UINT64)
    assert.notDeepEqual(storage, emptyBytes, 'successfully created contract')

    await evm.runCall(runCallArgs)

    // The nonce is MAX_UINT64, so we are NOT allowed to create a contract (nonce of creating contract is now MAX_UINT64)
    storage = await evm.stateManager.getContractStorage(address, slot)
    assert.deepEqual(
      storage,
      emptyBytes,
      'failed to create contract; nonce of creating contract is too high (MAX_UINT64)'
    )
  })

  it('Ensure that IDENTITY precompile copies the memory', async () => {
    // This test replays the Geth chain split; https://etherscan.io/tx/0x1cb6fb36633d270edefc04d048145b4298e67b8aa82a9e5ec4aa1435dd770ce4
    // Exploit post-mortem: https://github.com/ethereum/go-ethereum/blob/master/docs/postmortems/2021-08-22-split-postmortem.md
    // Permalink: https://github.com/ethereum/go-ethereum/blob/90987db7334c1d10eb866ca550efedb66dea8a20/docs/postmortems/2021-08-22-split-postmortem.md
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x1a02a619e51cc5f8a2a61d2a60f6c80476ee8ead')) // caller address
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    const code = '0x3034526020600760203460045afa602034343e604034f3'

    const account = new Account()
    account!.nonce = BigInt(1) // ensure nonce for contract is correct
    account!.balance = BigInt(10000000000000000)
    await evm.stateManager.putAccount(caller, account!)

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      gasLimit: BigInt(150000),
      data: hexToBytes(code),
      gasPrice: BigInt(70000000000),
    }

    const result = await evm.runCall(runCallArgs)
    const expectedAddress = '0x28373a29d17af317e669579d97e7dddc9da6e3e2'
    const expectedCode =
      '0x00000000000000000000000028373a29d17af317e669579d97e7dddc9da6e3e2e7dddc9da6e3e200000000000000000000000000000000000000000000000000'

    assert.equal(result.createdAddress?.toString(), expectedAddress, 'created address correct')
    const deployedCode = await evm.stateManager.getContractCode(result.createdAddress!)
    assert.equal(bytesToHex(deployedCode), expectedCode, 'deployed code correct')
  })

  it('Throws on negative call value', async () => {
    // setup the vm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    // setup the call arguments
    const runCallArgs = {
      to: Address.zero(),
      value: BigInt(-10),
    }

    try {
      await evm.runCall(runCallArgs)
      assert.fail('should not accept a negative call value')
    } catch (err: any) {
      assert.ok(
        err.message.includes('value field cannot be negative'),
        'throws on negative call value'
      )
    }
  })

  it('runCall() -> skipBalance behavior', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    // runCall against a contract to reach `_reduceSenderBalance`
    const contractCode = hexToBytes('0x00') // 00: STOP
    const contractAddress = Address.fromString('0x000000000000000000000000636F6E7472616374')
    await evm.stateManager.putContractCode(contractAddress, contractCode)
    const senderKey = hexToBytes(
      '0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109'
    )
    const sender = Address.fromPrivateKey(senderKey)

    const runCallArgs = {
      gasLimit: BigInt(21000),
      value: BigInt(6),
      from: sender,
      to: contractAddress,
      skipBalance: true,
    }

    for (const balance of [undefined, BigInt(5)]) {
      await evm.stateManager.modifyAccountFields(sender, { nonce: BigInt(0), balance })
      const res = await evm.runCall(runCallArgs)
      assert.ok(true, 'runCall should not throw with no balance and skipBalance')
      const senderBalance = (await evm.stateManager.getAccount(sender))!.balance
      assert.equal(
        senderBalance,
        balance ?? BigInt(0),
        'sender balance should be the same before and after call execution with skipBalance'
      )
      assert.equal(res.execResult.exceptionError, undefined, 'no exceptionError with skipBalance')
    }

    const res2 = await evm.runCall({ ...runCallArgs, skipBalance: false })
    assert.equal(
      res2.execResult.exceptionError?.error,
      'insufficient balance',
      'runCall reverts when insufficient sender balance and skipBalance is false'
    )
  })

  it('runCall() => allows to detect for max code size deposit errors', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x00000000000000000000000000000000000000ee')) // caller address
    // setup the evm
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      gasLimit: BigInt(0xffffffffff), // ensure we pass a lot of gas, so we do not run out of gas
      // Simple test, PUSH <big number> PUSH 0 RETURN
      // It tries to deploy a contract too large, where the code is all zeros
      // (since memory which is not allocated/resized to yet is always defaulted to 0)
      data: hexToBytes('0x62FFFFFF6000F3'),
    }

    const result = await evm.runCall(runCallArgs)
    assert.equal(
      result.execResult.exceptionError?.error,
      ERROR.CODESIZE_EXCEEDS_MAXIMUM,
      'reported error is correct'
    )
  })
  it('runCall() => use BLOBHASH opcode from EIP 4844', async () => {
    // setup the evm
    const common = Common.fromGethGenesis(genesisJSON, {
      chain: 'custom',
      hardfork: Hardfork.Cancun,
    })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    // setup the call arguments
    const runCallArgs: EVMRunCallOpts = {
      gasLimit: BigInt(0xffffffffff),
      // calldata -- retrieves the versioned hash at index 0 and returns it from memory
      data: hexToBytes('0x60004960005260206000F3'),
      versionedHashes: [hexToBytes('0xab')],
    }
    const res = await evm.runCall(runCallArgs)
    assert.equal(
      bytesToHex(unpadBytes(res.execResult.returnValue)),
      '0xab',
      'retrieved correct versionedHash from runState'
    )

    // setup the call arguments
    const runCall2Args: EVMRunCallOpts = {
      gasLimit: BigInt(0xffffffffff),
      // calldata -- tries to retrieve the versioned hash at index 1 and return it from memory
      data: hexToBytes('0x60014960005260206000F3'),
      versionedHashes: [hexToBytes('0xab')],
    }
    const res2 = await evm.runCall(runCall2Args)
    assert.equal(
      bytesToHex(unpadBytes(res2.execResult.returnValue)),
      '0x',
      'retrieved no versionedHash when specified versionedHash does not exist in runState'
    )
  })

  it('step event: ensure EVM memory and not internal memory gets reported', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    const contractCode = hexToBytes('0x600060405200') // PUSH 0 PUSH 40 MSTORE STOP
    const contractAddress = Address.fromString('0x000000000000000000000000636F6E7472616374')
    await evm.stateManager.putContractCode(contractAddress, contractCode)

    const runCallArgs = {
      gasLimit: BigInt(21000),
      to: contractAddress,
    }

    let verifyMemoryExpanded = false

    evm.events.on('step', (e) => {
      assert.ok(e.memory.length <= 96)
      if (e.memory.length > 0) {
        verifyMemoryExpanded = true
      }
    })
    await evm.runCall(runCallArgs)
    assert.ok(verifyMemoryExpanded, 'memory did expand')
  })

  it('ensure code deposit errors are logged correctly (>= Homestead)', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    // Create a contract which is too large
    const runCallArgs = {
      gasLimit: BigInt(10000000),
      data: hexToBytes('0x61FFFF6000F3'),
    }

    const res = await evm.runCall(runCallArgs)
    assert.ok(res.execResult.exceptionError?.error === ERROR.CODESIZE_EXCEEDS_MAXIMUM)

    // Create a contract which goes OOG when creating
    const runCallArgs2 = {
      gasLimit: BigInt(100000),
      data: hexToBytes('0x62FFFFFF6000F3'),
    }

    const res2 = await evm.runCall(runCallArgs2)
    assert.ok(res2.execResult.exceptionError?.error === ERROR.OUT_OF_GAS)
  })

  it('ensure code deposit errors are logged correctly (Frontier)', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Chainstart })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })

    // Create a contract which cannot pay the code deposit fee
    const runCallArgs = {
      gasLimit: BigInt(10000000),
      data: hexToBytes('0x61FFFF6000F3'),
    }

    const res = await evm.runCall(runCallArgs)
    assert.ok(res.execResult.exceptionError?.error === ERROR.CODESTORE_OUT_OF_GAS)

    // Create a contract which goes OOG when creating
    const runCallArgs2 = {
      gasLimit: BigInt(100000),
      data: hexToBytes('0x62FFFFFF6000F3'),
    }

    const res2 = await evm.runCall(runCallArgs2)
    assert.ok(res2.execResult.exceptionError?.error === ERROR.OUT_OF_GAS)
  })
})
