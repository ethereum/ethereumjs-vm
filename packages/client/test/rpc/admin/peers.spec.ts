import { randomBytes } from 'crypto'
import { assert, describe, it } from 'vitest'

import { createClient, createManager, getRpcClient, startRPC } from '../helpers.js'

const method = 'admin_peers'

describe(method, () => {
  it('works', async () => {
    const manager = createManager(await createClient({ opened: true, noPeers: true }))
    const rpc = getRpcClient(startRPC(manager.getMethods()))

    // eslint-disable-next-line no-console
    console.log(manager['_client'].services[0].pool)
    //@ts-ignore
    manager['_client'].services[0].pool.peers = [
      {
        id: 'abcd',
        eth: {
          versions: ['68'],
          status: {
            td: 1n,
            bestHash: randomBytes(32),
          },
        },
        rlpxPeer: {
          _hello: {
            clientId: 'fakeClient',
          },
        },
        address: '127.0.0.1:8545',
      },
    ]
    const res = await rpc.request(method, [])
    const { result } = res
    // eslint-disable-next-line no-console
    console.log(res)
    assert.notEqual(result, undefined, 'admin_peers returns a value')
  })
})
