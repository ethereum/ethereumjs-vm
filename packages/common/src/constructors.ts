import { Common, parseGethGenesis } from './index.js'

import type { BaseOpts, ChainConfig, GethConfigOpts } from './index.js'

/**
 * Creates a {@link Common} object for a custom chain, based on a standard one.
 *
 * It uses all the {@link Chain} parameters from the {@link baseChain} option except the ones overridden
 * in a provided {@link chainParamsOrName} dictionary. Some usage example:
 *
 * ```javascript
 * import { createCustomCommon, Mainnet } from '@ethereumjs/common'
 *
 * createCustomCommon({chainId: 123}, Mainnet)
 * ``
 *
 * @param partialConfig Custom parameter dict
 * @param baseChain `ChainConfig` chain configuration taken as a base chain, e.g. `Mainnet` (exported at root level)
 * @param opts Custom chain options to set various {@link BaseOpts}
 */
export function createCustomCommon(
  partialConfig: Partial<ChainConfig>,
  baseChain: ChainConfig,
  opts: BaseOpts = {}
): Common {
  return new Common({
    chain: {
      ...baseChain,
      ...partialConfig,
    },
    ...opts,
  })
}

/**
 * Static method to load and set common from a geth genesis json
 * @param genesisJson json of geth configuration
 * @param { Mainnet, eips, genesisHash, hardfork, mergeForkIdPostMerge } to further configure the common instance
 * @returns Common
 */
export function createCommonFromGethGenesis(
  genesisJson: any,
  { chain, eips, genesisHash, hardfork, params, customCrypto }: GethConfigOpts
): Common {
  const genesisParams = parseGethGenesis(genesisJson, chain)
  const common = new Common({
    chain: genesisParams,
    eips,
    params,
    hardfork: hardfork ?? genesisParams.hardfork,
    customCrypto,
  })
  if (genesisHash !== undefined) {
    common.setForkHashes(genesisHash)
  }
  return common
}
