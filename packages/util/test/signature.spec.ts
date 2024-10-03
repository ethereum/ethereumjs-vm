import { assert, describe, it } from 'vitest'

import {
  bigIntToBytes,
  bytesToBigInt,
  ecrecover,
  ecsign,
  fromRPCSig,
  hashPersonalMessage,
  hexToBytes,
  isValidSignature,
  privateToPublic,
  toCompactSig,
  toRPCSig,
  utf8ToBytes,
} from '../src/index.js'

const ecHash = hexToBytes('0x82ff40c0a986c6a5cfad4ddf4c3aa6996f1a7837f9c398e17e5de5cbd5a12b28')
const ecPrivKey = hexToBytes('0x3c9229289a6125f7fdf1885a77bb12c37a8d3b4962d936f7e3084dece32a3ca1')
const chainId = BigInt(3) // ropsten

describe('ecsign', () => {
  it('should produce a signature', () => {
    const sig = ecsign(ecHash, ecPrivKey)
    assert.deepEqual(
      sig.r,
      hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9'),
    )
    assert.deepEqual(
      sig.s,
      hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66'),
    )
    assert.equal(sig.v, BigInt(27))
  })

  it('should produce a signature for Ropsten testnet', () => {
    const sig = ecsign(ecHash, ecPrivKey, chainId)
    assert.deepEqual(
      sig.r,
      hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9'),
    )
    assert.deepEqual(
      sig.s,
      hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66'),
    )
    assert.equal(sig.v, BigInt(41))
  })

  it('should produce a signature for chainId=150', () => {
    const expectedSigR = hexToBytes(
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9',
    )
    const expectedSigS = hexToBytes(
      '0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66',
    )

    const sig = ecsign(ecHash, ecPrivKey, BigInt(150))
    assert.deepEqual(sig.r, expectedSigR)
    assert.deepEqual(sig.s, expectedSigS)
    assert.equal(sig.v, BigInt(150 * 2 + 35))
  })

  it('should produce a signature for a high number chainId greater than MAX_SAFE_INTEGER', () => {
    const chainIDBuffer = hexToBytes('0x796f6c6f763378')
    const expectedSigR = hexToBytes(
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9',
    )
    const expectedSigS = hexToBytes(
      '0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66',
    )
    const expectedSigV = BigInt('68361967398315795')

    const sigBuffer = ecsign(ecHash, ecPrivKey, bytesToBigInt(chainIDBuffer))
    assert.deepEqual(sigBuffer.r, expectedSigR)
    assert.deepEqual(sigBuffer.s, expectedSigS)
    assert.equal(sigBuffer.v, expectedSigV)
  })
})

describe('ecrecover', () => {
  it('should recover a public key', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(27)
    const pubkey = ecrecover(ecHash, v, r, s)
    assert.deepEqual(pubkey, privateToPublic(ecPrivKey))
  })
  it('should recover a public key (chainId = 3)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(41)
    const pubkey = ecrecover(ecHash, v, r, s, chainId)
    assert.deepEqual(pubkey, privateToPublic(ecPrivKey))
  })
  it('should recover a public key (chainId = 150)', () => {
    const chainId = BigInt(150)
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(chainId * BigInt(2) + BigInt(35))
    const pubkey = ecrecover(ecHash, v, r, s, chainId)
    assert.deepEqual(pubkey, privateToPublic(ecPrivKey))
  })
  it('should recover a public key (v = 0)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(0)
    const pubkey = ecrecover(ecHash, v, r, s)
    assert.deepEqual(pubkey, privateToPublic(ecPrivKey))
  })
  it('should fail on an invalid signature (v = 21)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    assert.throws(function () {
      ecrecover(ecHash, BigInt(21), r, s)
    })
  })
  it('should fail on an invalid signature (v = 29)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    assert.throws(function () {
      ecrecover(ecHash, BigInt(29), r, s)
    })
  })
  it('should fail on an invalid signature (swapped points)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    assert.throws(function () {
      ecrecover(ecHash, BigInt(27), s, r)
    })
  })
  it('should return the right sender when using very high chain id / v values', () => {
    // This data is from a transaction of the YoloV3 network, block 77, txhash c6121a23ca17b8ff70d4706c7d134920c1da43c8329444c96b4c63a55af1c760
    /*
      {
        nonce: '0x8',
        gasPrice: '0x3b9aca00',
        gasLimit: '0x1a965',
        to: undefined,
        value: '0x0',
        data: '0x608060405234801561001057600080fd5b50610101806100206000396000f3fe608060405260043610601f5760003560e01c8063776d1a0114603b576020565b5b6000543660008037600080366000845af43d6000803e3d6000f35b348015604657600080fd5b50608660048036036020811015605b57600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff1690602001909291905050506088565b005b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505056fea26469706673582212206d3160e3f009c6ebac579877e529c0a1ca8313678f08fe311659d440067d26ea64736f6c63430007040033',
        v: '0xf2ded8deec6714',
        r: '0xec212841e0b7aaffc3b3e33a08adf32fa07159e856ef23db85175a4f6d71dc0f',
        s: '0x4b8e02b96b94064a5aa2f8d72bd0040616ba8e482a5dd96422e38c9a4611f8d5'
      }
    */
    const senderPubKey = hexToBytes(
      '0x78988201fbceed086cfca7b64e382d08d0bd776898731443d2907c097745b7324c54f522087f5964412cddba019f192de0fd57a0ffa63f098c2b200e53594b15',
    )
    const msgHash = hexToBytes('0x8ae8cb685a7a9f29494b07b287c3f6a103b73fa178419d10d1184861a40f6afe')

    const r = hexToBytes('0xec212841e0b7aaffc3b3e33a08adf32fa07159e856ef23db85175a4f6d71dc0f')
    const s = hexToBytes('0x4b8e02b96b94064a5aa2f8d72bd0040616ba8e482a5dd96422e38c9a4611f8d5')

    const v = BigInt('68361967398315796')
    const chainID = BigInt('34180983699157880')
    const sender = ecrecover(msgHash, v, r, s, chainID)
    assert.deepEqual(sender, senderPubKey, 'sender pubkey correct (Buffer)')
  })
})

describe('hashPersonalMessage', () => {
  it('should produce a deterministic hash', () => {
    const h = hashPersonalMessage(utf8ToBytes('Hello world'))
    assert.deepEqual(
      h,
      hexToBytes('0x8144a6fa26be252b86456491fbcd43c1de7e022241845ffea1c3df066f7cfede'),
    )
  })
  it('should throw if input is not a Uint8Array', () => {
    try {
      hashPersonalMessage((<unknown>[0, 1, 2, 3, 4]) as Uint8Array)
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('This method only supports Uint8Array'))
    }
  })
})

describe('isValidSignature', () => {
  it('should fail on an invalid signature (shorter r))', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1ab')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    assert.notOk(isValidSignature(BigInt(27), r, s))
  })
  it('should fail on an invalid signature (shorter s))', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca')
    assert.notOk(isValidSignature(BigInt(27), r, s))
  })
  it('should fail on an invalid signature (v = 21)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    assert.notOk(isValidSignature(BigInt(21), r, s))
  })
  it('should fail on an invalid signature (v = 29)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    assert.notOk(isValidSignature(BigInt(29), r, s))
  })
  it('should fail when on homestead and s > secp256k1n/2', () => {
    const SECP256K1_N_DIV_2 = BigInt(
      '0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0',
    )

    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = bigIntToBytes(SECP256K1_N_DIV_2 + BigInt(1))

    const v = BigInt(27)
    assert.notOk(isValidSignature(v, r, s, true))
  })
  it('should not fail when not on homestead but s > secp256k1n/2', () => {
    const SECP256K1_N_DIV_2 = BigInt(
      '0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0',
    )

    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = bigIntToBytes(SECP256K1_N_DIV_2 + BigInt(1))
    const v = BigInt(27)
    assert.ok(isValidSignature(v, r, s, false))
  })
  it('should work otherwise', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(27)
    assert.ok(isValidSignature(v, r, s))
  })
  it('should work otherwise (v=0)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(0)
    assert.ok(isValidSignature(v, r, s))
  })
  it('should work otherwise (v=1)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(1)
    assert.ok(isValidSignature(v, r, s))
  })
  it('should work otherwise (chainId=3)', () => {
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(41)
    assert.ok(isValidSignature(v, r, s, false, chainId))
  })
  it('should work otherwise (chainId=150)', () => {
    const chainId = BigInt(150)
    const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
    const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')
    const v = BigInt(chainId * BigInt(2) + BigInt(35))
    assert.ok(isValidSignature(v, r, s, false, chainId))
  })
})

describe('message sig', () => {
  const r = hexToBytes('0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9')
  const s = hexToBytes('0x129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66')

  it('should return hex strings that the RPC can use', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca661b'
    assert.equal(toRPCSig(BigInt(27), r, s), sig)
    assert.deepEqual(fromRPCSig(sig), {
      v: BigInt(27),
      r,
      s,
    })
  })

  it('should support compact signature representation (EIP-2098)', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66'
    assert.equal(toCompactSig(BigInt(27), r, s), sig)
    assert.deepEqual(fromRPCSig(sig), {
      v: BigInt(27),
      r,
      s,
    })
  })

  it('should support compact signature representation (EIP-2098) (v=0)', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66'
    assert.equal(toCompactSig(BigInt(0), r, s), sig)
    assert.deepEqual(fromRPCSig(sig), {
      v: BigInt(27),
      r,
      s,
    })
  })

  it('should support compact signature representation 2 (EIP-2098)', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9929ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66'
    assert.equal(toCompactSig(BigInt(28), r, s), sig)
    assert.deepEqual(fromRPCSig(sig), {
      v: BigInt(28),
      r,
      s,
    })
  })

  it('should support compact signature representation 2 (EIP-2098) (v=1)', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9929ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66'
    assert.equal(toCompactSig(BigInt(1), r, s), sig)
    assert.deepEqual(fromRPCSig(sig), {
      v: BigInt(28),
      r,
      s,
    })
  })

  it('should return hex strings that the RPC can use (chainId=150)', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66014f'
    const chainId = BigInt(150)
    const v = chainId * BigInt(2) + BigInt(35)
    assert.equal(toRPCSig(v, r, s, chainId), sig)
    assert.deepEqual(fromRPCSig(sig), {
      v,
      r,
      s,
    })
  })

  it('should return hex strings that the RPC can use (chainId larger than MAX_SAFE_INTEGER)', () => {
    const sig =
      '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca66f2ded8deec6714'
    const chainID = BigInt('34180983699157880')
    const v = BigInt('68361967398315796')
    assert.deepEqual(toRPCSig(v, r, s, chainID), sig)
  })

  it('should throw on shorter length', () => {
    assert.throws(function () {
      fromRPCSig('0x')
    })
    assert.throws(function () {
      fromRPCSig(
        '0x99e71a99cb2270b8cac5254f9e99b6210c6c10224a1579cf389ef88b20a1abe9129ff05af364204442bdb53ab6f18a99ab48acc9326fa689f228040429e3ca',
      )
    })
  })

  it('pad short r and s values', () => {
    assert.equal(
      toRPCSig(BigInt(27), r.slice(20), s.slice(20)),
      '0x00000000000000000000000000000000000000004a1579cf389ef88b20a1abe90000000000000000000000000000000000000000326fa689f228040429e3ca661b',
    )
  })

  it('should throw on invalid v value', () => {
    assert.throws(function () {
      toRPCSig(BigInt(2), r, s)
    })
  })
})
