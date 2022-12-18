import { Common } from '@ethereumjs/common'
import { privateToAddress } from '@ethereumjs/util'
import { Client } from 'jayson/promise'
import * as tape from 'tape'

import { runTxHelper, sleep, startNetwork } from './simutils'

const pkey = Buffer.from('45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8', 'hex')
const sender = '0x' + privateToAddress(pkey).toString('hex')
const client = Client.http({ port: 8545 })

const network = 'sharding'
const shardingJson = require(`./configs/${network}.json`)
const common = Common.fromGethGenesis(shardingJson, { chain: network })

export async function runTx(data: string, to?: string, value?: bigint) {
  return runTxHelper({ client, common, sender, pkey }, data, to, value)
}

// To minimise noise on the spec run, selective filteration is applied to let the important events
// of the testnet log to show up in the spec log
const filterKeywords = [
  'warn',
  'error',
  'npm run client:start',
  'docker run',
  'lodestar dev',
  'kill',
  'ejs',
  'lode',
  'pid',
]
const filterOutWords = ['duties', 'Low peer count', 'MaxListenersExceededWarning']

tape('sharding/eip4844 hardfork tests', async (t) => {
  const { teardownCallBack, result } = await startNetwork(network, client, {
    filterKeywords,
    filterOutWords,
    externalRun: process.env.EXTERNAL_RUN,
  })

  if (result.includes('EthereumJS')) {
    t.pass('connected to client')
  } else {
    t.fail('connected to wrong client')
  }

  console.log(`Waiting for network to start...`)
  let syncing = true
  let tries = 0
  while (syncing && tries < 5) {
    tries++
    const res = await client.request('eth_syncing', [])
    if (res.result === false) {
      syncing = false
    } else {
      process.stdout.write('*')
      await sleep(12000)
    }
  }
  if (syncing) {
    t.fail('ethereumjs<>lodestar failed to start')
  } else {
    t.pass('ethereumjs<>lodestar started successfully')
  }
  // ------------Sanity checks--------------------------------
  t.test('Simple transfer - sanity check', async (st) => {
    await runTx('', '0x3dA33B9A0894b908DdBb00d96399e506515A1009', 1000000n)
    let balance = await client.request('eth_getBalance', [
      '0x3dA33B9A0894b908DdBb00d96399e506515A1009',
      'latest',
    ])
    st.equal(BigInt(balance.result), 1000000n, 'sent a simple ETH transfer')
    await runTx('', '0x3dA33B9A0894b908DdBb00d96399e506515A1009', 1000000n)
    balance = await client.request('eth_getBalance', [
      '0x3dA33B9A0894b908DdBb00d96399e506515A1009',
      'latest',
    ])
    st.equal(BigInt(balance.result), 2000000n, 'sent a simple ETH transfer 2x')
    st.end()
  })

  t.test('should reset td', async (st) => {
    try {
      await teardownCallBack()
      st.pass('network cleaned')
    } catch (e) {
      st.fail('network not cleaned properly')
    }
    st.end()
  })

  t.end()
})
