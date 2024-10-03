import { Block } from '@ethereumjs/block'
import { createBlockchain } from '@ethereumjs/blockchain'
import { type InterpreterStep } from '@ethereumjs/evm'
import { Caches, MerkleStateManager } from '@ethereumjs/statemanager'
import { MerklePatriciaTrie } from '@ethereumjs/trie'
import {
  Account,
  bytesToHex,
  createAddressFromString,
  equalsBytes,
  toBytes,
} from '@ethereumjs/util'

import { createVM, runTx } from '../../../src/index.js'
import { makeBlockFromEnv, makeTx, setupPreConditions } from '../../util.js'

import type * as tape from 'tape'

function parseTestCases(
  forkConfigTestSuite: string,
  testData: any,
  data: string | undefined,
  gasLimit: string | undefined,
  value: string | undefined,
) {
  let testCases = []

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

async function runTestCase(options: any, testData: any, t: tape.Test) {
  const begin = Date.now()
  // Copy the common object to not create long-lasting
  // references in memory which might prevent GC
  const common = options.common.copy()
  // Have to create a blockchain with empty block as genesisBlock for Merge
  // Otherwise mainnet genesis will throw since this has difficulty nonzero
  const genesisBlock = new Block(undefined, undefined, undefined, undefined, { common })
  const blockchain = await createBlockchain({ genesisBlock, common })
  const state = new MerklePatriciaTrie({ useKeyHashing: true, common })
  const stateManager = new MerkleStateManager({
    caches: new Caches(),
    trie: state,
    common,
  })

  const evmOpts = {
    bls: options.bls,
    bn254: options.bn254,
  }
  const vm = await createVM({
    stateManager,
    common,
    blockchain,
    evmOpts,
    profilerOpts: { reportAfterTx: options.profile },
  })

  await setupPreConditions(vm.stateManager, testData)

  let execInfo = ''
  let tx

  try {
    tx = makeTx(testData.transaction, { common })
  } catch (e) {
    if (!(e instanceof Error)) {
      e = new Error(e)
    }
    console.log('error: ', e)
    console.log('testData.transaction: ', testData.transaction)
    execInfo = 'tx instantiation exception'
  }

  // Even if no txs are ran, coinbase should always be created
  const coinbaseAddress = createAddressFromString(testData.env.currentCoinbase)
  const account = await vm.stateManager.getAccount(coinbaseAddress)
  await vm.evm.journal.putAccount(coinbaseAddress, account ?? new Account())

  const stepHandler = (e: InterpreterStep) => {
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
  }

  const afterTxHandler = async () => {
    const stateRoot = {
      stateRoot: bytesToHex(await vm.stateManager.getStateRoot()),
    }
    t.comment(JSON.stringify(stateRoot))
  }

  if (tx) {
    if (tx.isValid()) {
      const block = makeBlockFromEnv(testData.env, { common })

      if (options.jsontrace === true) {
        vm.evm.events!.on('step', stepHandler)
        vm.events.on('afterTx', afterTxHandler)
      }
      try {
        await runTx(vm, { tx, block })
        execInfo = 'successful tx run'
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        console.log(e)
        execInfo = `tx runtime error :${e.message}`
      }
    } else {
      execInfo = 'tx validation failed'
    }
  }

  // Cleanup touched accounts (this wipes coinbase if it is empty on HFs >= TangerineWhistle)
  await vm.evm.journal.cleanup()

  const stateManagerStateRoot = await vm.stateManager.getStateRoot() // Ensure state root is updated (flush all changes to trie)
  const testDataPostStateRoot = toBytes(testData.postStateRoot)
  const stateRootsAreEqual = equalsBytes(stateManagerStateRoot, testDataPostStateRoot)

  const end = Date.now()
  const timeSpent = `${(end - begin) / 1000} secs`

  t.ok(stateRootsAreEqual, `[ ${timeSpent} ] the state roots should match (${execInfo})`)

  vm.evm.events!.removeListener('step', stepHandler)
  vm.events.removeListener('afterTx', afterTxHandler)

  // @ts-ignore Explicitly delete objects for memory optimization (early GC)
  // TODO FIXME
  //common = blockchain = state = stateManager = evm = vm = null // eslint-disable-line

  return parseFloat(timeSpent)
}

export async function runStateTest(options: any, testData: any, t: tape.Test) {
  try {
    const testCases = parseTestCases(
      options.forkConfigTestSuite,
      testData,
      options.data,
      options.gasLimit,
      options.value,
    )
    if (testCases.length === 0) {
      t.comment(`No ${options.forkConfigTestSuite} post state defined, skip test`)
      return
    }
    for (const testCase of testCases) {
      if (options.reps !== undefined && options.reps > 0) {
        let totalTimeSpent = 0
        for (let x = 0; x < options.reps; x++) {
          totalTimeSpent += await runTestCase(options, testCase, t)
        }
        t.comment(`Average test run: ${(totalTimeSpent / options.reps).toLocaleString()} s`)
      } else {
        await runTestCase(options, testCase, t)
      }
    }
  } catch (e) {
    if (!(e instanceof Error)) {
      e = new Error(e)
    }
    console.log(e)
    t.fail(`error running test case for fork: ${options.forkConfigTestSuite}`)
  }
}
