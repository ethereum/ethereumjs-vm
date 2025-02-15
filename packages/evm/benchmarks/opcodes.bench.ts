import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Address } from '@ethereumjs/util'
import { hexToBytes } from 'ethereum-cryptography/utils'
import { bench, describe } from 'vitest'

import { stackDelta } from '../src/eof/stackDelta.js'
import { createEVM } from '../src/index.js'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun })

function getOpcode(name: string) {
  for (const key in stackDelta) {
    const op = stackDelta[key]
    if (op.name === name) {
      return key
    }
  }
  throw new Error(`Opcode ${name} not found`)
}

const eofOpcodes = [
  0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xec, 0xee, 0xd0, 0xd1, 0xd2, 0xd3, 0xe6, 0xe7, 0xe8, 0xf7,
  0xf8, 0xf9, 0xfb,
]

// NOTE: stackDelta only contains EOF opcodes!
function generateCode(opcode: number) {
  const stackInfo = stackDelta[opcode]
  if (eofOpcodes.includes(opcode) || stackInfo === undefined || stackInfo.intermediates) {
    return
  }
  const JUMP = 0x56
  const JUMPDEST = 0x5b
  const PUSH0 = getOpcode('PUSH0')
  const POP = getOpcode('POP')
  const code = new Uint8Array([
    JUMPDEST,
    ...Array(stackInfo.inputs).fill(PUSH0),
    opcode,
    ...Array(stackInfo.outputs).fill(POP),
    PUSH0,
    JUMP,
  ])
  return code
}

const codeAddress = new Address(hexToBytes('0x' + 'ee'.repeat(20)))

// Note: vitest will run this sequentially and it looks (in the output) like it does nothing
// It will run 100+ benchmarks sequentially
// This takes some time, so patience is the key!
describe('EVM opcode speed', async () => {
  for (let opcode = 1; opcode <= 255; opcode++) {
    const code = generateCode(opcode)
    if (code !== undefined) {
      const evm = await createEVM({ common })
      await evm.stateManager.putContractCode(codeAddress, code)
      bench(
        `Benchmark for: ${stackDelta[opcode].name}`,
        async () => {
          await evm.runCall({
            to: codeAddress,
            gasLimit: BigInt(1_000_000),
          })
        },
        {}
      )
    }
  }
})
