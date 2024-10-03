// Tests written with help from CodiumAI

import { Common, Mainnet } from '@ethereumjs/common'
import { equalsBytes, randomBytes } from '@ethereumjs/util'
import assert from 'assert'
import { secp256k1 } from 'ethereum-cryptography/secp256k1.js'
import EventEmitter from 'events'
import { describe, expect, it, vi } from 'vitest'

import { RLPx, pk2id } from '../src/index.js'

import type { RLPxOptions } from '../src/index.js'

const privateKey = randomBytes(32)
describe('RLPx', () => {
  it('should create an instance of RLPx with the given private key and options', () => {
    const options: RLPxOptions = {
      timeout: 10000,
      maxPeers: 10,
      clientId: new Uint8Array([6, 7, 8, 9, 10]),
      capabilities: [],
      common: new Common({ chain: Mainnet }),
    }

    const rlpx = new RLPx(privateKey, options)

    expect(rlpx).toBeInstanceOf(RLPx)
    expect(rlpx.events).toBeInstanceOf(EventEmitter)
    expect(rlpx['_privateKey']).toEqual(privateKey)
    expect(rlpx.id).toEqual(pk2id(secp256k1.getPublicKey(privateKey, false)))
    expect(rlpx['_timeout']).toEqual(options.timeout)
    expect(rlpx['_maxPeers']).toEqual(options.maxPeers)
    expect(rlpx.clientId).toEqual(options.clientId)
    expect(rlpx['_remoteClientIdFilter']).toBeUndefined()
    expect(rlpx['_capabilities']).toEqual(options.capabilities)
    assert.deepEqual(rlpx['_common'], options.common)
    expect(rlpx['_listenPort']).toBeNull()
    expect(rlpx['_dpt']).toBeNull()
    expect(rlpx['_peersQueue']).toEqual([])
    expect(rlpx['_peers']).toBeInstanceOf(Map)
    expect(rlpx['_refillIntervalId']).toBeDefined()
    expect(rlpx['_refillIntervalSelectionCounter']).toEqual(0)
  })

  it('should start listening for incoming connections', () => {
    const options: RLPxOptions = {
      timeout: 10000,
      maxPeers: 10,
      clientId: new Uint8Array([6, 7, 8, 9, 10]),
      capabilities: [],
      common: new Common({ chain: Mainnet }),
    }

    const rlpx = new RLPx(privateKey, options)
    const mockServer = {
      listen: vi.fn(),
    }
    rlpx['_server'] = mockServer as any

    rlpx.listen(30303)

    expect(mockServer.listen).toHaveBeenCalledWith(30303)
  })

  it('should connect to a peer', async () => {
    vi.mock('net', () => {
      const Socket = vi.fn().mockImplementation(() => {
        return {
          on: vi.fn(),
          once: vi.fn(),
          setTimeout: () => {},
          connect: vi.fn().mockImplementation(() => {
            return 'mocked resolve!'
          }),
        }
      })
      return {
        createServer: () => {
          return {
            once: vi.fn(),
            on: vi.fn(),
            address: () => '0.0.0.0',
          }
        },
        Socket,
      }
    })
    vi.mock('../src/util.js', async () => {
      const util: any = await vi.importActual('../src/util.js')
      return {
        ...util,
        createDeferred: vi.fn().mockImplementation(() => {
          return {
            promise: {
              resolve: vi.fn().mockResolvedValue(() => 'mocked resolve!'),
              reject: vi.fn(),
            },
          }
        }),
      }
    })
    const options: RLPxOptions = {
      timeout: 10000,
      maxPeers: 10,
      clientId: new Uint8Array([6, 7, 8, 9, 10]),
      capabilities: [],
      common: new Common({ chain: Mainnet }),
    }

    const rlpx = new RLPx(privateKey, options)
    const mockServer = {
      listen: vi.fn(),
      once: vi.fn(),
      on: vi.fn(),
    }
    rlpx['_server'] = mockServer as any
    const mockPeer = {
      tcpPort: 30303,
      address: '127.0.0.1',
      id: new Uint8Array([11, 12, 13, 14, 15]),
    }

    const mockOnConnect = vi.spyOn(rlpx, '_onConnect').mockImplementation((_, peerId) => {
      assert(equalsBytes(peerId as Uint8Array, mockPeer.id), 'received correct peerId')
    })
    await rlpx.connect(mockPeer)

    expect(mockOnConnect).toHaveBeenCalled()
  })

  it('should throw an error if already connected to a peer', async () => {
    const options: RLPxOptions = {
      timeout: 10000,
      maxPeers: 10,
      clientId: new Uint8Array([6, 7, 8, 9, 10]),
      capabilities: [],
      common: new Common({ chain: Mainnet }),
    }
    const rlpx = new RLPx(privateKey, options)
    const mockPeer = {
      tcpPort: 30303,
      address: '127.0.0.1',
      id: new Uint8Array([11, 12, 13, 14, 15]),
    }
    rlpx['_peers'].set('0b0c0d0e0f', {} as any)

    try {
      await rlpx.connect(mockPeer)
      assert.fail('should throw')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.equal(err.message, 'Already connected')
    }
  })

  it('should return open slots and open queue slots', () => {
    const options: RLPxOptions = {
      timeout: 10000,
      maxPeers: 10,
      clientId: new Uint8Array([6, 7, 8, 9, 10]),
      capabilities: [],
      common: new Common({ chain: Mainnet }),
    }
    const rlpx = new RLPx(privateKey, options)

    assert.equal(
      rlpx['_getOpenSlots'](),
      10,
      'returns default number of open slots (i.e. `max_peers`) on startup',
    )
    assert.equal(
      rlpx['_getOpenQueueSlots'](),
      20,
      'returns default number of open queue slots on startup',
    )
  })
})
