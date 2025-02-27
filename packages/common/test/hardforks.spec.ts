import { hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import {
  Common,
  ConsensusAlgorithm,
  ConsensusType,
  Hardfork,
  Holesky,
  Mainnet,
  Sepolia,
  createCommonFromGethGenesis,
  createCustomCommon,
} from '../src/index.js'

import { Goerli } from './data/goerliCommon.js'

import type { ChainConfig } from '../src/index.js'

describe('[Common]: Hardfork logic', () => {
  it('Hardfork access', () => {
    const supportedHardforks = [
      Hardfork.Chainstart,
      Hardfork.Homestead,
      Hardfork.Dao,
      Hardfork.Chainstart,
      Hardfork.SpuriousDragon,
      Hardfork.Byzantium,
      Hardfork.Constantinople,
      Hardfork.Petersburg,
      Hardfork.Istanbul,
      Hardfork.Berlin,
      Hardfork.London,
      Hardfork.ArrowGlacier,
      Hardfork.GrayGlacier,
      Hardfork.Shanghai,
      Hardfork.Paris,
    ]
    let c

    for (const hardfork of supportedHardforks) {
      c = new Common({ chain: Mainnet, hardfork })
      assert.equal(c.hardfork(), hardfork, hardfork)
    }
  })

  it('getHardforkBy() / setHardforkBy()', () => {
    const c = new Common({ chain: Mainnet })
    let msg = 'should get HF correctly'

    assert.equal(c.getHardforkBy({ blockNumber: 0n }), Hardfork.Chainstart, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 1149999n }), Hardfork.Chainstart, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 1150000n }), Hardfork.Homestead, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 1400000n }), Hardfork.Homestead, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 9200000n }), Hardfork.MuirGlacier, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 12244000n }), Hardfork.Berlin, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 12965000n }), Hardfork.London, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 13773000n }), Hardfork.ArrowGlacier, msg)
    assert.equal(c.getHardforkBy({ blockNumber: 15050000n }), Hardfork.GrayGlacier, msg)
    // merge is now specified at 15537394 in config
    assert.equal(c.getHardforkBy({ blockNumber: 999999999999n }), Hardfork.Paris, msg)
    msg = 'should set HF correctly'

    assert.equal(c.setHardforkBy({ blockNumber: 0n }), Hardfork.Chainstart, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 1149999n }), Hardfork.Chainstart, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 1150000n }), Hardfork.Homestead, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 1400000n }), Hardfork.Homestead, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 12244000n }), Hardfork.Berlin, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 12965000n }), Hardfork.London, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 13773000n }), Hardfork.ArrowGlacier, msg)
    assert.equal(c.setHardforkBy({ blockNumber: 15050000n }), Hardfork.GrayGlacier, msg)
    // merge is now specified at 15537394 in config
    assert.equal(c.setHardforkBy({ blockNumber: 999999999999n }), Hardfork.Paris, msg)
  })

  it('should throw if no hardfork qualifies', () => {
    const hardforks = [
      {
        name: 'homestead',
        block: 3,
      },
      {
        name: 'tangerineWhistle',
        block: 3,
      },
      {
        name: 'spuriousDragon',
        block: 3,
      },
    ]

    const c = createCustomCommon({ hardforks }, Sepolia)
    const f = () => {
      c.getHardforkBy({ blockNumber: 0n })
    }
    assert.throws(f, undefined, undefined, 'throw since no hardfork qualifies')

    const msg = 'should return correct value'
    assert.equal(c.setHardforkBy({ blockNumber: 3n }), Hardfork.SpuriousDragon, msg)
  })

  it('setHardfork(): hardforkChanged event', () => {
    const c = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    c.events.on('hardforkChanged', (hardfork: string) => {
      assert.equal(hardfork, Hardfork.Byzantium, 'should send correct hardforkChanged event')
    })
    c.setHardfork(Hardfork.Byzantium)
  })

  it('hardforkBlock()', () => {
    let c = new Common({ chain: Mainnet })
    let msg = 'should return the correct HF change block for byzantium (provided)'
    assert.equal(c.hardforkBlock(Hardfork.Byzantium)!, BigInt(4370000), msg)

    msg = 'should return null if HF does not exist on chain'
    assert.equal(c.hardforkBlock('thisHardforkDoesNotExist'), null, msg)

    c = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
    msg = 'should return the correct HF change block for byzantium (set)'
    assert.equal(c.hardforkBlock()!, BigInt(4370000), msg)

    c = new Common({ chain: Mainnet, hardfork: Hardfork.Istanbul })
    msg = 'should return the correct HF change block for istanbul (set)'
    assert.equal(c.hardforkBlock()!, BigInt(9069000), msg)
  })

  it('nextHardforkBlockOrTimestamp()', () => {
    const c = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })
    let msg =
      'should work with HF set / return correct next HF block for chainstart (mainnet: chainstart -> homestead)'
    assert.equal(c.nextHardforkBlockOrTimestamp()!, BigInt(1150000), msg)

    msg = 'should return correct next HF (mainnet: byzantium -> constantinople)'
    assert.equal(c.nextHardforkBlockOrTimestamp(Hardfork.Byzantium)!, BigInt(7280000), msg)

    msg = 'should return null if next HF is not available (mainnet: prague -> osaka)'
    assert.equal(c.nextHardforkBlockOrTimestamp(Hardfork.Prague), null, msg)

    const c2 = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })

    msg = 'should return null if next HF is not available (goerli: cancun -> prague)'
    assert.equal(c2.nextHardforkBlockOrTimestamp(Hardfork.Cancun), null, msg)

    msg =
      'should correctly skip a HF where block is set to null (goerli: homestead -> (dao) -> tangerineWhistle)'
    assert.equal(c2.nextHardforkBlockOrTimestamp('petersburg')!, BigInt(1561651), msg)
  })

  it('hardforkIsActiveOnBlock() / activeOnBlock()', () => {
    let c = new Common({ chain: Mainnet })
    let msg = 'Mainnet, byzantium (provided), 4370000 -> true'
    assert.equal(c.hardforkIsActiveOnBlock(Hardfork.Byzantium, 4370000), true, msg)

    msg = 'Mainnet, byzantium (provided), 4370005 -> true'
    assert.equal(c.hardforkIsActiveOnBlock(Hardfork.Byzantium, 4370005), true, msg)

    msg = 'Mainnet, byzantium (provided), 4369999 -> false'
    assert.equal(c.hardforkIsActiveOnBlock(Hardfork.Byzantium, 4369999), false, msg)

    c = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
    msg = 'Mainnet, byzantium (set), 4370000 -> true'
    assert.equal(c.hardforkIsActiveOnBlock(null, 4370000), true, msg)

    msg = 'Mainnet, byzantium (set), 4370000 -> true (alias function)'
    assert.equal(c.activeOnBlock(4370000), true, msg)

    msg = 'Mainnet, byzantium (set), 4370005 -> true'
    assert.equal(c.hardforkIsActiveOnBlock(null, 4370005), true, msg)

    msg = 'Mainnet, byzantium (set), 4369999 -> false'
    assert.equal(c.hardforkIsActiveOnBlock(null, 4369999), false, msg)
  })

  it('hardforkBlock()', () => {
    const c = new Common({ chain: Mainnet })

    let msg = 'should return correct value'
    assert.equal(c.hardforkBlock(Hardfork.Berlin)!, BigInt(12244000), msg)
    assert.equal(c.hardforkBlock(Hardfork.Berlin)!, BigInt(12244000), msg)

    msg = 'should return null for unscheduled hardfork'
    // developer note: when Osaka is set,
    // update this test to next unscheduled hardfork.
    assert.equal(c.hardforkBlock(Hardfork.Cancun), null, msg)
    assert.equal(c.hardforkBlock(Hardfork.Cancun), null, msg)
    assert.equal(c.nextHardforkBlockOrTimestamp(Hardfork.Prague), null, msg)
  })

  it('hardforkGteHardfork()', () => {
    let c = new Common({ chain: Mainnet })
    let msg = 'Mainnet, constantinople >= byzantium (provided) -> true'
    assert.equal(c.hardforkGteHardfork(Hardfork.Constantinople, Hardfork.Byzantium), true, msg)

    msg = 'Mainnet, chainstart >= dao (provided) -> false'
    assert.equal(c.hardforkGteHardfork(Hardfork.Chainstart, Hardfork.Dao), false, msg)

    msg = 'Mainnet, byzantium >= byzantium (provided) -> true'
    assert.equal(c.hardforkGteHardfork(Hardfork.Byzantium, Hardfork.Byzantium), true, msg)

    msg = 'Mainnet, spuriousDragon >= byzantium (provided) -> false'
    assert.equal(c.hardforkGteHardfork(Hardfork.SpuriousDragon, Hardfork.Byzantium), false, msg)

    c = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
    msg = 'Mainnet, byzantium (set) >= spuriousDragon -> true'
    assert.equal(c.hardforkGteHardfork(null, Hardfork.SpuriousDragon), true, msg)

    msg = 'Mainnet, byzantium (set) >= spuriousDragon -> true (alias function)'
    assert.equal(c.gteHardfork(Hardfork.SpuriousDragon), true, msg)

    msg = 'Mainnet, byzantium (set) >= byzantium -> true'
    assert.equal(c.hardforkGteHardfork(null, Hardfork.Byzantium), true, msg)

    msg = 'Mainnet, byzantium (set) >= constantinople -> false'
    assert.equal(c.hardforkGteHardfork(null, Hardfork.Constantinople), false, msg)
  })

  it('_calcForkHash()', () => {
    const chains: [ChainConfig, Uint8Array][] = [
      [Mainnet, hexToBytes('0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3')],
      [Goerli, hexToBytes('0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a')],
      [Sepolia, hexToBytes('0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9')],
      [Holesky, hexToBytes('0xb5f7f912443c940f21fd611f12828d75b534364ed9e95ca4e307729a4661bde4')],
    ]

    let c = new Common({ chain: Mainnet })
    const mainnetGenesisHash = chains[0][1]
    let msg = 'should calc correctly for chainstart (only genesis)'
    assert.equal(c['_calcForkHash'](Hardfork.Chainstart, mainnetGenesisHash), '0xfc64ec04', msg)

    msg = 'should calc correctly for first applied HF'
    assert.equal(c['_calcForkHash'](Hardfork.Homestead, mainnetGenesisHash), '0x97c2c34c', msg)

    msg = 'should calc correctly for in-between applied HF'
    assert.equal(c['_calcForkHash'](Hardfork.Byzantium, mainnetGenesisHash), '0xa00bc324', msg)

    for (const chain of chains) {
      c = new Common({ chain: chain[0] })
      for (const hf of c.hardforks()) {
        if (typeof hf.forkHash === 'string') {
          const msg = `Verify forkHash calculation for: ${chain[0].name} -> ${hf.name}`
          assert.equal(c['_calcForkHash'](hf.name, chain[1]), hf.forkHash, msg)
        }
      }
    }
  })

  it('forkHash()', () => {
    let c = new Common({ chain: Mainnet, hardfork: Hardfork.Byzantium })
    let msg = 'should provide correct forkHash for HF set'
    assert.equal(c.forkHash(), '0xa00bc324', msg)

    msg = 'should provide correct forkHash for HF provided'
    assert.equal(c.forkHash(Hardfork.SpuriousDragon), '0x3edd5b10', msg)
    const genesisHash = hexToBytes(
      '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
    )
    assert.equal(c.forkHash(Hardfork.SpuriousDragon, genesisHash), '0x3edd5b10', msg)

    c = new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai })
    // unschedule shanghai on it to test
    c.hardforks()
      .filter((hf) => hf.name === Hardfork.Shanghai)
      .map((hf) => {
        hf.block = null
        hf.timestamp = undefined
      })
    let f = () => {
      c.forkHash(Hardfork.Shanghai)
    }
    msg = 'should throw when called on non-applied or future HF'
    assert.throws(f, /No fork hash calculation possible/, undefined, msg)

    f = () => {
      c.forkHash('thisHardforkDoesNotExist')
    }
    msg = 'should throw when called with a HF that does not exist on chain'
    assert.throws(f, /No fork hash calculation possible/, undefined, msg)
  })

  it('forkHash(): should not change forkHash if timestamp is at genesis timestamp', () => {
    // Setup default config
    const defaultConfig = {
      timestamp: '10',
      config: {
        ethash: {},
        chainId: 7,
        homesteadBlock: 0,
        eip150Block: 0,
        eip155Block: 0,
        eip158Block: 0,
        byzantiumBlock: 0,
        constantinopleBlock: 0,
        petersburgBlock: 0,
        istanbulBlock: 0,
        muirGlacierBlock: 0,
        berlinBlock: 0,
        yolov2Block: 0, // cspell:disable-line
        yolov3Block: 0, // cspell:disable-line
        londonBlock: 0,
        mergeForkBlock: 0,
        terminalTotalDifficulty: 0,
        shanghaiTime: 0,
        cancunTime: 0,
      },
      difficulty: '100',
      alloc: {},
      gasLimit: '5000',
      nonce: '',
    }
    const gethConfig = {
      chain: 'testnet',
      eips: [],
      hardfork: Hardfork.Cancun,
    }
    const genesisHash = new Uint8Array(32)
    const zeroCommon = createCommonFromGethGenesis(defaultConfig, gethConfig)

    const zeroCommonShanghaiFork = zeroCommon.forkHash(Hardfork.Shanghai, genesisHash)
    const zeroCommonCancunFork = zeroCommon.forkHash(Hardfork.Shanghai, genesisHash)

    // Ensure that Shanghai fork + Cancun fork have equal forkhash
    assert.equal(zeroCommonShanghaiFork, zeroCommonCancunFork)

    // Set the cancun time to the genesis block time (this should not change the forkHash)
    defaultConfig.config.cancunTime = Number(defaultConfig.timestamp)

    const nonzeroCommonShanghaiFork = zeroCommon.forkHash(Hardfork.Shanghai, genesisHash)
    const nonzeroCommonCancunFork = zeroCommon.forkHash(Hardfork.Shanghai, genesisHash)

    // Ensure that the fork hashes have not changed
    assert.equal(zeroCommonShanghaiFork, nonzeroCommonShanghaiFork)
    assert.equal(nonzeroCommonShanghaiFork, nonzeroCommonCancunFork)
  })

  it('hardforkForForkHash()', () => {
    const c = new Common({ chain: Mainnet })

    let msg = 'should return the correct HF array for a matching forkHash'
    const res = c.hardforkForForkHash('0x3edd5b10')!
    assert.equal(res.name, Hardfork.SpuriousDragon, msg)

    msg = 'should return null for a forkHash not matching any HF'
    assert.equal(c.hardforkForForkHash('0x12345'), null, msg)
  })

  it('HF consensus updates', () => {
    let c = new Common({ chain: Goerli, hardfork: Hardfork.Byzantium })
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfAuthority,
      'should provide the correct initial chain consensus type',
    )
    assert.equal(
      c.consensusAlgorithm(),
      ConsensusAlgorithm.Clique,
      'should provide the correct initial chain consensus algorithm',
    )
    assert.equal(
      c.consensusConfig()['period'],
      15,
      'should provide the correct initial chain consensus configuration',
    )

    c = new Common({ chain: Goerli, hardfork: Hardfork.Paris })
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfStake,
      'should provide the correct updated chain consensus type',
    )
    assert.equal(
      c.consensusAlgorithm(),
      ConsensusAlgorithm.Casper,
      'should provide the correct updated chain consensus algorithm',
    )
    assert.deepEqual(
      c.consensusConfig(),
      {},
      'should provide the correct updated chain consensus configuration',
    )
  })

  it('Should correctly apply hardfork changes', () => {
    // For sepolia mergeNetsplitBlock happens AFTER merge
    const c = new Common({ chain: Sepolia, hardfork: Hardfork.London })
    assert.equal(
      c['HARDFORK_CHANGES'][11][0],
      Hardfork.Paris,
      'should correctly apply hardfork changes',
    )
    assert.equal(
      c['HARDFORK_CHANGES'][12][0],
      Hardfork.MergeNetsplitBlock,
      'should correctly apply hardfork changes',
    )

    // Should give correct ConsensusType pre and post merge
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfWork,
      'should provide the correct initial chain consensus type',
    )
    c.setHardfork(Hardfork.Paris)
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfStake,
      `should switch to ProofOfStake consensus on merge`,
    )
    c.setHardfork(Hardfork.MergeNetsplitBlock)
    assert.equal(
      c.consensusType(),
      ConsensusType.ProofOfStake,
      `should stay on ProofOfStake consensus post merge`,
    )
  })
})
