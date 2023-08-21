import { describe, it } from 'vitest'

import { BlockchainTests } from '../runners/BlockchainTestsRunner'
import { defaultBlockchainTestArgs } from '../runners/runnerUtils'

const transitionForks = [
  'ByzantiumToConstantinopleFixAt5',
  'EIP158ToByzantiumAt5',
  'FrontierToHomesteadAt5',
  'HomesteadToDaoAt5',
  'HomesteadToEIP150At5',
  'BerlinToLondonAt5',
]
const transitionForksArgs = transitionForks.map((fork) => {
  const args = { ...defaultBlockchainTestArgs }
  args.blockchain = true
  args.fork = fork
  return args
})

describe(`VM Blockchain TransitionForks Tests: ${transitionForks.toString()}`, () => {
  for (const args of transitionForksArgs) {
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
