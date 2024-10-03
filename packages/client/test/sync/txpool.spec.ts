import { createBlock } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { MerkleStateManager } from '@ethereumjs/statemanager'
import { createAccessList2930Tx, createFeeMarket1559Tx } from '@ethereumjs/tx'
import {
  Account,
  bytesToHex,
  bytesToUnprefixedHex,
  concatBytes,
  hexToBytes,
  privateToAddress,
} from '@ethereumjs/util'
import * as http from 'http'
import * as promClient from 'prom-client'
import * as url from 'url'
import { assert, describe, it } from 'vitest'

import { Config } from '../../src/config.js'
import { getLogger } from '../../src/logging.js'
import { PeerPool } from '../../src/net/peerpool.js'
import { TxPool } from '../../src/service/txpool.js'

import type { PrometheusMetrics } from '../../src/types.js'

let prometheusMetrics: PrometheusMetrics | undefined

const setup = () => {
  const service: any = {
    chain: {
      headers: { height: BigInt(0) },
      getCanonicalHeadHeader: () => ({ height: BigInt(0) }),
    },
    execution: {
      vm: {
        stateManager: {
          getAccount: () => new Account(BigInt(0), BigInt('50000000000000000000')),
          setStateRoot: async (_root: Uint8Array) => {},
        },
        shallowCopy: () => service.execution.vm,
      },
    },
  }
  let metricsServer

  if (prometheusMetrics === undefined) {
    prometheusMetrics = {
      legacyTxGauge: new promClient.Gauge({
        name: 'legacy_transactions_in_transaction_pool',
        help: 'Number of legacy transactions in the client transaction pool',
      }),
      accessListEIP2930TxGauge: new promClient.Gauge({
        name: 'access_list_eip2930_transactions_in_transaction_pool',
        help: 'Number of access list EIP 2930 transactions in the client transaction pool',
      }),
      feeMarketEIP1559TxGauge: new promClient.Gauge({
        name: 'fee_market_eip1559_transactions_in_transaction_pool',
        help: 'Number of fee market EIP 1559 transactions in the client transaction pool',
      }),
      blobEIP4844TxGauge: new promClient.Gauge({
        name: 'blob_eip_4844_transactions_in_transaction_pool',
        help: 'Number of blob EIP 4844 transactions in the client transaction pool',
      }),
    }

    const register = new promClient.Registry()
    register.setDefaultLabels({
      app: 'ethereumjs-client',
    })
    promClient.collectDefaultMetrics({ register })
    for (const [_, metric] of Object.entries(prometheusMetrics)) {
      register.registerMetric(metric)
    }

    metricsServer = http.createServer(async (req, res) => {
      if (req.url === undefined) {
        res.statusCode = 400
        res.end('Bad Request: URL is missing')
        return
      }
      const reqUrl = new url.URL(req.url, `http://${req.headers.host}`)
      const route = reqUrl.pathname

      if (route === '/metrics') {
        // Return all metrics in the Prometheus exposition format
        res.setHeader('Content-Type', register.contentType)
        res.end(await register.metrics())
      }
    })
    // Start the HTTP server which exposes the metrics on http://localhost:8080/metrics
    metricsServer.listen(8080)
  }

  const config = new Config({
    prometheusMetrics,
    accountCache: 10000,
    storageCache: 1000,
    logger: getLogger({ loglevel: 'info' }),
  })
  const pool = new TxPool({ config, service })
  return { pool, metricsServer }
}

const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })
const config = new Config({ accountCache: 10000, storageCache: 1000 })

const handleTxs = async (
  txs: any[],
  failMessage: string,
  stateManager?: MerkleStateManager,
  pool?: TxPool,
) => {
  if (pool === undefined) {
    pool = setup().pool
  }
  try {
    if (stateManager !== undefined) {
      ;(pool['service'].execution.vm.stateManager as any) = stateManager
      pool['service'].execution.vm.stateManager.setStateRoot = async (_root: Uint8Array) => {}
    }

    pool.open()
    pool.start()
    const peer: any = {
      eth: {
        getPooledTransactions: () => {
          return [null, txs]
        },
      },
    }
    const peerPool = new PeerPool({ config })

    const validTxs = txs.slice(0, txs.length - 1)

    await pool.handleAnnouncedTxHashes(
      validTxs.map((e) => e.hash()),
      peer,
      peerPool,
    )

    await pool.add(txs[txs.length - 1])

    pool.stop()
    pool.close()
    return true
  } catch (e) {
    if (!(e instanceof Error)) {
      e = new Error(e)
    }
    pool.stop()
    pool.close()

    // Return false if the error message contains the fail message
    return !(e.message as string).includes(failMessage)
  }
}

describe('[TxPool]', async () => {
  const ogStateManagerSetStateRoot = MerkleStateManager.prototype.setStateRoot
  MerkleStateManager.prototype.setStateRoot = (): any => {}

  const A = {
    address: hexToBytes('0x0b90087d864e82a284dca15923f3776de6bb016f'),
    privateKey: hexToBytes('0x64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993'),
  }

  const B = {
    address: hexToBytes('0x6f62d8382bf2587361db73ceca28be91b2acb6df'),
    privateKey: hexToBytes('0x2a6e9ad5a6a8e4f17149b8bc7128bf090566a11dbd63c30e5a0ee9f161309cd6'),
  }

  const createTx = (from = A, to = B, nonce = 0, value = 1, feeBump = 0) => {
    const txData = {
      nonce,
      maxFeePerGas: 1000000000,
      maxPriorityFeePerGas: 1000000000,
      gasLimit: 100000,
      to: to.address,
      value,
    }
    txData.maxFeePerGas += (txData.maxFeePerGas * feeBump) / 100
    txData.maxPriorityFeePerGas += (txData.maxPriorityFeePerGas * feeBump) / 100
    const tx = createFeeMarket1559Tx(txData, { common })
    const signedTx = tx.sign(from.privateKey)
    return signedTx
  }

  const txA01 = createTx() // A -> B, nonce: 0, value: 1
  const txA02 = createTx(A, B, 0, 2, 10) // A -> B, nonce: 0, value: 2 (different hash)
  const txA02_Underpriced = createTx(A, B, 0, 2, 9) // A -> B, nonce: 0, gas price is too low to replace txn
  const txB01 = createTx(B, A) // B -> A, nonce: 0, value: 1
  const txB02 = createTx(B, A, 1, 5) // B -> A, nonce: 1, value: 5

  it('should initialize correctly', () => {
    const { pool } = setup()
    assert.equal(pool.pool.size, 0, 'pool empty')
    assert.notOk(pool['opened'], 'pool not opened yet')
    pool.open()
    assert.ok(pool['opened'], 'pool opened')
    pool.start()
    assert.ok(pool['running'], 'pool running')
    pool.stop()
    assert.notOk(pool['running'], 'pool not running anymore')
    pool.close()
    assert.notOk(pool['opened'], 'pool not opened anymore')
  })

  it('should open/close', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    assert.ok(pool['opened'], 'pool opened')
    assert.equal(pool.open(), false, 'already opened')
    pool.stop()
    pool.close()
    assert.notOk(pool['opened'], 'closed')
  })

  it('announcedTxHashes() -> add single tx / knownByPeer / getByHash()', async () => {
    // Safeguard that send() method from peer2 gets called

    const { pool, metricsServer } = setup()

    pool.open()
    pool.start()
    const peer: any = {
      id: '1',
      versions: [66],
      eth: {
        getPooledTransactions: () => {
          return [null, [txA01]]
        },
        send: () => {
          assert.fail('should not send to announcing peer')
        },
        request: () => {
          assert.fail('should not send to announcing peer')
        },
      },
    }
    let sentToPeer2 = 0
    const peer2: any = {
      id: '2',
      eth: {
        versions: [66],
        send: () => {
          sentToPeer2++
          assert.equal(sentToPeer2, 1, 'should send once to non-announcing peer')
        },
        request: () => {
          sentToPeer2++
          assert.equal(sentToPeer2, 1, 'should send once to non-announcing peer')
        },
      },
    }
    const peerPool = new PeerPool({ config })
    peerPool.add(peer)
    peerPool.add(peer2)

    await pool.handleAnnouncedTxHashes([txA01.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 1, 'pool size 1')
    assert.equal(pool['pending'].length, 0, 'cleared pending txs')
    assert.equal(pool['handled'].size, 1, 'added to handled txs')

    assert.equal(pool['knownByPeer'].size, 2, 'known tx hashes size 2 (entries for both peers)')
    assert.equal(pool['knownByPeer'].get(peer.id)?.length, 1, 'one tx added for peer 1')
    assert.equal(
      pool['knownByPeer'].get(peer.id)?.[0].hash,
      bytesToUnprefixedHex(txA01.hash()),
      'new known tx hashes entry for announcing peer',
    )

    const txs = pool.getByHash([txA01.hash()])
    assert.equal(txs.length, 1, 'should get correct number of txs by hash')
    assert.equal(
      bytesToHex(txs[0].serialize()),
      bytesToHex(txA01.serialize()),
      'should get correct tx by hash',
    )

    // check if transaction added in metrics
    let feeMarketEip1559TransactionCountInPool = undefined
    const response = await fetch('http://localhost:8080/metrics')
    const pattern = /^fee_market_eip1559_transactions_in_transaction_pool/
    const textLines = (await response.text()).split('\n')

    for (const line of textLines) {
      if (pattern.test(line)) {
        feeMarketEip1559TransactionCountInPool = parseInt(line.split(' ')[1])
      }
    }

    assert.equal(
      feeMarketEip1559TransactionCountInPool,
      pool.pool.size,
      'pool should contain single eip 1559 transaction',
    )

    pool.pool.clear()
    await pool.handleAnnouncedTxHashes([txA01.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 0, 'should not add a once handled tx')
    assert.equal(
      pool['knownByPeer'].get(peer.id)?.length,
      1,
      'should add tx only once to known tx hashes',
    )
    assert.equal(pool['knownByPeer'].size, 2, 'known tx hashes size 2 (entries for both peers)')

    pool.stop()
    pool.close()
    metricsServer?.close()
  })

  it('announcedTxHashes() -> TX_RETRIEVAL_LIMIT', async () => {
    const { pool } = setup()
    const TX_RETRIEVAL_LIMIT: number = pool['TX_RETRIEVAL_LIMIT']

    pool.open()
    pool.start()
    const peer = {
      eth: {
        versions: [66],
        getPooledTransactions: (res: any) => {
          assert.equal(
            res['hashes'].length,
            TX_RETRIEVAL_LIMIT,
            'should limit to TX_RETRIEVAL_LIMIT',
          )
          return [null, []]
        },
      },
    }
    const peerPool = new PeerPool({ config })

    const hashes = []
    for (let i = 1; i <= TX_RETRIEVAL_LIMIT + 1; i++) {
      // One more than TX_RETRIEVAL_LIMIT
      hashes.push(hexToBytes(`0x${i.toString().padStart(64, '0')}`)) // '0x0000000000000000000000000000000000000000000000000000000000000001',...
    }

    await pool.handleAnnouncedTxHashes(hashes, peer as any, peerPool)
    pool.stop()
    pool.close()
  })

  it('announcedTxHashes() -> add two txs (different sender)', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    const peer: any = {
      eth: {
        versions: [66],
        getPooledTransactions: () => {
          return [null, [txA01, txB01]]
        },
      },
    }
    const peerPool = new PeerPool({ config })

    await pool.handleAnnouncedTxHashes([txA01.hash(), txB01.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 2, 'pool size 2')
    pool.stop()
    pool.close()
  })

  it('announcedTxHashes() -> add two txs (same sender and nonce)', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    const peer: any = {
      eth: {
        versions: [66],
        getPooledTransactions: () => {
          return [null, [txA01, txA02]]
        },
      },
    }
    const peerPool = new PeerPool({ config })

    await pool.handleAnnouncedTxHashes([txA01.hash(), txA02.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 1, 'pool size 1')
    const address = bytesToUnprefixedHex(A.address)
    const poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 1, 'only one tx')
    assert.deepEqual(poolContent[0].tx.hash(), txA02.hash(), 'only later-added tx')
    pool.stop()
    pool.close()
  })

  it('announcedTxHashes() -> reject underpriced txn (same sender and nonce)', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    const txs = [txA01]
    const peer: any = {
      eth: {
        versions: [66, 67],
        getPooledTransactions: () => {
          return [null, txs]
        },
      },
    }
    const peerPool = new PeerPool({ config })
    let sentToPeer2 = 0
    const peer2: any = {
      id: '2',
      eth: {
        versions: [66, 67],
        send: (methodName: string) => {
          sentToPeer2++
          // throw the error on methodName so as to be handy
          throw Error(methodName)
        },
      },
    }
    peerPool.add(peer2)

    await pool.handleAnnouncedTxHashes([txA01.hash()], peer, peerPool)

    try {
      await pool.add(txA02_Underpriced)
      assert.fail('should fail adding underpriced txn to txpool')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(
        e.message.includes('replacement gas too low'),
        'successfully failed adding underpriced txn',
      )
      const poolObject = pool['handled'].get(bytesToUnprefixedHex(txA02_Underpriced.hash()))
      assert.equal(poolObject?.error, e, 'should have an errored poolObject')
      const poolTxs = pool.getByHash([txA02_Underpriced.hash()])
      assert.equal(poolTxs.length, 0, `should not be added in pool`)
    }
    assert.equal(pool.pool.size, 1, 'pool size 1')
    assert.equal(sentToPeer2, 1, 'broadcast attempt to the peer')
    assert.equal(pool['knownByPeer'].get(peer2.id)?.length, 1, 'known send objects')
    assert.equal(
      pool['knownByPeer'].get(peer2.id)?.[0]?.error?.message,
      'NewPooledTransactionHashes',
      'should have errored sendObject for NewPooledTransactionHashes broadcast',
    )
    const address = bytesToUnprefixedHex(A.address)
    const poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 1, 'only one tx')
    assert.deepEqual(poolContent[0].tx.hash(), txA01.hash(), 'only later-added tx')
    // Another attempt to add tx which should not be broadcasted to peer2
    await pool.handleAnnouncedTxHashes([txA01.hash()], peer, peerPool)
    assert.equal(sentToPeer2, 1, 'no new broadcast attempt to the peer')
    // Just to enhance logging coverage, assign peerPool for stats collection
    pool['service'].pool = peerPool
    pool._logPoolStats()
    pool.stop()
    pool.close()
  })

  it('announcedTxHashes() -> reject underpriced txn (same sender and nonce) in handleAnnouncedTxHashes', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    const txs = [txA01, txA02_Underpriced]
    const peer: any = {
      eth: {
        getPooledTransactions: () => {
          return [null, txs]
        },
      },
    }
    const peerPool = new PeerPool({ config })

    await pool.handleAnnouncedTxHashes([txA01.hash(), txA02_Underpriced.hash()], peer, peerPool)

    assert.equal(pool.pool.size, 1, 'pool size 1')
    const address = bytesToUnprefixedHex(A.address)
    const poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 1, 'only one tx')
    assert.deepEqual(poolContent[0].tx.hash(), txA01.hash(), 'only later-added tx')
    pool.stop()
    pool.close()
  })

  it('announcedTxHashes() -> reject if pool is full', async () => {
    // Setup 5001 txs
    const txs = []
    for (let account = 0; account < 51; account++) {
      const pkey = concatBytes(
        hexToBytes(`0x${'aa'.repeat(31)}`),
        hexToBytes(`0x${account.toString(16).padStart(2, '0')}`),
      )
      const from = {
        address: privateToAddress(pkey),
        privateKey: pkey,
      }
      for (let tx = 0; tx < 100; tx++) {
        const txn = createTx(from, B, tx)
        txs.push(txn)
        if (txs.length > 5000) {
          break
        }
      }
      if (txs.length > 5000) {
        break
      }
    }
    assert.notOk(await handleTxs(txs, 'pool is full'), 'successfully rejected too many txs')
  })

  it('announcedTxHashes() -> reject if account tries to send more than 100 txs', async () => {
    // Setup 101 txs
    const txs = []

    for (let tx = 0; tx < 101; tx++) {
      const txn = createTx(A, B, tx)
      txs.push(txn)
    }

    assert.notOk(
      await handleTxs(txs, 'already have max amount of txs for this account'),
      'successfully rejected too many txs from same account',
    )
  })

  it('announcedTxHashes() -> reject unsigned txs', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1000000000,
      }),
    )

    assert.notOk(
      await handleTxs(txs, 'Cannot call hash method if transaction is not signed'),
      'successfully rejected unsigned tx',
    )
  })

  it('announcedTxHashes() -> reject txs with invalid nonce', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1000000000,
        nonce: 0,
      }).sign(A.privateKey),
    )

    assert.notOk(
      await handleTxs(txs, 'tx nonce too low', {
        getAccount: () => new Account(BigInt(1), BigInt('50000000000000000000')),
      } as any),
      'successfully rejected tx with invalid nonce',
    )
  })

  it('announcedTxHashes() -> reject txs with too much data', async () => {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Paris })

    const txs = []
    txs.push(
      createFeeMarket1559Tx(
        {
          maxFeePerGas: 1000000000,
          maxPriorityFeePerGas: 1000000000,
          nonce: 0,
          data: `0x${'00'.repeat(128 * 1024 + 1)}`,
        },
        { common },
      ).sign(A.privateKey),
    )

    assert.notOk(
      await handleTxs(txs, 'exceeds the max data size', {
        getAccount: () => new Account(BigInt(0), BigInt('50000000000000000000000')),
      } as any),
      'successfully rejected tx with too much data',
    )
  })

  it('announcedTxHashes() -> account cannot pay the fees', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1000000000,
        gasLimit: 21000,
        nonce: 0,
      }).sign(A.privateKey),
    )

    assert.notOk(
      await handleTxs(txs, 'insufficient balance', {
        getAccount: () => new Account(BigInt(0), BigInt('0')),
      } as any),
      'successfully rejected account with too low balance',
    )
  })

  it('announcedTxHashes() -> reject txs which cannot pay base fee', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1000000000,
        nonce: 0,
      }).sign(A.privateKey),
    )

    const { pool } = setup()

    ;(<any>pool).service.chain.getCanonicalHeadHeader = () => ({
      baseFeePerGas: BigInt(3000000000),
    })

    assert.notOk(
      await handleTxs(txs, 'not within 50% range of current basefee', undefined, pool),
      'successfully rejected tx with too low gas price',
    )
  })

  it('announcedTxHashes() -> reject txs which have gas limit higher than block gas limit', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1000000000,
        nonce: 0,
        gasLimit: 21000,
      }).sign(A.privateKey),
    )

    const { pool } = setup()

    ;(<any>pool).service.chain.getCanonicalHeadHeader = () => ({
      gasLimit: BigInt(5000),
    })

    assert.notOk(
      await handleTxs(txs, 'exceeds last block gas limit', undefined, pool),
      'successfully rejected tx which has gas limit higher than block gas limit',
    )
  })

  it('announcedTxHashes() -> reject txs which are already in pool', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1000000000,
      }).sign(A.privateKey),
    )

    txs.push(txs[0])

    const { pool } = setup()

    assert.notOk(
      await handleTxs(txs, 'this transaction is already in the TxPool', undefined, pool),
      'successfully rejected tx which is already in pool',
    )
  })

  it('announcedTxHashes() -> reject txs with too low gas price', async () => {
    const txs = []

    txs.push(
      createFeeMarket1559Tx({
        maxFeePerGas: 10000000,
        maxPriorityFeePerGas: 10000000,
        nonce: 0,
      }).sign(A.privateKey),
    )

    assert.notOk(
      await handleTxs(txs, 'does not pay the minimum gas price of'),
      'successfully rejected tx with too low gas price',
    )
  })

  it('announcedTxHashes() -> reject txs with too low gas price (AccessListTransaction)', async () => {
    const txs = []

    txs.push(
      createAccessList2930Tx({
        gasPrice: 10000000,
        nonce: 0,
      }).sign(A.privateKey),
    )

    assert.notOk(
      await handleTxs(txs, 'does not pay the minimum gas price of'),
      'successfully rejected tx with too low gas price',
    )
  })

  it('announcedTxHashes() -> reject txs with too low gas price (invalid tx type)', async () => {
    const txs = []

    const tx = createAccessList2930Tx(
      {
        gasPrice: 1000000000 - 1,
        nonce: 0,
      },
      {
        freeze: false,
      },
    ).sign(A.privateKey)

    Object.defineProperty(tx, 'type', { get: () => 5 })

    txs.push(tx)

    assert.notOk(await handleTxs(txs, ''), 'successfully rejected tx with invalid tx type')
  })

  it('announcedTxs()', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    const peer: any = {
      eth: {
        send: () => {},
      },
    }
    const peerPool = new PeerPool({ config })

    await pool.handleAnnouncedTxs([txA01], peer, peerPool)
    assert.equal(pool.pool.size, 1, 'pool size 1')
    const address = bytesToUnprefixedHex(A.address)
    const poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 1, 'one tx')
    assert.deepEqual(poolContent[0].tx.hash(), txA01.hash(), 'correct tx')
    pool.stop()
    pool.close()
  })

  it('newBlocks() -> should remove included txs', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    let peer: any = {
      eth: {
        getPooledTransactions: () => {
          return [null, [txA01]]
        },
      },
    }
    const peerPool = new PeerPool({ config })

    await pool.handleAnnouncedTxHashes([txA01.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 1, 'pool size 1')

    // Craft block with tx not in pool
    let block = createBlock({ transactions: [txA02] }, { common })
    pool.removeNewBlockTxs([block])
    assert.equal(pool.pool.size, 1, 'pool size 1')

    // Craft block with tx in pool
    block = createBlock({ transactions: [txA01] }, { common })
    pool.removeNewBlockTxs([block])
    assert.equal(pool.pool.size, 0, 'pool should be empty')

    peer = {
      eth: {
        getPooledTransactions: () => {
          return [null, [txB01, txB02]]
        },
      },
    }
    await pool.handleAnnouncedTxHashes([txB01.hash(), txB02.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 1, 'pool size 1')
    const address = bytesToUnprefixedHex(B.address)
    let poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 2, 'two txs')

    // Craft block with tx not in pool
    block = createBlock({ transactions: [txA02] }, { common })
    pool.removeNewBlockTxs([block])
    assert.equal(pool.pool.size, 1, 'pool size 1')
    poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 2, 'two txs')

    // Craft block with tx in pool
    block = createBlock({ transactions: [txB01] }, { common })
    pool.removeNewBlockTxs([block])
    poolContent = pool.pool.get(address)!
    assert.equal(poolContent.length, 1, 'only one tx')

    // Craft block with tx in pool
    block = createBlock({ transactions: [txB02] }, { common })
    pool.removeNewBlockTxs([block])
    assert.equal(pool.pool.size, 0, 'pool size 0')

    pool.stop()
    pool.close()
  })

  it('cleanup()', async () => {
    const { pool } = setup()

    pool.open()
    pool.start()
    const peer: any = {
      eth: {
        getPooledTransactions: () => {
          return [null, [txA01, txB01]]
        },
      },
      send: () => {},
    }
    const peerPool = new PeerPool({ config })
    peerPool.add(peer)

    await pool.handleAnnouncedTxHashes([txA01.hash(), txB01.hash()], peer, peerPool)
    assert.equal(pool.pool.size, 2, 'pool size 2')
    assert.equal(pool['handled'].size, 2, 'handled size 2')
    assert.equal(pool['knownByPeer'].size, 1, 'known by peer size 1')
    assert.equal(pool['knownByPeer'].get(peer.id)!.length, 2, '2 known txs')

    pool.cleanup()
    assert.equal(
      pool.pool.size,
      2,
      'should not remove txs from pool (POOLED_STORAGE_TIME_LIMIT within range)',
    )
    assert.equal(
      pool['knownByPeer'].size,
      1,
      'should not remove txs from known by peer map (POOLED_STORAGE_TIME_LIMIT within range)',
    )
    assert.equal(
      pool['handled'].size,
      2,
      'should not remove txs from handled (HANDLED_CLEANUP_TIME_LIMIT within range)',
    )

    const address = txB01.getSenderAddress().toString().slice(2)
    const poolObj = pool.pool.get(address)![0]
    poolObj.added = Date.now() - pool.POOLED_STORAGE_TIME_LIMIT * 1000 * 60 - 1
    pool.pool.set(address, [poolObj])

    const knownByPeerObj1 = pool['knownByPeer'].get(peer.id)![0]
    const knownByPeerObj2 = pool['knownByPeer'].get(peer.id)![1]
    knownByPeerObj1.added = Date.now() - pool.POOLED_STORAGE_TIME_LIMIT * 1000 * 60 - 1
    pool['knownByPeer'].set(peer.id, [knownByPeerObj1, knownByPeerObj2])

    const hash = bytesToUnprefixedHex(txB01.hash())
    const handledObj = pool['handled'].get(hash)!
    handledObj.added = Date.now() - pool.HANDLED_CLEANUP_TIME_LIMIT * 1000 * 60 - 1
    pool['handled'].set(hash, handledObj)

    pool.cleanup()
    assert.equal(
      pool.pool.size,
      1,
      'should remove txs from pool (POOLED_STORAGE_TIME_LIMIT before range)',
    )
    assert.equal(
      pool['knownByPeer'].get(peer.id)!.length,
      1,
      'should remove one tx from known by peer map (POOLED_STORAGE_TIME_LIMIT before range)',
    )
    assert.equal(
      pool['handled'].size,
      1,
      'should remove txs from handled (HANDLED_CLEANUP_TIME_LIMIT before range)',
    )

    pool.stop()
    pool.close()
  })
  MerkleStateManager.prototype.setStateRoot = ogStateManagerSetStateRoot
})
