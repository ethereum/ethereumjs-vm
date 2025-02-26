import { createBlock } from '@ethereumjs/block'
import { BIGINT_0, EthereumJSErrorWithoutCode, bytesToHex, equalsBytes } from '@ethereumjs/util'
import debugDefault from 'debug'

import {
  Blockchain,
  DBSaveLookups,
  DBSetBlockOrHeader,
  DBSetTD,
  genGenesisStateRoot,
  getGenesisStateRoot,
} from './index.js'

import type { BlockchainOptions, DBOp } from './index.js'
import type { BlockData } from '@ethereumjs/block'
import type { Chain } from '@ethereumjs/common'

const DEBUG =
  typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
const debug = debugDefault('blockchain:#')

export async function createBlockchain(opts: BlockchainOptions = {}) {
  const blockchain = new Blockchain(opts)

  await blockchain.consensus?.setup({ blockchain })

  let stateRoot = opts.genesisBlock?.header.stateRoot ?? opts.genesisStateRoot
  if (stateRoot === undefined) {
    if (blockchain['_customGenesisState'] !== undefined) {
      stateRoot = await genGenesisStateRoot(blockchain['_customGenesisState'], blockchain.common)
    } else {
      stateRoot = await getGenesisStateRoot(
        Number(blockchain.common.chainId()) as Chain,
        blockchain.common,
      )
    }
  }

  const genesisBlock = opts.genesisBlock ?? blockchain.createGenesisBlock(stateRoot)

  let genesisHash = await blockchain.dbManager.numberToHash(BIGINT_0)

  const dbGenesisBlock =
    genesisHash !== undefined ? await blockchain.dbManager.getBlock(genesisHash) : undefined

  // If the DB has a genesis block, then verify that the genesis block in the
  // DB is indeed the Genesis block generated or assigned.
  if (dbGenesisBlock !== undefined && !equalsBytes(genesisBlock.hash(), dbGenesisBlock.hash())) {
    throw EthereumJSErrorWithoutCode(
      'The genesis block in the DB has a different hash than the provided genesis block.',
    )
  }

  genesisHash = genesisBlock.hash()

  if (!dbGenesisBlock) {
    // If there is no genesis block put the genesis block in the DB.
    // For that TD, the BlockOrHeader, and the Lookups have to be saved.
    const dbOps: DBOp[] = []
    dbOps.push(DBSetTD(genesisBlock.header.difficulty, BIGINT_0, genesisHash))
    DBSetBlockOrHeader(genesisBlock).map((op) => dbOps.push(op))
    DBSaveLookups(genesisHash, BIGINT_0).map((op) => dbOps.push(op))
    await blockchain.dbManager.batch(dbOps)
    await blockchain.consensus?.genesisInit(genesisBlock)
  }

  // At this point, we can safely set the genesis:
  // it is either the one we put in the DB, or it is equal to the one
  // which we read from the DB.
  blockchain['_genesisBlock'] = genesisBlock

  // load verified iterator heads
  const heads = await blockchain.dbManager.getHeads()
  blockchain['_heads'] = heads !== undefined ? heads : {}

  // load headerchain head
  let hash = await blockchain.dbManager.getHeadHeader()
  blockchain['_headHeaderHash'] = hash !== undefined ? hash : genesisHash

  // load blockchain head
  hash = await blockchain.dbManager.getHeadBlock()
  blockchain['_headBlockHash'] = hash !== undefined ? hash : genesisHash

  if (blockchain['_hardforkByHeadBlockNumber']) {
    const latestHeader = await blockchain['_getHeader'](blockchain['_headHeaderHash'])
    await blockchain.checkAndTransitionHardForkByNumber(latestHeader.number, latestHeader.timestamp)
  }

  DEBUG && debug(`genesis block initialized with hash ${bytesToHex(genesisHash!)}`)

  return blockchain
}

/**
 * Creates a blockchain from a list of block objects,
 * objects must be readable by {@link createBlock}
 *
 * @param blockData List of block objects
 * @param opts Constructor options, see {@link BlockchainOptions}
 */
export async function createBlockchainFromBlocksData(
  blocksData: BlockData[],
  opts: BlockchainOptions = {},
) {
  const blockchain = await createBlockchain(opts)
  for (const blockData of blocksData) {
    const block = createBlock(blockData, {
      common: blockchain.common,
      setHardfork: true,
    })
    await blockchain.putBlock(block)
  }
  return blockchain
}
