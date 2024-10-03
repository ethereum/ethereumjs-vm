//@ts-nocheck
// cspell:ignore psender pnode muxed muxer
import { multiaddr } from '@multiformats/multiaddr'

import { Peer } from '../../../src/net/peer/peer'
import { Libp2pSender } from '../libp2psender'
import { Event } from '../../../src/types'

import { Libp2pNode } from './libp2pnode'

import type { PeerOptions } from '../../../src/net/peer/peer'
import type { Protocol } from '../../../src/net/protocol'
import type { Libp2pServer } from '../../../src/net/server'
import type { MuxedStream } from 'libp2p-interfaces/dist/src/stream-muxer/types'
import type { Multiaddr } from '@multiformats/multiaddr'
import { PeerId, isPeerId } from '@libp2p/interface-peer-id'

export interface Libp2pPeerOptions extends Omit<PeerOptions, 'address' | 'transport'> {
  /* Multiaddrs to listen on */
  multiaddrs?: Multiaddr[]
}

/**
 * Libp2p peer
 * @memberof module:net/peer
 * @example
 * ```typescript
 * import { multiaddr } from '@multiformats/multiaddr'
 * import { Libp2pPeer } from './src/net/peer'
 * import { Chain } from './src/blockchain'
 * import { EthProtocol } from './src/net/protocol'
 *
 * const chain = await Chain.create()
 * const protocols = [new EthProtocol({ chain })]
 * const id = 'QmWYhkpLFDhQBwHCMSWzEebbJ5JzXWBKLJxjEuiL8wGzUu' // cspell:disable-line
 * const multiaddrs = [multiaddr('/ip4/192.0.2.1/tcp/12345')]
 *
 * new Libp2pPeer({ id, multiaddrs, protocols })
 *   .on('error', (err) => console.log('Error: ', err))
 *   .on('connected', () => console.log('Connected'))
 *   .on('disconnected', (reason) => console.log('Disconnected: ', reason))
 *   .connect()
 * ```
 */
export class Libp2pPeer extends Peer {
  private multiaddrs: Multiaddr[]
  private connected: boolean

  /**
   * Create new libp2p peer
   */
  constructor(options: Libp2pPeerOptions) {
    const multiaddrs = options.multiaddrs ?? [multiaddr('/ip4/0.0.0.0/tcp/0')]
    const address = multiaddrs.map((ma) => ma.toString().split('/p2p')[0]).join(',')

    super({ ...options, transport: 'libp2p', address })

    this.multiaddrs = multiaddrs
    this.connected = false
  }

  /**
   * Initiate peer connection
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return
    }
    const peerId = PeerId.createFromB58String(this.id)
    const addresses = { listen: ['/ip4/0.0.0.0/tcp/0'] }
    const node = new Libp2pNode({ peerId, addresses })
    await node.start()
    for (const ma of this.multiaddrs) {
      await node.dial(ma as any)
      await this.bindProtocols(node, ma)
    }
    this.config.events.emit(Event.PEER_CONNECTED, this)
  }

  /**
   * Accept new peer connection from a libp2p server
   */
  async accept(protocol: Protocol, stream: MuxedStream, server: Libp2pServer): Promise<void> {
    await this.bindProtocol(protocol, new Libp2pSender(stream))
    this.inbound = true
    this.server = server
  }

  /**
   * Adds protocols to the peer given a libp2p node and peerId or multiaddr
   * @param node libp2p node
   * @param peer libp2p peerId or multiaddr
   * @param server server that initiated connection
   */
  async bindProtocols(
    node: Libp2pNode,
    peer: PeerId | Multiaddr,
    server?: Libp2pServer,
  ): Promise<void> {
    await Promise.all(
      this.protocols.map(async (p) => {
        await p.open()
        const protocol = `/${p.name}/${p.versions[0]}`
        try {
          const { stream } = await node.dialProtocol(peer as any, protocol)
          await this.bindProtocol(p, new Libp2pSender(stream))
        } catch (err) {
          if (!(err instanceof Error)) {
            err = new Error(err)
          }
          const peerInfo = isPeerId(peer) ? `id=${peer.toB58String()}` : `multiaddr=${peer}`
          this.config.logger.debug(
            `Peer doesn't support protocol=${protocol} ${peerInfo} ${err.stack}`,
          )
        }
      }),
    )
    this.server = server
    this.connected = true
  }
}
