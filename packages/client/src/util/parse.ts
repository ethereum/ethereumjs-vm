import { hexToBytes } from '@ethereumjs/util'
import { isMultiaddr, multiaddr } from '@multiformats/multiaddr'
import { URL } from 'url'

import type { MultiaddrLike } from '../types.js'
import type { Multiaddr } from '@multiformats/multiaddr'

// From: https://community.fortra.com/forums/intermapper/miscellaneous-topics/5acc4fcf-fa83-e511-80cf-0050568460e4
const ip6RegExp = new RegExp(
  /((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))/,
)

/**
 * Parses multiaddrs and bootnodes to multiaddr format.
 * @param input comma separated string
 */
export function parseMultiaddrs(input: MultiaddrLike): Multiaddr[] {
  if (input === '') {
    return []
  }
  if (!Array.isArray(input) && typeof input === 'object') {
    return [input] as Multiaddr[]
  }
  if (Array.isArray(input)) {
    // Comma-separated bootnodes
    if (input.length === 1 && typeof input[0] === 'string' && input[0].includes(',')) {
      input = input[0].split(',')
    }
  } else {
    input = input.split(',')
  }
  try {
    return input.map((s) => {
      isMultiaddr
      if (isMultiaddr(s)) {
        return s
      }
      // parse as multiaddr
      if (s[0] === '/') {
        return multiaddr(s)
      }
      // parse as object
      if (typeof s === 'object') {
        const { ip, port } = s
        if (ip !== undefined && port !== undefined) {
          return multiaddr(`/ip4/${ip}/tcp/${port}`)
        }
      }
      // parse as ip:port
      const match = s.match(/^(\d+\.\d+\.\d+\.\d+):([0-9]+)$/)
      if (match) {
        const [_, ip, port] = match
        return multiaddr(`/ip4/${ip}/tcp/${port}`)
      }
      // parse as [ip6]:port
      const ipv6WithPort = new RegExp('\\[(?<ip6>' + ip6RegExp.source + ')\\]:(?<port>[0-9]+)$')
      const matchip6 = s.match(ipv6WithPort)
      if (matchip6) {
        const { ip6, port } = matchip6.groups!
        return multiaddr(`/ip6/${ip6}/tcp/${port}`)
      }
      // parse using WHATWG URL API // cspell:disable-line
      const { hostname: ip, port } = new URL(s)
      if (ip && port) {
        return multiaddr(`/ip4/${ip}/tcp/${port}`)
      }
      throw new Error(`Unable to parse bootnode URL: ${s}`)
    })
  } catch (e) {
    if (!(e instanceof Error)) {
      e = new Error(e)
    }
    throw new Error(`Invalid bootnode URLs: ${e.message}`)
  }
}

/**
 * Returns Uint8Array from input hexadecimal string or Uint8Array
 * @param input hexadecimal string or Uint8Array
 */
export function parseKey(input: string | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : hexToBytes(`0x${input}`)
}
