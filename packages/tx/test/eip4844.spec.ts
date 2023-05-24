import { Common, Hardfork } from '@ethereumjs/common'
import {
  blobsToCommitments,
  blobsToProofs,
  bytesToHex,
  commitmentsToVersionedHashes,
  concatBytes,
  equalsBytes,
  getBlobs,
  hexStringToBytes,
  initKZG,
} from '@ethereumjs/util'
import * as kzg from 'c-kzg'
import { randomBytes } from 'crypto'
import { hexToBytes } from 'ethereum-cryptography/utils'
import * as tape from 'tape'

import { BlobEIP4844Transaction, TransactionFactory } from '../src'

import { TSKzg } from './tsKzg'

// Hack to detect if running in browser or not
const isBrowser = new Function('try {return this===window;}catch(e){ return false;}')

const pk = randomBytes(32)
//if (isBrowser() === false) initKZG(tsK, __dirname + '/../../client/src/trustedSetups/devnet4.txt')

const gethGenesis = require('../../block/test/testdata/4844-hardfork.json')
const common = Common.fromGethGenesis(gethGenesis, {
  chain: 'customChain',
  hardfork: Hardfork.Cancun,
})

tape.only('EIP4844 constructor tests - valid scenarios', async (t) => {
  if (isBrowser() === true) {
    t.end()
  } else {
    initKZG(await TSKzg.create(), '')
    const txData = {
      type: 0x03,
      versionedHashes: [concatBytes(new Uint8Array([1]), randomBytes(31))],
      maxFeePerDataGas: 1n,
    }
    const tx = BlobEIP4844Transaction.fromTxData(txData, { common })
    t.equal(tx.type, 3, 'successfully instantiated a blob transaction from txData')
    const factoryTx = TransactionFactory.fromTxData(txData, { common })
    t.equal(factoryTx.type, 3, 'instantiated a blob transaction from the tx factory')

    const serializedTx = tx.serialize()
    t.equal(serializedTx[0], 3, 'successfully serialized a blob tx')
    const deserializedTx = BlobEIP4844Transaction.fromSerializedTx(serializedTx, { common })
    t.equal(deserializedTx.type, 3, 'deserialized a blob tx')

    const signedTx = tx.sign(pk)
    const sender = signedTx.getSenderAddress().toString()
    const decodedTx = BlobEIP4844Transaction.fromSerializedTx(signedTx.serialize(), { common })
    t.equal(
      decodedTx.getSenderAddress().toString(),
      sender,
      'signature and sender were deserialized correctly'
    )

    t.end()
  }
})

tape('fromTxData using from a json', (t) => {
  if (isBrowser() === true) {
    t.end()
  } else {
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
      maxFeePerDataGas: '0xb2d05e00',
      versionedHashes: ['0x01b0a4cdd5f55589f5c5b4d46c76704bb6ce95c0a8c09f77f197a57808dded28'],
    }
    const txMeta = {
      hash: 'e5e02be0667b6d31895d1b5a8b916a6761cbc9865225c6144a3e2c50936d173e',
      serialized:
        '03f89b84028757b38085012a05f20085012a05f2008303345094ffb38a7a99e3e2335be83fc74b7faa19d553124383bc614e80c084b2d05e00e1a001b0a4cdd5f55589f5c5b4d46c76704bb6ce95c0a8c09f77f197a57808dded2880a08a83833ec07806485a4ded33f24f5cea4b8d4d24dc8f357e6d446bcdae5e58a7a068a2ba422a50cf84c0b5fcbda32ee142196910c97198ffd99035d920c2b557f8',
    }

    const c = common.copy()
    c['_chainParams'] = Object.assign({}, common['_chainParams'], {
      chainId: Number(txData.chainId),
    })
    try {
      const tx = BlobEIP4844Transaction.fromTxData(txData, { common: c })
      t.pass('Should be able to parse a json data and hash it')

      t.equal(typeof tx.maxFeePerDataGas, 'bigint', 'should be able to parse correctly')
      t.equal(bytesToHex(tx.serialize()), txMeta.serialized, 'serialization should match')
      // TODO: fix the hash
      t.equal(bytesToHex(tx.hash()), txMeta.hash, 'hash should match')

      const jsonData = tx.toJSON()
      // override few fields with equivalent values to have a match
      t.deepEqual(
        { ...txData, accessList: [] },
        { gasPrice: null, ...jsonData },
        'toJSON should give correct json'
      )

      const fromSerializedTx = BlobEIP4844Transaction.fromSerializedTx(
        hexToBytes(txMeta.serialized),
        { common: c }
      )
      t.equal(
        bytesToHex(fromSerializedTx.hash()),
        txMeta.hash,
        'fromSerializedTx hash should match'
      )
    } catch (e) {
      t.fail('failed to parse json data')
    }

    t.end()
  }
})

tape('EIP4844 constructor tests - invalid scenarios', (t) => {
  if (isBrowser() === true) {
    t.end()
  } else {
    const baseTxData = {
      type: 0x03,
      maxFeePerDataGas: 1n,
    }
    const shortVersionHash = {
      versionedHashes: [concatBytes(new Uint8Array([3]), randomBytes(3))],
    }
    const invalidVersionHash = {
      versionedHashes: [concatBytes(new Uint8Array([3]), randomBytes(31))],
    }
    const tooManyBlobs = {
      versionedHashes: [
        concatBytes(new Uint8Array([1]), randomBytes(31)),
        concatBytes(new Uint8Array([1]), randomBytes(31)),
        concatBytes(new Uint8Array([1]), randomBytes(31)),
      ],
    }
    try {
      BlobEIP4844Transaction.fromTxData({ ...baseTxData, ...shortVersionHash }, { common })
    } catch (err: any) {
      t.ok(
        err.message.includes('versioned hash is invalid length'),
        'throws on invalid versioned hash length'
      )
    }
    try {
      BlobEIP4844Transaction.fromTxData({ ...baseTxData, ...invalidVersionHash }, { common })
    } catch (err: any) {
      t.ok(
        err.message.includes('does not start with KZG commitment'),
        'throws on invalid commitment version'
      )
    }
    try {
      BlobEIP4844Transaction.fromTxData({ ...baseTxData, ...tooManyBlobs }, { common })
    } catch (err: any) {
      t.ok(err.message.includes('tx can contain at most'), 'throws on too many versioned hashes')
    }
    t.end()
  }
})

tape('Network wrapper tests', async (t) => {
  if (isBrowser() === true) {
    t.end()
  } else {
    const blobs = getBlobs('hello world')
    const commitments = blobsToCommitments(blobs)
    const versionedHashes = commitmentsToVersionedHashes(commitments)
    const proofs = blobsToProofs(blobs, commitments)
    const unsignedTx = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerDataGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common }
    )

    const signedTx = unsignedTx.sign(pk)
    const sender = signedTx.getSenderAddress().toString()
    const wrapper = signedTx.serializeNetworkWrapper()
    const deserializedTx = BlobEIP4844Transaction.fromSerializedBlobTxNetworkWrapper(wrapper, {
      common,
    })

    t.equal(
      deserializedTx.type,
      0x03,
      'successfully deserialized a blob transaction network wrapper'
    )
    t.equal(deserializedTx.blobs?.length, blobs.length, 'contains the correct number of blobs')
    t.equal(
      deserializedTx.getSenderAddress().toString(),
      sender,
      'decoded sender address correctly'
    )
    const minimalTx = BlobEIP4844Transaction.minimalFromNetworkWrapper(deserializedTx, { common })
    t.ok(minimalTx.blobs === undefined, 'minimal representation contains no blobs')
    t.ok(
      equalsBytes(minimalTx.hash(), deserializedTx.hash()),
      'has the same hash as the network wrapper version'
    )

    const txWithEmptyBlob = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes: [],
        blobs: [],
        kzgCommitments: [],
        kzgProofs: [],
        maxFeePerDataGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common }
    )

    const serializedWithEmptyBlob = txWithEmptyBlob.serializeNetworkWrapper()
    t.throws(
      () =>
        BlobEIP4844Transaction.fromSerializedBlobTxNetworkWrapper(serializedWithEmptyBlob, {
          common,
        }),
      (err: any) => err.message === 'Invalid transaction with empty blobs',
      'throws a transaction with no blobs'
    )

    const txWithMissingBlob = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes,
        blobs: blobs.slice(1),
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerDataGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common }
    )

    const serializedWithMissingBlob = txWithMissingBlob.serializeNetworkWrapper()
    t.throws(
      () =>
        BlobEIP4844Transaction.fromSerializedBlobTxNetworkWrapper(serializedWithMissingBlob, {
          common,
        }),
      (err: any) =>
        err.message === 'Number of versionedHashes, blobs, and commitments not all equal',
      'throws when blobs/commitments/hashes mismatch'
    )

    const mangledValue = commitments[0][0]

    commitments[0][0] = 154
    const txWithInvalidCommitment = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerDataGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common }
    )

    const serializedWithInvalidCommitment = txWithInvalidCommitment.serializeNetworkWrapper()
    t.throws(
      () =>
        BlobEIP4844Transaction.fromSerializedBlobTxNetworkWrapper(serializedWithInvalidCommitment, {
          common,
        }),
      (err: any) => err.message === 'KZG proof cannot be verified from blobs/commitments',
      'throws when kzg proof cant be verified'
    )

    versionedHashes[0][1] = 2
    commitments[0][0] = mangledValue

    const txWithInvalidVersionedHashes = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerDataGas: 100000000n,
        gasLimit: 0xffffffn,
        to: randomBytes(20),
      },
      { common }
    )

    const serializedWithInvalidVersionedHashes =
      txWithInvalidVersionedHashes.serializeNetworkWrapper()
    t.throws(
      () =>
        BlobEIP4844Transaction.fromSerializedBlobTxNetworkWrapper(
          serializedWithInvalidVersionedHashes,
          {
            common,
          }
        ),
      (err: any) => err.message === 'commitment for blob at index 0 does not match versionedHash',
      'throws when versioned hashes dont match kzg commitments'
    )
    t.end()
  }
})

tape('hash() and signature verification', async (t) => {
  if (isBrowser() === true) {
    t.end()
  } else {
    const unsignedTx = BlobEIP4844Transaction.fromTxData(
      {
        chainId: 1,
        nonce: 1,
        versionedHashes: [
          hexToBytes('01624652859a6e98ffc1608e2af0147ca4e86e1ce27672d8d3f3c9d4ffd6ef7e'),
        ],
        maxFeePerDataGas: 10000000n,
        gasLimit: 123457n,
        maxFeePerGas: 42n,
        maxPriorityFeePerGas: 10n,
        accessList: [
          {
            address: '0x0000000000000000000000000000000000000001',
            storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
          },
        ],
      },
      { common }
    )
    t.equal(
      bytesToHex(unsignedTx.getMessageToSign(true)),
      '8ce8c3544ca173c0e8dd0e86319d4ebfe649e15a730137a6659ba3a721a9ff8b',
      'produced the correct transaction hash'
    )
    const signedTx = unsignedTx.sign(
      hexStringToBytes('45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8')
    )

    t.equal(
      signedTx.getSenderAddress().toString(),
      '0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b',
      'was able to recover sender address'
    )
    t.ok(signedTx.verifySignature(), 'signature is valid')
    t.end()
  }
})
