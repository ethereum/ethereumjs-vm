/**
 * Libp2p Bundle
 * @memberof module:net/peer
 */

import multiaddr from 'multiaddr'
import LibP2p from 'libp2p'
import { NOISE } from '@chainsafe/libp2p-noise'
import PeerId from 'peer-id'
// types currently unavailable for below libp2p deps,
// tracking issue: https://github.com/libp2p/js-libp2p/issues/659
const LibP2pTcp = require('libp2p-tcp')
const LibP2pWebsockets = require('libp2p-websockets')
const filters = require('libp2p-websockets/src/filters')
const LibP2pBootstrap = require('libp2p-bootstrap')
const LibP2pKadDht = require('libp2p-kad-dht')
const mplex = require('libp2p-mplex')

export interface Libp2pNodeOptions {
  /* Peer id */
  peerId: PeerId

  /* Addresses */
  addresses?: {
    listen?: string[]
    announce?: string[]
    announceFilter?: (ma: multiaddr[]) => multiaddr[]
  }

  /* Bootnodes */
  bootnodes?: multiaddr[]
}

export class Libp2pNode extends LibP2p {
  constructor(options: Libp2pNodeOptions) {
    const wsTransportKey = LibP2pWebsockets.prototype[Symbol.toStringTag]
    options.bootnodes = options.bootnodes ?? []
    super({
      peerId: options.peerId,
      addresses: options.addresses,
      modules: {
        transport: [LibP2pTcp, LibP2pWebsockets],
        streamMuxer: [mplex],
        connEncryption: [NOISE],
        [<any>'peerDiscovery']: [LibP2pBootstrap],
        [<any>'dht']: LibP2pKadDht,
      },
      config: {
        transport: {
          [wsTransportKey]: {
            filter: filters.all,
          },
        },
        peerDiscovery: {
          autoDial: false,
          [LibP2pBootstrap.tag]: {
            interval: 2000,
            enabled: options.bootnodes.length > 0,
            list: options.bootnodes,
          },
        },
        dht: {
          kBucketSize: 20,
        },
      },
    })
  }
}
