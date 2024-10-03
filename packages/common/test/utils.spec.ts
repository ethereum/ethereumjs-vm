import { assert, describe, it } from 'vitest'

import { Mainnet } from '../src/chains.js'
import { Hardfork } from '../src/enums.js'
import { createCommonFromGethGenesis } from '../src/index.js'
import { parseGethGenesis } from '../src/utils.js'

import { invalidSpuriousDragonData } from './data/geth-genesis/invalid-spurious-dragon.js'
import { noExtraData } from './data/geth-genesis/no-extra-data.js'
import { poaData } from './data/geth-genesis/poa.js'
import { postMergeData } from './data/geth-genesis/post-merge.js'
import { testnetData } from './data/geth-genesis/testnetData.js'
import { postMergeHardforkData } from './data/post-merge-hardfork.js'

describe('[Utils/Parse]', () => {
  it('should parse geth params file', async () => {
    const params = parseGethGenesis(testnetData, 'rinkeby')
    assert.equal(params.genesis.nonce, '0x0000000000000042', 'nonce should be correctly formatted')
  })

  it('should throw with invalid Spurious Dragon blocks', async () => {
    const f = () => {
      parseGethGenesis(invalidSpuriousDragonData, 'bad_params')
    }
    assert.throws(f, undefined, undefined, 'should throw')
  })

  it('should import poa network params correctly', async () => {
    let params = parseGethGenesis(poaData, 'poa')
    assert.equal(params.genesis.nonce, '0x0000000000000000', 'nonce is formatted correctly')
    assert.deepEqual(
      params.consensus,
      { type: 'poa', algorithm: 'clique', clique: { period: 15, epoch: 30000 } },
      'consensus config matches',
    )
    const poaCopy = Object.assign({}, poaData)
    poaCopy.nonce = '00'
    params = parseGethGenesis(poaCopy, 'poa')
    assert.equal(
      params.genesis.nonce,
      '0x0000000000000000',
      'non-hex prefixed nonce is formatted correctly',
    )
    assert.equal(params.hardfork, Hardfork.London, 'should correctly infer current hardfork')
  })

  it('should generate expected hash with london block zero and base fee per gas defined', async () => {
    const params = parseGethGenesis(postMergeData, 'post-merge')
    assert.equal(params.genesis.baseFeePerGas, postMergeData.baseFeePerGas)
  })

  it('should successfully parse genesis file with no extraData', async () => {
    const params = parseGethGenesis(noExtraData, 'noExtraData')
    assert.equal(params.genesis.extraData, '0x', 'extraData set to 0x')
    assert.equal(params.genesis.timestamp, '0x10', 'timestamp parsed correctly')
  })

  it('should set merge to block 0 when terminalTotalDifficultyPassed is true', () => {
    const mergeAtGenesisData = {} as any
    Object.assign(mergeAtGenesisData, postMergeData)
    mergeAtGenesisData.config.terminalTotalDifficultyPassed = true
    const common = createCommonFromGethGenesis(mergeAtGenesisData, {})
    assert.equal(common.hardforks().slice(-1)[0].block, 0)
  })

  it('should set merge to block 0 when terminalTotalDifficultyPassed is true', () => {
    const mergeAtGenesisData = {} as any
    Object.assign(mergeAtGenesisData, postMergeData)
    mergeAtGenesisData.config.terminalTotalDifficultyPassed = false
    try {
      createCommonFromGethGenesis(mergeAtGenesisData, {})
      assert.fail('should have thrown')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(err.message.includes('nonzero terminal total difficulty'))
    }
  })

  it('should successfully assign mainnet deposit contract address when none provided', async () => {
    const common = createCommonFromGethGenesis(postMergeHardforkData, {
      chain: 'customChain',
    })
    const depositContractAddress =
      common['_chainParams'].depositContractAddress ?? Mainnet.depositContractAddress

    assert.equal(
      depositContractAddress,
      Mainnet.depositContractAddress,
      'should assign mainnet deposit contract',
    )
  })

  it('should correctly parse deposit contract address', async () => {
    // clone json out to not have side effects
    const customData = postMergeHardforkData
    Object.assign(customData.config, {
      depositContractAddress: '0x4242424242424242424242424242424242424242',
    })

    const common = createCommonFromGethGenesis(customData, {
      chain: 'customChain',
    })
    const depositContractAddress =
      common['_chainParams'].depositContractAddress ?? Mainnet.depositContractAddress

    assert.equal(
      depositContractAddress,
      '0x4242424242424242424242424242424242424242',
      'should parse correct address',
    )
  })
})
