import { RLP } from '@ethereumjs/rlp'
import { EthereumJSErrorWithoutCode, bigIntToBytes, equalsBytes } from '@ethereumjs/util'

import { generateCliqueBlockExtraData } from '../consensus/clique.js'
import { numberToHex, valuesArrayToHeaderData } from '../helpers.js'
import { BlockHeader } from '../index.js'

import type { BlockHeaderBytes, BlockOptions, HeaderData, JSONRPCBlock } from '../types.js'

/**
 * Static constructor to create a block header from a header data dictionary
 *
 * @param headerData
 * @param opts
 */
export function createBlockHeader(headerData: HeaderData = {}, opts: BlockOptions = {}) {
  return new BlockHeader(headerData, opts)
}

/**
 * Static constructor to create a block header from an array of bytes values
 *
 * @param values
 * @param opts
 */
export function createBlockHeaderFromBytesArray(values: BlockHeaderBytes, opts: BlockOptions = {}) {
  const headerData = valuesArrayToHeaderData(values)
  const { number, baseFeePerGas, excessBlobGas, blobGasUsed, parentBeaconBlockRoot, requestsHash } =
    headerData
  const header = createBlockHeader(headerData, opts)
  if (header.common.isActivatedEIP(1559) && baseFeePerGas === undefined) {
    const eip1559ActivationBlock = bigIntToBytes(header.common.eipBlock(1559)!)
    if (
      eip1559ActivationBlock !== undefined &&
      equalsBytes(eip1559ActivationBlock, number as Uint8Array)
    ) {
      throw EthereumJSErrorWithoutCode('invalid header. baseFeePerGas should be provided')
    }
  }
  if (header.common.isActivatedEIP(4844)) {
    if (excessBlobGas === undefined) {
      throw EthereumJSErrorWithoutCode('invalid header. excessBlobGas should be provided')
    } else if (blobGasUsed === undefined) {
      throw EthereumJSErrorWithoutCode('invalid header. blobGasUsed should be provided')
    }
  }
  if (header.common.isActivatedEIP(4788) && parentBeaconBlockRoot === undefined) {
    throw EthereumJSErrorWithoutCode('invalid header. parentBeaconBlockRoot should be provided')
  }

  if (header.common.isActivatedEIP(7685) && requestsHash === undefined) {
    throw EthereumJSErrorWithoutCode('invalid header. requestsHash should be provided')
  }
  return header
}

/**
 * Static constructor to create a block header from a RLP-serialized header
 *
 * @param serializedHeaderData
 * @param opts
 */
export function createBlockHeaderFromRLP(
  serializedHeaderData: Uint8Array,
  opts: BlockOptions = {},
) {
  const values = RLP.decode(serializedHeaderData)
  if (!Array.isArray(values)) {
    throw EthereumJSErrorWithoutCode('Invalid serialized header input. Must be array')
  }
  return createBlockHeaderFromBytesArray(values as Uint8Array[], opts)
}

export function createSealedCliqueBlockHeader(
  headerData: HeaderData = {},
  cliqueSigner: Uint8Array,
  opts: BlockOptions = {},
): BlockHeader {
  const sealedCliqueBlockHeader = new BlockHeader(headerData, {
    ...opts,
    ...{ skipConsensusFormatValidation: true },
  })
  ;(sealedCliqueBlockHeader.extraData as any) = generateCliqueBlockExtraData(
    sealedCliqueBlockHeader,
    cliqueSigner,
  )
  if (opts.skipConsensusFormatValidation === false)
    // We need to validate the consensus format here since we skipped it when constructing the block header
    sealedCliqueBlockHeader['_consensusFormatValidation']()
  return sealedCliqueBlockHeader
}

/**
 * Creates a new block header object from Ethereum JSON RPC.
 *
 * @param blockParams - Ethereum JSON RPC of block (eth_getBlockByNumber)
 * @param options - An object describing the blockchain
 */
export function createBlockHeaderFromRPC(blockParams: JSONRPCBlock, options?: BlockOptions) {
  const {
    parentHash,
    sha3Uncles,
    miner,
    stateRoot,
    transactionsRoot,
    receiptsRoot,
    logsBloom,
    difficulty,
    number,
    gasLimit,
    gasUsed,
    timestamp,
    extraData,
    mixHash,
    nonce,
    baseFeePerGas,
    withdrawalsRoot,
    blobGasUsed,
    excessBlobGas,
    parentBeaconBlockRoot,
    requestsHash,
  } = blockParams

  const blockHeader = new BlockHeader(
    {
      parentHash,
      uncleHash: sha3Uncles,
      coinbase: miner,
      stateRoot,
      transactionsTrie: transactionsRoot,
      receiptTrie: receiptsRoot,
      logsBloom,
      difficulty: numberToHex(difficulty),
      number,
      gasLimit,
      gasUsed,
      timestamp,
      extraData,
      mixHash,
      nonce,
      baseFeePerGas,
      withdrawalsRoot,
      blobGasUsed,
      excessBlobGas,
      parentBeaconBlockRoot,
      requestsHash,
    },
    options,
  )

  return blockHeader
}
