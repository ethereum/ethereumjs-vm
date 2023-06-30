import { hexToBytes } from '@ethereumjs/util'

export enum Chain {
  Mainnet = 1,
  Goerli = 5,
  Sepolia = 11155111,
}

// Genesis meta gives the genesis state info which is uncoupled with common's genesis params
type GenesiState = {
  /* blockNumber that can be used to update and track the regenesis marker */
  blockNumber: bigint
  /* stateRoot of the chain at the blockNumber */
  stateRoot: Uint8Array
}

// Having this info as record will force typescript to make sure no chain is missed
export const ChainGenesis: Record<Chain, GenesiState> = {
  [Chain.Mainnet]: {
    blockNumber: BigInt(0),
    stateRoot: hexToBytes('0xd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544'),
  },
  [Chain.Goerli]: {
    blockNumber: BigInt(0),
    stateRoot: hexToBytes('0x5d6cded585e73c4e322c30c2f782a336316f17dd85a4863b9d838d2d4b8b3008'),
  },
  [Chain.Sepolia]: {
    blockNumber: BigInt(0),
    stateRoot: hexToBytes('0x5eb6e371a698b8d68f665192350ffcecbbbf322916f4b51bd79bb6887da3f494'),
  },
}

export enum Hardfork {
  Chainstart = 'chainstart',
  Homestead = 'homestead',
  Dao = 'dao',
  TangerineWhistle = 'tangerineWhistle',
  SpuriousDragon = 'spuriousDragon',
  Byzantium = 'byzantium',
  Constantinople = 'constantinople',
  Petersburg = 'petersburg',
  Istanbul = 'istanbul',
  MuirGlacier = 'muirGlacier',
  Berlin = 'berlin',
  London = 'london',
  ArrowGlacier = 'arrowGlacier',
  GrayGlacier = 'grayGlacier',
  MergeForkIdTransition = 'mergeForkIdTransition',
  Paris = 'paris',
  Shanghai = 'shanghai',
  Cancun = 'cancun',
}

export enum ConsensusType {
  ProofOfStake = 'pos',
  ProofOfWork = 'pow',
  ProofOfAuthority = 'poa',
}

export enum ConsensusAlgorithm {
  Ethash = 'ethash',
  Clique = 'clique',
  Casper = 'casper',
}

export enum CustomChain {
  /**
   * Polygon (Matic) Mainnet
   *
   * - [Documentation](https://docs.matic.network/docs/develop/network-details/network)
   */
  PolygonMainnet = 'polygon-mainnet',

  /**
   * Polygon (Matic) Mumbai Testnet
   *
   * - [Documentation](https://docs.matic.network/docs/develop/network-details/network)
   */
  PolygonMumbai = 'polygon-mumbai',

  /**
   * Arbitrum One - mainnet for Arbitrum roll-up
   *
   * - [Documentation](https://developer.offchainlabs.com/public-chains)
   */
  ArbitrumOne = 'arbitrum-one',

  /**
   * xDai EVM sidechain with a native stable token
   *
   * - [Documentation](https://www.xdaichain.com/)
   */
  xDaiChain = 'x-dai-chain',

  /**
   * Optimistic Kovan - testnet for Optimism roll-up
   *
   * - [Documentation](https://community.optimism.io/docs/developers/tutorials.html)
   */
  OptimisticKovan = 'optimistic-kovan',

  /**
   * Optimistic Ethereum - mainnet for Optimism roll-up
   *
   * - [Documentation](https://community.optimism.io/docs/developers/tutorials.html)
   */
  OptimisticEthereum = 'optimistic-ethereum',
}
