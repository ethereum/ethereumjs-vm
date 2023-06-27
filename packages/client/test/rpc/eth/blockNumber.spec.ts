import { bigIntToHex } from '@ethereumjs/util'
import tape from 'tape'

import { baseRequest, createClient, createManager, params, startRPC } from '../helpers'

const method = 'eth_blockNumber'

tape(`${method}: call with valid arguments`, async (t) => {
  const mockBlockNumber = BigInt(123)
  const mockChain = {
    headers: { latest: { number: mockBlockNumber } },
    async getCanonicalHeadHeader(): Promise<any> {
      return {
        number: mockBlockNumber,
      }
    },
  }
  const manager = createManager(createClient({ chain: mockChain }))
  const server = startRPC(manager.getMethods())

  const req = params(method)
  const expectRes = (res: any) => {
    t.equal(res.body.result, bigIntToHex(mockBlockNumber))
  }
  await baseRequest(t, server, req, 200, expectRes)
})
