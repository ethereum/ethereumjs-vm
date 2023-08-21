import { describe, it } from 'vitest'

import { GeneralStateTests } from '../runners/GeneralStateTestsRunner'
import { defaultStateTestArgs } from '../runners/runnerUtils'

describe(`VM State:buildIntegrity`, async () => {
  it('test:stackOverflow', async () => {
    const test = new GeneralStateTests({ ...defaultStateTestArgs, test: 'stackOverflow' })
    it('runs test', async () => {
      await test.runTests()
    })
  })
})
