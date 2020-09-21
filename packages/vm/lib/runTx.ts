import { BN } from 'ethereumjs-util'
import { Block } from '@ethereumjs/block'
import { Transaction } from '@ethereumjs/tx'
import VM from './index'
import Bloom from './bloom'
import { default as EVM, EVMResult } from './evm/evm'
import Message from './evm/message'
import TxContext from './evm/txContext'

/**
 * Options for the `runTx` method.
 */
export interface RunTxOpts {
  /**
   * The block to which the `tx` belongs
   */
  block?: any
  /**
   * An [`@ethereumjs/tx`](https://github.com/ethereumjs/ethereumjs-vm/tree/master/packages/tx) to run
   */
  tx: Transaction
  /**
   * If true, skips the nonce check
   */
  skipNonce?: boolean
  /**
   * If true, skips the balance check
   */
  skipBalance?: boolean
}

/**
 * Execution result of a transaction
 */
export interface RunTxResult extends EVMResult {
  /**
   * Bloom filter resulted from transaction
   */
  bloom: Bloom
  /**
   * The amount of ether used by this transaction
   */
  amountSpent: BN
  /**
   * The amount of gas as that was refunded during the transaction (i.e. `gasUsed = totalGasConsumed - gasRefund`)
   */
  gasRefund?: BN
}

/**
 * @ignore
 */
export default async function runTx(this: VM, opts: RunTxOpts): Promise<RunTxResult> {
  // tx is required
  if (!opts.tx) {
    throw new Error('invalid input, tx is required')
  }

  // create a reasonable default if no block is given
  if (!opts.block) {
    const common = (<any>opts.tx)._common
    opts.block = new Block(undefined, { common })
  }

  if (new BN(opts.block.header.gasLimit).lt(opts.tx.gasLimit)) {
    throw new Error('tx has a higher gas limit than the block')
  }

  const state = this.stateManager
  await state.checkpoint()

  try {
    const result = await _runTx.bind(this)(opts)
    await state.commit()
    return result
  } catch (e) {
    await state.revert()
    throw e
  }
}

async function _runTx(this: VM, opts: RunTxOpts): Promise<RunTxResult> {
  const block = opts.block
  const tx = opts.tx
  const state = this.stateManager

  /**
   * The `beforeTx` event
   *
   * @event Event: beforeTx
   * @type {Object}
   * @property {Transaction} tx emits the Transaction that is about to be processed
   */
  await this._emit('beforeTx', tx)

  const caller = tx.getSenderAddress().buf

  // Validate gas limit against base fee
  const basefee = tx.getBaseFee()
  const gasLimit = tx.gasLimit.clone()
  if (gasLimit.lt(basefee)) {
    throw new Error('base fee exceeds gas limit')
  }
  gasLimit.isub(basefee)

  // Check from account's balance and nonce
  let fromAccount = await state.getAccount(caller)
  const balance = new BN(fromAccount.balance)
  const nonce = new BN(fromAccount.nonce)

  if (!opts.skipBalance) {
    const cost = tx.getUpfrontCost()
    if (balance.lt(cost)) {
      throw new Error(
        `sender doesn't have enough funds to send tx. The upfront cost is: ${cost.toString()} and the sender's account only has: ${balance.toString()}`,
      )
    }
  } else if (!opts.skipNonce) {
    if (!nonce.eq(tx.nonce)) {
      throw new Error(
        `the tx doesn't have the correct nonce. account has nonce of: ${nonce.toString()} tx has nonce of: ${tx.nonce.toString()}`,
      )
    }
  }

  // Update from account's nonce and balance
  fromAccount.nonce = nonce.addn(1).toArrayLike(Buffer)
  fromAccount.balance = balance.sub(tx.gasLimit.mul(tx.gasPrice)).toArrayLike(Buffer)
  await state.putAccount(caller, fromAccount)

  /*
   * Execute message
   */
  const txContext = new TxContext(tx.gasPrice, caller)
  const to = tx.to && tx.to.buf.length !== 0 ? tx.to.buf : undefined
  const { value, data } = tx
  const message = new Message({
    caller,
    gasLimit,
    to,
    value,
    data,
  })
  const evm = new EVM(this, txContext, block)
  const results = (await evm.executeMessage(message)) as RunTxResult

  /*
   * Parse results
   */
  // Generate the bloom for the tx
  results.bloom = txLogsBloom(results.execResult.logs)
  // Caculate the total gas used
  results.gasUsed.iadd(basefee)
  // Process any gas refund
  const gasRefund = evm._refund
  if (gasRefund) {
    if (gasRefund.lt(results.gasUsed.divn(2))) {
      results.gasUsed.isub(gasRefund)
    } else {
      results.gasUsed.isub(results.gasUsed.divn(2))
    }
  }
  results.amountSpent = results.gasUsed.mul(tx.gasPrice)

  // Update sender's balance
  fromAccount = await state.getAccount(caller)
  const finalFromBalance = tx.gasLimit
    .sub(results.gasUsed)
    .mul(tx.gasPrice)
    .add(new BN(fromAccount.balance))
  fromAccount.balance = finalFromBalance.toArrayLike(Buffer)
  await state.putAccount(caller, fromAccount)

  // Update miner's balance
  const minerAccount = await state.getAccount(block.header.coinbase)
  // add the amount spent on gas to the miner's account
  minerAccount.balance = new BN(minerAccount.balance).add(results.amountSpent).toArrayLike(Buffer)

  // Put the miner account into the state. If the balance of the miner account remains zero, note that
  // the state.putAccount function puts this into the "touched" accounts. This will thus be removed when
  // we clean the touched accounts below in case we are in a fork >= SpuriousDragon
  await state.putAccount(block.header.coinbase, minerAccount)

  /*
   * Cleanup accounts
   */
  if (results.execResult.selfdestruct) {
    const keys = Object.keys(results.execResult.selfdestruct)
    for (const k of keys) {
      await state.deleteAccount(Buffer.from(k, 'hex'))
    }
  }
  await state.cleanupTouchedAccounts()
  await state.clearOriginalStorageCache()

  /**
   * The `afterTx` event
   *
   * @event Event: afterTx
   * @type {Object}
   * @property {Object} result result of the transaction
   */
  await this._emit('afterTx', results)

  return results
}

/**
 * @method txLogsBloom
 * @private
 */
function txLogsBloom(logs?: any[]): Bloom {
  const bloom = new Bloom()
  if (logs) {
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i]
      // add the address
      bloom.add(log[0])
      // add the topics
      const topics = log[1]
      for (let q = 0; q < topics.length; q++) {
        bloom.add(topics[q])
      }
    }
  }
  return bloom
}
