import { Server } from '../../../src/net/server/index.js'
import { Event } from '../../../src/types.js'

import { MockPeer } from './mockpeer.js'
import { createServer, destroyServer, servers } from './network.js'

import type { ServerOptions } from '../../../src/net/server/index.js'
import type { RemoteStream } from './network.js'

interface MockServerOptions extends ServerOptions {
  location?: string
}

export class MockServer extends Server {
  public location: string
  public server: Server | null
  public peers: { [key: string]: MockPeer }

  constructor(options: MockServerOptions) {
    super(options)
    this.location = options.location ?? '127.0.0.1'
    this.server = null
    this.peers = {}
  }

  get name() {
    return 'mock'
  }

  async start(): Promise<boolean> {
    if (this.started) {
      return false
    }
    await super.start()
    await this.wait(1)

    this.server = createServer(this.location) as any
    await this.config.events.emit(Event.SERVER_LISTENING, {
      transport: this.name,
      url: `mock://${this.location}`,
    })
    ;(this.server as any).on('connection', async ({ id, stream }: { id: string; stream: any }) => {
      await this.connect(id, stream)
    })
    return true
  }

  async stop(): Promise<boolean> {
    // This wait is essential to clear out the pending setTimeout in the
    // createStream in ./network.ts
    await this.wait(20)
    while (servers[this.location] !== undefined) {
      await destroyServer(this.location)
    }
    await super.stop()
    return this.started
  }

  async discover(id: string, location: string) {
    const opts = { config: this.config, address: 'mock', transport: 'mock' }
    const peer = new MockPeer({ id, location, protocols: Array.from(this.protocols), ...opts })
    await peer.connect()
    this.peers[id] = peer
    await this.config.events.emit(Event.POOL_PEER_ADDED, { addedPeer: peer })
    return peer
  }

  async accept(id: string) {
    const opts = { config: this.config, address: 'mock', transport: 'mock', location: 'mock' }
    const peer = new MockPeer({ id, protocols: Array.from(this.protocols), ...opts })
    await peer.accept(this)
    return peer
  }

  async connect(id: string, stream: RemoteStream) {
    const opts = { config: this.config, address: 'mock', transport: 'mock', location: 'mock' }
    const peer = new MockPeer({
      id,
      inbound: true,
      server: this,
      protocols: Array.from(this.protocols),
      ...opts,
    })
    await peer.bindProtocols(stream)
    this.peers[id] = peer
    await this.config.events.emit(Event.PEER_CONNECTED, { connectedPeer: peer as any })
  }

  disconnect(id: string) {
    const peer = this.peers[id]
    if (peer !== undefined)
      void this.config.events.emit(Event.PEER_DISCONNECTED, { disconnectedPeer: peer as any })
  }

  async wait(delay?: number) {
    await new Promise((resolve) => setTimeout(resolve, delay ?? 100))
  }
}
