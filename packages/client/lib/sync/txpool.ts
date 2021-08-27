import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx'
import { Config } from '../config'
import { Peer } from '../net/peer'
import { EthProtocolMethods } from '../net/protocol'
import type { Block } from '@ethereumjs/block'
import { PeerPool } from '../net/peerpool'

export interface TxPoolOptions {
  /* Config */
  config: Config
}

type TxPoolObject = {
  tx: TypedTransaction
  hash: string // plain strings without hex prefix
  added: number
}

type HandledObject = {
  address: string // plain strings without hex prefix
  added: number
}

type UnprefixedAddress = string
type UnprefixedHash = string

/**
 * @module service
 */

/**
 * Tx pool (mempool)
 * @memberof module:service
 */
export class TxPool {
  public config: Config

  private opened: boolean
  public running: boolean

  /* global NodeJS */
  private _logInterval: NodeJS.Timeout | undefined

  /**
   * List of pending tx hashes to avoid double requests
   */
  private pending: UnprefixedHash[] = []

  /**
   * Map for handled tx hashes
   * (have been added to the pool at some point)
   *
   * This is meant to be a superset of the tx pool
   * so at any point it time containing minimally
   * all txs from the pool.
   */
  private handled: Map<UnprefixedHash, HandledObject>

  /**
   * The central pool dataset.
   *
   * Maps an address to a `TxPoolObject`
   */
  public pool: Map<UnprefixedAddress, TxPoolObject[]>

  /**
   * Activate before chain head is reached to start
   * tx pool preparation (sorting out included txs)
   */
  public BLOCKS_BEFORE_TARGET_HEIGHT_ACTIVATION = 20

  /**
   * Max number of txs to request
   */
  private TX_RETRIEVAL_LIMIT = 256

  /**
   * Log pool statistics on the given interval
   */
  private LOG_STATISTICS_INTERVAL = 10000 // ms

  /**
   * Create new tx pool
   * @param options constructor parameters
   */
  constructor(options: TxPoolOptions) {
    this.config = options.config

    this.pool = new Map<UnprefixedAddress, TxPoolObject[]>()
    this.handled = new Map<UnprefixedHash, HandledObject>()

    this.opened = false
    this.running = false
  }

  /**
   * Open pool
   */
  open(): boolean {
    if (this.opened) {
      return false
    }
    this.opened = true

    return true
  }

  /**
   * Start tx processing
   */
  start(): boolean {
    if (this.running) {
      return false
    }
    this._logInterval = setInterval(this._logPoolStats.bind(this), this.LOG_STATISTICS_INTERVAL)
    this.running = true
    this.config.logger.info('TxPool started.')
    return true
  }

  /**
   * Adds a tx to the pool
   * @param tx Transaction
   */
  addTransaction(tx: TypedTransaction) {
    const sender = tx.getSenderAddress().toString()
    const inPool = this.pool.get(sender)
    let add: TxPoolObject[] = []
    if (inPool) {
      // Replace pooled txs with the same nonce
      add = inPool.filter((poolObj) => !poolObj.tx.nonce.eq(tx.nonce))
    }
    const address: UnprefixedAddress = tx.getSenderAddress().toString()
    const hash: UnprefixedHash = tx.hash().toString('hex')
    const added = Date.now()
    add.push({ tx, added, hash })

    this.pool.set(address, add)
    this.handled.set(hash, { address, added })
  }

  /**
   * Send transactions to other peers in the peer pool
   * @param pool
   * @param tx Array with transactions to send
   */
  sendTransactions(peerPool: PeerPool, txs: TypedTransaction[]) {
    const peers = peerPool.peers

    for (const peer of peers) {
      const txsToSend = []
      for (const tx of txs) {
        // TODO: check if tx has already been sent to peer
        if (tx.type === 0) {
          txsToSend.push(tx.raw())
        } else {
          txsToSend.push(tx.serialize())
        }
      }
      if (txsToSend.length > 0) {
        peer.eth?.send('Transactions', txsToSend)
      }
    }
  }

  /**
   * New pooled txs announced
   * @param  announcements new block hash announcements
   * @param  peer peer
   */
  async announcedTxHashes(txHashes: Buffer[], peer: Peer) {
    if (!this.running || txHashes.length === 0) {
      return
    }
    this.config.logger.debug(`TxPool: received new pooled hashes number=${txHashes.length}`)

    const reqHashes = []
    for (const txHash of txHashes) {
      const txHashStr: UnprefixedHash = txHash.toString('hex')
      if (this.pending.includes(txHashStr) || this.handled.has(txHashStr)) {
        continue
      }
      reqHashes.push(txHash)
    }

    if (reqHashes.length === 0) {
      return
    }

    const reqHashesStr: UnprefixedHash[] = reqHashes.map((hash) => hash.toString('hex'))
    this.pending.concat(reqHashesStr)
    this.config.logger.debug(
      `TxPool: requesting txs number=${reqHashes.length} pending=${this.pending.length}`
    )
    const txsResult = await (peer!.eth as EthProtocolMethods).getPooledTransactions({
      hashes: reqHashes.slice(0, this.TX_RETRIEVAL_LIMIT),
    })

    this.config.logger.debug(`TxPool: received txs number=${txsResult[1].length}`)

    // Remove from pending list regardless if tx is in result
    for (const reqHashStr of reqHashesStr) {
      this.pending = this.pending.filter((hash) => hash !== reqHashStr)
    }

    for (const txData of txsResult[1]) {
      const tx = TransactionFactory.fromBlockBodyData(txData)
      this.addTransaction(tx)
    }
  }

  /**
   * Sync txs in the pool with txs from latest blocks
   */
  newBlocks(blocks: Block[]) {
    if (!this.running) {
      return
    }
    for (const block of blocks) {
      const includedTxs: string[] = []
      for (const tx of block.transactions) {
        const hash: UnprefixedHash = tx.hash().toString('hex')
        // If tx hasn't been handled by the pool continue
        // (performance optimization)
        if (!this.handled.has(hash)) {
          continue
        }
        includedTxs.push(hash)
      }
      this.pool.forEach((poolObjects, address) => {
        for (const poolObject of poolObjects) {
          if (includedTxs.includes(poolObject.hash)) {
            if (poolObjects.length === 1) {
              // This was the only tx from this address, can delete entry
              this.pool.delete(address)
            } else {
              // There are more txs from this address, just remove the included hashes
              this.pool.set(
                address,
                poolObjects.filter((obj) => !includedTxs.includes(obj.hash))
              )
            }
          }
        }
      })
    }
  }

  /**
   * Stop pool execution
   */
  stop(): boolean {
    if (!this.running) {
      return false
    }
    clearInterval(this._logInterval as NodeJS.Timeout)

    this.running = false
    this.config.logger.info('TxPool stopped.')
    return true
  }

  /**
   * Close pool
   */
  close() {
    this.pool.clear()
    this.opened = false
  }

  _logPoolStats() {
    let count = 0
    this.pool.forEach((poolObjects) => {
      count += poolObjects.length
    })
    this.config.logger.info(`TxPool Statistics transactions=${count} senders=${this.pool.size}`)
  }
}
