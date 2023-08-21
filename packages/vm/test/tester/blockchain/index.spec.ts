import { suite } from 'vitest'

import { BlockchainTests } from '../runners/BlockchainTestsRunner'
import { testInput } from '../runners/runnerUtils'

const testArgs = testInput('blockchain')
const printArgs = Object.fromEntries(Object.entries(testArgs).filter(([_, v]) => v !== undefined))
printArgs['verify-test-amount-alltests'] =
  printArgs['verify-test-amount-alltests'] === 1 ? true : false
const blockchainTest = new BlockchainTests(testArgs)
console.log('-------BLOCKCHAIN_TEST-------')
console.log(`${new Date().toLocaleTimeString()}`)
console.log('----------TEST_ARGS------------')
console.log(printArgs)
console.log('verify all: ', process.env.VERIFY_ALLTESTS)
console.log('-------------------------------')
const forkSuite = suite(
  `${testArgs.fork} (${testArgs.dir ?? blockchainTest.expectedTests})`,
  async () => {
    await blockchainTest.runTests()
  }
)
forkSuite.on('beforeAll', async (context) => {
  console.log('----------TEST_FORK------------')
  let totalFiles = 0
  let totalDirectories = 0
  let totalSubDirectories = 0
  let totalTestCases = 0
  for await (const dir of context.tasks) {
    if (!('tasks' in dir)) {
      continue
    }
    totalDirectories += 1
    for await (const subDir of dir.tasks.filter((d) => 'tasks' in d)) {
      for await (const subSub of (subDir as any).tasks) {
        totalSubDirectories += 1
        for await (const file of subSub.tasks) {
          if (file.name.endsWith('.json') === true) {
            totalFiles += 1
            totalTestCases += file.tasks.length
          } else if ('tasks' in file) {
            totalSubDirectories += 1
            for await (const _file of file.tasks) {
              if (_file.name.endsWith('.json') === true) {
                totalFiles += 1
                totalTestCases += _file.tasks.length
              }
            }
          } else {
            totalTestCases++
          }
        }
      }
    }
  }
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalDirectories: (${totalDirectories})`)
  console.log(
    `${' '.repeat(testArgs.fork!.length)} > totalSubDirectories: (${totalSubDirectories})`
  )
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalFiles: (${totalFiles})`)
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalTests: (${totalTestCases})`)
  console.log('-------------------------------')
})

forkSuite.on('afterAll', async (context) => {
  let skipped = 0
  let totalFiles = 0
  let totalDirectories = 0
  let totalSubDirectories = 0
  let totalTestCases = 0
  let totalPassing = 0
  for await (const dir of context.tasks) {
    if (!('tasks' in dir)) {
      continue
    }
    totalDirectories += 1
    for await (const subDir of dir.tasks.filter((d) => 'tasks' in d)) {
      totalSubDirectories += 1
      for await (const file of (subDir as any).tasks) {
        totalFiles += 1
        for await (const test of file.tasks) {
          let subs = 0
          let files = 0
          if ('tasks' in test) {
            for await (const task of test.tasks) {
              if ('tasks' in task) {
                subs = (subDir as any).tasks.length - 1
                files = file.tasks.length - 1
                totalTestCases += task.tasks.length
                totalPassing += task.tasks.filter((t: any) => t.result.state === 'pass').length
                skipped += task.tasks.filter((t: any) => t.result.state === 'skip').length
              } else if ('result' in task) {
                totalPassing += task.result.state === 'pass' ? 1 : 0
                skipped += task.result.state === 'skip' ? 1 : 0
                totalTestCases += 1
              }
            }
          } else if ('result' in test) {
            totalTestCases += 1
            totalPassing += test.result.state === 'pass' ? 1 : 0
          }
          totalSubDirectories += subs
          totalFiles += files
        }
      }
    }
  }
  console.log('---------RESULT----------------')
  if (blockchainTest.expectedTests > 0) {
    console.log(
      `${testArgs.fork} > totalChecks: (${blockchainTest.testCount} / ${
        blockchainTest.expectedTests
      }) {${blockchainTest.testCount > blockchainTest.expectedTests ? '+' : '-'}${
        blockchainTest.testCount - blockchainTest.expectedTests
      }}`
    )
  } else {
    console.log(`${testArgs.fork} > totalChecks: (${blockchainTest.testCount})`)
  }
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalDirectories: (${totalDirectories})`)
  console.log(
    `${' '.repeat(testArgs.fork!.length)} > totalSubDirectories: (${totalSubDirectories})`
  )
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalFiles: (${totalFiles})`)
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalTests: (${totalTestCases})`)
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalSkipped: (${skipped})`)
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalTestRun: (${totalTestCases - skipped})`)
  console.log(`${' '.repeat(testArgs.fork!.length)} > totalPassing: (${totalPassing})`)
  console.log('-------------------------------')
})

forkSuite
