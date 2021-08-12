import tape from 'tape-catch'
import Common from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'
import { Config } from '../../lib/config'

tape('[TxPool]', async (t) => {
  const { TxPool } = await import('../../lib/service/txpool')
  const config = new Config({ transports: [], loglevel: 'error' })

  const A = {
    address: Buffer.from('0b90087d864e82a284dca15923f3776de6bb016f', 'hex'),
    privateKey: Buffer.from(
      '64bf9cc30328b0e42387b3c82c614e6386259136235e20c1357bd11cdee86993',
      'hex'
    ),
  }

  const B = {
    address: Buffer.from('6f62d8382bf2587361db73ceca28be91b2acb6df', 'hex'),
    privateKey: Buffer.from(
      '2a6e9ad5a6a8e4f17149b8bc7128bf090566a11dbd63c30e5a0ee9f161309cd6',
      'hex'
    ),
  }

  const createTx = (from = A, to = B, nonce = 0, value = 1) => {
    const common = new Common({ chain: 'mainnet', hardfork: 'london' })
    const txData = {
      nonce,
      maxFeePerGas: 1000000000,
      maxInclusionFeePerGas: 100000000,
      gasLimit: 100000,
      to: to.address,
      value,
    }
    const tx = FeeMarketEIP1559Transaction.fromTxData(txData, { common })
    const signedTx = tx.sign(from.privateKey)
    return signedTx
  }

  const txA01 = createTx() // A -> B, nonce: 0, value: 1
  const txA02 = createTx(A, B, 0, 2) // A -> B, nonce: 0, value: 2 (different hash)

  t.test('should initialize correctly', (t) => {
    const config = new Config({ transports: [], loglevel: 'error' })
    const pool = new TxPool({ config })
    t.equal(pool.pool.size, 0, 'pool empty')
    t.notOk((pool as any).opened, 'pool not opened yet')
    t.end()
  })

  t.test('should open/close', async (t) => {
    t.plan(3)
    const config = new Config({ transports: [], loglevel: 'error' })
    const pool = new TxPool({ config })

    await pool.open()
    t.ok((pool as any).opened, 'pool opened')
    t.equals(await pool.open(), false, 'already opened')
    await pool.close()
    t.notOk((pool as any).opened, 'closed')
    t.end()
  })

  t.test('announced() -> add single tx', async (t) => {
    const pool = new TxPool({ config })

    await pool.open()
    const peer = {
      eth: {
        getPooledTransactions: () => {
          return [null, [txA01.serialize()]]
        },
      },
    }
    await pool.announced([txA01.hash()], peer as any)
    t.equal(pool.pool.size, 1, 'pool size 1')
    await pool.close()

    t.end()
  })

  t.test('announced() -> add two txs with same sender and nonce', async (t) => {
    const config = new Config({ transports: [], loglevel: 'error' })
    const pool = new TxPool({ config })

    await pool.open()
    const peer = {
      eth: {
        getPooledTransactions: () => {
          return [null, [txA01.serialize(), txA02.serialize()]]
        },
      },
    }
    await pool.announced([txA01.hash(), txA02.hash()], peer as any)
    t.equal(pool.pool.size, 1, 'pool size 1')
    //pool.pool.forEach((value, key) => { console.log(value); console.log(key) })
    const poolContent = pool.pool.get(`0x${A.address.toString('hex')}`)
    t.equal(poolContent?.length, 1, 'only one tx')
    t.deepEqual((poolContent as any)[0].tx.hash(), txA02.hash(), 'only later-added tx')
    await pool.close()

    t.end()
  })
})
