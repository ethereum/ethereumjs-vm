import { Common, Hardfork, Mainnet, Sepolia } from '@ethereumjs/common'
import { hexToBytes, intToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import * as devp2p from '../../src/index.js'

import * as util from './util.js'

const GENESIS_TD = 17179869184
const GENESIS_HASH = hexToBytes(
  '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
)

const capabilities = [devp2p.LES.les4]

const status = {
  headTd: intToBytes(GENESIS_TD), // total difficulty in genesis block
  headHash: GENESIS_HASH,
  headNum: intToBytes(0),
  genesisHash: GENESIS_HASH,
}

describe('LES simulator tests', () => {
  it('LES: send status message (successful)', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any) {
        assert.ok(true, 'should receive echoing status message and welcome connection')
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 31650)
    })
  })

  it('LES: send status message (modified announceType)', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status0['announceType'] = 0
      opts.status1 = Object.assign({}, status)
      opts.status1['announceType'] = 0
      opts.onOnceStatus0 = function (rlpxs: any) {
        assert.ok(true, 'should receive echoing status message and welcome connection')
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 31315)
    })
  })

  it('LES: send status message (NetworkId mismatch)', async () => {
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
      util.twoPeerMsgExchange(it, opts, capabilities, [c1, c2], 41599)
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
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 49124)
    })
  })

  it('LES: send valid message', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, les: any) {
        assert.equal(les.getVersion(), 4, 'should use les4 as protocol version')
        les.sendMessage(devp2p.LES.MESSAGE_CODES.GET_BLOCK_HEADERS, [1, [437000, 1, 0, 0]])
        assert.ok(true, 'should send GET_BLOCK_HEADERS message')
      }
      opts.onOnMsg1 = function (rlpxs: any, eth: any, code: any) {
        if (code === devp2p.LES.MESSAGE_CODES.GET_BLOCK_HEADERS) {
          assert.ok(true, 'should receive GET_BLOCK_HEADERS message')
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        }
      }
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 40318)
    })
  })

  it('LES: send unknown message code', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, les: any) {
        try {
          les.sendMessage(0x55, [1, []])
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
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 40282)
    })
  })

  it('LES: invalid status send', async () => {
    await new Promise((resolve) => {
      const opts: any = {}
      opts.status0 = Object.assign({}, status)
      opts.status1 = Object.assign({}, status)
      opts.onOnceStatus0 = function (rlpxs: any, les: any) {
        try {
          les.sendMessage(devp2p.ETH.MESSAGE_CODES.STATUS, 1, [])
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
      util.twoPeerMsgExchange(it, opts, capabilities, undefined, 40182)
    })
  })
})
