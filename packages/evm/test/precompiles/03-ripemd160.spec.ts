import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { bytesToHex, hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createEVM, getActivePrecompiles } from '../../src/index.js'

const input =
  '38d18acb67d25c8bb9942764b62f18e17054f66a817bd4295423adf9ed98873e000000000000000000000000000000000000000000000000000000000000001b38d18acb67d25c8bb9942764b62f18e17054f66a817bd4295423adf9ed98873e789d1dd423d25f0772d2748d60f7e4b81bb14d086eba8e8e8efb6dcff8a4ae02'
const expected = '0000000000000000000000009215b8d9882ff46f0dfde6684d78e831467f65e6'

describe('Precompiles: RIPEMD160', () => {
  it('RIPEMD160', async () => {
    // Test reference: https://github.com/ethereum/go-ethereum/blob/e206d3f8975bd98cc86d14055dca40f996bacc60/core/vm/contracts_test.go#L217

    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Petersburg })
    const evm = await createEVM({
      common,
    })
    const addressStr = '0000000000000000000000000000000000000003'
    const RIPEMD160 = getActivePrecompiles(common).get(addressStr)!

    const data = hexToBytes(`0x${input}`)
    let result = await RIPEMD160({
      data,
      gasLimit: BigInt(0xffff),
      common,
      _EVM: evm,
    })
    assert.deepEqual(
      bytesToHex(result.returnValue),
      `0x${expected}`,
      'should generate expected value',
    )

    result = await RIPEMD160({
      data,
      gasLimit: BigInt(0x1),
      common,
      _EVM: evm,
    })
    assert.equal(result.exceptionError!.type.code, 'out of gas', 'should error when not enough gas')
  })
})
