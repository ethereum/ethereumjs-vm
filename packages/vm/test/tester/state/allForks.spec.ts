import { describe, it } from 'vitest'

import { GeneralStateTests } from '../runners/GeneralStateTestsRunner'
import { defaultStateTestArgs } from '../runners/runnerUtils'
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
  'Paris',
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
  const args = { ...defaultStateTestArgs }
  args.state = true
  args.fork = fork
  return args
})

describe(`VM AllForks Tests: ${allForks.toString()}`, async () => {
  for (const args of allForksArgs) {
    const test = new GeneralStateTests(args)
    it(`${args.fork} (${test.expectedTests})`, async () => {
      await test.runTests()
    })
  }
})
