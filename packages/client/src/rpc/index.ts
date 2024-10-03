import { INTERNAL_ERROR } from './error-code.js'
import * as modules from './modules/index.js'

import type { EthereumClient } from '../client.js'
import type { Config } from '../config.js'

export const saveReceiptsMethods = ['getLogs', 'getTransactionReceipt', 'getTransactionByHash']

/**
 * @module rpc
 */

/**
 * RPC server manager
 * @memberof module:rpc
 */
export class RPCManager {
  private _config: Config
  private _client: EthereumClient
  private _modules: Record<string, any> = {}

  constructor(client: EthereumClient, config: Config) {
    this._config = config
    this._client = client
  }

  /**
   * Returns bound methods for modules concat with underscore `_`
   * @param engine Pass true to return only `engine_` API endpoints (default: false)
   * @param rpcDebug Pass true to include stack traces on errors (default: false)
   */
  getMethods(engine = false, rpcDebug = false) {
    const methods: { [key: string]: Function } = {}
    const mods = modules.list.filter((name: string) =>
      engine ? name === 'Engine' : name !== 'Engine',
    )
    for (const modName of mods) {
      const mod = new (modules as any)[modName](this._client, rpcDebug)
      this._modules[modName] = mod
      const rpcMethods = RPCManager.getMethodNames((modules as any)[modName])
      for (const methodName of rpcMethods) {
        if (!this._config.saveReceipts && saveReceiptsMethods.includes(methodName)) {
          continue
        }
        const concatenatedMethodName = `${modName.toLowerCase()}_${methodName}`
        methods[concatenatedMethodName] = mod[methodName].bind((...params: any[]) => {
          try {
            mod(...params)
          } catch (error) {
            if (!(error instanceof Error)) {
              error = new Error(error)
            }
            throw {
              code: INTERNAL_ERROR,
              message: error.message ?? error,
            }
          }
        })
      }
    }
    this._config.logger.debug(`RPC Initialized ${Object.keys(methods).join(', ')}`)
    return methods
  }

  /**
   * Returns all methods in a module
   */
  static getMethodNames(mod: Object): string[] {
    const methodNames = Object.getOwnPropertyNames((mod as any).prototype).filter(
      (methodName: string) => methodName !== 'constructor',
    )
    return methodNames
  }
}
