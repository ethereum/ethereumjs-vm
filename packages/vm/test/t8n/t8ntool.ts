import { Block } from '@ethereumjs/block'
import { EVMMockBlockchain, NobleBLS } from '@ethereumjs/evm'
import { RLP } from '@ethereumjs/rlp'
import { createTx } from '@ethereumjs/tx'
import { CLRequestType, bigIntToHex, bytesToHex, hexToBytes, toBytes } from '@ethereumjs/util'
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { readFileSync, writeFileSync } from 'fs'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'
import { join } from 'path'

import { buildBlock, createVM } from '../../src/index.js'
import { rewardAccount } from '../../src/runBlock.js'
import { getCommon } from '../tester/config.js'
import { makeBlockFromEnv, setupPreConditions } from '../util.js'

import { normalizeNumbers } from './helpers.js'
import { StateTracker } from './stateTracker.js'

import type { PostByzantiumTxReceipt } from '../../dist/esm/types.js'
import type { BlockBuilder, VM } from '../../src/index.js'
import type { AfterTxEvent } from '../../src/types.js'
import type { T8NAlloc, T8NEnv, T8NOptions, T8NOutput, T8NReceipt, T8NRejectedTx } from './types.js'
import type { Common } from '@ethereumjs/common'
import type { Log } from '@ethereumjs/evm'
import type { TypedTxData } from '@ethereumjs/tx'
import type {
  ConsolidationRequestV1,
  DepositRequestV1,
  PrefixedHexString,
  WithdrawalRequestV1,
} from '@ethereumjs/util'
const kzg = new microEthKZG(trustedSetup)

/**
 * This is the TransitionTool class to run transitions. The entire class is marked `private` since
 * it is only intended to be used **once**. To use it, use the single public entrypoint TransitionTool.run(args)
 */
export class TransitionTool {
  public options: T8NOptions

  public alloc: T8NAlloc
  public txsData: TypedTxData[]
  public inputEnv: T8NEnv

  public common!: Common
  public vm!: VM

  public stateTracker!: StateTracker

  // Array of rejected txs
  // These are rejected in case of:
  // (1) The transaction is invalid (for instance, an Authorization List tx does not contain an authorization list)
  // (2) The transaction is rejected by the block builder (for instance, if the sender does not have enough funds to pay)
  public rejected: T8NRejectedTx[]

  // Logs tracker (for logsHash)
  public logs: Log[]

  // Receipt tracker (in t8n format)
  public receipts: T8NReceipt[]

  private constructor(args: T8NOptions) {
    this.options = args

    this.alloc = JSON.parse(readFileSync(args.input.alloc).toString())
    this.txsData = normalizeTxData(JSON.parse(readFileSync(args.input.txs).toString()))
    this.inputEnv = normalizeNumbers(JSON.parse(readFileSync(args.input.env).toString()))

    this.rejected = []
    this.logs = []
    this.receipts = []
  }

  static async run(args: T8NOptions) {
    await new TransitionTool(args).run(args)
  }

  private async run(args: T8NOptions) {
    await this.setup(args)

    const block = makeBlockFromEnv(this.inputEnv, { common: this.common })

    const headerData = block.header.toJSON()
    headerData.difficulty = <PrefixedHexString>this.inputEnv.parentDifficulty

    const builder = await buildBlock(this.vm, {
      parentBlock: new Block(),
      headerData,
      blockOpts: { putBlockIntoBlockchain: false },
    })

    let index = 0

    this.vm.events.on('afterTx', (event) => this.afterTx(event, index, builder))

    for (const txData of this.txsData) {
      try {
        const tx = createTx(txData, { common: this.common })
        // Set `allowNoBlobs` to `true`, since the test might not have the blob
        // The 4844-tx at this should still be valid, since it has the `blobHashes` field
        await builder.addTransaction(tx, { allowNoBlobs: true })
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        this.rejected.push({
          index,
          error: e.message,
        })
      }
      index++
    }

    // Reward miner

    if (args.state.reward !== BigInt(-1)) {
      await rewardAccount(this.vm.evm, block.header.coinbase, args.state.reward, this.vm.common)
    }

    const result = await builder.build()

    const convertedOutput = this.getOutput(result)
    const alloc = await this.stateTracker.dumpAlloc()

    this.writeOutput(args, convertedOutput, alloc)
  }

  private async setup(args: T8NOptions) {
    this.common = getCommon(args.state.fork, kzg)

    const blockchain = getBlockchain(this.inputEnv)

    // Setup BLS
    const evmOpts = {
      bls: new NobleBLS(),
    }
    this.vm = await createVM({ common: this.common, blockchain, evmOpts })
    await setupPreConditions(this.vm.stateManager, { pre: this.alloc })

    this.stateTracker = new StateTracker(this.vm, this.alloc)

    if (args.log === true) {
      this.vm.events.on('beforeTx', () => {
        // eslint-disable-next-line no-console
        console.log('Processing new transaction...')
      })
      this.vm.events.on('afterTx', () => {
        // eslint-disable-next-line no-console
        console.log('Done processing transaction (system operations might follow next)')
      })
      this.vm.evm.events?.on('step', (e) => {
        // eslint-disable-next-line no-console
        console.log({
          gasLeft: e.gasLeft.toString(),
          stack: e.stack.map((a) => bigIntToHex(a)),
          opName: e.opcode.name,
          depth: e.depth,
          address: e.address.toString(),
        })
      })
    }
  }

  private afterTx(event: AfterTxEvent, txIndex: number, builder: BlockBuilder) {
    const receipt = event.receipt as PostByzantiumTxReceipt

    const formattedLogs = []
    for (const log of receipt.logs) {
      this.logs.push(log)

      const entry: any = {
        address: bytesToHex(log[0]),
        topics: log[1].map((e) => bytesToHex(e)),
        data: bytesToHex(log[2]),
        blockNumber: bytesToHex(toBytes(builder['headerData'].number)),
        transactionHash: bytesToHex(event.transaction.hash()),
        transactionIndex: bigIntToHex(BigInt(txIndex)),
        blockHash: bytesToHex(new Uint8Array(32)),
        logIndex: bigIntToHex(BigInt(formattedLogs.length)),
        removed: 'false',
      }
      formattedLogs.push(entry)
    }

    this.receipts.push({
      root: '0x',
      status: receipt.status === 0 ? '0x0' : '0x1',
      cumulativeGasUsed: '0x' + receipt.cumulativeBlockGasUsed.toString(16),
      logsBloom: bytesToHex(receipt.bitvector),
      logs: formattedLogs,
      transactionHash: bytesToHex(event.transaction.hash()),
      contractAddress: '0x0000000000000000000000000000000000000000',
      gasUsed: '0x' + event.totalGasSpent.toString(16),
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionIndex: bigIntToHex(BigInt(txIndex)),
    })
  }

  private getOutput(block: Block): T8NOutput {
    const output: T8NOutput = {
      stateRoot: bytesToHex(block.header.stateRoot),
      txRoot: bytesToHex(block.header.transactionsTrie),
      receiptsRoot: bytesToHex(block.header.receiptTrie),
      logsHash: bytesToHex(keccak256(RLP.encode(this.logs))),
      logsBloom: bytesToHex(block.header.logsBloom),
      receipts: this.receipts,
      gasUsed: bigIntToHex(block.header.gasUsed),
    }

    if (block.header.baseFeePerGas !== undefined) {
      output.currentBaseFee = bigIntToHex(block.header.baseFeePerGas)
    }

    if (block.header.withdrawalsRoot !== undefined) {
      output.withdrawalsRoot = bytesToHex(block.header.withdrawalsRoot)
    }

    if (block.header.blobGasUsed !== undefined) {
      output.blobGasUsed = bigIntToHex(block.header.blobGasUsed)
    }

    if (block.header.excessBlobGas !== undefined) {
      output.currentExcessBlobGas = bigIntToHex(block.header.excessBlobGas)
    }

    if (block.header.requestsRoot !== undefined) {
      output.requestsRoot = bytesToHex(block.header.requestsRoot)
    }

    if (block.requests !== undefined) {
      if (this.common.isActivatedEIP(6110)) {
        output.depositRequests = []
      }

      if (this.common.isActivatedEIP(7002)) {
        output.withdrawalRequests = []
      }

      if (this.common.isActivatedEIP(7251)) {
        output.consolidationRequests = []
      }

      for (const request of block.requests) {
        if (request.type === CLRequestType.Deposit) {
          output.depositRequests!.push(<DepositRequestV1>request.toJSON())
        } else if (request.type === CLRequestType.Withdrawal) {
          output.withdrawalRequests!.push(<WithdrawalRequestV1>request.toJSON())
        } else if (request.type === CLRequestType.Consolidation) {
          output.consolidationRequests!.push(<ConsolidationRequestV1>request.toJSON())
        }
      }
    }

    if (this.rejected.length > 0) {
      output.rejected = this.rejected
    }

    return output
  }

  private writeOutput(args: T8NOptions, output: T8NOutput, outputAlloc: T8NAlloc) {
    const outputResultFilePath = join(args.output.basedir, args.output.result)
    const outputAllocFilePath = join(args.output.basedir, args.output.alloc)

    writeFileSync(outputResultFilePath, JSON.stringify(output))
    writeFileSync(outputAllocFilePath, JSON.stringify(outputAlloc))
  }
}

// Helper methods

/**
 * Returns a blockchain with an overridden "getBlock" method to return the correct block hash
 * @param inputEnv the T8NEnv input, which contains a `blockHashes` list containing the respective block hashes
 * @returns
 */
function getBlockchain(inputEnv: T8NEnv) {
  const blockchain = new EVMMockBlockchain()

  blockchain.getBlock = async function (number?: Number) {
    for (const key in inputEnv.blockHashes) {
      if (Number(key) === number) {
        return {
          hash() {
            return hexToBytes(<PrefixedHexString>inputEnv.blockHashes[key])
          },
        }
      }
    }
    return {
      hash() {
        return new Uint8Array(32)
      },
    }
  }
  return blockchain
}

/**
 * Normalizes txData to use with EthereumJS keywords. For instance, 1559-txs have `v` fields on the inputs, where EthereumJS expects `yParity`
 * @param txData Array of txData
 * @returns Normalized array of txData
 */
function normalizeTxData(txData: TypedTxData[]) {
  return txData.map((data: any) => {
    if (data.v !== undefined) {
      data.yParity = data.v
    }
    if (data.gas !== undefined) {
      data.gasLimit = data.gas
    }

    if (data.authorizationList !== undefined) {
      data.authorizationList.map((e: any) => {
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
        if (e.r === '0x0') {
          e.r = '0x'
        }
        if (e.s === '0x0') {
          e.s = '0x'
        }
      })
    }
    if (data.input !== undefined) {
      data.data = data.input
    }
    return data as TypedTxData
  })
}
