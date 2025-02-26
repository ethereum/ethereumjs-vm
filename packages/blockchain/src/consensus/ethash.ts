import { ConsensusAlgorithm } from '@ethereumjs/common'
import { EthereumJSErrorWithoutCode, bytesToHex } from '@ethereumjs/util'
import debugDefault from 'debug'

import type { Blockchain } from '../index.js'
import type { Consensus, ConsensusOptions } from '../types.js'
import type { Block, BlockHeader } from '@ethereumjs/block'
import type { Debugger } from 'debug'

export type MinimalEthashInterface = {
  cacheDB?: any
  verifyPOW(block: Block): Promise<boolean>
}

/**
 * This class encapsulates Ethash-related consensus functionality when used with the Blockchain class.
 */
export class EthashConsensus implements Consensus {
  blockchain: Blockchain | undefined
  algorithm: ConsensusAlgorithm
  _ethash: MinimalEthashInterface

  private DEBUG: boolean // Guard for debug logs
  private _debug: Debugger

  constructor(ethash: MinimalEthashInterface) {
    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
    this._debug = debugDefault('blockchain:ethash')

    this.algorithm = ConsensusAlgorithm.Ethash
    this._ethash = ethash
  }

  async validateConsensus(block: Block): Promise<void> {
    const valid = await this._ethash.verifyPOW(block)
    if (!valid) {
      throw EthereumJSErrorWithoutCode('invalid POW')
    }
    this.DEBUG &&
      this._debug(
        `valid PoW consensus block: number ${block.header.number} hash ${bytesToHex(block.hash())}`,
      )
  }

  /**
   * Checks that the block's `difficulty` matches the canonical difficulty of the parent header.
   * @param header - header of block to be checked
   */
  async validateDifficulty(header: BlockHeader) {
    if (!this.blockchain) {
      throw EthereumJSErrorWithoutCode('blockchain not provided')
    }
    const parentHeader = await this.blockchain['_getHeader'](header.parentHash)
    if (header.ethashCanonicalDifficulty(parentHeader) !== header.difficulty) {
      throw EthereumJSErrorWithoutCode(`invalid difficulty ${header.errorStr()}`)
    }
    this.DEBUG &&
      this._debug(
        `valid difficulty header: number ${header.number} difficulty ${header.difficulty} parentHash ${bytesToHex(header.parentHash)}`,
      )
  }

  public async genesisInit(): Promise<void> {}
  public async setup({ blockchain }: ConsensusOptions): Promise<void> {
    this.blockchain = blockchain
    this._ethash.cacheDB = this.blockchain.db
  }
  public async newBlock(): Promise<void> {}
}
