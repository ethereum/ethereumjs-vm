import { assert, describe, it } from 'vitest'

import { INVALID_PARAMS } from '../../../src/rpc/error-code.js'
import genesisJSON from '../../testdata/geth-genesis/post-merge.json'
import { baseSetup, getRpcClient, setupChain } from '../helpers.js'

import type { ExecutionPayload } from '@ethereumjs/block'

const method = 'engine_getPayloadV1'

const validForkChoiceState = {
  headBlockHash: '0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a',
  safeBlockHash: '0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a',
  finalizedBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

const validPayloadAttributes = {
  timestamp: '0x5',
  prevRandao: '0x0000000000000000000000000000000000000000000000000000000000000000',
  suggestedFeeRecipient: '0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b',
}
const validPayload = [validForkChoiceState, validPayloadAttributes]

describe(method, () => {
  it('call with invalid payloadId', async () => {
    const { rpc } = baseSetup({ engine: true, includeVM: true })

    const res = await rpc.request(method, [1])
    assert.equal(res.error.code, INVALID_PARAMS)
    assert.ok(res.error.message.includes('invalid argument 0: argument must be a hex string'))
  })

  it('call with unknown payloadId', async () => {
    const { rpc } = baseSetup({ engine: true, includeVM: true })

    const res = await rpc.request(method, ['0x123'])
    assert.equal(res.error.code, -32001, 'Unknown payload')
  })

  it('call with known payload', async () => {
    const { server } = await setupChain(genesisJSON, 'post-merge', { engine: true })
    const rpc = getRpcClient(server)
    let res = await rpc.request('engine_forkchoiceUpdatedV1', validPayload)

    const payloadId = res.result.payloadId

    let payload: ExecutionPayload | undefined = undefined
    res = await rpc.request(method, [payloadId])

    assert.equal(res.result.blockNumber, '0x1')
    payload = res.result
    console.log(res)
    // Without newpayload the fcU response should be syncing or accepted

    assert.equal(res.payloadStatus.status, 'SYNCING')

    res = await rpc.request('engine_forkchoiceUpdatedV1', [
      {
        ...validPayload[0],
        headBlockHash: '0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858',
      },
    ])

    // post new payload , the fcu should give valid
    assert.equal(res.result.status, 'VALID')

    res = await rpc.request('engine_newPayloadV1', [payload])

    assert.equal(res.result.payloadStatus.status, 'VALID')

    res = await rpc.request('engine_forkchoiceUpdatedV1', [
      {
        ...validPayload[0],
        headBlockHash: '0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858',
      },
    ])
  })
})
