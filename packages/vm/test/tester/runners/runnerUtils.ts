import { Block } from '@ethereumjs/block'
import { Blockchain } from '@ethereumjs/blockchain'
import { ConsensusAlgorithm } from '@ethereumjs/common'
import { DefaultStateManager } from '@ethereumjs/statemanager'
import { Trie } from '@ethereumjs/trie'
import { Account, Address, MapDB, isHexPrefixed, toBytes } from '@ethereumjs/util'
import * as path from 'path'
import { assert, it } from 'vitest'

import { VM } from '../../../src'
import { makeTx, setupPreConditions } from '../../util'
import { DEFAULT_TESTS_PATH, getCommon, getExpectedTests, getSkipTests } from '../config'

import type { EthashConsensus } from '@ethereumjs/blockchain'
import type { Common } from '@ethereumjs/common'
import type {
  AccessListEIP2930Transaction,
  FeeMarketEIP1559Transaction,
  LegacyTransaction,
} from '@ethereumjs/tx'

export interface TestArgs {
  state?: boolean
  blockchain?: boolean
  fork?: string
  skip: string
  runSkipped: string
  file?: string
  test?: string
  dir?: string
  excludeDir?: string
  testsPath?: string
  customTestsPath?: string
  customStateTest?: string
  jsontrace?: boolean
  dist?: boolean
  data?: string
  gas?: string
  value?: string
  debug?: boolean
  'expected-test-amount'?: number
  'verify-test-amount-alltests': number
  reps?: number
}

export interface TestGetterArgs {
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
}

export interface RunnerArgs {
  forkConfigVM: string
  forkConfigTestSuite: string
  common: Common
  jsontrace?: boolean
  dist?: boolean
  data?: string
  gasLimit?: string
  value?: string
  debug?: boolean
  reps?: number
}

export function getStateTests(
  FORK_CONFIG_VM: string,
  allTests: number,
  expectedTestAmount?: number
) {
  const expectedTests: number | undefined =
    allTests > 0
      ? getExpectedTests(FORK_CONFIG_VM, 'GeneralStateTests')
      : expectedTestAmount !== undefined && expectedTestAmount > 0
      ? expectedTestAmount
      : undefined
  return expectedTests
}
export function getBlockchainTests(argv: any, FORK_CONFIG_VM: string) {
  const expectedTests: number | undefined =
    argv['verify-test-amount-alltests'] > 0
      ? getExpectedTests(FORK_CONFIG_VM, 'BlockchainTests')
      : argv['expected-test-amount'] !== undefined && argv['expected-test-amount'] > 0
      ? argv['expected-test-amount']
      : undefined
  return expectedTests
}

export function getTestPath(dir: any, testGetterArgs: TestGetterArgs, customTestsPath?: string) {
  if (customTestsPath !== undefined) {
    return customTestsPath as string
  } else {
    const testDir = testGetterArgs.dir ?? ''
    const testsPath = testGetterArgs.testsPath ?? DEFAULT_TESTS_PATH
    return path.join(testsPath, dir, testDir)
  }
}

export function shouldSkip(runSkipped: string[], fileName: string) {
  if (runSkipped.length === 0) {
    return false
  }
  if (runSkipped.includes(fileName)) {
    return false
  }
  return true
}

export const getGetterArgs = (argv: any, FORK_CONFIG_TEST_SUITE: string): TestGetterArgs => {
  return {
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
}

export const getRunnerArgs = (
  argv: any,
  FORK_CONFIG_VM: string,
  FORK_CONFIG_TEST_SUITE: string
): RunnerArgs => {
  return {
    forkConfigVM: FORK_CONFIG_VM,
    forkConfigTestSuite: FORK_CONFIG_TEST_SUITE,
    common: getCommon(FORK_CONFIG_VM),
    jsontrace: argv.jsontrace,
    dist: argv.dist,
    data: argv.data, // GeneralStateTests
    gasLimit: argv.gas, // GeneralStateTests
    value: argv.value, // GeneralStateTests
    debug: argv.debug, // BlockchainTests
    reps: argv.reps, // test repetitions
  }
}

export function parseTestCases(
  forkConfigTestSuite: string,
  testData: any,
  data: string | undefined,
  gasLimit: string | undefined,
  value: string | undefined
): Record<string, any>[] {
  let testCases: Record<string, any>[] = []

  if (testData['post'][forkConfigTestSuite] !== undefined) {
    testCases = testData['post'][forkConfigTestSuite].map((testCase: any) => {
      const testIndexes = testCase['indexes']
      const tx = { ...testData.transaction }
      if (data !== undefined && testIndexes['data'] !== data) {
        return null
      }

      if (value !== undefined && testIndexes['value'] !== value) {
        return null
      }

      if (gasLimit !== undefined && testIndexes['gas'] !== gasLimit) {
        return null
      }

      tx.data = testData.transaction.data[testIndexes['data']]
      tx.gasLimit = testData.transaction.gasLimit[testIndexes['gas']]
      tx.value = testData.transaction.value[testIndexes['value']]

      if (tx.accessLists !== undefined) {
        tx.accessList = testData.transaction.accessLists[testIndexes['data']]
        if (tx.chainId === undefined) {
          tx.chainId = 1
        }
      }

      return {
        transaction: tx,
        postStateRoot: testCase['hash'],
        logs: testCase['logs'],
        env: testData['env'],
        pre: testData['pre'],
        expectException: testCase['expectException'],
      }
    })
  }

  testCases = testCases.filter((testCase: any) => {
    return testCase !== null
  })

  return testCases
}

export async function setupStateTestVM(
  common: Common,
  testData: any
): Promise<{
  vm: VM
  tx: LegacyTransaction | AccessListEIP2930Transaction | FeeMarketEIP1559Transaction | undefined
  execInfo: string
}> {
  // Have to create a blockchain with empty block as genesisBlock for Merge
  // Otherwise mainnet genesis will throw since this has difficulty nonzero
  const genesisBlock = new Block(undefined, undefined, undefined, undefined, { common })
  const blockchain = await Blockchain.create({ genesisBlock, common })
  const state = new Trie({ useKeyHashing: true })
  const stateManager = new DefaultStateManager({
    trie: state,
    common,
  })
  const vm = await VM.create({ stateManager, common, blockchain })
  await setupPreConditions(vm.stateManager, testData)
  let execInfo = ''
  let tx
  try {
    tx = makeTx(testData.transaction, { common })
  } catch (e: any) {
    execInfo = 'tx instantiation exception'
  }
  // Even if no txs are ran, coinbase should always be created
  const coinbaseAddress = Address.fromString(testData.env.currentCoinbase)
  const account = await (<VM>vm).stateManager.getAccount(coinbaseAddress)
  await (<VM>vm).evm.journal.putAccount(coinbaseAddress, account ?? new Account())
  return { vm, tx, execInfo }
}
function formatBlockHeader(data: any) {
  const formatted: any = {}
  for (const [key, value] of Object.entries(data) as [string, string][]) {
    formatted[key] = isHexPrefixed(value) ? value : BigInt(value)
  }
  return formatted
}
export async function setupBlockchainTestVM(
  common: Common,
  testData: any
): Promise<{ vm: VM; blockchain: Blockchain; state: Trie }> {
  common.setHardforkBy({ blockNumber: 0 })
  const cacheDB = new MapDB()
  const state = new Trie({ useKeyHashing: true })
  const stateManager = new DefaultStateManager({
    trie: state,
    common,
  })
  let validatePow = false
  // Only run with block validation when sealEngine present in test file
  // and being set to Ethash PoW validation
  if (testData.sealEngine === 'Ethash') {
    if (common.consensusAlgorithm() !== ConsensusAlgorithm.Ethash) {
      it.skip('SealEngine setting is not matching chain consensus type, skip test.')
    }
    validatePow = true
  }

  // create and add genesis block
  const header = formatBlockHeader(testData.genesisBlockHeader)
  const withdrawals = common.isActivatedEIP(4895) ? [] : undefined
  const blockData = { header, withdrawals }
  const genesisBlock = Block.fromBlockData(blockData, { common })

  const blockchain = await Blockchain.create({
    common,
    validateBlocks: true,
    validateConsensus: validatePow,
    genesisBlock,
  })

  if (validatePow) {
    ;(blockchain.consensus as EthashConsensus)._ethash!.cacheDB = cacheDB as any
  }

  const vm = await VM.create({
    stateManager,
    blockchain,
    common,
    setHardfork: true,
  })

  // set up pre-state
  await setupPreConditions(vm.stateManager, testData)
  if (typeof testData.genesisRLP === 'string') {
    const rlp = toBytes(testData.genesisRLP)
    assert.deepEqual(genesisBlock.serialize(), rlp, 'correct genesis RLP')
  }
  assert.deepEqual(
    (vm.stateManager as any)._trie.root(),
    genesisBlock.header.stateRoot,
    'correct state root'
  )
  return { vm, blockchain, state }
}

export const defaultStateTestArgs: TestArgs = {
  state: true,
  skip: 'ALL',
  runSkipped: 'NONE',
  'verify-test-amount-alltests': 1,
}
export const defaultBlockchainTestArgs: TestArgs = {
  blockchain: true,
  skip: 'ALL',
  runSkipped: 'NONE',
  'verify-test-amount-alltests': 1,
}

const parseInput = (input: string | undefined, bool: boolean = false) => {
  if (input === undefined) {
    return undefined
  }
  if (input === '') {
    return undefined
  }
  if (input === 'true' && bool === false) {
    return undefined
  }
  return input
}

export const testInput = (testType: 'state' | 'blockchain') => {
  const input =
    testType === 'blockchain'
      ? {
          'verify-test-amount-alltests':
            parseInput(process.env.VERIFY_ALLTESTS, true) === undefined ? 0 : 1,
          count:
            parseInput(process.env.COUNT) !== undefined ? parseInt(process.env.COUNT!) : undefined,
          fork: parseInput(process.env.FORK) ?? 'Paris',
          test: parseInput(process.env.BLOCKCHAINTEST),
          skip: parseInput(process.env.SKIP) ?? defaultBlockchainTestArgs.skip,
          runSkipped: parseInput(process.env.RUNSKIPPED) ?? defaultBlockchainTestArgs.runSkipped,
          file: parseInput(process.env.FILE),
          dir: parseInput(process.env.DIR),
          excludeDir: parseInput(process.env.EXCLUDEDIR),
          testsPath: parseInput(process.env.TESTSPATH),
          customTestsPath: parseInput(process.env.CUSTOMTESTSPATH),
          customStateTest:
            parseInput(process.env.CUSTOMSTATETEST) ?? defaultBlockchainTestArgs.customStateTest,
          jsontrace: parseInput(process.env.JSONTRACE, true) !== undefined,
          data: parseInput(process.env.DATA),
          gas: parseInput(process.env.GAS),
          value: parseInput(process.env.VALUE),
          debug: parseInput(process.env.DEBUG, true) !== undefined,
          'expected-test-amount':
            parseInput(process.env.EXPECTEDTESTAMOUNT) !== undefined
              ? parseInt(process.env.EXPECTEDTESTAMOUNT!)
              : undefined,
          reps:
            parseInput(process.env.REPS) !== undefined ? parseInt(process.env.REPS!) : undefined,
        }
      : {
          ['verify-test-amount-alltests']:
            parseInput(process.env.VERIFY_ALLTESTS) === undefined ? 0 : 1,
          count:
            parseInput(process.env.COUNT) !== undefined ? parseInt(process.env.COUNT!) : undefined,
          fork: parseInput(process.env.FORK) ?? 'Paris',
          test: parseInput(process.env.STATETEST),
          skip: parseInput(process.env.SKIP) ?? defaultStateTestArgs.skip,
          runSkipped: parseInput(process.env.RUNSKIPPED) ?? defaultStateTestArgs.runSkipped,
          file: parseInput(process.env.FILE),
          dir: parseInput(process.env.DIR),
          excludeDir: parseInput(process.env.EXCLUDEDIR),
          testsPath: parseInput(process.env.TESTSPATH),
          customTestsPath: parseInput(process.env.CUSTOMTESTSPATH),
          customStateTest:
            parseInput(process.env.CUSTOMSTATETEST) ?? defaultStateTestArgs.customStateTest,
          jsontrace: parseInput(process.env.JSONTRACE, true) !== undefined,
          data: parseInput(process.env.DATA),
          gas: parseInput(process.env.GAS),
          value: parseInput(process.env.VALUE),
          debug: parseInput(process.env.DEBUG, true) !== undefined,
          'expected-test-amount':
            parseInput(process.env.EXPECTEDTESTAMOUNT) !== undefined
              ? parseInt(process.env.EXPECTEDTESTAMOUNT!)
              : undefined,
          reps:
            parseInput(process.env.REPS) !== undefined ? parseInt(process.env.REPS!) : undefined,
        }
  const testArgs =
    testType === 'blockchain'
      ? { ...defaultBlockchainTestArgs, ...input }
      : { ...defaultStateTestArgs, ...input }
  return testArgs
}
