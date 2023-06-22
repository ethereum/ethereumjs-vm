import {
  MapDB,
  compareBytes,
  hexStringToBytes,
  randomBytes,
  setLengthLeft,
  toBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Trie, bytesToNibbles, verifyRangeProof } from '../../src/index.js'

import {
  decreaseKey,
  getRandomIntInclusive,
  increaseKey,
  randomTrie,
  verify,
} from './utils.spec.js'

// reference: https://github.com/ethereum/go-ethereum/blob/20356e57b119b4e70ce47665a71964434e15200d/trie/proof_test.go

describe('create a range proof and verify it', async () => {
  const { trie, entries } = await randomTrie(new MapDB())
  it('should build a randomTrie', async () => {
    assert.notDeepEqual(trie.root(), trie.EMPTY_TRIE_ROOT)
  })
  it('should put all entries into randomTrie', async () => {
    for await (const [key, val] of entries) {
      assert.deepEqual(await trie.get(key), val)
    }
  })
  it('should run test 10 times', async () => {
    for await (const _ of Array.from({ length: 10 }, (_, k) => k)) {
      it(
        'should verify a range proof',
        async () => {
          const start = getRandomIntInclusive(0, entries.length - 2)
          const end = getRandomIntInclusive(start + 1, entries.length - 1)
          assert.equal(await verify({ trie, entries, start, end }), end !== entries.length - 1)
        },
        { timeout: 10000 }
      )
    }
  })
  it('should verify a range proof', async () => {
    assert.equal(
      await verify({ trie, entries, start: entries.length - 2, end: entries.length - 1 }),
      false
    )
  })
})

describe('create a non-existent range proof and verify it', async () => {
  const { trie, entries } = await randomTrie(new MapDB())
  for await (const i of Array.from({ length: 10 }, (_, k) => k)) {
    const start = getRandomIntInclusive(0, entries.length - 1)
    const end = getRandomIntInclusive(start, entries.length - 1)

    const startKey = decreaseKey(entries[start][0])
    if (
      startKey === undefined ||
      (start > 0 && compareBytes(entries[start - 1][0], startKey) >= 0)
    ) {
      continue
    }

    const endKey = increaseKey(entries[end][0])
    if (
      endKey === undefined ||
      (end < entries.length - 1 && compareBytes(endKey, entries[end + 1][0]) >= 0)
    ) {
      continue
    }
    it(`Should run test #${i}`, async () => {
      it('should select random keys', async () => {
        assert.ok(startKey)
        assert.ok(start)
        assert.ok(end)
        assert.ok(endKey)
      })
      it('should verify a non-existent range proof', async () => {
        assert.equal(
          await verify({ trie, entries, start, end, startKey, endKey }),
          end !== entries.length - 1
        )
      })
    })
  }
  it(
    'should verify a non-existent range proof',
    async () => {
      // Special case, two edge proofs for two edge key.
      const startKey = hexStringToBytes('00'.repeat(32))
      const endKey = hexStringToBytes('ff'.repeat(32))
      assert.equal(
        await verify({ trie, entries, start: 0, end: entries.length - 1, startKey, endKey }),
        false
      )
    },
    {
      timeout: 20000,
    }
  ),
    { timeout: 50000 }
})

describe('create invalid non-existent range proof and verify it', async () => {
  const { trie, entries } = await randomTrie(new MapDB())

  const start = 100
  const end = 200
  const startKey = entries[start][0]
  const endKey = entries[end][0]
  const decreasedStartKey = decreaseKey(startKey)!
  const increasedEndKey = increaseKey(endKey)!

  it('should verify', async () => {
    assert.equal(
      await verify({ trie, entries, start, end, startKey: decreasedStartKey, endKey }),
      true
    )
  })
  it('should throw an error', async () => {
    try {
      await verify({ trie, entries, start: start + 5, end, startKey: decreasedStartKey })
      assert.fail()
    } catch (err: any) {
      assert.equal(err.message, 'invalid two edge elements proof: root mismatch')
      // ignore ..
    }
  })
  it('should throw an error', async () => {
    assert.equal(
      await verify({ trie, entries, start, end, startKey, endKey: increasedEndKey }),
      true
    )
    try {
      await verify({ trie, entries, start, end: end + 5, startKey, endKey: increasedEndKey })
      assert.fail()
    } catch (err: any) {
      assert.equal(err.message, 'invalid two edge elements proof: root mismatch')
      // ignore ..
    }
  })
})

describe('create a one element range proof and verify it', async () => {
  const { trie, entries } = await randomTrie(new MapDB())

  const start = 255
  const startKey = entries[start][0]
  const endKey = startKey
  const decreasedStartKey = decreaseKey(startKey)!
  const increasedEndKey = increaseKey(endKey)!

  it('One element with existent edge proof, both edge proofs point to the SAME key.', async () => {
    assert.equal(await verify({ trie, entries, start, end: start, startKey }), true)
  })

  it('One element with left non-existent edge proof', async () => {
    assert.equal(
      await verify({ trie, entries, start, end: start, startKey: decreasedStartKey }),
      true
    )
  })

  it(' One element with right non-existent edge proof', async () => {
    assert.equal(
      await verify({
        trie,
        entries,
        start,
        end: start,
        startKey: undefined,
        endKey: increasedEndKey,
      }),
      true
    )
  })
  it('One element with two non-existent edge proofs', async () => {
    assert.equal(
      await verify({
        trie,
        entries,
        start,
        end: start,
        startKey: decreasedStartKey,
        endKey: increasedEndKey,
      }),
      true
    )
  })

  // Test the mini trie with only a single element.
  const tinyTrie = new Trie()
  const tinyEntries: [Uint8Array, Uint8Array][] = [[randomBytes(32), randomBytes(20)]]
  await tinyTrie.put(tinyEntries[0][0], tinyEntries[0][1])

  const tinyStartKey = hexStringToBytes('00'.repeat(32))
  assert.equal(
    await verify({
      trie: tinyTrie,
      entries: tinyEntries,
      start: 0,
      end: 0,
      startKey: tinyStartKey,
    }),
    false
  )
})

describe(
  'create all element range proof and verify it',
  async () => {
    const { trie, entries } = await randomTrie(new MapDB())

    it('should return false', async () => {
      assert.equal(
        await verifyRangeProof(
          trie.root(),
          null,
          null,
          entries.map(([key]) => bytesToNibbles(key)),
          entries.map(([, val]) => val),
          null,
          trie.hashFunction
        ),
        false
      )
    })

    it('should return false', async () => {
      // With edge proofs, it should still work.
      assert.equal(await verify({ trie, entries, start: 0, end: entries.length - 1 }), false)
    })

    it('should return false', async () => {
      // Even with non-existent edge proofs, it should still work.
      assert.equal(
        await verify({
          trie,
          entries,
          start: 0,
          end: entries.length - 1,
          startKey: hexStringToBytes('00'.repeat(32)),
          endKey: hexStringToBytes('ff'.repeat(32)),
        }),
        false
      )
    })
  },
  { timeout: 15000 }
)

describe('create a single side range proof and verify it', async () => {
  const startKey = hexStringToBytes('00'.repeat(32))
  const { trie, entries } = await randomTrie(new MapDB(), false)

  const cases = [0, 1, 200, entries.length - 1]
  for (const end of cases) {
    it('should run test', async () => {
      assert.equal(
        await verify({ trie, entries, start: 0, end, startKey }),
        end !== entries.length - 1
      )
    })
  }
})

describe('create a revert single side range proof and verify it', async () => {
  const endKey = hexStringToBytes('ff'.repeat(32))
  const { trie, entries } = await randomTrie(new MapDB(), false)

  const cases = [0, 1, 200, entries.length - 1]
  for (const start of cases) {
    it('should run test', async () => {
      assert.equal(
        await verify({
          trie,
          entries,
          start,
          end: entries.length - 1,
          startKey: undefined,
          endKey,
        }),
        false
      )
    })
  }
})

describe(
  'create a bad range proof and verify it',
  async () => {
    const runTest = async (
      cb: (trie: Trie, entries: [Uint8Array, Uint8Array][]) => Promise<void>
    ) => {
      it('should fail', async () => {
        let result = false
        const { trie, entries } = await randomTrie(new MapDB(), false)
        try {
          await cb(trie, entries)
          result = true
        } catch (err) {
          // ignore
        }
        assert.isFalse(result)
      })
    }

    // Modified key
    await runTest(async (trie, entries) => {
      const start = getRandomIntInclusive(0, entries.length - 2)
      const end = getRandomIntInclusive(start + 1, entries.length - 1)
      const targetIndex = getRandomIntInclusive(start, end)
      entries[targetIndex][0] = randomBytes(32)
      await verify({ trie, entries, start, end })
    })

    // Modified val
    await runTest(async (trie, entries) => {
      const start = getRandomIntInclusive(0, entries.length - 2)
      const end = getRandomIntInclusive(start + 1, entries.length - 1)
      const targetIndex = getRandomIntInclusive(start, end)
      entries[targetIndex][1] = randomBytes(20)
      await verify({ trie, entries, start, end })
    })

    // Gapped entry slice
    await runTest(async (trie, entries) => {
      const start = getRandomIntInclusive(0, entries.length - 3)
      const end = getRandomIntInclusive(start + 2, entries.length - 1)
      const targetIndex = getRandomIntInclusive(start + 1, end - 1)
      entries = entries.slice(0, targetIndex).concat(entries.slice(targetIndex + 1))
      await verify({ trie, entries, start, end })
    })

    // Out of order
    await runTest(async (trie, entries) => {
      const start = getRandomIntInclusive(0, entries.length - 2)
      const end = getRandomIntInclusive(start + 1, entries.length - 1)
      let targetIndex1!: number
      let targetIndex2!: number
      while (targetIndex1 === targetIndex2) {
        targetIndex1 = getRandomIntInclusive(start, end)
        targetIndex2 = getRandomIntInclusive(start, end)
      }
      const temp = entries[targetIndex1]
      entries[targetIndex1] = entries[targetIndex2]
      entries[targetIndex2] = temp
      await verify({ trie, entries, start, end })
    })
  },
  { timeout: 25000 }
)

describe('create a gapped range proof and verify it', async () => {
  const trie = new Trie()
  const entries: [Uint8Array, Uint8Array][] = []
  for (let i = 0; i < 10; i++) {
    const key = setLengthLeft(toBytes(i), 32)
    const val = toBytes(i)
    await trie.put(key, val)
    entries.push([key, val])
  }

  const start = 2
  const end = 8
  const targetRange: [Uint8Array, Uint8Array][] = []
  for (let i = start; i <= end; i++) {
    if (i === (start + end) / 2) {
      continue
    }
    targetRange.push(entries[i])
  }

  it('should not verify the proof', async () => {
    let result = false
    try {
      result = await verify({
        trie,
        entries,
        start,
        end,
        startKey: undefined,
        endKey: undefined,
        keys: targetRange.map(([key]) => key),
        vals: targetRange.map(([, val]) => val),
      })
    } catch (err) {
      //ignore
    }
    assert.isFalse(result)
  })
})

describe('create a same side range proof and verify it', async () => {
  const { trie, entries } = await randomTrie(new MapDB())

  const start = 200
  const end = 200
  const startKey = entries[start][0]
  const endKey = entries[end][0]
  const decreasedStartKey = decreaseKey(decreaseKey(startKey)!)!
  const decreasedEndKey = decreaseKey(endKey)!

  let result = false
  it('should throw', async () => {
    try {
      await verify({
        trie,
        entries,
        start,
        end,
        startKey: decreasedStartKey,
        endKey: decreasedEndKey,
      })
      result = true
    } catch (err) {
      // ignore
    }
    assert.isFalse(result)
  })

  const increasedStartKey = increaseKey(startKey)!
  const increasedEndKey = increaseKey(increaseKey(endKey)!)!

  result = false
  it('should throw', async () => {
    try {
      await verify({
        trie,
        entries,
        start,
        end,
        startKey: increasedStartKey,
        endKey: increasedEndKey,
      })
      result = true
    } catch (err) {
      // ignore
    }
    assert.isFalse(result)
  })
})

const TRIE_SIZE = 512
describe('should hasRightElement succeed', async () => {
  const { trie, entries } = await randomTrie(new MapDB(), false)

  const cases: { start: number; end: number; expect: boolean }[] = [
    {
      start: -1,
      end: 1,
      expect: true,
    },
    {
      start: 0,
      end: 1,
      expect: true,
    },
    {
      start: 0,
      end: 10,
      expect: true,
    },
    {
      start: 50,
      end: 100,
      expect: true,
    },
    {
      start: 400,
      end: TRIE_SIZE - 1,
      expect: false,
    },
    {
      start: TRIE_SIZE - 2,
      end: TRIE_SIZE - 1,
      expect: false,
    },
    {
      start: TRIE_SIZE - 1,
      end: -1,
      expect: false,
    },
    {
      start: 0,
      end: TRIE_SIZE - 1,
      expect: false,
    },
    {
      start: -1,
      end: TRIE_SIZE - 1,
      expect: false,
    },
    {
      start: -1,
      end: -1,
      expect: false,
    },
  ]
  // eslint-disable-next-line prefer-const
  for (let { start, end, expect } of cases) {
    it('create a range proof and verify it', async () => {
      let startKey: Uint8Array
      let endKey: Uint8Array

      if (start === -1) {
        start = 0
        startKey = hexStringToBytes('00'.repeat(32))
      } else {
        startKey = entries[start][0]
      }

      if (end === -1) {
        end = entries.length - 1
        endKey = hexStringToBytes('ff'.repeat(32))
      } else {
        endKey = entries[end][0]
      }

      assert.equal(await verify({ trie, entries, start, end, startKey, endKey }), expect)
    })
  }
})

describe('create a bloated range proof and verify it', async () => {
  const { trie, entries } = await randomTrie(new MapDB(), false)

  let bloatedProof: Uint8Array[] = []
  for (let i = 0; i < TRIE_SIZE; i++) {
    bloatedProof = bloatedProof.concat(await trie.createProof(entries[i][0]))
  }
  it('should verify bloated proof', async () => {
    assert.equal(await verify({ trie, entries, start: 0, end: entries.length - 1 }), false)
  })
})
