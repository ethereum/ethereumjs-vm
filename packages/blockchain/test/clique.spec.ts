import {
  cliqueEpochTransitionSigners,
  createBlock,
  createSealedCliqueBlock,
} from '@ethereumjs/block'
import {
  Common,
  ConsensusAlgorithm,
  ConsensusType,
  Goerli,
  Hardfork,
  createCustomCommon,
} from '@ethereumjs/common'
import {
  Address,
  concatBytes,
  createAddressFromString,
  createZeroAddress,
  hexToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { CLIQUE_NONCE_AUTH, CLIQUE_NONCE_DROP, CliqueConsensus } from '../src/consensus/clique.js'
import { createBlockchain } from '../src/index.js'

import type { Blockchain, ConsensusDict } from '../src/index.js'
import type { Block } from '@ethereumjs/block'
import type { CliqueConfig } from '@ethereumjs/common'

const COMMON = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
const EXTRA_DATA = new Uint8Array(97)
const GAS_LIMIT = BigInt(8000000)

type Signer = {
  address: Address
  privateKey: Uint8Array
  publicKey: Uint8Array
}

const A: Signer = {
  address: new Address(hexToBytes('0x0b90087d864e82a284dca15923f3776de6bb016f')),
  privateKey: hexToBytes('0x64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
  publicKey: hexToBytes(
    '0x40b2ebdf4b53206d2d3d3d59e7e2f13b1ea68305aec71d5d24cefe7f24ecae886d241f9267f04702d7f693655eb7b4aa23f30dcd0c3c5f2b970aad7c8a828195',
  ),
}

const B: Signer = {
  address: new Address(hexToBytes('0x6f62d8382bf2587361db73ceca28be91b2acb6df')),
  privateKey: hexToBytes('0x2a6e9ad5a6a8e4f17149b8bc7128bf090566a11dbd63c30e5a0ee9f161309cd6'),
  publicKey: hexToBytes(
    '0xca0a55f6e81cb897aee6a1c390aa83435c41048faa0564b226cfc9f3df48b73e846377fb0fd606df073addc7bd851f22547afbbdd5c3b028c91399df802083a2',
  ),
}

const C: Signer = {
  address: new Address(hexToBytes('0x83c30730d1972baa09765a1ac72a43db27fedce5')),
  privateKey: hexToBytes('0xf216ddcf276079043c52b5dd144aa073e6b272ad4bfeaf4fbbc044aa478d1927'),
  publicKey: hexToBytes(
    '0x555b19a5cbe6dd082a4a1e1e0520dd52a82ba24fd5598ea31f0f31666c40905ed319314c5fb06d887b760229e1c0e616294e7b1cb5dfefb71507c9112132ce56',
  ),
}

const D: Signer = {
  address: new Address(hexToBytes('0x8458f408106c4875c96679f3f556a511beabe138')),
  privateKey: hexToBytes('0x159e95d07a6c64ddbafa6036cdb7b8114e6e8cdc449ca4b0468a6d0c955f991b'),
  publicKey: hexToBytes(
    '0xf02724341e2df54cf53515f079b1354fa8d437e79c5b091b8d8cc7cbcca00fd8ad854cb3b3a85b06c44ecb7269404a67be88b561f2224c94d133e5fc21be915c',
  ),
}

const E: Signer = {
  address: new Address(hexToBytes('0xab80a948c661aa32d09952d2a6c4ad77a4c947be')),
  privateKey: hexToBytes('0x48ec5a6c4a7fc67b10a9d4c8a8f594a81ae42e41ed061fa5218d96abb6012344'),
  publicKey: hexToBytes(
    '0xadefb82b9f54e80aa3532263e4478739de16fcca6828f4ae842f8a07941c347fa59d2da1300569237009f0f122dc1fd6abb0db8fcb534280aa94948a5cc95f94',
  ),
}

const F: Signer = {
  address: new Address(hexToBytes('0xdc7bc81ddf67d037d7439f8e6ff12f3d2a100f71')),
  privateKey: hexToBytes('0x86b0ff7b6cf70786f29f297c57562905ab0b6c32d69e177a46491e56da9e486e'),
  publicKey: hexToBytes(
    '0xd3e3d2b722e325bfc085ff5638a112b4e7e88ff13f92fc7f6cfc14b5a25e8d1545a2f27d8537b96e8919949d5f8c139ae7fc81aea7cf7fe5d43d7faaa038e35b',
  ),
}

const initWithSigners = async (signers: Signer[], common?: Common) => {
  common = common ?? COMMON
  const blocks: Block[] = []

  const extraData = concatBytes(
    new Uint8Array(32),
    ...signers.map((s) => s.address.toBytes()),
    new Uint8Array(65),
  )
  const genesisBlock = createBlock({ header: { gasLimit: GAS_LIMIT, extraData } }, { common })
  blocks.push(genesisBlock)

  const consensusDict: ConsensusDict = {}
  consensusDict[ConsensusAlgorithm.Clique] = new CliqueConsensus()

  const blockchain = await createBlockchain({
    validateBlocks: true,
    validateConsensus: true,
    consensusDict,
    genesisBlock,
    common,
  })
  return { blocks, blockchain }
}

function getBlock(
  blockchain: Blockchain,
  lastBlock: Block,
  signer: Signer,
  beneficiary?: [Signer, boolean],
  checkpointSigners?: Signer[],
  common?: Common,
) {
  common = common ?? COMMON
  const number = lastBlock.header.number + BigInt(1)

  let coinbase = createZeroAddress()
  let nonce = CLIQUE_NONCE_DROP
  let extraData = EXTRA_DATA
  if (beneficiary) {
    coinbase = beneficiary[0].address
    if (beneficiary[1]) {
      nonce = CLIQUE_NONCE_AUTH
    }
  } else if (checkpointSigners) {
    extraData = concatBytes(
      new Uint8Array(32),
      ...checkpointSigners.map((s) => s.address.toBytes()),
      new Uint8Array(65),
    )
  }

  const blockData = {
    header: {
      number,
      parentHash: lastBlock.hash(),
      coinbase,
      timestamp: lastBlock.header.timestamp + BigInt(15),
      extraData,
      gasLimit: GAS_LIMIT,
      difficulty: BigInt(2),
      nonce,
    },
  }

  // calculate difficulty
  const signers = (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(number)
  const signerIndex = signers.findIndex((address: Address) => address.equals(signer.address))
  const inTurn = Number(number) % signers.length === signerIndex
  blockData.header.difficulty = inTurn ? BigInt(2) : BigInt(1)

  // set signer
  const cliqueSigner = signer.privateKey

  return createSealedCliqueBlock(blockData, cliqueSigner, { common })
}

const addNextBlockReorg = async (
  blockchain: Blockchain,
  blocks: Block[],
  forkBlock: Block,
  signer: Signer,
  beneficiary?: [Signer, boolean],
  checkpointSigners?: Signer[],
  common?: Common,
) => {
  const block = getBlock(blockchain, forkBlock, signer, beneficiary, checkpointSigners, common)
  await blockchain.putBlock(block)
  blocks.push(block)
  return block
}

const addNextBlock = async (
  blockchain: Blockchain,
  blocks: Block[],
  signer: Signer,
  beneficiary?: [Signer, boolean],
  checkpointSigners?: Signer[],
  common?: Common,
) => {
  const block = getBlock(
    blockchain,
    blocks[blocks.length - 1],
    signer,
    beneficiary,
    checkpointSigners,
    common,
  )
  await blockchain.putBlock(block)
  blocks.push(block)
  return block
}

describe('Clique: Initialization', () => {
  it('should initialize a clique blockchain', async () => {
    const common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })
    const consensusDict: ConsensusDict = {}
    consensusDict[ConsensusAlgorithm.Clique] = new CliqueConsensus()
    const blockchain = await createBlockchain({ common, consensusDict })

    const head = await blockchain.getIteratorHead()
    assert.deepEqual(head.hash(), blockchain.genesisBlock.hash(), 'correct genesis hash')

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(head.header.number + BigInt(1)),
      cliqueEpochTransitionSigners(head.header),
      'correct genesis signers',
    )
  })

  it('should throw if signer in epoch checkpoint is not active', async () => {
    const { blockchain } = await initWithSigners([A])
    ;(blockchain as any)._validateBlocks = false
    // _validateConsensus needs to be true to trigger this test condition
    ;(blockchain as any)._validateConsensus = true
    const number = (COMMON.consensusConfig() as CliqueConfig).epoch
    const unauthorizedSigner = createAddressFromString('0x00a839de7922491683f547a67795204763ff8237')
    const extraData = concatBytes(
      new Uint8Array(32),
      A.address.toBytes(),
      unauthorizedSigner.toBytes(),
      new Uint8Array(65),
    )
    const block = createSealedCliqueBlock({ header: { number, extraData } }, A.privateKey, {
      common: COMMON,
      freeze: false,
    })
    try {
      await blockchain.putBlock(block)
      assert.fail('should fail')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(
        error.message.includes('checkpoint signer not found in active signers list'),
        'correct error',
      )
    }
  })

  it('should throw on invalid difficulty', async () => {
    const { blocks, blockchain } = await initWithSigners([A])
    await addNextBlock(blockchain, blocks, A)
    const parentHeader = await blockchain.getCanonicalHeadHeader()
    const number = BigInt(2)
    const extraData = new Uint8Array(97)
    let difficulty = BigInt(5)
    let block = createBlock(
      {
        header: {
          number,
          extraData,
          difficulty,
          parentHash: parentHeader.hash(),
          timestamp: parentHeader.timestamp + BigInt(10000),
        },
      },
      { common: COMMON },
    )

    try {
      await blockchain.putBlock(block)
      assert.fail('should fail')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(
        error.message.includes('difficulty for clique block must be INTURN (2) or NOTURN (1)'),
        'correct error',
      )
    }

    difficulty = BigInt(1)
    const cliqueSigner = A.privateKey
    block = createSealedCliqueBlock(
      {
        header: {
          number,
          extraData,
          difficulty,
          parentHash: parentHeader.hash(),
          timestamp: parentHeader.timestamp + BigInt(10000),
        },
      },
      cliqueSigner,
      { common: COMMON },
    )

    try {
      await blockchain.putBlock(block)
      assert.fail('should fail')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(error.message.includes('invalid clique difficulty'), 'correct error')
    }
  })

  it("should set the inturn signer's block as canonical block", async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    // when the block number is 1, the inturn signer should be B
    const inturnBlock = await addNextBlock(blockchain, blocks, B)
    blocks.pop()
    // noturn block
    await addNextBlock(blockchain, blocks, A)
    const block = await blockchain.getBlock(1)
    assert.deepEqual(inturnBlock.hash(), block.hash(), 'correct canonical block')
  })

  // Test Cases: https://eips.ethereum.org/EIPS/eip-225
  it('Clique Voting: Single signer, no votes cast', async () => {
    const { blocks, blockchain } = await initWithSigners([A])
    const block = await addNextBlock(blockchain, blocks, A)
    assert.equal(block.header.number, BigInt(1))
    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        block.header.number + BigInt(1),
      ),
      [A.address],
    )
  })

  it('Clique Voting: Single signer, voting to add two others', async () => {
    const { blocks, blockchain } = await initWithSigners([A])
    await addNextBlock(blockchain, blocks, A, [B, true])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A, [C, true])
    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
      'only accept first, second needs 2 votes',
    )
  })

  it('Two signers, voting to add three others', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [C, true])
    await addNextBlock(blockchain, blocks, B, [C, true])
    await addNextBlock(blockchain, blocks, A, [D, true])
    await addNextBlock(blockchain, blocks, B, [D, true])
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A, [E, true])
    await addNextBlock(blockchain, blocks, B, [E, true])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address, C.address, D.address],
      'only accept first two, third needs 3 votes already',
    )
  })

  it('Ensure old clique states are remembered', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [C, true])
    await addNextBlock(blockchain, blocks, B, [C, true])
    await addNextBlock(blockchain, blocks, A, [D, true])
    await addNextBlock(blockchain, blocks, B, [D, true])
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A, [E, true])
    await addNextBlock(blockchain, blocks, B, [E, true])
    await addNextBlock(blockchain, blocks, C)

    for (let i = 1; i < blocks.length; i++) {
      await blockchain.putBlock(blocks[i])
    }
  })

  it('Clique Voting: Single signer, dropping itself)', async () => {
    const { blocks, blockchain } = await initWithSigners([A])
    await addNextBlock(blockchain, blocks, A, [A, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [],
      'weird, but one less cornercase by explicitly allowing this',
    )
  })

  it('Clique Voting: Two signers, actually needing mutual consent to drop either of them', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [B, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
      'not fulfilled',
    )
  })

  it('Clique Voting: Two signers, actually needing mutual consent to drop either of them', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [B, false])
    await addNextBlock(blockchain, blocks, B, [B, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address],
      'fulfilled',
    )
  })

  it('Clique Voting: Three signers, two of them deciding to drop the third', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B, [C, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
    )
  })

  it('Clique Voting: Four signers, consensus of two not being enough to drop anyone', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C, D])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B, [C, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address, C.address, D.address],
    )
  })

  it('Clique Voting: Four signers, consensus of three already being enough to drop someone', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C, D])
    await addNextBlock(blockchain, blocks, A, [D, false])
    await addNextBlock(blockchain, blocks, B, [D, false])
    await addNextBlock(blockchain, blocks, C, [D, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address, C.address],
    )
  })

  it('Clique Voting: Authorizations are counted once per signer per target', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [C, true])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A, [C, true])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A, [C, true])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
    )
  })

  it('Clique Voting: Authorizing multiple accounts concurrently is permitted', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [C, true])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A, [D, true])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [D, true])
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [C, true])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address, C.address, D.address],
    )
  })

  it('Clique Voting: Deauthorizations are counted once per signer per target', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A, [B, false])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A, [B, false])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A, [B, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
    )
  })

  it('Clique Voting: Deauthorizing multiple accounts concurrently is permitted', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C, D])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A, [D, false])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [D, false])
    await addNextBlock(blockchain, blocks, C, [D, false])
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [C, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
    )
  })

  it('Clique Voting: Votes from deauthorized signers are discarded immediately', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C])
    await addNextBlock(blockchain, blocks, C, [B, false])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B, [C, false])
    await addNextBlock(blockchain, blocks, A, [B, false])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
      'deauthorized votes',
    )
  })

  it('Clique Voting: Votes from deauthorized signers are discarded immediately', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C])
    await addNextBlock(blockchain, blocks, C, [D, true])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B, [C, false])
    await addNextBlock(blockchain, blocks, A, [D, true])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
      'auth votes',
    )
  })

  it('Clique Voting: Changes reaching consensus out of bounds (via a deauthorization) execute on touch', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C, D])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A, [D, false])
    await addNextBlock(blockchain, blocks, B, [C, false])
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [D, false])
    await addNextBlock(blockchain, blocks, C, [D, false])
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, C, [C, true])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
    )
  })

  it('Clique Voting: Changes reaching consensus out of bounds (via a deauthorization) may go out of consensus on first touch', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C, D])
    await addNextBlock(blockchain, blocks, A, [C, false])
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A, [D, false])
    await addNextBlock(blockchain, blocks, B, [C, false])
    await addNextBlock(blockchain, blocks, C)
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [D, false])
    await addNextBlock(blockchain, blocks, C, [D, false])
    await addNextBlock(blockchain, blocks, A)
    await addNextBlock(blockchain, blocks, B, [C, true])

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address, C.address],
    )
  })

  it("Clique Voting: Ensure that pending votes don't survive authorization status changes", async () => {
    // This corner case can only appear if a signer is quickly added, removed
    // and then re-added (or the inverse), while one of the original voters
    // dropped. If a past vote is left cached in the system somewhere, this
    // will interfere with the final signer outcome.
    const { blocks, blockchain } = await initWithSigners([A, B, C, D, E])
    await addNextBlock(blockchain, blocks, A, [F, true]) // Authorize F, 3 votes needed
    await addNextBlock(blockchain, blocks, B, [F, true])
    await addNextBlock(blockchain, blocks, C, [F, true])
    await addNextBlock(blockchain, blocks, D, [F, false]) // Deauthorize F, 4 votes needed (leave A's previous vote "unchanged")
    await addNextBlock(blockchain, blocks, E, [F, false])
    await addNextBlock(blockchain, blocks, B, [F, false])
    await addNextBlock(blockchain, blocks, C, [F, false])
    await addNextBlock(blockchain, blocks, D, [F, true]) // Almost authorize F, 2/3 votes needed
    await addNextBlock(blockchain, blocks, E, [F, true])
    await addNextBlock(blockchain, blocks, B, [A, false]) // Deauthorize A, 3 votes needed
    await addNextBlock(blockchain, blocks, C, [A, false])
    await addNextBlock(blockchain, blocks, D, [A, false])
    await addNextBlock(blockchain, blocks, B, [F, true]) // Finish authorizing F, 3/3 votes needed

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [B.address, C.address, D.address, E.address, F.address],
    )
  })

  it('Clique Voting: Epoch transitions reset all votes to allow chain checkpointing', async () => {
    const common = createCustomCommon(
      {
        consensus: {
          type: ConsensusType.ProofOfAuthority,
          algorithm: ConsensusAlgorithm.Clique,
          clique: {
            period: 15,
            epoch: 3,
          },
        },
      },
      Goerli,
      {
        hardfork: Hardfork.Chainstart,
      },
    )
    const { blocks, blockchain } = await initWithSigners([A, B], common)
    await addNextBlock(blockchain, blocks, A, [C, true], undefined, common)
    await addNextBlock(blockchain, blocks, B, undefined, undefined, common)
    await addNextBlock(blockchain, blocks, A, undefined, [A, B], common)
    await addNextBlock(blockchain, blocks, B, [C, true], undefined, common)

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
    )
  })

  it('Clique Voting: An unauthorized signer should not be able to sign blocks', async () => {
    const { blocks, blockchain } = await initWithSigners([A])
    await addNextBlock(blockchain, blocks, A)
    try {
      await addNextBlock(blockchain, blocks, B)
      assert.fail('should throw error')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(
        error.message.includes('invalid PoA block signature (clique)'),
        'correct error thrown',
      )
    }
  })

  it('Clique Voting: An authorized signer that signed recently should not be able to sign again', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    await addNextBlock(blockchain, blocks, A)
    try {
      await addNextBlock(blockchain, blocks, A)
      assert.fail('should throw error')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(error.message.includes('recently signed'), 'correct error thrown')
    }
  })

  it('Clique Voting: Recent signatures should not reset on checkpoint blocks imported in a batch', async () => {
    const common = createCustomCommon(
      {
        consensus: {
          type: ConsensusType.ProofOfAuthority,
          algorithm: ConsensusAlgorithm.Clique,
          clique: {
            period: 15,
            epoch: 3,
          },
        },
      },
      Goerli,
      {
        hardfork: Hardfork.Chainstart,
      },
    )
    const { blocks, blockchain } = await initWithSigners([A, B, C], common)
    await addNextBlock(blockchain, blocks, A, undefined, undefined, common)
    await addNextBlock(blockchain, blocks, B, undefined, undefined, common)
    await addNextBlock(blockchain, blocks, A, undefined, [A, B, C], common)
    try {
      await addNextBlock(blockchain, blocks, A, undefined, undefined, common)
      assert.fail('should throw error')
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      assert.ok(error.message.includes('recently signed'), 'correct error thrown')
    }
  })

  it('cliqueSignerInTurn() -> should work as expected', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B, C])
    // block 1: B, next signer: C
    await addNextBlock(blockchain, blocks, B)
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        A.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        B.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.ok(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        C.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    // block 2: C, next signer: A
    await addNextBlock(blockchain, blocks, C)
    assert.ok(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        A.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        B.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        C.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    // block 3: A, next signer: B
    await addNextBlock(blockchain, blocks, A)
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        A.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.ok(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        B.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        C.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    // block 4: B, next signer: C
    await addNextBlock(blockchain, blocks, B)
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        A.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.notOk(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        B.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
    assert.ok(
      await (blockchain.consensus as CliqueConsensus).cliqueSignerInTurn(
        C.address,
        blocks[blocks.length - 1].header.number,
      ),
    )
  })
})

describe('clique: reorgs', () => {
  it('Two signers, voting to add one other signer, then reorg and revoke this addition', async () => {
    const { blocks, blockchain } = await initWithSigners([A, B])
    const genesis = blocks[0]
    await addNextBlock(blockchain, blocks, A, [C, true])
    const headBlockNotForked = await addNextBlock(blockchain, blocks, B, [C, true])
    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address, C.address],
      'address C added to signers',
    )
    assert.deepEqual((await blockchain.getCanonicalHeadBlock()).hash(), headBlockNotForked.hash())
    await addNextBlockReorg(blockchain, blocks, genesis, B)
    const headBlock = await addNextBlock(blockchain, blocks, A)
    assert.deepEqual((await blockchain.getCanonicalHeadBlock()).hash(), headBlock.hash())
    await addNextBlock(blockchain, blocks, B)
    await addNextBlock(blockchain, blocks, A)

    assert.deepEqual(
      (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
        blocks[blocks.length - 1].header.number + BigInt(1),
      ),
      [A.address, B.address],
      'address C not added to signers',
    )
  })

  /**
   * This test fails, but demonstrates why at an epoch reorg with changing votes, we get an internal error.
  it(
    'Two signers, voting to add one other signer, epoch transition, then reorg and revoke this addition',
    async (st) => {
      const common = createCustomCommon(
        {
          consensus: {
            type: ConsensusType.ProofOfAuthority,
            algorithm: ConsensusAlgorithm.Clique,
            clique: {
              period: 15,
              epoch: 3,
            },
          },
        },
        {
          baseChain: Chain.Rinkeby,
          hardfork: Hardfork.Chainstart,
        }
      )
      const { blocks, blockchain } = await initWithSigners([A, B])
      const genesis = blocks[0]
      await addNextBlock(blockchain, blocks, A, [C, true], undefined, common)
      await addNextBlock(blockchain, blocks, B, [C, true], undefined, common)
      await addNextBlock(blockchain, blocks, A, undefined, undefined, common)
      const headBlockNotForked = await addNextBlock(
        blockchain,
        blocks,
        B,
        undefined,
        undefined,
        common
      )
     assert.deepEqual(
        (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
          blocks[blocks.length - 1].header.number + BigInt(1)
        ),
        [A.address, B.address, C.address],
        'address C added to signers'
      )
     assert.deepEqual((await blockchain.getCanonicalHeadBlock()).hash(), headBlockNotForked.hash())
      await addNextBlockReorg(blockchain, blocks, genesis, B, undefined, undefined, common)
      await addNextBlock(blockchain, blocks, A, undefined, undefined, common)

      // Add block 3: epoch transition
      await addNextBlock(blockchain, blocks, B, undefined, undefined, common)
      // Now here suddenly C is added again as signer

      await addNextBlock(blockchain, blocks, A, undefined, undefined, common)
      await addNextBlock(blockchain, blocks, B, undefined, undefined, common)

      const headBlock = await addNextBlock(blockchain, blocks, A, undefined, undefined, common)
     assert.deepEqual((await blockchain.getCanonicalHeadBlock()).hash(), headBlock.hash())

     assert.deepEqual(
        (blockchain.consensus as CliqueConsensus).cliqueActiveSigners(
          blocks[blocks.length - 1].header.number + BigInt(1)
        ),
        [A.address, B.address],
        'address C not added to signers'
      )

          }
  ) */
})
