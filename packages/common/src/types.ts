import { BN } from 'ethereumjs-util'
import { ConsensusAlgorithm, ConsensusType, Hardfork as HardforkName } from '.'

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
  hardforks: Hardfork[]
  bootstrapNodes: BootstrapNode[]
  dnsNetworks?: string[]
  // TODO: make mandatory in next breaking release
  consensus?: {
    type: ConsensusType | string
    algorithm: ConsensusAlgorithm | string
    clique?: {
      period: number
      epoch: number
    }
    ethash?: any
    casper?: any
  }
}

export type StoragePair = [key: string, value: string]
export type AccountState = [balance: string, code: string, storage: Array<StoragePair>] // [balance, code, [[storageKey, storageValue]]]

export interface GenesisState {
  [key: string]: string | AccountState
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
