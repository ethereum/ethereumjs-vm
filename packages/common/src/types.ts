import { PrefixedHexString } from 'ethereumjs-util'
import { cliqueOpts, ConsensusAlgorithm, ConsensusType, Hardfork as HardforkName } from '.'

export interface genesisStatesType {
  names: {
    [key: string]: string
  }
  [key: string]: {}
}

export interface nameType {
  [key: string]: string
}
export interface chainsType {
  [key: string]: Chain | nameType
}

export interface Chain {
  name: string
  chainId: number | bigint
  networkId: number | bigint
  // TODO: make mandatory in next breaking release
  defaultHardfork?: string
  comment: string
  url: string
  genesis: GenesisBlock
  hardforks: Hardfork[]
  bootstrapNodes: BootstrapNode[]
  dnsNetworks?: string[]
  // TODO: make mandatory in next breaking release
  consensus?: {
    type: ConsensusType | string
    algorithm: ConsensusAlgorithm | string
    clique?: cliqueOpts
    ethash?: any
    casper?: any
  }
}

type StoragePair = [key: PrefixedHexString, value: PrefixedHexString]

export type AccountState = [
  balance: PrefixedHexString,
  code: PrefixedHexString,
  storage: Array<StoragePair>
]

export interface GenesisState {
  [key: PrefixedHexString]: PrefixedHexString | AccountState
}

export interface eipsType {
  [key: number]: any
}

export interface GenesisBlock {
  hash: string
  timestamp: string | null
  gasLimit: number
  difficulty: number
  nonce: string
  extraData: string
  stateRoot: string
  baseFeePerGas?: string
}

export interface Hardfork {
  name: HardforkName | string
  block: number | null
  td?: number
  forkHash?: string | null
}

export interface BootstrapNode {
  ip: string
  port: number | string
  network?: string
  chainId?: number
  id: string
  location: string
  comment: string
}
