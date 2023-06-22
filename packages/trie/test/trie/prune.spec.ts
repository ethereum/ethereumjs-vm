import {
  KECCAK256_RLP,
  equalsBytes,
  hexStringToBytes,
  randomBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Trie } from '../../src/index.js'

describe(
  'Pruned trie tests',
  () => {
    it('should default to not prune the trie', async () => {
      const trie = new Trie()
      const key = utf8ToBytes('test')
      await trie.put(key, utf8ToBytes('1'))
      await trie.put(key, utf8ToBytes('2'))
      await trie.put(key, utf8ToBytes('3'))
      await trie.put(key, utf8ToBytes('4'))
      await trie.put(key, utf8ToBytes('5'))
      await trie.put(key, utf8ToBytes('6'))

      assert.equal((await trie.database().keys()).length, 6, 'DB size correct')
    })

    it('should prune simple trie', async () => {
      const trie = new Trie({ useNodePruning: true })
      const key = utf8ToBytes('test')
      await trie.put(key, utf8ToBytes('1'))
      await trie.put(key, utf8ToBytes('2'))
      await trie.put(key, utf8ToBytes('3'))
      await trie.put(key, utf8ToBytes('4'))
      await trie.put(key, utf8ToBytes('5'))
      await trie.put(key, utf8ToBytes('6'))

      assert.deepEqual(await trie.get(key), utf8ToBytes('6'), 'Value correct')
      assert.equal((await trie.database().keys()).length, 1, 'DB size correct')
    })

    it('should prune simple trie', async () => {
      const trie = new Trie({ useNodePruning: true })
      const key = utf8ToBytes('test')
      await trie.put(key, utf8ToBytes('1'))
      assert.equal((await trie.database().keys()).length, 1, 'DB size correct')

      await trie.del(key)
      assert.equal((await trie.database().keys()).length, 0, 'DB size correct')

      await trie.put(key, utf8ToBytes('1'))
      assert.equal((await trie.database().keys()).length, 1, 'DB size correct')
    })

    it('should prune trie with depth = 2', async () => {
      const trie = new Trie({ useNodePruning: true })
      // Create a Trie with
      const keys = ['01', '02', '0103', '0104', '0105']
      const values = ['00', '02', '03', '04', '05']

      for (let i = 0; i < keys.length; i++) {
        await trie.put(hexStringToBytes(keys[i]), hexStringToBytes(values[i]))
      }
    })

    it('should not prune if the same value is put twice', async () => {
      const trie = new Trie()
      const key = utf8ToBytes('01')
      const value = utf8ToBytes('02')

      await trie.put(key, value)
      await trie.put(key, value)
      const reported = await trie.get(key)
      assert.ok(equalsBytes(reported!, value), 'value matches expected value')
    })

    it('should not throw if a key is either non-existent or deleted twice', async () => {
      const trie = new Trie()
      const key = utf8ToBytes('01')
      const value = utf8ToBytes('02')

      // key does not exist (empty trie)
      await trie.del(key)

      const key2 = utf8ToBytes('AA')
      const value2 = utf8ToBytes('ee')
      await trie.put(key2, value2)
      // key does not exist (non-empty trie)
      await trie.del(key)

      await trie.put(key, value)
      await trie.del(key)
      await trie.del(key)
      const reported = await trie.get(key)
      assert.ok(reported === null, 'value is null')
      const reported2 = await trie.get(key2)
      if (reported2 === null) {
        assert.fail('value is null')
      } else {
        assert.ok(equalsBytes(reported2!, value2), 'value matches expected value')
      }
    })

    it(
      'should prune when keys are updated or deleted',
      async () => {
        for (let testID = 0; testID < 1; testID++) {
          const trie = new Trie({ useNodePruning: true })
          const keys: Uint8Array[] = []
          for (let i = 0; i < 100; i++) {
            keys.push(randomBytes(32))
          }

          const values: string[] = []
          for (let i = 0; i < 1000; i++) {
            let val = Math.floor(Math.random() * 16384)
            while (values.includes(val.toString(16))) {
              val = Math.floor(Math.random() * 16384)
            }
            values.push(val.toString(16))
          }
          // Fill trie with items
          for (let i = 0; i < keys.length; i++) {
            const idx = Math.floor(Math.random() * keys.length)
            const key = keys[idx]
            await trie.put(key, utf8ToBytes(values[i]))
          }

          assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')

          // Randomly delete keys
          for (let i = 0; i < 20; i++) {
            const idx = Math.floor(Math.random() * keys.length)
            await trie.del(keys[idx])
          }
          assert.ok('deleted keys')
          assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')

          // Fill trie with items or randomly delete them
          for (let i = 0; i < keys.length; i++) {
            const idx = Math.floor(Math.random() * keys.length)
            const key = keys[idx]
            if (Math.random() < 0.5) {
              await trie.put(key, utf8ToBytes(values[i]))
            } else {
              await trie.del(key)
            }
          }

          assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')

          // Delete all keys
          for (let idx = 0; idx < 100; idx++) {
            await trie.del(keys[idx])
          }

          assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')
          assert.ok(equalsBytes(trie.root(), KECCAK256_RLP), 'trie is empty')

          let dbKeys = 0
          for (const _dbkey of await trie.database().keys()) {
            dbKeys++
          }
          assert.ok(dbKeys === 0, 'db is empty')
        }
      },
      { timeout: 20000 }
    )

    it('verifyPrunedIntegrity() => should correctly report unpruned Tries', async () => {
      // Create empty Trie (is pruned)
      let trie = new Trie()
      // Create a new value (still is pruned)
      await trie.put(hexStringToBytes('aa'), hexStringToBytes('bb'))
      // Overwrite this value (trie is now not pruned anymore)
      await trie.put(hexStringToBytes('aa'), hexStringToBytes('aa'))
      assert.ok(!(await trie.verifyPrunedIntegrity()), 'trie is not pruned')

      // Create new empty Trie (is pruned)
      trie = new Trie()
      // Create a new value raw in DB (is not pruned)
      await trie.database().put(utf8ToBytes('aa'), Uint8Array.from([]))
      assert.ok(!(await trie.verifyPrunedIntegrity()), 'trie is not pruned')
      await trie.database().del(utf8ToBytes('aa'))
      assert.ok(await trie.verifyPrunedIntegrity(), 'trie is pruned')
      await trie.put(utf8ToBytes('aa'), utf8ToBytes('bb'))
      assert.ok(await trie.verifyPrunedIntegrity(), 'trie is pruned')
      await trie.database().put(utf8ToBytes('aa'), Uint8Array.from([]))
      assert.ok(!(await trie.verifyPrunedIntegrity()), 'trie is not pruned')
    })

    it('should prune when keys are updated or deleted (with `useRootPersistence` enabled)', async () => {
      for (let testID = 0; testID < 1; testID++) {
        const trie = new Trie({ useNodePruning: true, persistent: true })
        assert.isTrue(trie.persistent, 'trie is persistent')
        const keys: Uint8Array[] = []
        for (let i = 0; i < 100; i++) {
          keys.push(randomBytes(32))
        }
        const values: string[] = []
        for (let i = 0; i < 1000; i++) {
          let val = Math.floor(Math.random() * 16384)
          while (values.includes(val.toString(16))) {
            val = Math.floor(Math.random() * 16384)
          }
          values.push(val.toString(16))
        }
        // Fill trie with items
        for (let i = 0; i < keys.length; i++) {
          const idx = Math.floor(Math.random() * keys.length)
          const key = keys[idx]
          await trie.put(key, utf8ToBytes(values[i]))
        }

        assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')

        // Randomly delete keys
        for (let i = 0; i < 20; i++) {
          const idx = Math.floor(Math.random() * keys.length)
          await trie.del(keys[idx])
        }

        assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')

        // Fill trie with items or randomly delete them
        for (let i = 0; i < keys.length; i++) {
          const idx = Math.floor(Math.random() * keys.length)
          const key = keys[idx]
          if (Math.random() < 0.5) {
            await trie.put(key, utf8ToBytes(values[i]))
          } else {
            await trie.del(key)
          }
        }

        assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')

        // Delete all keys
        for (let idx = 0; idx < 100; idx++) {
          await trie.del(keys[idx])
        }

        assert.ok(await trie.verifyPrunedIntegrity(), 'trie is correctly pruned')
        assert.ok(equalsBytes(trie.root(), KECCAK256_RLP), 'trie is empty')

        let dbKeys = 0
        for (const _dbkey of await trie.database().keys()) {
          dbKeys++
        }
        assert.equal(dbKeys, 1, 'db is empty except for persisted root')
      }
    })
  },
  { timeout: 20000 }
)
