import { SECP256K1_ORDER_DIV_2, bigIntToUnpaddedBytes, ecrecover } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { BaseTransaction } from '../baseTransaction.js'
import { Capability } from '../types.js'

import type { TransactionInterface } from '../types.js'

export function errorMsg(tx: TransactionInterface, msg: string) {
  return `${msg} (${tx.errorStr()})`
}

export function isSigned(tx: TransactionInterface): boolean {
  const { v, r, s } = tx
  if (v === undefined || r === undefined || s === undefined) {
    return false
  } else {
    return true
  }
}

/**
 * The amount of gas paid for the data in this tx
 */
export function getDataFee(tx: TransactionInterface, extraCost?: bigint): bigint {
  if (tx.cache.dataFee && tx.cache.dataFee.hardfork === tx.common.hardfork()) {
    return tx.cache.dataFee.value
  }

  const cost = BaseTransaction.prototype.getDataFee.bind(tx)() + (extraCost ?? 0n)

  if (Object.isFrozen(tx)) {
    tx.cache.dataFee = {
      value: cost,
      hardfork: tx.common.hardfork(),
    }
  }

  return cost
}

export function hash(tx: TransactionInterface): Uint8Array {
  if (!tx.isSigned()) {
    const msg = errorMsg(tx, 'Cannot call hash method if transaction is not signed')
    throw new Error(msg)
  }

  if (Object.isFrozen(tx)) {
    if (!tx.cache.hash) {
      tx.cache.hash = keccak256(tx.serialize())
    }
    return tx.cache.hash
  }

  return keccak256(tx.serialize())
}

/**
 * EIP-2: All transaction signatures whose s-value is greater than secp256k1n/2are considered invalid.
 * Reasoning: https://ethereum.stackexchange.com/a/55728
 */
export function validateHighS(tx: TransactionInterface): void {
  const { s } = tx
  if (tx.common.gteHardfork('homestead') && s !== undefined && s > SECP256K1_ORDER_DIV_2) {
    const msg = errorMsg(
      tx,
      'Invalid Signature: s-values greater than secp256k1n/2 are considered invalid'
    )
    throw new Error(msg)
  }
}

export function getSenderPublicKey(tx: TransactionInterface): Uint8Array {
  if (tx.cache.senderPubKey !== undefined) {
    return tx.cache.senderPubKey
  }

  const msgHash = tx.getMessageToVerifySignature()

  const { v, r, s } = tx

  validateHighS(tx)

  try {
    const sender = ecrecover(
      msgHash,
      v!,
      bigIntToUnpaddedBytes(r!),
      bigIntToUnpaddedBytes(s!),
      tx.supports(Capability.EIP155ReplayProtection) ? tx.common.chainId() : undefined
    )
    if (Object.isFrozen(tx)) {
      tx.cache.senderPubKey = sender
    }
    return sender
  } catch (e: any) {
    const msg = errorMsg(tx, 'Invalid Signature')
    throw new Error(msg)
  }
}
