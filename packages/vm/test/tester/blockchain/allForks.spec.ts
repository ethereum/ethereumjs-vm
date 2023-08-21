import { describe, it } from 'vitest'

import { BlockchainTests } from '../runners/BlockchainTestsRunner'
import { defaultBlockchainTestArgs } from '../runners/runnerUtils'

const allForks = [
  'Chainstart',
  'Homestead',
  'dao',
  'TangerineWhistle',
  'SpuriousDragon',
  'Byzantium',
  'Constantinople',
  'Petersburg',
  'Istanbul',
  'MuirGlacier',
  'Berlin',
  'London',
  'ByzantiumToConstantinopleFixAt5',
  'EIP158ToByzantiumAt5',
  'FrontierToHomesteadAt5',
  'HomesteadToDaoAt5',
  'HomesteadToEIP150At5',
  'BerlinToLondonAt5',
]
const allForksArgs = allForks.map((fork) => {
  const args = { ...defaultBlockchainTestArgs }
  args.blockchain = true
  args.fork = fork
  return args
})

describe(`VM Blockchain AllForks Tests: ${allForks.toString()}`, () => {
  for (const args of allForksArgs) {
    const test = new BlockchainTests(args)
    it(
      `${args.fork} (${test.expectedTests})`,
      async () => {
        await test.runTests()
      },
      { timeout: 10000 }
    )
  }
})
