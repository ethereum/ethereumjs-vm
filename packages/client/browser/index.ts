import Common, { Chain } from '@ethereumjs/common'
const level = require('level')

// Blockchain
export * from '../lib/blockchain/chain'

// Peer
export * from '../lib/net/peer/peer'
export * from '../lib/net/peer/libp2ppeer'
export * from './libp2pnode'

// Peer Pool
export * from '../lib/net/peerpool'

// Protocol
export * from '../lib/net/protocol/protocol'
export * from '../lib/net/protocol/ethprotocol'
export * from '../lib/net/protocol/lesprotocol'
export * from '../lib/net/protocol/flowcontrol'

// Server
export * from '../lib/net/server/server'
export * from '../lib/net/server/libp2pserver'

// EthereumClient
export * from '../lib/client'
import EthereumClient from '../lib/client'

// Service
export * from '../lib/service/service'
export * from '../lib/service/fullethereumservice'
export * from '../lib/service/lightethereumservice'

// Synchronizer
export * from '../lib/sync/sync'
export * from '../lib/sync/fullsync'
export * from '../lib/sync/lightsync'

// Utilities
export * from '../lib/util'
import { parseMultiaddrs } from '../lib/util'
import { Config } from '../lib/config'
import { Event } from '../lib/types'

// Logging
export * from './logging'
import { getLogger } from './logging'

export async function createClient(args: any) {
  const logger = getLogger({ loglevel: args.loglevel })
  const datadir = args.datadir ?? Config.DATADIR_DEFAULT
  const common = new Common({ chain: args.network ?? Chain.Mainnet })
  const key = await Config.getClientKey(datadir, common)
  const bootnodes = args.bootnodes ? parseMultiaddrs(args.bootnodes) : undefined
  const config = new Config({
    common,
    key,
    transports: ['libp2p'],
    syncmode: args.syncmode,
    bootnodes,
    multiaddrs: [],
    logger,
    maxPerRequest: args.maxPerRequest,
    minPeers: args.minPeers,
    maxPeers: args.maxPeers,
    discDns: false,
  })
  config.events.setMaxListeners(50)
  const chainDB = level(common.chainName())
  return new EthereumClient({ config, chainDB })
}

export async function run(args: any) {
  const client = await createClient(args)
  const { logger, chainCommon } = client.config
  logger.info(`Initializing Ethereumjs client network=${chainCommon.chainName()}`)
  client.config.events.on(Event.SERVER_ERROR, (err) => logger.error(err))
  client.config.events.on(Event.SERVER_LISTENING, (details) => {
    logger.info(`Listener up transport=${details.transport} url=${details.url}`)
  })
  client.config.events.on(Event.SYNC_SYNCHRONIZED, (height) => {
    logger.info(`Synchronized blockchain at height ${height}`)
  })
  await client.open()
  await client.start()
  return client
}
