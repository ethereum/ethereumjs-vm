import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { Address, bytesToHex, createZeroAddress, hexToBytes } from '@ethereumjs/util'
import { readFileSync, readdirSync } from 'fs'
import * as mcl from 'mcl-wasm'
import { assert, describe, it } from 'vitest'

import { MCLBLS, createEVM, getActivePrecompiles } from '../../src/index.js'

import type { PrefixedHexString } from '@ethereumjs/util'

// BLS tests, run this from `./packages/evm` using `npx vitest run ./test/precompiles/eip-2537-bls.spec.ts`

const dir = './test/precompiles/bls'
const files = readdirSync(dir)

const precompileMap: { [key: string]: string } = {
  'add_G1_bls.json': '000000000000000000000000000000000000000b',
  'add_G2_bls.json': '000000000000000000000000000000000000000d',
  'fail-add_G1_bls.json': '000000000000000000000000000000000000000b',
  'fail-add_G2_bls.json': '000000000000000000000000000000000000000d',
  'fail-map_fp2_to_G2_bls.json': '0000000000000000000000000000000000000011',
  'fail-map_fp_to_G1_bls.json': '0000000000000000000000000000000000000010',
  'fail-mul_G1_bls.json': '000000000000000000000000000000000000000c',
  'fail-mul_G2_bls.json': '000000000000000000000000000000000000000e',
  'fail-multiexp_G1_bls.json': '000000000000000000000000000000000000000c',
  'fail-multiexp_G2_bls.json': '000000000000000000000000000000000000000e',
  'fail-pairing_check_bls.json': '000000000000000000000000000000000000000f',
  'map_fp2_to_G2_bls.json': '0000000000000000000000000000000000000011',
  'map_fp_to_G1_bls.json': '0000000000000000000000000000000000000010',
  'mul_G1_bls.json': '000000000000000000000000000000000000000c',
  'mul_G2_bls.json': '000000000000000000000000000000000000000e',
  'multiexp_G1_bls.json': '000000000000000000000000000000000000000c',
  'multiexp_G2_bls.json': '000000000000000000000000000000000000000e',
  'pairing_check_bls.json': '000000000000000000000000000000000000000f',
}

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Berlin, eips: [2537] })

// MCL Instantiation
await mcl.init(mcl.BLS12_381)
const mclbls = new MCLBLS(mcl)

// Running tests with default BLS implementation (undefined, Noble) as well
// as MCL (optional).
// Remove from array to run only with one specific interface implementation.
for (const bls of [undefined, mclbls]) {
  for (const fname of files) {
    // Uncomment for running single test cases (example)
    // if (fname !== 'pairing_check_bls.json') continue
    const fullName = `${dir}/${fname}`
    const parsedJSON = JSON.parse(readFileSync(fullName, 'utf-8'))
    describe(`Precompiles: ${fname}`, () => {
      for (const data of parsedJSON) {
        it(`${data.Name}`, async () => {
          const evm = await createEVM({
            common,
            bls,
          })
          const precompileAddr = precompileMap[fname]
          const precompile = getActivePrecompiles(common).get(precompileAddr)!

          const callData = {
            data: hexToBytes(`0x${data.Input}`),
            gasLimit: BigInt(5000000),
            common,
            _EVM: evm,
          }

          if (data.ExpectedError !== undefined) {
            try {
              await precompile(callData)
              assert.fail('The precompile should have thrown')
            } catch {
              // If the precompile throws, catch it here, but this is fine, since it is expected to fail
            }
          } else {
            try {
              const result = await precompile(callData)
              assert.deepEqual(
                '0x' + data.Expected,
                bytesToHex(result.returnValue),
                'return value should match testVectorResult',
              )
              assert.equal(result.executionGasUsed, BigInt(data.Gas))
            } catch (e: any) {
              assert.fail(e.type.code)
            }
          }
        })
      }
    })
  }
}

const precompileAddressStart = 0x0b
const precompileAddressEnd = 0x11

const precompiles: PrefixedHexString[] = []

for (let address = precompileAddressStart; address <= precompileAddressEnd; address++) {
  precompiles.push(`0x${address.toString(16).padStart(40, '0')}`)
}

describe('EIP-2537 BLS precompile availability tests', () => {
  it('BLS precompiles should not be available if EIP not activated', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.MuirGlacier })
    const evm = await createEVM({
      common,
    })

    for (const address of precompiles) {
      const to = new Address(hexToBytes(address))
      const result = await evm.runCall({
        caller: createZeroAddress(),
        gasLimit: BigInt(0xffffffffff),
        to,
        value: BigInt(0),
        data: new Uint8Array(0),
      })

      if (result.execResult.executionGasUsed !== BigInt(0)) {
        assert.fail('BLS precompiles should not use any gas if EIP not activated')
      }

      if (result.execResult.exceptionError) {
        assert.fail('BLS precompiles should not throw if EIP not activated')
      }
    }

    assert.ok(true, 'BLS precompiles unreachable if EIP not activated')
  })
})
