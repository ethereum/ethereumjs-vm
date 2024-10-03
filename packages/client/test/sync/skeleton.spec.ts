import { createBlock } from '@ethereumjs/block'
import {
  Common,
  Mainnet,
  createCommonFromGethGenesis,
  createCustomCommon,
} from '@ethereumjs/common'
import { equalsBytes, utf8ToBytes } from '@ethereumjs/util'
import { MemoryLevel } from 'memory-level'
import { assert, describe, it } from 'vitest'

import { Chain } from '../../src/blockchain/index.js'
import { Config } from '../../src/config.js'
import { getLogger } from '../../src/logging.js'
import { Skeleton, errReorgDenied, errSyncMerged } from '../../src/sync/index.js'
import { short } from '../../src/util/index.js'
import { wait } from '../integration/util.js'
import { mergeTestnetData } from '../testdata/common/mergeTestnet.js'
import { postMergeData } from '../testdata/geth-genesis/post-merge.js'

import type { Block } from '@ethereumjs/block'
type Subchain = {
  head: bigint
  tail: bigint
}

const common = new Common({ chain: Mainnet })
const block49 = createBlock({ header: { number: 49 } }, { common })
const block49B = createBlock({ header: { number: 49, extraData: utf8ToBytes('B') } }, { common })
const block50 = createBlock({ header: { number: 50, parentHash: block49.hash() } }, { common })
const block50B = createBlock(
  { header: { number: 50, parentHash: block49.hash(), gasLimit: 999 } },
  { common },
)
const block51 = createBlock({ header: { number: 51, parentHash: block50.hash() } }, { common })

describe('[Skeleton]/ startup scenarios ', () => {
  it('starts the chain when starting the skeleton', async () => {
    const config = new Config({
      common,
    })
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    assert.equal(chain.opened, false, 'chain is not started')
    await skeleton.open()
    assert.equal(chain.opened, true, 'chain is opened by skeleton')
  })

  it('throws when reset called before being started', async () => {
    const config = new Config({
      common,
    })
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    assert.equal(chain.opened, false, 'chain is not started')
    try {
      await skeleton.reset()
      assert.fail('should have thrown')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('skeleton reset'), 'throws when skeleton sync not started')
    }
    await skeleton.open()
    assert.equal(skeleton['status'].linked, false)
    skeleton['status'].linked = true
    await skeleton.reset()
    assert.equal(skeleton['status'].linked, false, 'status.linked reset to false')
  })
})

describe('[Skeleton] / initSync', async () => {
  // Tests various sync initializations based on previous leftovers in the database
  // and announced heads.
  interface TestCase {
    name: string
    blocks?: Block[] /** Database content (besides the genesis) */
    oldState?: Subchain[] /** Old sync state with various interrupted subchains */
    head: Block /** New head header to announce to reorg to */
    newState: Subchain[] /** Expected sync state after the reorg */
  }
  const testCases: TestCase[] = [
    // Completely empty database with only the genesis set. The sync is expected
    // to create a single subchain with the requested head.
    {
      name: 'Completely empty database with only the genesis set',
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
    },
    // Completely empty database with only the trivial genesis subchain
    {
      name: 'Completely empty database with only the genesis set',
      oldState: [{ head: BigInt(0), tail: BigInt(0) }],
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
    },
    // Empty database with only the genesis set with a leftover empty sync
    // progress. This is a synthetic case, just for the sake of covering things.
    {
      name: 'Empty database with only the genesis set with a leftover empty sync',
      oldState: [],
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
    },
    // A single leftover subchain is present, older than the new head. The
    // old subchain should be left as is and a new one appended to the sync
    // status.
    {
      name: 'A single leftover subchain is present, older than the new head',
      oldState: [{ head: BigInt(10), tail: BigInt(5) }],
      head: block50,
      newState: [
        { head: BigInt(50), tail: BigInt(50) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
    },
    // Multiple leftover subchains are present, older than the new head. The
    // old subchains should be left as is and a new one appended to the sync
    // status.
    {
      name: 'Multiple leftover subchains are present, older than the new head',
      oldState: [
        { head: BigInt(20), tail: BigInt(15) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
      head: block50,
      newState: [
        { head: BigInt(50), tail: BigInt(50) },
        { head: BigInt(20), tail: BigInt(15) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
    },
    // A single leftover subchain is present, newer than the new head. The
    // newer subchain should be deleted and a fresh one created for the head.
    {
      name: 'A single leftover subchain is present, newer than the new head.',
      oldState: [{ head: BigInt(65), tail: BigInt(60) }],
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
    },
    // Multiple leftover subchain is present, newer than the new head. The
    // newer subchains should be deleted and a fresh one created for the head.
    {
      name: 'Multiple leftover subchain is present, newer than the new head',
      oldState: [
        { head: BigInt(75), tail: BigInt(70) },
        { head: BigInt(65), tail: BigInt(60) },
      ],
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
    },
    // Two leftover subchains are present, one fully older and one fully
    // newer than the announced head. The head should delete the newer one,
    // keeping the older one.
    {
      name: 'Two leftover subchains are present, one fully older and one fully newer',
      oldState: [
        { head: BigInt(65), tail: BigInt(60) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
      head: block50,
      newState: [
        { head: BigInt(50), tail: BigInt(50) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
    },
    // Multiple leftover subchains are present, some fully older and some
    // fully newer than the announced head. The head should delete the newer
    // ones, keeping the older ones.
    {
      name: 'Multiple leftover subchains are present, some fully older and some fully newer',
      oldState: [
        { head: BigInt(75), tail: BigInt(70) },
        { head: BigInt(65), tail: BigInt(60) },
        { head: BigInt(20), tail: BigInt(15) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
      head: block50,
      newState: [
        { head: BigInt(50), tail: BigInt(50) },
        { head: BigInt(20), tail: BigInt(15) },
        { head: BigInt(10), tail: BigInt(5) },
      ],
    },
    // A single leftover subchain is present and the new head is extending
    // it with one more header. We expect the subchain head to be pushed
    // forward.
    {
      name: 'A single leftover subchain is present and the new head is extending',
      blocks: [block49],
      oldState: [{ head: BigInt(49), tail: BigInt(5) }],
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(5) }],
    },
    // A single leftover subchain is present. A new head is announced that
    // links into the middle of it, correctly anchoring into an existing
    // header. We expect the old subchain to be truncated and extended with
    // the new head.
    {
      name: 'Duplicate announcement should not modify subchain',
      blocks: [block49, block50],
      oldState: [{ head: BigInt(100), tail: BigInt(5) }],
      head: block50,
      newState: [{ head: BigInt(100), tail: BigInt(5) }],
    },
    // A single leftover subchain is present. A new head is announced that
    // links into the middle of it, correctly anchoring into an existing
    // header. We expect the old subchain to be truncated and extended with
    // the new head.
    {
      name: 'A new alternate head is announced in the middle should truncate subchain',
      blocks: [block49, block50],
      oldState: [{ head: BigInt(100), tail: BigInt(5) }],
      head: block50B,
      newState: [{ head: BigInt(50), tail: BigInt(5) }],
    },
    // A single leftover subchain is present. A new head is announced that
    // links into the middle of it, but does not anchor into an existing
    // header. We expect the old subchain to be truncated and a new chain
    // be created for the dangling head.
    {
      name: 'The old subchains to be truncated/cleared and a new chain be created for the dangling head',
      blocks: [block49B],
      oldState: [{ head: BigInt(100), tail: BigInt(5) }],
      head: block50,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
    },
  ]
  for (const [testCaseIndex, testCase] of testCases.entries()) {
    it(`${testCase.name}`, async () => {
      const config = new Config({
        common,
        logger: getLogger({ logLevel: 'debug' }),
        accountCache: 10000,
        storageCache: 1000,
      })
      const chain = await Chain.create({ config })
      const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
      await skeleton.open()

      for (const block of testCase.blocks ?? []) {
        await skeleton['putBlock'](block)
      }

      if (testCase.oldState) {
        skeleton['status'].progress.subchains =
          testCase.oldState as Skeleton['status']['progress']['subchains']
      }

      await skeleton.initSync(testCase.head)

      const { progress } = skeleton['status']
      if (progress.subchains.length !== testCase.newState.length) {
        assert.fail(
          `test ${testCaseIndex}: subchain count mismatch: have ${progress.subchains.length}, want ${testCase.newState.length}`,
        )
      }
      for (const [i, subchain] of progress.subchains.entries()) {
        if (subchain.head !== testCase.newState[i].head) {
          assert.fail(
            `test ${testCaseIndex}: subchain head mismatch: have ${subchain.head}, want ${testCase.newState[i].head}`,
          )
        } else if (subchain.tail !== testCase.newState[i].tail) {
          assert.fail(
            `test ${testCaseIndex}: subchain tail mismatch: have ${subchain.tail}, want ${testCase.newState[i].tail}`,
          )
        } else {
          assert.ok(true, `test ${testCaseIndex}: subchain[${i}] matched`)
        }
      }
    })
  }
})

describe('[Skeleton] / setHead', async () => {
  // Tests that a running skeleton sync can be extended with properly linked up
  // headers but not with side chains.
  interface TestCase {
    name: string
    blocks?: Block[] /** Database content (besides the genesis) */
    head: Block /** New head header to announce to reorg to */
    extend: Block /** New head header to announce to extend with */
    force?: boolean /** To force set head not just to extend */
    newState: Subchain[] /** Expected sync state after the reorg */
    err?: Error /** Whether extension succeeds or not */
  }
  const testCases: TestCase[] = [
    // Initialize a sync and try to extend it with a subsequent block.
    {
      name: 'Initialize a sync and try to extend it with a subsequent block',
      head: block49,
      extend: block50,
      force: true,
      newState: [{ head: BigInt(50), tail: BigInt(49) }],
    },
    // Initialize a sync and try to extend it with the existing head block.
    {
      name: 'Initialize a sync and try to extend it with the existing head block',
      blocks: [block49],
      head: block49,
      extend: block49,
      newState: [{ head: BigInt(49), tail: BigInt(49) }],
    },
    // Initialize a sync and try to extend it with a sibling block.
    {
      name: 'Initialize a sync and try to extend it with a sibling block',
      head: block49,
      extend: block49B,
      newState: [{ head: BigInt(49), tail: BigInt(49) }],
      err: errReorgDenied,
    },
    // Initialize a sync and try to extend it with a number-wise sequential
    // header, but a hash wise non-linking one.
    {
      name: 'Initialize a sync and try to extend it with a number-wise sequential alternate block',
      head: block49B,
      extend: block50,
      newState: [{ head: BigInt(49), tail: BigInt(49) }],
      err: errReorgDenied,
    },
    // Initialize a sync and try to extend it with a non-linking future block.
    {
      name: 'Initialize a sync and try to extend it with a non-linking future block',
      head: block49,
      extend: block51,
      newState: [{ head: BigInt(49), tail: BigInt(49) }],
      err: errReorgDenied,
    },
    // Initialize a sync and try to extend it with a past canonical block.
    {
      name: 'Initialize a sync and try to extend it with a past canonical block',
      head: block50,
      extend: block49,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
      err: errReorgDenied,
    },
    // Initialize a sync and try to extend it with a past sidechain block.
    {
      name: 'Initialize a sync and try to extend it with a past sidechain block',
      head: block50,
      extend: block49B,
      newState: [{ head: BigInt(50), tail: BigInt(50) }],
      err: errReorgDenied,
    },
  ]
  for (const [testCaseIndex, testCase] of testCases.entries()) {
    it(`${testCase.name}`, async () => {
      const config = new Config({
        common,

        logger: getLogger({ logLevel: 'debug' }),
        accountCache: 10000,
        storageCache: 1000,
      })
      const chain = await Chain.create({ config })
      const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
      await skeleton.open()
      for (const block of testCase.blocks ?? []) {
        await skeleton['putBlock'](block)
      }

      await skeleton.initSync(testCase.head)

      try {
        await skeleton.setHead(testCase.extend, testCase.force ?? false, false, true)
        if (testCase.err) {
          assert.fail(`test ${testCaseIndex}: should have failed`)
        } else {
          assert.ok(true, `test ${testCaseIndex}: successfully passed`)
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          error = new Error(error)
        }
        if (
          typeof testCase.err?.message === 'string' &&
          (error.message as string).includes(testCase.err.message)
        ) {
          assert.ok(true, `test ${testCaseIndex}: passed with correct error`)
        } else {
          assert.fail(
            `test ${testCaseIndex}: received wrong error expected=${testCase.err?.message} actual=${error.message}`,
          )
        }
      }

      const { progress } = skeleton['status']
      if (progress.subchains.length !== testCase.newState.length) {
        assert.fail(
          `test ${testCaseIndex}: subchain count mismatch: have ${progress.subchains.length}, want ${testCase.newState.length}`,
        )
      }
      for (const [i, subchain] of progress.subchains.entries()) {
        if (subchain.head !== testCase.newState[i].head) {
          assert.fail(
            `test ${testCaseIndex}: subchain head mismatch: have ${subchain.head}, want ${testCase.newState[i].head}`,
          )
        } else if (subchain.tail !== testCase.newState[i].tail) {
          assert.fail(
            `test ${testCaseIndex}: subchain tail mismatch: have ${subchain.tail}, want ${testCase.newState[i].tail}`,
          )
        } else {
          assert.ok(true, `test ${testCaseIndex}: subchain[${i}] matched`)
        }
      }
    })
  }

  it(`skeleton init should throw error if merge not set`, async () => {
    const genesis = {
      ...postMergeData,
      config: {
        ...postMergeData.config,
        // skip the merge hardfork
        terminalTotalDifficulty: undefined,
        clique: undefined,
        ethash: {},
      },
      extraData: '0x00000000000000000',
      difficulty: '0x1',
    }
    const common = createCommonFromGethGenesis(genesis, { chain: 'merge-not-set' })
    const config = new Config({ common })
    const chain = await Chain.create({ config })
    ;(chain.blockchain['_validateBlocks'] as any) = false
    try {
      new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    } catch (e) {
      assert.ok(true, `Skeleton init should error if merge not set`)
    }
  })

  it('should init/setHead properly from genesis', async () => {
    const config = new Config({ common })
    const chain = await Chain.create({ config })
    ;(chain.blockchain['_validateBlocks'] as any) = false
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    await chain.open()

    const genesis = await chain.getBlock(BigInt(0))
    const block1 = createBlock(
      { header: { number: 1, parentHash: genesis.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block2 = createBlock(
      { header: { number: 2, parentHash: block1.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block3 = createBlock(
      { header: { number: 3, difficulty: 100 } },
      { common, setHardfork: true },
    )

    await skeleton.open()
    let reorg

    reorg = await skeleton.initSync(genesis)
    assert.equal(reorg, false, 'should not reorg on genesis init')

    reorg = await skeleton.setHead(genesis, false)
    assert.equal(reorg, false, 'should not reorg on genesis announcement')

    reorg = await skeleton.setHead(genesis, true)
    assert.equal(reorg, false, 'should not reorg on genesis setHead')

    assert.equal(
      skeleton['status'].progress.subchains.length,
      1,
      'trivial subchain0 should have been created',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0]!.head,
      BigInt(0),
      'trivial subchain0 should have been created',
    )

    try {
      await skeleton.putBlocks([block1])
      assert.fail('should have not allowed putBlocks since no subchain set')
    } catch (_e) {
      assert.ok(true, 'should not allow putBlocks since no subchain set')
    }
    assert.equal(chain.blocks.height, BigInt(0), 'canonical height should be at genesis')

    reorg = await skeleton.setHead(block1, false)
    assert.equal(reorg, false, 'should not reorg on valid first block')
    assert.equal(
      skeleton['status'].progress.subchains.length,
      1,
      'trivial subchain should have been created',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0]!.head,
      BigInt(0),
      'trivial subchain0 should have been created',
    )

    reorg = await skeleton.setHead(block1, true)
    assert.equal(reorg, false, 'should not reorg on valid first block')
    assert.equal(
      skeleton['status'].progress.subchains.length,
      1,
      'subchain should have been created',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0].head,
      BigInt(1),
      'head should be set to first block',
    )
    assert.equal(skeleton.isLinked(), true, 'subchain status should be linked')

    reorg = await skeleton.setHead(block2, true)
    assert.equal(reorg, false, 'should not reorg on valid second block')
    assert.equal(skeleton['status'].progress.subchains.length, 1, 'subchain should be same')
    assert.equal(
      skeleton['status'].progress.subchains[0].head,
      BigInt(2),
      'head should be set to first block',
    )
    assert.equal(skeleton.isLinked(), true, 'subchain status should stay linked')

    reorg = await skeleton.setHead(block3, false)
    assert.equal(reorg, true, 'should not extend on invalid third block')
    // since its not a forced update so shouldn't affect subchain status
    assert.equal(skeleton['status'].progress.subchains.length, 1, 'subchain should be same')
    assert.equal(
      skeleton['status'].progress.subchains[0].head,
      BigInt(2),
      'head should be set to second block',
    )
    assert.equal(skeleton.isLinked(), true, 'subchain status should stay linked')

    reorg = await skeleton.setHead(block3, true)
    assert.equal(reorg, true, 'should not extend on invalid third block')
    // since its not a forced update so shouldn't affect subchain status
    assert.equal(skeleton['status'].progress.subchains.length, 2, 'new subchain should be created')
    assert.equal(
      skeleton['status'].progress.subchains[0].head,
      BigInt(3),
      'head should be set to third block',
    )
    assert.equal(skeleton.isLinked(), false, 'subchain status should not be linked anymore')
  })

  it('should fill the canonical chain after being linked to genesis', async () => {
    const config = new Config({ common, logger: getLogger({ logLevel: 'debug' }) })
    const chain = await Chain.create({ config })
    ;(chain.blockchain['_validateBlocks'] as any) = false
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    await chain.open()

    const genesis = await chain.getBlock(BigInt(0))
    const block1 = createBlock(
      { header: { number: 1, parentHash: genesis.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block2 = createBlock(
      { header: { number: 2, parentHash: block1.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block3 = createBlock(
      { header: { number: 3, parentHash: block2.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block4 = createBlock(
      { header: { number: 4, parentHash: block3.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block5 = createBlock(
      { header: { number: 5, parentHash: block4.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )

    await skeleton.open()

    await skeleton.initSync(block4)
    await skeleton.putBlocks([block3, block2])
    assert.equal(chain.blocks.height, BigInt(0), 'canonical height should be at genesis')
    await skeleton.putBlocks([block1])
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(4),
      'canonical height should update after being linked',
    )
    await skeleton.setHead(block5, false)
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(4),
      'canonical height should not change when setHead is set with force=false',
    )
    await skeleton.setHead(block5, true)
    await skeleton.blockingFillWithCutoff(10)
    await wait(200)

    assert.equal(
      chain.blocks.height,
      BigInt(5),
      'canonical height should change when setHead is set with force=true',
    )

    // unlink the skeleton for the below check to check all blocks cleared
    skeleton['status'].linked = false
    for (const block of [block1, block2, block3, block4, block5]) {
      assert.equal(
        (await skeleton.getBlock(block.header.number, true))?.hash(),
        undefined,
        `skeleton block number=${block.header.number} should be cleaned up after filling canonical chain`,
      )
      assert.equal(
        (await skeleton.getBlockByHash(block.hash(), true))?.hash(),
        undefined,
        `skeleton block hash=${short(
          block.hash(),
        )} should be cleaned up after filling canonical chain`,
      )
    }
  })

  it('should fill the canonical chain after being linked to a canonical block past genesis', async () => {
    const config = new Config({ common, engineNewpayloadMaxExecute: 10 })
    const chain = await Chain.create({ config })
    ;(chain.blockchain['_validateBlocks'] as any) = false

    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    await chain.open()
    await skeleton.open()

    const genesis = await chain.getBlock(BigInt(0))

    const block1 = createBlock(
      { header: { number: 1, parentHash: genesis.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block2 = createBlock(
      { header: { number: 2, parentHash: block1.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block3 = createBlock(
      { header: { number: 3, parentHash: block2.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block4 = createBlock(
      { header: { number: 4, parentHash: block3.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block5 = createBlock(
      { header: { number: 5, parentHash: block4.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )

    await chain.putBlocks([block1, block2])
    await skeleton.initSync(block4)
    assert.equal(chain.blocks.height, BigInt(2), 'canonical height should be at block 2')
    await skeleton.putBlocks([block3])
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(4),
      'canonical height should update after being linked',
    )
    await skeleton.setHead(block5, false)
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(4),
      'canonical height should not change when setHead with force=false',
    )

    // test sethead and blockingFillWithCutoff true via forkchoice update
    await skeleton.forkchoiceUpdate(block5)

    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(5),
      'canonical height should change when setHead with force=true',
    )

    // unlink the skeleton for the below check to check all blocks cleared
    const prevLinked = skeleton['status'].linked
    skeleton['status'].linked = false
    for (const block of [block3, block4, block5]) {
      assert.equal(
        (await skeleton.getBlock(block.header.number, true))?.hash(),
        undefined,
        `skeleton block number=${block.header.number} should be cleaned up after filling canonical chain`,
      )
      assert.equal(
        (await skeleton.getBlockByHash(block.hash(), true))?.hash(),
        undefined,
        `skeleton block hash=${short(
          block.hash(),
        )} should be cleaned up after filling canonical chain`,
      )
    }
    // restore linkedStatus
    skeleton['status'].linked = prevLinked

    const block41 = createBlock(
      { header: { number: 4, parentHash: block3.hash(), difficulty: 101 } },
      { common, setHardfork: true },
    )
    const block51 = createBlock(
      { header: { number: 5, parentHash: block41.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block61 = createBlock(
      { header: { number: 6, parentHash: block51.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )

    await skeleton.setHead(block41, false)
    await skeleton.setHead(block51, false)

    // should link the chains including the 41, 51 block backfilled from the unfinalized
    await skeleton.forkchoiceUpdate(block61)
    assert.equal(
      skeleton['status'].progress.subchains[0]?.head,
      BigInt(6),
      'head should be correct',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0]?.tail,
      BigInt(4),
      'tail should be backfilled',
    )
    assert.equal(skeleton['status'].linked, true, 'should be linked')
    assert.equal(chain.blocks.height, BigInt(6), 'all blocks should be in chain')

    const block71 = createBlock(
      { header: { number: 7, parentHash: block61.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block81 = createBlock(
      { header: { number: 8, parentHash: block71.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )
    const block91 = createBlock(
      { header: { number: 9, parentHash: block81.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )

    // lets jump ahead and add the block 81 and 71 with announcements and trigger tryTailBackfill
    await skeleton.forkchoiceUpdate(block91)
    assert.equal(skeleton['status'].progress.subchains.length, 1, '1 subchain with older dropped')
    assert.equal(
      skeleton['status'].progress.subchains[0]?.head,
      BigInt(9),
      'head should be correct',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0]?.tail,
      BigInt(9),
      'new subchain should be created',
    )
    await skeleton.setHead(block81, false)
    await skeleton.setHead(block71, false)
    await skeleton.tryTailBackfill()

    assert.equal(
      skeleton['status'].progress.subchains[0]?.head,
      BigInt(9),
      'head should be correct',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0]?.tail,
      BigInt(7),
      'tail should be backfilled',
    )
    assert.equal(skeleton['status'].linked, true, 'should be linked')
    // async wait needed here so the async fillCanonicalChain can fill the chain
    await wait(50)
    assert.equal(chain.blocks.height, BigInt(9), 'all blocks should be in chain')
    assert.equal(
      equalsBytes(chain.blocks.latest!.hash(), block91.hash()),
      true,
      'correct head hash',
    )

    // do a very common reorg that happens in a network: reorged head block
    const block92 = createBlock(
      { header: { number: 9, parentHash: block81.hash(), difficulty: 101 } },
      { common, setHardfork: true },
    )
    const block102 = createBlock(
      { header: { number: 10, parentHash: block92.hash(), difficulty: 100 } },
      { common, setHardfork: true },
    )

    await skeleton.forkchoiceUpdate(block92)
    assert.equal(
      skeleton['status'].progress.subchains[0]?.head,
      BigInt(9),
      'head number should be same',
    )
    assert.equal(
      skeleton['status'].progress.subchains[0]?.tail,
      BigInt(9),
      'tail should be truncated to head',
    )
    assert.equal(
      equalsBytes(chain.blocks.latest!.hash(), block92.hash()),
      true,
      'correct reorged head hash',
    )

    // should be able to build on top of the next block
    await skeleton.forkchoiceUpdate(block102)
    assert.equal(
      equalsBytes(chain.blocks.latest!.hash(), block102.hash()),
      true,
      'continue reorged chain',
    )
  })

  it('should abort filling the canonical chain if the terminal block is invalid', async () => {
    const common = createCustomCommon(mergeTestnetData, Mainnet)
    common.setHardforkBy({ blockNumber: BigInt(0) })
    const config = new Config({
      common,
      accountCache: 10000,
      storageCache: 1000,
    })
    const chain = await Chain.create({ config })
    ;(chain.blockchain['_validateBlocks'] as any) = false
    await chain.open()
    const genesisBlock = await chain.getBlock(BigInt(0))

    const block1 = createBlock(
      { header: { number: 1, parentHash: genesisBlock.hash(), difficulty: 100 } },
      { common },
    )
    const block2 = createBlock(
      { header: { number: 2, parentHash: block1.hash(), difficulty: 100 } },
      { common },
    )
    const block3PoW = createBlock(
      { header: { number: 3, parentHash: block2.hash(), difficulty: 100 } },
      { common },
    )
    const block3PoS = createBlock(
      { header: { number: 3, parentHash: block2.hash(), difficulty: 0 } },
      { common, setHardfork: true },
    )
    const block4InvalidPoS = createBlock(
      { header: { number: 4, parentHash: block3PoW.hash(), difficulty: 0 } },
      { common, setHardfork: true },
    )
    const block4PoS = createBlock(
      { header: { number: 4, parentHash: block3PoS.hash(), difficulty: 0 } },
      { common, setHardfork: true },
    )
    const block5 = createBlock(
      { header: { number: 5, parentHash: block4PoS.hash(), difficulty: 0 } },
      { common, setHardfork: true },
    )

    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    await skeleton.open()

    await skeleton.initSync(block4InvalidPoS)
    await skeleton.putBlocks([block3PoW, block2])
    assert.equal(chain.blocks.height, BigInt(0), 'canonical height should be at genesis')
    await skeleton.putBlocks([block1])
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(2),
      'canonical height should stop at block 2 (valid terminal block), since block 3 is invalid (past ttd)',
    )
    try {
      await skeleton.setHead(block5, false)
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if (error !== errReorgDenied) {
        assert.fail(error)
      }
    }
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(2),
      'canonical height should not change when setHead is set with force=false',
    )
    // Put correct chain
    await skeleton.initSync(block4PoS)
    try {
      await skeleton.putBlocks([block3PoS])
    } catch (error) {
      if (!(error instanceof Error)) {
        error = new Error(error)
      }
      if (error !== errSyncMerged) {
        assert.fail(error)
      }
    }
    await wait(200)
    assert.equal(
      chain.blocks.height,
      BigInt(4),
      'canonical height should now be at head with correct chain',
    )
    const latestHash = chain.headers.latest?.hash()
    assert.ok(
      latestHash !== undefined && equalsBytes(latestHash, block4PoS.hash()),
      'canonical height should now be at head with correct chain',
    )
    await skeleton.setHead(block5, true)
    await wait(200)
    assert.equal(skeleton.bounds().head, BigInt(5), 'should update to new height')
  })
})
