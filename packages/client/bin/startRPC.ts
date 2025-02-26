import {
  EthereumJSErrorWithoutCode,
  bytesToUnprefixedHex,
  hexToBytes,
  randomBytes,
} from '@ethereumjs/util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

import { RPCManager, saveReceiptsMethods } from '../src/rpc/index.js'
import * as modules from '../src/rpc/modules/index.js'
import {
  MethodConfig,
  createRPCServer,
  createRPCServerListener,
  createWsRPCServerListener,
} from '../src/util/index.js'

import type { EthereumClient } from '../src/client.js'
import type { Config } from '../src/config.js'
import type jayson from 'jayson/promise/index.js'

export type RPCArgs = {
  rpc: boolean
  rpcAddr: string
  rpcPort: number
  ws: boolean
  wsPort: number
  wsAddr: string
  rpcEngine: boolean
  rpcEngineAddr: string
  rpcEnginePort: number
  wsEngineAddr: string
  wsEnginePort: number
  rpcDebug: string
  rpcDebugVerbose: string
  helpRPC: boolean
  jwtSecret?: string
  rpcEngineAuth: boolean
  rpcCors: string
}

/**
 * Returns a jwt secret from a provided file path, otherwise saves a randomly generated one to datadir if none already exists
 */
function parseJwtSecret(config: Config, jwtFilePath?: string): Uint8Array {
  let jwtSecret: Uint8Array
  const defaultJwtPath = `${config.datadir}/jwtsecret`
  const usedJwtPath = jwtFilePath !== undefined ? jwtFilePath : defaultJwtPath

  // If jwtFilePath is provided, it should exist
  if (jwtFilePath !== undefined && !existsSync(jwtFilePath)) {
    throw EthereumJSErrorWithoutCode(`No file exists at provided jwt secret path=${jwtFilePath}`)
  }

  if (jwtFilePath !== undefined || existsSync(defaultJwtPath)) {
    const jwtSecretContents = readFileSync(jwtFilePath ?? defaultJwtPath, 'utf-8').trim()
    const hexPattern = new RegExp(/^(0x|0X)?(?<jwtSecret>[a-fA-F0-9]+)$/, 'g')
    const jwtSecretHex = hexPattern.exec(jwtSecretContents)?.groups?.jwtSecret
    if (jwtSecretHex === undefined || jwtSecretHex.length !== 64) {
      throw Error('Need a valid 256 bit hex encoded secret')
    }
    jwtSecret = hexToBytes(`0x${jwtSecretHex}`)
  } else {
    const folderExists = existsSync(config.datadir)
    if (!folderExists) {
      mkdirSync(config.datadir, { recursive: true })
    }

    jwtSecret = randomBytes(32)
    writeFileSync(defaultJwtPath, bytesToUnprefixedHex(jwtSecret), {})
    config.logger.info(`New Engine API JWT token created path=${defaultJwtPath}`)
  }
  config.logger.info(`Using Engine API with JWT token authentication path=${usedJwtPath}`)
  return jwtSecret
}

/**
 * Starts and returns enabled RPCServers
 */
export function startRPCServers(client: EthereumClient, args: RPCArgs) {
  const { config } = client
  const servers: jayson.Server[] = []
  const {
    rpc,
    rpcAddr,
    rpcPort,
    ws,
    wsPort,
    wsAddr,
    rpcEngine,
    rpcEngineAddr,
    rpcEnginePort,
    wsEngineAddr,
    wsEnginePort,
    jwtSecret: jwtSecretPath,
    rpcEngineAuth,
    rpcCors,
    rpcDebug,
    rpcDebugVerbose,
  } = args
  const manager = new RPCManager(client, config)
  const { logger } = config
  const jwtSecret =
    rpcEngine && rpcEngineAuth ? parseJwtSecret(config, jwtSecretPath) : new Uint8Array(0)
  let withEngineMethods = false

  if ((rpc || rpcEngine) && !config.saveReceipts) {
    logger?.warn(
      `Starting client without --saveReceipts might lead to interop issues with a CL especially if the CL intends to propose blocks, omitting methods=${saveReceiptsMethods}`,
    )
  }

  if (rpc || ws) {
    let rpcHttpServer
    withEngineMethods = rpcEngine && rpcEnginePort === rpcPort && rpcEngineAddr === rpcAddr

    const { server, namespaces, methods } = createRPCServer(manager, {
      methodConfig: withEngineMethods ? MethodConfig.WithEngine : MethodConfig.WithoutEngine,
      rpcDebugVerbose,
      rpcDebug,
      logger,
    })
    servers.push(server)

    if (rpc) {
      rpcHttpServer = createRPCServerListener({
        RPCCors: rpcCors,
        server,
        withEngineMiddleware:
          withEngineMethods && rpcEngineAuth
            ? {
                jwtSecret,
                unlessFn: (req: any) =>
                  Array.isArray(req.body)
                    ? req.body.some((r: any) => r.method.includes('engine_')) === false
                    : req.body.method.includes('engine_') === false,
              }
            : undefined,
      })
      rpcHttpServer.listen(rpcPort, rpcAddr)
      logger.info(
        `Started JSON RPC Server address=http://${rpcAddr}:${rpcPort} namespaces=${namespaces}${
          withEngineMethods ? ' rpcEngineAuth=' + rpcEngineAuth.toString() : ''
        }`,
      )
      logger.debug(
        `Methods available at address=http://${rpcAddr}:${rpcPort} namespaces=${namespaces} methods=${Object.keys(
          methods,
        ).join(',')}`,
      )
    }
    if (ws) {
      const opts: any = {
        rpcCors,
        server,
        withEngineMiddleware: withEngineMethods && rpcEngineAuth ? { jwtSecret } : undefined,
      }
      if (rpcAddr === wsAddr && rpcPort === wsPort) {
        // We want to load the websocket upgrade request to the same server
        opts.httpServer = rpcHttpServer
      }

      const rpcWsServer = createWsRPCServerListener(opts)
      if (rpcWsServer) rpcWsServer.listen(wsPort)
      logger.info(
        `Started JSON RPC Server address=ws://${wsAddr}:${wsPort} namespaces=${namespaces}${
          withEngineMethods ? ` rpcEngineAuth=${rpcEngineAuth}` : ''
        }`,
      )
      logger.debug(
        `Methods available at address=ws://${wsAddr}:${wsPort} namespaces=${namespaces} methods=${Object.keys(
          methods,
        ).join(',')}`,
      )
    }
  }

  if (rpcEngine && !(rpc && rpcPort === rpcEnginePort && rpcAddr === rpcEngineAddr)) {
    const { server, namespaces, methods } = createRPCServer(manager, {
      methodConfig: MethodConfig.EngineOnly,
      rpcDebug,
      rpcDebugVerbose,
      logger,
    })
    servers.push(server)
    const rpcHttpServer = createRPCServerListener({
      RPCCors: rpcCors,
      server,
      withEngineMiddleware: rpcEngineAuth
        ? {
            jwtSecret,
          }
        : undefined,
    })
    rpcHttpServer.listen(rpcEnginePort, rpcEngineAddr)
    logger.info(
      `Started JSON RPC server address=http://${rpcEngineAddr}:${rpcEnginePort} namespaces=${namespaces} rpcEngineAuth=${rpcEngineAuth}`,
    )
    logger.debug(
      `Methods available at address=http://${rpcEngineAddr}:${rpcEnginePort} namespaces=${namespaces} methods=${Object.keys(
        methods,
      ).join(',')}`,
    )

    if (ws) {
      const opts: any = {
        rpcCors,
        server,
        withEngineMiddleware: rpcEngineAuth ? { jwtSecret } : undefined,
      }

      if (rpcEngineAddr === wsEngineAddr && rpcEnginePort === wsEnginePort) {
        // We want to load the websocket upgrade request to the same server
        opts.httpServer = rpcHttpServer
      }

      const rpcWsServer = createWsRPCServerListener(opts)
      if (rpcWsServer) rpcWsServer.listen(wsEnginePort, wsEngineAddr)
      logger.info(
        `Started JSON RPC Server address=ws://${wsEngineAddr}:${wsEnginePort} namespaces=${namespaces} rpcEngineAuth=${rpcEngineAuth}`,
      )
      logger.debug(
        `Methods available at address=ws://${wsEngineAddr}:${wsEnginePort} namespaces=${namespaces} methods=${Object.keys(
          methods,
        ).join(',')}`,
      )
    }
  }

  return servers
}

/**
 * Output RPC help and exit
 */
export function helpRPC() {
  /* eslint-disable no-console */
  console.log('-'.repeat(27))
  console.log('JSON-RPC: Supported Methods')
  console.log('-'.repeat(27))
  console.log()
  for (const modName of modules.list) {
    console.log(`${modName}:`)
    const methods = RPCManager.getMethodNames((modules as any)[modName])
    for (const methodName of methods) {
      console.log(`-> ${modName.toLowerCase()}_${methodName}`)
    }
    console.log()
  }
  console.log()
  /* eslint-enable no-console */
  process.exit()
}
