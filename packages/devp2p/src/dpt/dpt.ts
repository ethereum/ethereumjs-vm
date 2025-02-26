import {
  EthereumJSErrorWithoutCode,
  bytesToInt,
  bytesToUnprefixedHex,
  randomBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { secp256k1 } from 'ethereum-cryptography/secp256k1.js'
import { EventEmitter } from 'eventemitter3'

import { DNS } from '../dns/index.js'
import { devp2pDebug, pk2id } from '../util.js'

import { BanList } from './ban-list.js'
import { KBucket } from './kbucket.js'
import { Server as DPTServer } from './server.js'

import type { DPTEvent, DPTOptions, PeerInfo } from '../types.js'
import type { Debugger } from 'debug'

const DEBUG_BASE_NAME = 'dpt'

export class DPT {
  public events: EventEmitter<DPTEvent>
  protected _privateKey: Uint8Array
  protected _banlist: BanList
  protected _dns: DNS
  private _debug: Debugger

  public readonly id: Uint8Array | undefined
  protected _kbucket: KBucket
  protected _server: DPTServer
  protected _refreshIntervalId: NodeJS.Timeout
  protected _refreshIntervalSelectionCounter: number = 0
  protected _shouldFindNeighbours: boolean
  protected _shouldGetDnsPeers: boolean
  protected _dnsRefreshQuantity: number
  protected _dnsNetworks: string[]
  protected _dnsAddr: string

  protected _onlyConfirmed: boolean
  protected _confirmedPeers: Set<string>

  protected _keccakFunction: (msg: Uint8Array) => Uint8Array

  private DEBUG: boolean

  constructor(privateKey: Uint8Array, options: DPTOptions) {
    this.events = new EventEmitter<DPTEvent>()
    this._privateKey = privateKey
    this.id = pk2id(secp256k1.getPublicKey(this._privateKey, false))
    this._shouldFindNeighbours = options.shouldFindNeighbours ?? true
    this._shouldGetDnsPeers = options.shouldGetDnsPeers ?? false
    // By default, tries to connect to 12 new peers every 3s
    this._dnsRefreshQuantity = Math.floor((options.dnsRefreshQuantity ?? 25) / 2)
    this._dnsNetworks = options.dnsNetworks ?? []
    this._dnsAddr = options.dnsAddr ?? '8.8.8.8'

    this._dns = new DNS({ dnsServerAddress: this._dnsAddr, common: options.common })
    this._banlist = new BanList()

    this._onlyConfirmed = options.onlyConfirmed ?? false
    this._confirmedPeers = new Set()

    this._keccakFunction = options.common?.customCrypto.keccak256 ?? keccak256

    this._kbucket = new KBucket(this.id)
    this._kbucket.events.on('added', (peer: PeerInfo) => this.events.emit('peer:added', peer))
    this._kbucket.events.on('removed', (peer: PeerInfo) => this.events.emit('peer:removed', peer))
    this._kbucket.events.on('ping', this._onKBucketPing.bind(this))

    this._server = new DPTServer(this, this._privateKey, {
      timeout: options.timeout,
      endpoint: options.endpoint,
      createSocket: options.createSocket,
      common: options.common,
    })
    this._server.events.once('listening', () => this.events.emit('listening'))
    this._server.events.once('close', () => this.events.emit('close'))
    this._server.events.on('error', (err) => this.events.emit('error', err))
    this._debug = devp2pDebug.extend(DEBUG_BASE_NAME)
    // When not using peer neighbour discovery we don't add peers here
    // because it results in duplicate calls for the same targets
    this._server.events.on('peers', (peers) => {
      if (!this._shouldFindNeighbours) return
      this._addPeerBatch(peers)
    })

    // By default calls refresh every 3s
    const refreshIntervalSubdivided = Math.floor((options.refreshInterval ?? 60000) / 10) // 60 sec * 1000
    this._refreshIntervalId = setInterval(() => this.refresh(), refreshIntervalSubdivided)

    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
  }

  bind(...args: any[]): void {
    this._server.bind(...args)
  }

  destroy(...args: any[]): void {
    clearInterval(this._refreshIntervalId)
    this._server.destroy(...args)
  }

  _onKBucketPing(oldPeers: PeerInfo[], newPeer: PeerInfo): void {
    if (this._banlist.has(newPeer)) return

    let count = 0
    let err: Error | null = null
    for (const peer of oldPeers) {
      this._server
        .ping(peer)
        .then(() => {
          if (++count < oldPeers.length) return
          if (err === null)
            this._banlist.add(newPeer, 300000) // 5 min * 60 * 1000
          else this._kbucket.add(newPeer)
        })
        .catch((_err: Error) => {
          this._banlist.add(peer, 300000) // 5 min * 60 * 1000
          this._kbucket.remove(peer)
          err = err ?? _err
        })
    }
  }

  _addPeerBatch(peers: PeerInfo[]): void {
    const DIFF_TIME_MS = 200
    let ms = 0
    for (const peer of peers) {
      setTimeout(() => {
        this.addPeer(peer).catch((error) => {
          this.events.emit('error', error)
        })
      }, ms)
      ms += DIFF_TIME_MS
    }
  }

  async bootstrap(peer: PeerInfo): Promise<void> {
    try {
      peer = await this.addPeer(peer)
      if (peer.id !== undefined) {
        this._confirmedPeers.add(bytesToUnprefixedHex(peer.id))
      }
    } catch (error: any) {
      this.events.emit('error', error)
      return
    }
    if (!this.id) return
    if (this._shouldFindNeighbours) {
      this._server.findneighbours(peer, this.id)
    }
  }

  async addPeer(obj: PeerInfo): Promise<PeerInfo> {
    if (this._banlist.has(obj)) throw EthereumJSErrorWithoutCode('Peer is banned')
    if (this.DEBUG) {
      this._debug(`attempt adding peer ${obj.address}:${obj.udpPort}`)
    }

    // check k-bucket first
    const peer = this._kbucket.get(obj)
    if (peer !== null) return peer

    // check that peer is alive
    try {
      const peer = await this._server.ping(obj)
      this.events.emit('peer:new', peer)
      this._kbucket.add(peer)
      return peer
    } catch (err: any) {
      this._banlist.add(obj, 300000) // 5 min * 60 * 1000
      throw err
    }
  }

  /**
   * Add peer to a confirmed list of peers (peers meeting some
   * level of quality, e.g. being on the same network) to allow
   * for a more selective findNeighbours request and sending
   * (with activated `onlyConfirmed` setting)
   *
   * @param id Unprefixed hex id
   */
  confirmPeer(id: string) {
    if (this._confirmedPeers.size < 5000) {
      this._confirmedPeers.add(id)
    }
  }

  getPeer(obj: string | Uint8Array | PeerInfo) {
    return this._kbucket.get(obj)
  }

  getPeers() {
    return this._kbucket.getAll()
  }

  numPeers() {
    return this._kbucket.getAll().length
  }

  getClosestPeers(id: Uint8Array) {
    let peers = this._kbucket.closest(id)
    if (this._onlyConfirmed && this._confirmedPeers.size > 0) {
      peers = peers.filter((peer) =>
        this._confirmedPeers.has(bytesToUnprefixedHex(peer.id as Uint8Array)) ? true : false,
      )
    }
    return peers
  }

  removePeer(obj: string | PeerInfo | Uint8Array) {
    const peer = this._kbucket.get(obj)
    if (peer?.id !== undefined) {
      this._confirmedPeers.delete(bytesToUnprefixedHex(peer.id as Uint8Array))
    }
    this._kbucket.remove(obj)
  }

  banPeer(obj: string | PeerInfo | Uint8Array, maxAge?: number) {
    this._banlist.add(obj, maxAge)
    this._kbucket.remove(obj)
  }

  async getDnsPeers(): Promise<PeerInfo[]> {
    return this._dns.getPeers(this._dnsRefreshQuantity, this._dnsNetworks)
  }

  async refresh(): Promise<void> {
    if (this._shouldFindNeighbours) {
      // Rotating selection counter going in loop from 0..9
      this._refreshIntervalSelectionCounter = (this._refreshIntervalSelectionCounter + 1) % 10

      const peers = this.getPeers()
      if (this.DEBUG) {
        this._debug(
          `call .refresh() (selector ${this._refreshIntervalSelectionCounter}) (${peers.length} peers in table)`,
        )
      }

      for (const peer of peers) {
        // Randomly distributed selector based on peer ID
        // to decide on subdivided execution
        const selector = bytesToInt((peer.id as Uint8Array).subarray(0, 1)) % 10
        let confirmed = true
        if (this._onlyConfirmed && this._confirmedPeers.size > 0) {
          const id = bytesToUnprefixedHex(peer.id as Uint8Array)
          if (!this._confirmedPeers.has(id)) {
            confirmed = false
          }
        }
        if (confirmed && selector === this._refreshIntervalSelectionCounter) {
          this._server.findneighbours(peer, randomBytes(64))
        }
      }
    }

    if (this._shouldGetDnsPeers) {
      const dnsPeers = await this.getDnsPeers()

      if (this.DEBUG) {
        this._debug(
          `.refresh() Adding ${dnsPeers.length} from DNS tree, (${
            this.getPeers().length
          } current peers in table)`,
        )
      }

      this._addPeerBatch(dnsPeers)
    }
  }
}
