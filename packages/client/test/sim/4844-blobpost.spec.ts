import { createCommonFromGethGenesis } from '@ethereumjs/common'
import { bytesToHex, hexToBytes, privateToAddress } from '@ethereumjs/util'
import { Client } from 'jayson/promise'
import { randomBytes } from 'node:crypto'
import { assert, describe, it } from 'vitest'

import {
  createBlobTxs,
  filterKeywords,
  filterOutWords,
  runTxHelper,
  startNetwork,
  waitForELStart,
} from './simutils.js'

import type { PrefixedHexString } from '@ethereumjs/util'

const pkey = hexToBytes(
  (process.env.PRIVATE_KEY as PrefixedHexString) ??
    '0xae557af4ceefda559c924516cabf029bedc36b68109bf8d6183fe96e04121f4e',
)
const sender = bytesToHex(privateToAddress(pkey))
const rpcUrl =
  process.env.RPC_URL ?? 'https://rpc.lodestar-ethereumjs-1.srv.4844-devnet-5.ethpandaops.io'
if (rpcUrl === undefined) {
  throw Error('Need a valid RPC url to connect to EL client')
}

const client = Client.https(rpcUrl as any)
// pick sharding spec which has cancun hf instantiated from genesis itself
// only override the chainid if provided
const chainId = Number(process.env.CHAIN_ID ?? 4844001005)
const numTxs = Number(process.env.NUM_TXS ?? 1)
console.log({ sender, rpcUrl, chainId, numTxs })

const network = 'sharding'
const shardingJson = require(`./configs/${network}.json`)

// safely change chainId without modifying underlying json
const commonJson = { ...shardingJson }
commonJson.config = { ...commonJson.config, chainId }
const common = createCommonFromGethGenesis(commonJson, { chain: network })

export async function runTx(data: PrefixedHexString, to?: PrefixedHexString, value?: bigint) {
  return runTxHelper({ client, common, sender, pkey }, data, to, value)
}

describe(`running txes on ${rpcUrl}`, async () => {
  const { teardownCallBack, result } = await startNetwork(network, client, {
    filterKeywords,
    filterOutWords,
    externalRun: 'true',
  })
  assert.ok(true, `connected to client ${result}`)

  console.log(`Checking for network running...`)
  try {
    await waitForELStart(client)
    assert.ok(true, `${result} confirmed running`)
  } catch (e) {
    assert.fail(`failed to confirm ${result} running`)
    throw e
  }

  it(
    'run blob transactions',
    async () => {
      const nonceFetch = await client.request(
        'eth_getTransactionCount',
        [sender.toString(), 'latest'],
        2.0,
      )
      const nonce = Number(nonceFetch.result)
      assert.ok(true, `fetched ${sender}'s  nonce=${nonce} for blob txs`)

      const txns = await createBlobTxs(
        numTxs - 1,
        pkey,
        nonce,
        {
          to: bytesToHex(randomBytes(20)),
          chainId,
          maxFeePerBlobGas: BigInt(process.env.MAX_DATAFEE ?? 100000000n),
          maxPriorityFeePerGas: BigInt(process.env.MAX_PRIORITY ?? 100000000n),
          maxFeePerGas: BigInt(process.env.MAX_FEE ?? 1000000000n),
          gasLimit: BigInt(process.env.GAS_LIMIT ?? 0xffffffn),
          blobSize: Number(process.env.BLOB_SIZE ?? 4096),
        },
        { common },
      )
      const txHashes = []
      for (const txn of txns) {
        const res = await client.request('eth_sendRawTransaction', [txn], 2.0)
        if (res.result === undefined) {
          console.log('eth_sendRawTransaction returned invalid response', res)
          assert.fail(`Unable to post all txs`)
          break
        }
        assert.ok(true, `posted tx with hash=${res.result}`)
        txHashes.push(res.result)
      }
      assert.ok(true, `posted txs=${txHashes.length}`)
    },
    10 * 60_000,
  )

  it('cleanup', async () => {
    try {
      await teardownCallBack()
      assert.ok(true, 'script terminated')
    } catch {
      assert.fail('could not terminate properly')
    }
  }, 60_000)
})
