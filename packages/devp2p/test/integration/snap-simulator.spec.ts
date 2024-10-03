import { assert, describe, it } from 'vitest'

import * as devp2p from '../../src/index.js'

import * as util from './util.js'

const capabilities = [devp2p.SNAP.snap]

// FIXME: Handle unhandled promises directly
process.on('unhandledRejection', () => {})

describe('Snap sync simulator tests', () => {
  it('SNAP: send valid message', () => {
    const opts: any = {}
    opts.sendMessage = function (rlpxs: any, snap: any) {
      assert.equal(snap.getVersion(), 1, 'should use snap1 as protocol version')
      snap.sendMessage(devp2p.SNAP.MESSAGE_CODES.GET_ACCOUNT_RANGE, [1, [437000, 1, 0, 0]])
      assert.ok(true, 'should send GET_ACCOUNT_RANGE message')
    }
    opts.receiveMessage = function (rlpxs: any, snap: any, code: any) {
      if (code === devp2p.SNAP.MESSAGE_CODES.GET_ACCOUNT_RANGE) {
        assert.ok(true, 'should receive GET_ACCOUNT_RANGE message')
        util.destroyRLPXs(rlpxs)
      }
    }
    util.twoPeerMsgExchange3(it, opts, capabilities, undefined, 50901)
  })

  it('SNAP: send unknown message code', () => {
    const opts: any = {}
    opts.sendMessage = function (rlpxs: any, snap: any) {
      try {
        snap.sendMessage(0x55, [1, []])
      } catch (err) {
        if (!(err instanceof Error)) {
          err = new Error(err)
        }
        const msg = 'Error: Unknown code 85'
        assert.equal(err.toString(), msg, `should emit error: ${msg}`)
        util.destroyRLPXs(rlpxs)
      }
    }
    util.twoPeerMsgExchange3(it, opts, capabilities, undefined, 50991)
  })
})
