#!/usr/bin/env node

import { homedir } from 'os'
import path from 'path'
import readline from 'readline'
import { randomBytes } from 'crypto'
import { ensureDirSync, readFileSync, removeSync } from 'fs-extra'
import { Server as RPCServer } from 'jayson/promise'
import Common, { Chain, Hardfork } from '@ethereumjs/common'
import { _getInitializedChains } from '@ethereumjs/common/dist/chains'
import { Address, toBuffer } from 'ethereumjs-util'
import { version as packageVersion } from '../package.json'
import { parseMultiaddrs, parseGenesisState, parseCustomParams, inspectParams } from '../lib/util'
import EthereumClient from '../lib/client'
import { Config } from '../lib/config'
import { Logger, getLogger } from '../lib/logging'
import { RPCManager } from '../lib/rpc'
import * as modules from '../lib/rpc/modules'
import { Event } from '../lib/types'
import type { Chain as IChain, GenesisState } from '@ethereumjs/common/dist/types'
const level = require('level')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const networks = Object.entries(_getInitializedChains().names)

const args = yargs(hideBin(process.argv))
  .option('network', {
    describe: 'Network',
    choices: networks.map((n) => n[1]),
    default: 'mainnet',
  })
  .option('network-id', {
    describe: 'Network ID',
    choices: networks.map((n) => parseInt(n[0])),
    default: undefined,
  })
  .option('network-id', {
    describe: `Network ID`,
    choices: networks.map((n) => parseInt(n[0])),
    default: undefined,
  })
  .option('syncmode', {
    describe: 'Blockchain sync mode (light sync experimental)',
    choices: ['light', 'full'],
    default: Config.SYNCMODE_DEFAULT,
  })
  .option('lightserv', {
    describe: 'Serve light peer requests',
    boolean: true,
    default: Config.LIGHTSERV_DEFAULT,
  })
  .option('datadir', {
    describe: 'Data directory for the blockchain',
    default: `${homedir()}/Library/Ethereum/ethereumjs`,
  })
  .option('customChain', {
    describe: 'Path to custom chain parameters json file (@ethereumjs/common format)',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
  })
  .option('customGenesisState', {
    describe: 'Path to custom genesis state json file (@ethereumjs/common format)',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
  })
  .option('gethGenesis', {
    describe: 'Import a geth genesis file for running a custom network',
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
  })
  .option('transports', {
    describe: 'Network transports',
    default: Config.TRANSPORTS_DEFAULT,
    array: true,
  })
  .option('bootnodes', {
    describe: 'Network bootnodes',
    array: true,
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
  })
  .option('rpc', {
    describe: 'Enable the JSON-RPC server',
    boolean: true,
  })
  .option('rpcport', {
    describe: 'HTTP-RPC server listening port',
    number: true,
    default: 8545,
  })
  .option('rpcaddr', {
    describe: 'HTTP-RPC server listening interface address',
    default: 'localhost',
  })
  .option('rpcEngine', {
    describe: 'Enable the JSON-RPC server for Engine namespace',
    boolean: true,
  })
  .option('rpcEnginePort', {
    describe: 'HTTP-RPC server listening port for Engine namespace',
    number: true,
    default: 8550,
  })
  .option('rpcEngineAddr', {
    describe: 'HTTP-RPC server listening interface address for Engine namespace',
    string: true,
    default: 'localhost',
  })
  .option('rpcStubGetLogs', {
    describe: 'Stub eth_getLogs with empty response until method is implemented',
    boolean: true,
    default: false,
  })
  .option('helprpc', {
    describe: 'Display the JSON RPC help with a list of all RPC methods implemented (and exit)',
    boolean: true,
  })
  .option('loglevel', {
    describe: 'Logging verbosity',
    choices: ['error', 'warn', 'info', 'debug'],
    default: 'info',
  })
  .option('logFile', {
    describe: 'File to save log file (pass true for `ethereumjs.log`)',
  })
  .option('logLevelFile', {
    describe: 'Log level for logFile',
    choices: ['error', 'warn', 'info', 'debug'],
    default: 'info',
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
    describe: 'Additionally log complete RPC calls on log level debug (i.e. --loglevel=debug)',
    boolean: true,
  })
  .option('maxPerRequest', {
    describe: 'Max items per block or header request',
    number: true,
    default: Config.MAXPERREQUEST_DEFAULT,
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
  })
  .option('executeBlocks', {
    describe:
      'Debug mode for reexecuting existing blocks (no services will be started), allowed input formats: 5,5-10',
    string: true,
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
    default: false,
  })
  .option('unlock', {
    describe:
      'Comma separated list of accounts to unlock - currently only the first account is used (for sealing PoA blocks and as the default coinbase). Beta, you will be promped for a 0x-prefixed private key until keystore functionality is added - FOR YOUR SAFETY PLEASE DO NOT USE ANY ACCOUNTS HOLDING SUBSTANTIAL AMOUNTS OF ETH',
    array: true,
  })
  .option('dev', {
    describe: 'Start an ephemeral PoA blockchain with a single miner and prefunded accounts',
    choices: [undefined, false, true, 'poa', 'pow'],
  })
  .option('minerCoinbase', {
    describe:
      'Address for mining rewards (etherbase). If not provided, defaults to the primary account',
    string: true,
  }).argv

let logger: Logger

/**
 * Initializes and starts a Node and reacts on the
 * main client lifecycle events
 *
 * @param config
 */
async function runNode(config: Config) {
  config.logger.info(
    `Initializing Ethereumjs client version=v${packageVersion} network=${config.chainCommon.chainName()}`
  )
  const chainDataDir = config.getChainDataDirectory()
  ensureDirSync(chainDataDir)
  const stateDataDir = config.getStateDataDirectory()
  ensureDirSync(stateDataDir)
  config.logger.info(`Data directory: ${config.datadir}`)
  if (config.lightserv) {
    config.logger.info(`Serving light peer requests`)
  }
  const client = new EthereumClient({
    config,
    chainDB: level(chainDataDir),
    stateDB: level(stateDataDir),
  })
  client.config.events.on(Event.SERVER_ERROR, (err) => config.logger.error(err))
  client.config.events.on(Event.SERVER_LISTENING, (details) => {
    config.logger.info(`Listener up transport=${details.transport} url=${details.url}`)
  })
  config.events.on(Event.SYNC_SYNCHRONIZED, (height) => {
    client.config.logger.info(`Synchronized blockchain at height ${height}`)
  })
  await client.open()

  if (args.executeBlocks) {
    // Special block execution debug mode (not changing any state)
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
        'Wrong input format for block execution, allowed format types: 5, 5-10, 5[0xba4b5fd92a26badad3cad22eb6f7c7e745053739b5f5d1e8a3afb00f8fb2a280,[TX_HASH_2],...]'
      )
      process.exit()
    }
    await client.executeBlocks(first, last, txHashes)
  } else {
    // Regular client start
    await client.start()
  }
  return client
}

/*
 * Returns enabled RPCServers
 */
function runRpcServers(client: EthereumClient, config: Config, args: any) {
  const onRequest = (request: any) => {
    let msg = ''
    if (args.rpcDebug) {
      msg += `${request.method} called with params:\n${inspectParams(request.params)}`
    } else {
      msg += `${request.method} called with params: ${inspectParams(request.params, 125)}`
    }
    config.logger.debug(msg)
  }

  const handleResponse = (request: any, response: any, batchAddOn = '') => {
    let msg = ''
    if (args.rpcDebug) {
      msg = `${request.method}${batchAddOn} responded with:\n${inspectParams(response)}`
    } else {
      msg = `${request.method}${batchAddOn} responded with: `
      if (response.result) {
        msg += inspectParams(response, 125)
      }
      if (response.error) {
        msg += `error: ${response.error.message}`
      }
    }
    config.logger.debug(msg)
  }

  const onBatchResponse = (request: any, response: any) => {
    // Batch request
    if (request.length !== undefined) {
      if (response.length === undefined || response.length !== request.length) {
        config.logger.debug('Invalid batch request received.')
        return
      }
      for (let i = 0; i < request.length; i++) {
        handleResponse(request[i], response[i], ' (batch request)')
      }
    } else {
      handleResponse(request, response)
    }
  }

  const servers: RPCServer[] = []
  const { rpc, rpcaddr, rpcport, rpcEngine, rpcEngineAddr, rpcEnginePort } = args
  const manager = new RPCManager(client, config)

  if (rpc) {
    const methods =
      rpcEngine && rpcEnginePort === rpcport && rpcEngineAddr === rpcaddr
        ? { ...manager.getMethods(), ...manager.getMethods(true) }
        : { ...manager.getMethods() }
    const server = new RPCServer(methods)
    const namespaces = [...new Set(Object.keys(methods).map((m) => m.split('_')[0]))].join(',')
    config.logger.info(
      `Started JSON RPC server address=http://${rpcaddr}:${rpcport} namespaces=${namespaces}`
    )
    server.http().listen(rpcport)
    server.on('request', onRequest)
    server.on('response', onBatchResponse)
    servers.push(server)
  }

  if (rpcEngine) {
    if (rpc && rpcport === rpcEnginePort && rpcaddr === rpcEngineAddr) {
      return servers
    }
    const server = new RPCServer(manager.getMethods(true))
    config.logger.info(
      `Started JSON RPC server address=http://${rpcEngineAddr}:${rpcEnginePort} namespaces=engine`
    )
    server.http().listen(rpcEnginePort)
    server.on('request', onRequest)
    server.on('response', onBatchResponse)
    servers.push(server)
  }

  return servers
}

/**
 * Main entry point to start a client
 */
async function run() {
  if (args.helprpc) {
    // Display RPC help and exit
    console.log('-'.repeat(27))
    console.log('JSON-RPC: Supported Methods')
    console.log('-'.repeat(27))
    console.log()
    for (const modName of modules.list) {
      console.log(`${modName}:`)
      const methods = RPCManager.getMethodNames((modules as any)[modName])
      for (const methodName of methods) {
        if (methodName === 'getLogs' && !args.rpcStubGetLogs) {
          continue
        }
        console.log(`-> ${modName.toLowerCase()}_${methodName}`)
      }
      console.log()
    }
    console.log()
    process.exit()
  }

  // give network id precedence over network name
  const chain = args.networkId ?? args.network ?? Chain.Mainnet

  // configure accounts for mining and prefunding in a local devnet
  const accounts: [address: Address, privateKey: Buffer][] = []
  if (args.unlock) {
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
        // eslint-disable-next-line no-extra-semi
        ;(rl as any).output.write('*')
      }
    })

    const question = (text: string) => {
      return new Promise<string>((resolve) => {
        rl.question(text, resolve)
      })
    }

    try {
      for (const addressString of args.unlock) {
        const address = Address.fromString(addressString)
        const inputKey = await question(
          `Please enter the 0x-prefixed private key to unlock ${address}:\n`
        )
        ;(rl as any).history = (rl as any).history.slice(1)
        const privKey = toBuffer(inputKey)
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
    } catch (e: any) {
      console.error(`Encountered error unlocking account:\n${e.message}`)
      process.exit()
    }
    rl.close()
  }

  let common = new Common({ chain, hardfork: Hardfork.Chainstart })

  if (args.dev) {
    args.discDns = false
    if (accounts.length === 0) {
      // If generating new keys delete old chain data to prevent genesis block mismatch
      removeSync(`${args.datadir}/devnet`)
      // Create new account
      const privKey = randomBytes(32)
      const address = Address.fromPrivateKey(privKey)
      accounts.push([address, privKey])
      console.log('='.repeat(50))
      console.log('Account generated for mining blocks:')
      console.log(`Address: ${address}`)
      console.log(`Private key: 0x${privKey.toString('hex')}`)
      console.log('WARNING: Do not use this account for mainnet funds')
      console.log('='.repeat(50))
    }

    const prefundAddress = accounts[0][0].toString().slice(2)
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
    const extraData = '0x' + '0'.repeat(64) + prefundAddress + '0'.repeat(130)
    const chainData = {
      ...defaultChainData,
      extraData,
      alloc: { [prefundAddress]: { balance: '0x10000000000000000000' } },
    }
    const chainParams = await parseCustomParams(chainData, 'devnet')
    const genesisState = await parseGenesisState(chainData)
    const customChainParams: [IChain, GenesisState][] = [[chainParams, genesisState]]
    common = new Common({
      chain: 'devnet',
      customChains: customChainParams,
      hardfork: Hardfork.London,
    })
  }

  // configure common based on args given
  if (
    (args.customChainParams || args.customGenesisState || args.gethGenesis) &&
    (!(args.network === 'mainnet') || args.networkId)
  ) {
    console.error('cannot specify both custom chain parameters and preset network ID')
    process.exit()
  }
  // Use custom chain parameters file if specified
  if (args.customChain) {
    if (!args.customGenesisState) {
      console.error('cannot have custom chain parameters without genesis state')
      process.exit()
    }
    try {
      const customChainParams = JSON.parse(readFileSync(args.customChain, 'utf-8'))
      const genesisState = JSON.parse(readFileSync(args.customGenesisState, 'utf-8'))
      common = new Common({
        chain: customChainParams.name,
        customChains: [[customChainParams, genesisState]],
      })
    } catch (err: any) {
      console.error(`invalid chain parameters: ${err.message}`)
      process.exit()
    }
  } else if (args.gethGenesis) {
    // Use geth genesis parameters file if specified
    const genesisFile = JSON.parse(readFileSync(args.gethGenesis, 'utf-8'))
    const chainName = path.parse(args.gethGenesis).base.split('.')[0]
    const genesisParams = await parseCustomParams(genesisFile, chainName)
    const genesisState = genesisFile.alloc ? await parseGenesisState(genesisFile) : {}
    common = new Common({
      chain: genesisParams.name,
      customChains: [[genesisParams, genesisState]],
    })
  }

  if (args.mine && accounts.length === 0) {
    console.error(
      'Please provide an account to mine blocks with `--unlock [address]` or use `--dev` to generate'
    )
    process.exit()
  }

  const datadir = args.datadir ?? Config.DATADIR_DEFAULT
  const configDirectory = `${datadir}/${common.chainName()}/config`
  ensureDirSync(configDirectory)
  const key = await Config.getClientKey(datadir, common)
  logger = getLogger(args)
  const config = new Config({
    common,
    syncmode: args.syncmode,
    lightserv: args.lightserv,
    datadir,
    key,
    transports: args.transports,
    bootnodes: args.bootnodes ? parseMultiaddrs(args.bootnodes) : undefined,
    port: args.port,
    extIP: args.extIP,
    multiaddrs: args.multiaddrs ? parseMultiaddrs(args.multiaddrs) : undefined,
    logger,
    rpcStubGetLogs: args.rpcStubGetLogs,
    maxPerRequest: args.maxPerRequest,
    minPeers: args.minPeers,
    maxPeers: args.maxPeers,
    dnsAddr: args.dnsAddr,
    dnsNetworks: args.dnsNetworks,
    debugCode: args.debugCode,
    discDns: args.discDns,
    discV4: args.discV4,
    mine: args.mine || args.dev,
    accounts,
    minerCoinbase: args.minerCoinbase,
  })
  config.events.setMaxListeners(50)

  const client = await runNode(config)
  const servers = args.rpc || args.rpcEngine ? runRpcServers(client, config, args) : []

  process.on('SIGINT', async () => {
    config.logger.info('Caught interrupt signal. Shutting down...')
    servers.forEach((s) => s.http().close())
    await client.stop()
    config.logger.info('Exiting.')
    process.exit()
  })
}

run().catch((err) => logger?.error(err) ?? console.error(err))
