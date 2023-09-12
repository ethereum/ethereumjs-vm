import { RLP } from '@ethereumjs/rlp'
import {
  KECCAK256_NULL,
  KECCAK256_RLP_S,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { blake2b } from 'ethereum-cryptography/blake2b.js'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { assert, describe, it } from 'vitest'

import { LeafNode, Trie } from '../src/index.js'
import { bytesToNibbles } from '../src/util/nibbles.js'

import type { HashKeysFunction } from '../src/index.js'

for (const cacheSize of [0, 100]) {
  describe('simple save and retrieve', () => {
    it('should not crash if given a non-existent root', async () => {
      const root = hexToBytes('0x3f4399b08efe68945c1cf90ffe85bbe3ce978959da753f9e649f034015b8817d')

      const trie = new Trie({ root })
      const value = await trie.get(utf8ToBytes('test'))
      assert.equal(value, null)
    })

    const trie = new Trie({ cacheSize })

    it('save a value', async () => {
      await trie.put(utf8ToBytes('test'), utf8ToBytes('one'))
    })

    it('should get a value', async () => {
      const value = await trie.get(utf8ToBytes('test'))
      assert.equal(bytesToUtf8(value!), 'one')
    })

    it('should update a value', async () => {
      await trie.put(utf8ToBytes('test'), utf8ToBytes('two'))
      const value = await trie.get(utf8ToBytes('test'))

      assert.equal(bytesToUtf8(value!), 'two')
    })

    it('should delete a value', async () => {
      await trie.del(utf8ToBytes('test'))
      const value = await trie.get(utf8ToBytes('test'))
      assert.isNull(value)
    })

    it('should recreate a value', async () => {
      await trie.put(utf8ToBytes('test'), utf8ToBytes('one'))
    })

    it('should get updated a value', async () => {
      const value = await trie.get(utf8ToBytes('test'))
      assert.equal(bytesToUtf8(value!), 'one')
    })

    it('should create a branch here', async () => {
      await trie.put(utf8ToBytes('doge'), utf8ToBytes('coin'))
      assert.equal(
        '0xde8a34a8c1d558682eae1528b47523a483dd8685d6db14b291451a66066bf0fc',
        bytesToHex(trie.root())
      )
    })

    it('should get a value that is in a branch', async () => {
      const value = await trie.get(utf8ToBytes('doge'))
      assert.equal(bytesToUtf8(value!), 'coin')
    })

    it('should delete from a branch', async () => {
      await trie.del(utf8ToBytes('doge'))
      const value = await trie.get(utf8ToBytes('doge'))
      assert.equal(value, null)
    })

    describe('storing longer values', () => {
      const trie = new Trie({ cacheSize })
      const longString = 'this will be a really really really long value'
      const longStringRoot = 'b173e2db29e79c78963cff5196f8a983fbe0171388972106b114ef7f5c24dfa3'

      it('should store a longer string', async () => {
        await trie.put(utf8ToBytes('done'), utf8ToBytes(longString))
        await trie.put(utf8ToBytes('doge'), utf8ToBytes('coin'))
        assert.equal('0x' + longStringRoot, bytesToHex(trie.root()))
      })

      it('should retrieve a longer value', async () => {
        const value = await trie.get(utf8ToBytes('done'))
        assert.equal(bytesToUtf8(value!), longString)
      })

      it('should when being modified delete the old value', async () => {
        await trie.put(utf8ToBytes('done'), utf8ToBytes('test'))
      })
    })

    describe('testing extensions and branches', () => {
      const trie = new Trie({ cacheSize })

      it('should store a value', async () => {
        await trie.put(utf8ToBytes('doge'), utf8ToBytes('coin'))
      })

      it('should create extension to store this value', async () => {
        await trie.put(utf8ToBytes('do'), utf8ToBytes('verb'))
        assert.equal(
          '0xf803dfcb7e8f1afd45e88eedb4699a7138d6c07b71243d9ae9bff720c99925f9',
          bytesToHex(trie.root())
        )
      })

      it('should store this value under the extension', async () => {
        await trie.put(utf8ToBytes('done'), utf8ToBytes('finished'))
        assert.equal(
          '0x409cff4d820b394ed3fb1cd4497bdd19ffa68d30ae34157337a7043c94a3e8cb',
          bytesToHex(trie.root())
        )
      })
    })

    describe('testing extensions and branches - reverse', () => {
      const trie = new Trie({ cacheSize })

      it('should create extension to store this value', async () => {
        await trie.put(utf8ToBytes('do'), utf8ToBytes('verb'))
      })

      it('should store a value', async () => {
        await trie.put(utf8ToBytes('doge'), utf8ToBytes('coin'))
      })

      it('should store this value under the extension', async () => {
        await trie.put(utf8ToBytes('done'), utf8ToBytes('finished'))
        assert.equal(
          '0x409cff4d820b394ed3fb1cd4497bdd19ffa68d30ae34157337a7043c94a3e8cb',
          bytesToHex(trie.root())
        )
      })
    })
  })

  describe('testing deletion cases', () => {
    const trieSetup = {
      trie: new Trie({ cacheSize }),
      msg: 'without DB delete',
    }

    it('should delete from a branch->branch-branch', async () => {
      await trieSetup.trie.put(new Uint8Array([11, 11, 11]), utf8ToBytes('first'))
      await trieSetup.trie.put(new Uint8Array([12, 22, 22]), utf8ToBytes('create the first branch'))
      await trieSetup.trie.put(new Uint8Array([12, 34, 44]), utf8ToBytes('create the last branch'))

      await trieSetup.trie.del(new Uint8Array([12, 22, 22]))
      const val = await trieSetup.trie.get(new Uint8Array([12, 22, 22]))
      assert.equal(null, val, trieSetup.msg)
    })

    it('should delete from a branch->branch-extension', async () => {
      await trieSetup.trie.put(new Uint8Array([11, 11, 11]), utf8ToBytes('first'))
      await trieSetup.trie.put(new Uint8Array([12, 22, 22]), utf8ToBytes('create the first branch'))
      await trieSetup.trie.put(
        new Uint8Array([12, 33, 33]),
        utf8ToBytes('create the middle branch')
      )
      await trieSetup.trie.put(new Uint8Array([12, 34, 44]), utf8ToBytes('create the last branch'))

      await trieSetup.trie.del(new Uint8Array([12, 22, 22]))
      const val = await trieSetup.trie.get(new Uint8Array([12, 22, 22]))
      assert.equal(null, val, trieSetup.msg)
    })

    it('should delete from a extension->branch-extension', async () => {
      await trieSetup.trie.put(new Uint8Array([11, 11, 11]), utf8ToBytes('first'))
      await trieSetup.trie.put(new Uint8Array([12, 22, 22]), utf8ToBytes('create the first branch'))
      await trieSetup.trie.put(
        new Uint8Array([12, 33, 33]),
        utf8ToBytes('create the middle branch')
      )
      await trieSetup.trie.put(new Uint8Array([12, 34, 44]), utf8ToBytes('create the last branch'))

      // delete the middle branch
      await trieSetup.trie.del(new Uint8Array([11, 11, 11]))
      const val = await trieSetup.trie.get(new Uint8Array([11, 11, 11]))
      assert.equal(null, val, trieSetup.msg)
    })

    it('should delete from a extension->branch-branch', async () => {
      await trieSetup.trie.put(new Uint8Array([11, 11, 11]), utf8ToBytes('first'))
      await trieSetup.trie.put(new Uint8Array([12, 22, 22]), utf8ToBytes('create the first branch'))
      await trieSetup.trie.put(
        new Uint8Array([12, 33, 33]),
        utf8ToBytes('create the middle branch')
      )
      await trieSetup.trie.put(new Uint8Array([12, 34, 44]), utf8ToBytes('create the last branch'))
      // delete the middle branch
      await trieSetup.trie.del(new Uint8Array([11, 11, 11]))
      const val = await trieSetup.trie.get(new Uint8Array([11, 11, 11]))
      assert.equal(null, val, trieSetup.msg)
    })
  })

  describe('shall handle the case of node not found correctly', () => {
    it('should work', async () => {
      const trie = new Trie({ cacheSize })
      await trie.put(utf8ToBytes('a'), utf8ToBytes('value1'))
      await trie.put(utf8ToBytes('aa'), utf8ToBytes('value2'))
      await trie.put(utf8ToBytes('aaa'), utf8ToBytes('value3'))

      /* Setups a trie which consists of
      ExtensionNode ->
      BranchNode -> value1
      ExtensionNode ->
      BranchNode -> value2
      LeafNode -> value3
    */

      let path = await trie.findPath(utf8ToBytes('aaa'))
      let path2 = await trie.findPath2(utf8ToBytes('aaa'))
      assert.deepEqual(path, path2, 'findPath and findPath2 should return the same result')

      assert.ok(path.node !== null, 'findPath should find a node')

      const { stack } = await trie.findPath(utf8ToBytes('aaa'))
      const { stack: stack2 } = await trie.findPath2(utf8ToBytes('aaa'))

      assert.deepEqual(stack, stack2, 'findPath and findPath2 should return the same result')

      // @ts-expect-error
      await trie._db.del(keccak256(stack[1].serialize())) // delete the BranchNode -> value1 from the DB

      path = await trie.findPath(utf8ToBytes('aaa'))
      path2 = await trie.findPath2(utf8ToBytes('aaa'))
      assert.deepEqual(path, path2, 'findPath and findPath2 should return the same result')

      assert.ok(path.node === null, 'findPath should not return a node now')
      assert.ok(
        path.stack.length === 1,
        'findPath should find the first extension node which is still in the DB'
      )
    })
  })

  describe('it should create the genesis state root from ethereum', () => {
    it('should work', async () => {
      const trie4 = new Trie({ cacheSize })

      const g = hexToBytes('0x8a40bfaa73256b60764c1bf40675a99083efb075')
      const j = hexToBytes('0xe6716f9544a56c530d868e4bfbacb172315bdead')
      const v = hexToBytes('0x1e12515ce3e0f817a4ddef9ca55788a1d66bd2df')
      const a = hexToBytes('0x1a26338f0d905e295fccb71fa9ea849ffa12aaf4')

      const storageRoot = new Uint8Array(32)
      storageRoot.fill(0)

      const startAmount = new Uint8Array(26)
      startAmount.fill(0)
      startAmount[0] = 1

      const account = [startAmount, 0, storageRoot, KECCAK256_NULL]
      const rlpAccount = RLP.encode(account)
      const cppRlp =
        '0xf85e9a010000000000000000000000000000000000000000000000000080a00000000000000000000000000000000000000000000000000000000000000000a0c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'

      const genesisStateRoot = '0x2f4399b08efe68945c1cf90ffe85bbe3ce978959da753f9e649f034015b8817d'
      assert.equal(cppRlp, bytesToHex(rlpAccount))

      await trie4.put(g, rlpAccount)
      await trie4.put(j, rlpAccount)
      await trie4.put(v, rlpAccount)
      await trie4.put(a, rlpAccount)
      assert.equal(bytesToHex(trie4.root()), genesisStateRoot)
    })
  })

  describe('setting back state root (deleteFromDB)', () => {
    it('should work', async () => {
      const k1 = utf8ToBytes('1')
      /* Testing with longer value due to `rlpNode.length >= 32` check in `_formatNode()`
       * Reasoning from https://ethereum.org/en/developers/docs/data-structures-and-encoding/patricia-merkle-trie/:
       * "When one node is referenced inside another node, what is included is `H(rlp.encode(x))`,
       * where `H(x) = sha3(x) if len(x) >= 32 else x`"
       */
      const v1 = utf8ToBytes('this-is-some-longer-value-to-test-the-delete-operation-value1')
      const k2 = utf8ToBytes('2')
      const v2 = utf8ToBytes('this-is-some-longer-value-to-test-the-delete-operation-value2')

      const rootAfterK1 = hexToBytes(
        '0x809e75931f394603657e113eb7244794f35b8d326cff99407111d600722e9425'
      )

      const trieSetup = {
        trie: new Trie({ cacheSize }),
        expected: v1,
        msg: 'should return v1 when setting back the state root when deleteFromDB=false',
      }

      await trieSetup.trie.put(k1, v1)
      await trieSetup.trie.put(k2, v2)
      await trieSetup.trie.del(k1)
      assert.equal(
        await trieSetup.trie.get(k1),
        null,
        'should return null on latest state root independently from deleteFromDB setting'
      )

      trieSetup.trie.root(rootAfterK1)
      assert.deepEqual(await trieSetup.trie.get(k1), trieSetup.expected, trieSetup.msg)
    })
  })

  describe('dummy hash', () => {
    it('should work', async () => {
      const useKeyHashingFunction: HashKeysFunction = (msg) => {
        const hashLen = 32
        if (msg.length <= hashLen - 5) {
          return concatBytes(
            utf8ToBytes('hash_'),
            new Uint8Array(hashLen - msg.length).fill(0),
            msg
          )
        } else {
          return concatBytes(utf8ToBytes('hash_'), msg.slice(0, hashLen - 5))
        }
      }

      const [k, v] = [utf8ToBytes('foo'), utf8ToBytes('bar')]
      const expectedRoot = useKeyHashingFunction(new LeafNode(bytesToNibbles(k), v).serialize())

      const trie = new Trie({ useKeyHashingFunction, cacheSize })
      await trie.put(k, v)
      assert.equal(bytesToHex(trie.root()), bytesToHex(expectedRoot))
    })
  })

  describe('blake2b256 trie root', () => {
    it('should work', async () => {
      const trie = new Trie({ useKeyHashingFunction: (msg) => blake2b(msg, 32), cacheSize })
      await trie.put(utf8ToBytes('foo'), utf8ToBytes('bar'))

      assert.equal(
        bytesToHex(trie.root()),
        '0xe118db4e01512253df38daafa16fc1d69e03e755595b5847d275d7404ebdc74a'
      )
    })
  })

  describe('empty root', () => {
    it('should work', async () => {
      const trie = new Trie({ cacheSize })

      assert.equal(bytesToHex(trie.root()), KECCAK256_RLP_S)
    })
  })
}
