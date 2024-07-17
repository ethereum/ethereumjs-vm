import {
  bytesToHex,
  bytesToUnprefixedHex,
  hexToBytes,
  randomBytes,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Trie } from '../../src/index.js'
import { orderBatch } from '../../src/util/nibbles.js'

import type { BatchDBOp } from '@ethereumjs/util'

describe('trie._updateNode', async () => {
  const keyvals = Array.from({ length: 200 }, () => {
    return [randomBytes(20), randomBytes(32)]
  })
  const testKeyVal = [randomBytes(20), randomBytes(32)]
  const trie_1 = new Trie()
  const trie_2 = new Trie()
  for (const [key, val] of keyvals) {
    await trie_1.put(key, val)
    await trie_2.put(key, val)
  }
  const root_1A = bytesToHex(trie_1.root())
  const root_2A = bytesToHex(trie_2.root())
  it('should create identical tries', () => {
    assert.equal(root_1A, root_2A, 'roots should match')
  })
  await trie_1.put(testKeyVal[0], testKeyVal[1])
  const root_1B = bytesToHex(trie_1.root())
  it('root should change after put', () => {
    assert.notEqual(root_1A, root_1B, 'root should change')
  })
  const { remaining, stack, node } = await trie_1.findPath(testKeyVal[0])
  const _stack = [...stack]
  it('should find new node after put', () => {
    assert.deepEqual(node?.value(), testKeyVal[1], 'node should match')
  })
  await trie_2['_updateNode'](testKeyVal[0], testKeyVal[1], remaining, stack)
  it('_updateNode should change stack', () => {
    assert.notEqual(_stack, stack, 'stacks should change')
  })
  const root2B = bytesToHex(trie_2.root())
  it('should update trie', () => {
    assert.equal(root_1B, root2B, 'tries should match')
  })
})

describe('Nibble Order', async () => {
  const testNibbles = [
    [0, 1, 2, 3, 4, 10],
    [0, 1, 2, 3, 3, 10],
    [0, 1, 2, 3, 2, 10],
    [0, 1, 2, 2, 4, 10],
    [0, 1, 2, 2, 3, 10],
    [1, 1, 0, 3, 4, 10],
    [2, 1, 0, 3, 4, 10],
    [0, 1, 0, 3, 4, 10],
  ]
  const nibbleStrings = testNibbles.map((t) => {
    return t.map((n) => n.toString(16)).join('')
  })
  const keys = nibbleStrings.map((str) => unprefixedHexToBytes(str))
  for (const [i, k] of keys.entries()) {
    it('should be matching', () => {
      assert.equal(bytesToUnprefixedHex(k), nibbleStrings[i], 'nibble string should match')
    })
  }
  const batchOP: BatchDBOp[] = keys.map((k) => {
    return {
      type: 'put',
      key: k,
      value: randomBytes(32),
    }
  })

  const sortedTestNibbles = [
    [0, 1, 0, 3, 4, 10],
    [0, 1, 2, 2, 3, 10],
    [0, 1, 2, 2, 4, 10],
    [0, 1, 2, 3, 2, 10],
    [0, 1, 2, 3, 3, 10],
    [0, 1, 2, 3, 4, 10],
    [1, 1, 0, 3, 4, 10],
    [2, 1, 0, 3, 4, 10],
  ]
  const sortedNibleStrings = sortedTestNibbles.map((t) => {
    return t.map((n) => n.toString(16)).join('')
  })
  const sortedKeys = sortedNibleStrings.map((str) => {
    return unprefixedHexToBytes(str)
  })
  for (const [i, k] of sortedKeys.entries()) {
    it('should match', () => {
      assert.equal(bytesToUnprefixedHex(k), sortedNibleStrings[i], 'nibble string should match')
    })
  }
  const inNibbleOrder = orderBatch(batchOP)

  const keysNibbleOrder = inNibbleOrder.map((o) => bytesToUnprefixedHex(o.key))

  const smalltest = [hexToBytes('0x65'), hexToBytes('0x55')]
  const smallbatch: BatchDBOp[] = smalltest.map((k) => {
    return {
      type: 'put',
      key: k,
      value: randomBytes(32),
    }
  })
  const sortbatch = orderBatch(smallbatch)
  assert.notDeepEqual(smallbatch, sortbatch, 'should sort batch')
  assert.notDeepEqual(keysNibbleOrder, nibbleStrings, 'keys should sort')
  assert.deepEqual(keysNibbleOrder, sortedNibleStrings, 'keys should sort')
})

const keys = Array.from({ length: 1000 }, () => randomBytes(20))
const batchOP: BatchDBOp[] = keys.map((k) => {
  return {
    type: 'put',
    key: k,
    value: randomBytes(32),
  }
})

describe('Large Batch Test', async () => {
  const trie_0 = new Trie()
  const trie_1 = new Trie()

  for (const op of batchOP) {
    if (op.type === 'put') {
      await trie_0.put(op.key, op.value)
    }
  }

  await trie_1.batch(batchOP)

  it('batch should work', () => {
    assert.notDeepEqual(trie_0.root(), trie_0.EMPTY_TRIE_ROOT, 'trie is not empty')
    assert.deepEqual(trie_0.root(), trie_1.root(), 'trie roots should match (v1)')
  })

  it('should remain same', async () => {
    const deleteKeys: Uint8Array[] = Array.from({ length: 100 }, () => {
      return batchOP[Math.floor(Math.random() * batchOP.length)].key
    })
    const putNull: Uint8Array[] = Array.from({ length: 10 }, () => {
      return batchOP[Math.floor(Math.random() * batchOP.length)].key
    })

    const deleteBatch: BatchDBOp[] = deleteKeys.map((k) => {
      return {
        type: 'del',
        key: k,
      }
    })
    const putNullBatch: BatchDBOp[] = putNull.map((k) => {
      return {
        type: 'put',
        key: k,
        value: Uint8Array.from([]),
      }
    })
    for (const k of deleteKeys) {
      await trie_0.del(k)
    }
    await trie_1.batch(deleteBatch)
    assert.deepEqual(trie_0.root(), trie_1.root(), 'roots should match')

    for (const k of putNull) {
      await trie_0.put(k, null)
    }
    await trie_1.batch(putNullBatch)
    assert.deepEqual(trie_0.root(), trie_1.root(), 'roots should match')
  })
})
describe('Large Batch Test (secure)', async () => {
  const trie_0 = new Trie({ useKeyHashing: true })
  const trie_1 = new Trie({ useKeyHashing: true })
  const trie_3 = new Trie({})

  it('batch should work', async () => {
    for (const op of batchOP) {
      if (op.type === 'put') {
        await trie_0.put(op.key, op.value)
        await trie_3.put(op.key, op.value)
      }
    }
    const value = (batchOP[0] as any).value
    const key = batchOP[0].key
    const found = await trie_0.get(key)
    assert.deepEqual(found, value, 'value should be found in trie')
    const found3 = await trie_3.get(key)
    assert.deepEqual(found3, value, 'value should be found in trie')
    await trie_1.batch(batchOP)

    const found1 = await trie_1.get(key)
    assert.deepEqual(found1, value, 'value should be found in trie')
    assert.deepEqual(
      bytesToHex(trie_0.root()),
      bytesToHex(trie_1.root()),
      'trie roots should match'
    )
    assert.notDeepEqual(
      bytesToHex(trie_1.root()),
      bytesToHex(trie_3.root()),
      'trie roots should not match'
    )
  })

  it('should remain same', async () => {
    const deleteKeys: Uint8Array[] = Array.from({ length: 100 }, () => {
      return batchOP[Math.floor(Math.random() * batchOP.length)].key
    })
    const putNull: Uint8Array[] = Array.from({ length: 10 }, () => {
      return batchOP[Math.floor(Math.random() * batchOP.length)].key
    })

    const deleteBatch: BatchDBOp[] = deleteKeys.map((k) => {
      return {
        type: 'del',
        key: k,
      }
    })
    const putNullBatch: BatchDBOp[] = putNull.map((k) => {
      return {
        type: 'put',
        key: k,
        value: Uint8Array.from([]),
      }
    })
    for (const k of deleteKeys) {
      await trie_0.del(k)
    }
    await trie_1.batch(deleteBatch)
    assert.deepEqual(trie_0.root(), trie_1.root(), 'roots should match')

    for (const k of putNull) {
      await trie_0.put(k, null)
    }
    await trie_1.batch(putNullBatch)
    assert.deepEqual(trie_0.root(), trie_1.root(), 'roots should match')
  })
})
describe('Large Batch Test (use node pruning)', async () => {
  const trie_0 = new Trie({ useNodePruning: true, useRootPersistence: true })
  const trie_1 = new Trie({ useNodePruning: true, useRootPersistence: true })

  for (const op of batchOP) {
    if (op.type === 'put') {
      await trie_0.put(op.key, op.value)
    }
  }

  await trie_1.batch(batchOP)

  it('batch should work', () => {
    assert.notDeepEqual(trie_0.root(), trie_0.EMPTY_TRIE_ROOT, 'trie is not empty')
    assert.deepEqual(trie_0.root(), trie_1.root(), 'trie roots should match (v1)')
  })

  it('should remain same', async () => {
    const deleteKeys: Uint8Array[] = Array.from({ length: 100 }, () => {
      return batchOP[Math.floor(Math.random() * batchOP.length)].key
    })
    const putNull: Uint8Array[] = Array.from({ length: 10 }, () => {
      return batchOP[Math.floor(Math.random() * batchOP.length)].key
    })

    const deleteBatch: BatchDBOp[] = deleteKeys.map((k) => {
      return {
        type: 'del',
        key: k,
      }
    })
    const putNullBatch: BatchDBOp[] = putNull.map((k) => {
      return {
        type: 'put',
        key: k,
        value: Uint8Array.from([]),
      }
    })
    for (const k of deleteKeys) {
      await trie_0.del(k)
    }
    await trie_1.batch(deleteBatch)
    assert.deepEqual(trie_0.root(), trie_1.root(), 'roots should match')

    for (const k of putNull) {
      await trie_0.put(k, null)
    }
    await trie_1.batch(putNullBatch)
    assert.deepEqual(trie_0.root(), trie_1.root(), 'roots should match')
  })
})
