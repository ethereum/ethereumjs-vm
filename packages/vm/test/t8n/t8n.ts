import { Block } from '@ethereumjs/block'
import { EVMMockBlockchain, type Log } from '@ethereumjs/evm'
import { RLP } from '@ethereumjs/rlp'
import { createTxFromTxData } from '@ethereumjs/tx'
import {
  BIGINT_1,
  CLRequestType,
  bigIntToHex,
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  toBytes,
  unpadBytes,
  zeros,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { readFileSync, writeFileSync } from 'fs'
import { loadKZG } from 'kzg-wasm'
import * as mcl from 'mcl-wasm'
import { join } from 'path'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { MCLBLS } from '../../../evm/dist/cjs/index.js'
import { buildBlock } from '../../dist/esm/buildBlock.js'
import { VM } from '../../dist/esm/vm.js'
import { getCommon } from '../tester/config.js'
import { makeBlockFromEnv, setupPreConditions } from '../util.js'

import type { PostByzantiumTxReceipt } from '../../dist/esm/types.js'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

function normalizeNumbers(input: any) {
  const keys = [
    'currentGasLimit',
    'currentNumber',
    'currentTimestamp',
    'currentRandom',
    'currentDifficulty',
    'currentBaseFee',
    'currentBlobGasUsed',
    'currentExcessBlobGas',
    'parentDifficulty',
    'parentTimestamp',
    'parentBaseFee',
    'parentGasUsed',
    'parentGasLimit',
    'parentBlobGasUsed',
    'parentExcessBlobGas',
  ]

  for (const key of keys) {
    const value = input[key]
    if (value !== undefined) {
      if (value.substring(0, 2) !== '0x') {
        input[key] = BigInt(value)
      }
    }
  }
  return input
}

const args = yargs(hideBin(process.argv))
  .option('state.fork', {
    describe: 'Fork to use',
    type: 'string',
  })
  .option('input.alloc', {
    describe: 'Initial state allocation',
    type: 'string',
  })
  .option('inputs.txs', {
    describe: 'RLP input of txs to run on top of the initial state allocation',
    type: 'string',
  })
  .option('inputs.env', {
    describe: 'Input environment (coinbase, difficulty, etc.)',
    type: 'string',
  })
  .option('output.basedir', {
    describe: 'Base directory to write output to',
    type: 'string',
  })
  .option('output.result', {
    describe: 'File to write output results to (relative to `output.basedir`)',
    type: 'string',
  })
  .option('output.alloc', {
    describe: 'File to write output allocation to (after running the transactions)',
    type: 'string',
  }).argv as any

const alloc = JSON.parse(readFileSync(args.input.alloc).toString())
const txsData = JSON.parse(readFileSync(args.input.txs).toString())
const inputEnv = normalizeNumbers(JSON.parse(readFileSync(args.input.env).toString()))

const common = getCommon(args.state.fork, await loadKZG())

const blockchain = new EVMMockBlockchain()

blockchain.getBlock = async function (number?: Number) {
  for (const key in inputEnv.blockHashes) {
    if (Number(key) === number) {
      return {
        hash() {
          return hexToBytes(inputEnv.blockHashes[key])
        },
      }
    }
  }
  return {
    hash() {
      return zeros(32)
    },
  }
}

await mcl.init(mcl.BLS12_381)
const bls = new MCLBLS(mcl)
const evmOpts = {
  bls,
}

const vm = await VM.create({ common, blockchain, evmOpts })

await setupPreConditions(vm.stateManager, { pre: alloc })

const block = makeBlockFromEnv(inputEnv, { common })

// Track the allocation to ensure the output.alloc is correct
const allocTracker: {
  [address: string]: {
    storage: string[]
  }
} = {}

function addAddress(address: string) {
  if (allocTracker[address] === undefined) {
    allocTracker[address] = { storage: [] }
  }
  return allocTracker[address]
}

function addStorage(address: string, storage: string) {
  const storageList = addAddress(address).storage
  if (!storageList.includes(storage)) {
    storageList.push(storage)
  }
}

const originalPutAccount = vm.stateManager.putAccount
const originalPutCode = vm.stateManager.putCode
const originalPutStorage = vm.stateManager.putStorage

vm.stateManager.putAccount = async function (...args: any) {
  const address = <Address>args[0]
  addAddress(address.toString())
  await originalPutAccount.apply(this, args)
}

vm.stateManager.putAccount = async function (...args: any) {
  const address = <Address>args[0]
  addAddress(address.toString())
  return originalPutAccount.apply(this, args)
}

vm.stateManager.putCode = async function (...args: any) {
  console.log('PUTCODE', args[0].toString(), bytesToHex(args[1]))
  const address = <Address>args[0]
  addAddress(address.toString())
  return originalPutCode.apply(this, args)
}

vm.stateManager.putStorage = async function (...args: any) {
  const address = <Address>args[0]
  const key = <Uint8Array>args[1]
  console.log('PUTSTORAGE', address.toString(), bytesToHex(key), bytesToHex(args[2]))
  addStorage(address.toString(), bytesToHex(key))
  return originalPutStorage.apply(this, args)
}

// TODO: add state.reward
//const acc = (await vm.stateManager.getAccount(block.header.coinbase)) ?? new Account()
//await vm.stateManager.putAccount(block.header.coinbase, acc)

const headerData = block.header.toJSON()
headerData.difficulty = inputEnv.parentDifficulty

const builder = await buildBlock(vm, {
  parentBlock: new Block(),
  headerData,
  blockOpts: { putBlockIntoBlockchain: false },
})

const receipts: any = []

let txCounter = 0

let log = true

const logsBuilder: Log[] = []

let txIndex = -BIGINT_1

vm.events.on('afterTx', async (afterTx, continueFn: any) => {
  txIndex++
  const receipt = afterTx.receipt as PostByzantiumTxReceipt

  const formattedLogs = []
  for (const log of receipt.logs) {
    logsBuilder.push(log)

    const entry: any = {
      address: bytesToHex(log[0]),
      topics: log[1].map((e) => bytesToHex(e)),
      data: bytesToHex(log[2]),
      blockNumber: bytesToHex(toBytes(builder['headerData'].number)),
      transactionHash: bytesToHex(afterTx.transaction.hash()),
      transactionIndex: bigIntToHex(txIndex),
      blockHash: bytesToHex(zeros(32)),
      logIndex: bigIntToHex(BigInt(formattedLogs.length)),
      removed: 'false',
    }
    formattedLogs.push(entry)
  }

  const pushReceipt = {
    root: '0x',
    status: receipt.status === 0 ? '0x0' : '0x1',
    cumulativeGasUsed: '0x' + receipt.cumulativeBlockGasUsed.toString(16),
    logsBloom: bytesToHex(receipt.bitvector),
    logs: formattedLogs,
    transactionHash: bytesToHex(afterTx.transaction.hash()),
    contractAddress: '0x0000000000000000000000000000000000000000',
    gasUsed: '0x' + afterTx.totalGasSpent.toString(16),
    blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    transactionIndex: '0x' + txCounter.toString(16),
  }
  console.log('TX DONE')
  log = false
  receipts.push(pushReceipt)
  txCounter++
  continueFn!(undefined)
})

vm.events.on('beforeTx', () => {
  console.log('!---! NEW TX')
  console.log('-------------------------------------------------')
})

vm.evm.events?.on('step', (e) => {
  if (log) {
    console.log(e.address.toString(), e.opcode.name)
  }
})

const rejected: any = []

let index = 0

for (const txData of txsData) {
  try {
    if (txData.v !== undefined) {
      txData.yParity = txData.v
    }
    if (txData.gas !== undefined) {
      txData.gasLimit = txData.gas
    }

    if (txData.authorizationList !== undefined) {
      txData.authorizationList.map((e: any) => {
        if (e.yParity === undefined) {
          e.yParity = e.v
        }
        if (e.yParity === '0x0') {
          e.yParity = '0x'
        }
        if (e.nonce === '0x0') {
          e.nonce = '0x'
        }
        if (e.chainId === '0x0') {
          e.chainId = '0x'
        }
      })
    }
    if (txData.input !== undefined) {
      txData.data = txData.input
    }
    const tx = createTxFromTxData(txData, { common })
    await builder.addTransaction(tx, { allowNoBlobs: true })
  } catch (e: any) {
    rejected.push({
      index,
      error: e.message,
    })
  }
  index++
}

await vm.evm.journal.cleanup()

const result = await builder.build()

const output = {
  stateRoot: bytesToHex(result.header.stateRoot),
  txRoot: bytesToHex(result.header.transactionsTrie),
  receiptsRoot: bytesToHex(result.header.receiptTrie),
  logsHash: bytesToHex(keccak256(RLP.encode(logsBuilder))),
  logsBloom: bytesToHex(result.header.logsBloom),
  receipts,
  gasUsed: bigIntToHex(builder.gasUsed),
}

if (result.header.baseFeePerGas !== undefined) {
  ;(output as any).currentBaseFee = bigIntToHex(result.header.baseFeePerGas)
}

if (result.header.withdrawalsRoot !== undefined) {
  ;(output as any).withdrawalsRoot = bytesToHex(result.header.withdrawalsRoot)
}

if (result.header.blobGasUsed !== undefined) {
  ;(output as any).blobGasUsed = bigIntToHex(result.header.blobGasUsed)
}

if (result.header.excessBlobGas !== undefined) {
  ;(output as any).currentExcessBlobGas = bigIntToHex(result.header.excessBlobGas)
}

if (result.header.requestsRoot !== undefined) {
  ;(output as any).requestsRoot = bytesToHex(result.header.requestsRoot)
}

if (result.requests !== undefined) {
  if (common.isActivatedEIP(6110)) {
    ;(output as any).depositRequests = []
  }

  if (common.isActivatedEIP(7002)) {
    ;(output as any).withdrawalRequests = []
  }

  if (common.isActivatedEIP(7251)) {
    ;(output as any).consolidationRequests = []
  }

  for (const request of result.requests) {
    if (request.type === CLRequestType.Deposit) {
      ;(output as any).depositRequests.push(request.toJSON())
    } else if (request.type === CLRequestType.Withdrawal) {
      ;(output as any).withdrawalRequests.push(request.toJSON())
    } else if (request.type === CLRequestType.Consolidation) {
      ;(output as any).consolidationRequests.push(request.toJSON())
    }
  }
}

if (rejected.length > 0) {
  ;(output as any).rejected = rejected
}

// Build output alloc

for (const addressString in allocTracker) {
  const address = createAddressFromString(addressString)
  const account = await vm.stateManager.getAccount(address)
  if (account === undefined) {
    delete alloc[addressString]
    continue
  }
  if (alloc[addressString] === undefined) {
    alloc[addressString] = {}
  }
  alloc[addressString].nonce = bigIntToHex(account.nonce)
  alloc[addressString].balance = bigIntToHex(account.balance)
  alloc[addressString].code = bytesToHex(await vm.stateManager.getCode(address))

  const storage = allocTracker[addressString].storage
  alloc[addressString].storage = alloc[addressString].storage ?? {}

  for (const key of storage) {
    const keyBytes = hexToBytes(<PrefixedHexString>key)
    let storageKeyTrimmed = bytesToHex(unpadBytes(keyBytes))
    if (storageKeyTrimmed === '0x') {
      storageKeyTrimmed = '0x00'
    }
    const value = await vm.stateManager.getStorage(address, setLengthLeft(keyBytes, 32))
    if (value.length === 0) {
      delete alloc[addressString].storage[storageKeyTrimmed]
      // To be sure, also delete any keys which are left-padded to 32 bytes
      delete alloc[addressString].storage[key]
      continue
    }
    alloc[addressString].storage[storageKeyTrimmed] = bytesToHex(value)
  }
}

const outputAlloc = alloc

const outputResultFilePath = join(args.output.basedir, args.output.result)
const outputAllocFilePath = join(args.output.basedir, args.output.alloc)

writeFileSync(outputResultFilePath, JSON.stringify(output))
writeFileSync(outputAllocFilePath, JSON.stringify(outputAlloc))
