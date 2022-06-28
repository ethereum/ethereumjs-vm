import { BlockHeader } from '@ethereumjs/block'
import { ConsensusAlgorithm } from '@ethereumjs/common'
import Blockchain from '..'
import { Consensus, ConsensusOptions } from './interface'

/**
 * This class encapsulates Casper-related consensus functionality when used with the Blockchain class.
 */
export class CasperConsensus implements Consensus {
  blockchain: Blockchain
  algorithm: ConsensusAlgorithm

  constructor({ blockchain }: ConsensusOptions) {
    this.blockchain = blockchain
    this.algorithm = ConsensusAlgorithm.Casper
  }

  public async genesisInit(): Promise<void> {}

  public async setup(): Promise<void> {}

  public async validateConsensus(): Promise<void> {}

  public async validateDifficulty(header: BlockHeader): Promise<void> {
    if (header.difficulty !== BigInt(0)) {
      const msg = 'invalid difficulty.  PoS blocks must have difficulty 0'
      throw new Error(`${msg} ${header.errorStr()}`)
    }
  }
  public async newBlock(): Promise<void> {}
}
