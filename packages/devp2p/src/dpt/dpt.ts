import { randomBytes } from '@ethereumjs/util'
import { getPublicKey } from 'ethereum-cryptography/secp256k1'
import { EventEmitter } from 'events'
import ms = require('ms')

import { DNS } from '../dns'
import { bytes2int, devp2pDebug, pk2id } from '../util'

import { BanList } from './ban-list'
import { KBucket } from './kbucket'
import { Server as DPTServer } from './server'

import type { Debugger } from 'debug'

const DEBUG_BASE_NAME = 'dpt'

export interface PeerInfo {
  id?: Uint8Array
  address?: string
  udpPort?: number | null
  tcpPort?: number | null
}

export interface DPTOptions {
  /**
   * Timeout for peer requests
   *
   * Default: 10s
   */
  timeout?: number

  /**
   * Network info to send a long a request
   *
   * Default: 0.0.0.0, no UDP or TCP port provided
   */
  endpoint?: PeerInfo

  /**
   * Function for socket creation
   *
   * Default: dgram-created socket
   */
  createSocket?: Function

  /**
   * Interval for peer table refresh
   *
   * Default: 60s
   */
  refreshInterval?: number

  /**
   * Toggles whether or not peers should be queried with 'findNeighbours'
   * to discover more peers
   *
   * Default: true
   */
  shouldFindNeighbours?: boolean

  /**
   * Toggles whether or not peers should be discovered by querying EIP-1459 DNS lists
   *
   * Default: false
   */
  shouldGetDnsPeers?: boolean

  /**
   * Max number of candidate peers to retrieve from DNS records when
   * attempting to discover new nodes
   *
   * Default: 25
   */
  dnsRefreshQuantity?: number

  /**
   * EIP-1459 ENR tree urls to query for peer discovery
   *
   * Default: (network dependent)
   */
  dnsNetworks?: string[]

  /**
   * DNS server to query DNS TXT records from for peer discovery
   */
  dnsAddr?: string
}

export class DPT extends EventEmitter {
  privateKey: Uint8Array
  banlist: BanList
  dns: DNS
  _debug: Debugger

  private _id: Uint8Array | undefined
  private _kbucket: KBucket
  private _server: DPTServer
  private _refreshIntervalId: NodeJS.Timeout
  private _refreshIntervalSelectionCounter: number = 0
  private _shouldFindNeighbours: boolean
  private _shouldGetDnsPeers: boolean
  private _dnsRefreshQuantity: number
  private _dnsNetworks: string[]
  private _dnsAddr: string

  constructor(privateKey: Uint8Array, options: DPTOptions) {
    super()

    this.privateKey = privateKey
    this._id = pk2id(getPublicKey(this.privateKey, false))
    this._shouldFindNeighbours = options.shouldFindNeighbours ?? true
    this._shouldGetDnsPeers = options.shouldGetDnsPeers ?? false
    // By default, tries to connect to 12 new peers every 3s
    this._dnsRefreshQuantity = Math.floor((options.dnsRefreshQuantity ?? 25) / 2)
    this._dnsNetworks = options.dnsNetworks ?? []
    this._dnsAddr = options.dnsAddr ?? '8.8.8.8'

    this.dns = new DNS({ dnsServerAddress: this._dnsAddr })
    this.banlist = new BanList()

    this._kbucket = new KBucket(this._id)
    this._kbucket.on('added', (peer: PeerInfo) => this.emit('peer:added', peer))
    this._kbucket.on('removed', (peer: PeerInfo) => this.emit('peer:removed', peer))
    this._kbucket.on('ping', this._onKBucketPing.bind(this))

    this._server = new DPTServer(this, this.privateKey, {
      timeout: options.timeout,
      endpoint: options.endpoint,
      createSocket: options.createSocket,
    })
    this._server.once('listening', () => this.emit('listening'))
    this._server.once('close', () => this.emit('close'))
    this._server.on('error', (err) => this.emit('error', err))
    this._debug = devp2pDebug.extend(DEBUG_BASE_NAME)
    // When not using peer neighbour discovery we don't add peers here
    // because it results in duplicate calls for the same targets
    this._server.on('peers', (peers) => {
      if (!this._shouldFindNeighbours) return
      this._addPeerBatch(peers)
    })

    // By default calls refresh every 3s
    const refreshIntervalSubdivided = Math.floor((options.refreshInterval ?? ms('60s')) / 10)
    this._refreshIntervalId = setInterval(() => this.refresh(), refreshIntervalSubdivided)
  }

  bind(...args: any[]): void {
    this._server.bind(...args)
  }

  destroy(...args: any[]): void {
    clearInterval(this._refreshIntervalId)
    this._server.destroy(...args)
  }

  _onKBucketPing(oldPeers: PeerInfo[], newPeer: PeerInfo): void {
    if (this.banlist.has(newPeer)) return

    let count = 0
    let err: Error | null = null
    for (const peer of oldPeers) {
      this._server
        .ping(peer)
        .catch((_err: Error) => {
          this.banlist.add(peer, ms('5m'))
          this._kbucket.remove(peer)
          err = err ?? _err
        })
        .then(() => {
          if (++count < oldPeers.length) return
          if (err === null) this.banlist.add(newPeer, ms('5m'))
          else this._kbucket.add(newPeer)
        })
    }
  }

  _addPeerBatch(peers: PeerInfo[]): void {
    const DIFF_TIME_MS = 200
    let ms = 0
    for (const peer of peers) {
      setTimeout(() => {
        this.addPeer(peer).catch((error) => {
          this.emit('error', error)
        })
      }, ms)
      ms += DIFF_TIME_MS
    }
  }

  async bootstrap(peer: PeerInfo): Promise<void> {
    try {
      peer = await this.addPeer(peer)
    } catch (error: any) {
      this.emit('error', error)
      return
    }
    if (!this._id) return
    if (this._shouldFindNeighbours) {
      this._server.findneighbours(peer, this._id)
    }
  }

  async addPeer(obj: PeerInfo): Promise<any> {
    if (this.banlist.has(obj)) throw new Error('Peer is banned')
    this._debug(`attempt adding peer ${obj.address}:${obj.udpPort}`)

    // check k-bucket first
    const peer = this._kbucket.get(obj)
    if (peer !== null) return peer

    // check that peer is alive
    try {
      const peer = await this._server.ping(obj)
      this.emit('peer:new', peer)
      this._kbucket.add(peer)
      return peer
    } catch (err: any) {
      this.banlist.add(obj, ms('5m'))
      throw err
    }
  }

  getPeer(obj: string | Uint8Array | PeerInfo) {
    return this._kbucket.get(obj)
  }

  getPeers() {
    return this._kbucket.getAll()
  }

  getClosestPeers(id: Uint8Array) {
    return this._kbucket.closest(id)
  }

  removePeer(obj: any) {
    this._kbucket.remove(obj)
  }

  banPeer(obj: string | Uint8Array | PeerInfo, maxAge?: number) {
    this.banlist.add(obj, maxAge)
    this._kbucket.remove(obj)
  }

  async getDnsPeers(): Promise<PeerInfo[]> {
    return this.dns.getPeers(this._dnsRefreshQuantity, this._dnsNetworks)
  }

  async refresh(): Promise<void> {
    if (this._shouldFindNeighbours) {
      // Rotating selection counter going in loop from 0..9
      this._refreshIntervalSelectionCounter = (this._refreshIntervalSelectionCounter + 1) % 10

      const peers = this.getPeers()
      this._debug(
        `call .refresh() (selector ${this._refreshIntervalSelectionCounter}) (${peers.length} peers in table)`
      )

      for (const peer of peers) {
        // Randomly distributed selector based on peer ID
        // to decide on subdivided execution
        const selector = bytes2int((peer.id as Uint8Array).slice(0, 1)) % 10
        if (selector === this._refreshIntervalSelectionCounter) {
          this._server.findneighbours(peer, randomBytes(64))
        }
      }
    }

    if (this._shouldGetDnsPeers) {
      const dnsPeers = await this.getDnsPeers()

      this._debug(
        `.refresh() Adding ${dnsPeers.length} from DNS tree, (${
          this.getPeers().length
        } current peers in table)`
      )

      this._addPeerBatch(dnsPeers)
    }
  }
}
