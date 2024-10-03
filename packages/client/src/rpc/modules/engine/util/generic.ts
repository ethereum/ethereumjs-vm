import { Block } from '@ethereumjs/block'
import { bytesToHex, bytesToUnprefixedHex, equalsBytes } from '@ethereumjs/util'

import { UNSUPPORTED_FORK } from '../../../error-code.js'
import { type ChainCache } from '../types.js'

import type { Chain } from '../../../../blockchain/index.js'
import type { Common, Hardfork } from '@ethereumjs/common'
import type { PrefixedHexString } from '@ethereumjs/util'

/**
 * Recursively finds parent blocks starting from the parentHash.
 */
export const recursivelyFindParents = async (
  vmHeadHash: Uint8Array,
  parentHash: Uint8Array,
  chain: Chain,
) => {
  if (equalsBytes(parentHash, vmHeadHash) || equalsBytes(parentHash, new Uint8Array(32))) {
    return []
  }
  const maxDepth = chain.config.engineParentLookupMaxDepth

  const parentBlocks = []
  const block = await chain.getBlock(parentHash)
  parentBlocks.push(block)

  while (!equalsBytes(parentBlocks[parentBlocks.length - 1].hash(), vmHeadHash)) {
    const block: Block = await chain.getBlock(
      parentBlocks[parentBlocks.length - 1].header.parentHash,
    )
    parentBlocks.push(block)

    if (block.isGenesis()) {
      // In case we hit the genesis block we should stop finding additional parents
      break
    }

    // throw error if lookups have exceeded maxDepth
    if (parentBlocks.length > maxDepth) {
      throw Error(`recursivelyFindParents lookups deeper than maxDepth=${maxDepth}`)
    }
  }
  return parentBlocks.reverse()
}

/**
 * Returns the block hash as a 0x-prefixed hex string if found valid in the blockchain, otherwise returns null.
 */
export const validExecutedChainBlock = async (
  blockOrHash: Uint8Array | Block,
  chain: Chain,
): Promise<Block | null> => {
  try {
    const block = blockOrHash instanceof Block ? blockOrHash : await chain.getBlock(blockOrHash)
    const vmHead = await chain.blockchain.getIteratorHead()

    if (vmHead.header.number >= block.header.number) {
      // check if block is canonical
      const canonicalHash = await chain.blockchain.safeNumberToHash(block.header.number)
      if (canonicalHash instanceof Uint8Array && equalsBytes(block.hash(), canonicalHash)) {
        return block
      }
    }

    // if the block was canonical and executed we would have returned by now
    return null
  } catch {
    return null
  }
}

/**
 * Returns the block hash as a 0x-prefixed hex string if found valid in the blockchain, otherwise returns null.
 */
export const validHash = async (
  hash: Uint8Array,
  chain: Chain,
  chainCache: ChainCache,
): Promise<PrefixedHexString | null> => {
  const { remoteBlocks, executedBlocks, invalidBlocks, skeleton } = chainCache
  const maxDepth = chain.config.engineParentLookupMaxDepth

  try {
    let validParent: Block | null = null
    for (let inspectedParents = 0; inspectedParents < maxDepth; inspectedParents++) {
      const unPrefixedHashStr = bytesToUnprefixedHex(hash)
      validParent =
        remoteBlocks.get(unPrefixedHashStr) ??
        (await skeleton.getBlockByHash(hash, true)) ??
        (await chain.getBlock(hash))

      // if block is invalid throw error and respond with null validHash
      if (invalidBlocks.get(unPrefixedHashStr) !== undefined) {
        throw Error(`References an invalid ancestor`)
      }

      // if block is executed the return with this hash
      const isBlockExecuted =
        (executedBlocks.get(unPrefixedHashStr) ?? (await validExecutedChainBlock(hash, chain))) !==
        null
      if (isBlockExecuted) {
        return bytesToHex(hash)
      } else {
        hash = validParent.header.parentHash
      }
    }
  } catch {
    // ignore error thrown by the loop and return null below
  }

  // if we are here, either we can't find valid parent till maxDepth or the ancestor was invalid
  // or there was a lookup error. in all these instances return null
  return null
}

export function validateHardforkRange(
  chainCommon: Common,
  methodVersion: number,
  checkNotBeforeHf: Hardfork | null,
  checkNotAfterHf: Hardfork | null,
  timestamp: bigint,
) {
  if (checkNotBeforeHf !== null) {
    const hfTimeStamp = chainCommon.hardforkTimestamp(checkNotBeforeHf)
    if (hfTimeStamp !== null && timestamp < hfTimeStamp) {
      throw {
        code: UNSUPPORTED_FORK,
        message: `V${methodVersion} cannot be called pre-${checkNotBeforeHf}`,
      }
    }
  }

  if (checkNotAfterHf !== null) {
    const nextHFTimestamp = chainCommon.nextHardforkBlockOrTimestamp(checkNotAfterHf)
    if (nextHFTimestamp !== null && timestamp >= nextHFTimestamp) {
      throw {
        code: UNSUPPORTED_FORK,
        message: `V${methodVersion + 1} MUST be called post-${checkNotAfterHf}`,
      }
    }
  }
}
