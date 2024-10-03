import { Hardfork, createCommonFromGethGenesis } from '@ethereumjs/common'
import {
  blobsToCommitments,
  blobsToProofs,
  bytesToHex,
  commitmentsToVersionedHashes,
  concatBytes,
  createZeroAddress,
  ecsign,
  equalsBytes,
  getBlobs,
  hexToBytes,
  randomBytes,
} from '@ethereumjs/util'
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'
import { assert, describe, it } from 'vitest'

import { hardfork4844Data } from '../../block/test/testdata/4844-hardfork.js'
import {
  blobTxNetworkWrapperToJSON,
  createBlob4844Tx,
  createBlob4844TxFromRLP,
  createBlob4844TxFromSerializedNetworkWrapper,
  createMinimal4844TxFromNetworkWrapper,
  createTx,
  paramsTx,
} from '../src/index.js'

import { serialized4844TxData } from './testData/serialized4844tx.js'

import type { BlobEIP4844TxData } from '../src/index.js'
import type { PrefixedHexString } from '@ethereumjs/util'

const pk = randomBytes(32)
const kzg = new microEthKZG(trustedSetup)
describe('EIP4844 addSignature tests', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    customCrypto: { kzg },
  })

  it('addSignature() -> correctly adds correct signature values', () => {
    const privateKey = pk
    const tx = createBlob4844Tx(
      {
        to: createZeroAddress(),
        blobVersionedHashes: [concatBytes(new Uint8Array([1]), randomBytes(31))],
      },
      { common },
    )
    const signedTx = tx.sign(privateKey)
    const addSignatureTx = tx.addSignature(signedTx.v!, signedTx.r!, signedTx.s!)

    assert.deepEqual(signedTx.toJSON(), addSignatureTx.toJSON())
  })

  it('addSignature() -> correctly converts raw ecrecover values', () => {
    const privKey = pk
    const tx = createBlob4844Tx(
      {
        to: createZeroAddress(),
        blobVersionedHashes: [concatBytes(new Uint8Array([1]), randomBytes(31))],
      },
      { common },
    )

    const msgHash = tx.getHashedMessageToSign()
    const { v, r, s } = ecsign(msgHash, privKey)

    const signedTx = tx.sign(privKey)
    const addSignatureTx = tx.addSignature(v, r, s, true)

    assert.deepEqual(signedTx.toJSON(), addSignatureTx.toJSON())
  })

  it('addSignature() -> throws when adding the wrong v value', () => {
    const privKey = pk
    const tx = createBlob4844Tx(
      {
        to: createZeroAddress(),
        blobVersionedHashes: [concatBytes(new Uint8Array([1]), randomBytes(31))],
      },
      { common },
    )

    const msgHash = tx.getHashedMessageToSign()
    const { v, r, s } = ecsign(msgHash, privKey)

    assert.throws(() => {
      // This will throw, since we now try to set either v=27 or v=28
      tx.addSignature(v, r, s, false)
    })
  })
})

describe('EIP4844 constructor tests - valid scenarios', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    customCrypto: { kzg },
  })

  it('should work', () => {
    const txData = {
      type: 0x03,
      blobVersionedHashes: [concatBytes(new Uint8Array([1]), randomBytes(31))],
      maxFeePerBlobGas: 1n,
      to: createZeroAddress(),
    }
    const tx = createBlob4844Tx(txData, { common })
    assert.equal(tx.type, 3, 'successfully instantiated a blob transaction from txData')
    const factoryTx = createTx(txData, { common })
    assert.equal(factoryTx.type, 3, 'instantiated a blob transaction from the tx factory')

    const serializedTx = tx.serialize()
    assert.equal(serializedTx[0], 3, 'successfully serialized a blob tx')
    const deserializedTx = createBlob4844TxFromRLP(serializedTx, { common })
    assert.equal(deserializedTx.type, 3, 'deserialized a blob tx')

    const signedTx = tx.sign(pk)
    const sender = signedTx.getSenderAddress().toString()
    const decodedTx = createBlob4844TxFromRLP(signedTx.serialize(), { common })
    assert.equal(
      decodedTx.getSenderAddress().toString(),
      sender,
      'signature and sender were deserialized correctly',
    )
  })
})

describe('fromTxData using from a json', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    customCrypto: { kzg },
  })

  it('should work', () => {
    const txData = {
      type: '0x3',
      nonce: '0x0',
      gasPrice: null,
      maxPriorityFeePerGas: '0x12a05f200',
      maxFeePerGas: '0x12a05f200',
      gasLimit: '0x33450',
      value: '0xbc614e',
      data: '0x',
      v: '0x0',
      r: '0x8a83833ec07806485a4ded33f24f5cea4b8d4d24dc8f357e6d446bcdae5e58a7',
      s: '0x68a2ba422a50cf84c0b5fcbda32ee142196910c97198ffd99035d920c2b557f8',
      to: '0xffb38a7a99e3e2335be83fc74b7faa19d5531243',
      chainId: '0x28757b3',
      accessList: null,
      maxFeePerBlobGas: '0xb2d05e00',
      blobVersionedHashes: ['0x01b0a4cdd5f55589f5c5b4d46c76704bb6ce95c0a8c09f77f197a57808dded28'],
      yParity: '0x0',
    }
    const txMeta = {
      hash: '0xe5e02be0667b6d31895d1b5a8b916a6761cbc9865225c6144a3e2c50936d173e',
      serialized:
        '0x03f89b84028757b38085012a05f20085012a05f2008303345094ffb38a7a99e3e2335be83fc74b7faa19d553124383bc614e80c084b2d05e00e1a001b0a4cdd5f55589f5c5b4d46c76704bb6ce95c0a8c09f77f197a57808dded2880a08a83833ec07806485a4ded33f24f5cea4b8d4d24dc8f357e6d446bcdae5e58a7a068a2ba422a50cf84c0b5fcbda32ee142196910c97198ffd99035d920c2b557f8',
    }

    const c = common.copy()
    c['_chainParams'] = Object.assign({}, common['_chainParams'], {
      chainId: Number(txData.chainId),
    })
    try {
      const tx = createBlob4844Tx(txData as BlobEIP4844TxData, { common: c })
      assert.ok(true, 'Should be able to parse a json data and hash it')

      assert.equal(typeof tx.maxFeePerBlobGas, 'bigint', 'should be able to parse correctly')
      assert.equal(bytesToHex(tx.serialize()), txMeta.serialized, 'serialization should match')
      // TODO: fix the hash
      assert.equal(bytesToHex(tx.hash()), txMeta.hash, 'hash should match')

      const jsonData = tx.toJSON()
      // override few fields with equivalent values to have a match
      assert.deepEqual(
        { ...txData, accessList: [] },
        { gasPrice: null, ...jsonData },
        'toJSON should give correct json',
      )

      const fromSerializedTx = createBlob4844TxFromRLP(
        hexToBytes(txMeta.serialized as PrefixedHexString),
        { common: c },
      )
      assert.equal(
        bytesToHex(fromSerializedTx.hash()),
        txMeta.hash,
        'fromSerializedTx hash should match',
      )
    } catch (e) {
      assert.fail('failed to parse json data')
    }
  })
})

describe('EIP4844 constructor tests - invalid scenarios', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    customCrypto: { kzg },
  })

  it('should work', () => {
    const baseTxData = {
      type: 0x03,
      maxFeePerBlobGas: 1n,
      to: createZeroAddress(),
    }
    const shortVersionHash = {
      blobVersionedHashes: [concatBytes(new Uint8Array([3]), randomBytes(3))],
    }
    const invalidVersionHash = {
      blobVersionedHashes: [concatBytes(new Uint8Array([3]), randomBytes(31))],
    }
    const tooManyBlobs = {
      blobVersionedHashes: [
        concatBytes(new Uint8Array([1]), randomBytes(31)),
        concatBytes(new Uint8Array([1]), randomBytes(31)),
        concatBytes(new Uint8Array([1]), randomBytes(31)),
      ],
    }
    try {
      createBlob4844Tx({ ...baseTxData, ...shortVersionHash }, { common })
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('versioned hash is invalid length'),
        'throws on invalid versioned hash length',
      )
    }
    try {
      createBlob4844Tx({ ...baseTxData, ...invalidVersionHash }, { common })
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('does not start with KZG commitment'),
        'throws on invalid commitment version',
      )
    }
    try {
      createBlob4844Tx({ ...baseTxData, ...tooManyBlobs }, { common })
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('tx can contain at most'),
        'throws on too many versioned hashes',
      )
    }
  })
})

describe('Network wrapper tests', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    params: paramsTx,
    customCrypto: { kzg },
  })

  it('should work', async () => {
    const blobs = getBlobs('hello world')
    const commitments = blobsToCommitments(kzg, blobs)
    const blobVersionedHashes = commitmentsToVersionedHashes(commitments)
    const proofs = blobsToProofs(kzg, blobs, commitments)
    const unsignedTx = createBlob4844Tx(
      {
        blobVersionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerBlobGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common },
    )

    const signedTx = unsignedTx.sign(pk)
    const sender = signedTx.getSenderAddress().toString()
    const wrapper = signedTx.serializeNetworkWrapper()

    const jsonData = blobTxNetworkWrapperToJSON(wrapper, { common })
    assert.equal(jsonData.blobs?.length, blobs.length, 'contains the correct number of blobs')
    for (let i = 0; i < jsonData.blobs.length; i++) {
      const b1 = jsonData.blobs[i]
      const b2 = signedTx.blobs![i]
      assert.equal(b1, b2, 'contains the same blobs')
    }
    assert.equal(
      jsonData.kzgCommitments.length,
      signedTx.kzgCommitments!.length,
      'contains the correct number of commitments',
    )
    for (let i = 0; i < jsonData.kzgCommitments.length; i++) {
      const c1 = jsonData.kzgCommitments[i]
      const c2 = signedTx.kzgCommitments![i]
      assert.equal(c1, c2, 'contains the same commitments')
    }
    assert.equal(
      jsonData.kzgProofs?.length,
      signedTx.kzgProofs!.length,
      'contains the correct number of proofs',
    )
    for (let i = 0; i < jsonData.kzgProofs.length; i++) {
      const p1 = jsonData.kzgProofs[i]
      const p2 = signedTx.kzgProofs![i]
      assert.equal(p1, p2, 'contains the same proofs')
    }

    const deserializedTx = createBlob4844TxFromSerializedNetworkWrapper(wrapper, {
      common,
    })

    assert.equal(
      deserializedTx.type,
      0x03,
      'successfully deserialized a blob transaction network wrapper',
    )
    assert.equal(deserializedTx.blobs?.length, blobs.length, 'contains the correct number of blobs')
    assert.equal(
      deserializedTx.getSenderAddress().toString(),
      sender,
      'decoded sender address correctly',
    )
    const minimalTx = createMinimal4844TxFromNetworkWrapper(deserializedTx, { common })
    assert.ok(minimalTx.blobs === undefined, 'minimal representation contains no blobs')
    assert.ok(
      equalsBytes(minimalTx.hash(), deserializedTx.hash()),
      'has the same hash as the network wrapper version',
    )

    const simpleBlobTx = createBlob4844Tx(
      {
        blobsData: ['hello world'],
        maxFeePerBlobGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common },
    )

    assert.equal(
      unsignedTx.blobVersionedHashes[0],
      simpleBlobTx.blobVersionedHashes[0],
      'tx versioned hash for simplified blob txData constructor matches fully specified versioned hashes',
    )

    assert.throws(
      () =>
        createBlob4844Tx(
          {
            blobsData: ['hello world'],
            blobs: ['hello world' as any],
            maxFeePerBlobGas: 100000000n,
            gasLimit: 0xffffffn,
            to: randomBytes(20),
          },
          { common },
        ),
      'encoded blobs',
      undefined,
      'throws on blobsData and blobs in txData',
    )

    assert.throws(
      () =>
        createBlob4844Tx(
          {
            blobsData: ['hello world'],
            kzgCommitments: ['0xabcd'],
            maxFeePerBlobGas: 100000000n,
            gasLimit: 0xffffffn,
            to: randomBytes(20),
          },
          { common },
        ),
      'KZG commitments',
      undefined,
      'throws on blobsData and KZG commitments in txData',
    )

    assert.throws(
      () =>
        createBlob4844Tx(
          {
            blobsData: ['hello world'],
            blobVersionedHashes: ['0x01cd'],
            maxFeePerBlobGas: 100000000n,
            gasLimit: 0xffffffn,
            to: randomBytes(20),
          },
          { common },
        ),
      'versioned hashes',
      undefined,
      'throws on blobsData and versioned hashes in txData',
    )

    assert.throws(
      () =>
        createBlob4844Tx(
          {
            blobsData: ['hello world'],
            kzgProofs: ['0x01cd'],
            maxFeePerBlobGas: 100000000n,
            gasLimit: 0xffffffn,
            to: randomBytes(20),
          },
          { common },
        ),
      'KZG proofs',
      undefined,
      'throws on blobsData and KZG proofs in txData',
    )

    assert.throws(
      () => {
        createBlob4844Tx(
          {
            blobVersionedHashes: [],
            blobs: [],
            kzgCommitments: [],
            kzgProofs: [],
            maxFeePerBlobGas: 100000000n,
            gasLimit: 0xffffffn,
            to: randomBytes(20),
          },
          { common },
        )
      },
      'tx should contain at least one blob',
      undefined,
      'throws a transaction with no blobs',
    )

    const txWithMissingBlob = createBlob4844Tx(
      {
        blobVersionedHashes,
        blobs: blobs.slice(1),
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerBlobGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common },
    )

    const serializedWithMissingBlob = txWithMissingBlob.serializeNetworkWrapper()

    assert.throws(
      () =>
        createBlob4844TxFromSerializedNetworkWrapper(serializedWithMissingBlob, {
          common,
        }),
      'Number of blobVersionedHashes, blobs, and commitments not all equal',
      undefined,
      'throws when blobs/commitments/hashes mismatch',
    )

    const originalValue = commitments[0]
    commitments[0] = (originalValue.slice(0, 31) + 'c') as PrefixedHexString

    const txWithInvalidCommitment = createBlob4844Tx(
      {
        blobVersionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerBlobGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common },
    )

    const serializedWithInvalidCommitment = txWithInvalidCommitment.serializeNetworkWrapper()

    assert.throws(
      () =>
        createBlob4844TxFromSerializedNetworkWrapper(serializedWithInvalidCommitment, {
          common,
        }),
      'KZG proof cannot be verified from blobs/commitments',
      undefined,
      'throws when kzg proof cant be verified',
    )

    blobVersionedHashes[0] = ('0x0102' + blobVersionedHashes[0].slice(6)) as PrefixedHexString
    commitments[0] = originalValue

    const txWithInvalidVersionedHashes = createBlob4844Tx(
      {
        blobVersionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerBlobGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common },
    )

    const serializedWithInvalidVersionedHashes =
      txWithInvalidVersionedHashes.serializeNetworkWrapper()
    assert.throws(
      () =>
        createBlob4844TxFromSerializedNetworkWrapper(serializedWithInvalidVersionedHashes, {
          common,
        }),
      'commitment for blob at index 0 does not match versionedHash',
      undefined,
      "throws when versioned hashes don't match kzg commitments",
    )
  })
})

describe('hash() and signature verification', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    customCrypto: { kzg },
  })

  it('should work', async () => {
    const unsignedTx = createBlob4844Tx(
      {
        chainId: 1,
        nonce: 1,
        blobVersionedHashes: [
          hexToBytes('0x01624652859a6e98ffc1608e2af0147ca4e86e1ce27672d8d3f3c9d4ffd6ef7e'),
        ],
        maxFeePerBlobGas: 10000000n,
        gasLimit: 123457n,
        maxFeePerGas: 42n,
        maxPriorityFeePerGas: 10n,
        accessList: [
          {
            address: '0x0000000000000000000000000000000000000001',
            storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
          },
        ],
        to: createZeroAddress(),
      },
      { common },
    )
    assert.equal(
      bytesToHex(unsignedTx.getHashedMessageToSign()),
      '0x02560c5173b0d793ce019cfa515ece6a04a4b3f3d67eab67fbca78dd92d4ed76',
      'produced the correct transaction hash',
    )
    const signedTx = unsignedTx.sign(
      hexToBytes('0x45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8'),
    )

    assert.equal(
      signedTx.getSenderAddress().toString(),
      '0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b',
      'was able to recover sender address',
    )
    assert.ok(signedTx.verifySignature(), 'signature is valid')
  })
})

it('getEffectivePriorityFee()', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    customCrypto: { kzg },
  })
  const tx = createBlob4844Tx(
    {
      maxFeePerGas: 10,
      maxPriorityFeePerGas: 8,
      to: createZeroAddress(),
      blobVersionedHashes: [concatBytes(new Uint8Array([1]), randomBytes(31))],
    },
    { common },
  )
  assert.equal(tx.getEffectivePriorityFee(BigInt(10)), BigInt(0))
  assert.equal(tx.getEffectivePriorityFee(BigInt(9)), BigInt(1))
  assert.equal(tx.getEffectivePriorityFee(BigInt(8)), BigInt(2))
  assert.equal(tx.getEffectivePriorityFee(BigInt(2)), BigInt(8))
  assert.equal(tx.getEffectivePriorityFee(BigInt(1)), BigInt(8))
  assert.equal(tx.getEffectivePriorityFee(BigInt(0)), BigInt(8))
  assert.throws(() => tx.getEffectivePriorityFee(BigInt(11)))
})

describe('Network wrapper deserialization test', () => {
  const common = createCommonFromGethGenesis(hardfork4844Data, {
    chain: 'customChain',
    hardfork: Hardfork.Cancun,
    params: paramsTx,
    customCrypto: {
      kzg,
    },
  })

  it('should work', async () => {
    const txData = {
      type: '0x3',
      nonce: '0x0',
      maxPriorityFeePerGas: '0x0',
      maxFeePerGas: '0x0',
      gasLimit: '0xffffff',
      value: '0x0',
      data: '0x',
      v: '0x0',
      r: '0x3d8cacf503f773c3ae4eed2b38ba68859063bc5ad253a4fb456b1295061f1e0b',
      s: '0x616727b04ef78f58d2f521774c6261396fc21eac725ba2a2d89758eae171effb',
      to: '0x1f738d535998ba73b31f38f1ecf6a6ad013eaa20',
      chainId: '0x1',
      accessList: [],
      maxFeePerBlobGas: '0x5f5e100',
      blobVersionedHashes: ['0x0172ff1d4f354eebdb3cd0cb64e41ac584359094373fd5f979bcccbd6072d936'],
      yParity: '0x0',
    }
    const txMeta = {
      sender: '0x652a2b04934d96c26c4710853021779fb9f525d2',
      unsignedHash: '0x3103e9d2b39b26082a6e36fa0364e5b14502efa0041ad29d485737a10e03431a',
      hash: '0x0118d156c8b40c92dd6ef10a09ab967904e1c25fb42ec799e80e0a6271013e46',
      // 131325 bytes long i.e. ~128KB
      networkSerializedHexLength: 262652, // 0x included
      serialized:
        '0x03f88a0180808083ffffff941f738d535998ba73b31f38f1ecf6a6ad013eaa208080c08405f5e100e1a00172ff1d4f354eebdb3cd0cb64e41ac584359094373fd5f979bcccbd6072d93680a03d8cacf503f773c3ae4eed2b38ba68859063bc5ad253a4fb456b1295061f1e0ba0616727b04ef78f58d2f521774c6261396fc21eac725ba2a2d89758eae171effb',
    }

    const blobs = getBlobs('hello world')

    const commitments = blobsToCommitments(kzg, blobs)
    const proofs = blobsToProofs(kzg, blobs, commitments)

    const wrapper = hexToBytes(serialized4844TxData.tx as PrefixedHexString)
    const deserializedTx = createBlob4844TxFromSerializedNetworkWrapper(wrapper, {
      common,
    })
    const jsonData = deserializedTx.toJSON()
    assert.deepEqual(txData, jsonData as any, 'toJSON should give correct json')

    assert.equal(deserializedTx.blobs?.length, 1, 'contains the correct number of blobs')
    assert.equal(deserializedTx.blobs![0], blobs[0], 'blobs should match')
    assert.equal(deserializedTx.kzgCommitments![0], commitments[0], 'commitments should match')
    assert.equal(deserializedTx.kzgProofs![0], proofs[0], 'proofs should match')

    const unsignedHash = bytesToHex(deserializedTx.getHashedMessageToSign())
    const hash = bytesToHex(deserializedTx.hash())
    const networkSerialized = bytesToHex(deserializedTx.serializeNetworkWrapper())
    const serialized = bytesToHex(deserializedTx.serialize())
    const sender = deserializedTx.getSenderAddress().toString()
    assert.equal(networkSerialized, serialized4844TxData.tx, 'network serialization should match')

    assert.deepEqual(
      txMeta,
      {
        unsignedHash,
        hash,
        serialized,
        sender,
        networkSerializedHexLength: networkSerialized.length,
      },
      'txMeta should match',
    )
  })
})
