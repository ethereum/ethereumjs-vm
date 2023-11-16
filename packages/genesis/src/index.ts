import { Chain } from '@ethereumjs/common'

import { goerliGenesis } from './genesisStates/goerli.js'
import { holeskyGenesis } from './genesisStates/holesky.js'
import { kaustinenGenesis } from './genesisStates/kaustinen.js'
import { mainnetGenesis } from './genesisStates/mainnet.js'
import { sepoliaGenesis } from './genesisStates/sepolia.js'

import type { GenesisState } from '@ethereumjs/util'

/**
 * Utility to get the genesisState of a well known network
 * @param: chainId of the network
 * @returns genesisState of the chain
 */
export function getGenesis(chainId: number): GenesisState | undefined {
  // Use require statements here in favor of import statements
  // to load json files on demand
  // (high memory usage by large mainnet.json genesis state file)
  switch (chainId) {
    case Chain.Mainnet:
      return mainnetGenesis
    case Chain.Goerli:
      return goerliGenesis
    case Chain.Sepolia:
      return sepoliaGenesis
    case Chain.Holesky:
      return holeskyGenesis
    case Chain.Kaustinen:
      return kaustinenGenesis

    default:
      return undefined
  }
}
