import { BlockHeader } from '@ethereumjs/block'
import { Chain, Common } from '@ethereumjs/common'
import { assert, describe, it } from 'vitest'

import { baseSetup, createClient, createManager, getRpcClient, startRPC } from '../helpers.js'

const method = 'eth_chainId'

const originalValidate = (BlockHeader as any).prototype._consensusFormatValidation

describe(method, () => {
  it('calls', async () => {
    const { rpc } = baseSetup()

    const res = await rpc.request(method, [])
    const msg = 'chainId should be a string'
    assert.equal(typeof res.result, 'string', msg)
  })

  it('returns 1 for Mainnet', async () => {
    const { rpc } = baseSetup()

    const res = await rpc.request(method, [])

    const msg = 'should return chainId 1'
    assert.equal(res.result, '0x1', msg)
  })

  it('returns 3 for Goerli', async () => {
    const manager = createManager(
      createClient({ opened: true, commonChain: new Common({ chain: Chain.Goerli }) })
    )
    const rpc = getRpcClient(startRPC(manager.getMethods()))

    const res = await rpc.request(method, [])

    const msg = 'should return chainId 5'
    assert.equal(res.result, '0x5', msg)
  })

  it('reset mocks', () => {
    BlockHeader.prototype['_consensusFormatValidation'] = originalValidate
  })
})
