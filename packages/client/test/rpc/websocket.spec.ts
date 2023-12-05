import { randomBytes } from '@ethereumjs/util'
import { Client } from 'jayson/promise'
import { encode } from 'jwt-simple'
import { assert, describe, it } from 'vitest'

import { METHOD_NOT_FOUND } from '../../src/rpc/error-code'

import { startRPC } from './helpers'

import type { TAlgorithm } from 'jwt-simple'

const jwtSecret = randomBytes(32)

describe('JSON-RPC call', () => {
  it.skip('auth protected server with valid token', async () => {
    const claims = { iat: Math.floor(new Date().getTime() / 1000) }
    const _token = encode(claims, jwtSecret as never as string, 'HS256' as TAlgorithm)
    const server = startRPC({}, { wsServer: true }, { jwtSecret })
    server.listen(1234, 'localhost')
    const rpc = Client.websocket({
      url: 'ws://localhost:1234/',
    })
    try {
      await new Promise((resolve) => {
        ;(rpc as any).ws.on('open', async () => {
          const res = await rpc.request('METHOD_DOES_NOT_EXIST', ['0x1', true])
          assert.equal(res.error.code, METHOD_NOT_FOUND)
          resolve(undefined)
        })
      })
    } catch (err: any) {
      assert.fail(err)
    }
  })

  it.skip('auth protected server without any auth headers', async () => {
    const server = startRPC({}, { wsServer: true }, { jwtSecret })
    server.listen(1236, 'localhost')
    const rpc = Client.websocket({
      url: 'ws://localhost:1236/',
    })
    try {
      await new Promise((resolve) => {
        ;(rpc as any).ws.on('open', async () => {
          await rpc.request('plaintext', [])
          assert.fail('should have thrown')
          resolve(undefined)
        })
      })
    } catch (err: any) {
      assert.ok(err.message.includes('Unauthorized'))
    }
  }, 3000)

  it('server without any auth headers', async () => {
    const server = startRPC({}, { wsServer: true })
    server.listen(12345, 'localhost')
    const rpc = Client.websocket({
      url: 'ws://localhost:12345/',
    })
    try {
      await new Promise((resolve) => {
        ;(rpc as any).ws.on('open', async () => {
          const res = await rpc.request('METHOD_DOES_NOT_EXIST', ['0x1', true])
          assert.equal(res.error.code, METHOD_NOT_FOUND)
          resolve(undefined)
        })
      })
    } catch (err: any) {
      assert.fail(err)
    }
  })
})
