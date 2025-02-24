import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { EVMErrorCode } from '@ethereumjs/evm'
import { bytesToBigInt, hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createVM } from '../../../src/index.js'

const testCases = [
  { chain: Mainnet, hardfork: Hardfork.Istanbul, chainId: BigInt(1) },
  { chain: Mainnet, hardfork: Hardfork.Constantinople, err: EVMErrorCode.INVALID_OPCODE },
]

// CHAINID PUSH8 0x00 MSTORE8 PUSH8 0x01 PUSH8 0x00 RETURN
const code = ['46', '60', '00', '53', '60', '01', '60', '00', 'f3']

describe('Istanbul: EIP-1344', () => {
  it('CHAINID', async () => {
    const runCodeArgs = {
      code: hexToBytes(`0x${code.join('')}`),
      gasLimit: BigInt(0xffff),
    }

    for (const testCase of testCases) {
      const { chain, hardfork } = testCase
      const common = new Common({ chain, hardfork })
      const vm = await createVM({ common })
      try {
        const res = await vm.evm.runCode!(runCodeArgs)
        if (testCase.err !== undefined) {
          assert.equal(res.exceptionError?.type.code, testCase.err)
        } else {
          assert.ok(res.exceptionError === undefined)
          assert.equal(testCase.chainId, bytesToBigInt(res.returnValue))
        }
      } catch (e: any) {
        assert.fail(e.message)
      }
    }
  })
})
