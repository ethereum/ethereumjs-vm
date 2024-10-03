import { Common, Hardfork, Mainnet, Sepolia } from '@ethereumjs/common'
import { hexToBytes, intToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import * as devp2p from '../../src/index.js'
import { ETH } from '../../src/index.js'

import * as util from './util.js'

import type { Capabilities } from '../../src/index.js'

const GENESIS_TD = 17179869184
const GENESIS_HASH = hexToBytes(
  '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
)

const capabilities = [devp2p.ETH.eth63, devp2p.ETH.eth62]

const status = {
  td: intToBytes(GENESIS_TD),
  bestHash: GENESIS_HASH,
  genesisHash: GENESIS_HASH,
}

describe('ETH simulator tests', () => {
  it('ETH: send status message (successful)', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any) {
        assert.ok(true, 'should receive echoing status message and welcome connection')
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 21762)
    })
  })

  it('ETH: send status message (NetworkId mismatch)', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onPeerError0 = function (err: Error, rlpxs: any) {
        const msg = 'NetworkId mismatch: 0x01 / 0xaa36a7'
        assert.equal(err.message, msg, `should emit error: ${msg}`)
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      }

      const c1 = new Common({ chain: Mainnet, hardfork: Hardfork.London })
      const c2 = new Common({ chain: Sepolia, hardfork: Hardfork.London })
      util.twoPeerMsgExchange(it, opts, capabilities, [c1, c2], 27126)
    })
  })

  it('ETH: send status message (Genesis block mismatch)', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      const status1 = Object.assign({}, status)
      status1['genesisHash'] = new Uint8Array(32)
      opts.status1 = status1
      opts.onPeerError0 = function (err: Error, rlpxs: any) {
        const msg =
          'Genesis block mismatch: 0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3 / 0x0000000000000000000000000000000000000000000000000000000000000000'
        assert.equal(err.message, msg, `should emit error: ${msg}`)
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 25182)
    })
  })

  async function sendWithProtocolVersion(t: typeof it, version: number, cap?: Capabilities[]) {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, eth: any) {
        assert.equal(eth.getVersion(), version, `should use eth${version} as protocol version`)
        eth.sendMessage(devp2p.ETH.MESSAGE_CODES.NEW_BLOCK_HASHES, [0, [437000, 1, 0, 0]])
        assert.ok(true, 'should send NEW_BLOCK_HASHES message')
      }
      opts.onOnMsg1 = function (rlpxs: any, eth: any, code: any) {
        if (code === devp2p.ETH.MESSAGE_CODES.NEW_BLOCK_HASHES) {
          assert.ok(true, 'should receive NEW_BLOCK_HASHES message')
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        }
      }
      util.twoPeerMsgExchange(it, opts, cap, undefined, 49182)
    })
  }

  async function sendNotAllowed(
    t: typeof it,
    version: number,
    cap: Capabilities[],
    expectedCode: ETH.MESSAGE_CODES,
  ) {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, eth: any) {
        try {
          eth.sendMessage(expectedCode, [])
        } catch (err) {
          if (!(err instanceof Error)) {
            err = new Error(err)
          }
          const msg = `Error: Code ${expectedCode} not allowed with version ${version}`
          assert.equal(err.toString(), msg, `should emit error: ${msg}`)
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        }
      }
      util.twoPeerMsgExchange(it, opts, cap, undefined, 16281)
    })
  }

  it('ETH: should use latest protocol version on default', async () => {
    await sendWithProtocolVersion(it, 66)
  })

  it(
    'ETH -> Eth64 -> sendStatus(): should throw on non-matching latest block provided',
    { timeout: 10000 },
    async () => {
      await new Promise((resolve) => {
        const cap = [devp2p.ETH.eth65]
        const common = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
        const status0: any = Object.assign({}, status)
        status0['latestBlock'] = intToBytes(100000) // lower than Byzantium fork block 4370000

        const rlpxs = util.initTwoPeerRLPXSetup(null, cap, common, 50505)
        rlpxs[0].events.on('peer:added', function (peer: any) {
          const protocol = peer.getProtocols()[0]
          assert.throws(() => {
            protocol.sendStatus(status0)
          }, /latest block provided is not matching the HF setting/)
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        })
      })
    },
  )

  it('ETH: send not-allowed eth67', async () => {
    await sendNotAllowed(it, 67, [devp2p.ETH.eth67], ETH.MESSAGE_CODES.GET_NODE_DATA)
    await sendNotAllowed(it, 67, [devp2p.ETH.eth67], ETH.MESSAGE_CODES.NODE_DATA)
  })

  it('ETH: should work with allowed eth64', async () => {
    const cap = [devp2p.ETH.eth64]
    await sendWithProtocolVersion(it, 64, cap)
  })

  it('ETH: send not-allowed eth64', async () => {
    await sendNotAllowed(it, 64, [devp2p.ETH.eth64], ETH.MESSAGE_CODES.POOLED_TRANSACTIONS)
  })

  it('ETH -> Eth64 -> ForkId validation 1a)', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      const cap = [devp2p.ETH.eth64]
      const common = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
      const status0: any = Object.assign({}, status)
      // Take a latest block > next mainnet fork block (constantinople)
      // to trigger validation condition
      status0['latestBlock'] = intToBytes(9069000)
      opts.status0 = status0
      opts.status1 = Object.assign({}, status)
      opts.onPeerError0 = function (err: Error, rlpxs: any) {
        const msg = 'Remote is advertising a future fork that passed locally'
        assert.equal(err.message, msg, `should emit error: ${msg}`)
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      }

      util.twoPeerMsgExchange(it, opts, cap, common, 37812)
    })
  })

  it('ETH: should work with allowed eth63', async () => {
    const cap = [devp2p.ETH.eth63]
    await sendWithProtocolVersion(it, 63, cap)
  })

  it('ETH: should work with allowed eth63', async () => {
    const cap = [devp2p.ETH.eth63]
    await sendWithProtocolVersion(it, 63, cap)
  })

  it('ETH: work with allowed eth62', async () => {
    const cap = [devp2p.ETH.eth62]
    await sendWithProtocolVersion(it, 62, cap)
  })

  it('ETH: send not-allowed eth62', async () => {
    await sendNotAllowed(it, 62, [devp2p.ETH.eth62], ETH.MESSAGE_CODES.GET_NODE_DATA)
  })

  it('ETH: send unknown message code', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, eth: any) {
        try {
          eth.sendMessage(0x55, [])
        } catch (err) {
          if (!(err instanceof Error)) {
            err = new Error(err)
          }
          const msg = 'Error: Unknown code 85'
          assert.equal(err.toString(), msg, `should emit error: ${msg}`)
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        }
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 12473)
    })
  })

  it('ETH: invalid status send', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, eth: any) {
        try {
          eth.sendMessage(devp2p.ETH.MESSAGE_CODES.STATUS, [])
        } catch (err) {
          if (!(err instanceof Error)) {
            err = new Error(err)
          }
          const msg = 'Error: Please send status message through .sendStatus'
          assert.equal(err.toString(), msg, `should emit error: ${msg}`)
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        }
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 12437)
    })
  })

  it('RLPX: verify that snappy compression is not used with an RLPX peer that only supports devp2p 4', async () => {
    await new Promise((resolve) => {
      const opts: any = { promise: resolve }
      opts.status0 = Object.assign({}, status)
      util.twoPeerMsgExchange2(it, opts, capabilities, undefined, 19631)
    })
  })
})
