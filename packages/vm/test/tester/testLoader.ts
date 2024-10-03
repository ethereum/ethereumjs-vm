import * as fs from 'fs'
import * as dir from 'node-dir'
import * as path from 'path'

import { DEFAULT_TESTS_PATH } from './config.js'

const falsePredicate = () => false

/**
 * Returns the list of test files matching the given parameters
 * @param onFile a callback for each file
 * @param fileFilter a {@code RegExp} or array to specify filenames to operate on
 * @param skipPredicate a filtering function for test names
 * @param directory the directory inside the {@code tests/} directory to use
 * @param excludeDir a {@code RegExp} or array to specify directories to ignore
 * @returns the list of test files
 */
export async function getTests(
  onFile: Function,
  fileFilter: RegExp | string[] = /.json$/,
  skipPredicate: (...args: any[]) => boolean = falsePredicate,
  directory: string,
  excludeDir: RegExp | string[] = [],
): Promise<string[]> {
  const options = {
    match: fileFilter,
    excludeDir,
  }
  return new Promise((resolve, reject) => {
    const finishedCallback = (err: Error | undefined, files: string[]) => {
      if (err) {
        reject(err)
        return
      }
      resolve(files)
    }
    const fileCallback = async (
      err: Error | undefined,
      content: string | Uint8Array,
      fileName: string,
      next: Function,
    ) => {
      if (err) {
        reject(err)
        return
      }
      const subDir = fileName.substr(directory.length + 1)
      const parsedFileName = path.parse(fileName).name
      content = content instanceof Uint8Array ? content.toString() : content
      const testsByName = JSON.parse(content)
      const testNames = Object.keys(testsByName)
      for (const testName of testNames) {
        if (!skipPredicate(testName, testsByName[testName])) {
          await onFile(parsedFileName, subDir, testName, testsByName[testName])
        }
      }
      next()
    }

    dir.readFiles(directory, options, fileCallback, finishedCallback)
  })
}

function skipTest(testName: string, skipList = []) {
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
  let test: any = null

  stream
    .on('data', function (data: string) {
      contents += data
    })
    .on('error', function (err: Error) {
      // eslint-disable-next-line no-console
      console.warn('♦︎ [WARN] Please check if submodule `ethereum-tests` is properly loaded.')
      onFile(err)
    })
    .on('end', function () {
      try {
        test = JSON.parse(contents)
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        onFile(e)
      }

      const testName = Object.keys(test)[0]
      const testData = test[testName]
      testData.testName = testName

      onFile(null, testData)
    })
}

/**
 * Get list of test files from supported CLI args
 * @param testType the test type (path segment)
 * @param onFile a callback for each file
 * @param args the CLI args
 * @returns the list of test files
 */
export async function getTestsFromArgs(testType: string, onFile: Function, args: any = {}) {
  let fileFilter, excludeDir, skipFn

  skipFn = (name: string) => {
    return skipTest(name, args.skipTests)
  }
  if (new RegExp(`BlockchainTests`).test(testType)) {
    const forkFilter = new RegExp(`${args.forkConfig}$`)
    skipFn = (name: string, test: any) => {
      return forkFilter.test(test.network) === false || skipTest(name, args.skipTests)
    }
  }
  if (new RegExp(`GeneralStateTests`).test(testType)) {
    const forkFilter = new RegExp(`${args.forkConfig}$`)
    skipFn = (name: string, test: any) => {
      return (
        Object.keys(test['post'])
          .map((key) => forkFilter.test(key))
          .every((e) => !e) || skipTest(name, args.skipTests)
      )
    }
  }
  if (testType === 'VMTests') {
    skipFn = (name: string) => {
      return skipTest(name, args.skipVM)
    }
  }
  if (args.singleSource !== undefined) {
    return getTestFromSource(args.singleSource, onFile)
  }
  if (args.file !== undefined) {
    fileFilter = new RegExp(args.file)
  }
  if (args.excludeDir !== undefined) {
    excludeDir = new RegExp(args.excludeDir)
  }
  if (args.test !== undefined) {
    skipFn = (testName: string) => {
      return testName !== args.test
    }
  }

  return getTests(onFile, fileFilter, skipFn, args.directory, excludeDir)
}

/**
 * Returns a single file from the ethereum-tests git submodule
 * @param file
 */
export function getSingleFile(file: string) {
  return require(path.join(DEFAULT_TESTS_PATH, file))
}
