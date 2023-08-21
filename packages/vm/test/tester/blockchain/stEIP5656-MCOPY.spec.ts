import path from 'path'
import { describe, suite } from 'vitest'

import { BlockchainTests } from '../runners/BlockchainTestsRunner'
import { defaultBlockchainTestArgs } from '../runners/runnerUtils'

suite(`stEIP5656-MCOPY Tests`, () => {
  describe(
    `Test: MCOPY`,
    async () => {
      const args = defaultBlockchainTestArgs
      args.file = 'MCOPY'
      args.dir = undefined
      args.testsPath = undefined
      args.customTestsPath = path.join('./test/tester/blockchain/stEIP5656-MCOPY')
      args.fork = 'Cancun'
      const test = new BlockchainTests(args)
      await test.runTests()
    },
    { timeout: 10000 }
  )
  describe(
    `Test: MCOPY_copy_cost`,
    async () => {
      const args = defaultBlockchainTestArgs
      args.file = 'MCOPY_copy_cost'
      args.customTestsPath = path.join('./test/tester/blockchain/stEIP5656-MCOPY')
      args.fork = 'Cancun'
      const test = new BlockchainTests(args)
      await test.runTests()
    },
    { timeout: 10000 }
  )
  describe(
    `Test: MCOPY_memory_hash`,
    async () => {
      const args = defaultBlockchainTestArgs
      args.file = 'MCOPY_memory_hash'
      args.customTestsPath = path.join('./test/tester/blockchain/stEIP5656-MCOPY')
      args.fork = 'Cancun'
      const test = new BlockchainTests(args)
      await test.runTests()
    },
    { timeout: 10000 }
  )
  describe(
    `Test: MCOPY_memory_expansion_cost`,
    async () => {
      const args = defaultBlockchainTestArgs
      args.file = 'MCOPY_memory_expansion_cost'
      args.customTestsPath = path.join('./test/tester/blockchain/stEIP5656-MCOPY')
      args.fork = 'Cancun'
      const test = new BlockchainTests(args)
      await test.runTests()
    },
    { timeout: 10000 }
  )
})
