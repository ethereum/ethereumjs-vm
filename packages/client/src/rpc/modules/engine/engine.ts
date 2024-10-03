import { Hardfork } from '@ethereumjs/common'
import {
  BIGINT_1,
  bytesToHex,
  bytesToUnprefixedHex,
  equalsBytes,
  hexToBytes,
  toBytes,
} from '@ethereumjs/util'

import { ExecStatus } from '../../../execution/index.js'
import { PendingBlock } from '../../../miner/index.js'
import { PutStatus } from '../../../sync/index.js'
import { short } from '../../../util/index.js'
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  TOO_LARGE_REQUEST,
  UNSUPPORTED_FORK,
  validEngineCodes,
} from '../../error-code.js'
import { callWithStackTrace } from '../../helpers.js'
import { middleware, validators } from '../../validation.js'

import { CLConnectionManager, middleware as cmMiddleware } from './CLConnectionManager.js'
import { type ChainCache, EngineError, type PayloadStatusV1, Status } from './types.js'
import {
  assembleBlock,
  blockToExecutionPayload,
  getPayloadBody,
  pruneCachedBlocks,
  recursivelyFindParents,
  validExecutedChainBlock,
  validHash,
  validate4844BlobVersionedHashes,
  validateHardforkRange,
} from './util/index.js'
import {
  executionPayloadV1FieldValidators,
  executionPayloadV2FieldValidators,
  executionPayloadV3FieldValidators,
  executionPayloadV4FieldValidators,
  forkchoiceFieldValidators,
  payloadAttributesFieldValidatorsV1,
  payloadAttributesFieldValidatorsV2,
  payloadAttributesFieldValidatorsV3,
} from './validators.js'

import type { Chain } from '../../../blockchain/index.js'
import type { EthereumClient } from '../../../client.js'
import type { Config } from '../../../config.js'
import type { VMExecution } from '../../../execution/index.js'
import type { FullEthereumService, Skeleton } from '../../../service/index.js'
import type {
  Bytes32,
  Bytes8,
  ExecutionPayloadBodyV1,
  ExecutionPayloadV1,
  ExecutionPayloadV2,
  ExecutionPayloadV3,
  ExecutionPayloadV4,
  ForkchoiceResponseV1,
  ForkchoiceStateV1,
  PayloadAttributes,
  PayloadAttributesV1,
  PayloadAttributesV2,
  PayloadAttributesV3,
} from './types.js'
import type { Block, ExecutionPayload } from '@ethereumjs/block'
import type { PrefixedHexString } from '@ethereumjs/util'
import type { VM } from '@ethereumjs/vm'

const zeroBlockHash = new Uint8Array(32)

/**
 * engine_* RPC module
 * @memberof module:rpc/modules
 */
export class Engine {
  private client: EthereumClient
  private execution: VMExecution
  private skeleton: Skeleton
  private service: FullEthereumService
  private chain: Chain
  private config: Config
  private vm: VM
  private _rpcDebug: boolean

  private pendingBlock: PendingBlock

  private connectionManager: CLConnectionManager

  private lastNewPayloadHF: string = ''
  private lastForkchoiceUpdatedHF: string = ''

  private remoteBlocks: Map<String, Block>
  private executedBlocks: Map<String, Block>
  private invalidBlocks: Map<String, Error>
  private chainCache: ChainCache

  private lastAnnouncementTime = Date.now()
  private lastAnnouncementStatus = ''

  /**
   * Create engine_* RPC module
   * @param client Client to which the module binds
   */
  constructor(client: EthereumClient, rpcDebug: boolean) {
    this.client = client
    this.service = client.services.find((s) => s.name === 'eth') as FullEthereumService
    this.chain = this.service.chain
    this.config = this.chain.config
    this._rpcDebug = rpcDebug

    if (this.service.execution === undefined) {
      throw Error('execution required for engine module')
    }
    this.execution = this.service.execution
    this.vm = this.execution.vm

    if (this.service.skeleton === undefined) {
      throw Error('skeleton required for engine module')
    }
    this.skeleton = this.service.skeleton

    this.connectionManager = new CLConnectionManager({
      config: this.chain.config,
      inActivityCb: this.logELStatus,
    })
    this.pendingBlock = new PendingBlock({ config: this.config, txPool: this.service.txPool })

    // refactor to move entire chainCache to chain itself including skeleton
    this.remoteBlocks = this.chain.blockCache.remoteBlocks
    this.executedBlocks = this.chain.blockCache.executedBlocks
    this.invalidBlocks = this.chain.blockCache.invalidBlocks
    this.chainCache = {
      remoteBlocks: this.remoteBlocks,
      executedBlocks: this.executedBlocks,
      invalidBlocks: this.invalidBlocks,
      skeleton: this.skeleton,
    }

    this.initValidators()
  }

  /**
   * Log EL sync status
   */
  private logELStatus = () => {
    const forceShowInfo = Date.now() - this.lastAnnouncementTime > 6_000
    if (forceShowInfo) {
      this.lastAnnouncementTime = Date.now()
    }
    const fetcher = this.service.beaconSync?.fetcher

    this.lastAnnouncementStatus = this.skeleton.logSyncStatus('[ EL ]', {
      forceShowInfo,
      lastStatus: this.lastAnnouncementStatus,
      vmexecution: { started: this.execution.started, running: this.execution.running },
      fetching: fetcher !== undefined && fetcher !== null && fetcher.syncErrored === undefined,
      snapsync: this.service.snapsync?.fetcherDoneFlags,
      peers: (this.service.beaconSync as any)?.pool.size,
    })
  }

  /**
   * Configuration and initialization of custom Engine API call validators
   */
  private initValidators() {
    /**
     * newPayload
     */
    this.newPayloadV1 = cmMiddleware(
      middleware(callWithStackTrace(this.newPayloadV1.bind(this), this._rpcDebug), 1, [
        [validators.object(executionPayloadV1FieldValidators)],
      ]),
      ([payload], response) => this.connectionManager.lastNewPayload({ payload, response }),
    )

    this.newPayloadV2 = cmMiddleware(
      middleware(callWithStackTrace(this.newPayloadV2.bind(this), this._rpcDebug), 1, [
        [
          validators.either(
            validators.object(executionPayloadV1FieldValidators),
            validators.object(executionPayloadV2FieldValidators),
          ),
        ],
      ]),
      ([payload], response) => this.connectionManager.lastNewPayload({ payload, response }),
    )

    this.newPayloadV3 = cmMiddleware(
      middleware(
        callWithStackTrace(this.newPayloadV3.bind(this), this._rpcDebug),
        3,
        [
          [validators.object(executionPayloadV3FieldValidators)],
          [validators.array(validators.bytes32)],
          [validators.bytes32],
        ],
        ['executionPayload', 'blobVersionedHashes', 'parentBeaconBlockRoot'],
      ),
      ([payload], response) => this.connectionManager.lastNewPayload({ payload, response }),
    )

    this.newPayloadV4 = cmMiddleware(
      middleware(
        callWithStackTrace(this.newPayloadV4.bind(this), this._rpcDebug),
        3,
        [
          [validators.object(executionPayloadV4FieldValidators)],
          [validators.array(validators.bytes32)],
          [validators.bytes32],
        ],
        ['executionPayload', 'blobVersionedHashes', 'parentBeaconBlockRoot'],
      ),
      ([payload], response) => this.connectionManager.lastNewPayload({ payload, response }),
    )

    /**
     * forkchoiceUpdated
     */
    const forkchoiceUpdatedResponseCMHandler = (
      [state]: ForkchoiceStateV1[],
      response?: ForkchoiceResponseV1 & { headBlock?: Block },
      error?: string,
    ) => {
      this.connectionManager.lastForkchoiceUpdate({
        state,
        response,
        headBlock: response?.headBlock,
        error,
      })
      this.logELStatus()
      delete response?.headBlock
    }

    this.forkchoiceUpdatedV1 = cmMiddleware(
      middleware(callWithStackTrace(this.forkchoiceUpdatedV1.bind(this), this._rpcDebug), 1, [
        [validators.object(forkchoiceFieldValidators)],
        [validators.optional(validators.object(payloadAttributesFieldValidatorsV1))],
      ]),
      forkchoiceUpdatedResponseCMHandler,
    )
    this.forkchoiceUpdatedV2 = cmMiddleware(
      middleware(callWithStackTrace(this.forkchoiceUpdatedV2.bind(this), this._rpcDebug), 1, [
        [validators.object(forkchoiceFieldValidators)],
        [validators.optional(validators.object(payloadAttributesFieldValidatorsV2))],
      ]),
      forkchoiceUpdatedResponseCMHandler,
    )
    this.forkchoiceUpdatedV3 = cmMiddleware(
      middleware(callWithStackTrace(this.forkchoiceUpdatedV3.bind(this), this._rpcDebug), 1, [
        [validators.object(forkchoiceFieldValidators)],
        [validators.optional(validators.object(payloadAttributesFieldValidatorsV3))],
      ]),
      forkchoiceUpdatedResponseCMHandler,
    )

    /**
     * getPayload
     */
    this.getPayloadV1 = cmMiddleware(
      middleware(callWithStackTrace(this.getPayloadV1.bind(this), this._rpcDebug), 1, [
        [validators.bytes8],
      ]),
      () => this.connectionManager.updateStatus(),
    )

    this.getPayloadV2 = cmMiddleware(
      middleware(callWithStackTrace(this.getPayloadV2.bind(this), this._rpcDebug), 1, [
        [validators.bytes8],
      ]),
      () => this.connectionManager.updateStatus(),
    )

    this.getPayloadV3 = cmMiddleware(
      middleware(callWithStackTrace(this.getPayloadV3.bind(this), this._rpcDebug), 1, [
        [validators.bytes8],
      ]),
      () => this.connectionManager.updateStatus(),
    )

    this.getPayloadV4 = cmMiddleware(
      middleware(callWithStackTrace(this.getPayloadV4.bind(this), this._rpcDebug), 1, [
        [validators.bytes8],
      ]),
      () => this.connectionManager.updateStatus(),
    )

    /**
     * exchangeCapabilities
     */
    this.exchangeCapabilities = cmMiddleware(
      middleware(callWithStackTrace(this.exchangeCapabilities.bind(this), this._rpcDebug), 0, []),
      () => this.connectionManager.updateStatus(),
    )

    /**
     * getPayloadBodiesByHash
     */
    this.getPayloadBodiesByHashV1 = cmMiddleware(
      middleware(callWithStackTrace(this.getPayloadBodiesByHashV1.bind(this), this._rpcDebug), 1, [
        [validators.array(validators.bytes32)],
      ]),
      () => this.connectionManager.updateStatus(),
    )

    /**
     * getPayloadBodiesByRange
     */
    this.getPayloadBodiesByRangeV1 = cmMiddleware(
      middleware(callWithStackTrace(this.getPayloadBodiesByRangeV1.bind(this), this._rpcDebug), 2, [
        [validators.bytes8],
        [validators.bytes8],
      ]),
      () => this.connectionManager.updateStatus(),
    )
  }

  /**
   * Verifies the payload according to the execution environment
   * rule set (EIP-3675) and returns the status of the verification.
   *
   * @param params An array of one parameter:
   *   1. An object as an instance of {@link ExecutionPayloadV1}
   * @returns An object of shape {@link PayloadStatusV1}:
   *   1. status: String - the result of the payload execution
   *        VALID - given payload is valid
   *        INVALID - given payload is invalid
   *        SYNCING - sync process is in progress
   *        ACCEPTED - blockHash is valid, doesn't extend the canonical chain, hasn't been fully validated
   *        INVALID_BLOCK_HASH - blockHash validation failed
   *   2. latestValidHash: DATA|null - the hash of the most recent
   *      valid block in the branch defined by payload and its ancestors
   *   3. validationError: String|null - validation error message
   */
  private async newPayload(
    params: [ExecutionPayload, (Bytes32[] | null)?, (Bytes32 | null)?],
  ): Promise<PayloadStatusV1> {
    const [payload, blobVersionedHashes, parentBeaconBlockRoot] = params
    if (this.config.synchronized) {
      this.connectionManager.newPayloadLog()
    }
    const { parentHash, blockHash } = payload

    // we can be strict and return with invalid if this block was previous invalidated in
    // invalidBlocks cache, but to have a more robust behavior instead:
    //
    // we remove this block from invalidBlocks for it to be evaluated again against the
    // new data/corrections the CL might be calling newPayload with
    this.invalidBlocks.delete(blockHash.slice(2))

    /**
     * See if block can be assembled from payload
     */
    // newpayloadv3 comes with parentBeaconBlockRoot out of the payload
    const { block: headBlock, error } = await assembleBlock(
      {
        ...payload,
        // ExecutionPayload only handles undefined
        parentBeaconBlockRoot: parentBeaconBlockRoot ?? undefined,
      },
      this.chain,
      this.chainCache,
    )
    if (headBlock === undefined || error !== undefined) {
      let response = error
      if (!response) {
        const validationError = `Error assembling block from payload during initialization`
        this.config.logger.debug(validationError)
        const latestValidHash = await validHash(
          hexToBytes(parentHash as PrefixedHexString),
          this.chain,
          this.chainCache,
        )
        response = { status: Status.INVALID, latestValidHash, validationError }
      }
      // skip marking the block invalid as this is more of a data issue from CL
      return response
    }

    /**
     * Validate blob versioned hashes in the context of EIP-4844 blob transactions
     */
    if (headBlock.common.isActivatedEIP(4844)) {
      let validationError: string | null = null
      if (blobVersionedHashes === undefined || blobVersionedHashes === null) {
        validationError = `Error verifying blobVersionedHashes: received none`
      } else {
        validationError = validate4844BlobVersionedHashes(headBlock, blobVersionedHashes)
      }

      // if there was a validation error return invalid
      if (validationError !== null) {
        this.config.logger.debug(validationError)
        const latestValidHash = await validHash(
          hexToBytes(parentHash as PrefixedHexString),
          this.chain,
          this.chainCache,
        )
        const response = { status: Status.INVALID, latestValidHash, validationError }
        // skip marking the block invalid as this is more of a data issue from CL
        return response
      }
    } else if (blobVersionedHashes !== undefined && blobVersionedHashes !== null) {
      const validationError = `Invalid blobVersionedHashes before EIP-4844 is activated`
      const latestValidHash = await validHash(
        hexToBytes(parentHash as PrefixedHexString),
        this.chain,
        this.chainCache,
      )
      const response = { status: Status.INVALID, latestValidHash, validationError }
      // skip marking the block invalid as this is more of a data issue from CL
      return response
    }

    /**
     * Stats and hardfork updates
     */
    this.connectionManager.updatePayloadStats(headBlock)
    const hardfork = headBlock.common.hardfork()
    if (hardfork !== this.lastNewPayloadHF && this.lastNewPayloadHF !== '') {
      this.config.logger.info(
        `Hardfork change along new payload block number=${headBlock.header.number} hash=${short(
          headBlock.hash(),
        )} old=${this.lastNewPayloadHF} new=${hardfork}`,
      )
    }
    this.lastNewPayloadHF = hardfork

    try {
      /**
       * get the parent from beacon skeleton or from remoteBlocks cache or from the chain
       * to run basic validations based on parent
       */
      const parent =
        (await this.skeleton.getBlockByHash(hexToBytes(parentHash as PrefixedHexString), true)) ??
        this.remoteBlocks.get(parentHash.slice(2)) ??
        (await this.chain.getBlock(hexToBytes(parentHash as PrefixedHexString)))

      /**
       * validate 4844 transactions and fields as these validations generally happen on putBlocks
       * when parent is confirmed to be in the chain. But we can do it here early
       */
      if (headBlock.common.isActivatedEIP(4844)) {
        try {
          headBlock.validateBlobTransactions(parent.header)
        } catch {
          const validationError = `Invalid 4844 transactions: ${error}`
          const latestValidHash = await validHash(
            hexToBytes(parentHash as PrefixedHexString),
            this.chain,
            this.chainCache,
          )
          const response = { status: Status.INVALID, latestValidHash, validationError }
          // skip marking the block invalid as this is more of a data issue from CL
          return response
        }
      }

      /**
       * Check for executed parent
       */
      const executedParentExists =
        this.executedBlocks.get(parentHash.slice(2)) ??
        (await validExecutedChainBlock(hexToBytes(parentHash as PrefixedHexString), this.chain))
      // If the parent is not executed throw an error, it will be caught and return SYNCING or ACCEPTED.
      if (!executedParentExists) {
        throw new Error(`Parent block not yet executed number=${parent.header.number}`)
      }
    } catch {
      // Stash the block for a potential forced forkchoice update to it later.
      this.remoteBlocks.set(bytesToUnprefixedHex(headBlock.hash()), headBlock)

      const optimisticLookup = !(await this.skeleton.setHead(headBlock, false))
      /**
       * Invalid skeleton PUT
       */
      if (
        this.skeleton.fillStatus?.status === PutStatus.INVALID &&
        optimisticLookup &&
        headBlock.header.number >= this.skeleton.fillStatus.height
      ) {
        const latestValidHash =
          this.chain.blocks.latest !== null
            ? await validHash(this.chain.blocks.latest.hash(), this.chain, this.chainCache)
            : bytesToHex(new Uint8Array(32))
        const response = {
          status: Status.INVALID,
          validationError: this.skeleton.fillStatus.validationError ?? '',
          latestValidHash,
        }
        return response
      }

      /**
       * Invalid execution
       */
      if (
        this.execution.chainStatus?.status === ExecStatus.INVALID &&
        optimisticLookup &&
        headBlock.header.number >= this.execution.chainStatus.height
      ) {
        // if the invalid block is canonical along the current chain return invalid
        const invalidBlock = await this.skeleton.getBlockByHash(
          this.execution.chainStatus.hash,
          true,
        )
        if (invalidBlock !== undefined) {
          // hard luck: block along canonical chain is invalid
          const latestValidHash = await validHash(
            invalidBlock.header.parentHash,
            this.chain,
            this.chainCache,
          )
          const validationError = `Block number=${invalidBlock.header.number} hash=${short(
            invalidBlock.hash(),
          )} root=${short(invalidBlock.header.stateRoot)} along the canonical chain is invalid`

          const response = {
            status: Status.INVALID,
            latestValidHash,
            validationError,
          }
          return response
        }
      }

      const status =
        // If the transitioned to beacon sync and this block can extend beacon chain then
        optimisticLookup === true ? Status.SYNCING : Status.ACCEPTED
      const response = { status, validationError: null, latestValidHash: null }
      return response
    }

    // This optimistic lookup keeps skeleton updated even if for e.g. beacon sync might not have
    // been initialized here but a batch of blocks new payloads arrive, most likely during sync
    // We still can't switch to beacon sync here especially if the chain is pre merge and there
    // is pow block which this client would like to mint and attempt proposing it
    //
    // Call skeleton.setHead without forcing head change to return if the block is reorged or not
    // Do optimistic lookup if not reorged
    //
    // TODO: Determine if this optimistic lookup can be combined with the optimistic lookup above
    // from within the catch clause (by skipping the code from the catch clause), code looks
    // identical, same for executedBlockExists code below ??
    const optimisticLookup = !(await this.skeleton.setHead(headBlock, false))
    if (
      this.skeleton.fillStatus?.status === PutStatus.INVALID &&
      optimisticLookup &&
      headBlock.header.number >= this.skeleton.fillStatus.height
    ) {
      const latestValidHash =
        this.chain.blocks.latest !== null
          ? await validHash(this.chain.blocks.latest.hash(), this.chain, this.chainCache)
          : bytesToHex(new Uint8Array(32))
      const response = {
        status: Status.INVALID,
        validationError: this.skeleton.fillStatus.validationError ?? '',
        latestValidHash,
      }
      return response
    }

    this.remoteBlocks.set(bytesToUnprefixedHex(headBlock.hash()), headBlock)

    // we should check if the block exists executed in remoteBlocks or in chain as a check since stateroot
    // exists in statemanager is not sufficient because an invalid crafted block with valid block hash with
    // some pre-executed stateroot can be sent
    const executedBlockExists =
      this.executedBlocks.get(blockHash.slice(2)) ??
      (await validExecutedChainBlock(hexToBytes(blockHash as PrefixedHexString), this.chain))
    if (executedBlockExists) {
      const response = {
        status: Status.VALID,
        latestValidHash: blockHash as PrefixedHexString,
        validationError: null,
      }
      return response
    }

    if (
      this.execution.chainStatus?.status === ExecStatus.INVALID &&
      optimisticLookup &&
      headBlock.header.number >= this.execution.chainStatus.height
    ) {
      // if the invalid block is canonical along the current chain return invalid
      const invalidBlock = await this.skeleton.getBlockByHash(this.execution.chainStatus.hash, true)
      if (invalidBlock !== undefined) {
        // hard luck: block along canonical chain is invalid
        const latestValidHash = await validHash(
          invalidBlock.header.parentHash,
          this.chain,
          this.chainCache,
        )
        const validationError = `Block number=${invalidBlock.header.number} hash=${short(
          invalidBlock.hash(),
        )} root=${short(invalidBlock.header.stateRoot)} along the canonical chain is invalid`

        const response = {
          status: Status.INVALID,
          latestValidHash,
          validationError,
        }
        return response
      }
    }

    /**
     * 1. Determine non-executed blocks from beyond vmHead to headBlock
     * 2. Iterate through non-executed blocks
     * 3. Determine if block should be executed by some extra conditions
     * 4. Execute block with this.execution.runWithoutSetHead()
     */
    const vmHead =
      this.chainCache.executedBlocks.get(parentHash.slice(2)) ??
      (await this.chain.blockchain.getIteratorHead())
    let blocks: Block[]
    try {
      // find parents till vmHead but limit lookups till engineParentLookupMaxDepth
      blocks = await recursivelyFindParents(vmHead.hash(), headBlock.header.parentHash, this.chain)
    } catch (error) {
      const response = { status: Status.SYNCING, latestValidHash: null, validationError: null }
      return response
    }

    blocks.push(headBlock)

    let lastBlock: Block
    try {
      for (const [i, block] of blocks.entries()) {
        lastBlock = block
        const bHash = block.hash()

        const isBlockExecuted =
          (this.executedBlocks.get(bytesToUnprefixedHex(bHash)) ??
            (await validExecutedChainBlock(bHash, this.chain))) !== null

        if (!isBlockExecuted) {
          // Only execute
          //   i) if number of blocks pending to be executed are within limit
          //   ii) Txs to execute in blocking call is within the supported limit
          // else return SYNCING/ACCEPTED and let skeleton led chain execution catch up
          const shouldExecuteBlock =
            blocks.length - i <= this.chain.config.engineNewpayloadMaxExecute &&
            block.transactions.length <= this.chain.config.engineNewpayloadMaxTxsExecute

          const executed =
            shouldExecuteBlock &&
            (await (async () => {
              // just keeping its name different from the parentBlock to not confuse the context even
              // though scope rules will not let it conflict with the parent of the new payload block
              const blockParent =
                i > 0
                  ? blocks[i - 1]
                  : (this.chainCache.remoteBlocks.get(
                      bytesToHex(block.header.parentHash).slice(2),
                    ) ?? (await this.chain.getBlock(block.header.parentHash)))
              const blockExecuted = await this.execution.runWithoutSetHead({
                block,
                root: blockParent.header.stateRoot,
                setHardfork: true,
                parentBlock: blockParent,
              })
              return blockExecuted
            })())

          // if can't be executed then return syncing/accepted
          if (!executed) {
            this.config.logger.debug(
              `Skipping block(s) execution for headBlock=${headBlock.header.number} hash=${short(
                headBlock.hash(),
              )} : pendingBlocks=${blocks.length - i}(limit=${
                this.chain.config.engineNewpayloadMaxExecute
              }) transactions=${block.transactions.length}(limit=${
                this.chain.config.engineNewpayloadMaxTxsExecute
              }) executionBusy=${this.execution.running}`,
            )
            // determined status to be returned depending on if block could extend chain or not
            const status = optimisticLookup === true ? Status.SYNCING : Status.ACCEPTED
            const response = { status, latestValidHash: null, validationError: null }
            return response
          } else {
            this.executedBlocks.set(bytesToUnprefixedHex(block.hash()), block)
          }
        }
      }
    } catch (error) {
      const latestValidHash = await validHash(
        headBlock.header.parentHash,
        this.chain,
        this.chainCache,
      )

      const errorMsg = `${error}`.toLowerCase()
      if (errorMsg.includes('block') && errorMsg.includes('not found')) {
        if (blocks.length > 1) {
          // this error can come if the block tries to load a previous block yet not in the chain via BLOCKHASH
          // opcode.
          //
          // i)  error coding of the evm errors should be a better way to handle this OR
          // ii) figure out a way to pass let the evm access the above blocks which is what connects this
          //     chain to vmhead. to be handled in skeleton refactoring to blockchain class

          const response = { status: Status.SYNCING, latestValidHash, validationError: null }
          return response
        } else {
          throw {
            code: INTERNAL_ERROR,
            message: errorMsg,
          }
        }
      }

      const validationError = `Error verifying block while running: ${errorMsg}`
      this.config.logger.error(validationError)

      const response = { status: Status.INVALID, latestValidHash, validationError }
      this.invalidBlocks.set(blockHash.slice(2), error as Error)
      this.remoteBlocks.delete(blockHash.slice(2))
      try {
        await this.chain.blockchain.delBlock(lastBlock!.hash())
        // eslint-disable-next-line no-empty
      } catch {}
      try {
        await this.skeleton.deleteBlock(lastBlock!)
        // eslint-disable-next-line no-empty
      } catch {}
      return response
    }

    const response = {
      status: Status.VALID,
      latestValidHash: bytesToHex(headBlock.hash()),
      validationError: null,
    }
    return response
  }

  /**
   * V1 (Paris HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/paris.md#engine_newpayloadv1
   * @param params V1 payload
   * @returns
   */
  async newPayloadV1(params: [ExecutionPayloadV1]): Promise<PayloadStatusV1> {
    const shanghaiTimestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Shanghai)
    const ts = parseInt(params[0].timestamp)
    if (shanghaiTimestamp !== null && ts >= shanghaiTimestamp) {
      throw {
        code: INVALID_PARAMS,
        message: 'NewPayloadV2 MUST be used after Shanghai is activated',
      }
    }

    return this.newPayload(params)
  }

  /**
   * V2 (Shanghai HF) including withdrawals, see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/shanghai.md#executionpayloadv2
   * @param params V1 or V2 payload
   * @returns
   */
  async newPayloadV2(params: [ExecutionPayloadV2 | ExecutionPayloadV1]): Promise<PayloadStatusV1> {
    const shanghaiTimestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Shanghai)
    const eip4844Timestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Cancun)
    const ts = parseInt(params[0].timestamp)

    const withdrawals = (params[0] as ExecutionPayloadV2).withdrawals

    if (eip4844Timestamp !== null && ts >= eip4844Timestamp) {
      throw {
        code: INVALID_PARAMS,
        message: 'NewPayloadV3 MUST be used after Cancun is activated',
      }
    } else if (shanghaiTimestamp === null || parseInt(params[0].timestamp) < shanghaiTimestamp) {
      if (withdrawals !== undefined && withdrawals !== null) {
        throw {
          code: INVALID_PARAMS,
          message: 'ExecutionPayloadV1 MUST be used before Shanghai is activated',
        }
      }
    } else if (parseInt(params[0].timestamp) >= shanghaiTimestamp) {
      if (withdrawals === undefined || withdrawals === null) {
        throw {
          code: INVALID_PARAMS,
          message: 'ExecutionPayloadV2 MUST be used after Shanghai is activated',
        }
      }
      const payloadAsV3 = params[0] as ExecutionPayloadV3
      const { excessBlobGas, blobGasUsed } = payloadAsV3

      if (excessBlobGas !== undefined && excessBlobGas !== null) {
        throw {
          code: INVALID_PARAMS,
          message: 'Invalid PayloadV2: excessBlobGas is defined',
        }
      }
      if (blobGasUsed !== undefined && blobGasUsed !== null) {
        throw {
          code: INVALID_PARAMS,
          message: 'Invalid PayloadV2: blobGasUsed is defined',
        }
      }
    }
    const newPayloadRes = await this.newPayload(params)
    if (newPayloadRes.status === Status.INVALID_BLOCK_HASH) {
      newPayloadRes.status = Status.INVALID
      newPayloadRes.latestValidHash = null
    }
    return newPayloadRes
  }

  /**
   * V3 (Cancun HF) including blob versioned hashes + parent beacon block root, see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/cancun.md#engine_newpayloadv3
   * @param params V3 payload, expectedBlobVersionedHashes, parentBeaconBlockRoot
   * @returns
   */
  async newPayloadV3(params: [ExecutionPayloadV3, Bytes32[], Bytes32]): Promise<PayloadStatusV1> {
    const eip4844Timestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Cancun)
    const pragueTimestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Prague)

    const ts = parseInt(params[0].timestamp)
    if (pragueTimestamp !== null && ts >= pragueTimestamp) {
      throw {
        code: INVALID_PARAMS,
        message: 'NewPayloadV4 MUST be used after Prague is activated',
      }
    } else if (eip4844Timestamp === null || ts < eip4844Timestamp) {
      throw {
        code: UNSUPPORTED_FORK,
        message: 'NewPayloadV{1|2} MUST be used before Cancun is activated',
      }
    }

    const newPayloadRes = await this.newPayload(params)
    if (newPayloadRes.status === Status.INVALID_BLOCK_HASH) {
      newPayloadRes.status = Status.INVALID
      newPayloadRes.latestValidHash = null
    }
    return newPayloadRes
  }

  async newPayloadV4(params: [ExecutionPayloadV4, Bytes32[], Bytes32]): Promise<PayloadStatusV1> {
    const pragueTimestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Prague)
    const ts = parseInt(params[0].timestamp)
    if (pragueTimestamp === null || ts < pragueTimestamp) {
      throw {
        code: UNSUPPORTED_FORK,
        message: 'NewPayloadV{1|2|3} MUST be used before Prague is activated',
      }
    }

    const newPayloadRes = await this.newPayload(params)
    if (newPayloadRes.status === Status.INVALID_BLOCK_HASH) {
      newPayloadRes.status = Status.INVALID
      newPayloadRes.latestValidHash = null
    }
    return newPayloadRes
  }

  /**
   * Propagates the change in the fork choice to the execution client.
   *
   * @param params An array of one parameter:
   *   1. An object - The state of the fork choice:
   *        headBlockHash - block hash of the head of the canonical chain
   *        safeBlockHash - the "safe" block hash of the canonical chain under certain synchrony
   *         and honesty assumptions. This value MUST be either equal to or an ancestor of headBlockHash
   *        finalizedBlockHash - block hash of the most recent finalized block
   *   2. An object or null - instance of {@link PayloadAttributesV1}
   * @returns An object:
   *   1. payloadStatus: {@link PayloadStatusV1}; values of the `status` field in the context of this method are restricted to the following subset::
   *        VALID
   *        INVALID
   *        SYNCING
   *   2. payloadId: DATA|null - 8 Bytes - identifier of the payload build process or `null`
   *   3. headBlock: Block|undefined - Block corresponding to headBlockHash if found
   */
  private async forkchoiceUpdated(
    params: [forkchoiceState: ForkchoiceStateV1, payloadAttributes: PayloadAttributes | undefined],
  ): Promise<ForkchoiceResponseV1 & { headBlock?: Block }> {
    const { headBlockHash, finalizedBlockHash, safeBlockHash } = params[0]
    const payloadAttributes = params[1]

    const safe = hexToBytes(safeBlockHash)
    const finalized = hexToBytes(finalizedBlockHash)

    if (!equalsBytes(finalized, zeroBlockHash) && equalsBytes(safe, zeroBlockHash)) {
      throw {
        code: INVALID_PARAMS,
        message: 'safe block can not be zero if finalized block is not zero',
      }
    }

    if (this.config.synchronized) {
      this.connectionManager.newForkchoiceLog()
    }

    // It is possible that newPayload didn't start beacon sync as the payload it was asked to
    // evaluate didn't require syncing beacon. This can happen if the EL<>CL starts and CL
    // starts from a bit behind like how lodestar does
    if (!this.service.beaconSync) {
      await this.service.switchToBeaconSync()
    }

    /**
     * Block previously marked INVALID
     */
    const prevError = this.invalidBlocks.get(headBlockHash.slice(2))
    if (prevError !== undefined) {
      const validationError = `Received block previously marked INVALID: ${prevError.message}`
      this.config.logger.debug(validationError)
      const latestValidHash = null
      const payloadStatus = { status: Status.INVALID, latestValidHash, validationError }
      const response = { payloadStatus, payloadId: null }
      return response
    }

    /**
     * Forkchoice head block announced not known (neither in remote blocks, skeleton or chain)
     * by EL
     */
    let headBlock: Block | undefined
    try {
      const head = toBytes(headBlockHash)
      headBlock =
        this.remoteBlocks.get(headBlockHash.slice(2)) ??
        (await this.skeleton.getBlockByHash(head, true)) ??
        (await this.chain.getBlock(head))
    } catch (error) {
      this.config.logger.debug(
        `Forkchoice announced head block unknown to EL hash=${short(headBlockHash)}`,
      )
      const payloadStatus = {
        status: Status.SYNCING,
        latestValidHash: null,
        validationError: null,
      }
      const response = { payloadStatus, payloadId: null }
      return response
    }

    /**
     * Hardfork Update
     */
    const hardfork = headBlock.common.hardfork()
    if (hardfork !== this.lastForkchoiceUpdatedHF && this.lastForkchoiceUpdatedHF !== '') {
      this.config.logger.info(
        `Hardfork change along forkchoice head block update number=${
          headBlock.header.number
        } hash=${short(headBlock.hash())} old=${this.lastForkchoiceUpdatedHF} new=${hardfork}`,
      )
    }
    this.lastForkchoiceUpdatedHF = hardfork

    // Always keep beaconSync skeleton updated so that it stays updated with any skeleton sync
    // requirements that might come later because of reorg or CL restarts
    this.config.logger.debug(
      `Forkchoice requested update to new head number=${headBlock.header.number} hash=${short(
        headBlock.hash(),
      )}`,
    )

    /**
     * call skeleton sethead with force head change and reset beacon sync if reorg
     */
    const { reorged, safeBlock, finalizedBlock } = await this.skeleton.forkchoiceUpdate(headBlock, {
      safeBlockHash: safe,
      finalizedBlockHash: finalized,
    })

    if (this.skeleton.fillStatus?.status === PutStatus.INVALID) {
      const latestValidHash =
        this.chain.blocks.latest !== null
          ? await validHash(this.chain.blocks.latest.hash(), this.chain, this.chainCache)
          : bytesToHex(new Uint8Array(32))
      const response = {
        payloadStatus: {
          status: Status.INVALID,
          validationError: this.skeleton.fillStatus.validationError ?? '',
          latestValidHash,
        },
        payloadId: null,
      }
      return response
    }

    if (reorged) await this.service.beaconSync?.reorged(headBlock)

    /**
     * Check execution status
     */
    const isHeadExecuted =
      (this.executedBlocks.get(headBlockHash.slice(2)) ??
        (await validExecutedChainBlock(headBlock, this.chain))) !== null
    if (!isHeadExecuted) {
      if (this.execution.chainStatus?.status === ExecStatus.INVALID) {
        // see if the invalid block is canonical along the current skeleton/chain return invalid
        const invalidBlock = await this.skeleton.getBlockByHash(
          this.execution.chainStatus.hash,
          true,
        )
        if (invalidBlock !== undefined) {
          // hard luck: block along canonical chain is invalid
          const latestValidHash = await validHash(
            invalidBlock.header.parentHash,
            this.chain,
            this.chainCache,
          )
          const validationError = `Block number=${invalidBlock.header.number} hash=${short(
            invalidBlock.hash(),
          )} root=${short(invalidBlock.header.stateRoot)} along the canonical chain is invalid`

          const payloadStatus = {
            status: Status.INVALID,
            latestValidHash,
            validationError,
          }
          const response = { payloadStatus, payloadId: null }
          return response
        }
      }

      // if the execution is stalled because it hit an invalid block which we need to hop over
      if (
        this.execution.chainStatus?.status === ExecStatus.IGNORE_INVALID &&
        this.config.ignoreStatelessInvalidExecs === true
      ) {
        // jump the vm head to failing block so that next block can be executed
        this.config.logger.debug(
          `Jumping the stalled vmHead forward to hash=${this.execution.chainStatus.hash} height=${this.execution.chainStatus.height} to continue the execution`,
        )
        await this.execution.jumpVmHead(
          this.execution.chainStatus.hash,
          this.execution.chainStatus.height,
        )
      }

      // Trigger the statebuild here since we have finalized and safeblock available
      void this.service.buildHeadState()

      /**
       * execution has not yet caught up, so lets just return sync
       */
      const payloadStatus = {
        status: Status.SYNCING,
        latestValidHash: null,
        validationError: null,
      }
      const response = { payloadStatus, payloadId: null }
      return response
    }

    /**
     * It is confirmed here that the head block has been executed and
     * we can therefore safely call `this.execution.setHead()` (below)
     */
    const vmHeadHash = (await this.chain.blockchain.getIteratorHead()).hash()
    if (!equalsBytes(vmHeadHash, headBlock.hash())) {
      let parentBlocks: Block[] = []
      if (this.chain.headers.latest && this.chain.headers.latest.number < headBlock.header.number) {
        try {
          parentBlocks = await recursivelyFindParents(
            vmHeadHash,
            headBlock.header.parentHash,
            this.chain,
          )
        } catch (error) {
          const payloadStatus = {
            status: Status.SYNCING,
            latestValidHash: null,
            validationError: null,
          }
          const response = { payloadStatus, payloadId: null }
          return response
        }
      }

      const blocks = [...parentBlocks, headBlock]
      try {
        const completed = await this.execution.setHead(blocks, { safeBlock, finalizedBlock })
        if (!completed) {
          const latestValidHash = await validHash(headBlock.hash(), this.chain, this.chainCache)
          const payloadStatus = {
            status: Status.SYNCING,
            latestValidHash,
            validationError: null,
          }
          const response = { payloadStatus, payloadId: null }
          return response
        }
      } catch (error) {
        throw {
          message: (error as Error).message,
          code: INVALID_PARAMS,
        }
      }
      this.service.txPool.removeNewBlockTxs(blocks)
    } else if (!headBlock.isGenesis()) {
      // even if the vmHead is same still validations need to be done regarding the correctness
      // of the sequence and canonical-ity
      try {
        await this.execution.setHead([headBlock], { safeBlock, finalizedBlock })
      } catch (e) {
        throw {
          message: (e as Error).message,
          code: INVALID_PARAMS,
        }
      }
    }

    /**
     * Synchronized and tx pool update
     */
    this.config.updateSynchronizedState(headBlock.header)
    if (this.chain.config.synchronized) {
      this.service.txPool.checkRunState()
    }

    /**
     * Start building the block and
     * prepare valid response
     */
    let validResponse
    // If payloadAttributes is present, start building block and return payloadId
    if (payloadAttributes) {
      const { timestamp, prevRandao, suggestedFeeRecipient, withdrawals, parentBeaconBlockRoot } =
        payloadAttributes
      const timestampBigInt = BigInt(timestamp)

      if (timestampBigInt <= headBlock.header.timestamp) {
        throw {
          message: `invalid timestamp in payloadAttributes, got ${timestampBigInt}, need at least ${
            headBlock.header.timestamp + BIGINT_1
          }`,
          code: INVALID_PARAMS,
        }
      }

      // TODO: rename pendingBlock.start() to something more expressive
      const payloadId = await this.pendingBlock.start(
        await this.vm.shallowCopy(),
        headBlock,
        {
          timestamp,
          mixHash: prevRandao,
          coinbase: suggestedFeeRecipient,
          parentBeaconBlockRoot,
        },
        withdrawals,
      )
      const latestValidHash = await validHash(headBlock.hash(), this.chain, this.chainCache)
      const payloadStatus = { status: Status.VALID, latestValidHash, validationError: null }
      validResponse = { payloadStatus, payloadId: bytesToHex(payloadId), headBlock }
    } else {
      const latestValidHash = await validHash(headBlock.hash(), this.chain, this.chainCache)
      const payloadStatus = { status: Status.VALID, latestValidHash, validationError: null }
      validResponse = { payloadStatus, payloadId: null, headBlock }
    }

    /**
     * Before returning response prune cached blocks based on finalized and vmHead
     */
    if (this.chain.config.pruneEngineCache) {
      pruneCachedBlocks(this.chain, this.chainCache)
    }
    return validResponse
  }

  /**
   * V1 (Paris HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/paris.md#engine_forkchoiceupdatedv1
   * @param params V1 forkchoice state (block hashes) + optional payload V1 attributes (timestamp,...)
   * @returns
   */
  private async forkchoiceUpdatedV1(
    params: [
      forkchoiceState: ForkchoiceStateV1,
      payloadAttributes: PayloadAttributesV1 | undefined,
    ],
  ): Promise<ForkchoiceResponseV1 & { headBlock?: Block }> {
    const payloadAttributes = params[1]
    if (payloadAttributes !== undefined && payloadAttributes !== null) {
      if (
        Object.values(payloadAttributes).filter((attr) => attr !== null && attr !== undefined)
          .length > 3
      ) {
        throw {
          code: INVALID_PARAMS,
          message: 'PayloadAttributesV1 MUST be used for forkchoiceUpdatedV2',
        }
      }
      validateHardforkRange(
        this.chain.config.chainCommon,
        1,
        null,
        Hardfork.Paris,
        BigInt(payloadAttributes.timestamp),
      )
    }

    return this.forkchoiceUpdated(params)
  }

  /**
   * V2 (Shanghai HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/shanghai.md#engine_forkchoiceupdatedv2
   * @param params V1 forkchoice state (block hashes) + optional payload V1 or V2 attributes (+ withdrawals)
   * @returns
   */
  private async forkchoiceUpdatedV2(
    params: [
      forkchoiceState: ForkchoiceStateV1,
      payloadAttributes: PayloadAttributesV1 | PayloadAttributesV2 | undefined,
    ],
  ): Promise<ForkchoiceResponseV1 & { headBlock?: Block }> {
    const payloadAttributes = params[1]
    if (payloadAttributes !== undefined && payloadAttributes !== null) {
      if (
        Object.values(payloadAttributes).filter((attr) => attr !== null && attr !== undefined)
          .length > 4
      ) {
        throw {
          code: INVALID_PARAMS,
          message: 'PayloadAttributesV{1|2} MUST be used for forkchoiceUpdatedV2',
        }
      }

      validateHardforkRange(
        this.chain.config.chainCommon,
        2,
        null,
        Hardfork.Shanghai,
        BigInt(payloadAttributes.timestamp),
      )

      const shanghaiTimestamp = this.chain.config.chainCommon.hardforkTimestamp(Hardfork.Shanghai)
      const ts = BigInt(payloadAttributes.timestamp)
      const withdrawals = (payloadAttributes as PayloadAttributesV2).withdrawals
      if (withdrawals !== undefined && withdrawals !== null) {
        if (ts < shanghaiTimestamp!) {
          throw {
            code: INVALID_PARAMS,
            message: 'PayloadAttributesV1 MUST be used before Shanghai is activated',
          }
        }
      } else {
        if (ts >= shanghaiTimestamp!) {
          throw {
            code: INVALID_PARAMS,
            message: 'PayloadAttributesV2 MUST be used after Shanghai is activated',
          }
        }
      }
      const parentBeaconBlockRoot = (payloadAttributes as PayloadAttributesV3).parentBeaconBlockRoot

      if (parentBeaconBlockRoot !== undefined && parentBeaconBlockRoot !== null) {
        throw {
          code: INVALID_PARAMS,
          message: 'Invalid PayloadAttributesV{1|2}: parentBlockBeaconRoot defined',
        }
      }
    }

    return this.forkchoiceUpdated(params)
  }

  /**
   * V3 (Cancun HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/cancun.md#engine_forkchoiceupdatedv3
   * @param params V1 forkchoice state (block hashes) + optional payload V3 attributes (withdrawals + parentBeaconBlockRoot)
   * @returns
   */
  private async forkchoiceUpdatedV3(
    params: [
      forkchoiceState: ForkchoiceStateV1,
      payloadAttributes: PayloadAttributesV3 | undefined,
    ],
  ): Promise<ForkchoiceResponseV1 & { headBlock?: Block }> {
    const payloadAttributes = params[1]
    if (payloadAttributes !== undefined && payloadAttributes !== null) {
      if (
        Object.values(payloadAttributes).filter((attr) => attr !== null && attr !== undefined)
          .length > 5
      ) {
        throw {
          code: INVALID_PARAMS,
          message: 'PayloadAttributesV3 MUST be used for forkchoiceUpdatedV3',
        }
      }

      validateHardforkRange(
        this.chain.config.chainCommon,
        3,
        Hardfork.Cancun,
        // this could be valid post cancun as well, if not then update the valid till hf here
        null,
        BigInt(payloadAttributes.timestamp),
      )
    }

    return this.forkchoiceUpdated(params)
  }

  /**
   * Given payloadId, returns the most recent version of an execution payload
   * that is available by the time of the call or responds with an error.
   *
   * @param params An array of one parameter:
   *   1. payloadId: DATA, 8 bytes - identifier of the payload building process
   * @returns Instance of {@link ExecutionPayloadV1} or an error
   */
  private async getPayload(params: [Bytes8], payloadVersion: number) {
    const payloadId = params[0]
    try {
      /**
       * Build the pending block
       */
      const built = await this.pendingBlock.build(payloadId)
      if (!built) {
        throw EngineError.UnknownPayload
      }
      // The third arg returned is the minerValue which we will use to
      // value the block
      const [block, receipts, value, blobs] = built

      // do a blocking call even if execution might be busy for the moment and skip putting
      // it into chain till CL confirms with full data via new payload like versioned hashes
      // parent beacon block root
      const executed = await this.execution.runWithoutSetHead({ block }, receipts, true, true)
      if (!executed) {
        throw Error(`runWithoutSetHead did not execute the block for payload=${payloadId}`)
      }

      this.executedBlocks.set(bytesToUnprefixedHex(block.hash()), block)
      /**
       * Creates the payload in ExecutionPayloadV1 format to be returned
       */
      const executionPayload = blockToExecutionPayload(block, value, blobs)

      let checkNotBeforeHf: Hardfork | null
      let checkNotAfterHf: Hardfork | null

      switch (payloadVersion) {
        case 4:
          checkNotBeforeHf = Hardfork.Prague
          checkNotAfterHf = Hardfork.Prague
          break

        case 3:
          checkNotBeforeHf = Hardfork.Cancun
          checkNotAfterHf = Hardfork.Cancun
          break

        case 2:
          // no checks to be done for before as valid till paris
          checkNotBeforeHf = null
          checkNotAfterHf = Hardfork.Shanghai
          break

        case 1:
          checkNotBeforeHf = null
          checkNotAfterHf = Hardfork.Paris
          break

        default:
          throw Error(`Invalid payloadVersion=${payloadVersion}`)
      }

      validateHardforkRange(
        this.chain.config.chainCommon,
        payloadVersion,
        checkNotBeforeHf,
        checkNotAfterHf,
        BigInt(executionPayload.executionPayload.timestamp),
      )
      return executionPayload
    } catch (error) {
      if (validEngineCodes.includes(error.code)) throw error
      throw {
        code: INTERNAL_ERROR,
        message: error.message ?? error,
      }
    }
  }

  /**
   * V1 (Paris HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/paris.md#engine_getpayloadv1
   * @param params Identifier of the payload build process
   * @returns
   */
  async getPayloadV1(params: [Bytes8]) {
    const { executionPayload } = await this.getPayload(params, 1)
    return executionPayload
  }

  /**
   * V2 (Shanghai HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/shanghai.md#engine_getpayloadv2
   * @param params Identifier of the payload build process
   * @returns
   */
  async getPayloadV2(params: [Bytes8]) {
    const { executionPayload, blockValue } = await this.getPayload(params, 2)
    return { executionPayload, blockValue }
  }

  /**
   * V3 (Cancun HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/cancun.md#engine_getpayloadv3
   * @param params Identifier of the payload build process
   * @returns
   */
  async getPayloadV3(params: [Bytes8]) {
    return this.getPayload(params, 3)
  }

  async getPayloadV4(params: [Bytes8]) {
    return this.getPayload(params, 4)
  }

  /**
   * Returns a list of engine API endpoints supported by the client
   *
   * See:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/common.md#engine_exchangecapabilities
   */
  private exchangeCapabilities(_params: []): string[] {
    const caps = Object.getOwnPropertyNames(Engine.prototype)
    const engineMethods = caps.filter((el) => el !== 'constructor' && el !== 'exchangeCapabilities')
    return engineMethods.map((el) => 'engine_' + el)
  }

  /**
   * V1 (Shanghai HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/shanghai.md#engine_getpayloadbodiesbyhashv1
   *
   * @param params a list of block hashes as hex prefixed strings
   * @returns an array of ExecutionPayloadBodyV1 objects or null if a given execution payload isn't stored locally
   */
  private async getPayloadBodiesByHashV1(
    params: [[Bytes32]],
  ): Promise<(ExecutionPayloadBodyV1 | null)[]> {
    if (params[0].length > 32) {
      throw {
        code: TOO_LARGE_REQUEST,
        message: 'More than 32 execution payload bodies requested',
      }
    }
    const hashes = params[0].map(hexToBytes)
    const blocks: (ExecutionPayloadBodyV1 | null)[] = []
    for (const hash of hashes) {
      try {
        const block = await this.chain.getBlock(hash)
        const payloadBody = getPayloadBody(block)
        blocks.push(payloadBody)
      } catch {
        blocks.push(null)
      }
    }
    return blocks
  }

  /**
   * V1 (Shanghai HF), see:
   * https://github.com/ethereum/execution-apis/blob/main/src/engine/shanghai.md#engine_getpayloadbodiesbyrangev1
   *
   * @param params an array of 2 parameters
   *    1.  start: Bytes8 - the first block in the range
   *    2.  count: Bytes8 - the number of blocks requested
   * @returns an array of ExecutionPayloadBodyV1 objects or null if a given execution payload isn't stored locally
   */
  private async getPayloadBodiesByRangeV1(
    params: [Bytes8, Bytes8],
  ): Promise<(ExecutionPayloadBodyV1 | null)[]> {
    const start = BigInt(params[0])
    let count = BigInt(params[1])
    if (count > BigInt(32)) {
      throw {
        code: TOO_LARGE_REQUEST,
        message: 'More than 32 execution payload bodies requested',
      }
    }

    if (count < BIGINT_1 || start < BIGINT_1) {
      throw {
        code: INVALID_PARAMS,
        message: 'Start and Count parameters cannot be less than 1',
      }
    }
    const currentChainHeight = this.chain.headers.height
    if (start > currentChainHeight) {
      return []
    }

    if (start + count > currentChainHeight) {
      count = currentChainHeight - start + BIGINT_1
    }
    const blocks = await this.chain.getBlocks(start, Number(count))
    const payloads: (ExecutionPayloadBodyV1 | null)[] = []
    for (const block of blocks) {
      try {
        const payloadBody = getPayloadBody(block)
        payloads.push(payloadBody)
      } catch {
        payloads.push(null)
      }
    }
    return payloads
  }
}
