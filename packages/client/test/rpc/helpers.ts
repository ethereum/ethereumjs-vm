import tape from 'tape'
import { Server as RPCServer, HttpServer } from 'jayson/promise'
import VM from '@ethereumjs/vm'
import Common, { Chain as ChainEnum } from '@ethereumjs/common'
import { BN } from 'ethereumjs-util'
import { RPCManager as Manager } from '../../lib/rpc'
import { getLogger } from '../../lib/logging'
import { Config } from '../../lib/config'
import { Chain } from '../../lib/blockchain/chain'
import { TxPool } from '../../lib/sync/txpool'
import { RlpxServer } from '../../lib/net/server/rlpxserver'
import { mockBlockchain } from './mockBlockchain'
import type Blockchain from '@ethereumjs/blockchain'
import type EthereumClient from '../../lib/client'
const request = require('supertest')

const config: any = {}
config.logger = getLogger(config)

export function startRPC(methods: any, port: number = 3000) {
  const server = new RPCServer(methods)
  const httpServer = server.http()
  httpServer.listen(port)
  return httpServer
}

export function closeRPC(server: HttpServer) {
  server.close()
}

export function createManager(client: EthereumClient) {
  return new Manager(client, config)
}

export function createClient(clientOpts: any = {}) {
  const common: Common = clientOpts.commonChain ?? new Common({ chain: ChainEnum.Mainnet })
  const config = new Config({ transports: [], common })
  const blockchain = clientOpts.blockchain ?? ((<any>mockBlockchain()) as Blockchain)

  const chain = new Chain({ config, blockchain })
  chain.opened = true

  const defaultClientConfig = {
    blockchain: chain,
    opened: true,
    ethProtocolVersions: [63],
  }
  const clientConfig = { ...defaultClientConfig, ...clientOpts }

  clientConfig.blockchain.getTd = async (_hash: Buffer, _num: BN) => new BN(1000)

  config.synchronized = true
  config.lastSyncDate = Date.now()

  const servers = [
    new RlpxServer({
      config,
      bootnodes: '10.0.0.1:1234,10.0.0.2:1234',
    }),
  ]

  let synchronizer: any = {
    startingBlock: 0,
    best: () => {
      return undefined
    },
    latest: () => {
      return undefined
    },
    syncTargetHeight: clientOpts.syncTargetHeight,
    txPool: new TxPool({ config }),
  }
  if (clientOpts.includeVM) {
    synchronizer = { ...synchronizer, execution: { vm: new VM({ blockchain, common }) } }
  }

  let peers = [1, 2, 3]
  if (clientOpts.noPeers === true) {
    peers = []
  }

  const client: any = {
    synchronized: false,
    config,
    services: [
      {
        name: 'eth',
        chain: clientConfig.blockchain,
        pool: { peers },
        protocols: [
          {
            name: 'eth',
            versions: clientConfig.ethProtocolVersions,
          },
        ],
        synchronizer,
      },
    ],
    servers,
    opened: clientConfig.opened,
    server: (name: string) => {
      return servers.find((s) => s.name === name)
    },
  }

  return client as EthereumClient
}

export function baseSetup(clientOpts: any = {}) {
  const client = createClient(clientOpts)
  const manager = createManager(client)
  const server = startRPC(manager.getMethods(clientOpts.engine === true))
  return { server, manager, client }
}

export function params(method: string, params: Array<any> = []) {
  const req = {
    jsonrpc: '2.0',
    method,
    params,
    id: 1,
  }
  return req
}

export async function baseRequest(
  t: tape.Test,
  server: HttpServer,
  req: Object,
  expect: number,
  expectRes: Function
) {
  try {
    await request(server)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(req)
      .expect(expect)
      .expect(expectRes)
    closeRPC(server)
    t.end()
  } catch (err) {
    closeRPC(server)
    t.end(err)
  }
}
