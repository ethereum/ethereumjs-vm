import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import {
  MAX_INTEGER,
  MAX_UINT64,
  SECP256K1_ORDER,
  bytesToBigInt,
  equalsBytes,
  hexToBytes,
  privateToPublic,
  toBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import {
  AccessList2930Transaction,
  Capability,
  FeeMarket1559Tx,
  LegacyTx,
  TransactionType,
  create1559FeeMarketTxFromBytesArray,
  createAccessList2930Tx,
  createAccessList2930TxFromBytesArray,
  createAccessList2930TxFromRLP,
  createFeeMarket1559Tx,
  createFeeMarket1559TxFromRLP,
  createLegacyTx,
  createLegacyTxFromBytesArray,
  createLegacyTxFromRLP,
  paramsTx,
} from '../src/index.js'

import { eip1559TxsData } from './testData/eip1559txs.js'
import { eip2930TxsData } from './testData/eip2930txs.js'
import { txsData } from './testData/txs.js'

import type { BaseTransaction } from '../src/baseTransaction.js'
import type { AccessList2930TxData, FeeMarketEIP1559TxData, LegacyTxData } from '../src/index.js'

describe('[BaseTransaction]', () => {
  // EIP-2930 is not enabled in Common by default (2021-03-06)
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })

  const legacyTxs: BaseTransaction<TransactionType.Legacy>[] = []
  for (const tx of txsData.slice(0, 4)) {
    legacyTxs.push(createLegacyTx(tx.data as LegacyTxData, { common }))
  }

  const eip2930Txs: BaseTransaction<TransactionType.AccessListEIP2930>[] = []
  for (const tx of eip2930TxsData) {
    eip2930Txs.push(createAccessList2930Tx(tx.data as AccessList2930TxData, { common }))
  }

  const eip1559Txs: BaseTransaction<TransactionType.FeeMarketEIP1559>[] = []
  for (const tx of eip1559TxsData) {
    eip1559Txs.push(createFeeMarket1559Tx(tx.data as FeeMarketEIP1559TxData, { common }))
  }

  const zero = new Uint8Array(0)
  const txTypes = [
    {
      class: LegacyTx,
      name: 'LegacyTx',
      type: TransactionType.Legacy,
      values: Array(6).fill(zero),
      txs: legacyTxs,
      fixtures: txsData,
      activeCapabilities: [],
      create: {
        txData: createLegacyTx,
        rlp: createLegacyTxFromRLP,
        bytesArray: createLegacyTxFromBytesArray,
      },
      notActiveCapabilities: [
        Capability.EIP1559FeeMarket,
        Capability.EIP2718TypedTransaction,
        Capability.EIP2930AccessLists,
        9999,
      ],
    },
    {
      class: AccessList2930Transaction,
      name: 'AccessList2930Transaction',
      type: TransactionType.AccessListEIP2930,
      values: [new Uint8Array([1])].concat(Array(7).fill(zero)),
      txs: eip2930Txs,
      fixtures: eip2930TxsData,
      activeCapabilities: [Capability.EIP2718TypedTransaction, Capability.EIP2930AccessLists],
      create: {
        txData: createAccessList2930Tx,
        rlp: createAccessList2930TxFromRLP,
        bytesArray: createAccessList2930TxFromBytesArray,
      },
      notActiveCapabilities: [Capability.EIP1559FeeMarket, 9999],
    },
    {
      class: FeeMarket1559Tx,
      name: 'FeeMarket1559Tx',
      type: TransactionType.FeeMarketEIP1559,
      values: [new Uint8Array([1])].concat(Array(8).fill(zero)),
      txs: eip1559Txs,
      fixtures: eip1559TxsData,
      activeCapabilities: [
        Capability.EIP1559FeeMarket,
        Capability.EIP2718TypedTransaction,
        Capability.EIP2930AccessLists,
      ],
      create: {
        txData: createFeeMarket1559Tx,
        rlp: createFeeMarket1559TxFromRLP,
        bytesArray: create1559FeeMarketTxFromBytesArray,
      },
      notActiveCapabilities: [9999],
    },
  ]

  it('Initialization', () => {
    for (const txType of txTypes) {
      let tx = txType.create.txData({}, { common })
      assert.equal(
        tx.common.hardfork(),
        'london',
        `${txType.name}: should initialize with correct HF provided`,
      )
      assert.ok(Object.isFrozen(tx), `${txType.name}: tx should be frozen by default`)

      const initCommon = new Common({
        chain: Mainnet,
        hardfork: Hardfork.London,
      })
      tx = txType.create.txData({}, { common: initCommon })
      assert.equal(
        tx.common.hardfork(),
        'london',
        `${txType.name}: should initialize with correct HF provided`,
      )

      initCommon.setHardfork(Hardfork.Byzantium)
      assert.equal(
        tx.common.hardfork(),
        'london',
        `${txType.name}: should stay on correct HF if outer common HF changes`,
      )

      tx = txType.create.txData({}, { common, freeze: false })
      assert.ok(
        !Object.isFrozen(tx),
        `${txType.name}: tx should not be frozen when freeze deactivated in options`,
      )

      const params = JSON.parse(JSON.stringify(paramsTx))
      params['1']['txGas'] = 30000 // 21000
      tx = txType.create.txData({}, { common, params })
      assert.equal(tx.common.param('txGas'), BigInt(30000), 'should use custom parameters provided')

      // Perform the same test as above, but now using a different construction method. This also implies that passing on the
      // options object works as expected.
      tx = txType.create.txData({}, { common, freeze: false })
      const rlpData = tx.serialize()

      tx = txType.create.rlp(rlpData, { common })
      assert.equal(
        tx.type,
        txType.type,
        `${txType.name}: fromSerializedTx() -> should initialize correctly`,
      )

      assert.ok(Object.isFrozen(tx), `${txType.name}: tx should be frozen by default`)

      tx = txType.create.rlp(rlpData, { common, freeze: false })
      assert.ok(
        !Object.isFrozen(tx),
        `${txType.name}: tx should not be frozen when freeze deactivated in options`,
      )

      tx = txType.create.bytesArray(txType.values as any, { common })
      assert.ok(Object.isFrozen(tx), `${txType.name}: tx should be frozen by default`)

      tx = txType.create.bytesArray(txType.values as any, { common, freeze: false })
      assert.ok(
        !Object.isFrozen(tx),
        `${txType.name}: tx should not be frozen when freeze deactivated in options`,
      )
    }
  })

  it('createWithdrawalFromBytesArray()', () => {
    let rlpData: any = legacyTxs[0].raw()
    rlpData[0] = toBytes('0x0')
    try {
      createLegacyTxFromBytesArray(rlpData)
      assert.fail('should have thrown when nonce has leading zeroes')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('nonce cannot have leading zeroes'),
        'should throw with nonce with leading zeroes',
      )
    }
    rlpData[0] = toBytes('0x')
    rlpData[6] = toBytes('0x0')
    try {
      createLegacyTxFromBytesArray(rlpData)
      assert.fail('should have thrown when v has leading zeroes')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('v cannot have leading zeroes'),
        'should throw with v with leading zeroes',
      )
    }
    rlpData = eip2930Txs[0].raw()
    rlpData[3] = toBytes('0x0')
    try {
      createAccessList2930TxFromBytesArray(rlpData)
      assert.fail('should have thrown when gasLimit has leading zeroes')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('gasLimit cannot have leading zeroes'),
        'should throw with gasLimit with leading zeroes',
      )
    }
    rlpData = eip1559Txs[0].raw()
    rlpData[2] = toBytes('0x0')
    try {
      create1559FeeMarketTxFromBytesArray(rlpData)
      assert.fail('should have thrown when maxPriorityFeePerGas has leading zeroes')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('maxPriorityFeePerGas cannot have leading zeroes'),
        'should throw with maxPriorityFeePerGas with leading zeroes',
      )
    }
  })

  it('serialize()', () => {
    for (const txType of txTypes) {
      for (const tx of txType.txs) {
        assert.ok(
          txType.create.rlp(tx.serialize(), { common }),
          `${txType.name}: should do roundtrip serialize() -> fromSerializedTx()`,
        )
        assert.ok(
          txType.create.rlp(tx.serialize(), { common }),
          `${txType.name}: should do roundtrip serialize() -> fromSerializedTx()`,
        )
      }
    }
  })

  it('supports()', () => {
    for (const txType of txTypes) {
      for (const tx of txType.txs) {
        for (const activeCapability of txType.activeCapabilities) {
          assert.ok(
            tx.supports(activeCapability),
            `${txType.name}: should recognize all supported capabilities`,
          )
        }
        for (const notActiveCapability of txType.notActiveCapabilities) {
          assert.notOk(
            tx.supports(notActiveCapability),
            `${txType.name}: should reject non-active existing and not existing capabilities`,
          )
        }
      }
    }
  })

  it('raw()', () => {
    for (const txType of txTypes) {
      for (const tx of txType.txs) {
        assert.ok(
          txType.create.bytesArray(tx.raw() as any, { common }),
          `${txType.name}: should do roundtrip raw() -> createWithdrawalFromBytesArray()`,
        )
      }
    }
  })

  it('verifySignature()', () => {
    for (const txType of txTypes) {
      for (const tx of txType.txs) {
        assert.equal(tx.verifySignature(), true, `${txType.name}: signature should be valid`)
      }
    }
  })

  it('verifySignature() -> invalid', () => {
    for (const txType of txTypes) {
      for (const txFixture of txType.fixtures.slice(0, 4)) {
        // set `s` to a single zero
        txFixture.data.s = '0x' + '0'
        const tx = txType.create.txData((txFixture as any).data, { common })
        assert.equal(tx.verifySignature(), false, `${txType.name}: signature should not be valid`)
        assert.ok(
          tx.getValidationErrors().includes('Invalid Signature'),
          `${txType.name}: should return an error string about not verifying signatures`,
        )
        assert.notOk(tx.isValid(), `${txType.name}: should not validate correctly`)
      }
    }
  })

  it('sign()', () => {
    for (const txType of txTypes) {
      for (const [i, tx] of txType.txs.entries()) {
        const { privateKey } = txType.fixtures[i]
        if (privateKey !== undefined) {
          assert.ok(tx.sign(hexToBytes(`0x${privateKey}`)), `${txType.name}: should sign tx`)
        }

        assert.throws(
          () => tx.sign(utf8ToBytes('invalid')),
          undefined,
          undefined,
          `${txType.name}: should fail with invalid PK`,
        )
      }
    }
  })

  it('isSigned() -> returns correct values', () => {
    for (const txType of txTypes) {
      const txs = [
        ...txType.txs,
        // add unsigned variants
        ...txType.txs.map((tx) =>
          txType.create.txData({
            ...tx,
            v: undefined,
            r: undefined,
            s: undefined,
          }),
        ),
      ]
      for (const tx of txs) {
        assert.equal(
          tx.isSigned(),
          tx.v !== undefined && tx.r !== undefined && tx.s !== undefined,
          'isSigned() returns correctly',
        )
      }
    }
  })

  it('getSenderAddress()', () => {
    for (const txType of txTypes) {
      for (const [i, tx] of txType.txs.entries()) {
        const { privateKey, sendersAddress } = txType.fixtures[i]
        if (privateKey !== undefined) {
          const signedTx = tx.sign(hexToBytes(`0x${privateKey}`))
          assert.equal(
            signedTx.getSenderAddress().toString(),
            `0x${sendersAddress}`,
            `${txType.name}: should get sender's address after signing it`,
          )
        }
      }
    }
  })

  it('getSenderPublicKey()', () => {
    for (const txType of txTypes) {
      for (const [i, tx] of txType.txs.entries()) {
        const { privateKey } = txType.fixtures[i]
        if (privateKey !== undefined) {
          const signedTx = tx.sign(hexToBytes(`0x${privateKey}`))
          const txPubKey = signedTx.getSenderPublicKey()
          const pubKeyFromPriv = privateToPublic(hexToBytes(`0x${privateKey}`))
          assert.ok(
            equalsBytes(txPubKey, pubKeyFromPriv),
            `${txType.name}: should get sender's public key after signing it`,
          )
        }
      }
    }
  })

  it('getSenderPublicKey() -> should throw if s-value is greater than secp256k1n/2', () => {
    // EIP-2: All transaction signatures whose s-value is greater than secp256k1n/2 are considered invalid.
    // Reasoning: https://ethereum.stackexchange.com/a/55728
    for (const txType of txTypes) {
      for (const [i, tx] of txType.txs.entries()) {
        const { privateKey } = txType.fixtures[i]
        if (privateKey !== undefined) {
          let signedTx = tx.sign(hexToBytes(`0x${privateKey}`))
          signedTx = JSON.parse(JSON.stringify(signedTx)) // deep clone
          ;(signedTx as any).s = SECP256K1_ORDER + BigInt(1)
          assert.throws(
            () => {
              signedTx.getSenderPublicKey()
            },
            undefined,
            undefined,
            'should throw when s-value is greater than secp256k1n/2',
          )
        }
      }
    }
  })

  it('verifySignature()', () => {
    for (const txType of txTypes) {
      for (const [i, tx] of txType.txs.entries()) {
        const { privateKey } = txType.fixtures[i]
        if (privateKey !== undefined) {
          const signedTx = tx.sign(hexToBytes(`0x${privateKey}`))
          assert.ok(signedTx.verifySignature(), `${txType.name}: should verify signing it`)
        }
      }
    }
  })

  it('initialization with defaults', () => {
    const bufferZero = toBytes('0x')
    const tx = createLegacyTx({
      nonce: undefined,
      gasLimit: undefined,
      gasPrice: undefined,
      to: undefined,
      value: undefined,
      data: undefined,
      v: undefined,
      r: undefined,
      s: undefined,
    })
    assert.equal(tx.v, undefined)
    assert.equal(tx.r, undefined)
    assert.equal(tx.s, undefined)
    assert.deepEqual(tx.to, undefined)
    assert.equal(tx.value, bytesToBigInt(bufferZero))
    assert.deepEqual(tx.data, bufferZero)
    assert.equal(tx.gasPrice, bytesToBigInt(bufferZero))
    assert.equal(tx.gasLimit, bytesToBigInt(bufferZero))
    assert.equal(tx.nonce, bytesToBigInt(bufferZero))
  })

  it('_validateCannotExceedMaxInteger()', () => {
    const tx = createFeeMarket1559Tx(eip1559Txs[0])
    try {
      ;(tx as any)._validateCannotExceedMaxInteger({ a: MAX_INTEGER }, 256, true)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('equal or exceed MAX_INTEGER'),
        'throws when value equals or exceeds MAX_INTEGER',
      )
    }
    try {
      ;(tx as any)._validateCannotExceedMaxInteger({ a: MAX_INTEGER + BigInt(1) }, 256, false)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('exceed MAX_INTEGER'), 'throws when value exceeds MAX_INTEGER')
    }
    try {
      ;(tx as any)._validateCannotExceedMaxInteger({ a: BigInt(0) }, 100, false)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('unimplemented bits value'),
        'throws when bits value other than 64 or 256 provided',
      )
    }
    try {
      ;(tx as any)._validateCannotExceedMaxInteger({ a: MAX_UINT64 + BigInt(1) }, 64, false)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('2^64'), 'throws when 64 bit integer exceeds MAX_UINT64')
    }
    try {
      ;(tx as any)._validateCannotExceedMaxInteger({ a: MAX_UINT64 }, 64, true)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('2^64'),
        'throws when 64 bit integer equals or exceeds MAX_UINT64',
      )
    }
  })
})
