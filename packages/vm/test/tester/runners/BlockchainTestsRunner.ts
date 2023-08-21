import { Block } from '@ethereumjs/block'
import { RLP } from '@ethereumjs/rlp'
import { TransactionFactory } from '@ethereumjs/tx'
import { bytesToBigInt, bytesToHex, hexToBytes, initKZG } from '@ethereumjs/util'
import * as kzg from 'c-kzg'
import fs from 'fs'
import { assert, expect, it, suite } from 'vitest'

import { verifyPostConditions } from '../../util'
import { DEFAULT_FORK_CONFIG, getRequiredForkConfigAlias, getTestDirs } from '../config'
import { getTestsFromArgs, skipTest } from '../testLoader'

import {
  getBlockchainTests,
  getGetterArgs,
  getRunnerArgs,
  getTestPath,
  setupBlockchainTestVM,
} from './runnerUtils'

import type { VM } from '../../../src'
import type {
  BlockChainDirectory,
  FileDirectory,
  FileName,
  TestDirectory,
  TestFile,
  TestSuite,
} from '../testLoader'
import type { RunnerArgs, TestArgs, TestGetterArgs } from './runnerUtils'
import type { Blockchain } from '@ethereumjs/blockchain'
import type { Common } from '@ethereumjs/common'
import type { Trie } from '@ethereumjs/trie'
import type { TaskResult, Test } from 'vitest'

initKZG(kzg, __dirname + '/../../../../client/src/trustedSetups/devnet6.txt')

const name = 'BlockchainTests'

export class BlockchainTests {
  testCount: number
  FORK_CONFIG: string
  FORK_CONFIG_TEST_SUITE: string
  FORK_CONFIG_VM: string
  /**
   * Configuration for getting the tests from the ethereum/tests repository
   */
  testGetterArgs: TestGetterArgs
  /**
   * Run-time configuration
   */
  runnerArgs: RunnerArgs
  runSkipped: string[]
  expectedTests: number
  failingTests: Record<string, (TaskResult | undefined)[]>
  customStateTest: string | undefined
  customTestsPath: string | undefined
  constructor(argv: TestArgs) {
    this.expectedTests = 0
    this.failingTests = {}
    this.testCount = 0
    this.FORK_CONFIG = argv.fork !== undefined ? argv.fork : DEFAULT_FORK_CONFIG
    this.FORK_CONFIG_TEST_SUITE = getRequiredForkConfigAlias(this.FORK_CONFIG)
    this.FORK_CONFIG_VM = this.FORK_CONFIG.charAt(0).toLowerCase() + this.FORK_CONFIG.substring(1)
    this.customStateTest = argv.customStateTest
    this.customTestsPath = argv.customTestsPath
    this.testGetterArgs = getGetterArgs(argv, this.FORK_CONFIG_TEST_SUITE)
    this.runSkipped = this.testGetterArgs.runSkipped ?? []
    this.runnerArgs = getRunnerArgs(argv, this.FORK_CONFIG_VM, this.FORK_CONFIG_TEST_SUITE)
    /**
     * Modify the forkConfig string to ensure it works with RegEx (escape `+` characters)
     */
    if (this.testGetterArgs.forkConfig.includes('+')) {
      let str = this.testGetterArgs.forkConfig
      const indices = []
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '+') {
          indices.push(i)
        }
      }
      // traverse array in reverse order to ensure indices match when we replace the '+' with '/+'
      for (let i = indices.length - 1; i >= 0; i--) {
        str = `${str.slice(0, indices[i])}\\${str.slice(indices[i])}`
      }
      this.testGetterArgs.forkConfig = str
    }
    this.expectedTests = getBlockchainTests(argv, this.FORK_CONFIG_VM) ?? 0
  }
  recordFailing(task: Test<{}>) {
    if (this.failingTests[task.name] !== undefined) {
      this.failingTests[task.name].push(task.result)
    } else {
      this.failingTests[task.name] = [task.result]
    }
  }
  async handleError(error: any, expectException: string | boolean) {
    this.testCount++
    if ((error.message as string).includes('RLP')) {
      expect((expectException as string).includes('RLP')).toBeTruthy()
    }
    assert.ok(typeof expectException === 'string')
  }
  async runTestCase(
    raw: Record<string, any>,
    options: any,
    testData: any,
    currentBlock: bigint,
    blockchain: Blockchain,
    vm: VM,
    common: Common,
    state: Trie
  ) {
    const paramFork = `expectException${options.forkConfigTestSuite}`
    // Two naming conventions in ethereum/tests to indicate "exception occurs on all HFs" semantics
    // Last checked: ethereumjs-testing v1.3.1 (2020-05-11)
    const paramAll1 = 'expectExceptionALL'
    const paramAll2 = 'expectException'
    const expectException = (raw[paramFork] ??
      raw[paramAll1] ??
      raw[paramAll2] ??
      raw.blockHeader === undefined) as string | boolean

    // Here we decode the rlp to extract the block number
    // The block library cannot be used, as this throws on certain EIP1559 blocks when trying to convert
    try {
      const blockRlp = hexToBytes(raw.rlp as string)
      const decodedRLP: any = RLP.decode(blockRlp)
      currentBlock = bytesToBigInt(decodedRLP[0][8])
      // this.testCount++
      // Update common HF
      let TD: bigint | undefined = undefined
      let timestamp: bigint | undefined = undefined
      const decoded: any = RLP.decode(blockRlp)
      const parentHash = decoded[0][0]
      TD = await blockchain.getTotalDifficulty(parentHash)
      timestamp = bytesToBigInt(decoded[0][11])

      common.setHardforkBy({ blockNumber: currentBlock, td: TD, timestamp })

      // transactionSequence is provided when txs are expected to be rejected.>
      // To run this field we try to import them on the current state.
      if (raw.transactionSequence !== undefined) {
        const parentBlock = await vm.blockchain.getIteratorHead()
        const blockBuilder = await vm.buildBlock({
          parentBlock,
          blockOpts: { calcDifficultyFromHeader: parentBlock.header },
        })

        for await (const txData of raw.transactionSequence as Record<
          'exception' | 'rawBytes' | 'valid',
          string
        >[]) {
          const shouldFail = txData.valid === 'false'
          this.testCount++
          try {
            const txRLP = hexToBytes(txData.rawBytes)
            const tx = TransactionFactory.fromSerializedData(txRLP, { common })
            await blockBuilder.addTransaction(tx)
            assert.notOk(shouldFail, 'tx did not fail')
          } catch (e: any) {
            assert.ok(shouldFail, 'tx failed')
          }
        }
        await blockBuilder.revert() // will only revert if checkpointed
      }

      const block = Block.fromRLPSerializedBlock(blockRlp, { common, setHardfork: TD })
      await blockchain.putBlock(block)

      // This is a trick to avoid generating the canonical genesis
      // state. Generating the genesis state is not needed because
      // blockchain tests come with their own `pre` world state.
      // TODO: Add option to `runBlockchain` not to generate genesis state.
      //
      //vm._common.genesis().stateRoot = vm.stateManager._trie.root()
      try {
        this.testCount++
        await blockchain.iterator('vm', async (block: Block) => {
          const parentBlock = await blockchain!.getBlock(block.header.parentHash)
          const parentState = parentBlock.header.stateRoot
          // run block, update head if valid
          try {
            await vm.runBlock({ block, root: parentState, setHardfork: TD })
            // set as new head block
          } catch (error: any) {
            // remove invalid block
            await blockchain!.delBlock(block.header.hash())
            throw error
          }
        })
      } catch (e: any) {
        // if the test fails, then block.header is the prev because
        // vm.runBlock has a check that prevents the actual postState from being
        // imported if it is not equal to the expected postState. it is useful
        // for debugging to skip this, so that verifyPostConditions will compare
        // testData.postState to the actual postState, rather than to the preState.
        if (options.debug !== true) {
          // make sure the state is set before checking post conditions
          const headBlock = await vm.blockchain.getIteratorHead()
          ;(vm.stateManager as any)._trie.root(headBlock.header.stateRoot)
        } else {
          await verifyPostConditions(state, testData.postState)
        }
        throw e
      }
      // })

      expect(
        expectException,
        `expected exception but test did not throw an exception: ${expectException}`
      ).toBeFalsy()
    } catch (error: any) {
      // caught an error, reduce block number
      currentBlock--
      return this.handleError(error, expectException)
    }
  }
  async runBlockchainTest(options: any, testData: Record<string, any>, _id: string) {
    it(_id, async () => {
      const common = options.common.copy()
      const { vm, blockchain, state } = await setupBlockchainTestVM(common, testData)
      const currentBlock = BigInt(0)
      const testBlocks = testData.blocks
      if (testData.network !== options.forkConfigTestSuite) {
        it.skip(
          `skipping test: no data available for ${options.forkConfigTestSuite} (testData.network = ${testData.network})`
        )
        return
      }
      if (testBlocks.length > 0) {
        for await (const raw of testBlocks) {
          this.testCount++
          try {
            await this.runTestCase(
              raw,
              options,
              testData,
              currentBlock,
              blockchain,
              vm,
              common,
              state
            )
          } catch (err: any) {
            return
          }
        }
        this.testCount++
        assert.equal(
          bytesToHex((blockchain as any)._headHeaderHash),
          testData.lastblockhash,
          `_headHeaderHash: ${bytesToHex(
            (blockchain as any)._headHeaderHash
          )} !== testData.lastblockhash ${testData.lastblockhash}`
        )
      }
    })
  }

  skipFn = (name: string, test: Record<string, any>) => {
    const forkFilter = new RegExp(`${this.testGetterArgs.forkConfig}$`)
    return forkFilter.test(test.network) === false || skipTest(name, this.testGetterArgs.skipTests)
  }

  async runTestSuite(testSuite: TestSuite) {
    if (testSuite === undefined || Object.entries(testSuite).length === 0) {
      it.skip('0 tests')
      return
    }
    for (const [testName, test] of Object.entries(testSuite)) {
      await this.runFileDirectory(testName, test)
      delete testSuite[testName]
    }
  }
  async runFileDirectory(dir: string, files: FileDirectory) {
    if (Object.entries(files).length === 0) {
      it.skip('0 Tests')
      return
    }
    suite(dir, async () => {
      for (const [fileName, tests] of Object.entries(files)) {
        if (fileName.endsWith('.json')) {
          await this.runTestFile(fileName, tests)
          delete files[fileName]
        }
      }
    })
  }

  async runTestFile(file: string, testFile: TestFile) {
    suite(file, async () => {
      for (const [testName, test] of Object.entries(testFile)) {
        await this.runBlockchainTest(this.runnerArgs, test, testName)
        delete testFile[testName]
      }
    })
  }

  async runTests(): Promise<void> {
    if (this.customStateTest !== undefined) {
      return
    } else if (this.testGetterArgs.dir !== undefined) {
      const testsPath = getTestPath('BlockchainTests', this.testGetterArgs, this.customTestsPath)

      const files = fs
        .readdirSync(testsPath, {
          encoding: 'utf8',
        })
        .filter((file: FileName) => !file.endsWith('.stub'))

        .map((file: FileName) => {
          const testFile = fs.readFileSync(testsPath + '/' + file, {
            encoding: 'utf8',
          })
          const testCases: TestFile = JSON.parse(testFile)
          for (const testName of Object.keys(testCases)) {
            if (
              skipTest(testName, this.testGetterArgs.skipTests) ||
              (testCases[testName].network !== undefined &&
                testCases[testName].network !== this.FORK_CONFIG_TEST_SUITE) ||
              (testCases[testName].post !== undefined &&
                !Object.keys(testCases[testName].post!).includes(this.FORK_CONFIG_TEST_SUITE))
            ) {
              delete testCases[testName]
            }
          }
          return [file, testCases] as [FileName, TestFile]
        })
        .filter(([, v]) => Object.keys(v).length > 0)
      const subDirs = this.testGetterArgs.dir!.split('/')
      suite('BlockChainTests', async () => {
        if (subDirs.length === 2) {
          await this.runFileDirectory(subDirs[1], Object.fromEntries(files) as FileDirectory)
        } else if (subDirs.length === 3) {
          suite(subDirs[0], async () => {
            suite(subDirs[1], async () => {
              await this.runFileDirectory(subDirs[2], Object.fromEntries(files) as FileDirectory)
            })
          })
        }
      })
    } else {
      const dirs = getTestDirs(this.FORK_CONFIG_VM, name)
      const _tests: TestDirectory<'BlockchainTests'> = {}
      if (dirs.includes('BlockchainTests')) {
        _tests.BlockChainTests = (await getTestsFromArgs(
          'BlockchainTests',
          this.testGetterArgs,
          getTestPath('BlockchainTests', this.testGetterArgs, this.customTestsPath)
        )) as BlockChainDirectory
      }
      if (dirs.includes('LegacyTests/Constantinople/BlockchainTests')) {
        _tests.LegacyTests = {
          Constantinople: {
            BlockChainTests: (await getTestsFromArgs(
              'BlockchainTests',
              this.testGetterArgs,
              getTestPath(
                'LegacyTests/Constantinople/BlockchainTests',
                this.testGetterArgs,
                this.customTestsPath
              )
            )) as BlockChainDirectory,
          },
        }
      }
      suite('BlockChainTests', async () => {
        suite('BlockChainTests', async () => {
          suite('GeneralStateTests', async () => {
            suite('Shanghai', async () => {
              await this.runTestSuite(_tests.BlockChainTests!.GeneralStateTests.Shanghai!)
            })
            suite('VMTests', async () => {
              await this.runTestSuite(_tests.BlockChainTests!.GeneralStateTests.VMTests!)
            })
            const rest = Object.entries(_tests.BlockChainTests!.GeneralStateTests).filter(
              ([dir]) => dir !== 'Shanghai' && dir !== 'VMTests'
            )
            rest.length > 0 &&
              suite('/', async () => {
                for (const [dir, tests] of rest) {
                  await this.runFileDirectory(dir, tests as FileDirectory)
                }
              })
          })

          _tests.BlockChainTests!.InvalidBlocks !== undefined &&
            suite('InvalidBlocks', async () => {
              await this.runTestSuite(_tests.BlockChainTests!.InvalidBlocks!)
            })
          _tests.BlockChainTests!.ValidBlocks !== undefined &&
            suite('ValidBlocks', async () => {
              await this.runTestSuite(_tests.BlockChainTests!.ValidBlocks!)
            })
          if (_tests.BlockChainTests?.TransitionTests !== undefined) {
            suite('TransitionTests', async () => {
              await this.runTestSuite(_tests.BlockChainTests!.TransitionTests!)
            })
          }
        })
        if (_tests.LegacyTests) {
          suite('Legacy BlockChainTests', async () => {
            suite('GeneralStateTests', async () => {
              await this.runTestSuite(
                _tests.LegacyTests!.Constantinople.BlockChainTests.GeneralStateTests
              )
            })
            suite('InvalidBlocks', async () => {
              await this.runTestSuite(
                _tests.LegacyTests!.Constantinople.BlockChainTests.InvalidBlocks
              )
            })
            suite('ValidBlocks', async () => {
              await this.runTestSuite(
                _tests.LegacyTests!.Constantinople.BlockChainTests.ValidBlocks
              )
            })
          })
        }
      })

      if (this.expectedTests > 0) {
        suite('final', async () => {
          it(`Checks test count > ${this.expectedTests}`, async () => {
            expect(this.testCount).toBeGreaterThan(this.expectedTests)
          })
        })
      }
    }
  }
}
