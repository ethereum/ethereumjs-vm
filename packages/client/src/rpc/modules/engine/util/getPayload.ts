import { bigIntToHex } from '@ethereumjs/util'

import type { BlobsBundle } from '../../../../miner/index.js'
import type { BlobsBundleV1 } from '../types.js'
import type { Block, ExecutionPayload } from '@ethereumjs/block'

/**
 * Formats a block to {@link ExecutionPayloadV1}.
 */
export const blockToExecutionPayload = (block: Block, value: bigint, bundle?: BlobsBundle) => {
  const executionPayload: ExecutionPayload = block.toExecutionPayload()
  // parentBeaconBlockRoot is not part of the CL payload
  if (executionPayload.parentBeaconBlockRoot !== undefined) {
    delete executionPayload.parentBeaconBlockRoot
  }
  const { executionRequests } = executionPayload
  if (executionPayload.executionRequests !== undefined) {
    delete executionPayload.executionRequests
  }

  const blobsBundle: BlobsBundleV1 | undefined = bundle ? bundle : undefined

  // ethereumjs does not provide any transaction censoring detection (yet) to suggest
  // overriding builder/mev-boost blocks
  const shouldOverrideBuilder = false
  return {
    executionPayload,
    executionRequests,
    blockValue: bigIntToHex(value),
    blobsBundle,
    shouldOverrideBuilder,
  }
}
