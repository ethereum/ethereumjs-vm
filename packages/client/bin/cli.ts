#!/usr/bin/env node

import { Block } from '@ethereumjs/block'
import { Blockchain } from '@ethereumjs/blockchain'
import { Chain, Common, ConsensusAlgorithm, Hardfork } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  Address,
  bytesToHex,
  hexToBytes,
  initKZG,
  parseGethGenesisState,
  randomBytes,
  short,
  toBytes,
} from '@ethereumjs/util'
import * as kzg from 'c-kzg'
import { existsSync, writeFileSync } from 'fs'
import { ensureDirSync, readFileSync, removeSync } from 'fs-extra'
import { Level } from 'level'
import { homedir } from 'os'
import * as path from 'path'
import readline from 'readline'
import * as yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { EthereumClient } from '../src/client'
import { Config, DataDirectory, SyncMode } from '../src/config'
import { LevelDB } from '../src/execution/level'
import { getLogger } from '../src/logging'
import { Event } from '../src/types'
import { parseMultiaddrs } from '../src/util'

import { helprpc, startRPCServers } from './startRpc'

import type { Logger } from '../src/logging'
import type { FullEthereumService } from '../src/service'
import type { ClientOpts } from '../src/types'
import type { RPCArgs } from './startRpc'
import type { BlockBytes } from '@ethereumjs/block'
import type { GenesisState } from '@ethereumjs/util'
import type { AbstractLevel } from 'abstract-level'

type Account = [address: Address, privateKey: Uint8Array]

const networks = Object.entries(Common.getInitializedChains().names)

let logger: Logger

const args: ClientOpts = yargs(hideBin(process.argv))
  .parserConfiguration({
    'dot-notation': false,
  })
  .option('network', {
    describe: 'Network',
    choices: networks.map((n) => n[1]).filter((el) => isNaN(parseInt(el))),
    default: 'mainnet',
  })
  .option('networkId', {
    describe: 'Network ID',
    choices: networks.map((n) => parseInt(n[0])).filter((el) => !isNaN(el)),
    default: undefined,
    conflicts: ['customChain', 'customGenesisState', 'gethGenesis'], // Disallows custom chain data and networkId
  })
  .option('sync', {
    describe: 'Blockchain sync mode (light sync experimental)',
    choices: Object.values(SyncMode),
    default: Config.SYNCMODE_DEFAULT,
  })
  .option('lightServe', {
    describe: 'Serve light peer requests',
    boolean: true,
    default: Config.LIGHTSERV_DEFAULT,
  })
  .option('dataDir', {
    describe: 'Data directory for the blockchain',
    default: `${homedir()}/Library/Ethereum/ethereumjs`,
  })
  .option('customChain', {
    describe: 'Path to custom chain parameters json file (@ethereumjs/common format)',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
    implies: 'customGenesisState',
  })
  .option('customGenesisState', {
    describe: 'Path to custom genesis state json file (@ethereumjs/common format)',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
    implies: 'customChain',
  })
  .option('verkleGenesisStateRoot', {
    describe: 'State root of the verkle genesis genesis (experimental)',
    string: true,
    coerce: (customGenesisStateRoot: string) => hexToBytes(customGenesisStateRoot),
  })
  .option('gethGenesis', {
    describe: 'Import a geth genesis file for running a custom network',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
  })
  .option('trustedSetup', {
    describe: 'A custom trusted setup txt file for initializing the kzg library',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
  })
  .option('mergeForkIdPostMerge', {
    describe:
      'Place mergeForkIdTransition hardfork before (false) or after (true) Merge hardfork in the custom gethGenesis',
    boolean: true,
    default: true,
  })
  .option('bootnodes', {
    describe:
      'Comma-separated list of network bootnodes (format: "enode://<id>@<host:port>,enode://..." ("[?discport=<port>]" not supported) or path to a bootnode.txt file',
    array: true,
    coerce: (arr) => arr.filter((el: any) => el !== undefined).map((el: any) => el.toString()),
  })
  .option('port', {
    describe: 'RLPx listening port',
    default: Config.PORT_DEFAULT,
  })
  .option('extIP', {
    describe: 'RLPx external IP',
    string: true,
  })
  .option('multiaddrs', {
    describe: 'Network multiaddrs',
    array: true,
    coerce: (arr) => arr.filter((el: any) => el !== undefined).map((el: any) => el.toString()),
  })
  .option('rpc', {
    describe: 'Enable the JSON-RPC server with HTTP endpoint',
    boolean: true,
  })
  .option('rpcPort', {
    describe: 'HTTP-RPC server listening port',
    default: 8545,
  })
  .option('rpcAddr', {
    describe: 'HTTP-RPC server listening interface address',
    default: 'localhost',
  })
  .option('ws', {
    describe: 'Enable the JSON-RPC server with WS endpoint',
    boolean: true,
  })
  .option('wsPort', {
    describe: 'WS-RPC server listening port',
    default: 8546,
  })
  .option('wsAddr', {
    describe: 'WS-RPC server listening address',
    default: 'localhost',
  })
  .option('rpcEngine', {
    describe: 'Enable the JSON-RPC server for Engine namespace',
    boolean: true,
  })
  .option('rpcEnginePort', {
    describe: 'HTTP-RPC server listening port for Engine namespace',
    number: true,
    default: 8551,
  })
  .option('rpcEngineAddr', {
    describe: 'HTTP-RPC server listening interface address for Engine namespace',
    string: true,
    default: 'localhost',
  })
  .option('wsEnginePort', {
    describe: 'WS-RPC server listening port for Engine namespace',
    number: true,
    default: 8552,
  })
  .option('wsEngineAddr', {
    describe: 'WS-RPC server listening interface address for Engine namespace',
    string: true,
    default: 'localhost',
  })
  .option('rpcEngineAuth', {
    describe: 'Enable jwt authentication for Engine RPC server',
    boolean: true,
    default: true,
  })
  .option('jwtSecret', {
    describe: 'Provide a file containing a hex encoded jwt secret for Engine RPC server',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
  })
  .option('helpRpc', {
    describe: 'Display the JSON RPC help with a list of all RPC methods implemented (and exit)',
    boolean: true,
  })
  .option('logLevel', {
    describe: 'Logging verbosity',
    choices: ['error', 'warn', 'info', 'debug'],
    default: 'info',
  })
  .option('logFile', {
    describe:
      'File to save log file (default logs to `$dataDir/ethereumjs.log`, pass false to disable)',
    default: true,
  })
  .option('logLevelFile', {
    describe: 'Log level for logFile',
    choices: ['error', 'warn', 'info', 'debug'],
    default: 'debug',
  })
  .option('logRotate', {
    describe: 'Rotate log file daily',
    boolean: true,
    default: true,
  })
  .option('logMaxFiles', {
    describe: 'Maximum number of log files when rotating (older will be deleted)',
    number: true,
    default: 5,
  })
  .option('rpcDebug', {
    describe:
      'Additionally log truncated RPC calls filtered by name (prefix), e.g.: "eth,engine_getPayload" (use "all" for all methods). Truncated by default, add verbosity using "rpcDebugVerbose"',
    default: '',
    string: true,
  })
  .option('rpcDebugVerbose', {
    describe:
      'Additionally log complete RPC calls filtered by name (prefix), e.g.: "eth,engine_getPayload" (use "all" for all methods).',
    default: '',
    string: true,
  })
  .option('rpcCors', {
    describe: 'Configure the Access-Control-Allow-Origin CORS header for RPC server',
    string: true,
    default: '*',
  })
  .option('maxPerRequest', {
    describe: 'Max items per block or header request',
    number: true,
    default: Config.MAXPERREQUEST_DEFAULT,
  })
  .option('maxFetcherJobs', {
    describe: 'Max tasks or jobs to be created for a fetcher at a time',
    number: true,
    default: Config.MAXFETCHERJOBS_DEFAULT,
  })
  .option('minPeers', {
    describe: 'Peers needed before syncing',
    number: true,
    default: Config.MINPEERS_DEFAULT,
  })
  .option('maxPeers', {
    describe: 'Maximum peers to sync with',
    number: true,
    default: Config.MAXPEERS_DEFAULT,
  })
  .option('dnsAddr', {
    describe: 'IPv4 address of DNS server to use when acquiring peer discovery targets',
    string: true,
    default: Config.DNSADDR_DEFAULT,
  })
  .option('dnsNetworks', {
    describe: 'EIP-1459 ENR tree urls to query for peer discovery targets',
    array: true,
    coerce: (arr) => arr.filter((el: any) => el !== undefined).map((el: any) => el.toString()),
  })
  .option('execution', {
    describe: 'Start continuous VM execution (pre-Merge setting)',
    boolean: true,
    default: Config.EXECUTION,
  })
  .option('numBlocksPerIteration', {
    describe: 'Number of blocks to execute in batch mode and logged to console',
    number: true,
    default: Config.NUM_BLOCKS_PER_ITERATION,
  })
  .option('executeBlocks', {
    describe:
      'Debug mode for reexecuting existing blocks (no services will be started), allowed input formats: 5,5-10',
    string: true,
  })
  .option('accountCache', {
    describe: 'Size for the account cache (max number of accounts)',
    number: true,
    default: Config.ACCOUNT_CACHE,
  })
  .option('storageCache', {
    describe: 'Size for the storage cache (max number of contracts)',
    number: true,
    default: Config.STORAGE_CACHE,
  })
  .option('codeCache', {
    describe: 'Size for the code cache (max number of contracts)',
    number: true,
    default: Config.CODE_CACHE,
  })
  .option('trieCache', {
    describe: 'Size for the trie cache (max number of trie nodes)',
    number: true,
    default: Config.TRIE_CACHE,
  })
  .option('debugCode', {
    describe: 'Generate code for local debugging (internal usage mostly)',
    boolean: true,
    default: Config.DEBUGCODE_DEFAULT,
  })
  .option('discDns', {
    describe: 'Query EIP-1459 DNS TXT records for peer discovery',
    boolean: true,
  })
  .option('discV4', {
    describe: 'Use v4 ("findneighbour" node requests) for peer discovery',
    boolean: true,
  })
  .option('mine', {
    describe: 'Enable private custom network mining (beta)',
    boolean: true,
  })
  .option('unlock', {
    describe: `Path to file where private key (without 0x) is stored or comma separated list of accounts to unlock -
      currently only the first account is used (for sealing PoA blocks and as the default coinbase).
      You will be prompted for a 0x-prefixed private key if you pass a list of accounts
      FOR YOUR SAFETY PLEASE DO NOT USE ANY ACCOUNTS HOLDING SUBSTANTIAL AMOUNTS OF ETH`,
    string: true,
  })
  .option('dev', {
    describe: 'Start an ephemeral PoA blockchain with a single miner and prefunded accounts',
    choices: ['false', 'true', 'poa', 'pow'],
  })
  .option('minerCoinbase', {
    describe:
      'Address for mining rewards (etherbase). If not provided, defaults to the primary account',
    string: true,
    coerce: (coinbase) => Address.fromString(coinbase),
  })
  .option('saveReceipts', {
    describe:
      'Save tx receipts and logs in the meta db (warning: may use a large amount of storage). With `--rpc` allows querying via eth_getLogs (max 10000 logs per request) and eth_getTransactionReceipt (within `--txLookupLimit`)',
    boolean: true,
    default: true,
  })
  .option('snap', {
    describe: 'Enable snap state sync (for testing and development purposes)',
    boolean: true,
  })
  .option('prefixStorageTrieKeys', {
    describe:
      'Enable/Disable storage trie prefixes (specify `false` for backward compatibility with previous states synced without prefixes)',
    boolean: true,
    default: true,
    deprecated:
      'Support for `--prefixStorageTrieKeys=false` is temporary. Please sync new instances with `prefixStorageTrieKeys` enabled',
  })
  .options('useStringValueTrieDB', {
    describe:
      'Use string values in the trie DB. This is old behavior, new behavior uses Uint8Arrays in the DB (more performant)',
    boolean: true,
    default: false,
    deprecated:
      'Usage of old DBs which uses string-values is temporary. Please sync new instances without this option.',
  })
  .option('txLookupLimit', {
    describe:
      'Number of recent blocks to maintain transactions index for (default = about one year, 0 = entire chain)',
    number: true,
    default: 2350000,
  })
  .option('startBlock', {
    describe:
      'Block number to start syncing from. Must be lower than the local chain tip. Note: this is destructive and removes blocks from the blockchain, please back up your datadir before using.',
    number: true,
  })
  .option('isSingleNode', {
    describe:
      'To run client in single node configuration without need to discover the sync height from peer. Particularly useful in test configurations. This flag is automically activated in the "dev" mode',
    boolean: true,
  })
  .option('vmProfileBlocks', {
    describe: 'Report the VM profile after running each block',
    boolean: true,
    default: false,
  })
  .option('vmProfileTxs', {
    describe: 'Report the VM profile after running each tx',
    boolean: true,
    default: false,
  })
  .option('loadBlocksFromRlp', {
    describe: 'path to a file of RLP encoded blocks',
    string: true,
  })
  .option('pruneEngineCache', {
    describe: 'Enable/Disable pruning engine block cache (disable for testing against hive etc)',
    boolean: true,
    default: true,
  })
  .option('statelessVerkle', {
    describe: 'Run verkle+ hardforks using stateless verkle stateManager (experimental)',
    boolean: true,
    default: true,
  })
  .option('engineNewpayloadMaxExecute', {
    describe:
      'Number of unexecuted blocks (including ancestors) that can be blockingly executed in engine`s new payload (if required and possible) to determine the validity of the block',
    number: true,
  })
  .option('skipEngineExec', {
    describe:
      'Skip executing blocks in new payload calls in engine, alias for --engineNewpayloadMaxExecute=0 and overrides any engineNewpayloadMaxExecute if also provided',
    boolean: true,
  })
  .option('fourFours', {
    describe: 'Activate EIP-4444 to prune ancient chain history',
    boolean: true,
    default: false,
  })
  .completion()
  // strict() ensures that yargs throws when an invalid arg is provided
  .strict()
  .check((argv, _options) => {
    const usedPorts = new Set()
    let collision = false
    if (argv.ws === true) {
      usedPorts.add(argv.wsPort)
      if (!usedPorts.has(argv.wsEnginePort)) {
        usedPorts.add(argv.wsEnginePort)
      }
    }
    if (argv.rpc === true && usedPorts.has(argv.rpcPort)) collision = true
    if (argv.rpcEngine === true && usedPorts.has(argv.rpcEnginePort)) collision = true

    if (collision) throw new Error('cannot reuse ports between RPC instances')
    return true
  })
  .parseSync()

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
  ensureDirSync(chainDataDir)
  const chainDB = new Level<string | Uint8Array, string | Uint8Array>(chainDataDir)

  // State DB
  const stateDataDir = config.getDataDirectory(DataDirectory.State)
  ensureDirSync(stateDataDir)
  const stateDB = new Level<string | Uint8Array, string | Uint8Array>(stateDataDir)

  // Meta DB (receipts, logs, indexes, skeleton chain)
  const metaDataDir = config.getDataDirectory(DataDirectory.Meta)
  ensureDirSync(metaDataDir)
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
    client.config.logger.error(
      'Wrong input format for block execution, allowed format types: 5, 5-10, 5[0xba4b5fd92a26badad3cad22eb6f7c7e745053739b5f5d1e8a3afb00f8fb2a280,[TX_HASH_2],...], 5[*] (all txs in verbose mode)'
    )
    process.exit()
  }
  const { execution } = client.services.find((s) => s.name === 'eth') as FullEthereumService
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
    logger.error(`Cannot start chain higher than current height ${height}`)
    process.exit()
  }
  try {
    await client.chain.resetCanonicalHead(startBlock)
    logger.info(`Chain height reset to ${client.chain.headers.height}`)
  } catch (err: any) {
    logger.error(`Error setting back chain in startBlock: ${err}`)
    process.exit()
  }
}

/**
 * Starts and returns the {@link EthereumClient}
 */
async function startClient(
  config: Config,
  genesisMeta: { genesisState?: GenesisState; genesisStateRoot?: Uint8Array } = {}
) {
  config.logger.info(`Data directory: ${config.datadir}`)
  if (config.lightserv) {
    config.logger.info(`Serving light peer requests`)
  }

  const dbs = initDBs(config)

  let blockchain
  if (genesisMeta.genesisState !== undefined || genesisMeta.genesisStateRoot !== undefined) {
    const validateConsensus = config.chainCommon.consensusAlgorithm() === ConsensusAlgorithm.Clique
    blockchain = await Blockchain.create({
      db: new LevelDB(dbs.chainDB),
      ...genesisMeta,
      common: config.chainCommon,
      hardforkByHeadBlockNumber: true,
      validateConsensus,
      validateBlocks: true,
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

  if (args.loadBlocksFromRlp !== undefined) {
    // Specifically for Hive simulator, preload blocks provided in RLP format
    const blockRlp = readFileSync(args.loadBlocksFromRlp)
    const blocks: Block[] = []
    let buf = RLP.decode(blockRlp, true)
    while (buf.data?.length > 0 || buf.remainder?.length > 0) {
      try {
        const block = Block.fromValuesArray(buf.data as BlockBytes, {
          common: config.chainCommon,
          setHardfork: true,
        })
        blocks.push(block)
        buf = RLP.decode(buf.remainder, true)
        config.logger.info(
          `Preloading block hash=0x${short(bytesToHex(block.header.hash()))} number=${
            block.header.number
          }`
        )
      } catch (err: any) {
        config.logger.info(
          `Encountered error while while preloading chain data  error=${err.message}`
        )
        break
      }
    }

    if (blocks.length > 0) {
      if (!client.chain.opened) {
        await client.chain.open()
      }

      await client.chain.putBlocks(blocks)
    }
  }

  if (typeof args.startBlock === 'number') {
    await startBlock(client)
  }

  // update client's sync status and start txpool if synchronized
  client.config.updateSynchronizedState(client.chain.headers.latest)
  if (client.config.synchronized === true) {
    const fullService = client.services.find((s) => s.name === 'eth')
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
    const service = client.service('eth') as FullEthereumService
    await service.execution.open()
    await service.execution.run()
  }
  return client
}

/**
 * Returns a configured blockchain and common for devnet with a prefunded address
 */
async function setupDevnet(prefundAddress: Address) {
  const addr = prefundAddress.toString().slice(2)
  const consensusConfig =
    args.dev === 'pow'
      ? { ethash: true }
      : {
          clique: {
            period: 10,
            epoch: 30000,
          },
        }
  const defaultChainData = {
    config: {
      chainId: 123456,
      homesteadBlock: 0,
      eip150Block: 0,
      eip150Hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      eip155Block: 0,
      eip158Block: 0,
      byzantiumBlock: 0,
      constantinopleBlock: 0,
      petersburgBlock: 0,
      istanbulBlock: 0,
      berlinBlock: 0,
      londonBlock: 0,
      ...consensusConfig,
    },
    nonce: '0x0',
    timestamp: '0x614b3731',
    gasLimit: '0x47b760',
    difficulty: '0x1',
    mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    coinbase: '0x0000000000000000000000000000000000000000',
    number: '0x0',
    gasUsed: '0x0',
    parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    baseFeePerGas: 7,
  }
  const extraData =
    args.dev === 'pow' ? '0x' + '0'.repeat(32) : '0x' + '0'.repeat(64) + addr + '0'.repeat(130)
  const chainData = {
    ...defaultChainData,
    extraData,
    alloc: { [addr]: { balance: '0x10000000000000000000' } },
  }
  const common = Common.fromGethGenesis(chainData, { chain: 'devnet', hardfork: Hardfork.London })
  const customGenesisState = parseGethGenesisState(chainData)
  return { common, customGenesisState }
}

/**
 * Accept account input from command line
 */
async function inputAccounts() {
  const accounts: Account[] = []

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Hide key input
  ;(rl as any).input.on('keypress', function () {
    // get the number of characters entered so far:
    const len = (rl as any).line.length
    // move cursor back to the beginning of the input:
    readline.moveCursor((rl as any).output, -len, 0)
    // clear everything to the right of the cursor:
    readline.clearLine((rl as any).output, 1)
    // replace the original input with asterisks:
    for (let i = 0; i < len; i++) {
      ;(rl as any).output.write('*')
    }
  })

  const question = (text: string) => {
    return new Promise<string>((resolve) => {
      rl.question(text, resolve)
    })
  }

  try {
    const addresses = args.unlock!.split(',')
    const isFile = existsSync(path.resolve(addresses[0]))
    if (!isFile) {
      for (const addressString of addresses) {
        const address = Address.fromString(addressString)
        const inputKey = await question(
          `Please enter the 0x-prefixed private key to unlock ${address}:\n`
        )
        ;(rl as any).history = (rl as any).history.slice(1)
        const privKey = toBytes(inputKey)
        const derivedAddress = Address.fromPrivateKey(privKey)
        if (address.equals(derivedAddress)) {
          accounts.push([address, privKey])
        } else {
          console.error(
            `Private key does not match for ${address} (address derived: ${derivedAddress})`
          )
          process.exit()
        }
      }
    } else {
      const acc = readFileSync(path.resolve(args.unlock!), 'utf-8').replace(/(\r\n|\n|\r)/gm, '')
      const privKey = hexToBytes('0x' + acc) // See docs: acc has to be non-zero prefixed in the file
      const derivedAddress = Address.fromPrivateKey(privKey)
      accounts.push([derivedAddress, privKey])
    }
  } catch (e: any) {
    console.error(`Encountered error unlocking account:\n${e.message}`)
    process.exit()
  }
  rl.close()
  return accounts
}

/**
 * Returns a randomly generated account
 */
function generateAccount(): Account {
  const privKey = randomBytes(32)
  const address = Address.fromPrivateKey(privKey)
  console.log('='.repeat(50))
  console.log('Account generated for mining blocks:')
  console.log(`Address: ${address}`)
  console.log(`Private key: ${bytesToHex(privKey)}`)
  console.log('WARNING: Do not use this account for mainnet funds')
  console.log('='.repeat(50))
  return [address, privKey]
}

/**
 * Shuts down an actively running client gracefully
 * @param config Client config object
 * @param clientStartPromise promise that returns a client and server object
 */
const stopClient = async (config: Config, clientStartPromise: any) => {
  config.logger.info('Caught interrupt signal. Obtaining client handle for clean shutdown...')
  config.logger.info('(This might take a little longer if client not yet fully started)')
  let timeoutHandle
  if (clientStartPromise.toString().includes('Promise') === true)
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
      s.http().close()
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
  if (args.helpRpc === true) {
    // Output RPC help and exit
    return helprpc()
  }

  // TODO sharding: Just initialize kzg library now, in future it can be optimized to be
  // loaded and initialized on the sharding hardfork activation
  initKZG(kzg, args.trustedSetup ?? __dirname + '/../src/trustedSetups/official.txt')
  // Give network id precedence over network name
  const chain = args.networkId ?? args.network ?? Chain.Mainnet

  // Configure accounts for mining and prefunding in a local devnet
  const accounts: Account[] = []
  if (typeof args.unlock === 'string') {
    accounts.push(...(await inputAccounts()))
  }

  let customGenesisState: GenesisState | undefined
  let common = new Common({
    chain,
    hardfork: Hardfork.Chainstart,
    eips: args.fourFours === true ? [4444] : undefined,
  })

  if (args.dev === true || typeof args.dev === 'string') {
    args.discDns = false
    if (accounts.length === 0) {
      // If generating new keys delete old chain data to prevent genesis block mismatch
      removeSync(`${args.dataDir}/devnet`)
      // Create new account
      accounts.push(generateAccount())
    }
    const prefundAddress = accounts[0][0]
    ;({ common, customGenesisState } = await setupDevnet(prefundAddress))
  }

  // Configure common based on args given

  // Use custom chain parameters file if specified
  if (typeof args.customChain === 'string') {
    try {
      const customChainParams = JSON.parse(readFileSync(args.customChain, 'utf-8'))
      customGenesisState = JSON.parse(readFileSync(args.customGenesisState!, 'utf-8'))
      common = new Common({
        chain: customChainParams.name,
        customChains: [customChainParams],
        eips: args.fourFours === true ? [4444] : undefined,
      })
    } catch (err: any) {
      console.error(`invalid chain parameters: ${err.message}`)
      process.exit()
    }
  } else if (typeof args.gethGenesis === 'string') {
    // Use geth genesis parameters file if specified
    const genesisFile = JSON.parse(readFileSync(args.gethGenesis, 'utf-8'))
    const chainName = path.parse(args.gethGenesis).base.split('.')[0]
    common = Common.fromGethGenesis(genesisFile, {
      chain: chainName,
      mergeForkIdPostMerge: args.mergeForkIdPostMerge,
      eips: args.fourFours === true ? [4444] : undefined,
    })
    customGenesisState = parseGethGenesisState(genesisFile)
  }

  if (args.mine === true && accounts.length === 0) {
    console.error(
      'Please provide an account to mine blocks with `--unlock [address]` or use `--dev` to generate'
    )
    process.exit()
  }

  const datadir = args.dataDir ?? Config.DATADIR_DEFAULT
  const networkDir = `${datadir}/${common.chainName()}`
  const configDirectory = `${networkDir}/config`
  ensureDirSync(configDirectory)
  const key = await Config.getClientKey(datadir, common)

  // logFile is either filename or boolean true or false to enable (with default) or disable
  if (typeof args.logFile === 'boolean') {
    args.logFile = args.logFile ? `${networkDir}/ethereumjs.log` : undefined
  }

  logger = getLogger(args)
  let bootnodes
  if (args.bootnodes !== undefined) {
    // File path passed, read bootnodes from disk
    if (
      Array.isArray(args.bootnodes) &&
      args.bootnodes.length === 1 &&
      args.bootnodes[0].includes('.txt')
    ) {
      const file = readFileSync(args.bootnodes[0], 'utf-8')
      let nodeURLs = file.split(/\r?\n/).filter((url) => (url !== '' ? true : false))
      nodeURLs = nodeURLs.map((url) => {
        const discportIndex = url.indexOf('?discport')
        if (discportIndex > 0) {
          return url.substring(0, discportIndex)
        } else {
          return url
        }
      })
      bootnodes = parseMultiaddrs(nodeURLs)
      logger.info(`Reading bootnodes file=${args.bootnodes[0]} num=${nodeURLs.length}`)
    } else {
      bootnodes = parseMultiaddrs(args.bootnodes)
    }
  }

  const multiaddrs = args.multiaddrs !== undefined ? parseMultiaddrs(args.multiaddrs) : undefined
  const mine = args.mine !== undefined ? args.mine : args.dev !== undefined
  const isSingleNode = args.isSingleNode !== undefined ? args.isSingleNode : args.dev !== undefined
  const config = new Config({
    accounts,
    bootnodes,
    common,
    datadir,
    debugCode: args.debugCode,
    discDns: args.discDns,
    discV4: args.discV4,
    dnsAddr: args.dnsAddr,
    execution: args.execution,
    numBlocksPerIteration: args.numBlocksPerIteration,
    accountCache: args.accountCache,
    storageCache: args.storageCache,
    codeCache: args.codeCache,
    trieCache: args.trieCache,
    dnsNetworks: args.dnsNetworks,
    extIP: args.extIP,
    key,
    lightserv: args.lightServe,
    logger,
    maxPeers: args.maxPeers,
    maxPerRequest: args.maxPerRequest,
    maxFetcherJobs: args.maxFetcherJobs,
    mine,
    minerCoinbase: args.minerCoinbase,
    isSingleNode,
    vmProfileBlocks: args.vmProfileBlocks,
    vmProfileTxs: args.vmProfileTxs,
    minPeers: args.minPeers,
    multiaddrs,
    port: args.port,
    saveReceipts: args.saveReceipts,
    syncmode: args.sync,
    prefixStorageTrieKeys: args.prefixStorageTrieKeys,
    enableSnapSync: args.snap,
    useStringValueTrieDB: args.useStringValueTrieDB,
    txLookupLimit: args.txLookupLimit,
    pruneEngineCache: args.pruneEngineCache,
    statelessVerkle: args.statelessVerkle,
    engineNewpayloadMaxExecute: args.skipEngineExec === true ? 0 : args.engineNewpayloadMaxExecute,
  })
  config.events.setMaxListeners(50)
  config.events.on(Event.SERVER_LISTENING, (details) => {
    const networkDir = config.getNetworkDirectory()
    // Write the transport into a file
    try {
      writeFileSync(`${networkDir}/${details.transport}`, details.url)
    } catch (e) {
      // In case dir is not really setup, mostly to take care of mockserver in test
      config.logger.error(`Error writing listener details to disk: ${(e as Error).message}`)
    }
  })
  if (customGenesisState !== undefined) {
    const numAccounts = Object.keys(customGenesisState).length
    config.logger.info(`Reading custom genesis state accounts=${numAccounts}`)
  }
  const customGenesisStateRoot = args.verkleGenesisStateRoot

  // Do not wait for client to be fully started so that we can hookup SIGINT handling
  // else a SIGINT before may kill the process in unclean manner
  const clientStartPromise = startClient(config, {
    genesisState: customGenesisState,
    genesisStateRoot: customGenesisStateRoot,
  })
    .then((client) => {
      const servers =
        args.rpc === true || args.rpcEngine === true || args.ws === true
          ? startRPCServers(client, args as RPCArgs)
          : []
      if (
        client.config.chainCommon.gteHardfork(Hardfork.Paris) === true &&
        (args.rpcEngine === false || args.rpcEngine === undefined)
      ) {
        config.logger.warn(`Engine RPC endpoint not activated on a post-Merge HF setup.`)
      }
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
  console.log(err)
  logger?.error(err.message.toString()) ?? console.error(err)
})
