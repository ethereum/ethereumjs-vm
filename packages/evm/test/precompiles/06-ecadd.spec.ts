import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { assert, describe, it } from 'vitest'

import { createEVM, getActivePrecompiles } from '../../src/index.js'

describe('Precompiles: ECADD', () => {
  it('ECADD', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Petersburg })
    const evm = await createEVM({
      common,
    })
    const addressStr = '0000000000000000000000000000000000000006'
    const ECADD = getActivePrecompiles(common).get(addressStr)!

    const result = await ECADD({
      data: new Uint8Array(0),
      gasLimit: BigInt(0xffff),
      common,
      _EVM: evm,
    })

    assert.deepEqual(result.executionGasUsed, BigInt(500), 'should use petersburg gas costs')
  })
})
