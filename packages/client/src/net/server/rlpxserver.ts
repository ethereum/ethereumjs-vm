import { DPT as Devp2pDPT, RLPx as Devp2pRLPx } from '@ethereumjs/devp2p'
import { bytesToUnprefixedHex, unprefixedHexToBytes, utf8ToBytes } from '@ethereumjs/util'

import { Event } from '../../types.js'
import { getClientVersion } from '../../util/index.js'
import { RlpxPeer } from '../peer/rlpxpeer.js'

import { Server } from './server.js'

import type { ServerOptions } from './server.js'
import type { Peer as Devp2pRLPxPeer } from '@ethereumjs/devp2p'

export interface RlpxServerOptions extends ServerOptions {
  /* List of supported clients */
  clientFilter?: string[]
}

const ignoredErrors = new RegExp(
  [
    // Peer socket connection
    'ECONNRESET',
    'EPIPE', // (?)
    'ETIMEDOUT', // (?)

    // ETH status handling
    'Genesis block mismatch',
    'NetworkId mismatch',
    'Unknown fork hash',

    // DPT message decoding
    'Hash verification failed',
    'Invalid address bytes',
    'Invalid timestamp bytes',
    'Invalid type',
    'Timeout error: ping', // connection
    'Peer is banned', // connection

    // ECIES message encryption
    'Invalid MAC',

    // Client
    'Handshake timed out', // Protocol handshake
    'Server already destroyed', // Bootstrap retrigger
  ].join('|'),
)

/**
 * DevP2P/RLPx server
 * @memberof module:net/server
 */
export class RlpxServer extends Server {
  private peers: Map<string, RlpxPeer> = new Map()

  public discovery: boolean
  private clientFilter: string[]

  public rlpx: Devp2pRLPx | null = null
  public dpt: Devp2pDPT | null = null
  public ip: string

  /**
   * Create new DevP2P/RLPx server
   */
  constructor(options: RlpxServerOptions) {
    super(options)
    // As of now, the devp2p dpt server listens on the ip4 protocol by default and hence the ip in the
    // bootnode needs to be of ip4 by default
    this.ip = options.config.extIP ?? '0.0.0.0'
    this.discovery = options.config.discV4 || options.config.discDns
    this.clientFilter = options.clientFilter ?? [
      'go1.5',
      'go1.6',
      'go1.7',
      'quorum',
      'pirl', // cspell:disable-line
      'ubiq', // cspell:disable-line
      'gmc', // cspell:disable-line
      'gwhale', // cspell:disable-line
      'prichain', // cspell:disable-line
    ]
  }

  /**
   * Server name
   */
  get name() {
    return 'rlpx'
  }

  /**
   * Return Rlpx info
   */
  getRlpxInfo() {
    // TODO: return undefined? note that this.rlpx might be undefined if called before initRlpx
    const listenAddr = this.ip.match(/^(\d+\.\d+\.\d+\.\d+)$/)
      ? `${this.ip}:${this.config.port}`
      : `[${this.ip}]:${this.config.port}`

    if (this.rlpx === undefined || this.rlpx === null) {
      return {
        enode: undefined,
        id: undefined,
        ip: this.ip,
        listenAddr,
        ports: { discovery: this.config.port, listener: this.config.port },
      }
    }
    const id = bytesToUnprefixedHex(this.rlpx.id)
    return {
      enode: `enode://${id}@${listenAddr}`,
      id,
      ip: this.ip,
      listenAddr,
      ports: { discovery: this.config.port, listener: this.config.port },
    }
  }

  /**
   * Start Devp2p/RLPx server.
   * Returns a promise that resolves once server has been started.
   * @returns true if server successfully started
   */
  async start(): Promise<boolean> {
    if (this.started) {
      return false
    }
    await super.start()
    await this.initDpt()
    await this.initRlpx()
    this.started = true

    return true
  }

  /**
   * Bootstrap bootnode and DNS mapped peers from the network
   */
  async bootstrap(): Promise<void> {
    const self = this

    // Bootnodes
    let promises = this.bootnodes.map((ma) => {
      const { address, port } = ma.nodeAddress()
      const bootnode = {
        address,
        udpPort: Number(port),
        tcpPort: Number(port),
      }
      return this.dpt!.bootstrap(bootnode)
    })

    // DNS peers
    if (this.config.discDns) {
      const dnsPeers = (await this.dpt?.getDnsPeers()) ?? []
      promises = promises.concat(dnsPeers.map((node) => self.dpt!.bootstrap(node)))
    }

    for (const promise of promises) {
      try {
        await promise
      } catch (e) {
        if (!(e instanceof Error)) {
          e = new Error(e)
        }
        this.error(e)
      }
    }
  }

  /**
   * Stop Devp2p/RLPx server. Returns a promise that resolves once server has been stopped.
   */
  async stop(): Promise<boolean> {
    if (this.started) {
      this.rlpx!.destroy()
      this.dpt!.destroy()
      await super.stop()
      this.started = false
    }
    return this.started
  }

  /**
   * Ban peer for a specified time
   * @param peerId id of peer
   * @param maxAge how long to ban peer in ms
   * @returns true if ban was successfully executed
   */
  ban(peerId: string, maxAge = 60000): boolean {
    if (!this.started) {
      return false
    }
    this.dpt!.banPeer(peerId, maxAge)
    this.rlpx!.disconnect(unprefixedHexToBytes(peerId))
    return true
  }

  /**
   * Handles errors from server and peers
   * @param error
   * @emits {@link Event.SERVER_ERROR}
   */
  private error(error: Error) {
    if (ignoredErrors.test(error.message)) {
      return
    }
    this.config.events.emit(Event.SERVER_ERROR, error, this)
  }

  /**
   * Initializes DPT for peer discovery
   */
  private async initDpt() {
    return new Promise<void>((resolve) => {
      this.dpt = new Devp2pDPT(this.key, {
        refreshInterval: this.refreshInterval,
        endpoint: {
          address: '0.0.0.0',
          udpPort: null,
          tcpPort: null,
        },
        onlyConfirmed: this.config.chainCommon.chainName() === 'mainnet' ? false : true,
        shouldFindNeighbours: this.config.discV4,
        shouldGetDnsPeers: this.config.discDns,
        dnsRefreshQuantity: this.config.maxPeers,
        dnsNetworks: this.dnsNetworks,
        dnsAddr: this.config.dnsAddr,
        common: this.config.chainCommon,
      })

      this.dpt.events.on('error', (e: Error) => {
        this.error(e)
        // If DPT can't bind to port, resolve anyway so client startup doesn't hang
        if (e.message.includes('EADDRINUSE')) resolve()
      })

      this.dpt.events.on('listening', () => {
        resolve()
      })

      this.config.events.on(Event.PEER_CONNECTED, (peer) => {
        this.dpt?.confirmPeer(peer.id)
      })

      if (typeof this.config.port === 'number') {
        this.dpt.bind(this.config.port, '0.0.0.0')
      }
      this.config.logger.info(
        `Started discovery service discV4=${this.config.discV4} dns=${this.config.discDns} refreshInterval=${this.refreshInterval}`,
      )
    })
  }

  /**
   * Initializes RLPx instance for peer management
   */
  private async initRlpx() {
    return new Promise<void>((resolve) => {
      this.rlpx = new Devp2pRLPx(this.key, {
        clientId: utf8ToBytes(getClientVersion()),
        dpt: this.dpt!,
        maxPeers: this.config.maxPeers,
        capabilities: RlpxPeer.capabilities(Array.from(this.protocols)),
        remoteClientIdFilter: this.clientFilter,
        listenPort: this.config.port,
        common: this.config.chainCommon,
      })

      this.rlpx.events.on('peer:added', async (rlpxPeer: Devp2pRLPxPeer) => {
        let peer: RlpxPeer | null = new RlpxPeer({
          config: this.config,
          id: bytesToUnprefixedHex(rlpxPeer.getId()!),
          host: rlpxPeer['_socket'].remoteAddress!,
          port: rlpxPeer['_socket'].remotePort!,
          protocols: Array.from(this.protocols),
          inbound: (rlpxPeer['_socket'] as any).server !== undefined,
        })
        try {
          await peer.accept(rlpxPeer, this)
          this.peers.set(peer.id, peer)
          this.config.logger.debug(`Peer connected: ${peer}`)
          this.config.events.emit(Event.PEER_CONNECTED, peer)
        } catch (error) {
          if (!(error instanceof Error)) {
            error = new Error(error)
          }
          // Fixes a memory leak where RlpxPeer objects could not be GCed,
          // likely to the complex two-way bound-protocol logic
          peer = null
          this.error(error)
        }
      })

      this.rlpx.events.on('peer:removed', (rlpxPeer: Devp2pRLPxPeer, reason: any) => {
        const id = bytesToUnprefixedHex(rlpxPeer.getId() as Uint8Array)
        const peer = this.peers.get(id)
        if (peer) {
          this.peers.delete(peer.id)
          this.config.logger.debug(
            `Peer disconnected (${rlpxPeer.getDisconnectPrefix(reason)}): ${peer}`,
          )
          this.config.events.emit(Event.PEER_DISCONNECTED, peer)
        }
      })

      this.rlpx.events.on('peer:error', (rlpxPeer: Devp2pRLPxPeer, error: Error) =>
        this.error(error),
      )

      this.rlpx.events.on('error', (e: Error) => {
        this.error(e)
        // If DPT can't bind to port, resolve anyway so client startup doesn't hang
        if (e.message.includes('EADDRINUSE')) resolve()
      })

      this.rlpx.events.on('listening', () => {
        this.config.events.emit(Event.SERVER_LISTENING, {
          transport: this.name,
          url: this.getRlpxInfo().enode ?? '',
        })
        resolve()
      })

      if (typeof this.config.port === 'number') {
        this.rlpx.listen(this.config.port, '0.0.0.0')
      }
    })
  }
}
