/* eslint-disable no-console */
import { MCLBLS, NobleBLS, NobleBN254, RustBN254 } from '@ethereumjs/evm'
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import * as mcl from 'mcl-wasm'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'
import * as minimist from 'minimist'
import * as path from 'path'
import * as process from 'process'
import { initRustBN } from 'rustbn-wasm'
import * as tape from 'tape'

import {
  DEFAULT_FORK_CONFIG,
  DEFAULT_TESTS_PATH,
  getCommon,
  getExpectedTests,
  getRequiredForkConfigAlias,
  getSkipTests,
  getTestDirs,
} from './config.js'
import { runBlockchainTest } from './runners/BlockchainTestsRunner.js'
import { runStateTest } from './runners/GeneralStateTestsRunner.js'
import { getTestFromSource, getTestsFromArgs } from './testLoader.js'

import type { Common } from '@ethereumjs/common'
import type { EVMBLSInterface, EVMBN254Interface } from '@ethereumjs/evm'

/**
 * Test runner
 * CLI arguments:
 * --state: boolean.                      Run state tests
 * --blockchain: boolean.                 Run blockchain tests
 * --fork: string.                        Fork to use for these tests
 * --skip: string.                        Comma-separated list of tests to skip. choices of: all,broken,permanent,slow. Defaults to all
 * --runSkipped: string.                  Comma-separated list of tests to skip if --skip is not set. choices of: all,broken,permanent,slow. Defaults to none
 * --file: string.                        Test file to run
 * --test: string.                        Test name to run
 * --dir: string.                         Test directory to look for tests
 * --excludeDir: string.                  Test directory to exclude from testing
 * --testsPath: string.                   Root directory of tests to look (default: '../ethereum-tests')
 * --customTestsPath: string.             Custom directory to look for tests (e.g. '../../my_custom_test_folder')
 * --customStateTest: string.             Run a file with a custom state test (not in test directory)
 * --jsontrace: boolean.                  Enable json step tracing in state tests
 * --dist: boolean.                       Use the compiled version of the VM
 * --data: number.                        Only run this state test if the transaction has this calldata
 * --gas: number.                         Only run this state test if the transaction has this gasLimit
 * --value: number.                       Only run this state test if the transaction has this call value
 * --debug: boolean.                      Enable BlockchainTests debugger (compares post state against the expected post state)
 * --expected-test-amount: number.        If passed, check after tests are ran if at least this amount of tests have passed (inclusive)
 * --verify-test-amount-alltests: number. If passed, get the expected amount from tests and verify afterwards if this is the count of tests (expects tests are ran with default settings)
 * --reps: number.                        If passed, each test case will be run the number of times indicated
 * --bls: string.                         BLS library being used, choices: Noble, MCL (default: MCL)
 * --bn254: string.                       BN254 (alt_BN128) library being used, choices: Noble, RustBN (default: RustBN)
 * --profile                              If this flag is passed, the state/blockchain tests will profile
 */

const argv = minimist.default(process.argv.slice(2))

async function runTests() {
  let name: 'GeneralStateTests' | 'BlockchainTests'
  let runner: any
  if ((argv.state as boolean) === true) {
    name = 'GeneralStateTests'
    runner = runStateTest
  } else if ((argv.blockchain as boolean) === true) {
    name = 'BlockchainTests'
    runner = runBlockchainTest
  } else {
    console.log(`Test type not supported or provided`)
    process.exit(1)
  }

  const RUN_PROFILER: boolean = argv.profile ?? false

  const FORK_CONFIG: string = argv.fork !== undefined ? argv.fork : DEFAULT_FORK_CONFIG
  const FORK_CONFIG_TEST_SUITE = getRequiredForkConfigAlias(FORK_CONFIG)

  // Examples: Istanbul -> istanbul, MuirGlacier -> muirGlacier
  const FORK_CONFIG_VM = FORK_CONFIG.charAt(0).toLowerCase() + FORK_CONFIG.substring(1)

  /**
   * Configuration for getting the tests from the ethereum/tests repository
   */
  const testGetterArgs: {
    skipTests: string[]
    runSkipped: string[]
    forkConfig: string
    file?: string
    test?: string
    dir?: string
    excludeDir?: string
    testsPath?: string
    customStateTest?: string
    directory?: string
  } = {
    skipTests: getSkipTests(argv.skip, argv.runSkipped !== undefined ? 'NONE' : 'ALL'),
    runSkipped: getSkipTests(argv.runSkipped, 'NONE'),
    forkConfig: FORK_CONFIG_TEST_SUITE,
    file: argv.file,
    test: argv.test,
    dir: argv.dir,
    excludeDir: argv.excludeDir,
    testsPath: argv.testsPath,
    customStateTest: argv.customStateTest,
  }

  let bls: EVMBLSInterface
  if (argv.bls !== undefined && argv.bls.toLowerCase() === 'mcl') {
    await mcl.init(mcl.BLS12_381)
    bls = new MCLBLS(mcl)
    console.log('BLS library used: MCL (WASM)')
  } else {
    console.log('BLS library used: Noble (JavaScript)')
    bls = new NobleBLS()
  }

  let bn254: EVMBN254Interface
  if (argv.bn254 !== undefined && argv.bn254.toLowerCase() === 'mcl') {
    const rustBN = await initRustBN()
    bn254 = new RustBN254(rustBN)
    console.log('BN254 (alt_BN128) library used: rustbn.js (WASM)')
  } else {
    console.log('BN254 (alt_BN128) library used: Noble (JavaScript)')
    bn254 = new NobleBN254()
  }

  /**
   * Run-time configuration
   */
  const kzg = new microEthKZG(trustedSetup)
  const runnerArgs: {
    forkConfigVM: string
    forkConfigTestSuite: string
    common: Common
    jsontrace?: boolean
    dist?: boolean
    data?: number
    gasLimit?: number
    value?: number
    debug?: boolean
    reps?: number
    profile: boolean
    bls: EVMBLSInterface
    bn254: EVMBN254Interface
    stateManager: string
  } = {
    forkConfigVM: FORK_CONFIG_VM,
    forkConfigTestSuite: FORK_CONFIG_TEST_SUITE,
    common: getCommon(FORK_CONFIG_VM, kzg),
    jsontrace: argv.jsontrace,
    dist: argv.dist,
    data: argv.data, // GeneralStateTests
    gasLimit: argv.gas, // GeneralStateTests
    value: argv.value, // GeneralStateTests
    debug: argv.debug, // BlockchainTests
    reps: argv.reps, // test repetitions
    bls,
    profile: RUN_PROFILER,
    bn254,
    stateManager: argv.stateManager,
  }

  /**
   * Modify the forkConfig string to ensure it works with RegEx (escape `+` characters)
   */
  if (testGetterArgs.forkConfig.includes('+')) {
    let str = testGetterArgs.forkConfig
    const indices = []
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '+') {
        indices.push(i)
      }
    }
    // traverse array in reverse order to ensure indices match when we replace the '+' with '/+'
    for (let i = indices.length - 1; i >= 0; i--) {
      str = `${str.substr(0, indices[i])}\\${str.substr(indices[i])}`
    }
    testGetterArgs.forkConfig = str
  }

  const expectedTests: number | undefined =
    argv['verify-test-amount-alltests'] > 0
      ? getExpectedTests(FORK_CONFIG_VM, name)
      : argv['expected-test-amount'] !== undefined && argv['expected-test-amount'] > 0
        ? argv['expected-test-amount']
        : undefined

  /**
   * Initialization output to console
   */
  const width = 50
  const fillWidth = width
  const fillParam = 20
  const delimiter = `| `.padEnd(fillWidth) + ' |'
  const formatArgs = (args: any) => {
    return Object.assign(
      {},
      ...Object.entries(args)
        .filter(([_k, v]) => typeof v === 'string' || (Array.isArray(v) && v.length !== 0))
        .map(([k, v]) => ({
          [k]: Array.isArray(v) && v.length > 0 ? v.length : v,
        })),
    )
  }
  const formattedGetterArgs = formatArgs(testGetterArgs)
  const formattedRunnerArgs = formatArgs(runnerArgs)

  console.log(`+${'-'.repeat(width)}+`)
  console.log(`| VM -> ${name} `.padEnd(fillWidth) + ' |')
  console.log(delimiter)
  console.log(`| TestGetterArgs`.padEnd(fillWidth) + ' |')
  for (const [key, value] of Object.entries(formattedGetterArgs)) {
    console.log(`| ${key.padEnd(fillParam)}: ${value}`.padEnd(fillWidth) + ' |')
  }
  console.log(delimiter)
  console.log(`| RunnerArgs`.padEnd(fillWidth) + ' |')
  for (const [key, value] of Object.entries(formattedRunnerArgs)) {
    if (key === 'common') {
      const hf = (value as Common).hardfork()
      console.log(`| ${key.padEnd(fillParam)}: ${hf}`.padEnd(fillWidth) + ' |')
    } else {
      console.log(`| ${key.padEnd(fillParam)}: ${value}`.padEnd(fillWidth) + ' |')
    }
  }
  console.log(`+${'-'.repeat(width)}+`)
  console.log()

  if (argv.customStateTest !== undefined) {
    const fileName: string = argv.customStateTest
    //@ts-ignore tsx/esbuild can't figure out this namespace import thing but it works fine :shrug:
    tape(name, (t) => {
      getTestFromSource(fileName, async (err: string | null, test: any) => {
        if (err !== null) {
          return t.fail(err)
        }
        t.comment(`file: ${fileName} test: ${test.testName}`)
        await runStateTest(runnerArgs, test, t)
        t.end()
      })
    })
  } else {
    //@ts-ignore tsx/esbuild can't figure out this namespace import thing but it works fine :shrug:
    tape.default(name, async (t) => {
      let testIdentifier: string
      const failingTests: Record<string, string[] | undefined> = {}
      ;(t as any).on('result', (o: any) => {
        if (
          typeof o.ok !== 'undefined' &&
          o.ok !== null &&
          (o.ok === '' || o.ok === 0 || o.ok === false)
        ) {
          if (failingTests[testIdentifier] !== undefined) {
            ;(failingTests[testIdentifier] as string[]).push(o.name)
          } else {
            failingTests[testIdentifier] = [o.name]
          }
        }
      })
      // Tests for HFs before Istanbul have been moved under `LegacyTests/Constantinople`:
      // https://github.com/ethereum/tests/releases/tag/v7.0.0-beta.1

      const dirs = getTestDirs(FORK_CONFIG_VM, name)
      console.time('Total (including setup)')
      for (const dir of dirs) {
        await new Promise<void>((resolve, reject) => {
          if (argv.customTestsPath !== undefined) {
            testGetterArgs.directory = argv.customTestsPath as string
          } else {
            const testDir = testGetterArgs.dir ?? ''
            const testsPath = testGetterArgs.testsPath ?? DEFAULT_TESTS_PATH
            testGetterArgs.directory = path.join(testsPath, dir, testDir)
          }
          getTestsFromArgs(
            dir,
            async (fileName: string, subDir: string, testName: string, test: any) => {
              const runSkipped = testGetterArgs.runSkipped
              const inRunSkipped = runSkipped.includes(fileName)
              if (runSkipped.length === 0 || inRunSkipped === true) {
                testIdentifier = `file: ${subDir} test: ${testName}`
                t.comment(testIdentifier)
                await runner(runnerArgs, test, t)
              }
            },
            testGetterArgs,
          )
            .then(() => {
              resolve()
            })
            .catch((error: string) => {
              t.fail(error)
              reject()
            })
        })
      }

      for (const failingTestIdentifier in failingTests) {
        console.log(`Errors thrown in ${failingTestIdentifier}:`)
        const errors = failingTests[failingTestIdentifier] as string[]
        for (let i = 0; i < errors.length; i++) {
          console.log('\t' + errors[i])
        }
      }

      if (expectedTests !== undefined) {
        const { assertCount } = t as any
        t.ok(assertCount >= expectedTests, `expected ${expectedTests} checks, got ${assertCount}`)
      }

      console.log()
      console.timeEnd('Total (including setup)')

      t.end()
    })
  }
}

runTests() // eslint-disable-line @typescript-eslint/no-floating-promises
