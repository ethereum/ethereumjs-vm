import { hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { DISCONNECT_REASON } from '../../src/types.js'

import * as util from './util.js'

describe('RLPx simulator tests', () => {
  it('RLPX: add working node', async () => {
    const basePort = 40404
    const { rlpxs, peer } = util.initTwoPeerRLPXSetup(undefined, undefined, undefined, basePort + 1)
    rlpxs[0]['_dpt']!.addPeer(peer).catch(() => {
      throw new Error('Peering failed')
    })
    await new Promise((resolve) => {
      rlpxs[0].events.on('peer:added', async (peer) => {
        assert.equal(
          peer['_port'],
          basePort + 1,
          'should have added peer on peer:added after successful handshake',
        )
        assert.equal(rlpxs[0].getPeers().length, 1, 'peer list length should be 1')
        assert.equal(rlpxs[0]._getOpenSlots(), 9, 'should have maxPeers - 1 open slots left')
        await util.delay(500)
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      })
    })
  })
  it('RLPX: ban node with missing tcp port', async () => {
    const { rlpxs, peer } = util.initTwoPeerRLPXSetup(undefined, undefined, undefined, 40444)
    rlpxs[0]['_dpt']!.addPeer(peer).catch(() => {
      throw new Error('Peering failed')
    })
    await new Promise((resolve) => {
      rlpxs[0].events.on('peer:added', async () => {
        const peer = {
          id: hexToBytes('0xabcd'),
          address: '127.0.0.1',
          udpPort: 30308,
          tcpPort: null,
        }
        assert.notOk(
          rlpxs[0]['_dpt']!['_banlist'].has(peer),
          'should not be in ban list before bad peer discovered',
        )
        rlpxs[0]['_dpt']!.events.emit('peer:new', peer)
        assert.ok(
          rlpxs[0]['_dpt']!['_banlist'].has(peer),
          'should be in ban list after bad peer discovered',
        )
        await util.delay(500)
        util.destroyRLPXs(rlpxs)
        resolve(undefined)
      })
    })
  })
  it('RLPX: remove node', async () => {
    const { rlpxs, peer } = util.initTwoPeerRLPXSetup(undefined, undefined, undefined, 40504)
    rlpxs[0]
      ['_dpt']!.addPeer(peer)
      .then((peer1) => {
        rlpxs[0].disconnect(peer1['id']!)
      })
      .catch((e) => {
        throw new Error(`Peering failed: ${e}: ${e.stack}`)
      })
    await new Promise((resolve) => {
      rlpxs[0].events.once('peer:removed', (_, reason: any) => {
        assert.equal(
          reason,
          DISCONNECT_REASON.CLIENT_QUITTING,
          'should close with CLIENT_QUITTING disconnect reason',
        )
        assert.equal(rlpxs[0]._getOpenSlots(), 10, 'should have maxPeers open slots left')
        util.destroyRLPXs(rlpxs)
      })
      resolve(undefined)
    })
  })
  it('RLPX: test peer queue / refill connections', async () => {
    const basePort = 60661
    const rlpxs = util.getTestRLPXs(3, 1, basePort)
    const peer = { address: util.localhost, udpPort: basePort + 1, tcpPort: basePort + 1 }
    rlpxs[0]['_dpt']!.addPeer(peer)
    await new Promise((resolve) => {
      rlpxs[0].events.on('peer:added', async (peer) => {
        //@ts-ignore
        assert.equal(peer._socket._peername.port, basePort + 1)
        assert.equal(rlpxs[0]['_peersQueue'].length, 0, 'peers queue should contain no peers')
        const peer2 = {
          address: util.localhost,
          udpPort: basePort + 2,
          tcpPort: basePort + 2,
        }
        rlpxs[0]['_dpt']!.addPeer(peer2).then((peer) => {
          assert.equal(rlpxs[0]['_peersQueue'].length, 1, 'peers queue should contain one peer')
          assert.equal(peer.tcpPort, basePort + 2)
          util.destroyRLPXs(rlpxs)
          resolve(undefined)
        })
      })
    })
  }, 10000)
})
