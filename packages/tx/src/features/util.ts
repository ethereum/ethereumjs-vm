import { Common, Mainnet } from '@ethereumjs/common'
import {
  Address,
  MAX_INTEGER,
  MAX_UINT63,
  MAX_UINT64,
  bigIntToHex,
  bytesToBigInt,
  bytesToHex,
  toBytes,
} from '@ethereumjs/util'

import { paramsTx } from '../params.js'
import { checkMaxInitCodeSize, validateNotArray } from '../util.js'

import type { TransactionInterface, TransactionType, TxData, TxOptions } from '../types.js'

export function getCommon(common?: Common): Common {
  return common?.copy() ?? new Common({ chain: Mainnet })
}

/**
 * Validates that an object with BigInt values cannot exceed the specified bit limit.
 * @param values Object containing string keys and BigInt values
 * @param bits Number of bits to check (64 or 256)
 * @param cannotEqual Pass true if the number also cannot equal one less the maximum value
 */
export function valueBoundaryCheck(
  // TODO: better method name
  values: { [key: string]: bigint | undefined },
  bits = 256,
  cannotEqual = false,
) {
  for (const [key, value] of Object.entries(values)) {
    switch (bits) {
      case 63:
        if (cannotEqual) {
          if (value !== undefined && value >= MAX_UINT63) {
            // TODO: error msgs got raised to a error string handler first, now throws "generic" error
            throw new Error(`${key} cannot equal or exceed MAX_UINT63 (2^63-1), given ${value}`)
          }
        } else {
          if (value !== undefined && value > MAX_UINT63) {
            throw new Error(`${key} cannot exceed MAX_UINT63 (2^63-1), given ${value}`)
          }
        }
        break
      case 64:
        if (cannotEqual) {
          if (value !== undefined && value >= MAX_UINT64) {
            // TODO: error msgs got raised to a error string handler first, now throws "generic" error
            throw new Error(`${key} cannot equal or exceed MAX_UINT64 (2^64-1), given ${value}`)
          }
        } else {
          if (value !== undefined && value > MAX_UINT64) {
            throw new Error(`${key} cannot exceed MAX_UINT64 (2^64-1), given ${value}`)
          }
        }
        break
      case 256:
        if (cannotEqual) {
          if (value !== undefined && value >= MAX_INTEGER) {
            throw new Error(`${key} cannot equal or exceed MAX_INTEGER (2^256-1), given ${value}`)
          }
        } else {
          if (value !== undefined && value > MAX_INTEGER) {
            throw new Error(`${key} cannot exceed MAX_INTEGER (2^256-1), given ${value}`)
          }
        }
        break
      default: {
        throw new Error('unimplemented bits value')
      }
    }
  }
}

type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

// This is (temp) a shared method which reflects `super` logic which were called from all txs and thus
// represents the constructor of baseTransaction
// Note: have to use `Mutable` to write to readonly props. Only call this in constructor of txs.
export function sharedConstructor(
  tx: Mutable<TransactionInterface>,
  txData: TxData[TransactionType],
  opts: TxOptions = {},
) {
  // LOAD base tx super({ ...txData, type: TransactionType.Legacy }, opts)
  tx.common = getCommon(opts.common)
  tx.common.updateParams(opts.params ?? paramsTx)

  validateNotArray(txData) // is this necessary?

  const { nonce, gasLimit, to, value, data, v, r, s } = txData

  tx.txOptions = opts // TODO: freeze?

  // Set the tx properties
  const toB = toBytes(to === '' ? '0x' : to)
  tx.to = toB.length > 0 ? new Address(toB) : undefined // TODO mark this explicitly as null if create-contract-tx?

  const vB = toBytes(v)
  const rB = toBytes(r)
  const sB = toBytes(s)

  tx.nonce = bytesToBigInt(toBytes(nonce))
  tx.gasLimit = bytesToBigInt(toBytes(gasLimit))
  tx.to = toB.length > 0 ? new Address(toB) : undefined
  tx.value = bytesToBigInt(toBytes(value))
  tx.data = toBytes(data === '' ? '0x' : data)

  // Set signature values (if the tx is signed)
  tx.v = vB.length > 0 ? bytesToBigInt(vB) : undefined
  tx.r = rB.length > 0 ? bytesToBigInt(rB) : undefined
  tx.s = sB.length > 0 ? bytesToBigInt(sB) : undefined

  // Start validating the data

  // Validate value/r/s
  valueBoundaryCheck({ value: tx.value, r: tx.r, s: tx.s })

  // https://eips.ethereum.org/EIPS/eip-4803
  valueBoundaryCheck({ gasLimit: tx.gasLimit }, 63, true)

  // EIP-2681 limits nonce to 2^64-1 (cannot equal 2^64-1)
  valueBoundaryCheck({ nonce: tx.nonce }, 64, true)

  const createContract = tx.to === undefined || tx.to === null
  const allowUnlimitedInitCodeSize = opts.allowUnlimitedInitCodeSize ?? false

  if (createContract && tx.common.isActivatedEIP(3860) && allowUnlimitedInitCodeSize === false) {
    checkMaxInitCodeSize(tx.common, tx.data.length)
  }
}

export function getBaseJSON(tx: TransactionInterface) {
  return {
    type: bigIntToHex(BigInt(tx.type)),
    nonce: bigIntToHex(tx.nonce),
    gasLimit: bigIntToHex(tx.gasLimit),
    to: tx.to !== undefined ? tx.to.toString() : undefined,
    value: bigIntToHex(tx.value),
    data: bytesToHex(tx.data),
    v: tx.v !== undefined ? bigIntToHex(tx.v) : undefined,
    r: tx.r !== undefined ? bigIntToHex(tx.r) : undefined,
    s: tx.s !== undefined ? bigIntToHex(tx.s) : undefined,
    chainId: bigIntToHex(tx.common.chainId()),
    yParity: tx.v === 0n || tx.v === 1n ? bigIntToHex(tx.v) : undefined,
  }
}
