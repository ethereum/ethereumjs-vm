import { assert, describe, it } from 'vitest'

import {
  Common,
  ConsensusAlgorithm,
  ConsensusType,
  Hardfork,
  Mainnet,
  getPresetChainConfig,
} from '../src/index.js'

import { Goerli } from './data/goerliCommon.js'

import type { ChainConfig } from '../src/index.js'

describe('[Common/Chains]: Initialization / Chain params', () => {
  it('Should initialize with chain provided', () => {
    const c = new Common({ chain: Mainnet })
    assert.equal(c.chainName(), 'mainnet', 'should initialize with chain name')
    assert.equal(c.chainId(), BigInt(1), 'should return correct chain Id')
    assert.equal(c.hardfork(), Hardfork.Prague, 'should set hardfork to current default hardfork')
    assert.equal(
      c.hardfork(),
      c.DEFAULT_HARDFORK,
      'should set hardfork to hardfork set as DEFAULT_HARDFORK',
    )
  })

  it('Deep copied common object should have parameters that are independent of the original copy', async () => {
    let chainConfig: ChainConfig
    let c: Common
    const setCommon = async () => {
      chainConfig = JSON.parse(JSON.stringify(Mainnet))
      c = new Common({ chain: chainConfig })
      assert.equal(c.chainName(), 'mainnet', 'should initialize with chain name')
      assert.equal(c.chainId(), BigInt(1), 'should return correct chain Id')
    }

    const resetCommon = async () => {
      // modify chain config
      const cCopy = c.copy()
      chainConfig.chainId = 2
      chainConfig.name = 'testnet'
      assert.equal(cCopy.chainName(), 'mainnet', 'should return original chain name')
      assert.equal(cCopy.chainId(), BigInt(1), 'should return original chain Id')
    }

    await setCommon()
    await resetCommon()
  })

  it('Should initialize with chain provided by chain name or network Id', () => {
    let chain = getPresetChainConfig('mainnet')
    let c = new Common({ chain })
    assert.equal(c.chainName(), 'mainnet')
    chain = getPresetChainConfig(123)
    c = new Common({ chain })
    assert.equal(c.chainName(), 'mainnet')
  })

  it('Should initialize with chain and hardfork provided', () => {
    const c = new Common({ chain: Mainnet, hardfork: 'byzantium' })
    assert.equal(c.hardfork(), 'byzantium', 'should return correct hardfork name')
  })

  it('Should initialize with chain and hardfork provided by Chain and Hardfork enums', () => {
    const c = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
    assert.equal(c.hardfork(), 'byzantium', 'should return correct hardfork name')
  })

  it('Should handle initialization errors', () => {
    const f = function () {
      new Common({ chain: Mainnet, hardfork: 'hardforkNotExisting' })
    }
    const msg = 'should throw an exception on non-existing hardfork'
    assert.throws(f, /not supported$/, undefined, msg) // eslint-disable-line no-new
  })

  it('Should provide correct access to chain parameters', () => {
    let c = new Common({ chain: Mainnet, hardfork: 'tangerineWhistle' })
    assert.equal(c.hardforks()[3]['block'], 2463000, 'should return correct hardfork data')
    assert.equal(typeof c.bootstrapNodes()[0].port, 'number', 'should return a port as number')
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfWork,
      'should return correct consensus type',
    )
    assert.equal(
      c.consensusAlgorithm(),
      ConsensusAlgorithm.Ethash,
      'should return correct consensus algorithm',
    )
    assert.deepEqual(c.consensusConfig(), {}, 'should return empty dictionary for consensus config')

    c = new Common({ chain: Goerli, hardfork: 'spuriousDragon' })
    assert.equal(c.hardforks()[3]['block'], 0, 'should return correct hardfork data')
    assert.equal(typeof c.bootstrapNodes()[0].port, 'number', 'should return a port as number')
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfAuthority,
      'should return correct consensus type',
    )
    assert.equal(
      c.consensusAlgorithm(),
      ConsensusAlgorithm.Clique,
      'should return correct consensus algorithm',
    )
    assert.equal(
      c.consensusConfig().epoch,
      30000,
      'should return correct consensus config parameters',
    )
  })

  it('Should provide the bootnode information in a uniform way', () => {
    const configs = [Mainnet, Goerli]
    for (const network of configs) {
      const c = new Common({ chain: network })
      const bootnode = c.bootstrapNodes()[0]
      assert.equal(typeof bootnode.ip, 'string', 'returns the ip as string')
      assert.equal(typeof bootnode.port, 'number', 'returns the port as number')
      assert.equal(typeof bootnode.id, 'string', 'returns the id as string')
      assert.equal(
        typeof bootnode.location,
        'string',
        'returns the location as string (empty string if unavailable)',
      )
      assert.equal(
        typeof bootnode.comment,
        'string',
        'returns a comment as string (empty string if unavailable)',
      )
    }
  })

  it('Should provide DNS network information in a uniform way', () => {
    const configs = [Mainnet, Goerli]
    for (const network of configs) {
      const c = new Common({ chain: network })
      const dnsNetworks = c.dnsNetworks()
      assert.ok(Array.isArray(dnsNetworks), 'is an array')
      assert.equal(typeof dnsNetworks[0], 'string', 'returns the DNS ENR url as a string')
    }
  })
})

describe('[Common]: copy() listener tests', () => {
  it('Should work', () => {
    const common = new Common({ chain: Mainnet })
    // Add two listeners
    common.events.on('hardforkChanged', () => {})
    common.events.on('hardforkChanged', () => {})
    const commonCopy = common.copy()
    assert.equal(
      common.events.listenerCount('hardforkChanged'),
      2,
      'original common instance should have two listeners',
    )
    assert.equal(
      commonCopy.events.listenerCount('hardforkChanged'),
      0,
      'copied common instance should have zero listeners',
    )
  })
})
