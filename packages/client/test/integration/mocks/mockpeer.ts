import { EventEmitter } from 'events'
import { pipe } from 'it-pipe'
import pushable, { type Pushable } from 'it-pushable'

import { Peer } from '../../../src/net/peer/index.js'
import { Event } from '../../../src/types.js'

import { MockSender } from './mocksender.js'
import { createStream } from './network.js'

import type { PeerOptions } from '../../../src/net/peer/index.js'
import type { MockServer } from './mockserver.js'
import type { RemoteStream } from './network.js'
import type { BlockHeader } from '@ethereumjs/block'

interface MockPeerOptions extends PeerOptions {
  location: string
}

export class MockPeer extends Peer {
  public location: string
  public connected: boolean

  constructor(options: MockPeerOptions) {
    super({ ...options, transport: 'mock', address: options.location })
    this.location = options.location
    this.connected = false
    this.pooled = true
  }

  async connect() {
    if (this.connected) {
      return
    }
    await this.createStream(this.location)
    this.config.events.emit(Event.PEER_CONNECTED, this)
  }

  async latest(): Promise<BlockHeader | undefined> {
    if (this.eth !== undefined) {
      this.eth.updatedBestHeader = undefined
    }
    return super.latest()
  }

  async accept(server: MockServer) {
    if (this.connected) {
      return
    }
    await this.createStream(server.location)
    this.server = server
    this.inbound = true
  }

  async createStream(location: string) {
    const protocols = this.protocols.map((p) => `${p.name}/${p.versions[0]}`)
    const stream = createStream(this.id, location, protocols)
    await this.bindProtocols(stream)
  }

  async bindProtocols(stream: RemoteStream) {
    const receiver = new EventEmitter()
    const pushableFn: Pushable<Uint8Array> = pushable()
    pipe(pushableFn, stream)
    void pipe(stream, async (source: any) => {
      for await (const data of source) {
        setTimeout(() => {
          receiver.emit('data', data)
        }, 100)
      }
    })
    await Promise.all(
      this.protocols.map(async (p) => {
        if (!(stream.protocols as string[]).includes(`${p.name}/${p.versions[0]}`)) return
        await p.open()
        await this.addProtocol(new MockSender(p.name, pushableFn, receiver), p)
      }),
    )
    this.connected = true
  }
}
