import { BIGINT_0, hexToBytes } from '@ethereumjs/util'

export enum Chain {
  Mainnet = 1,
  Sepolia = 11155111,
  Holesky = 17000,
  Kaustinen6 = 69420,
}

/**
 * Genesis state meta info which is decoupled from common's genesis params
 */
type GenesisState = {
  name: string
  /* blockNumber that can be used to update and track the regenesis marker */
  blockNumber: bigint
  /* stateRoot of the chain at the blockNumber */
  stateRoot: Uint8Array
}

// Having this info as record will force typescript to make sure no chain is missed
/**
 * GenesisState info about well known ethereum chains
 */
export const ChainGenesis: Record<Chain, GenesisState> = {
  [Chain.Mainnet]: {
    name: 'mainnet',
    blockNumber: BIGINT_0,
    stateRoot: hexToBytes('0xd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544'),
  },
  [Chain.Sepolia]: {
    name: 'sepolia',
    blockNumber: BIGINT_0,
    stateRoot: hexToBytes('0x5eb6e371a698b8d68f665192350ffcecbbbf322916f4b51bd79bb6887da3f494'),
  },
  [Chain.Holesky]: {
    name: 'holesky',
    blockNumber: BIGINT_0,
    stateRoot: hexToBytes('0x69d8c9d72f6fa4ad42d4702b433707212f90db395eb54dc20bc85de253788783'),
  },
  [Chain.Kaustinen6]: {
    name: 'kaustinen6',
    blockNumber: BIGINT_0,
    stateRoot: hexToBytes('0x1fbf85345a3cbba9a6d44f991b721e55620a22397c2a93ee8d5011136ac300ee'),
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
  Prague = 'prague',
  Osaka = 'osaka',
  Verkle = 'verkle',
  EVMMax = 'evmmax',
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
