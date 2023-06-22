import {
  bytesToHex,
  bytesToPrefixedHexString,
  bytesToUtf8,
  equalsBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { createHash } from 'crypto'
import debug from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { assert, describe, it } from 'vitest'

import { ROOT_DB_KEY, Trie } from '../../src/index.js'

import type { BatchDBOp } from '@ethereumjs/util'

describe('testing checkpoints', () => {
  let trie: Trie
  let trieCopy: Trie
  let preRoot: string
  let postRoot: string

  it('setup', async () => {
    trie = new Trie()
    await trie.put(utf8ToBytes('do'), utf8ToBytes('verb'))
    await trie.put(utf8ToBytes('doge'), utf8ToBytes('coin'))
    preRoot = bytesToHex(trie.root())
  })

  it('should copy trie and get value added to original trie', async () => {
    trieCopy = trie.copy()
    assert.equal(
      bytesToHex(trieCopy.root()),
      preRoot,
      'trie copy should have same root as original trie'
    )
    const res = await trieCopy.get(utf8ToBytes('do'))
    assert.deepEqual(res, utf8ToBytes('verb'), 'should get value from trie copy')
  })

  it('should deactivate cache on copy()', async () => {
    const trie = new Trie({ cacheSize: 100 })
    trieCopy = trie.copy()
    assert.equal((trieCopy as any)._opts.cacheSize, 0)
  })

  it('should create a checkpoint', () => {
    trie.checkpoint()
    assert.equal(trie.checkpoints.length, 1, 'should have one checkpoint')
    assert.ok(trie.hasCheckpoints())
  })

  it('should save to the cache', async () => {
    await trie.put(utf8ToBytes('test'), utf8ToBytes('something'))
    await trie.put(utf8ToBytes('love'), utf8ToBytes('emotion'))
    postRoot = bytesToHex(trie.root())
  })

  it('should get values from before checkpoint', async () => {
    const res = await trie.get(utf8ToBytes('doge'))
    assert.deepEqual(utf8ToBytes('coin'), res!, 'trie.get(doge) should return "coin"')
  })

  it('should get values from cache', async () => {
    const res = await trie.get(utf8ToBytes('love'))
    assert.ok(equalsBytes(utf8ToBytes('emotion'), res!))
  })

  it('should copy trie and get upstream and cache values after checkpoint', async () => {
    trieCopy = trie.copy()
    assert.equal(bytesToHex(trieCopy.root()), postRoot)
    assert.equal(trieCopy.checkpoints.length, 1)
    assert.ok(trieCopy.hasCheckpoints())
    const res = await trieCopy.get(utf8ToBytes('do'))
    assert.deepEqual(res, utf8ToBytes('verb'), 'trieCopy.get(do) should return "verb"')
    const res2 = await trieCopy.get(utf8ToBytes('love'))
    assert.deepEqual(res2, utf8ToBytes('emotion'), 'trieCopy.get(love) should return "emotion"')
  })

  it('should copy trie and use the correct hash function', async () => {
    const trie = new Trie({
      useKeyHashing: true,
      secure: true,
      hashFunction: (value) => createHash('sha256').update(value).digest(),
    })
    await trie.put(utf8ToBytes('key1'), utf8ToBytes('value1'))
    trie.checkpoint()
    assert.equal(trie.checkpoints.length, 1, 'Trie should have 1 checkpoint')
    await trie.put(utf8ToBytes('key2'), utf8ToBytes('value2'))
    const trieCopy = trie.copy()

    assert.equal(
      bytesToHex(trieCopy.root()),
      bytesToHex(trie.root()),
      'trieCopy.root() should equal root'
    )

    const value = await trieCopy.get(utf8ToBytes('key1'))
    assert.equal(bytesToUtf8(value!), 'value1')
  })

  it('should revert to the original root', async () => {
    assert.ok(trie.hasCheckpoints())
    assert.equal(trie.checkpoints.length, 1, 'Trie should have 1 remaining checkpoint')
    await trie.revert()
    assert.equal(bytesToHex(trie.root()), preRoot)
    assert.equal(trie.checkpoints.length, 0, 'Trie should have no remaining checkpoints')
    assert.notOk(trie.hasCheckpoints())
  })

  it('should not get values from cache after revert', async () => {
    const res = await trie.get(utf8ToBytes('love'))
    assert.notOk(res)
  })

  it('should commit a checkpoint', async () => {
    trie.checkpoint()
    await trie.put(utf8ToBytes('test'), utf8ToBytes('something'))
    await trie.put(utf8ToBytes('love'), utf8ToBytes('emotion'))
    postRoot = bytesToHex(trie.root())
    await trie.commit()
    assert.equal(trie.hasCheckpoints(), false)
    assert.equal(bytesToHex(trie.root()), postRoot)
  })

  it('should get new values after commit', async () => {
    const res = await trie.get(utf8ToBytes('love'))
    assert.ok(equalsBytes(utf8ToBytes('emotion'), res!))
  })

  it('should commit a nested checkpoint', async () => {
    trie.checkpoint()
    await trie.put(utf8ToBytes('test'), utf8ToBytes('something else'))
    const root = trie.root()
    trie.checkpoint()
    await trie.put(utf8ToBytes('the feels'), utf8ToBytes('emotion'))
    await trie.revert()
    await trie.commit()
    assert.equal(trie.hasCheckpoints(), false)
    assert.deepEqual(trie.root(), root)
    assert.equal(bytesToPrefixedHexString(trie.root()), bytesToPrefixedHexString(root))
  })

  const k1 = utf8ToBytes('k1')
  const v1 = utf8ToBytes('v1')
  const v12 = utf8ToBytes('v12')
  const v123 = utf8ToBytes('v123')

  it('revert -> put', async () => {
    trie = new Trie()

    trie.checkpoint()
    await trie.put(k1, v1)
    assert.deepEqual(await trie.get(k1), v1, 'before revert: v1 in trie')
    await trie.revert()
    assert.deepEqual(await trie.get(k1), null, 'after revert: v1 removed')
  })

  it('revert -> put (update)', async () => {
    trie = new Trie()

    await trie.put(k1, v1)
    assert.deepEqual(await trie.get(k1), v1, 'before CP: v1')
    trie.checkpoint()
    await trie.put(k1, v12)
    await trie.put(k1, v123)
    await trie.revert()
    assert.deepEqual(await trie.get(k1), v1, 'after revert: v1')
  })

  it('revert -> put (update) batched', async () => {
    const trie = new Trie()
    await trie.put(k1, v1)
    assert.deepEqual(await trie.get(k1), v1, 'before CP: v1')
    trie.checkpoint()
    const ops = [
      { type: 'put', key: k1, value: v12 },
      { type: 'put', key: k1, value: v123 },
    ] as BatchDBOp[]
    await trie.batch(ops)
    await trie.revert()
    assert.deepEqual(await trie.get(k1), v1, 'after revert: v1')
  })

  it('Checkpointing: revert -> del', async () => {
    const trie = new Trie()
    await trie.put(k1, v1)
    assert.deepEqual(await trie.get(k1), v1, 'before CP: v1')
    trie.checkpoint()
    await trie.del(k1)
    assert.deepEqual(await trie.get(k1), null, 'before revert: null')
    await trie.revert()
    assert.deepEqual(await trie.get(k1), v1, 'after revert: v1')
  })

  it('Checkpointing: nested checkpoints -> commit -> revert', async () => {
    const trie = new Trie()
    await trie.put(k1, v1)
    assert.deepEqual(await trie.get(k1), v1, 'before CP: v1')
    trie.checkpoint()
    await trie.put(k1, v12)
    trie.checkpoint()
    await trie.put(k1, v123)
    await trie.commit()
    assert.deepEqual(await trie.get(k1), v123, 'after commit (second CP): v123')
    await trie.revert()
    assert.deepEqual(await trie.get(k1), v1, 'after revert (first CP): v1')
  })

  /*
    In this educational example, it is shown how operations on a clone of a trie
    can be copied into the original trie. This also includes pruning.
    A practical use-case of this could be to take two clones of a trie
    and apply different operations on it. Based on the outcome, pick one.
    If this "checkpoint copy trick" (see test for this "trick") is not used,
    one has to keep track of what key/values are changed and then re-apply these
    on the trie again. However, by copying the checkpoint, one can immediately
    update the original trie (have to manually copy the root after applying the checkpoint, too).
    This test also implicitly checks that on copying a Trie, the checkpoints are deep-copied.
    If it would not deep copy, then some checks in this test will fail.
    See PR 2203 and 2236.
  */
  it('Checkpointing: nested checkpoints -> with pruning, verify that checkpoints are deep-copied', async () => {
    const KEY = utf8ToBytes('last_block_height')
    const KEY_ROOT = keccak256(ROOT_DB_KEY)

    // Initialise State
    const CommittedState = new Trie({
      secure: true,
      useNodePruning: true,
      persistent: true,
      debug: debug('eth-state:committed-state'),
    })

    // Put some initial data
    await CommittedState.put(KEY, utf8ToBytes('1'))

    // Take a checkpoint to enable nested checkpoints
    // From this point, CommittedState will not write on disk
    CommittedState.checkpoint()

    // Copy CommittedState
    const MemoryState = CommittedState.copy()
    MemoryState.checkpoint()

    // Test changes on MemoryState
    await MemoryState.put(KEY, utf8ToBytes('2'))
    await MemoryState.commit()
    // The CommittedState should not change (not the key/value pairs, not the root, and not the root in DB)
    assert.equal(bytesToUtf8((await CommittedState.get(KEY))!), '1')
    const dbRoot = await CommittedState.database().get(KEY_ROOT)
    if (dbRoot !== undefined) {
      // dbRoot = dbRoot instanceof Uint8Array ? bytesToHex(dbRoot) : dbRoot
      assert.equal(
        dbRoot.toString(),
        '0x77ddd505d2a5b76a2a6ee34b827a0d35ca19f8d358bee3d74a84eab59794487c'
      )
    } else {
      assert.fail(`DB_ROOT_KEY ${bytesToPrefixedHexString(KEY_ROOT)} not found in DB`)
    }
    assert.equal(
      bytesToHex(CommittedState.root()),
      '77ddd505d2a5b76a2a6ee34b827a0d35ca19f8d358bee3d74a84eab59794487c'
    )

    // From MemoryState, now take the final checkpoint
    const finalCheckpoint = (<any>MemoryState).checkpoints[0]
    // Insert this into CommittedState
    ;(<any>CommittedState).checkpoints.push(finalCheckpoint)

    // Now all operations done on MemoryState (including pruning) can be
    // committed into CommittedState
    await CommittedState.commit()
    // Flush items to disk
    await CommittedState.commit()
    // Update the root (this information is not fed via the checkpoint, have to do this manually)
    CommittedState.root(MemoryState.root())
    await CommittedState.storeNode(await MemoryState.rootNode())
    // Setting the root does not automatically persist the root, so persist it
    await CommittedState.persistRoot(CommittedState.keySecure(ROOT_DB_KEY))

    // Make sure CommittedState looks like we expect (2 keys, last_block_height=2 + __root__)
    // I.e. the trie is pruned.

    assert.deepEqual(
      [...(await CommittedState.database().values())].map((value) => bytesToHex(value)),
      [
        'd7eba6ee0f011acb031b79554d57001c42fbfabb150eb9fdd3b6d434f7b791eb',
        'e3a1202418cf7414b1e6c2c8d92b4673eecdb4aac88f7f58623e3be903aefb2fd4655c32',
      ]
    )
    // Verify that the key is updated
    assert.equal(bytesToUtf8((await CommittedState.get(KEY))!), '2')
  })
})
