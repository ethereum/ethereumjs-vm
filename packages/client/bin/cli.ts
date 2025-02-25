#!/usr/bin/env node

import { createBlockFromBytesArray } from '@ethereumjs/block'
import { CliqueConsensus, createBlockchain } from '@ethereumjs/blockchain'
import { ConsensusAlgorithm, Hardfork } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { bytesToHex, short } from '@ethereumjs/util'
import { mkdirSync, readFileSync } from 'fs'
import { Level } from 'level'

import { EthereumClient } from '../src/client.js'
import { DataDirectory } from '../src/config.js'
import { LevelDB } from '../src/execution/level.js'
import { eraSync } from '../src/sync/erasync.js'
import { type ClientOpts } from '../src/types.js'
import { generateVKTStateRoot } from '../src/util/vkt.js'

import { helpRPC, startRPCServers } from './startRPC.js'
import { generateClientConfig, getArgs } from './utils.js'

import type { Config } from '../src/config.js'
import type { Logger } from '../src/logging.js'
import type { FullEthereumService } from '../src/service/index.js'
import type { RPCArgs } from './startRPC.js'
import type { Block, BlockBytes } from '@ethereumjs/block'
import type { ConsensusDict } from '@ethereumjs/blockchain'
import type { GenesisState } from '@ethereumjs/util'
import type { AbstractLevel } from 'abstract-level'
import type * as http from 'http'
import type { Server as RPCServer } from 'jayson/promise/index.js'

let logger: Logger

const args: ClientOpts = getArgs()

/**
 * Initializes and returns the databases needed for the client
 */
function initDBs(config: Config): {
  chainDB: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
  stateDB: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
  metaDB: AbstractLevel<string | Uint8Array, string | Uint8Array, string | Uint8Array>
} {
  // Chain DB
  const chainDataDir = config.getDataDirectory(DataDirectory.Chain)
  mkdirSync(chainDataDir, {
    recursive: true,
  })
  const chainDB = new Level<string | Uint8Array, string | Uint8Array>(chainDataDir)

  // State DB
  const stateDataDir = config.getDataDirectory(DataDirectory.State)
  mkdirSync(stateDataDir, {
    recursive: true,
  })
  const stateDB = new Level<string | Uint8Array, string | Uint8Array>(stateDataDir)

  // Meta DB (receipts, logs, indexes, skeleton chain)
  const metaDataDir = config.getDataDirectory(DataDirectory.Meta)
  mkdirSync(metaDataDir, {
    recursive: true,
  })
  const metaDB = new Level<string | Uint8Array, string | Uint8Array>(metaDataDir)

  return { chainDB, stateDB, metaDB }
}

/**
 * Special block execution debug mode (does not change any state)
 */
async function executeBlocks(client: EthereumClient) {
  let first = 0
  let last = 0
  let txHashes = []
  try {
    const blockRange = (args.executeBlocks as string).split('-').map((val) => {
      const reNum = /([0-9]+)/.exec(val)
      const num = reNum ? parseInt(reNum[1]) : 0
      const reTxs = /[0-9]+\[(.*)\]/.exec(val)
      const txs = reTxs ? reTxs[1].split(',') : []
      return [num, txs]
    })
    first = blockRange[0][0] as number
    last = blockRange.length === 2 ? (blockRange[1][0] as number) : first
    txHashes = blockRange[0][1] as string[]

    if ((blockRange[0][1] as string[]).length > 0 && blockRange.length === 2) {
      throw new Error('wrong input')
    }
  } catch (e: any) {
    throw new Error(
      'Wrong input format for block execution, allowed format types: 5, 5-10, 5[0xba4b5fd92a26badad3cad22eb6f7c7e745053739b5f5d1e8a3afb00f8fb2a280,[TX_HASH_2],...], 5[*] (all txs in verbose mode)',
    )
  }
  const { execution } = client.service
  if (execution === undefined) throw new Error('executeBlocks requires execution')
  await execution.executeBlocks(first, last, txHashes)
}

/**
 * Starts the client on a specified block number.
 * Note: this is destructive and removes blocks from the blockchain. Please back up your datadir.
 */
async function startBlock(client: EthereumClient) {
  if (args.startBlock === undefined) return
  const startBlock = BigInt(args.startBlock)
  const height = client.chain.headers.height
  if (height < startBlock) {
    throw new Error(`Cannot start chain higher than current height ${height}`)
  }
  try {
    await client.chain.resetCanonicalHead(startBlock)
    client.config.logger.info(`Chain height reset to ${client.chain.headers.height}`)
  } catch (err: any) {
    throw new Error(`Error setting back chain in startBlock: ${err}`)
  }
}

async function startExecutionFrom(client: EthereumClient) {
  if (args.startExecutionFrom === undefined) return
  const startExecutionFrom = BigInt(args.startExecutionFrom)

  const height = client.chain.headers.height
  if (height < startExecutionFrom) {
    throw new Error(`Cannot start merkle chain higher than current height ${height}`)
  }

  const startExecutionBlock = await client.chain.getBlock(startExecutionFrom)
  const startExecutionParent = await client.chain.getBlock(startExecutionBlock.header.parentHash)

  const startExecutionHardfork = client.config.execCommon.getHardforkBy({
    blockNumber: startExecutionBlock.header.number,
    timestamp: startExecutionBlock.header.timestamp,
  })

  if (client.config.execCommon.hardforkGteHardfork(startExecutionHardfork, Hardfork.Verkle)) {
    if (client.config.statelessVerkle) {
      // for stateless verkle sync execution witnesses are available and hence we can blindly set the vmHead
      // to startExecutionParent's hash
      try {
        await client.chain.blockchain.setIteratorHead('vm', startExecutionParent.hash())
        await client.chain.update(false)
        client.config.logger.info(
          `vmHead set to ${client.chain.headers.height} for starting stateless execution at hardfork=${startExecutionHardfork}`,
        )
      } catch (err: any) {
        throw new Error(`Error setting vmHead for starting stateless execution: ${err}`)
      }
    } else if (client.config.statefulVerkle) {
      try {
        await client.chain.blockchain.setIteratorHead('vm', startExecutionParent.hash())
        await client.chain.update(false)
        client.config.logger.info(
          `vmHead set to ${client.chain.headers.height} for starting stateful execution at hardfork=${startExecutionHardfork}`,
        )
      } catch (err: any) {
        throw new Error(`Error setting vmHead for starting stateful execution: ${err}`)
      }
    } else {
      // we need parent state availability to set the vmHead to the parent
      throw new Error(
        `Stateful execution reset not implemented at hardfork=${startExecutionHardfork}`,
      )
    }
  }
}

/**
 * Starts and returns the {@link EthereumClient}
 */
async function startClient(
  config: Config,
  genesisMeta: { genesisState?: GenesisState; genesisStateRoot?: Uint8Array } = {},
) {
  config.logger.info(`Data directory: ${config.datadir}`)

  const dbs = initDBs(config)

  let blockchain
  if (genesisMeta.genesisState !== undefined || genesisMeta.genesisStateRoot !== undefined) {
    let validateConsensus = false
    const consensusDict: ConsensusDict = {}
    if (config.chainCommon.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      consensusDict[ConsensusAlgorithm.Clique] = new CliqueConsensus()
      validateConsensus = true
    }

    let stateRoot
    if (config.statefulVerkle) {
      if (genesisMeta.genesisState === undefined) {
        throw new Error('genesisState is required to compute stateRoot')
      }
      stateRoot = await generateVKTStateRoot(genesisMeta.genesisState, config.chainCommon)
    }

    blockchain = await createBlockchain({
      db: new LevelDB(dbs.chainDB),
      ...genesisMeta,
      common: config.chainCommon,
      hardforkByHeadBlockNumber: true,
      validateBlocks: true,
      validateConsensus,
      consensusDict,
      genesisState: genesisMeta.genesisState,
      genesisStateRoot: stateRoot,
    })
    config.chainCommon.setForkHashes(blockchain.genesisBlock.hash())
  }

  const client = await EthereumClient.create({
    config,
    blockchain,
    ...genesisMeta,
    ...dbs,
  })
  await client.open()
  if (args.loadBlocksFromEra1 !== undefined) {
    await eraSync(client, config, { loadBlocksFromEra1: args.loadBlocksFromEra1 })
  }
  if (args.loadBlocksFromRlp !== undefined) {
    // Specifically for Hive simulator, preload blocks provided in RLP format
    const blocks: Block[] = []
    for (const rlpBlock of args.loadBlocksFromRlp) {
      const blockRlp = readFileSync(rlpBlock)
      let buf = RLP.decode(blockRlp, true)
      while (buf.data?.length > 0 || buf.remainder?.length > 0) {
        try {
          const block = createBlockFromBytesArray(buf.data as BlockBytes, {
            common: config.chainCommon,
            setHardfork: true,
          })
          blocks.push(block)
          buf = RLP.decode(buf.remainder, true)
          config.logger.info(
            `Preloading block hash=${short(bytesToHex(block.header.hash()))} number=${
              block.header.number
            }`,
          )
        } catch (err: any) {
          config.logger.info(
            `Encountered error while while preloading chain data  error=${err.message}`,
          )
          break
        }
      }
    }

    if (blocks.length > 0) {
      if (!client.chain.opened) {
        await client.chain.open()
      }

      await client.chain.putBlocks(blocks, true)
    }
  }

  if (typeof args.startBlock === 'number') {
    await startBlock(client)
  }
  if (typeof args.startExecutionFrom === 'number') {
    await startExecutionFrom(client)
  }

  // update client's sync status and start txpool if synchronized
  client.config.updateSynchronizedState(client.chain.headers.latest)
  if (client.config.synchronized === true) {
    const fullService = client.service
    // The service might not be FullEthereumService even if we cast it as one,
    // so txPool might not exist on it
    ;(fullService as FullEthereumService).txPool?.checkRunState()
  }

  if (args.executeBlocks !== undefined) {
    // Special block execution debug mode (does not change any state)
    await executeBlocks(client)
  } else {
    // Regular client start
    await client.start()
  }

  if (args.loadBlocksFromRlp !== undefined && client.chain.opened) {
    const service = client.service
    await service.execution.open()
    await service.execution.run()
  }
  return client
}

/**
 * Shuts down an actively running client gracefully
 * @param config Client config object
 * @param clientStartPromise promise that returns a client and server object
 */
const stopClient = async (
  config: Config,
  clientStartPromise: Promise<{
    client: EthereumClient
    servers: (RPCServer | http.Server)[]
  } | null>,
) => {
  config.logger.info('Caught interrupt signal. Obtaining client handle for clean shutdown...')
  config.logger.info('(This might take a little longer if client not yet fully started)')
  let timeoutHandle
  if (clientStartPromise?.toString().includes('Promise') === true)
    // Client hasn't finished starting up so setting timeout to terminate process if not already shutdown gracefully
    timeoutHandle = setTimeout(() => {
      config.logger.warn('Client has become unresponsive while starting up.')
      config.logger.warn('Check logging output for potential errors.  Exiting...')
      process.exit(1)
    }, 30000)
  const clientHandle = await clientStartPromise
  if (clientHandle !== null) {
    config.logger.info('Shutting down the client and the servers...')
    const { client, servers } = clientHandle
    for (const s of servers) {
      // @ts-expect-error jayson.Server type doesn't play well with ESM for some reason
      s['http'] !== undefined ? (s as RPCServer).http().close() : (s as http.Server).close()
    }
    await client.stop()
    config.logger.info('Exiting.')
  } else {
    config.logger.info('Client did not start properly, exiting ...')
  }
  clearTimeout(timeoutHandle)
  process.exit()
}

/**
 * Main entry point to start a client
 */
async function run() {
  if (args.helpRPC === true) {
    // Output RPC help and exit
    return helpRPC()
  }

  const { config, customGenesisState, customGenesisStateRoot, metricsServer } =
    await generateClientConfig(args)

  logger = config.logger

  // Do not wait for client to be fully started so that we can hookup SIGINT handling
  // else a SIGINT before may kill the process in unclean manner
  const clientStartPromise = startClient(config, {
    genesisState: customGenesisState,
    genesisStateRoot: customGenesisStateRoot,
  })
    .then((client) => {
      const servers: (RPCServer | http.Server)[] =
        args.rpc === true || args.rpcEngine === true || args.ws === true
          ? startRPCServers(client, args as RPCArgs)
          : []
      if (
        client.config.chainCommon.gteHardfork(Hardfork.Paris) &&
        (args.rpcEngine === false || args.rpcEngine === undefined)
      ) {
        config.logger.warn(`Engine RPC endpoint not activated on a post-Merge HF setup.`)
      }
      if (metricsServer !== undefined) servers.push(metricsServer)
      config.superMsg('Client started successfully')
      return { client, servers }
    })
    .catch((e) => {
      config.logger.error('Error starting client', e)
      return null
    })

  process.on('SIGINT', async () => {
    await stopClient(config, clientStartPromise)
  })

  process.on('SIGTERM', async () => {
    await stopClient(config, clientStartPromise)
  })

  process.on('uncaughtException', (err) => {
    // Handles uncaught exceptions that are thrown in async events/functions and aren't caught in
    // main client process
    config.logger.error(`Uncaught error: ${err.message}`)
    config.logger.error(err)

    void stopClient(config, clientStartPromise)
  })
}

run().catch((err) => {
  /* eslint-disable no-console */
  console.log(err)
  logger?.error(err.message.toString()) ?? console.error(err)
  /* eslint-enable no-console */
})
