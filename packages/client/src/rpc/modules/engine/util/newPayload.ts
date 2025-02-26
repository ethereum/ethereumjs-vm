import { createBlockFromExecutionPayload, genRequestsRoot } from '@ethereumjs/block'
import { Blob4844Tx } from '@ethereumjs/tx'
import {
  CLRequest,
  CLRequestType,
  EthereumJSErrorWithoutCode,
  bytesToHex,
  hexToBytes,
} from '@ethereumjs/util'
import { sha256 } from 'ethereum-cryptography/sha256'

import { short } from '../../../../util/index.js'
import { Status } from '../types.js'

import { validHash } from './generic.js'

import type { Chain } from '../../../../blockchain/index.js'
import type { ChainCache, PayloadStatusV1 } from '../types.js'
import type { Block, ExecutionPayload } from '@ethereumjs/block'
import type { Common } from '@ethereumjs/common'
import type { PrefixedHexString } from '@ethereumjs/util'

type CLData = {
  parentBeaconBlockRoot?: PrefixedHexString
  blobVersionedHashes?: PrefixedHexString[]
  executionRequests?: PrefixedHexString[]
}

export const validate4844BlobVersionedHashes = (
  headBlock: Block,
  blobVersionedHashes: PrefixedHexString[],
): string | null => {
  let validationError: string | null = null

  // Collect versioned hashes in the flat array `txVersionedHashes` to match with received
  const txVersionedHashes = []
  for (const tx of headBlock.transactions) {
    if (tx instanceof Blob4844Tx) {
      for (const vHash of tx.blobVersionedHashes) {
        txVersionedHashes.push(vHash)
      }
    }
  }

  if (blobVersionedHashes.length !== txVersionedHashes.length) {
    validationError = `Error verifying blobVersionedHashes: expected=${txVersionedHashes.length} received=${blobVersionedHashes.length}`
  } else {
    // match individual hashes
    for (let vIndex = 0; vIndex < blobVersionedHashes.length; vIndex++) {
      // if mismatch, record error and break
      if (blobVersionedHashes[vIndex] !== txVersionedHashes[vIndex]) {
        validationError = `Error verifying blobVersionedHashes: mismatch at index=${vIndex} expected=${short(
          txVersionedHashes[vIndex],
        )} received=${short(blobVersionedHashes[vIndex])}`
        break
      }
    }
  }
  return validationError
}

export const validateAndGen7685RequestsHash = (
  common: Common,
  executionRequests: PrefixedHexString[],
): PrefixedHexString => {
  const requests: CLRequest<CLRequestType>[] = []

  for (const request of executionRequests) {
    const bytes = hexToBytes(request)
    if (bytes.length === 0) {
      throw EthereumJSErrorWithoutCode('Got a request without a request-identifier')
    }
    switch (bytes[0]) {
      case CLRequestType.Deposit:
        if (!common.isActivatedEIP(6110)) {
          throw EthereumJSErrorWithoutCode(`Deposit requests are not active`)
        }
        requests.push(new CLRequest(CLRequestType.Deposit, bytes.slice(1)))
        break
      case CLRequestType.Withdrawal:
        if (!common.isActivatedEIP(7002)) {
          throw EthereumJSErrorWithoutCode(`Withdrawal requests are not active`)
        }
        requests.push(new CLRequest(CLRequestType.Withdrawal, bytes.slice(1)))
        break
      case CLRequestType.Consolidation:
        if (!common.isActivatedEIP(7251)) {
          throw EthereumJSErrorWithoutCode(`Consolidation requests are not active`)
        }
        requests.push(new CLRequest(CLRequestType.Consolidation, bytes.slice(1)))
        break
      default:
        throw EthereumJSErrorWithoutCode(`Unknown request identifier: got ${bytes[0]}`)
    }
  }

  const sha256Function = common.customCrypto.sha256 ?? sha256
  const requestsHash = genRequestsRoot(requests, sha256Function)

  return bytesToHex(requestsHash)
}

/**
 * Returns a block from a payload.
 * If errors, returns {@link PayloadStatusV1}
 */
export const assembleBlock = async (
  payload: Omit<ExecutionPayload, 'requestsHash' | 'parentBeaconBlockRoot'>,
  clValidationData: CLData,
  chain: Chain,
  chainCache: ChainCache,
): Promise<{ block?: Block; error?: PayloadStatusV1 }> => {
  const { blockNumber, timestamp } = payload
  const { config } = chain
  const common = config.chainCommon.copy()
  common.setHardforkBy({ blockNumber, timestamp })

  try {
    // Validate CL data to see if it matches with the assembled block
    const { blobVersionedHashes, executionRequests, parentBeaconBlockRoot } = clValidationData

    let requestsHash
    if (executionRequests !== undefined) {
      requestsHash = validateAndGen7685RequestsHash(common, executionRequests)
    } else if (common.isActivatedEIP(7685)) {
      throw `Invalid executionRequests=undefined for EIP-7685 activated block`
    }

    const block = await createBlockFromExecutionPayload(
      { ...payload, parentBeaconBlockRoot, requestsHash },
      { common },
    )
    // TODO: validateData is also called in applyBlock while runBlock, may be it can be optimized
    // by removing/skipping block data validation from there
    await block.validateData()

    /**
     * Validate blob versioned hashes in the context of EIP-4844 blob transactions
     */
    if (block.common.isActivatedEIP(4844)) {
      let validationError: string | null = null
      if (blobVersionedHashes === undefined) {
        validationError = `Error verifying blobVersionedHashes: received none`
      } else {
        validationError = validate4844BlobVersionedHashes(block, blobVersionedHashes)
      }

      // if there was a validation error return invalid
      if (validationError !== null) {
        throw validationError
      }
    } else if (blobVersionedHashes !== undefined) {
      const validationError = `Invalid blobVersionedHashes before EIP-4844 is activated`
      throw validationError
    }

    return { block }
  } catch (error) {
    const validationError = `Error assembling block from payload: ${error}`
    config.logger.error(validationError)
    const latestValidHash = await validHash(
      hexToBytes(payload.parentHash as PrefixedHexString),
      chain,
      chainCache,
    )
    const response = {
      status: `${error}`.includes('Invalid blockHash') ? Status.INVALID_BLOCK_HASH : Status.INVALID,
      latestValidHash,
      validationError,
    }
    return { error: response }
  }
}
