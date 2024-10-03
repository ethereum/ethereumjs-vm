import {
  Blob4844Tx,
  Capability,
  isAccessList2930Tx,
  isBlob4844Tx,
  isFeeMarket1559Tx,
  isLegacyTx,
} from '@ethereumjs/tx'
import {
  Account,
  Address,
  BIGINT_0,
  BIGINT_2,
  bytesToHex,
  bytesToUnprefixedHex,
  equalsBytes,
  hexToBytes,
} from '@ethereumjs/util'

import { Heap } from '../ext/qheap.js'

import type { Config } from '../config.js'
import type { QHeap } from '../ext/qheap.js'
import type { Peer } from '../net/peer/peer.js'
import type { PeerPool } from '../net/peerpool.js'
import type { FullEthereumService } from './fullethereumservice.js'
import type { Block } from '@ethereumjs/block'
import type { FeeMarket1559Tx, LegacyTx, TypedTransaction } from '@ethereumjs/tx'
import type { VM } from '@ethereumjs/vm'

// Configuration constants
const MIN_GAS_PRICE_BUMP_PERCENT = 10
const MIN_GAS_PRICE = BigInt(100000000) // .1 GWei
const TX_MAX_DATA_SIZE = 128 * 1024 // 128KB
const MAX_POOL_SIZE = 5000
const MAX_TXS_PER_ACCOUNT = 100

export interface TxPoolOptions {
  /* Config */
  config: Config

  /* FullEthereumService */
  service: FullEthereumService
}

type TxPoolObject = {
  tx: TypedTransaction
  hash: UnprefixedHash
  added: number
  error?: Error
}

type HandledObject = {
  address: UnprefixedAddress
  added: number
  error?: Error
}

type SentObject = {
  hash: UnprefixedHash
  added: number
  error?: Error
}

type UnprefixedAddress = string
type UnprefixedHash = string
type PeerId = string

type GasPrice = {
  tip: bigint
  maxFee: bigint
}

/**
 * @module service
 */

/**
 * Tx pool (mempool)
 * @memberof module:service
 */
export class TxPool {
  private config: Config
  private service: FullEthereumService

  private opened: boolean

  public running: boolean

  /* global NodeJS */
  private _cleanupInterval: NodeJS.Timeout | undefined
  private _logInterval: NodeJS.Timeout | undefined

  /**
   * List of pending tx hashes to avoid double requests
   */
  private pending: UnprefixedHash[] = []

  /**
   * The central pool dataset.
   *
   * Maps an address to a `TxPoolObject`
   */
  public pool: Map<UnprefixedAddress, TxPoolObject[]>

  /**
   * The number of txs currently in the pool
   */
  public txsInPool: number

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
   * Map for tx hashes a peer is already aware of
   * (so no need to re-broadcast)
   */
  private knownByPeer: Map<PeerId, SentObject[]>

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
   * Number of minutes to keep txs in the pool
   */
  public POOLED_STORAGE_TIME_LIMIT = 20

  /**
   * Number of minutes to forget about handled
   * txs (for cleanup/memory reasons)
   */
  public HANDLED_CLEANUP_TIME_LIMIT = 60

  /**
   * Rebroadcast full txs and new blocks to a fraction
   * of peers by doing
   * `max(1, floor(NUM_PEERS/NUM_PEERS_REBROADCAST_QUOTIENT))`
   */
  public NUM_PEERS_REBROADCAST_QUOTIENT = 4

  /**
   * Log pool statistics on the given interval
   */
  private LOG_STATISTICS_INTERVAL = 100000 // ms

  /**
   * Create new tx pool
   * @param options constructor parameters
   */
  constructor(options: TxPoolOptions) {
    this.config = options.config
    this.service = options.service

    this.pool = new Map<UnprefixedAddress, TxPoolObject[]>()
    this.txsInPool = 0
    this.handled = new Map<UnprefixedHash, HandledObject>()
    this.knownByPeer = new Map<PeerId, SentObject[]>()

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
    this._cleanupInterval = setInterval(
      this.cleanup.bind(this),
      this.POOLED_STORAGE_TIME_LIMIT * 1000 * 60,
    )

    if (this.config.logger.isInfoEnabled()) {
      // Only turn on txPool stats calculator if log level is info or above
      // since all stats calculator does is print `info` logs
      this._logInterval = setInterval(this._logPoolStats.bind(this), this.LOG_STATISTICS_INTERVAL)
    }
    this.running = true
    this.config.superMsg('TxPool started.')
    return true
  }

  /**
   * Checks if tx pool should be started
   */
  checkRunState() {
    if (this.running || !this.config.synchronized) {
      return
    }
    // If height gte target, we are close enough to the
    // head of the chain that the tx pool can be started
    const target =
      (this.config.syncTargetHeight ?? BIGINT_0) -
      BigInt(this.BLOCKS_BEFORE_TARGET_HEIGHT_ACTIVATION)
    if (this.service.chain.headers.height >= target) {
      this.start()
    }
  }

  private validateTxGasBump(existingTx: TypedTransaction, addedTx: TypedTransaction) {
    const existingTxGasPrice = this.txGasPrice(existingTx)
    const newGasPrice = this.txGasPrice(addedTx)
    const minTipCap =
      existingTxGasPrice.tip +
      (existingTxGasPrice.tip * BigInt(MIN_GAS_PRICE_BUMP_PERCENT)) / BigInt(100)

    const minFeeCap =
      existingTxGasPrice.maxFee +
      (existingTxGasPrice.maxFee * BigInt(MIN_GAS_PRICE_BUMP_PERCENT)) / BigInt(100)
    if (newGasPrice.tip < minTipCap || newGasPrice.maxFee < minFeeCap) {
      throw new Error(
        `replacement gas too low, got tip ${newGasPrice.tip}, min: ${minTipCap}, got fee ${newGasPrice.maxFee}, min: ${minFeeCap}`,
      )
    }

    if (addedTx instanceof Blob4844Tx && existingTx instanceof Blob4844Tx) {
      const minblobGasFee =
        existingTx.maxFeePerBlobGas +
        (existingTx.maxFeePerBlobGas * BigInt(MIN_GAS_PRICE_BUMP_PERCENT)) / BigInt(100)
      if (addedTx.maxFeePerBlobGas < minblobGasFee) {
        throw new Error(
          `replacement blob gas too low, got: ${addedTx.maxFeePerBlobGas}, min: ${minblobGasFee}`,
        )
      }
    }
  }

  /**
   * Validates a transaction against the pool and other constraints
   * @param tx The tx to validate
   */
  private async validate(tx: TypedTransaction, isLocalTransaction: boolean = false) {
    if (!tx.isSigned()) {
      throw new Error('Attempting to add tx to txpool which is not signed')
    }
    if (tx.data.length > TX_MAX_DATA_SIZE) {
      throw new Error(
        `Tx is too large (${tx.data.length} bytes) and exceeds the max data size of ${TX_MAX_DATA_SIZE} bytes`,
      )
    }
    const currentGasPrice = this.txGasPrice(tx)
    // This is the tip which the miner receives: miner does not want
    // to mine underpriced txs where miner gets almost no fees
    const currentTip = currentGasPrice.tip
    if (!isLocalTransaction) {
      const txsInPool = this.txsInPool
      if (txsInPool >= MAX_POOL_SIZE) {
        throw new Error('Cannot add tx: pool is full')
      }
      // Local txs are not checked against MIN_GAS_PRICE
      if (currentTip < MIN_GAS_PRICE) {
        throw new Error(`Tx does not pay the minimum gas price of ${MIN_GAS_PRICE}`)
      }
    }
    const senderAddress = tx.getSenderAddress()
    const sender: UnprefixedAddress = senderAddress.toString().slice(2)
    const inPool = this.pool.get(sender)
    if (inPool) {
      if (!isLocalTransaction && inPool.length >= MAX_TXS_PER_ACCOUNT) {
        throw new Error(
          `Cannot add tx for ${senderAddress}: already have max amount of txs for this account`,
        )
      }
      // Replace pooled txs with the same nonce
      const existingTxn = inPool.find((poolObj) => poolObj.tx.nonce === tx.nonce)
      if (existingTxn) {
        if (equalsBytes(existingTxn.tx.hash(), tx.hash())) {
          throw new Error(`${bytesToHex(tx.hash())}: this transaction is already in the TxPool`)
        }
        this.validateTxGasBump(existingTxn.tx, tx)
      }
    }
    const block = await this.service.chain.getCanonicalHeadHeader()
    if (typeof block.baseFeePerGas === 'bigint' && block.baseFeePerGas !== BIGINT_0) {
      if (currentGasPrice.maxFee < block.baseFeePerGas / BIGINT_2 && !isLocalTransaction) {
        throw new Error(
          `Tx cannot pay basefee of ${block.baseFeePerGas}, have ${currentGasPrice.maxFee} (not within 50% range of current basefee)`,
        )
      }
    }
    if (tx.gasLimit > block.gasLimit) {
      throw new Error(
        `Tx gaslimit of ${tx.gasLimit} exceeds block gas limit of ${block.gasLimit} (exceeds last block gas limit)`,
      )
    }

    // Copy VM in order to not overwrite the state root of the VMExecution module which may be concurrently running blocks
    const vmCopy = await this.service.execution.vm.shallowCopy()
    // Set state root to latest block so that account balance is correct when doing balance check
    await vmCopy.stateManager.setStateRoot(block.stateRoot)
    let account = await vmCopy.stateManager.getAccount(senderAddress)
    if (account === undefined) {
      account = new Account()
    }
    if (account.nonce > tx.nonce) {
      throw new Error(
        `0x${sender} tries to send a tx with nonce ${tx.nonce}, but account has nonce ${account.nonce} (tx nonce too low)`,
      )
    }
    const minimumBalance = tx.value + currentGasPrice.maxFee * tx.gasLimit
    if (account.balance < minimumBalance) {
      throw new Error(
        `0x${sender} does not have enough balance to cover transaction costs, need ${minimumBalance}, but have ${account.balance} (insufficient balance)`,
      )
    }
  }

  /**
   * Adds a tx to the pool.
   *
   * If there is a tx in the pool with the same address and
   * nonce it will be replaced by the new tx, if it has a sufficient gas bump.
   * This also verifies certain constraints, if these are not met, tx will not be added to the pool.
   * @param tx Transaction
   * @param isLocalTransaction if this is a local transaction (loosens some constraints) (default: false)
   */
  async add(tx: TypedTransaction, isLocalTransaction: boolean = false) {
    const hash: UnprefixedHash = bytesToUnprefixedHex(tx.hash())
    const added = Date.now()
    const address: UnprefixedAddress = tx.getSenderAddress().toString().slice(2)
    try {
      await this.validate(tx, isLocalTransaction)
      let add: TxPoolObject[] = this.pool.get(address) ?? []
      const inPool = this.pool.get(address)
      if (inPool) {
        // Replace pooled txs with the same nonce
        add = inPool.filter((poolObj) => poolObj.tx.nonce !== tx.nonce)
      }
      add.push({ tx, added, hash })
      this.pool.set(address, add)
      this.handled.set(hash, { address, added })

      this.txsInPool++

      if (isLegacyTx(tx)) {
        this.config.metrics?.legacyTxGauge?.inc()
      }
      if (isAccessList2930Tx(tx)) {
        this.config.metrics?.accessListEIP2930TxGauge?.inc()
      }
      if (isFeeMarket1559Tx(tx)) {
        this.config.metrics?.feeMarketEIP1559TxGauge?.inc()
      }
      if (isBlob4844Tx(tx)) {
        this.config.metrics?.blobEIP4844TxGauge?.inc()
      }
    } catch (e) {
      this.handled.set(hash, { address, added, error: e as Error })
      throw e
    }
  }

  /**
   * Returns the available txs from the pool
   * @param txHashes
   * @returns Array with tx objects
   */
  getByHash(txHashes: Uint8Array[]): TypedTransaction[] {
    const found = []
    for (const txHash of txHashes) {
      const txHashStr = bytesToUnprefixedHex(txHash)
      const handled = this.handled.get(txHashStr)
      if (!handled) continue
      const inPool = this.pool.get(handled.address)?.filter((poolObj) => poolObj.hash === txHashStr)
      if (inPool && inPool.length === 1) {
        found.push(inPool[0].tx)
      }
    }
    return found
  }

  /**
   * Removes the given tx from the pool
   * @param txHash Hash of the transaction
   * @param tx Optional, the transaction object itself can be included for collecting metrics
   */
  removeByHash(txHash: UnprefixedHash, tx?: any) {
    const handled = this.handled.get(txHash)
    if (!handled) return
    const { address } = handled
    const poolObjects = this.pool.get(address)
    if (!poolObjects) return
    const newPoolObjects = poolObjects.filter((poolObj) => poolObj.hash !== txHash)

    this.txsInPool--
    if (isLegacyTx(tx)) {
      this.config.metrics?.legacyTxGauge?.dec()
    }
    if (isAccessList2930Tx(tx)) {
      this.config.metrics?.accessListEIP2930TxGauge?.dec()
    }
    if (isFeeMarket1559Tx(tx)) {
      this.config.metrics?.feeMarketEIP1559TxGauge?.dec()
    }
    if (isBlob4844Tx(tx)) {
      this.config.metrics?.blobEIP4844TxGauge?.dec()
    }

    if (newPoolObjects.length === 0) {
      // List of txs for address is now empty, can delete
      this.pool.delete(address)
    } else {
      // There are more txs from this address
      this.pool.set(address, newPoolObjects)
    }
  }

  /**
   * Adds passed in txs to the map keeping track
   * of tx hashes known by a peer.
   * @param txHashes
   * @param peer
   * @returns Array with txs which are new to the list
   */
  addToKnownByPeer(txHashes: Uint8Array[], peer: Peer): Uint8Array[] {
    // Make sure data structure is initialized
    if (!this.knownByPeer.has(peer.id)) {
      this.knownByPeer.set(peer.id, [])
    }

    const newHashes: Uint8Array[] = []
    for (const hash of txHashes) {
      const inSent = this.knownByPeer
        .get(peer.id)!
        .filter((sentObject) => sentObject.hash === bytesToUnprefixedHex(hash)).length
      if (inSent === 0) {
        const added = Date.now()
        const add = {
          hash: bytesToUnprefixedHex(hash),
          added,
        }
        this.knownByPeer.get(peer.id)!.push(add)
        newHashes.push(hash)
      }
    }
    return newHashes
  }

  /**
   * Send (broadcast) tx hashes from the pool to connected
   * peers.
   *
   * Double sending is avoided by compare towards the
   * `SentTxHashes` map.
   * @param txHashes Array with transactions to send
   * @param peers
   */
  sendNewTxHashes(txs: [number[], number[], Uint8Array[]], peers: Peer[]) {
    const txHashes = txs[2]
    for (const peer of peers) {
      // Make sure data structure is initialized
      if (!this.knownByPeer.has(peer.id)) {
        this.knownByPeer.set(peer.id, [])
      }
      // Add to known tx hashes and get hashes still to send to peer
      const hashesToSend = this.addToKnownByPeer(txHashes, peer)

      // Broadcast to peer if at least 1 new tx hash to announce
      if (hashesToSend.length > 0) {
        if (
          peer.eth !== undefined &&
          peer.eth['versions'] !== undefined &&
          peer.eth['versions'].includes(68)
        ) {
          // If peer supports eth/68, send eth/68 formatted message (tx_types[], tx_sizes[], hashes[])
          const txsToSend: [number[], number[], Uint8Array[]] = [[], [], []]
          for (const hash of hashesToSend) {
            const index = txs[2].findIndex((el) => equalsBytes(el, hash))
            txsToSend[0].push(txs[0][index])
            txsToSend[1].push(txs[1][index])
            txsToSend[2].push(hash)
          }

          try {
            peer.eth?.send('NewPooledTransactionHashes', txsToSend.slice(0, 4096))
          } catch (e) {
            this.markFailedSends(peer, hashesToSend, e as Error)
          }
        }
        // If peer doesn't support eth/68, just send tx hashes
        else
          try {
            // We `send` this directly instead of using devp2p's async `request` since NewPooledTransactionHashes has no response and is just sent to peers
            // and this requires no tracking of a peer's response
            peer.eth?.send('NewPooledTransactionHashes', hashesToSend.slice(0, 4096))
          } catch (e) {
            this.markFailedSends(peer, hashesToSend, e as Error)
          }
      }
    }
  }

  /**
   * Send transactions to other peers in the peer pool
   *
   * Note that there is currently no data structure to avoid
   * double sending to a peer, so this has to be made sure
   * by checking on the context the sending is performed.
   * @param txs Array with transactions to send
   * @param peers
   */
  sendTransactions(txs: TypedTransaction[], peers: Peer[]) {
    if (txs.length > 0) {
      const hashes = txs.map((tx) => tx.hash())
      for (const peer of peers) {
        // This is used to avoid re-sending along pooledTxHashes
        // announcements/re-broadcasts
        const newHashes = this.addToKnownByPeer(hashes, peer)
        const newHashesHex = newHashes.map((txHash) => bytesToUnprefixedHex(txHash))
        const newTxs = txs.filter((tx) => newHashesHex.includes(bytesToUnprefixedHex(tx.hash())))
        peer.eth?.request('Transactions', newTxs).catch((e) => {
          this.markFailedSends(peer, newHashes, e as Error)
        })
      }
    }
  }

  private markFailedSends(peer: Peer, failedHashes: Uint8Array[], e: Error): void {
    for (const txHash of failedHashes) {
      const sendobject = this.knownByPeer
        .get(peer.id)
        ?.filter((sendObject) => sendObject.hash === bytesToUnprefixedHex(txHash))[0]
      if (sendobject) {
        sendobject.error = e
      }
    }
  }

  /**
   * Include new announced txs in the pool
   * and re-broadcast to other peers
   * @param txs
   * @param peer Announcing peer
   * @param peerPool Reference to the {@link PeerPool}
   */
  async handleAnnouncedTxs(txs: TypedTransaction[], peer: Peer, peerPool: PeerPool) {
    if (!this.running || txs.length === 0) return
    this.config.logger.debug(`TxPool: received new transactions number=${txs.length}`)
    this.addToKnownByPeer(
      txs.map((tx) => tx.hash()),
      peer,
    )

    const newTxHashes: [number[], number[], Uint8Array[]] = [] as any
    for (const tx of txs) {
      try {
        await this.add(tx)
        newTxHashes[0].push(tx.type)
        newTxHashes[1].push(tx.serialize().byteLength)
        newTxHashes[2].push(tx.hash())
      } catch (error) {
        if (!(error instanceof Error)) {
          error = new Error(error)
        }
        this.config.logger.debug(
          `Error adding tx to TxPool: ${error.message} (tx hash: ${bytesToHex(tx.hash())})`,
        )
      }
    }
    const peers = peerPool.peers
    const numPeers = peers.length
    const sendFull = Math.max(1, Math.floor(numPeers / this.NUM_PEERS_REBROADCAST_QUOTIENT))
    this.sendTransactions(txs, peers.slice(0, sendFull))
    this.sendNewTxHashes(newTxHashes, peers.slice(sendFull))
  }

  /**
   * Request new pooled txs from tx hashes announced and include them in the pool
   * and re-broadcast to other peers
   * @param txHashes new tx hashes announced
   * @param peer Announcing peer
   * @param peerPool Reference to the peer pool
   */
  async handleAnnouncedTxHashes(txHashes: Uint8Array[], peer: Peer, peerPool: PeerPool) {
    if (!this.running || txHashes === undefined || txHashes.length === 0) return
    this.addToKnownByPeer(txHashes, peer)

    const reqHashes = []
    for (const txHash of txHashes) {
      const txHashStr: UnprefixedHash = bytesToUnprefixedHex(txHash)
      if (this.pending.includes(txHashStr) || this.handled.has(txHashStr)) {
        continue
      }
      reqHashes.push(txHash)
    }

    if (reqHashes.length === 0) return

    this.config.logger.debug(`TxPool: received new tx hashes number=${reqHashes.length}`)

    const reqHashesStr: UnprefixedHash[] = reqHashes.map(bytesToUnprefixedHex)
    this.pending = this.pending.concat(reqHashesStr)
    this.config.logger.debug(
      `TxPool: requesting txs number=${reqHashes.length} pending=${this.pending.length}`,
    )
    const getPooledTxs = await peer.eth?.getPooledTransactions({
      hashes: reqHashes.slice(0, this.TX_RETRIEVAL_LIMIT),
    })

    // Remove from pending list regardless if tx is in result
    this.pending = this.pending.filter((hash) => !reqHashesStr.includes(hash))

    if (getPooledTxs === undefined) {
      return
    }
    const [_, txs] = getPooledTxs
    this.config.logger.debug(`TxPool: received requested txs number=${txs.length}`)

    const newTxHashes: [number[], number[], Uint8Array[]] = [[], [], []] as any
    for (const tx of txs) {
      try {
        await this.add(tx)
      } catch (error) {
        if (!(error instanceof Error)) {
          error = new Error(error)
        }
        this.config.logger.debug(
          `Error adding tx to TxPool: ${error.message} (tx hash: ${bytesToHex(tx.hash())})`,
        )
      }
      newTxHashes[0].push(tx.type)
      newTxHashes[1].push(tx.serialize().length)
      newTxHashes[2].push(tx.hash())
    }
    this.sendNewTxHashes(newTxHashes, peerPool.peers)
  }

  /**
   * Remove txs included in the latest blocks from the tx pool
   */
  removeNewBlockTxs(newBlocks: Block[]) {
    if (!this.running) return
    for (const block of newBlocks) {
      for (const tx of block.transactions) {
        const txHash: UnprefixedHash = bytesToUnprefixedHex(tx.hash())
        this.removeByHash(txHash, tx)
      }
    }
  }

  /**
   * Regular tx pool cleanup
   */
  cleanup() {
    // Remove txs older than POOLED_STORAGE_TIME_LIMIT from the pool
    // as well as the list of txs being known by a peer
    let compDate = Date.now() - this.POOLED_STORAGE_TIME_LIMIT * 1000 * 60
    for (const [i, mapToClean] of [this.pool, this.knownByPeer].entries()) {
      for (const [key, objects] of mapToClean) {
        const updatedObjects = objects.filter((obj) => obj.added >= compDate)
        if (updatedObjects.length < objects.length) {
          if (i === 0) this.txsInPool -= objects.length - updatedObjects.length
          if (updatedObjects.length === 0) {
            mapToClean.delete(key)
          } else {
            mapToClean.set(key, updatedObjects)
          }
        }
      }
    }

    // Cleanup handled txs
    compDate = Date.now() - this.HANDLED_CLEANUP_TIME_LIMIT * 1000 * 60
    for (const [address, handleObj] of this.handled) {
      if (handleObj.added < compDate) {
        this.handled.delete(address)
      }
    }
  }

  /**
   * Helper to return a normalized gas price across different
   * transaction types. Providing the baseFee param returns the
   * priority tip, and omitting it returns the max total fee.
   * @param tx The tx
   * @param baseFee Provide a baseFee to subtract from the legacy
   * gasPrice to determine the leftover priority tip.
   */
  private normalizedGasPrice(tx: TypedTransaction, baseFee?: bigint) {
    const supports1559 = tx.supports(Capability.EIP1559FeeMarket)
    if (typeof baseFee === 'bigint' && baseFee !== BIGINT_0) {
      if (supports1559) {
        return (tx as FeeMarket1559Tx).maxPriorityFeePerGas
      } else {
        return (tx as LegacyTx).gasPrice - baseFee
      }
    } else {
      if (supports1559) {
        return (tx as FeeMarket1559Tx).maxFeePerGas
      } else {
        return (tx as LegacyTx).gasPrice
      }
    }
  }
  /**
   * Returns the GasPrice object to provide information of the tx' gas prices
   * @param tx Tx to use
   * @returns Gas price (both tip and max fee)
   */
  private txGasPrice(tx: TypedTransaction): GasPrice {
    if (isLegacyTx(tx)) {
      return {
        maxFee: tx.gasPrice,
        tip: tx.gasPrice,
      }
    }

    if (isAccessList2930Tx(tx)) {
      return {
        maxFee: tx.gasPrice,
        tip: tx.gasPrice,
      }
    }

    if (isFeeMarket1559Tx(tx) || isBlob4844Tx(tx)) {
      return {
        maxFee: tx.maxFeePerGas,
        tip: tx.maxPriorityFeePerGas,
      }
    } else {
      throw new Error(`tx of type ${(tx as TypedTransaction).type} unknown`)
    }
  }

  /**
   * Returns eligible txs to be mined sorted by price in such a way that the
   * nonce orderings within a single account are maintained.
   *
   * Note, this is not as trivial as it seems from the first look as there are three
   * different criteria that need to be taken into account (price, nonce, account
   * match), which cannot be done with any plain sorting method, as certain items
   * cannot be compared without context.
   *
   * This method first sorts the separates the list of transactions into individual
   * sender accounts and sorts them by nonce. After the account nonce ordering is
   * satisfied, the results are merged back together by price, always comparing only
   * the head transaction from each account. This is done via a heap to keep it fast.
   *
   * @param baseFee Provide a baseFee to exclude txs with a lower gasPrice
   */
  async txsByPriceAndNonce(
    vm: VM,
    { baseFee, allowedBlobs }: { baseFee?: bigint; allowedBlobs?: number } = {},
  ) {
    const txs: TypedTransaction[] = []
    // Separate the transactions by account and sort by nonce
    const byNonce = new Map<string, TypedTransaction[]>()
    const skippedStats = { byNonce: 0, byPrice: 0, byBlobsLimit: 0 }
    for (const [address, poolObjects] of this.pool) {
      let txsSortedByNonce = poolObjects
        .map((obj) => obj.tx)
        .sort((a, b) => Number(a.nonce - b.nonce))
      // Check if the account nonce matches the lowest known tx nonce
      let account = await vm.stateManager.getAccount(new Address(hexToBytes(`0x${address}`)))
      if (account === undefined) {
        account = new Account()
      }
      const { nonce } = account
      if (txsSortedByNonce[0].nonce !== nonce) {
        // Account nonce does not match the lowest known tx nonce,
        // therefore no txs from this address are currently executable
        skippedStats.byNonce += txsSortedByNonce.length
        continue
      }
      if (typeof baseFee === 'bigint' && baseFee !== BIGINT_0) {
        // If any tx has an insufficient gasPrice,
        // remove all txs after that since they cannot be executed
        const found = txsSortedByNonce.findIndex((tx) => this.normalizedGasPrice(tx) < baseFee)
        if (found > -1) {
          skippedStats.byPrice += found + 1
          txsSortedByNonce = txsSortedByNonce.slice(0, found)
        }
      }
      byNonce.set(address, txsSortedByNonce)
    }
    // Initialize a price based heap with the head transactions
    const byPrice = new Heap({
      comparBefore: (a: TypedTransaction, b: TypedTransaction) =>
        this.normalizedGasPrice(b, baseFee) - this.normalizedGasPrice(a, baseFee) < BIGINT_0,
    }) as QHeap<TypedTransaction>
    for (const [address, txs] of byNonce) {
      byPrice.insert(txs[0])
      byNonce.set(address, txs.slice(1))
    }
    // Merge by replacing the best with the next from the same account
    let blobsCount = 0
    while (byPrice.length > 0) {
      // Retrieve the next best transaction by price
      const best = byPrice.remove()
      if (best === undefined) break

      // Push in its place the next transaction from the same account
      const address = best.getSenderAddress().toString().slice(2)
      const accTxs = byNonce.get(address)!

      // Insert the best tx into byPrice if
      //   i) this is not a blob tx,
      //   ii) or there is no blobs limit provided
      //   iii) or blobs are still within limit if this best tx's blobs are included
      if (
        !(best instanceof Blob4844Tx) ||
        allowedBlobs === undefined ||
        ((best as Blob4844Tx).blobs ?? []).length + blobsCount <= allowedBlobs
      ) {
        if (accTxs.length > 0) {
          byPrice.insert(accTxs[0])
          byNonce.set(address, accTxs.slice(1))
        }
        // Accumulate the best priced transaction and increment blobs count
        txs.push(best)
        if (best instanceof Blob4844Tx) {
          blobsCount += ((best as Blob4844Tx).blobs ?? []).length
        }
      } else {
        // Since no more blobs can fit in the block, not only skip inserting in byPrice but also remove all other
        // txs (blobs or not) of this sender address from further consideration
        skippedStats.byBlobsLimit += 1 + accTxs.length
        byNonce.set(address, [])
      }
    }
    this.config.logger.info(
      `txsByPriceAndNonce selected txs=${txs.length}, skipped byNonce=${skippedStats.byNonce} byPrice=${skippedStats.byPrice} byBlobsLimit=${skippedStats.byBlobsLimit}`,
    )
    return txs
  }

  /**
   * Stop pool execution
   */
  stop(): boolean {
    if (!this.running) return false
    clearInterval(this._cleanupInterval as NodeJS.Timeout)
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
    this.handled.clear()
    this.txsInPool = 0
    if (this.config.metrics !== undefined) {
      // TODO: Only clear the metrics related to the transaction pool here
      for (const [_, metric] of Object.entries(this.config.metrics)) {
        metric.set(0)
      }
    }
    this.opened = false
  }

  _logPoolStats() {
    let broadcasts = 0
    let broadcasterrors = 0
    let knownpeers = 0
    for (const sendobjects of this.knownByPeer.values()) {
      broadcasts += sendobjects.length
      broadcasterrors += sendobjects.filter((sendobject) => sendobject.error !== undefined).length
      knownpeers++
    }
    // Get average
    if (knownpeers > 0) {
      broadcasts = broadcasts / knownpeers
      broadcasterrors = broadcasterrors / knownpeers
    }
    if (this.txsInPool > 0) {
      broadcasts = broadcasts / this.txsInPool
      broadcasterrors = broadcasterrors / this.txsInPool
    }

    let handledadds = 0
    let handlederrors = 0
    for (const handledobject of this.handled.values()) {
      if (handledobject.error === undefined) {
        handledadds++
      } else {
        handlederrors++
      }
    }
    this.config.logger.info(
      `TxPool Statistics txs=${this.txsInPool} senders=${this.pool.size} peers=${this.service.pool.peers.length}`,
    )
    this.config.logger.info(
      `TxPool Statistics broadcasts=${broadcasts}/tx/peer broadcasterrors=${broadcasterrors}/tx/peer knownpeers=${knownpeers} since minutes=${this.POOLED_STORAGE_TIME_LIMIT}`,
    )
    this.config.logger.info(
      `TxPool Statistics successfuladds=${handledadds} failedadds=${handlederrors} since minutes=${this.HANDLED_CLEANUP_TIME_LIMIT}`,
    )
  }
}
