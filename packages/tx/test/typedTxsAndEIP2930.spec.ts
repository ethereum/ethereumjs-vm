import { Common, Goerli, Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import {
  Address,
  MAX_INTEGER,
  MAX_UINT64,
  SECP256K1_ORDER_DIV_2,
  bytesToBigInt,
  bytesToHex,
  concatBytes,
  ecsign,
  equalsBytes,
  hexToBytes,
  privateToAddress,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import {
  AccessList2930Transaction,
  FeeMarket1559Tx,
  TransactionType,
  createAccessList2930Tx,
  createAccessList2930TxFromBytesArray,
  createAccessList2930TxFromRLP,
  createFeeMarket1559Tx,
  createFeeMarket1559TxFromRLP,
  paramsTx,
} from '../src/index.js'

import type { AccessList, AccessListBytesItem, JSONTx } from '../src/index.js'

const pKey = hexToBytes('0x4646464646464646464646464646464646464646464646464646464646464646')
const address = privateToAddress(pKey)

const common = new Common({
  chain: Mainnet,
  hardfork: Hardfork.London,
  params: paramsTx,
})

const txTypes = [
  {
    class: AccessList2930Transaction,
    name: 'AccessList2930Transaction',
    type: TransactionType.AccessListEIP2930,
    create: {
      txData: createAccessList2930Tx,
      rlp: createAccessList2930TxFromRLP,
    },
  },
  {
    class: FeeMarket1559Tx,
    name: 'FeeMarket1559Tx',
    type: TransactionType.FeeMarketEIP1559,
    create: {
      txData: createFeeMarket1559Tx,
      rlp: createFeeMarket1559TxFromRLP,
    },
  },
]

const validAddress = hexToBytes(`0x${'01'.repeat(20)}`)
const validSlot = hexToBytes(`0x${'01'.repeat(32)}`)
const chainId = 1

describe('[AccessList2930Transaction / FeeMarket1559Tx] -> EIP-2930 Compatibility', () => {
  it('Initialization / Getter -> fromTxData()', () => {
    for (const txType of txTypes) {
      let tx = txType.create.txData({}, { common })
      assert.ok(tx, `should initialize correctly (${txType.name})`)

      tx = txType.create.txData(
        {
          chainId: 5,
        },
        { common: new Common({ chain: Goerli }) },
      )
      assert.ok(
        tx.common.chainId() === BigInt(5),
        'should initialize Common with chain ID provided (supported chain ID)',
      )

      const nonEIP2930Common = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
      assert.throws(
        () => {
          txType.create.txData({}, { common: nonEIP2930Common })
        },
        undefined,
        undefined,
        `should throw on a pre-Berlin Hardfork (EIP-2930 not activated) (${txType.name})`,
      )

      assert.throws(
        () => {
          txType.create.txData(
            {
              chainId: chainId + 1,
            },
            { common },
          )
        },
        undefined,
        undefined,
        `should reject transactions with wrong chain ID (${txType.name})`,
      )

      assert.throws(
        () => {
          txType.create.txData(
            {
              v: 2,
            },
            { common },
          )
        },
        undefined,
        undefined,
        `should reject transactions with invalid yParity (v) values (${txType.name})`,
      )
    }
  })

  it(`cannot input decimal values`, () => {
    const values = ['chainId', 'nonce', 'gasPrice', 'gasLimit', 'value', 'v', 'r', 's']
    const cases = [
      10.1,
      '10.1',
      '0xaa.1',
      -10.1,
      -1,
      BigInt(-10),
      '-100',
      '-10.1',
      '-0xaa',
      Infinity,
      -Infinity,
      NaN,
      {},
      true,
      false,
      () => {},
      Number.MAX_SAFE_INTEGER + 1,
    ]
    for (const value of values) {
      const txData: any = {}
      for (const testCase of cases) {
        if (
          !(
            value === 'chainId' &&
            ((typeof testCase === 'number' && isNaN(<number>testCase)) || testCase === false)
          )
        ) {
          txData[value] = testCase
          assert.throws(() => {
            createAccessList2930Tx(txData)
          })
        }
      }
    }
  })

  it('Initialization / Getter -> fromSerializedTx()', () => {
    for (const txType of txTypes) {
      try {
        txType.create.rlp(new Uint8Array([99]), {})
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        assert.ok(
          e.message.includes('wrong tx type'),
          `should throw on wrong tx type (${txType.name})`,
        )
      }

      try {
        // Correct tx type + RLP-encoded 5
        const serialized = concatBytes(new Uint8Array([txType.type]), new Uint8Array([5]))
        txType.create.rlp(serialized, {})
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        assert.ok(
          e.message.includes('must be array'),
          `should throw when RLP payload not an array (${txType.name})`,
        )
      }

      try {
        // Correct tx type + RLP-encoded empty list
        const serialized = concatBytes(new Uint8Array([txType.type]), hexToBytes('0xc0'))
        txType.create.rlp(serialized, {})
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        assert.ok(
          e.message.includes('values (for unsigned tx)'),
          `should throw with invalid number of values (${txType.name})`,
        )
      }
    }
  })

  it('Access Lists -> success cases', () => {
    for (const txType of txTypes) {
      const access: AccessList = [
        {
          address: bytesToHex(validAddress),
          storageKeys: [bytesToHex(validSlot)],
        },
      ]
      const txn = txType.create.txData(
        {
          accessList: access,
          chainId: 1,
        },
        { common },
      )

      // Check if everything is converted

      const bytes = txn.accessList
      const JSON = txn.AccessListJSON

      assert.ok(equalsBytes(bytes[0][0], validAddress))
      assert.ok(equalsBytes(bytes[0][1][0], validSlot))

      assert.deepEqual(JSON, access, `should allow json-typed access lists (${txType.name})`)

      // also verify that we can always get the json access list, even if we don't provide one.

      const txnRaw = txType.create.txData(
        {
          accessList: bytes,
          chainId: 1,
        },
        { common },
      )

      const JSONRaw = txnRaw.AccessListJSON

      assert.deepEqual(JSONRaw, access, `should allow json-typed access lists (${txType.name})`)
    }
  })

  it('Access Lists -> error cases', () => {
    for (const txType of txTypes) {
      let accessList: any[] = [
        [
          hexToBytes(`0x${'01'.repeat(21)}`), // Address of 21 bytes instead of 20
          [],
        ],
      ]

      assert.throws(
        () => {
          txType.create.txData({ chainId, accessList }, { common })
        },
        undefined,
        undefined,
        txType.name,
      )

      accessList = [
        [
          validAddress,
          [
            hexToBytes(`0x${'01'.repeat(31)}`), // Slot of 31 bytes instead of 32
          ],
        ],
      ]

      assert.throws(
        () => {
          txType.create.txData({ chainId, accessList }, { common })
        },
        undefined,
        undefined,
        txType.name,
      )

      accessList = [[]] // Address does not exist

      assert.throws(
        () => {
          txType.create.txData({ chainId, accessList }, { common })
        },
        undefined,
        undefined,
        txType.name,
      )

      accessList = [[validAddress]] // Slots does not exist

      assert.throws(
        () => {
          txType.create.txData({ chainId, accessList }, { common })
        },
        undefined,
        undefined,
        txType.name,
      )

      accessList = [[validAddress, validSlot]] // Slots is not an array

      assert.throws(
        () => {
          txType.create.txData({ chainId, accessList }, { common })
        },
        undefined,
        undefined,
        txType.name,
      )

      accessList = [[validAddress, [], []]] // 3 items where 2 are expected

      assert.throws(
        () => {
          txType.create.txData({ chainId, accessList }, { common })
        },
        undefined,
        undefined,
        txType.name,
      )
    }
  })

  it('sign()', () => {
    for (const txType of txTypes) {
      let tx = txType.create.txData(
        {
          data: hexToBytes('0x010200'),
          to: validAddress,
          accessList: [[validAddress, [validSlot]]],
          chainId,
        },
        { common },
      )
      let signed = tx.sign(pKey)
      const signedAddress = signed.getSenderAddress()
      assert.ok(
        equalsBytes(signedAddress.bytes, address),
        `should sign a transaction (${txType.name})`,
      )
      signed.verifySignature() // If this throws, test will not end.

      tx = txType.create.txData({}, { common })
      signed = tx.sign(pKey)

      assert.deepEqual(
        tx.accessList,
        [],
        `should create and sign transactions without passing access list value (${txType.name})`,
      )
      assert.deepEqual(signed.accessList, [])

      tx = txType.create.txData({}, { common })

      assert.throws(
        () => {
          tx.hash()
        },
        undefined,
        undefined,
        `should throw calling hash with unsigned tx (${txType.name})`,
      )

      assert.throws(() => {
        tx.getSenderPublicKey()
      })

      assert.throws(
        () => {
          const high = SECP256K1_ORDER_DIV_2 + BigInt(1)
          const tx = txType.create.txData({ s: high, r: 1, v: 1 }, { common })
          const signed = tx.sign(pKey)
          signed.getSenderPublicKey()
        },
        undefined,
        undefined,
        `should throw with invalid s value (${txType.name})`,
      )
    }
  })

  it('addSignature() -> correctly adds correct signature values', () => {
    const privateKey = pKey
    const tx = createAccessList2930Tx({})
    const signedTx = tx.sign(privateKey)
    const addSignatureTx = tx.addSignature(signedTx.v!, signedTx.r!, signedTx.s!)

    assert.deepEqual(signedTx.toJSON(), addSignatureTx.toJSON())
  })

  it('addSignature() -> correctly converts raw ecrecover values', () => {
    const privKey = pKey
    const tx = createAccessList2930Tx({})

    const msgHash = tx.getHashedMessageToSign()
    const { v, r, s } = ecsign(msgHash, privKey)

    const signedTx = tx.sign(privKey)
    const addSignatureTx = tx.addSignature(v, r, s, true)

    assert.deepEqual(signedTx.toJSON(), addSignatureTx.toJSON())
  })

  it('addSignature() -> throws when adding the wrong v value', () => {
    const privKey = pKey
    const tx = createAccessList2930Tx({})

    const msgHash = tx.getHashedMessageToSign()
    const { v, r, s } = ecsign(msgHash, privKey)

    assert.throws(() => {
      // This will throw, since we now try to set either v=27 or v=28
      tx.addSignature(v, r, s, false)
    })
  })

  it('getDataGas()', () => {
    for (const txType of txTypes) {
      let tx = txType.create.txData({}, { common })
      assert.equal(tx.getDataGas(), BigInt(0), 'Should return data fee when frozen')

      tx = txType.create.txData({}, { common, freeze: false })
      assert.equal(tx.getDataGas(), BigInt(0), 'Should return data fee when not frozen')

      const mutableCommon = new Common({ chain: Mainnet, hardfork: Hardfork.London })
      tx = txType.create.txData({}, { common: mutableCommon })
      tx.common.setHardfork(Hardfork.Istanbul)
      assert.equal(tx.getDataGas(), BigInt(0), 'Should invalidate cached value on hardfork change')
    }
  })
})

describe('[AccessList2930Transaction] -> Class Specific Tests', () => {
  it(`Initialization`, () => {
    const tx = createAccessList2930Tx({}, { common })
    assert.ok(
      createAccessList2930Tx(tx, { common }),
      'should initialize correctly from its own data',
    )

    const validAddress = hexToBytes(`0x${'01'.repeat(20)}`)
    const validSlot = hexToBytes(`0x${'01'.repeat(32)}`)
    const chainId = BigInt(1)
    try {
      createAccessList2930Tx(
        {
          data: hexToBytes('0x010200'),
          to: validAddress,
          accessList: [[validAddress, [validSlot]]],
          chainId,
          gasLimit: MAX_UINT64,
          gasPrice: MAX_INTEGER,
        },
        { common },
      )
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('gasLimit * gasPrice cannot exceed MAX_INTEGER'),
        'throws when gasLimit * gasPrice exceeds MAX_INTEGER',
      )
    }
  })

  assert.throws(
    () => {
      const bytes = new Uint8Array(0)
      const address = new Uint8Array(0)
      const storageKeys = [new Uint8Array(0), new Uint8Array(0)]
      const aclBytes: AccessListBytesItem = [address, storageKeys]
      createAccessList2930TxFromBytesArray(
        [bytes, bytes, bytes, bytes, bytes, bytes, bytes, [aclBytes], bytes],
        {},
      )
    },
    undefined,
    undefined,
    'should throw with values array with length different than 8 or 11',
  )

  it(`should return right upfront cost`, () => {
    let tx = createAccessList2930Tx(
      {
        data: hexToBytes('0x010200'),
        to: validAddress,
        accessList: [[validAddress, [validSlot]]],
        chainId,
      },
      { common },
    )
    // Cost should be:
    // Base fee + 2*TxDataNonZero + TxDataZero + AccessListAddressCost + AccessListSlotCost
    const txDataZero: number = Number(common.param('txDataZeroGas'))
    const txDataNonZero: number = Number(common.param('txDataNonZeroGas'))
    const accessListStorageKeyCost: number = Number(common.param('accessListStorageKeyGas'))
    const accessListAddressCost: number = Number(common.param('accessListAddressGas'))
    const baseFee: number = Number(common.param('txGas'))
    const creationFee: number = Number(common.param('txCreationGas'))

    assert.ok(
      tx.getIntrinsicGas() ===
        BigInt(
          txDataNonZero * 2 +
            txDataZero +
            baseFee +
            accessListAddressCost +
            accessListStorageKeyCost,
        ),
    )

    // In this Tx, `to` is `undefined`, so we should charge homestead creation gas.
    tx = createAccessList2930Tx(
      {
        data: hexToBytes('0x010200'),
        accessList: [[validAddress, [validSlot]]],
        chainId,
      },
      { common },
    )

    assert.ok(
      tx.getIntrinsicGas() ===
        BigInt(
          txDataNonZero * 2 +
            txDataZero +
            creationFee +
            baseFee +
            accessListAddressCost +
            accessListStorageKeyCost,
        ),
    )

    // Explicitly check that even if we have duplicates in our list, we still charge for those
    tx = createAccessList2930Tx(
      {
        to: validAddress,
        accessList: [
          [validAddress, [validSlot]],
          [validAddress, [validSlot, validSlot]],
        ],
        chainId,
      },
      { common },
    )

    assert.ok(
      tx.getIntrinsicGas() ===
        BigInt(baseFee + accessListAddressCost * 2 + accessListStorageKeyCost * 3),
    )
  })

  it('getEffectivePriorityFee() -> should return correct values', () => {
    const tx = createAccessList2930Tx({
      gasPrice: BigInt(100),
    })

    assert.equal(tx.getEffectivePriorityFee(), BigInt(100))
    assert.equal(tx.getEffectivePriorityFee(BigInt(20)), BigInt(80))
    assert.equal(tx.getEffectivePriorityFee(BigInt(100)), BigInt(0))
    assert.throws(() => tx.getEffectivePriorityFee(BigInt(101)))
  })

  it('getUpfrontCost() -> should return upfront cost', () => {
    const tx = createAccessList2930Tx(
      {
        gasPrice: 1000,
        gasLimit: 10000000,
        value: 42,
      },
      { common },
    )
    assert.equal(tx.getUpfrontCost(), BigInt(10000000042))
  })

  it('unsigned tx -> getHashedMessageToSign()/getMessageToSign()', () => {
    const unsignedTx = createAccessList2930Tx(
      {
        data: hexToBytes('0x010200'),
        to: validAddress,
        accessList: [[validAddress, [validSlot]]],
        chainId,
      },
      { common },
    )
    const expectedHash = hexToBytes(
      '0x78528e2724aa359c58c13e43a7c467eb721ce8d410c2a12ee62943a3aaefb60b',
    )
    assert.deepEqual(unsignedTx.getHashedMessageToSign(), expectedHash), 'correct hashed version'

    const expectedSerialization = hexToBytes(
      '0x01f858018080809401010101010101010101010101010101010101018083010200f838f7940101010101010101010101010101010101010101e1a00101010101010101010101010101010101010101010101010101010101010101',
    )
    assert.deepEqual(
      unsignedTx.getMessageToSign(),
      expectedSerialization,
      'correct serialized unhashed version',
    )
  })

  // Data from
  // https://github.com/INFURA/go-ethlibs/blob/75b2a52a39d353ed8206cffaf68d09bd1b154aae/eth/transaction_signing_test.go#L87

  it('should sign transaction correctly and return expected JSON', () => {
    const address = hexToBytes('0x0000000000000000000000000000000000001337')
    const slot1 = hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000')
    const txData = {
      data: hexToBytes('0x'),
      gasLimit: 0x62d4,
      gasPrice: 0x3b9aca00,
      nonce: 0x00,
      to: new Address(hexToBytes('0xdf0a88b2b68c673713a8ec826003676f272e3573')),
      value: 0x01,
      chainId: bytesToBigInt(hexToBytes('0x796f6c6f763378')),
      accessList: <any>[[address, [slot1]]],
    }

    const customChainParams = {
      name: 'custom',
      chainId: txData.chainId.toString(),
      eips: [2718, 2929, 2930],
    }
    const usedCommon = createCustomCommon(customChainParams, Mainnet, {
      hardfork: Hardfork.Berlin,
    })
    usedCommon.setEIPs([2718, 2929, 2930])

    const expectedUnsignedRaw = hexToBytes(
      '0x01f86587796f6c6f76337880843b9aca008262d494df0a88b2b68c673713a8ec826003676f272e35730180f838f7940000000000000000000000000000000000001337e1a00000000000000000000000000000000000000000000000000000000000000000808080',
    )
    const pkey = hexToBytes('0xfad9c8855b740a0b7ed4c221dbad0f33a83a49cad6b3fe8d5817ac83d38b6a19')
    const expectedSigned = hexToBytes(
      '0x01f8a587796f6c6f76337880843b9aca008262d494df0a88b2b68c673713a8ec826003676f272e35730180f838f7940000000000000000000000000000000000001337e1a0000000000000000000000000000000000000000000000000000000000000000080a0294ac94077b35057971e6b4b06dfdf55a6fbed819133a6c1d31e187f1bca938da00be950468ba1c25a5cb50e9f6d8aa13c8cd21f24ba909402775b262ac76d374d',
    )
    const expectedHash = hexToBytes(
      '0xbbd570a3c6acc9bb7da0d5c0322fe4ea2a300db80226f7df4fef39b2d6649eec',
    )
    const v = BigInt(0)
    const r = bytesToBigInt(
      hexToBytes('0x294ac94077b35057971e6b4b06dfdf55a6fbed819133a6c1d31e187f1bca938d'),
    )
    const s = bytesToBigInt(
      hexToBytes('0x0be950468ba1c25a5cb50e9f6d8aa13c8cd21f24ba909402775b262ac76d374d'),
    )

    const unsignedTx = createAccessList2930Tx(txData, { common: usedCommon })

    const serializedMessageRaw = unsignedTx.serialize()

    assert.ok(
      equalsBytes(expectedUnsignedRaw, serializedMessageRaw),
      'serialized unsigned message correct',
    )

    const signed = unsignedTx.sign(pkey)

    assert.ok(v === signed.v!, 'v correct')
    assert.ok(r === signed.r!, 'r correct')
    assert.ok(s === signed.s!, 's correct')
    assert.ok(equalsBytes(expectedSigned, signed.serialize()), 'serialized signed message correct')
    assert.ok(equalsBytes(expectedHash, signed.hash()), 'hash correct')

    const expectedJSON: JSONTx = {
      type: '0x1',
      chainId: '0x796f6c6f763378',
      nonce: '0x0',
      gasPrice: '0x3b9aca00',
      gasLimit: '0x62d4',
      to: '0xdf0a88b2b68c673713a8ec826003676f272e3573',
      value: '0x1',
      data: '0x',
      accessList: [
        {
          address: '0x0000000000000000000000000000000000001337',
          storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
        },
      ],
      v: '0x0',
      r: '0x294ac94077b35057971e6b4b06dfdf55a6fbed819133a6c1d31e187f1bca938d',
      s: '0xbe950468ba1c25a5cb50e9f6d8aa13c8cd21f24ba909402775b262ac76d374d',
      yParity: '0x0',
    }

    assert.deepEqual(signed.toJSON(), expectedJSON)
  })

  it('freeze property propagates from unsigned tx to signed tx', () => {
    const tx = createAccessList2930Tx({}, { freeze: false })
    assert.notOk(Object.isFrozen(tx), 'tx object is not frozen')
    const signedTxn = tx.sign(pKey)
    assert.notOk(Object.isFrozen(signedTxn), 'tx object is not frozen')
  })

  it('common propagates from the common of tx, not the common in TxOptions', () => {
    const txn = createAccessList2930Tx({}, { common, freeze: false })
    const newCommon = new Common({ chain: Mainnet, hardfork: Hardfork.Paris })
    assert.notDeepEqual(newCommon, common, 'new common is different than original common')
    Object.defineProperty(txn, 'common', {
      get() {
        return newCommon
      },
    })
    const signedTxn = txn.sign(pKey)
    assert.ok(
      signedTxn.common.hardfork() === Hardfork.Paris,
      'signed tx common is taken from tx.common',
    )
  })
})
