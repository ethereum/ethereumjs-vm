import { CliqueConsensus, createBlockchain } from '@ethereumjs/blockchain'
import { Common, ConsensusAlgorithm, Hardfork } from '@ethereumjs/common'

import { Goerli } from '../test/testdata/goerliCommon.js'

import type { ConsensusDict } from '@ethereumjs/blockchain'

const common = new Common({ chain: Goerli, hardfork: Hardfork.London })

const consensusDict: ConsensusDict = {}
consensusDict[ConsensusAlgorithm.Clique] = new CliqueConsensus()
const blockchain = await createBlockchain({
  consensusDict,
  common,
})
console.log(`Created blockchain with ${blockchain.consensus!.algorithm} consensus algorithm`)
