import { concatBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { Chain, Common } from '../src/index.js'

describe('[Common]: Custom Crypto', () => {
  const customKeccak256 = (msg: Uint8Array) => {
    return concatBytes(msg, new Uint8Array([1]))
  }
  const customEcrecover = (
    msgHash: Uint8Array,
    v: bigint,
    r: Uint8Array,
    s: Uint8Array,
    _chainID?: bigint
  ) => {
    return concatBytes(msgHash, Uint8Array.from([Number(v)]), r, s)
  }

  const customSha256 = (msg: Uint8Array) => {
    msg[0] = 0xff
    return msg
  }

  it('keccak256', () => {
    const customCrypto = {
      keccak256: customKeccak256,
    }
    const value = new Uint8Array([2])

    let c = new Common({ chain: Chain.Mainnet, customCrypto })
    let msg = 'Should initialize with custom keccak256 function and use properly (main constructor)'
    assert.deepEqual(c.customCrypto.keccak256!(value), new Uint8Array([2, 1]), msg)

    msg = 'Should still work on a copied instance'
    assert.deepEqual(c.copy().customCrypto.keccak256!(value), new Uint8Array([2, 1]), msg)

    const customChainParams = { name: 'custom', chainId: 123, networkId: 678 }
    c = Common.custom(customChainParams, { customCrypto })
    msg = 'Should initialize with custom keccak256 function and use properly (custom() constructor)'
    assert.deepEqual(c.customCrypto.keccak256!(value), new Uint8Array([2, 1]), msg)
  })

  it('ecrecover', () => {
    const customCrypto = {
      ecrecover: customEcrecover,
    }
    const c = new Common({ chain: Chain.Mainnet, customCrypto })
    assert.deepEqual(
      Uint8Array.from([1, 2, 3, 4]),
      c.customCrypto.ecrecover!(
        Uint8Array.from([1]),
        BigInt(2),
        Uint8Array.from([3]),
        Uint8Array.from([4])
      )
    )
  })

  it('sha256', () => {
    const customCrypto = {
      sha256: customSha256,
    }
    const msg = Uint8Array.from([0, 1, 2, 3])
    const c = new Common({ chain: Chain.Mainnet, customCrypto })
    assert.equal(c.customCrypto.sha256!(msg)[0], 0xff, 'used custom sha256 function')
  })
})
