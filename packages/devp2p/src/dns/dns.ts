import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'
import debugDefault from 'debug'
import * as dns from 'dns'

import { ENR } from './enr.js'

import type { DNSOptions, PeerInfo } from '../types.js'
import type { Common } from '@ethereumjs/common'

const debug = debugDefault('devp2p:dns:dns')

type SearchContext = {
  domain: string
  publicKey: string
  visits: { [key: string]: boolean }
}

export class DNS {
  protected _DNSTreeCache: { [key: string]: string }
  protected readonly _errorTolerance: number = 10

  protected _common?: Common

  private DEBUG: boolean

  constructor(options: DNSOptions = {}) {
    this._DNSTreeCache = {}

    if (typeof options.dnsServerAddress === 'string') {
      dns.promises.setServers([options.dnsServerAddress])
    }

    this._common = options.common

    this.DEBUG =
      typeof window === 'undefined' ? (process?.env?.DEBUG?.includes('ethjs') ?? false) : false
  }

  /**
   * Returns a list of verified peers listed in an EIP-1459 DNS tree. Method may
   * return fewer peers than requested if `maxQuantity` is larger than the number
   * of ENR records or the number of errors/duplicate peers encountered by randomized
   * search exceeds `maxQuantity` plus the `errorTolerance` factor.
   *
   * @param {number}        maxQuantity  max number to get
   * @param {string[]}        dnsNetworks enrTree strings (See EIP-1459 for format)
   * @return {PeerInfo}
   */
  async getPeers(maxQuantity: number, dnsNetworks: string[]): Promise<PeerInfo[]> {
    let totalSearches: number = 0
    const peers: PeerInfo[] = []

    const networkIndex = Math.floor(Math.random() * dnsNetworks.length)
    const { publicKey, domain } = ENR.parseTree(dnsNetworks[networkIndex])

    while (peers.length < maxQuantity && totalSearches < maxQuantity + this._errorTolerance) {
      const context: SearchContext = {
        domain,
        publicKey,
        visits: {},
      }

      const peer = await this._search(domain, context)

      if (this._isNewPeer(peer, peers)) {
        peers.push(peer)
        if (this.DEBUG) {
          debug(`got new peer candidate from DNS address=${peer.address}`)
        }
      }

      totalSearches++
    }
    return peers
  }

  /**
   * Runs a recursive, randomized descent of the DNS tree to retrieve a single
   * ENR record as a PeerInfo object. Returns null if parsing or DNS resolution fails.
   *
   * @param  {string}        subdomain
   * @param  {SearchContext} context
   * @return {PeerInfo | null}
   */
  private async _search(subdomain: string, context: SearchContext): Promise<PeerInfo | null> {
    const entry = await this._getTXTRecord(subdomain, context)
    context.visits[subdomain] = true

    let next: string
    let branches: string[]

    try {
      switch (this._getEntryType(entry)) {
        case ENR.ROOT_PREFIX:
          next = ENR.parseAndVerifyRoot(entry, context.publicKey, this._common)
          return await this._search(next, context)
        case ENR.BRANCH_PREFIX:
          branches = ENR.parseBranch(entry)
          next = this._selectRandomPath(branches, context)
          return await this._search(next, context)
        case ENR.RECORD_PREFIX:
          return ENR.parseAndVerifyRecord(entry, this._common)
        default:
          return null
      }
    } catch (error: any) {
      if (this.DEBUG) {
        debug(`Errored searching DNS tree at subdomain ${subdomain}: ${error}`)
      }
      return null
    }
  }

  private _getEntryType(entry: string): string {
    if (entry.startsWith(ENR.ROOT_PREFIX)) return ENR.ROOT_PREFIX
    if (entry.startsWith(ENR.BRANCH_PREFIX)) return ENR.BRANCH_PREFIX
    if (entry.startsWith(ENR.RECORD_PREFIX)) return ENR.RECORD_PREFIX

    return ''
  }

  /**
   * Returns a randomly selected subdomain string from the list provided by a branch
   * entry record.
   *
   * The client must track subdomains which are already resolved to avoid
   * going into an infinite loop b/c branch entries can contain
   * circular references. It’s in the client’s best interest to traverse the
   * tree in random order.
   *
   * @param {string[]}      branches
   * @param {SearchContext} context
   * @return {String}       subdomain
   */
  private _selectRandomPath(branches: string[], context: SearchContext): string {
    // Identify domains already visited in this traversal of the DNS tree.
    // Then filter against them to prevent cycles.
    const circularRefs: { [key: number]: boolean } = {}
    for (const [idx, subdomain] of branches.entries()) {
      if (context.visits[subdomain]) {
        circularRefs[idx] = true
      }
    }
    // If all possible paths are circular...
    if (Object.keys(circularRefs).length === branches.length) {
      throw EthereumJSErrorWithoutCode('Unresolvable circular path detected')
    }

    // Randomly select a viable path
    let index
    do {
      index = Math.floor(Math.random() * branches.length)
    } while (circularRefs[index])

    return branches[index]
  }

  /**
   * Retrieves the TXT record stored at a location from either
   * this DNS tree cache or via Node's DNS api
   *
   * @param  {string}             subdomain
   * @param  {SearchContext = {}} context
   * @return {string}
   */
  private async _getTXTRecord(subdomain: string, context: SearchContext): Promise<string> {
    if (this._DNSTreeCache[subdomain]) {
      return this._DNSTreeCache[subdomain]
    }

    // Location is either the top level tree entry host or a subdomain of it.
    const location =
      subdomain !== context.domain ? `${subdomain}.${context.domain}` : context.domain

    const response = await dns.promises.resolve(location, 'TXT')

    if (response.length === 0)
      throw EthereumJSErrorWithoutCode('Received empty result array while fetching TXT record')
    if (response[0].length === 0) throw EthereumJSErrorWithoutCode('Received empty TXT record')
    // Branch entries can be an array of strings of comma delimited subdomains, with
    // some subdomain strings split across the array elements
    // (e.g btw end of arr[0] and beginning of arr[1])
    const result = response[0].length > 1 ? response[0].join('') : response[0][0]

    this._DNSTreeCache[subdomain] = result
    return result
  }

  /**
   * Returns false if candidate peer already exists in the
   * current collection of peers.
   * Returns true otherwise.
   * Also acts as a typeguard for peer
   *
   * @param  {PeerInfo}   peer
   * @param  {PeerInfo[]} peers
   * @return {boolean}
   */
  private _isNewPeer(peer: PeerInfo | null, peers: PeerInfo[]): peer is PeerInfo {
    if (peer === null || peer.address === undefined) return false

    for (const existingPeer of peers) {
      if (peer.address === existingPeer.address) {
        return false
      }
    }

    return true
  }

  /**
   * Only used for testing. A stopgap to enable successful
   * TestDouble mocking of the native `dns` module.
   * @param {any} mock TestDouble fn
   */
  __setNativeDNSModuleResolve(mock: any) {
    dns.promises.resolve = mock.resolve
  }
}
