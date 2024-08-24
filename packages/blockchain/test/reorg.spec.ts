import { cliqueSigner, createBlock } from '@ethereumjs/block'
import { Common, ConsensusAlgorithm, Goerli, Hardfork, Mainnet } from '@ethereumjs/common'
import { Address, equalsBytes, hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { CLIQUE_NONCE_AUTH, CliqueConsensus } from '../src/consensus/clique.js'
import { createBlockchain } from '../src/index.js'

import { generateConsecutiveBlock } from './util.js'

import type { ConsensusDict } from '../src/index.js'
import type { Block } from '@ethereumjs/block'

describe('reorg tests', () => {
  it('should correctly reorg the chain if the total difficulty is higher on a lower block number than the current head block', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.MuirGlacier })
    const genesis = createBlock(
      {
        header: {
          number: BigInt(0),
          difficulty: BigInt(0x020000),
          gasLimit: BigInt(8000000),
        },
      },
      { common },
    )

    const blocks_lowTD: Block[] = []
    const blocks_highTD: Block[] = []

    blocks_lowTD.push(generateConsecutiveBlock(genesis, 0))

    let TD_Low = genesis.header.difficulty + blocks_lowTD[0].header.difficulty
    let TD_High = genesis.header.difficulty

    // Keep generating blocks until the Total Difficulty (TD) of the High TD chain is higher than the TD of the Low TD chain
    // This means that the block number of the high TD chain is 1 lower than the low TD chain

    while (TD_High < TD_Low) {
      blocks_lowTD.push(generateConsecutiveBlock(blocks_lowTD[blocks_lowTD.length - 1], 0))
      blocks_highTD.push(
        generateConsecutiveBlock(blocks_highTD[blocks_highTD.length - 1] ?? genesis, 1),
      )

      TD_Low += blocks_lowTD[blocks_lowTD.length - 1].header.difficulty
      TD_High += blocks_highTD[blocks_highTD.length - 1].header.difficulty
    }

    // sanity check
    const lowTDBlock = blocks_lowTD[blocks_lowTD.length - 1]
    const highTDBlock = blocks_highTD[blocks_highTD.length - 1]

    const number_lowTD = lowTDBlock.header.number
    const number_highTD = highTDBlock.header.number

    // ensure that the block difficulty is higher on the highTD chain when compared to the low TD chain
    assert.ok(
      number_lowTD > number_highTD,
      'low TD should have a lower TD than the reported high TD',
    )
    assert.ok(
      blocks_lowTD[blocks_lowTD.length - 1].header.number >
        blocks_highTD[blocks_highTD.length - 1].header.number,
      'low TD block should have a higher number than high TD block',
    )
  })

  it('should correctly reorg a poa chain and remove blocks from clique snapshots', async () => {
    const common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
    const genesisBlock = createBlock({ header: { extraData: new Uint8Array(97) } }, { common })

    const consensusDict: ConsensusDict = {}
    consensusDict[ConsensusAlgorithm.Clique] = new CliqueConsensus()
    const blockchain = await createBlockchain({
      validateBlocks: false,
      validateConsensus: false,
      consensusDict,
      common,
      genesisBlock,
    })

    const extraData = hexToBytes(
      '0x506172697479205465636820417574686f7269747900000000000000000000002bbf886181970654ed46e3fae0ded41ee53fec702c47431988a7ae80e6576f3552684f069af80ba11d36327aaf846d470526e4a1c461601b2fd4ebdcdc2b734a01',
    ) // from goerli block 1
    const { gasLimit } = genesisBlock.header
    const base = { extraData, gasLimit, difficulty: 1 }

    const nonce = CLIQUE_NONCE_AUTH
    const beneficiary1 = new Address(new Uint8Array(20).fill(1))
    const beneficiary2 = new Address(new Uint8Array(20).fill(2))

    const block1_low = createBlock(
      {
        header: {
          ...base,
          number: 1,
          parentHash: genesisBlock.hash(),
          timestamp: genesisBlock.header.timestamp + BigInt(30),
        },
      },
      { common },
    )
    const block2_low = createBlock(
      {
        header: {
          ...base,
          number: 2,
          parentHash: block1_low.hash(),
          timestamp: block1_low.header.timestamp + BigInt(30),
          nonce,
          coinbase: beneficiary1,
        },
      },
      { common },
    )

    const block1_high = createBlock(
      {
        header: {
          ...base,
          number: 1,
          parentHash: genesisBlock.hash(),
          timestamp: genesisBlock.header.timestamp + BigInt(15),
        },
      },
      { common },
    )
    const block2_high = createBlock(
      {
        header: {
          ...base,
          number: 2,
          parentHash: block1_high.hash(),
          timestamp: block1_high.header.timestamp + BigInt(15),
        },
      },
      { common },
    )
    const block3_high = createBlock(
      {
        header: {
          ...base,
          number: 3,
          parentHash: block2_high.hash(),
          timestamp: block2_high.header.timestamp + BigInt(15),
          nonce,
          coinbase: beneficiary2,
        },
      },
      { common },
    )

    await blockchain.putBlocks([block1_low, block2_low])

    await blockchain.putBlocks([block1_high, block2_high, block3_high])

    let signerStates = (blockchain.consensus as CliqueConsensus)._cliqueLatestSignerStates

    assert.ok(
      !signerStates.find(
        (s: any) => s[0] === BigInt(2) && s[1].find((a: Address) => a.equals(beneficiary1)),
      ),
      'should not find reorged signer state',
    )

    let signerVotes = (blockchain.consensus as CliqueConsensus)._cliqueLatestVotes
    assert.ok(
      !signerVotes.find(
        (v: any) =>
          v[0] === BigInt(2) &&
          v[1][0].equal(cliqueSigner(block1_low.header)) === true &&
          v[1][1].equal(beneficiary1) === true &&
          equalsBytes(v[1][2], CLIQUE_NONCE_AUTH),
      ),
      'should not find reorged clique vote',
    )

    let blockSigners = (blockchain.consensus as CliqueConsensus)._cliqueLatestBlockSigners
    assert.ok(
      !blockSigners.find(
        (s: any) => s[0] === BigInt(1) && s[1].equal(cliqueSigner(block1_low.header)),
      ),
      'should not find reorged block signer',
    )

    signerStates = (blockchain.consensus as CliqueConsensus)._cliqueLatestSignerStates
    assert.ok(
      !!signerStates.find(
        (s: any) => s[0] === BigInt(3) && s[1].find((a: Address) => a.equals(beneficiary2)),
      ),
      'should find reorged signer state',
    )

    signerVotes = (blockchain.consensus as CliqueConsensus)._cliqueLatestVotes
    assert.ok(signerVotes.length === 0, 'votes should be empty')

    blockSigners = (blockchain.consensus as CliqueConsensus)._cliqueLatestBlockSigners
    assert.ok(
      !!blockSigners.find(
        (s: any) => s[0] === BigInt(3) && s[1].equals(cliqueSigner(block3_high.header)),
      ),
      'should find reorged block signer',
    )
  })
})
