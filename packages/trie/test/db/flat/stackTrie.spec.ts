import { Account, KECCAK256_RLP, bytesToHex, hexToBytes } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { assert, describe, it } from 'vitest'

import { Trie, merkleizeList } from '../../../src/index.js'

async function merkleizeViaTrie(leaves: Uint8Array[][]) {
  const trie = new Trie()
  for (const leaf of leaves) {
    await trie.put(leaf[0], leaf[1])
  }
  return trie.root()
}

describe('snapshot merkleize list', () => {
  it('should merkleize empty list', async () => {
    const leaves: Uint8Array[][] = []
    const root = merkleizeList(leaves)
    assert.equal(JSON.stringify(root), JSON.stringify(KECCAK256_RLP))
  })

  it('should merkleize single leaf', async () => {
    const serializedEmptyAcc = new Account().serialize()
    const leaves: Uint8Array[][] = [[hexToBytes('0x' + '1'.repeat(32)), serializedEmptyAcc]]
    const expected = await merkleizeViaTrie(leaves)
    const root = merkleizeList(leaves)
    assert.equal(
      JSON.stringify(root),
      JSON.stringify(expected),
      `Merkleized root ${bytesToHex(root)} should match ${bytesToHex(expected)}`
    )
  })

  it('should merkleize two leaves', async () => {
    const serializedEmptyAcc = new Account().serialize()
    const leaves: Uint8Array[][] = [
      [hexToBytes('0x01111111111111111111111111111111'), serializedEmptyAcc],
      [hexToBytes('0x02111111111111111111111111111111'), serializedEmptyAcc],
    ]
    const expected = await merkleizeViaTrie(leaves)
    const root = merkleizeList(leaves)
    assert.equal(
      JSON.stringify(root),
      JSON.stringify(expected),
      `Merkleized root ${bytesToHex(root)} should match ${bytesToHex(expected)}`
    )
  })

  it('should merkleize trie with leaf inserted to branch', async () => {
    const serializedEmptyAcc = new Account().serialize()
    const leaves: Uint8Array[][] = [
      [hexToBytes('0x01111111111111111111111111111111'), serializedEmptyAcc],
      [hexToBytes('0x12111111111111111111111111111111'), serializedEmptyAcc],
      [hexToBytes('0x13111111111111111111111111111111'), serializedEmptyAcc],
    ]
    const expected = await merkleizeViaTrie(leaves)
    const root = merkleizeList(leaves)
    assert.equal(
      JSON.stringify(root),
      JSON.stringify(expected),
      `Merkleized root ${bytesToHex(root)} should match ${bytesToHex(expected)}`
    )
  })

  it('should merkleize trie with extension insertion', async () => {
    const serializedEmptyAcc = new Account().serialize()
    const testcases = [
      [
        [hexToBytes('0x01111111111111111111111111111111'), serializedEmptyAcc],
        [hexToBytes('0x02111111111111111111111111111111'), serializedEmptyAcc],
        [hexToBytes('0x03111111111111111111111111111111'), serializedEmptyAcc],
      ],
      [
        [hexToBytes('0x00001111111111111111111111111111'), serializedEmptyAcc],
        [hexToBytes('0x00002111111111111111111111111111'), serializedEmptyAcc],
        [hexToBytes('0x00111111111111111111111111111111'), serializedEmptyAcc],
      ],
      [
        [hexToBytes('0x00001111111111111111111111111111'), serializedEmptyAcc],
        [hexToBytes('0x00002111111111111111111111111111'), serializedEmptyAcc],
        [hexToBytes('0x00011111111111111111111111111111'), serializedEmptyAcc],
      ],
    ]

    for (const leaves of testcases) {
      const expected = await merkleizeViaTrie(leaves)
      const root = merkleizeList(leaves)
      assert.equal(
        JSON.stringify(root),
        JSON.stringify(expected),
        `Merkleized root ${bytesToHex(root)} should match ${bytesToHex(expected)}`
      )
    }
  })

  it('should merkleize multiple leaves', async () => {
    const serializedEmptyAcc = new Account().serialize()
    const leaves: Uint8Array[][] = [
      [keccak256(hexToBytes('0x' + '5'.repeat(20))), serializedEmptyAcc],
      [keccak256(hexToBytes('0x' + '3'.repeat(20))), serializedEmptyAcc],
      [keccak256(hexToBytes('0x' + '4'.repeat(20))), serializedEmptyAcc],
    ]
    const expected = await merkleizeViaTrie(leaves)
    const root = merkleizeList(leaves)
    assert.equal(
      JSON.stringify(root),
      JSON.stringify(expected),
      `Merkleized root ${bytesToHex(root)} should match ${bytesToHex(expected)}`
    )
  })

  it('should merkleize trie with embedded nodes', async () => {
    const value = Uint8Array.from([1, 1])
    const leaves: Uint8Array[][] = [
      [hexToBytes('0x' + '1'.repeat(32)), value],
      [hexToBytes('0x' + '2'.repeat(32)), value],
      [hexToBytes('0x' + '3'.repeat(32)), value],
    ]
    const expected = await merkleizeViaTrie(leaves)
    const root = merkleizeList(leaves)
    assert.equal(
      JSON.stringify(root),
      JSON.stringify(expected),
      `Merkleized root ${bytesToHex(root)} should match ${bytesToHex(expected)}`
    )
  })
})
