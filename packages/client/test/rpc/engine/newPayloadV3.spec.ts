import { BlockHeader } from '@ethereumjs/block'
import { bigIntToHex } from '@ethereumjs/util'
import * as td from 'testdouble'
import { assert, describe, it } from 'vitest'

import { INVALID_PARAMS } from '../../../src/rpc/error-code'
import blocks from '../../testdata/blocks/beacon.json'
import genesisJSON from '../../testdata/geth-genesis/post-merge.json'
import { baseRequest, params, setupChain } from '../helpers'
import { checkError } from '../util'

import type { HttpServer } from 'jayson'

const method = 'engine_newPayloadV3'
const [blockData] = blocks

const originalValidate = (BlockHeader as any).prototype._consensusFormatValidation

export const batchBlocks = async (server: HttpServer) => {
  for (let i = 0; i < 3; i++) {
    const req = params(method, [blocks[i]])
    const expectRes = (res: any) => {
      assert.equal(res.body.result.status, 'VALID')
    }
    await baseRequest(server, req, 200, expectRes, false, false)
  }
}
const parentBeaconBlockRoot = '0x42942949c4ed512cd85c2cb54ca88591338cbb0564d3a2bea7961a639ef29d64'

describe(`${method}: call with executionPayloadV3`, () => {
  it('invalid call before Cancun', async () => {
    const { server } = await setupChain(genesisJSON, 'post-merge', {
      engine: true,
    })
    // get the genesis json with current date
    const validBlock = {
      ...blockData,
      withdrawals: [],
      dataGasUsed: '0x0',
      excessDataGas: '0x0',
    }

    const req = params(method, [validBlock, [], parentBeaconBlockRoot])
    const expectRes = checkError(
      INVALID_PARAMS,
      'NewPayloadV{1|2} MUST be used before Cancun is activated'
    )
    await baseRequest(server, req, 200, expectRes)
  })

  it('valid data', async () => {
    // get the genesis json with current date
    const cancunTime = 1689945325
    // deep copy json and add shanghai and cancun to genesis to avoid contamination
    const cancunJson = JSON.parse(JSON.stringify(genesisJSON))
    cancunJson.config.shanghaiTime = cancunTime
    cancunJson.config.cancunTime = cancunTime
    const { server } = await setupChain(cancunJson, 'post-merge', { engine: true })

    const validBlock = {
      ...blockData,
      timestamp: bigIntToHex(BigInt(cancunTime)),
      withdrawals: [],
      dataGasUsed: '0x0',
      excessDataGas: '0x0',
      blockHash: '0x6ec6f32e6931199f8f84faf46a59bc9a1e65a23aa73ca21278b5cb48aa2d059d',
      stateRoot: '0x454a9db6943b17a5f88aea507d0c3f4420d533d143b4eb5194cc7589d721b024',
    }
    let expectRes, req

    const oldMethods = ['engine_newPayloadV1', 'engine_newPayloadV2']
    const expectedErrors = [
      'NewPayloadV2 MUST be used after Shanghai is activated',
      'NewPayloadV3 MUST be used after Cancun is activated',
    ]
    for (let index = 0; index < oldMethods.length; index++) {
      const oldMethod = oldMethods[index]
      const expectedError = expectedErrors[index]
      // extra params for old methods should be auto ignored
      req = params(oldMethod, [validBlock, [], parentBeaconBlockRoot])
      expectRes = checkError(INVALID_PARAMS, expectedError)
      await baseRequest(server, req, 200, expectRes, false, false)
    }

    req = params(method, [validBlock, [], parentBeaconBlockRoot])
    expectRes = (res: any) => {
      assert.equal(res.body.result.status, 'VALID')
      assert.equal(res.body.result.latestValidHash, validBlock.blockHash)
    }
    await baseRequest(server, req, 200, expectRes)
  })

  it(`reset TD`, () => {
    BlockHeader.prototype['_consensusFormatValidation'] = originalValidate
    td.reset()
  })

  it('call with executionPayloadV2', () => {
    assert.ok(true, 'TODO: add tests for executionPayloadV2')
    // TODO: add tests for executionPayloadV2
  })
  it('call with executionPayloadV3', () => {
    assert.ok(true, 'TODO: add tests for executionPayloadV2')
    // TODO: add tests for executionPayloadV3
  })
})
