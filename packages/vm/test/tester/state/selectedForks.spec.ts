import { describe, it } from 'vitest'

import { GeneralStateTests } from '../runners/GeneralStateTestsRunner'
import { defaultStateTestArgs } from '../runners/runnerUtils'
const selectedForks = [
  //   'Chainstart',
  'Homestead',
  //   'dao',
  'TangerineWhistle',
  'SpuriousDragon',
  //   'Byzantium',
  //   'Constantinople',
  'Petersburg',
  //   'Istanbul',
  //   'MuirGlacier',
  'Berlin',
  'London',
  //   'ByzantiumToConstantinopleFixAt5',
  //   'EIP158ToByzantiumAt5',
  //   'FrontierToHomesteadAt5',
  //   'HomesteadToDaoAt5',
  //   'HomesteadToEIP150At5',
  //   'BerlinToLondonAt5',
]

describe(`VM State Test: Selected-Hardforks = ${selectedForks} `, async () => {
  for await (const hardfork of selectedForks) {
    const testArgs = defaultStateTestArgs
    testArgs.state = true
    testArgs.fork = hardfork
    const test = new GeneralStateTests(testArgs)
    it(`${testArgs.fork} (${test.expectedTests})`, async () => {
      await test.runTests()
    })
  }
})
