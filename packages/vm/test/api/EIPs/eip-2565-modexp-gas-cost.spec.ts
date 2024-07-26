import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Address, bytesToHex, equalsBytes, hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

// eslint-disable-next-line import/order
import { VM } from '../../../src/index.js'

// See https://github.com/holiman/go-ethereum/blob/2c99023b68c573ba24a5b01db13e000bd9b82417/core/vm/testdata/precompiles/modexp_eip2565.json
import testData from '../testdata/eip-2565.json'

describe('EIP-2565 ModExp gas cost tests', () => {
  it('Test return data, gas cost and execution status against testdata', async () => {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Byzantium, eips: [2565] })
    const vm = await VM.create({ common })

    for (const test of testData) {
      const testName = test.Name
      const to = new Address(hexToBytes('0x0000000000000000000000000000000000000005'))
      const result = await vm.evm.runCall({
        caller: Address.zero(),
        gasLimit: BigInt(0xffffffffff),
        to,
        value: BigInt(0),
        data: hexToBytes(`0x${test.Input}`),
      })

      if (result.execResult.executionGasUsed !== BigInt(test.Gas)) {
        assert.fail(
          `[${testName}]: Gas usage incorrect, expected ${test.Gas}, got ${result.execResult.executionGasUsed}`,
        )
        continue
      }

      if (result.execResult.exceptionError !== undefined) {
        assert.fail(`[${testName}]: Call should not fail`)
        continue
      }

      if (!equalsBytes(result.execResult.returnValue, hexToBytes(`0x${test.Expected}`))) {
        assert.fail(
          `[${testName}]: Return value not the expected value (expected: ${
            test.Expected
          }, received: ${bytesToHex(result.execResult.returnValue)})`,
        )
        continue
      }

      assert.ok(true, `[${testName}]: Call produced the expected results`)
    }
  })
})
