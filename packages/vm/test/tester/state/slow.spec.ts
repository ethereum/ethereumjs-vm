import { describe } from 'vitest'

import { GeneralStateTests } from '../runners/GeneralStateTestsRunner'
import { defaultStateTestArgs } from '../runners/runnerUtils'

const args = { ...defaultStateTestArgs }
args.runSkipped = 'SLOW'
args['verify-test-amount-alltests'] = 0

describe(`VM State SLOW Tests`, async () => {
  const test = new GeneralStateTests(args)
  await test.runTests()
})
