import { Hardfork, createCommonFromGethGenesis } from '@ethereumjs/common'
import {
  bytesToBigInt,
  computeVersionedHash,
  concatBytes,
  hexToBytes,
  unpadBytes,
} from '@ethereumjs/util'
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'
import { assert, describe, it } from 'vitest'

import { createEVM, getActivePrecompiles } from '../../src/index.js'

import type { PrecompileInput } from '../../src/index.js'
import type { PrefixedHexString } from '@ethereumjs/util'
const kzg = new microEthKZG(trustedSetup)
const BLS_MODULUS = BigInt(
  '52435875175126190479447740508185965837690552500527637822603658699938581184513',
)

describe('Precompiles: point evaluation', () => {
  it('should work', async () => {
    const { eip4844Data } = await import('../../../client/test/testdata/geth-genesis/eip4844.js')

    const common = createCommonFromGethGenesis(eip4844Data, {
      chain: 'custom',
      hardfork: Hardfork.Cancun,
      customCrypto: { kzg },
    })

    const evm = await createEVM({
      common,
    })
    const addressStr = '000000000000000000000000000000000000000a'
    const pointEvaluation = getActivePrecompiles(common).get(addressStr)!

    const testCase = {
      commitment:
        '0xc00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as PrefixedHexString,
      z: '0x0000000000000000000000000000000000000000000000000000000000000002' as PrefixedHexString,
      y: '0x0000000000000000000000000000000000000000000000000000000000000000' as PrefixedHexString,
      proof:
        '0xc00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as PrefixedHexString,
    }
    const versionedHash = computeVersionedHash(testCase.commitment as PrefixedHexString, 1)

    const opts: PrecompileInput = {
      data: concatBytes(
        hexToBytes(versionedHash),
        hexToBytes(testCase.z),
        hexToBytes(testCase.y),
        hexToBytes(testCase.commitment),
        hexToBytes(testCase.proof),
      ),
      gasLimit: 0xfffffffffn,
      _EVM: evm,
      common,
    }

    let res = await pointEvaluation(opts)
    assert.equal(
      bytesToBigInt(unpadBytes(res.returnValue.slice(32))),
      BLS_MODULUS,
      'point evaluation precompile returned expected output',
    )

    const optsWithInvalidCommitment: PrecompileInput = {
      data: concatBytes(
        concatBytes(Uint8Array.from([0]), hexToBytes(versionedHash as PrefixedHexString)),
        hexToBytes(testCase.z),
        hexToBytes(testCase.y),
        hexToBytes(testCase.commitment),
        hexToBytes(testCase.proof),
      ),
      gasLimit: 0xfffffffffn,
      _EVM: evm,
      common,
    }
    res = await pointEvaluation(optsWithInvalidCommitment)
    assert.ok(res.exceptionError?.type.code.match('invalid input length'), 'invalid input length')
  })
})
