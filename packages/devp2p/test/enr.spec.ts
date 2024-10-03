import { assert, describe, it } from 'vitest'

import { ENR } from '../src/dns/index.js'

import { testData } from './testdata.js'

const dns = testData.dns

describe('ENR tests', () => {
  // Root DNS entries
  it('ENR (root): should parse and verify and DNS root entry', () => {
    const subdomain = ENR.parseAndVerifyRoot(dns.enrRoot, dns.publicKey)
    assert.equal(subdomain, 'JORXBYVVM7AEKETX5DGXW44EAY', 'returns correct subdomain') // cspell:disable-line
  })

  it('ENR (root): should error if DNS root entry is mis-prefixed', () => {
    try {
      ENR.parseAndVerifyRoot(dns.enrRootBadPrefix, dns.publicKey)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes("ENR root entry must start with 'enrtree-root:'"),
        'has correct error message',
      )
    }
  })

  it('ENR (root): should error if DNS root entry signature is invalid', () => {
    try {
      ENR.parseAndVerifyRoot(dns.enrRootBadSig, dns.publicKey)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes('Unable to verify ENR root signature'),
        'has correct error message',
      )
    }
  })

  it('ENR (root): should error if DNS root entry is malformed', () => {
    try {
      ENR.parseAndVerifyRoot(dns.enrRootMalformed, dns.publicKey)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes("Could not parse 'l' value from ENR root entry"),
        'has correct error message',
      )
    }
  })

  // Tree DNS entries
  it('ENR (tree): should parse a DNS tree entry', () => {
    const { publicKey, domain } = ENR.parseTree(dns.enrTree)

    assert.equal(publicKey, dns.publicKey, 'returns correct public key')
    assert.equal(domain, 'nodes.example.org', 'returns correct url')
  })

  it('ENR (tree): should error if DNS tree entry is mis-prefixed', () => {
    try {
      ENR.parseTree(dns.enrTreeBadPrefix)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes("ENR tree entry must start with 'enrtree:'"),
        'has correct error message',
      )
    }
  })

  it('ENR (tree): should error if DNS tree entry is misformatted', () => {
    try {
      ENR.parseTree(dns.enrTreeMalformed)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes('Could not parse domain from ENR tree entry'),
        'has correct error message',
      )
    }
  })

  // Branch entries
  it('ENR (branch): should parse and verify a single component DNS branch entry', () => {
    const expected = [
      // cspell:disable
      'D2SNLTAGWNQ34NTQTPHNZDECFU',
      '67BLTJEU5R2D5S3B4QKJSBRFCY',
      'A2HDMZBB4JIU53VTEGC4TG6P4A',
      // cspell:enable
    ]

    const branches = ENR.parseBranch(dns.enrBranch)
    assert.deepEqual(branches, expected, 'returns array of subdomains')
  })

  it('ENR (branch): should error if DNS branch entry is mis-prefixed', () => {
    try {
      ENR.parseBranch(dns.enrBranchBadPrefix)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes("ENR branch entry must start with 'enrtree-branch:'"),
        'has correct error message',
      )
    }
  })

  // ENR DNS entries
  it('ENR (enr): should convert an Ethereum Name Record string', () => {
    const { address, tcpPort, udpPort } = ENR.parseAndVerifyRecord(dns.enr)
    assert.equal(address, '40.113.111.135', 'returns correct address')
    assert.equal(tcpPort, 30303, 'returns correct tcpPort')
    assert.equal(udpPort, 30303, 'returns correct udpPort')
  })

  it('ENR (enr): should convert non-padded Ethereum Name Record string', () => {
    const { address, tcpPort, udpPort } = ENR.parseAndVerifyRecord(dns.enrUnpadded)

    assert.equal(address, '64.227.79.242', 'returns correct address')
    assert.equal(tcpPort, 30303, 'returns correct tcpPort')
    assert.equal(udpPort, 30303, 'returns correct udpPort')
  })

  it('ENR (enr): should error if record mis-prefixed', () => {
    try {
      ENR.parseAndVerifyRecord(dns.enrBadPrefix)
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.toString().includes("String encoded ENR must start with 'enr:'"),
        'has correct error message',
      )
    }
  })
})
