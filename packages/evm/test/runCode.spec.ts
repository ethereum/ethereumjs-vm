import { Account, createAddressFromString, hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { EVMError, createEVM } from '../src/index.js'

const PUSH1 = '60'
const STOP = '00'
const JUMP = '56'
const JUMPDEST = '5b'

const testCases = [
  { code: [STOP, JUMPDEST, PUSH1, '05', JUMP, JUMPDEST], pc: 1, resultPC: 6 },
  {
    code: [STOP, JUMPDEST, PUSH1, '05', JUMP, JUMPDEST],
    pc: -1,
    error: 'Internal error: program counter not in range',
  },
  { code: [STOP], pc: 3, error: 'Internal error: program counter not in range' },
  { code: [STOP], resultPC: 1 },
]

describe('VM.runCode: initial program counter', () => {
  it('should work', async () => {
    const evm = await createEVM()

    for (const [i, testData] of testCases.entries()) {
      const runCodeArgs = {
        code: hexToBytes(`0x${testData.code.join('')}`),
        pc: testData.pc,
        gasLimit: BigInt(0xffff),
      }

      let err
      try {
        const result = await evm.runCode!(runCodeArgs)
        if (testData.resultPC !== undefined) {
          assert.equal(
            result.runState?.programCounter,
            testData.resultPC,
            `should start the execution at the specified pc or 0, testCases[${i}]`,
          )
        }
      } catch (e: any) {
        err = e
      }

      if (testData.error !== undefined) {
        // TODO: for all tests in EVM: this is a perfect place
        // to also roll-out the instanceof check for errors
        // This currently throws not EVMError but instead the generic EthereumJSError
        // with the error code: `ETHEREUMJS_UNSET_ERROR_CODE`
        // Here we can thus verify that the error type is generic.
        err = err?.message ?? 'no error thrown'
        assert.equal(err, testData.error, 'error message should match')
        err = false
      }

      assert.ok(err === false || err === undefined)
    }
  })
})

describe('VM.runCode: interpreter', () => {
  it('should return a EvmError as an exceptionError on the result', async () => {
    const evm = await createEVM()

    const INVALID_opcode = 'fe'
    const runCodeArgs = {
      code: hexToBytes(`0x${INVALID_opcode}`),
      gasLimit: BigInt(0xffff),
    }

    let result: any
    try {
      result = await evm.runCode!(runCodeArgs)
    } catch (e: any) {
      assert.fail('should not throw error')
    }
    assert.ok(result!.exceptionError! instanceof EVMError)
    assert.ok(result!.exceptionError!.type.code.includes('invalid opcode'))
  })

  it('should throw on non-EvmError', async () => {
    const evm = await createEVM()
    // NOTE: due to now throwing on `getStorage` if account does not exist
    // this now means that if `runCode` is called and the address it runs on (default: zero address)
    // does not exist, then if SSTORE/SLOAD is used, the runCode will immediately fail because StateManager now throws
    // TODO: is this behavior which we should fix? (Either in StateManager OR in runCode where we load the account first,
    // then re-put the account after (if account === undefined put empty account, such that the account exists))
    const address = createAddressFromString(`0x${'00'.repeat(20)}`)
    await evm.stateManager.putAccount(address, new Account())
    evm.stateManager.putStorage = (..._args) => {
      throw new Error('Test')
    }

    const SSTORE = '55'
    const runCodeArgs = {
      code: hexToBytes(`0x${[PUSH1, '01', PUSH1, '05', SSTORE].join('')}`),
      gasLimit: BigInt(0xffff),
    }

    try {
      await evm.runCode!(runCodeArgs)
      assert.fail('should throw error')
    } catch (e: any) {
      assert.ok(e.toString().includes('Test'), 'error thrown')
    }
  })
})

describe('VM.runCode: RunCodeOptions', () => {
  it('should throw on negative value args', async () => {
    const evm = await createEVM()

    const runCodeArgs = {
      value: BigInt(-10),
      gasLimit: BigInt(1000000),
    }

    try {
      await evm.runCode!(runCodeArgs)
      assert.fail('should not accept a negative call value')
    } catch (err: any) {
      assert.ok(
        err.message.includes('value field cannot be negative'),
        'throws on negative call value',
      )
    }
  })
})
