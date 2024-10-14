import { CliqueConsensus, createBlockchain } from '@ethereumjs/blockchain'
import { ConsensusAlgorithm, Hardfork, createCommonFromGethGenesis } from '@ethereumjs/common'
import {
  Address,
  bytesToHex,
  concatBytes,
  hexToBytes,
  parseGethGenesisState,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'
import { createInlineClient } from '../sim/simutils.js'
import { Chain } from '../../src/blockchain/index.js'
import { Config } from '../../src/config.js'
import { FullEthereumService } from '../../src/service/index.js'
import { Event } from '../../src/types.js'

import { MockServer } from './mocks/mockserver.js'
import { destroy, setup } from './util.js'

import type { ConsensusDict } from '@ethereumjs/blockchain'
import { create } from 'domain'
import { parseMultiaddrs } from '../../src/util/parse.js'
import { EthereumClient } from '../../src/index.js'

async function setupDevnet(prefundAddress: Address) {
  const addr = prefundAddress.toString().slice(2)
  const consensusConfig = {
    clique: {
      period: 1,
      epoch: 30000,
    },
  }
  const defaultChainData = {
    config: {
      chainId: 123456,
      homesteadBlock: 0,
      eip150Block: 0,
      eip150Hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      eip155Block: 0,
      eip158Block: 0,
      byzantiumBlock: 0,
      constantinopleBlock: 0,
      petersburgBlock: 0,
      istanbulBlock: 0,
      berlinBlock: 0,
      londonBlock: 0,
      ...consensusConfig,
    },
    nonce: '0x0',
    timestamp: '0x614b3731',
    gasLimit: '0x47b760',
    difficulty: '0x1',
    mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    coinbase: '0x0000000000000000000000000000000000000000',
    number: '0x0',
    gasUsed: '0x0',
    parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    baseFeePerGas: 7,
  }
  const extraData = concatBytes(new Uint8Array(32), prefundAddress.toBytes(), new Uint8Array(65))

  console.log(extraData)
  const chainData = {
    ...defaultChainData,
    extraData: bytesToHex(extraData),
    alloc: { [addr]: { balance: '0x10000000000000000000' } },
  }

  const common = createCommonFromGethGenesis(chainData, {
    chain: 'devnet',
    hardfork: Hardfork.London,
  })
  const customGenesisState = parseGethGenesisState(chainData)
  return { common, customGenesisState }
}

const accounts: [Address, Uint8Array][] = [
  [
    new Address(hexToBytes('0x0b90087d864e82a284dca15923f3776de6bb016f')),
    hexToBytes('0x64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
  ],
]

async function minerSetup(): Promise<EthereumClient[]> {
  const { common, customGenesisState } = await setupDevnet(accounts[0][0])
  const config1 = new Config({
    common,
    accountCache: 10000,
    storageCache: 1000,
    mine: true,
    accounts: accounts,
  })

  const miner = await createInlineClient(config1, common, customGenesisState)
  const config2 = new Config({
    common,
    accountCache: 10000,
    storageCache: 1000,
    bootnodes: parseMultiaddrs(miner.config.server!.getRlpxInfo().enode as string),
    accounts,
  })

  const follower = await createInlineClient(config2, common, customGenesisState)
  return [miner, follower]
}

describe('should mine blocks while a peer stays connected to tip of chain', () => {
  it('should work', async () => {
    const [miner, follower] = await minerSetup()

    const targetHeight = BigInt(5)
    await new Promise((resolve) => {
      follower.config.events.once(Event.SYNC_SYNCHRONIZED).then((chainHeight) => {
        assert.equal(chainHeight, targetHeight)
        assert.equal(follower.chain.blocks.height, targetHeight, 'synced blocks successfully')
        resolve(undefined)
      })
    })
  }, 30000)
})
