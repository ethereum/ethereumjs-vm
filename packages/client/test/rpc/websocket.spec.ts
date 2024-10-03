import { randomBytes } from '@ethereumjs/util'
import WebSocket from 'isomorphic-ws'
import { Client } from 'jayson/promise'
import { assert, describe, it } from 'vitest'

import { jwt } from '../../src/ext/jwt-simple.js'
import { METHOD_NOT_FOUND } from '../../src/rpc/error-code.js'

import { startRPC } from './helpers.js'

import type { TAlgorithm } from '../../src/ext/jwt-simple.js'

const jwtSecret = randomBytes(32)
const { encode } = jwt

describe('JSON-RPC call', () => {
  it('auth protected server with valid token', async () => {
    const claims = { iat: Math.floor(new Date().getTime() / 1000) }
    const token = encode(claims, jwtSecret as never as string, 'HS256' as TAlgorithm)
    const server = startRPC({}, { wsServer: true }, { jwtSecret })
    server.listen(1234, 'localhost')
    const socket = new WebSocket('ws://localhost:1234', undefined, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const rpc = Client.websocket({
      //@ts-ignore -- `isomorphic-ws` types aren't perfectly mapped to jayson.WebSocketClient but works fine for this test
      ws: socket,
    })
    try {
      await new Promise((resolve) => {
        ;(rpc as any).ws.on('open', async () => {
          const res = await rpc.request('METHOD_DOES_NOT_EXIST', ['0x1', true])
          assert.equal(res.error.code, METHOD_NOT_FOUND)
          resolve(undefined)
        })
      })
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.fail(err)
    }
  })

  it('auth protected server without any auth headers', async () => {
    const server = startRPC({}, { wsServer: true }, { jwtSecret })
    server.listen(1236, 'localhost')
    const rpc = Client.websocket({
      url: 'ws://localhost:1236/',
    })

    await new Promise((resolve) => {
      ;(rpc as any).ws.on('error', async (err: any) => {
        assert.ok(err.message.includes('401'), 'Unauthorized')
        resolve(undefined)
      })
    })
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
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.fail(err)
    }
  })
})
