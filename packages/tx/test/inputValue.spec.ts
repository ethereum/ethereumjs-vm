import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { Address, hexToBytes, toBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import {
  TransactionType,
  create1559FeeMarketTxFromBytesArray,
  createAccessList2930TxFromBytesArray,
  createLegacyTx,
  createLegacyTxFromBytesArray,
  createTx,
} from '../src/index.js'

import type { TxValuesArray } from '../src/index.js'
import type { AddressLike, BigIntLike, BytesLike, PrefixedHexString } from '@ethereumjs/util'

// @returns: Array with subtypes of the AddressLike type for a given address
function generateAddressLikeValues(address: PrefixedHexString): AddressLike[] {
  return [address, toBytes(address), new Address(toBytes(address))]
}

// @returns: Array with subtypes of the BigIntLike type for a given number
function generateBigIntLikeValues(value: number): BigIntLike[] {
  return [value, BigInt(value), `0x${value.toString(16)}`, toBytes(value)]
}

// @returns: Array with subtypes of the BytesLike type for a given string
function generateBytesLikeValues(value: PrefixedHexString): BytesLike[] {
  return [value, toBytes(value)]
}

interface GenerateCombinationsArgs {
  options: { [x: string]: any }
  optionIndex?: number
  results?: { [x: string]: any }[]
  current?: { [x: string]: any }
}

export function generateCombinations({
  options,
  optionIndex = 0,
  results = [],
  current = {},
}: GenerateCombinationsArgs) {
  const allKeys = Object.keys(options)
  const optionKey = allKeys[optionIndex]
  const values = options[optionKey]

  for (let i = 0; i < values.length; i++) {
    current[optionKey] = values[i]

    if (optionIndex + 1 < allKeys.length) {
      generateCombinations({ options, optionIndex: optionIndex + 1, results, current })
    } else {
      // Clone the object
      const res = { ...current }
      results.push(res)
    }
  }

  return results
}

// Deterministic pseudorandom number generator
function mulberry32(seed: number) {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function getRandomSubarray<TArrayItem>(array: TArrayItem[], size: number) {
  const shuffled = array.slice(0)
  let seed = 1559
  let index: number
  let length = array.length
  let temp: TArrayItem
  while (length > 0) {
    index = Math.floor((length + 1) * mulberry32(seed))
    temp = shuffled[index]
    shuffled[index] = shuffled[length]
    shuffled[length] = temp
    seed++
    length--
  }
  return shuffled.slice(0, size)
}

const baseTxValues = {
  data: generateBytesLikeValues('0x65'),
  gasLimit: generateBigIntLikeValues(100000),
  nonce: generateBigIntLikeValues(0),
  to: generateAddressLikeValues('0x0000000000000000000000000000000000000000'),
  r: generateBigIntLikeValues(100),
  s: generateBigIntLikeValues(100),
  value: generateBigIntLikeValues(10),
}

const legacyTxValues = {
  gasPrice: generateBigIntLikeValues(100),
}

const accessListEip2930TxValues = {
  chainId: generateBigIntLikeValues(4),
}

const eip1559TxValues = {
  maxFeePerGas: generateBigIntLikeValues(100),
  maxPriorityFeePerGas: generateBigIntLikeValues(50),
}

describe('[Transaction Input Values]', () => {
  it('Legacy Transaction Values', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Homestead })
    const options = { ...baseTxValues, ...legacyTxValues, type: '0' }
    const legacyTxData = generateCombinations({
      options,
    })
    const randomSample = getRandomSubarray(legacyTxData, 100)
    for (const txData of randomSample) {
      const tx = createLegacyTx(txData, { common })
      assert.throws(() => tx.hash(), undefined, undefined, 'tx.hash() throws if tx is unsigned')
    }
  })

  it('EIP-1559 Transaction Values', () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const options = {
      ...baseTxValues,
      ...accessListEip2930TxValues,
      ...eip1559TxValues,
      type: '2',
    }
    const eip1559TxData = generateCombinations({
      options,
    })
    const randomSample = getRandomSubarray(eip1559TxData, 100)

    for (const txData of randomSample) {
      const tx = createLegacyTx(txData, { common })
      assert.throws(() => tx.hash(), undefined, undefined, 'tx.hash() should throw if unsigned')
    }
  })
})

describe('[Invalid Array Input values]', () => {
  it('should work', () => {
    const txTypes = [
      TransactionType.Legacy,
      TransactionType.AccessListEIP2930,
      TransactionType.FeeMarketEIP1559,
    ]
    for (const signed of [false, true]) {
      for (const txType of txTypes) {
        let tx = createTx({ type: txType })
        if (signed) {
          tx = tx.sign(hexToBytes(`0x${'42'.repeat(32)}`))
        }
        const rawValues = tx.raw()
        for (let x = 0; x < rawValues.length; x++) {
          rawValues[x] = <any>[1, 2, 3]
          switch (txType) {
            case TransactionType.Legacy:
              assert.throws(() =>
                createLegacyTxFromBytesArray(rawValues as TxValuesArray[TransactionType.Legacy]),
              )
              break
            case TransactionType.AccessListEIP2930:
              assert.throws(() =>
                createAccessList2930TxFromBytesArray(
                  rawValues as TxValuesArray[TransactionType.AccessListEIP2930],
                ),
              )
              break
            case TransactionType.FeeMarketEIP1559:
              assert.throws(() =>
                create1559FeeMarketTxFromBytesArray(
                  rawValues as TxValuesArray[TransactionType.FeeMarketEIP1559],
                ),
              )
              break
          }
        }
      }
    }
  })
})

describe('[Invalid Access Lists]', () => {
  it('should work', () => {
    const txTypes = [TransactionType.AccessListEIP2930, TransactionType.FeeMarketEIP1559]
    const invalidAccessLists = [
      [[]], // does not have an address and does not have slots
      [[[], []]], // the address is an array
      [['0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae']], // there is no storage slot array
      [
        [
          '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
          ['0x0000000000000000000000000000000000000000000000000000000000000003', []],
        ],
      ], // one of the slots is an array
      [
        [
          '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
          ['0x0000000000000000000000000000000000000000000000000000000000000003'],
          '0xab',
        ],
      ], // extra field
      [
        '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
        ['0x0000000000000000000000000000000000000000000000000000000000000003'],
      ], // account/slot needs to be encoded in a deeper array layer
    ]
    for (const signed of [false, true]) {
      for (const txType of txTypes) {
        for (const invalidAccessListItem of invalidAccessLists) {
          let tx: any
          try {
            tx = createTx({
              type: txType,
              accessList: <any>invalidAccessListItem,
            })
            if (signed) {
              tx = tx.sign(hexToBytes(`0x${'42'.repeat(32)}`))
            }
            assert.fail('did not fail on `fromTxData`')
          } catch (e) {
            if (!(e instanceof Error)) {
              e = new Error(e)
            }
            assert.ok(true, 'failed ok on decoding in `fromTxData`')
            tx = createTx({ type: txType })
            if (signed) {
              tx = tx.sign(hexToBytes(`0x${'42'.repeat(32)}`))
            }
          }
          const rawValues = tx!.raw()

          if (txType === TransactionType.AccessListEIP2930 && rawValues[7].length === 0) {
            rawValues[7] = invalidAccessListItem
          } else if (txType === TransactionType.FeeMarketEIP1559 && rawValues[8].length === 0) {
            rawValues[8] = invalidAccessListItem
          }

          switch (txType) {
            case TransactionType.AccessListEIP2930:
              assert.throws(() =>
                createAccessList2930TxFromBytesArray(
                  rawValues as TxValuesArray[TransactionType.AccessListEIP2930],
                ),
              )
              break
            case TransactionType.FeeMarketEIP1559:
              assert.throws(() =>
                create1559FeeMarketTxFromBytesArray(
                  rawValues as TxValuesArray[TransactionType.FeeMarketEIP1559],
                ),
              )
              break
          }
        }
      }
    }
  })
})
