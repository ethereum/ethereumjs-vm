import { readFileSync } from 'fs'
import { Chain, Common, Hardfork, Mainnet, StateManagerInterface } from '@ethereumjs/common'
import { getPreState } from './util.js'
import { EVM } from '@ethereumjs/evm'
import { Address, createZeroAddress, hexToBytes } from '@ethereumjs/util'
import { createEVM } from '@ethereumjs/evm'
import { Bench } from 'tinybench'
import { SimpleStateManager } from '@ethereumjs/statemanager'

export async function bytecode(numSamples?: number, bytecode?: string, preState?: string) {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun })

  let stateManager: StateManagerInterface = new SimpleStateManager()

  if (preState) {
    let preStateData = JSON.parse(readFileSync(preState, 'utf8'))
    stateManager = await getPreState(preStateData, common)
  }

  let evm = await createEVM({ stateManager, common })
  const bytecodeHex = hexToBytes(`0x${bytecode}`)
  const gasLimit = BigInt(0xffff)

  const bench = new Bench({
    time: 100,
    teardown: async () => {
      await evm.stateManager.clearStorage(createZeroAddress())
    },
  })

  for (let i = 0; i < (numSamples ?? 1); i++) {
    bench.add('bytecode sample ' + i.toString(), async () => {
      // evm.stateManager.clearContractStorage(Address.zero())
      await evm.runCode({
        code: bytecodeHex,
        gasLimit: gasLimit,
      })
    })
  }

  await bench.warmup() // make results more reliable, ref: https://github.com/tinylibs/tinybench/pull/50
  await bench.run()

  return bench.table()
}
