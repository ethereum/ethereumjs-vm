import { Common, Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { bytesToHex, randomBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import {
  TransactionType,
  createTx,
  createTxFromJSONRPCProvider,
  createTxFromRPC,
} from '../src/index.js'
import { normalizeTxParams } from '../src/util.js'

import { optimismTxData } from './testData/optimismTx.js'
import { rpcTxData } from './testData/rpcTx.js'
import { v0txData } from './testData/v0tx.js'

import type { TypedTxData } from '../src/index.js'

const txTypes = [
  TransactionType.Legacy,
  TransactionType.AccessListEIP2930,
  TransactionType.FeeMarketEIP1559,
]

describe('[fromJSONRPCProvider]', () => {
  it('should work', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
    const provider = 'https://my.json.rpc.provider.com:8545'

    const realFetch = fetch
    //@ts-expect-error -- Typescript doesn't like us to replace global values
    // eslint-disable-next-line no-global-assign
    fetch = async (_url: string, req: any) => {
      const json = JSON.parse(req.body)
      if (json.params[0] === '0xed1960aa7d0d7b567c946d94331dddb37a1c67f51f30bf51f256ea40db88cfb0') {
        const { rpcTxData } = await import(`./testData/rpcTx.js`)
        return {
          ok: true,
          status: 200,
          json: () => {
            return {
              result: rpcTxData,
            }
          },
        }
      } else {
        return {
          ok: true,
          status: 200,
          json: () => {
            return {
              result: null, // This is the value Infura returns if no transaction is found matching the provided hash
            }
          },
        }
      }
    }

    const txHash = '0xed1960aa7d0d7b567c946d94331dddb37a1c67f51f30bf51f256ea40db88cfb0'
    const tx = await createTxFromJSONRPCProvider(provider, txHash, { common })
    assert.equal(bytesToHex(tx.hash()), txHash, 'generated correct tx from transaction RPC data')
    try {
      await createTxFromJSONRPCProvider(provider, bytesToHex(randomBytes(32)), {})
      assert.fail('should throw')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.ok(
        err.message.includes('No data returned from provider'),
        'throws correct error when no tx returned',
      )
    }
    //@ts-expect-error
    // eslint-disable-next-line no-global-assign
    fetch = realFetch
  })
})

describe('[normalizeTxParams]', () => {
  it('should work', () => {
    const normedTx = normalizeTxParams(rpcTxData)
    const tx = createTx(normedTx)
    assert.equal(normedTx.gasLimit, 21000n, 'correctly converted "gas" to "gasLimit"')
    assert.equal(
      bytesToHex(tx.hash()),
      rpcTxData.hash,
      'converted normed tx data to transaction object',
    )
  })
})

describe('fromRPC: interpret v/r/s values of 0x0 as undefined for Optimism system txs', () => {
  it('should work', async () => {
    for (const txType of txTypes) {
      const tx = await createTxFromRPC({ ...optimismTxData, type: txType } as TypedTxData)
      assert.ok(tx.v === undefined)
      assert.ok(tx.s === undefined)
      assert.ok(tx.r === undefined)
    }
  })
})

// This test ensures that "normal" txs of non-legacy type are correctly decoded if the
// `v` value is 0. This is the case in ~50% of the EIP2930 and EIP1559 txs
// The `v` value is either 0 or 1 there.
describe('fromRPC: ensure `v="0x0"` is correctly decoded for signed txs', () => {
  it('should work', async () => {
    for (const txType of txTypes) {
      if (txType === TransactionType.Legacy) {
        // legacy tx cannot have v=0
        continue
      }
      const common = createCustomCommon({ chainId: 0x10f2c }, Mainnet)
      const tx = await createTxFromRPC({ ...v0txData, type: txType } as TypedTxData, { common })
      assert.ok(tx.isSigned())
    }
  })
})
