import { createCommonFromGethGenesis } from '@ethereumjs/common'
import { createTxFromTxData } from '@ethereumjs/tx'
import { bytesToHex, hexToBytes, privateToAddress } from '@ethereumjs/util'
import { Client } from 'jayson/promise'
import { randomBytes } from 'node:crypto'
import { assert, describe, it } from 'vitest'

import {
  createBlobTxs,
  filterKeywords,
  filterOutWords,
  runBlobTx,
  runTxHelper,
  sleep,
  startNetwork,
  waitForELStart,
} from './simutils.js'

import type { PrefixedHexString } from '@ethereumjs/util'

const pkey = hexToBytes('0x45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8')
const sender = bytesToHex(privateToAddress(pkey))
const client = Client.http({ port: 8545 })

const network = '4844-devnet'
const shardingJson = require(`./configs/${network}.json`)
const common = createCommonFromGethGenesis(shardingJson, { chain: network })

export async function runTx(data: PrefixedHexString, to?: PrefixedHexString, value?: bigint) {
  return runTxHelper({ client, common, sender, pkey }, data, to, value)
}

describe('sharding/eip4844 hardfork tests', async () => {
  if (process.env.EXTRA_CL_PARAMS === undefined) {
    process.env.EXTRA_CL_PARAMS = '--params.CAPELLA_FORK_EPOCH 0 --params.DENEB_FORK_EPOCH 0'
  }
  const { teardownCallBack, result } = await startNetwork(network, client, {
    filterKeywords,
    filterOutWords,
    externalRun: process.env.EXTERNAL_RUN,
    withPeer: process.env.WITH_PEER,
  })

  if (result.includes('EthereumJS')) {
    assert.ok(true, 'connected to client')
  } else {
    assert.fail('connected to wrong client')
  }

  console.log(`Waiting for network to start...`)
  try {
    await waitForELStart(client)
    assert.ok(true, 'ethereumjs<>lodestar started successfully')
  } catch (e) {
    assert.fail('ethereumjs<>lodestar failed to start')
    throw e
  }

  it('Simple blob tx', async () => {
    const txResult = await runBlobTx(
      client,
      2 ** 14,
      pkey,
      '0x3dA33B9A0894b908DdBb00d96399e506515A1009',
      undefined,
      { common },
    )

    const eth2res = await (await fetch('http://127.0.0.1:9596/eth/v1/beacon/headers')).json()
    const start = parseInt(eth2res.data[0].header.message.slot) - 1
    let eth2kzgs
    for (let i = 0; i < 5; i++) {
      const res = await (
        await fetch(`http://127.0.0.1:9596/eth/v2/beacon/blocks/${start + i}`)
      ).json()
      let done = false

      if (
        res.data.message.body.blob_kzg_commitments !== undefined &&
        res.data.message.body.blob_kzg_commitments.length > 0
      ) {
        done = true
        eth2kzgs = res.data.message.body.blob_kzg_commitments
        break
      }
      while (!done) {
        const current =
          (await (await fetch(`http://127.0.0.1:9596/eth/v1/beacon/headers`)).json()).data[0].header
            .message.slot - 1
        if (current > start + i) {
          done = false
          break
        }
        await sleep(1000)
      }
    }

    assert.equal(
      eth2kzgs[0],
      bytesToHex(txResult.tx.kzgCommitments![0]),
      'found expected blob commitments on CL',
    )
  }, 60_000)

  it(
    'blob gas fee market tests',
    async () => {
      const txns = await createBlobTxs(
        4,
        pkey,
        // Start with nonce of 1 since a tx previous has already been posted
        1,
        {
          to: bytesToHex(randomBytes(20)),
          chainId: 1,
          maxFeePerBlobGas: BigInt(1000) as any,
          maxPriorityFeePerGas: BigInt(1) as any,
          maxFeePerGas: '0xff' as any,
          gasLimit: BigInt(1000000) as any,
          blobSize: 4096,
        },
        { common },
      )
      const txHashes = []
      for (const txn of txns) {
        const res = await client.request('eth_sendRawTransaction', [txn], 2.0)
        txHashes.push(res.result)
      }
      let done = false
      let txReceipt
      while (!done) {
        txReceipt = await client.request('eth_getTransactionReceipt', [txHashes[0]], 2.0)
        if (txReceipt.result !== null) {
          done = true
        }
        await sleep(2000)
      }
      const block1 = await client.request(
        'eth_getBlockByHash',
        [txReceipt.result.blockHash, false],
        2.0,
      )
      // next block will have the excessBlobGas
      done = false
      let block2
      while (!done) {
        const nextBlockNumber = `0x${(Number(block1.result.number) + 1).toString(16)}`
        block2 = await client.request('eth_getBlockByNumber', [nextBlockNumber, false], 2.0)
        if (block2.result !== null && block2.result !== undefined) {
          done = true
        }
        await sleep(2000)
      }
      assert.ok(BigInt(block2.result.excessBlobGas) > 0n, 'block1 has excess blob gas > 0')
    },
    10 * 60_000,
  )

  it('point precompile contract test', async () => {
    const nonce = await client.request(
      'eth_getTransactionCount',
      [sender.toString(), 'latest'],
      2.0,
    )

    /* Data is contract deployment code for the below contract borrowed from the 4844-interop repo
    //https://github.com/Inphi/eip4844-interop/blob/master/point_evaluation_tx/PointEvaluationTest.sol

    contract PointEvaluationTest {
      constructor(bytes memory input) {
          assembly {
              if iszero(staticcall(gas(), 0x14, mload(input), 0xc0, 0, 0)) {
                revert(0,0)
              }
          }
      }
    }
    */

    const txData = {
      data: hexToBytes(
        '0xf9031103830186a0830f42408080b902c0608060405234801561001057600080fd5b50604051610260380380610260833981810160405281019061003291906101ca565b60008060c0835160145afa61004657600080fd5b50610213565b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6100b38261006a565b810181811067ffffffffffffffff821117156100d2576100d161007b565b5b80604052505050565b60006100e561004c565b90506100f182826100aa565b919050565b600067ffffffffffffffff8211156101115761011061007b565b5b61011a8261006a565b9050602081019050919050565b60005b8381101561014557808201518184015260208101905061012a565b83811115610154576000848401525b50505050565b600061016d610168846100f6565b6100db565b90508281526020810184848401111561018957610188610065565b5b610194848285610127565b509392505050565b600082601f8301126101b1576101b0610060565b5b81516101c184826020860161015a565b91505092915050565b6000602082840312156101e0576101df610056565b5b600082015167ffffffffffffffff8111156101fe576101fd61005b565b5b61020a8482850161019c565b91505092915050565b603f806102216000396000f3fe6080604052600080fdfea2646970667358221220cbb964afe0f584a89b887bf992e18697c0ebd77a40a102c121f54213f23d4d9464736f6c634300080f00330000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000212340000000000000000000000000000000000000000000000000000000000001ba002e89a44a4e4da739fed1ed658079a75dbcb59eebbd8ea0cb11f88a41d611dfaa025fe1645a1d3c9828be471fac5cd3e4be59c90ea304c94d774ff88c84349d8db',
      ),
      nonce: BigInt(nonce.result),
      gasLimit: 0xffffff,
      maxFeePerGas: 0xff,
      maxPriorityFeePerGas: 0xf,
    }

    const tx = createTxFromTxData({ type: 2, ...txData }, { common }).sign(pkey)

    const txResult = await client.request(
      'eth_sendRawTransaction',
      [bytesToHex(tx.serialize())],
      2.0,
    )
    let receipt = await client.request('eth_getTransactionReceipt', [txResult.result], 2.0)
    while (receipt.result === null) {
      receipt = await client.request('eth_getTransactionReceipt', [txResult.result], 2.0)
      await sleep(1000)
    }
    assert.ok(
      receipt.result.contractAddress !== undefined,
      'successfully deployed contract that calls precompile',
    )
  }, 60_000)
  /*
  it('multipeer setup', async () => {
    const multiPeer = Client.http({ port: 8947 })
    const res = await multiPeer.request('eth_syncing', [], 2.0)
    console.log(res)
    assert.equal(res.result, 'false', 'multipeer is up and running')
  })*/

  it('should reset td', async () => {
    try {
      await teardownCallBack()
      assert.ok(true, 'network cleaned')
    } catch {
      assert.fail('network not cleaned properly')
    }
  }, 60_000)
})
