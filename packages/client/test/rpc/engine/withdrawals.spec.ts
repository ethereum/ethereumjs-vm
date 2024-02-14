import { Block } from '@ethereumjs/block'
import { Trie } from '@ethereumjs/trie'
import { Withdrawal, bigIntToHex, bytesToHex, intToHex } from '@ethereumjs/util'
import { assert, it } from 'vitest'

import { INVALID_PARAMS } from '../../../src/rpc/error-code.js'
import genesisJSON from '../../testdata/geth-genesis/withdrawals.json'
import { getRpcClient, setupChain } from '../helpers.js'

import type { ExecutionPayload } from '@ethereumjs/block'

// Testvectors picked from static testcase generated by the geth team for api unit tests
// see: https://hackmd.io/PqZgMpnkSWCWv5joJoFymQ
const validPayloadAttributes = {
  timestamp: '0x2f',
  prevRandao: '0xff00000000000000000000000000000000000000000000000000000000000000',
  suggestedFeeRecipient: '0xaa00000000000000000000000000000000000000',
}

const withdrawalsVector = [
  {
    Index: 0,
    Validator: 65535,
    Recipient: '0x0000000000000000000000000000000000000000',
    Amount: '0',
  },
  {
    Index: 1,
    Validator: 65536,
    Recipient: '0x0100000000000000000000000000000000000000',
    Amount: '452312848583266388373324160190187140051835877600158453279131187530910662656',
  },
  {
    Index: 2,
    Validator: 65537,
    Recipient: '0x0200000000000000000000000000000000000000',
    Amount: '904625697166532776746648320380374280103671755200316906558262375061821325312',
  },
  {
    Index: 3,
    Validator: 65538,
    Recipient: '0x0300000000000000000000000000000000000000',
    Amount: '1356938545749799165119972480570561420155507632800475359837393562592731987968',
  },
  {
    Index: 4,
    Validator: 65539,
    Recipient: '0x0400000000000000000000000000000000000000',
    Amount: '1809251394333065553493296640760748560207343510400633813116524750123642650624',
  },
  {
    Index: 5,
    Validator: 65540,
    Recipient: '0x0500000000000000000000000000000000000000',
    Amount: '2261564242916331941866620800950935700259179388000792266395655937654553313280',
  },
  {
    Index: 6,
    Validator: 65541,
    Recipient: '0x0600000000000000000000000000000000000000',
    Amount: '2713877091499598330239944961141122840311015265600950719674787125185463975936',
  },
  {
    Index: 7,
    Validator: 65542,
    Recipient: '0x0700000000000000000000000000000000000000',
    Amount: '3166189940082864718613269121331309980362851143201109172953918312716374638592',
  },
]
const gethWithdrawals8BlockRlp =
  'f903e1f90213a0fe950635b1bd2a416ff6283b0bbd30176e1b1125ad06fa729da9f3f4c1c61710a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d4934794aa00000000000000000000000000000000000000a07f7510a0cb6203f456e34ec3e2ce30d6c5590ded42c10a9cf3f24784119c5afba056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b901000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080018401c9c380802f80a0ff0000000000000000000000000000000000000000000000000000000000000088000000000000000007a0b695b29ec7ee934ef6a68838b13729f2d49fffe26718de16a1a9ed94a4d7d06dc0c0f901c6da8082ffff94000000000000000000000000000000000000000080f83b0183010000940100000000000000000000000000000000000000a00100000000000000000000000000000000000000000000000000000000000000f83b0283010001940200000000000000000000000000000000000000a00200000000000000000000000000000000000000000000000000000000000000f83b0383010002940300000000000000000000000000000000000000a00300000000000000000000000000000000000000000000000000000000000000f83b0483010003940400000000000000000000000000000000000000a00400000000000000000000000000000000000000000000000000000000000000f83b0583010004940500000000000000000000000000000000000000a00500000000000000000000000000000000000000000000000000000000000000f83b0683010005940600000000000000000000000000000000000000a00600000000000000000000000000000000000000000000000000000000000000f83b0783010006940700000000000000000000000000000000000000a00700000000000000000000000000000000000000000000000000000000000000'

const withdrawalsGethVector = withdrawalsVector.map((testVec) => ({
  index: intToHex(testVec.Index),
  validatorIndex: intToHex(testVec.Validator),
  address: testVec.Recipient,
  amount: bigIntToHex(BigInt(testVec.Amount)),
}))

const validForkChoiceState = {
  headBlockHash: '0xfe950635b1bd2a416ff6283b0bbd30176e1b1125ad06fa729da9f3f4c1c61710',
  safeBlockHash: '0xfe950635b1bd2a416ff6283b0bbd30176e1b1125ad06fa729da9f3f4c1c61710',
  finalizedBlockHash: '0xfe950635b1bd2a416ff6283b0bbd30176e1b1125ad06fa729da9f3f4c1c61710',
}

const testCases = [
  {
    name: 'empty withdrawals',
    withdrawals: [],
    withdrawalsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
    stateRoot: '',
    gethBlockRlp: undefined,
  },
  {
    name: '8 withdrawals',
    withdrawals: withdrawalsGethVector,
    withdrawalsRoot: '0xb695b29ec7ee934ef6a68838b13729f2d49fffe26718de16a1a9ed94a4d7d06d',
    gethBlockRlp: gethWithdrawals8BlockRlp,
  },
]

for (const { name, withdrawals, withdrawalsRoot, gethBlockRlp } of testCases) {
  const validPayloadAttributesWithWithdrawals = { ...validPayloadAttributes, withdrawals }
  it(name, async () => {
    // check withdrawals root computation
    const computedWithdrawalsRoot = bytesToHex(
      await Block.genWithdrawalsTrieRoot(withdrawals.map(Withdrawal.fromWithdrawalData), new Trie())
    )
    assert.equal(
      withdrawalsRoot,
      computedWithdrawalsRoot,
      'withdrawalsRoot compuation should match'
    )
    const { server } = await setupChain(genesisJSON, 'post-merge', { engine: true })
    const rpc = getRpcClient(server)
    let res = await rpc.request('engine_forkchoiceUpdatedV2', [
      validForkChoiceState,
      validPayloadAttributes,
    ])
    assert.equal(res.error.code, INVALID_PARAMS)
    assert.ok(
      res.error.message.includes('PayloadAttributesV2 MUST be used after Shanghai is activated')
    )

    res = await rpc.request('engine_forkchoiceUpdatedV2', [
      validForkChoiceState,
      validPayloadAttributesWithWithdrawals,
    ])

    assert.equal(res.result.payloadId !== undefined, true)
    const payloadId = res.result.payloadId

    let payload: ExecutionPayload | undefined = undefined
    res = await rpc.request('engine_getPayloadV2', [payloadId])

    const { executionPayload, blockValue } = res.result
    assert.equal(executionPayload!.blockNumber, '0x1')
    assert.equal(
      executionPayload!.withdrawals!.length,
      withdrawals.length,
      'withdrawals should match'
    )
    assert.equal(blockValue, '0x0', 'No value should be returned')
    payload = executionPayload

    if (gethBlockRlp !== undefined) {
      // check if stateroot matches
      assert.equal(
        payload!.stateRoot,
        '0x23eadd91fca55c0e14034e4d63b2b3ed43f2e807b6bf4d276b784ac245e7fa3f',
        'stateRoot should match'
      )
    }

    res = await rpc.request('engine_newPayloadV2', [payload])

    assert.equal(res.result.status, 'VALID')

    res = await rpc.request('engine_forkchoiceUpdatedV2', [
      {
        ...validForkChoiceState,
        headBlockHash: payload!.blockHash,
      },
    ])

    assert.equal(res.result.payloadStatus.status, 'VALID')
  })
}