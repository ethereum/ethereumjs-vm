import * as fs from 'fs'
import * as path from 'path'

import { DEFAULT_TESTS_PATH } from './config'

import type { TestGetterArgs } from './runners/runnerUtils'

/**
 * Tests may differ in their input, but all have an _info field
 */
export type TestInput = Record<string, any>
export type TestCase = {
  _info: Record<string, any>
  network?: string
  post?: Record<string, any>
} & Record<string, TestInput>

/**
 * A file is a map of testcase names to tests
 */
export type TestID = string
export type TestFile = Record<TestID, TestCase>

/**
 * File Directory is the .json fileNames mapped to the tests in that file
 */
export type FileName = string
export type FileDirectory = Record<FileName, TestFile>

export type TestTitle = string
export type TestSuite = Record<TestTitle, FileDirectory>

export type StateDirectory = {
  Shanghai?: TestSuite
  VMTests?: TestSuite
} & TestSuite

export interface BlockChainDirectory {
  GeneralStateTests: StateDirectory
  InvalidBlocks: TestSuite
  ValidBlocks: TestSuite
  TransitionTests?: TestSuite
}

export type TestDirectory<TestType extends 'BlockchainTests' | 'GeneralStateTests'> =
  TestType extends 'BlockchainTests'
    ? {
        BlockChainTests?: BlockChainDirectory
        LegacyTests?: {
          Constantinople: {
            BlockChainTests: BlockChainDirectory
          }
        }
      }
    : TestType extends 'GeneralStateTests'
    ? {
        GeneralStateTests?: StateDirectory
        LegacyTests?: {
          Constantinople: {
            GeneralStateTests: StateDirectory
          }
        }
      }
    : never

/**
 * Returns the list of test files matching the given parameters
 * @param onFile a callback for each file
 * @param fileFilter a {@code RegExp} or array to specify filenames to operate on
 * @param skipPredicate a filtering function for test names
 * @param directory the directory inside the {@code tests/} directory to use
 * @param excludeDir a {@code RegExp} or array to specify directories to ignore
 * @returns the list of test files
 */

async function getGeneralStateTests(
  directory: string,
  _excludeDir: RegExp | string[] = [],
  args: TestGetterArgs
): Promise<StateDirectory> {
  const { forkConfig, skipTests, test } = args
  const subDirectories = fs.readdirSync(directory + '', {
    encoding: 'utf8',
  })
  const GeneralStateTests: StateDirectory = Object.fromEntries(
    subDirectories
      .filter((d: string) => d !== 'VMTests' && d !== 'Shanghai')
      .map((testName) => {
        const subSubDirectories = fs.readdirSync(directory + '/' + testName, {
          encoding: 'utf8',
        })
        const testDirectories = Object.fromEntries(
          subSubDirectories
            .filter((file: FileName) => !file.endsWith('.stub'))

            .map((file: FileName) => {
              const testFile = fs.readFileSync(directory + '/' + testName + '/' + file, {
                encoding: 'utf8',
              })
              const testCases: TestFile = JSON.parse(testFile)
              for (const testName of Object.keys(testCases)) {
                if (
                  skipTest(testName, skipTests) ||
                  (testCases[testName].network !== undefined &&
                    testCases[testName].network !== forkConfig) ||
                  (testCases[testName].post !== undefined &&
                    !Object.keys(testCases[testName].post!).includes(forkConfig))
                ) {
                  delete testCases[testName]
                }
              }
              return [file, testCases] as [FileName, TestFile]
            })
            .filter(([, v]) => Object.keys(v).length > 0)
        )
        return [testName, testDirectories]
      })
      .filter(([, v]) => Object.keys(v).length > 0)
  )
  if (!directory.includes('Constantinople')) {
    GeneralStateTests.VMTests = Object.fromEntries(
      fs
        .readdirSync(directory + '/VMTests', {
          encoding: 'utf8',
        })
        .filter((d: string) => test === undefined || d === test)
        .map((sub: string) => {
          return [
            sub,
            Object.fromEntries(
              fs
                .readdirSync(directory + '/VMTests/' + sub, {
                  encoding: 'utf8',
                })
                .filter((file: FileName) => !file.endsWith('.stub'))

                .map((file: FileName) => {
                  const testFile = fs.readFileSync(directory + '/VMTests/' + sub + '/' + file, {
                    encoding: 'utf8',
                  })
                  const testCases: TestFile = JSON.parse(testFile)
                  for (const testName of Object.keys(testCases)) {
                    const forkFilter = new RegExp(`${args.forkConfig}$`)

                    if (
                      (testCases[testName].network !== undefined &&
                        forkFilter.test(testCases[testName].network!) === false) ||
                      (testCases[testName].post !== undefined &&
                        !Object.keys(testCases[testName].post!).includes(forkConfig))
                    ) {
                      delete testCases[testName]
                    }
                  }
                  return [file, testCases] as [FileName, TestFile]
                })
                .filter(([, v]) => Object.keys(v).length > 0)
            ),
          ]
        })
        .filter(([, v]) => Object.keys(v).length > 0)
    )
    GeneralStateTests.Shanghai = Object.fromEntries(
      fs
        .readdirSync(directory + '/Shanghai', {
          encoding: 'utf8',
        })
        .filter((d: string) => test === undefined || d === test)

        .map((testName) => {
          return [
            testName,
            Object.fromEntries(
              fs
                .readdirSync(directory + '/Shanghai/' + testName, {
                  encoding: 'utf8',
                })
                .filter((d: string) => test === undefined || d === test)
                .filter((file: FileName) => !file.endsWith('.stub'))

                .map((file: FileName) => {
                  const testFile = fs.readFileSync(
                    directory + '/Shanghai/' + testName + '/' + file,
                    {
                      encoding: 'utf8',
                    }
                  )
                  const testCases: TestFile = JSON.parse(testFile)

                  for (const testName of Object.keys(testCases)) {
                    const forkFilter = new RegExp(`${args.forkConfig}$`)
                    if (
                      (testCases[testName].network !== undefined &&
                        forkFilter.test(testCases[testName].network!) === false) ||
                      (testCases[testName].post !== undefined &&
                        !Object.keys(testCases[testName].post!).includes(forkConfig))
                    ) {
                      delete testCases[testName]
                    }
                  }
                  return [file, testCases] as [FileName, TestFile]
                })
                .filter(([, v]) => Object.keys(v).length > 0)
            ),
          ]
        })
        .filter(([, v]) => Object.keys(v).length > 0)
    )
    if (Object.keys(GeneralStateTests.Shanghai!).length === 0) {
      delete GeneralStateTests.Shanghai
    }
    if (Object.keys(GeneralStateTests.VMTests!).length === 0) {
      delete GeneralStateTests.VMTests
    }
  }
  return GeneralStateTests
}

async function getBlockchainTests(
  directory: string,
  _excludeDir: RegExp | string[] = [],
  args: TestGetterArgs
): Promise<BlockChainDirectory> {
  const { forkConfig, skipTests, test } = args
  const GeneralStateTests: StateDirectory = await getGeneralStateTests(
    directory + '/GeneralStateTests',
    _excludeDir,
    args
  )
  const InvalidBlocks: TestSuite = Object.fromEntries(
    fs
      .readdirSync(directory + '/InvalidBlocks', {
        encoding: 'utf8',
      })
      .filter((d: string) => test === undefined || d === test)
      .map((d) => {
        return [
          d,
          Object.fromEntries(
            fs
              .readdirSync(directory + '/InvalidBlocks/' + d, { encoding: 'utf8' })
              .map((file: FileName) => {
                const testFile = fs.readFileSync(directory + '/InvalidBlocks/' + d + '/' + file, {
                  encoding: 'utf8',
                })
                const testCases: TestFile = JSON.parse(testFile)
                for (const [testName, test] of Object.entries(testCases)) {
                  const forkFilter = new RegExp(`${args.forkConfig}$`)

                  if (
                    (test.network !== undefined && !forkFilter.test(test.network)) ||
                    skipTests.includes(testName)
                  ) {
                    delete testCases[testName]
                  }
                }
                return [file, testCases] as [FileName, TestFile]
              })
              .filter(([, v]) => Object.keys(v).length > 0)
          ),
        ]
      })
      .filter(([, v]) => Object.keys(v).length > 0)
  )
  const ValidBlocks: TestSuite = Object.fromEntries(
    fs
      .readdirSync(directory + '/ValidBlocks', {
        encoding: 'utf8',
      })
      .filter((d: string) => test === undefined || d === test)

      .map((d) => {
        return [
          d,
          Object.fromEntries(
            fs
              .readdirSync(directory + '/ValidBlocks/' + d, { encoding: 'utf8' })
              .map((file: FileName) => {
                const testFile = fs.readFileSync(directory + '/ValidBlocks/' + d + '/' + file, {
                  encoding: 'utf8',
                })
                const testCases: TestFile = JSON.parse(testFile)
                for (const testName of Object.keys(testCases)) {
                  const forkFilter = new RegExp(`${args.forkConfig}$`)
                  if (
                    testCases[testName].network !== undefined &&
                    forkFilter.test(testCases[testName].network!) === false
                  ) {
                    delete testCases[testName]
                  }
                }
                return [file, testCases] as [FileName, TestFile]
              })
              .filter(([, v]) => Object.keys(v).length > 0)
          ),
        ]
      })
      .filter(([, v]) => Object.keys(v).length > 0)
  )
  const BlockChainTests: BlockChainDirectory = {
    GeneralStateTests: {
      ...GeneralStateTests,
    },
    InvalidBlocks,
    ValidBlocks,
  }
  if (!directory.includes('Constantinople')) {
    BlockChainTests.TransitionTests = Object.fromEntries(
      fs
        .readdirSync(directory + '/TransitionTests', {
          encoding: 'utf8',
        })
        .map((d) => {
          return [
            d,
            Object.fromEntries(
              fs
                .readdirSync(directory + '/TransitionTests/' + d, {
                  encoding: 'utf8',
                })
                .map((file: FileName) => {
                  const testFile = fs.readFileSync(
                    directory + '/TransitionTests/' + d + '/' + file,
                    {
                      encoding: 'utf8',
                    }
                  )

                  const testCases: TestFile = JSON.parse(testFile)
                  for (const testName of Object.keys(testCases)) {
                    if (
                      testCases[testName].network !== forkConfig ||
                      skipTest(testName, skipTests)
                    ) {
                      delete testCases[testName]
                    }
                  }
                  return [file, testCases] as [FileName, TestFile]
                })
                .filter(([, v]) => Object.keys(v).length > 0)
            ),
          ]
        })
        .filter(([, v]) => Object.keys(v).length > 0)
    )
    if (Object.keys(BlockChainTests.TransitionTests!).length === 0) {
      delete BlockChainTests.TransitionTests
    }
  }
  return BlockChainTests
}

export async function getDirectoryTests(
  testType: 'BlockchainTests' | 'GeneralStateTests',
  directory: string,
  _excludeDir: RegExp | string[] = [],
  args: TestGetterArgs
): Promise<BlockChainDirectory | StateDirectory> {
  if (testType === 'BlockchainTests') {
    return getBlockchainTests(directory, _excludeDir, args)
  } else if (testType === 'GeneralStateTests') {
    return getGeneralStateTests(directory, _excludeDir, args)
  } else {
    throw new Error(`Unknown test directory ${directory}`)
  }
}

export function skipTest(testName: string, skipList: string[] = []) {
  return skipList
    .map((skipName) => new RegExp(`^${skipName}`).test(testName))
    .some((isMatch) => isMatch)
}

/**
 * Loads a single test specified in a file
 * @param file path to load a single test from
 * @param onFile callback function invoked with contents of specified file (or an error message)
 */
export function getTestFromSource(file: string, onFile: Function) {
  const stream = fs.createReadStream(file)
  let contents = ''
  let test: Record<string, any> = {}

  stream
    .on('data', function (data: string) {
      contents += data
    })
    .on('error', function (err: Error) {
      // eslint-disable-next-line no-console
      console.warn('♦︎ [WARN] Please check if submodule `ethereum-tests` is properly loaded.')
      onFile(err)
    })
    .on('end', async function () {
      try {
        test = JSON.parse(contents)
      } catch (e: any) {
        onFile(e)
      }

      const testName = Object.keys(test)[0]
      const testData = test[testName]
      testData.testName = testName

      await onFile(null, testData)
    })
}

/**
 * Get list of test files from supported CLI args
 * @param testType the test type (path segment)
 * @param args the CLI args
 * @returns the list of test files
 */

export async function getTestsFromArgs(
  testType: 'GeneralStateTests' | 'BlockchainTests',
  args: TestGetterArgs,
  directory: string
): Promise<BlockChainDirectory | StateDirectory> {
  const excludeDir = args.excludeDir === undefined ? undefined : new RegExp(args.excludeDir)
  let _skipFn: (...args: any) => boolean = (name: string) => {
    return skipTest(name, args.skipTests)
  }
  if (testType === 'BlockchainTests') {
    const forkFilter = new RegExp(`${args.forkConfig}$`)
    _skipFn = (name: string, _test: Record<string, any>) => {
      return forkFilter.test(_test.network) === false || skipTest(name, args.skipTests)
    }
  }
  if (new RegExp(`GeneralStateTests`).test(testType)) {
    const forkFilter = new RegExp(`${args.forkConfig}$`)
    _skipFn = (name: string, test: Record<string, any>) => {
      return (
        Object.keys(test['post'])
          .map((key) => forkFilter.test(key))
          .every((e) => !e) || skipTest(name, args.skipTests)
      )
    }
  }
  const tests = await getDirectoryTests(testType, directory, excludeDir, args)
  return tests
}

/**
 * Returns a single file from the ethereum-tests git submodule
 * @param file
 */
export function getSingleFile(file: string) {
  return require(path.join(DEFAULT_TESTS_PATH, file))
}
