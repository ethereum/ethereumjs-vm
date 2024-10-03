import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createLegacyTx } from '@ethereumjs/tx'
import { createAddressFromString } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createVM, runTx } from '../../../src/index.js'

describe('EIP-3607 tests', () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin, eips: [3607] })
  const commonNoEIP3607 = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin, eips: [] })
  const precompileAddr = createAddressFromString('0x0000000000000000000000000000000000000001')

  it('should reject txs from senders with deployed code when EIP is enabled', async () => {
    const vm = await createVM({ common })
    await vm.stateManager.putCode(precompileAddr, new Uint8Array(32).fill(1))
    const tx = createLegacyTx({ gasLimit: 100000 }, { freeze: false })
    tx.getSenderAddress = () => precompileAddr
    try {
      await runTx(vm, { tx, skipHardForkValidation: true })
      assert.fail('runTx should have thrown')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if ((error.message as string).includes('EIP-3607')) {
        assert.ok(true, 'threw correct error')
      } else {
        assert.fail('did not throw correct error')
      }
    }
  })

  it('should not reject txs from senders with deployed code when EIP is not enabled', async () => {
    const vm = await createVM({ common: commonNoEIP3607 })
    await vm.stateManager.putCode(precompileAddr, new Uint8Array(32).fill(1))
    const tx = createLegacyTx({ gasLimit: 100000 }, { freeze: false })
    tx.getSenderAddress = () => precompileAddr
    try {
      await runTx(vm, { tx, skipHardForkValidation: true })
      assert.ok('runTx successfully ran')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.fail('threw an unexpected error')
    }
  })
})
