import { createBlock, createBlockFromRLP } from '@ethereumjs/block'
import { EthashConsensus, createBlockchain } from '@ethereumjs/blockchain'
import { ConsensusAlgorithm } from '@ethereumjs/common'
import { Ethash } from '@ethereumjs/ethash'
import { RLP } from '@ethereumjs/rlp'
import { Caches, MerkleStateManager } from '@ethereumjs/statemanager'
import { MerklePatriciaTrie } from '@ethereumjs/trie'
import { createTxFromRLP } from '@ethereumjs/tx'
import {
  MapDB,
  bytesToBigInt,
  bytesToHex,
  hexToBytes,
  isHexString,
  stripHexPrefix,
  toBytes,
} from '@ethereumjs/util'

import { buildBlock, createVM, runBlock } from '../../../src/index.js'
import { setupPreConditions, verifyPostConditions } from '../../util.js'

import type { Block } from '@ethereumjs/block'
import type { Blockchain, ConsensusDict } from '@ethereumjs/blockchain'
import type { Common } from '@ethereumjs/common'
import type { PrefixedHexString } from '@ethereumjs/util'
import type * as tape from 'tape'

function formatBlockHeader(data: any) {
  const formatted: any = {}
  for (const [key, value] of Object.entries(data) as [string, string][]) {
    formatted[key] = isHexString(value) ? value : BigInt(value)
  }
  return formatted
}

export async function runBlockchainTest(options: any, testData: any, t: tape.Test) {
  // ensure that the test data is the right fork data
  if (testData.network !== options.forkConfigTestSuite) {
    t.comment(`skipping test: no data available for ${options.forkConfigTestSuite}`)
    return
  }

  // fix for BlockchainTests/GeneralStateTests/stRandom/*
  testData.lastblockhash = stripHexPrefix(testData.lastblockhash)

  let common = options.common.copy() as Common
  common.setHardforkBy({ blockNumber: 0 })

  let cacheDB = new MapDB()
  let state = new MerklePatriciaTrie({ useKeyHashing: true, common })
  let stateManager = new MerkleStateManager({
    caches: new Caches(),
    trie: state,
    common,
  })

  let validatePow = false
  // Only run with block validation when sealEngine present in test file
  // and being set to Ethash PoW validation
  if (testData.sealEngine === 'Ethash') {
    if (common.consensusAlgorithm() !== ConsensusAlgorithm.Ethash) {
      t.skip('SealEngine setting is not matching chain consensus type, skip test.')
    }
    validatePow = true
  }

  // create and add genesis block
  const header = formatBlockHeader(testData.genesisBlockHeader)
  const withdrawals = common.isActivatedEIP(4895) ? [] : undefined
  const blockData = { header, withdrawals }
  const genesisBlock = createBlock(blockData, { common })

  if (typeof testData.genesisRLP === 'string') {
    const rlp = toBytes(testData.genesisRLP)
    t.deepEquals(genesisBlock.serialize(), rlp, 'correct genesis RLP')
  }

  const consensusDict: ConsensusDict = {}
  consensusDict[ConsensusAlgorithm.Ethash] = new EthashConsensus(new Ethash())
  let blockchain = await createBlockchain({
    common,
    validateBlocks: true,
    validateConsensus: validatePow,
    consensusDict,
    genesisBlock,
  })

  if (validatePow) {
    ;(blockchain.consensus as EthashConsensus)._ethash!.cacheDB = cacheDB as any
  }

  const begin = Date.now()

  const evmOpts = {
    bls: options.bls,
    bn254: options.bn254,
  }
  let vm = await createVM({
    stateManager,
    blockchain,
    common,
    setHardfork: true,
    evmOpts,
    profilerOpts: {
      reportAfterBlock: options.profile,
    },
  })

  // set up pre-state
  await setupPreConditions(vm.stateManager, testData)

  t.deepEquals(
    await vm.stateManager.getStateRoot(),
    genesisBlock.header.stateRoot,
    'correct pre stateRoot',
  )

  async function handleError(error: string | undefined, expectException: string | boolean) {
    if (expectException !== false) {
      t.pass(`Expected exception ${expectException}`)
    } else {
      t.fail(error)
    }
  }

  let currentBlock = BigInt(0)
  for (const raw of testData.blocks) {
    const paramFork = `expectException${options.forkConfigTestSuite}`
    // Two naming conventions in ethereum/tests to indicate "exception occurs on all HFs" semantics
    // Last checked: ethereumjs-testing v1.3.1 (2020-05-11)
    const paramAll1 = 'expectExceptionALL'
    const paramAll2 = 'expectException'
    const expectException = (raw[paramFork] ??
      raw[paramAll1] ??
      raw[paramAll2] ??
      raw.blockHeader === undefined) as PrefixedHexString | boolean

    // Here we decode the rlp to extract the block number
    // The block library cannot be used, as this throws on certain EIP1559 blocks when trying to convert
    try {
      const blockRlp = hexToBytes(raw.rlp as PrefixedHexString)
      const decodedRLP: any = RLP.decode(Uint8Array.from(blockRlp))
      currentBlock = bytesToBigInt(decodedRLP[0][8])
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      await handleError(e, expectException)
      continue
    }

    try {
      const blockRlp = hexToBytes(raw.rlp as PrefixedHexString)
      // Update common HF
      let timestamp: bigint | undefined = undefined
      try {
        const decoded: any = RLP.decode(blockRlp)
        timestamp = bytesToBigInt(decoded[0][11])
        // eslint-disable-next-line no-empty
      } catch (e) {}

      common.setHardforkBy({ blockNumber: currentBlock, timestamp })

      // transactionSequence is provided when txs are expected to be rejected.
      // To run this field we try to import them on the current state.
      if (raw.transactionSequence !== undefined) {
        const parentBlock = await (vm.blockchain as Blockchain).getIteratorHead()
        const blockBuilder = await buildBlock(vm, {
          parentBlock,
          blockOpts: { calcDifficultyFromHeader: parentBlock.header },
        })

        for (const txData of raw.transactionSequence as Record<
          'exception' | 'rawBytes' | 'valid',
          string
        >[]) {
          const shouldFail = txData.valid === 'false'
          try {
            const txRLP = hexToBytes(txData.rawBytes as PrefixedHexString)
            const tx = createTxFromRLP(txRLP, { common })
            await blockBuilder.addTransaction(tx)
            if (shouldFail) {
              t.fail('tx should fail, but did not fail')
            }
          } catch (e) {
            if (!(e instanceof Error)) {
              e = new Error(e)
            }
            if (!shouldFail) {
              t.fail(`tx should not fail, but failed: ${e.message}`)
            } else {
              t.pass('tx successfully failed')
            }
          }
        }
        await blockBuilder.revert() // will only revert if checkpointed
      }

      const block = createBlockFromRLP(blockRlp, { common, setHardfork: true })
      await blockchain.putBlock(block)

      // This is a trick to avoid generating the canonical genesis
      // state. Generating the genesis state is not needed because
      // blockchain tests come with their own `pre` world state.
      // TODO: Add option to `runBlockchain` not to generate genesis state.
      //
      //vm.common.genesis().stateRoot = await vm.stateManager.getStateRoot()
      try {
        await blockchain.iterator('vm', async (block: Block) => {
          const parentBlock = await blockchain!.getBlock(block.header.parentHash)
          const parentState = parentBlock.header.stateRoot
          // run block, update head if valid
          try {
            await runBlock(vm, { block, root: parentState, setHardfork: true })
            // set as new head block
          } catch (error) {
            if (!(error instanceof Error)) {
              error = new Error(error)
            }
            // remove invalid block
            await blockchain!.delBlock(block.header.hash())
            throw error
          }
        })
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        // if the test fails, then block.header is the prev because
        // vm.runBlock has a check that prevents the actual postState from being
        // imported if it is not equal to the expected postState. it is useful
        // for debugging to skip this, so that verifyPostConditions will compare
        // testData.postState to the actual postState, rather than to the preState.
        if (options.debug !== true) {
          // make sure the state is set before checking post conditions
          const headBlock = await (vm.blockchain as Blockchain).getIteratorHead()
          await vm.stateManager.setStateRoot(headBlock.header.stateRoot)
        } else {
          await verifyPostConditions(state, testData.postState, t)
        }

        throw e
      }

      if (expectException !== false) {
        t.fail(`expected exception but test did not throw an exception: ${expectException}`)
        return
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      // caught an error, reduce block number
      currentBlock--
      await handleError(error, expectException)
    }
  }

  t.equal(
    bytesToHex((blockchain as any)._headHeaderHash),
    '0x' + testData.lastblockhash,
    'correct last header block',
  )

  const end = Date.now()
  const timeSpent = `${(end - begin) / 1000} secs`
  t.comment(`Time: ${timeSpent}`)

  // @ts-ignore Explicitly delete objects for memory optimization (early GC)
  common = blockchain = state = stateManager = vm = cacheDB = null // eslint-disable-line
}
