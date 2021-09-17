import { BN } from 'ethereumjs-util'
import { ConsensusAlgorithm, ConsensusType, Hardfork } from '.'

export interface genesisStatesType {
  names: {
    [key: string]: string
  }
  [key: string]: {}
}

export interface chainsType {
  names: {
    [key: string]: string
  }
  [key: string]: any
}

export interface Chain {
  name: string
  chainId: number | BN
  networkId: number | BN
  // TODO: make mandatory in next breaking release
  defaultHardfork?: string
  comment: string
  url: string
  genesis: GenesisBlock
  hardforks: HardforkParams[]
  bootstrapNodes: BootstrapNode[]
  dnsNetworks?: string[]
  // TODO: make mandatory in next breaking release
  consensus?: {
    type: ConsensusType
    algorithm: ConsensusAlgorithm
    clique?: {
      period: number
      epoch: number
    }
    ethash?: any
    casper?: any
  }
}

export interface GenesisState {
  [key: string]: string
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
}

export interface HardforkParams {
  name: Hardfork
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
