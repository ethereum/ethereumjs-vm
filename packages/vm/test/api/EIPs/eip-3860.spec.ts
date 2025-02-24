import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import { Account, Address, Units, bytesToHex, hexToBytes, privateToAddress } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createVM, runTx } from '../../../src/index.js'
const pkey = hexToBytes(`0x${'20'.repeat(32)}`)
const GWEI = BigInt('1000000000')
const sender = new Address(privateToAddress(pkey))

describe('EIP 3860 tests', () => {
  const common = new Common({
    chain: Mainnet,
    hardfork: Hardfork.London,
    eips: [3860],
  })

  it('EIP-3860 tests', async () => {
    const vm = await createVM({ common })
    await vm.stateManager.putAccount(sender, new Account())
    const account = await vm.stateManager.getAccount(sender)
    const balance = GWEI * BigInt(21000) * BigInt(10000000)
    account!.balance = balance
    await vm.stateManager.putAccount(sender, account!)

    const bytes = new Uint8Array(1000000).fill(0x60)
    // We create a tx with a common which has eip not yet activated else tx creation will
    // throw error
    const txCommon = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const tx = createFeeMarket1559Tx(
      {
        data: `0x7F6000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060005260206000F3${bytesToHex(
          bytes,
        ).slice(2)}`,
        gasLimit: Units.gwei(100),
        maxFeePerGas: 7,
        nonce: 0,
      },
      { common: txCommon },
    ).sign(pkey)
    const result = await runTx(vm, { tx })
    assert.ok(
      result.execResult.exceptionError?.type.code === 'initcode exceeds max initcode size',
      'initcode exceeds max size',
    )
  })
})
