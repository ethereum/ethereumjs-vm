import { Common, Hardfork } from '@ethereumjs/common'
import { DefaultStateManager } from '@ethereumjs/statemanager'
import * as tape from 'tape'

import { EVM, getActivePrecompiles } from '../../src'

tape('Precompiles: ECMUL', (t) => {
  t.test('ECMUL', async (st) => {
    const common = new Common({ hardfork: Hardfork.Petersburg })
    const evm = await EVM.create({
      common,
      stateManager: new DefaultStateManager(),
    })
    const ECMUL = getActivePrecompiles(common).get('0000000000000000000000000000000000000007')!

    const result = await ECMUL({
      data: new Uint8Array(0),
      gasLimit: BigInt(0xffff),
      _common: common,
      _EVM: evm,
    })

    st.deepEqual(result.executionGasUsed, BigInt(40000), 'should use petersburg gas costs')
    st.end()
  })
})
