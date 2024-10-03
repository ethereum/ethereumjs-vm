import { Hardfork } from '@ethereumjs/common'
import { Blob4844Tx } from '@ethereumjs/tx'
import {
  BIGINT_1,
  BIGINT_2,
  TypeOutput,
  bigIntToUnpaddedBytes,
  bytesToHex,
  concatBytes,
  createZeroAddress,
  equalsBytes,
  toBytes,
  toType,
} from '@ethereumjs/util'
import { BuildStatus, buildBlock } from '@ethereumjs/vm'
import { keccak256 } from 'ethereum-cryptography/keccak'

import type { Config } from '../config.js'
import type { TxPool } from '../service/txpool.js'
import type { Block, HeaderData } from '@ethereumjs/block'
import type { TypedTransaction } from '@ethereumjs/tx'
import type { PrefixedHexString, WithdrawalData } from '@ethereumjs/util'
import type { BlockBuilder, TxReceipt, VM } from '@ethereumjs/vm'

interface PendingBlockOpts {
  /* Config */
  config: Config

  /* Tx Pool */
  txPool: TxPool

  /* Skip hardfork validation */
  skipHardForkValidation?: boolean
}

export interface BlobsBundle {
  blobs: PrefixedHexString[]
  commitments: PrefixedHexString[]
  proofs: PrefixedHexString[]
}
/**
 * In the future this class should build a pending block by keeping the
 * transaction set up-to-date with the state of local mempool until called.
 *
 * For now this simple implementation just adds txs from the pool when
 * started and called.
 */

// Max two payload to be cached
const MAX_PAYLOAD_CACHE = 2

enum AddTxResult {
  Success,
  BlockFull,
  SkippedByGasLimit,
  SkippedByErrors,
  RemovedByErrors,
}

export class PendingBlock {
  config: Config
  txPool: TxPool

  pendingPayloads: Map<string, BlockBuilder> = new Map()
  blobsBundles: Map<string, BlobsBundle> = new Map()

  private skipHardForkValidation?: boolean

  constructor(opts: PendingBlockOpts) {
    this.config = opts.config
    this.txPool = opts.txPool
    this.skipHardForkValidation = opts.skipHardForkValidation
  }

  pruneSetToMax(maxItems: number): number {
    let itemsToDelete = this.pendingPayloads.size - maxItems
    const deletedItems = Math.max(0, itemsToDelete)

    if (itemsToDelete > 0) {
      // keys are in fifo order
      for (const payloadId of this.pendingPayloads.keys()) {
        this.stop(payloadId)
        itemsToDelete--
        if (itemsToDelete <= 0) {
          break
        }
      }
    }
    return deletedItems
  }

  /**
   * Starts building a pending block with the given payload
   * @returns an 8-byte payload identifier to call {@link BlockBuilder.build} with
   */
  async start(
    vm: VM,
    parentBlock: Block,
    headerData: Partial<HeaderData> = {},
    withdrawals?: WithdrawalData[],
  ) {
    const number = parentBlock.header.number + BIGINT_1
    const { timestamp, mixHash, parentBeaconBlockRoot, coinbase } = headerData
    let { gasLimit } = parentBlock.header

    vm.common.setHardforkBy({
      blockNumber: number,
      timestamp,
    })

    const baseFeePerGas = parentBlock.header.common.isActivatedEIP(1559)
      ? parentBlock.header.calcNextBaseFee()
      : undefined

    if (number === vm.common.hardforkBlock(Hardfork.London)) {
      gasLimit = gasLimit * BIGINT_2
    }

    // payload is uniquely defined by timestamp, parent and mixHash, gasLimit can also be
    // potentially included in the fcU in future and can be safely added in uniqueness calc
    const timestampBuf = bigIntToUnpaddedBytes(toType(timestamp ?? 0, TypeOutput.BigInt))
    const gasLimitBuf = bigIntToUnpaddedBytes(gasLimit)
    const mixHashBuf = toType(mixHash!, TypeOutput.Uint8Array) ?? new Uint8Array(32)
    const parentBeaconBlockRootBuf =
      toType(parentBeaconBlockRoot!, TypeOutput.Uint8Array) ?? new Uint8Array(32)
    const coinbaseBuf = toType(coinbase ?? new Uint8Array(20), TypeOutput.Uint8Array)

    let withdrawalsBuf = new Uint8Array()

    if (withdrawals !== undefined && withdrawals !== null) {
      const withdrawalsBufTemp: Uint8Array[] = []
      for (const withdrawal of withdrawals) {
        const indexBuf = bigIntToUnpaddedBytes(toType(withdrawal.index ?? 0, TypeOutput.BigInt))
        const validatorIndex = bigIntToUnpaddedBytes(
          toType(withdrawal.validatorIndex ?? 0, TypeOutput.BigInt),
        )
        const address = toType(withdrawal.address ?? createZeroAddress(), TypeOutput.Uint8Array)
        const amount = bigIntToUnpaddedBytes(toType(withdrawal.amount ?? 0, TypeOutput.BigInt))
        withdrawalsBufTemp.push(concatBytes(indexBuf, validatorIndex, address, amount))
      }
      withdrawalsBuf = concatBytes(...withdrawalsBufTemp)
    }

    const keccakFunction = this.config.chainCommon.customCrypto.keccak256 ?? keccak256

    const payloadIdBytes = toBytes(
      keccakFunction(
        concatBytes(
          parentBlock.hash(),
          mixHashBuf,
          timestampBuf,
          gasLimitBuf,
          parentBeaconBlockRootBuf,
          coinbaseBuf,
          withdrawalsBuf,
        ),
      ).subarray(0, 8),
    )
    const payloadId = bytesToHex(payloadIdBytes)

    // If payload has already been triggered, then return the payloadid
    if (this.pendingPayloads.get(payloadId) !== undefined) {
      return payloadIdBytes
    }

    // Prune the builders and blobsbundles
    this.pruneSetToMax(MAX_PAYLOAD_CACHE)

    // Set the state root to ensure the resulting state
    // is based on the parent block's state
    await vm.stateManager.setStateRoot(parentBlock.header.stateRoot)

    const builder = await buildBlock(vm, {
      parentBlock,
      // excessBlobGas will be correctly calculated and set in buildBlock constructor,
      // unless already explicity provided in headerData
      headerData: {
        ...headerData,
        number,
        gasLimit,
        baseFeePerGas,
      },
      withdrawals,
      blockOpts: {
        putBlockIntoBlockchain: false,
        setHardfork: true,
      },
    })

    this.pendingPayloads.set(payloadId, builder)

    // Get if and how many blobs are allowed in the tx
    let allowedBlobs
    if (vm.common.isActivatedEIP(4844)) {
      const blobGasLimit = vm.common.param('maxblobGasPerBlock')
      const blobGasPerBlob = vm.common.param('blobGasPerBlob')
      allowedBlobs = Number(blobGasLimit / blobGasPerBlob)
    } else {
      allowedBlobs = 0
    }
    // Add current txs in pool
    const txs = await this.txPool.txsByPriceAndNonce(vm, {
      baseFee: baseFeePerGas,
      allowedBlobs,
    })
    this.config.logger.info(
      `Pending: Assembling block from ${txs.length} eligible txs (baseFee: ${baseFeePerGas})`,
    )

    const { addedTxs, skippedByAddErrors, blobTxs } = await this.addTransactions(builder, txs)
    this.config.logger.info(
      `Pending: Added txs=${addedTxs} skippedByAddErrors=${skippedByAddErrors} from total=${txs.length} tx candidates`,
    )

    // Construct initial blobs bundle when payload is constructed
    if (vm.common.isActivatedEIP(4844)) {
      this.constructBlobsBundle(payloadId, blobTxs)
    }
    return payloadIdBytes
  }

  /**
   * Stops a pending payload
   */
  stop(payloadIdBytes: Uint8Array | string) {
    const payloadId =
      typeof payloadIdBytes !== 'string' ? bytesToHex(payloadIdBytes) : payloadIdBytes
    const builder = this.pendingPayloads.get(payloadId)
    if (builder === undefined) return
    // Revert blockBuilder
    void builder.revert()
    // Remove from pendingPayloads
    this.pendingPayloads.delete(payloadId)
    this.blobsBundles.delete(payloadId)
  }

  /**
   * Returns the completed block
   */
  async build(
    payloadIdBytes: Uint8Array | string,
  ): Promise<void | [block: Block, receipts: TxReceipt[], value: bigint, blobs?: BlobsBundle]> {
    const payloadId =
      typeof payloadIdBytes !== 'string' ? bytesToHex(payloadIdBytes) : payloadIdBytes
    const builder = this.pendingPayloads.get(payloadId)
    if (builder === undefined) {
      return
    }
    const blockStatus = builder.getStatus()
    if (blockStatus.status === BuildStatus.Build) {
      return [
        blockStatus.block,
        builder.transactionReceipts,
        builder.minerValue,
        this.blobsBundles.get(payloadId),
      ]
    }
    const { vm, headerData } = builder as unknown as { vm: VM; headerData: HeaderData }

    // get the number of blobs that can be further added
    let allowedBlobs
    if (vm.common.isActivatedEIP(4844)) {
      const bundle = this.blobsBundles.get(payloadId) ?? { blobs: [], commitments: [], proofs: [] }
      const blobGasLimit = vm.common.param('maxblobGasPerBlock')
      const blobGasPerBlob = vm.common.param('blobGasPerBlob')
      allowedBlobs = Number(blobGasLimit / blobGasPerBlob) - bundle.blobs.length
    } else {
      allowedBlobs = 0
    }

    // Add new txs that the pool received
    const txs = (
      await this.txPool.txsByPriceAndNonce(vm, {
        baseFee: headerData.baseFeePerGas! as bigint,
        allowedBlobs,
      })
    ).filter(
      (tx) =>
        (builder as any).transactions.some((t: TypedTransaction) =>
          equalsBytes(t.hash(), tx.hash()),
        ) === false,
    )

    const { skippedByAddErrors, blobTxs } = await this.addTransactions(builder, txs)

    const block = await builder.build()

    // Construct blobs bundle
    const blobs = block.common.isActivatedEIP(4844)
      ? this.constructBlobsBundle(payloadId, blobTxs)
      : undefined

    const withdrawalsStr =
      block.withdrawals !== undefined ? ` withdrawals=${block.withdrawals.length}` : ''
    const blobsStr = blobs ? ` blobs=${blobs.blobs.length}` : ''
    this.config.logger.info(
      `Pending: Built block number=${block.header.number} txs=${
        block.transactions.length
      }${withdrawalsStr}${blobsStr} skippedByAddErrors=${skippedByAddErrors}  hash=${bytesToHex(
        block.hash(),
      )}`,
    )

    return [block, builder.transactionReceipts, builder.minerValue, blobs]
  }

  private async addTransactions(builder: BlockBuilder, txs: TypedTransaction[]) {
    this.config.logger.info(`Pending: Adding ${txs.length} additional eligible txs`)
    let index = 0
    let blockFull = false
    let skippedByAddErrors = 0
    const blobTxs = []

    while (index < txs.length && !blockFull) {
      const tx = txs[index]
      const addTxResult = await this.addTransaction(builder, tx)

      switch (addTxResult) {
        case AddTxResult.Success:
          // Push the tx in blobTxs only after successful addTransaction
          if (tx instanceof Blob4844Tx) blobTxs.push(tx)
          break

        case AddTxResult.BlockFull:
          blockFull = true
        // Falls through
        default:
          skippedByAddErrors++
      }
      index++
    }

    return {
      addedTxs: index - skippedByAddErrors,
      skippedByAddErrors,
      totalTxs: txs.length,
      blobTxs,
    }
  }

  private async addTransaction(builder: BlockBuilder, tx: TypedTransaction) {
    let addTxResult: AddTxResult

    try {
      await builder.addTransaction(tx, {
        skipHardForkValidation: this.skipHardForkValidation,
      })
      addTxResult = AddTxResult.Success
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if (error.message === 'tx has a higher gas limit than the remaining gas in the block') {
        if (builder.gasUsed > (builder as any).headerData.gasLimit - BigInt(21000)) {
          // If block has less than 21000 gas remaining, consider it full
          this.config.logger.info(`Pending: Assembled block full`)
          addTxResult = AddTxResult.BlockFull
        } else {
          addTxResult = AddTxResult.SkippedByGasLimit
        }
      } else if (error.message.includes('blobs missing') === true) {
        // Remove the blob tx which doesn't has blobs bundled
        this.txPool.removeByHash(bytesToHex(tx.hash()), tx)
        this.config.logger.error(
          `Pending: Removed from txPool a blob tx ${bytesToHex(tx.hash())} with missing blobs`,
        )
        addTxResult = AddTxResult.RemovedByErrors
      } else {
        // If there is an error adding a tx, it will be skipped
        this.config.logger.debug(
          `Pending: Skipping tx ${bytesToHex(
            tx.hash(),
          )}, error encountered when trying to add tx:\n${error}`,
        )
        addTxResult = AddTxResult.SkippedByErrors
      }
    }
    return addTxResult
  }

  /**
   * An internal helper for storing the blob bundle associated with each transaction in an EIP4844 world
   * @param payloadId the payload Id of the pending block
   * @param txs an array of {@Blob4844Tx } transactions
   * @param blockHash the blockhash of the pending block (computed from the header data provided)
   */
  private constructBlobsBundle = (payloadId: string, txs: Blob4844Tx[]) => {
    let blobs: PrefixedHexString[] = []
    let commitments: PrefixedHexString[] = []
    let proofs: PrefixedHexString[] = []
    const bundle = this.blobsBundles.get(payloadId)
    if (bundle !== undefined) {
      blobs = bundle.blobs
      commitments = bundle.commitments
      proofs = bundle.proofs
    }

    for (let tx of txs) {
      tx = tx as Blob4844Tx
      if (tx.blobs !== undefined && tx.blobs.length > 0) {
        blobs = blobs.concat(tx.blobs)
        commitments = commitments.concat(tx.kzgCommitments!)
        proofs = proofs.concat(tx.kzgProofs!)
      }
    }

    const blobsBundle = {
      blobs,
      commitments,
      proofs,
    }
    this.blobsBundles.set(payloadId, blobsBundle)
    return blobsBundle
  }
}
