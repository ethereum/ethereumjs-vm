import { Block } from '@ethereumjs/block'
import { Blockchain } from '@ethereumjs/blockchain'
import { InterpreterStep } from '@ethereumjs/evm/dist//interpreter'
import { SecureTrie as Trie } from '@ethereumjs/trie'
import { isTruthy, toBuffer } from '@ethereumjs/util'
import * as tape from 'tape'

import { makeBlockFromEnv, makeTx, setupPreConditions } from '../../util'

function parseTestCases(
  forkConfigTestSuite: string,
  testData: any,
  data: string | undefined,
  gasLimit: string | undefined,
  value: string | undefined
) {
  let testCases = []

  if (isTruthy(testData['post'][forkConfigTestSuite])) {
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

      if (isTruthy(tx.accessLists)) {
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

async function runTestCase(options: any, testData: any, t: tape.Test) {
  let VM
  if (isTruthy(options.dist)) {
    ;({ VM } = require('../../../dist'))
  } else {
    ;({ VM } = require('../../../src'))
  }
  const begin = Date.now()
  const common = options.common

  // Have to create a blockchain with empty block as genesisBlock for Merge
  // Otherwise mainnet genesis will throw since this has difficulty nonzero
  const genesisBlock = new Block(undefined, undefined, undefined, { common })
  const blockchain = await Blockchain.create({ genesisBlock, common })
  const state = new Trie()
  const vm = await VM.create({ state, common, blockchain })

  await setupPreConditions(vm.eei, testData)

  let execInfo = ''
  let tx

  try {
    tx = makeTx(testData.transaction, { common })
  } catch (e: any) {
    execInfo = 'tx instantiation exception'
  }

  if (tx) {
    if (tx.validate()) {
      const block = makeBlockFromEnv(testData.env, { common })

      if (isTruthy(options.jsontrace)) {
        vm.evm.on('step', function (e: InterpreterStep) {
          let hexStack = []
          hexStack = e.stack.map((item: bigint) => {
            return '0x' + item.toString(16)
          })

          const opTrace = {
            pc: e.pc,
            op: e.opcode.name,
            gas: '0x' + e.gasLeft.toString(16),
            gasCost: '0x' + e.opcode.fee.toString(16),
            stack: hexStack,
            depth: e.depth,
            opName: e.opcode.name,
          }

          t.comment(JSON.stringify(opTrace))
        })
        vm.on('afterTx', async () => {
          const stateRoot = {
            stateRoot: vm.stateManager._trie.root.toString('hex'),
          }
          t.comment(JSON.stringify(stateRoot))
        })
      }
      try {
        await vm.runTx({ tx, block })
        execInfo = 'successful tx run'
      } catch (e: any) {
        execInfo = `tx runtime error :${e.message}`
      }
    } else {
      execInfo = 'tx validation failed'
    }
  }

  const stateManagerStateRoot = vm.stateManager._trie.root
  const testDataPostStateRoot = toBuffer(testData.postStateRoot)
  const stateRootsAreEqual = stateManagerStateRoot.equals(testDataPostStateRoot)

  const end = Date.now()
  const timeSpent = `${(end - begin) / 1000} secs`

  t.ok(stateRootsAreEqual, `[ ${timeSpent} ] the state roots should match (${execInfo})`)
  return parseFloat(timeSpent)
}

export async function runStateTest(options: any, testData: any, t: tape.Test) {
  try {
    const testCases = parseTestCases(
      options.forkConfigTestSuite,
      testData,
      options.data,
      options.gasLimit,
      options.value
    )
    if (testCases.length === 0) {
      t.comment(`No ${options.forkConfigTestSuite} post state defined, skip test`)
      return
    }
    for (const testCase of testCases) {
      if (isTruthy(options.reps)) {
        let totalTimeSpent = 0
        for (let x = 0; x < options.reps; x++) {
          totalTimeSpent += await runTestCase(options, testCase, t)
        }
        t.comment(`Average test run: ${(totalTimeSpent / options.reps).toLocaleString()} s`)
      } else {
        await runTestCase(options, testCase, t)
      }
    }
  } catch (e: any) {
    console.log(e)
    t.fail(`error running test case for fork: ${options.forkConfigTestSuite}`)
  }
}
