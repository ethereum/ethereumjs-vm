import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { intToBytes } from '@ethereumjs/util'
import { hexToBytes } from 'ethereum-cryptography/utils.js'
import { assert, describe, it } from 'vitest'

import * as devp2p from '../../src/index.js'

import * as util from './util.js'

const GENESIS_TD = 17179869184
const GENESIS_HASH = hexToBytes('d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3')

const capabilities = [devp2p.LES.les4]

const status = {
  headTd: intToBytes(GENESIS_TD), // total difficulty in genesis block
  headHash: GENESIS_HASH,
  headNum: intToBytes(0),
  genesisHash: GENESIS_HASH,
}

// FIXME: Handle unhandled promises directly
process.on('unhandledRejection', () => {})

describe('LES simulator tests', () => {
  it('LES: send status message (successful)', () => {
    const opts: any = {}
    opts.status0 = Object.assign({}, status)
    opts.status1 = Object.assign({}, status)
    opts.onOnceStatus0 = function (rlpxs: any) {
      assert.ok(true, 'should receive echoing status message and welcome connection')
      util.destroyRLPXs(rlpxs)
    }
    util.twoPeerMsgExchange(it, opts, capabilities, undefined, 31650)
  })

  it('LES: send status message (modified announceType)', () => {
    const opts: any = {}
    opts.status0 = Object.assign({}, status)
    opts.status0['announceType'] = 0
    opts.status1 = Object.assign({}, status)
    opts.status1['announceType'] = 0
    opts.onOnceStatus0 = function (rlpxs: any) {
      assert.ok(true, 'should receive echoing status message and welcome connection')
      util.destroyRLPXs(rlpxs)
    }
    util.twoPeerMsgExchange(it, opts, capabilities, undefined, 31315)
  })

  it('LES: send status message (NetworkId mismatch)', () => {
    const opts: any = {}
    opts.status0 = Object.assign({}, status)
    opts.status1 = Object.assign({}, status)
    opts.onPeerError0 = function (err: Error, rlpxs: any) {
      const msg = 'NetworkId mismatch: 01 / 03'
      assert.equal(err.message, msg, `should emit error: ${msg}`)
      util.destroyRLPXs(rlpxs)
    }

    const c1 = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
    const c2 = new Common({ chain: Chain.Ropsten, hardfork: Hardfork.London })
    util.twoPeerMsgExchange(it, opts, capabilities, [c1, c2], 41591)
  })

  it('ETH: send status message (Genesis block mismatch)', () => {
    const opts: any = {}
    opts.status0 = Object.assign({}, status)
    const status1 = Object.assign({}, status)
    status1['genesisHash'] = new Uint8Array(32)
    opts.status1 = status1
    opts.onPeerError0 = function (err: Error, rlpxs: any) {
      const msg =
        'Genesis block mismatch: d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3 / 0000000000000000000000000000000000000000000000000000000000000000'
      assert.equal(err.message, msg, `should emit error: ${msg}`)
      util.destroyRLPXs(rlpxs)
    }
    util.twoPeerMsgExchange(it, opts, capabilities, undefined, 49124)
  })

  it('LES: send valid message', () => {
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
      }
    }
    util.twoPeerMsgExchange(it, opts, capabilities, undefined, 40318)
  })

  it('LES: send unknown message code', () => {
    const opts: any = {}
    opts.status0 = Object.assign({}, status)
    opts.status1 = Object.assign({}, status)
    opts.onOnceStatus0 = function (rlpxs: any, les: any) {
      try {
        les.sendMessage(0x55, [1, []])
      } catch (err: any) {
        const msg = 'Error: Unknown code 85'
        assert.equal(err.toString(), msg, `should emit error: ${msg}`)
        util.destroyRLPXs(rlpxs)
      }
    }
    util.twoPeerMsgExchange(it, opts, capabilities, undefined, 40282)
  })

  it('LES: invalid status send', () => {
    const opts: any = {}
    opts.status0 = Object.assign({}, status)
    opts.status1 = Object.assign({}, status)
    opts.onOnceStatus0 = function (rlpxs: any, les: any) {
      try {
        les.sendMessage(devp2p.ETH.MESSAGE_CODES.STATUS, 1, [])
      } catch (err: any) {
        const msg = 'Error: Please send status message through .sendStatus'
        assert.equal(err.toString(), msg, `should emit error: ${msg}`)
        util.destroyRLPXs(rlpxs)
      }
    }
    util.twoPeerMsgExchange(it, opts, capabilities, undefined, 40182)
  })
})
