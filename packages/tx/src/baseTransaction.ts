import { Common, Mainnet } from '@ethereumjs/common'
import {
  Address,
  BIGINT_0,
  MAX_INTEGER,
  MAX_UINT64,
  bigIntToHex,
  bytesToBigInt,
  bytesToHex,
  ecsign,
  publicToAddress,
  toBytes,
  unpadBytes,
} from '@ethereumjs/util'

import { paramsTx } from './params.js'
import { Capability, TransactionType } from './types.js'
import { checkMaxInitCodeSize } from './util.js'

import type {
  JSONTx,
  Transaction,
  TransactionCache,
  TransactionInterface,
  TxData,
  TxOptions,
  TxValuesArray,
} from './types.js'

/**
 * This base class will likely be subject to further
 * refactoring along the introduction of additional tx types
 * on the Ethereum network.
 *
 * It is therefore not recommended to use directly.
 */
export abstract class BaseTransaction<T extends TransactionType>
  implements TransactionInterface<T>
{
  protected readonly _type: TransactionType

  public readonly nonce: bigint
  public readonly gasLimit: bigint
  public readonly to?: Address
  public readonly value: bigint
  public readonly data: Uint8Array

  public readonly v?: bigint
  public readonly r?: bigint
  public readonly s?: bigint

  public readonly common!: Common

  public cache: TransactionCache = {
    hash: undefined,
    dataFee: undefined,
    senderPubKey: undefined,
  }

  protected readonly txOptions: TxOptions

  /**
   * List of tx type defining EIPs,
   * e.g. 1559 (fee market) and 2930 (access lists)
   * for FeeMarket1559Tx objects
   */
  protected activeCapabilities: number[] = []

  /**
   * The default chain the tx falls back to if no Common
   * is provided and if the chain can't be derived from
   * a passed in chainId (only EIP-2718 typed txs) or
   * EIP-155 signature (legacy txs).
   *
   * @hidden
   */
  protected DEFAULT_CHAIN = Mainnet

  constructor(txData: TxData[T], opts: TxOptions) {
    this.common = opts.common?.copy() ?? new Common({ chain: this.DEFAULT_CHAIN })

    const { nonce, gasLimit, to, value, data, v, r, s, type } = txData
    this._type = Number(bytesToBigInt(toBytes(type)))

    this.txOptions = opts

    const toB = toBytes(to === '' ? '0x' : to)
    const vB = toBytes(v)
    const rB = toBytes(r)
    const sB = toBytes(s)

    this.nonce = bytesToBigInt(toBytes(nonce))
    this.gasLimit = bytesToBigInt(toBytes(gasLimit))
    this.to = toB.length > 0 ? new Address(toB) : undefined
    this.value = bytesToBigInt(toBytes(value))
    this.data = toBytes(data === '' ? '0x' : data)

    this.v = vB.length > 0 ? bytesToBigInt(vB) : undefined
    this.r = rB.length > 0 ? bytesToBigInt(rB) : undefined
    this.s = sB.length > 0 ? bytesToBigInt(sB) : undefined

    this._validateCannotExceedMaxInteger({ value: this.value, r: this.r, s: this.s })

    // geth limits gasLimit to 2^64-1
    this._validateCannotExceedMaxInteger({ gasLimit: this.gasLimit }, 64)

    // EIP-2681 limits nonce to 2^64-1 (cannot equal 2^64-1)
    this._validateCannotExceedMaxInteger({ nonce: this.nonce }, 64, true)

    const createContract = this.to === undefined || this.to === null
    const allowUnlimitedInitCodeSize = opts.allowUnlimitedInitCodeSize ?? false

    this.common.updateParams(opts.params ?? paramsTx)
    if (
      createContract &&
      this.common.isActivatedEIP(3860) &&
      allowUnlimitedInitCodeSize === false
    ) {
      checkMaxInitCodeSize(this.common, this.data.length)
    }
  }

  /**
   * Returns the transaction type.
   *
   * Note: legacy txs will return tx type `0`.
   */
  get type() {
    return this._type
  }

  /**
   * Checks if a tx type defining capability is active
   * on a tx, for example the EIP-1559 fee market mechanism
   * or the EIP-2930 access list feature.
   *
   * Note that this is different from the tx type itself,
   * so EIP-2930 access lists can very well be active
   * on an EIP-1559 tx for example.
   *
   * This method can be useful for feature checks if the
   * tx type is unknown (e.g. when instantiated with
   * the tx factory).
   *
   * See `Capabilities` in the `types` module for a reference
   * on all supported capabilities.
   */
  supports(capability: Capability) {
    return this.activeCapabilities.includes(capability)
  }

  /**
   * Validates the transaction signature and minimum gas requirements.
   * @returns {string[]} an array of error strings
   */
  getValidationErrors(): string[] {
    const errors = []

    if (this.isSigned() && !this.verifySignature()) {
      errors.push('Invalid Signature')
    }

    if (this.getIntrinsicGas() > this.gasLimit) {
      errors.push(
        `gasLimit is too low. given ${this.gasLimit}, need at least ${this.getIntrinsicGas()}`,
      )
    }

    return errors
  }

  /**
   * Validates the transaction signature and minimum gas requirements.
   * @returns {boolean} true if the transaction is valid, false otherwise
   */
  isValid(): boolean {
    const errors = this.getValidationErrors()

    return errors.length === 0
  }

  /**
   * The minimum gas limit which the tx to have to be valid.
   * This covers costs as the standard fee (21000 gas), the data fee (paid for each calldata byte),
   * the optional creation fee (if the transaction creates a contract), and if relevant the gas
   * to be paid for access lists (EIP-2930) and authority lists (EIP-7702).
   */
  getIntrinsicGas(): bigint {
    const txFee = this.common.param('txGas')
    let fee = this.getDataGas()
    if (txFee) fee += txFee
    if (this.common.gteHardfork('homestead') && this.toCreationAddress()) {
      const txCreationFee = this.common.param('txCreationGas')
      if (txCreationFee) fee += txCreationFee
    }
    return fee
  }

  /**
   * The amount of gas paid for the calldata in this tx
   */
  getDataGas(): bigint {
    const txDataZero = this.common.param('txDataZeroGas')
    const txDataNonZero = this.common.param('txDataNonZeroGas')

    let cost = BIGINT_0
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] === 0 ? (cost += txDataZero) : (cost += txDataNonZero)
    }

    if ((this.to === undefined || this.to === null) && this.common.isActivatedEIP(3860)) {
      const dataLength = BigInt(Math.ceil(this.data.length / 32))
      const initCodeCost = this.common.param('initCodeWordGas') * dataLength
      cost += initCodeCost
    }

    return cost
  }

  /**
   * Returns the effective priority fee. This is the priority fee which the coinbase will receive
   * once it is included in the block
   * @param baseFee Optional baseFee of the block. Note for EIP1559 and EIP4844 this is required.
   */
  abstract getEffectivePriorityFee(baseFee: bigint | undefined): bigint

  /**
   * The upfront amount of wei to be paid in order for this tx to be valid and included in a block
   */
  abstract getUpfrontCost(): bigint

  /**
   * If the tx's `to` is to the creation address
   */
  toCreationAddress(): boolean {
    return this.to === undefined || this.to.bytes.length === 0
  }

  /**
   * Returns a Uint8Array Array of the raw Bytes of this transaction, in order.
   *
   * Use {@link BaseTransaction.serialize} to add a transaction to a block
   * with {@link createBlockFromBytesArray}.
   *
   * For an unsigned tx this method uses the empty Bytes values for the
   * signature parameters `v`, `r` and `s` for encoding. For an EIP-155 compliant
   * representation for external signing use {@link BaseTransaction.getMessageToSign}.
   */
  abstract raw(): TxValuesArray[T]

  /**
   * Returns the encoding of the transaction.
   */
  abstract serialize(): Uint8Array

  // Returns the raw unsigned tx, which is used to sign the transaction.
  abstract getMessageToSign(): Uint8Array | Uint8Array[]

  // Returns the hashed unsigned tx, which is used to sign the transaction.
  abstract getHashedMessageToSign(): Uint8Array

  abstract hash(): Uint8Array

  abstract getMessageToVerifySignature(): Uint8Array

  public isSigned(): boolean {
    const { v, r, s } = this
    if (v === undefined || r === undefined || s === undefined) {
      return false
    } else {
      return true
    }
  }

  /**
   * Determines if the signature is valid
   */
  verifySignature(): boolean {
    try {
      // Main signature verification is done in `getSenderPublicKey()`
      const publicKey = this.getSenderPublicKey()
      return unpadBytes(publicKey).length !== 0
    } catch {
      return false
    }
  }

  /**
   * Returns the sender's address
   */
  getSenderAddress(): Address {
    return new Address(publicToAddress(this.getSenderPublicKey()))
  }

  /**
   * Returns the public key of the sender
   */
  abstract getSenderPublicKey(): Uint8Array

  /**
   * Signs a transaction.
   *
   * Note that the signed tx is returned as a new object,
   * use as follows:
   * ```javascript
   * const signedTx = tx.sign(privateKey)
   * ```
   */
  sign(privateKey: Uint8Array): Transaction[T] {
    if (privateKey.length !== 32) {
      const msg = this._errorMsg('Private key must be 32 bytes in length.')
      throw new Error(msg)
    }

    // Hack for the constellation that we have got a legacy tx after spuriousDragon with a non-EIP155 conforming signature
    // and want to recreate a signature (where EIP155 should be applied)
    // Leaving this hack lets the legacy.spec.ts -> sign(), verifySignature() test fail
    // 2021-06-23
    let hackApplied = false
    if (
      this.type === TransactionType.Legacy &&
      this.common.gteHardfork('spuriousDragon') &&
      !this.supports(Capability.EIP155ReplayProtection)
    ) {
      this.activeCapabilities.push(Capability.EIP155ReplayProtection)
      hackApplied = true
    }

    const msgHash = this.getHashedMessageToSign()
    const ecSignFunction = this.common.customCrypto?.ecsign ?? ecsign
    const { v, r, s } = ecSignFunction(msgHash, privateKey)
    const tx = this.addSignature(v, r, s, true)

    // Hack part 2
    if (hackApplied) {
      const index = this.activeCapabilities.indexOf(Capability.EIP155ReplayProtection)
      if (index > -1) {
        this.activeCapabilities.splice(index, 1)
      }
    }

    return tx
  }

  /**
   * Returns an object with the JSON representation of the transaction
   */
  toJSON(): JSONTx {
    return {
      type: bigIntToHex(BigInt(this.type)),
      nonce: bigIntToHex(this.nonce),
      gasLimit: bigIntToHex(this.gasLimit),
      to: this.to !== undefined ? this.to.toString() : undefined,
      value: bigIntToHex(this.value),
      data: bytesToHex(this.data),
      v: this.v !== undefined ? bigIntToHex(this.v) : undefined,
      r: this.r !== undefined ? bigIntToHex(this.r) : undefined,
      s: this.s !== undefined ? bigIntToHex(this.s) : undefined,
      chainId: bigIntToHex(this.common.chainId()),
      yParity: this.v === 0n || this.v === 1n ? bigIntToHex(this.v) : undefined,
    }
  }

  /**
   * Returns a new transaction with the same data fields as the current, but now signed
   * @param v The `v` value of the signature
   * @param r The `r` value of the signature
   * @param s The `s` value of the signature
   * @param convertV Set this to `true` if the raw output of `ecsign` is used. If this is `false` (default)
   *                 then the raw value passed for `v` will be used for the signature. For legacy transactions,
   *                 if this is set to `true`, it will also set the right `v` value for the chain id.
   */
  abstract addSignature(
    v: bigint,
    r: Uint8Array | bigint,
    s: Uint8Array | bigint,
    convertV?: boolean,
  ): Transaction[T]

  /**
   * Validates that an object with BigInt values cannot exceed the specified bit limit.
   * @param values Object containing string keys and BigInt values
   * @param bits Number of bits to check (64 or 256)
   * @param cannotEqual Pass true if the number also cannot equal one less the maximum value
   */
  protected _validateCannotExceedMaxInteger(
    values: { [key: string]: bigint | undefined },
    bits = 256,
    cannotEqual = false,
  ) {
    for (const [key, value] of Object.entries(values)) {
      switch (bits) {
        case 64:
          if (cannotEqual) {
            if (value !== undefined && value >= MAX_UINT64) {
              const msg = this._errorMsg(
                `${key} cannot equal or exceed MAX_UINT64 (2^64-1), given ${value}`,
              )
              throw new Error(msg)
            }
          } else {
            if (value !== undefined && value > MAX_UINT64) {
              const msg = this._errorMsg(`${key} cannot exceed MAX_UINT64 (2^64-1), given ${value}`)
              throw new Error(msg)
            }
          }
          break
        case 256:
          if (cannotEqual) {
            if (value !== undefined && value >= MAX_INTEGER) {
              const msg = this._errorMsg(
                `${key} cannot equal or exceed MAX_INTEGER (2^256-1), given ${value}`,
              )
              throw new Error(msg)
            }
          } else {
            if (value !== undefined && value > MAX_INTEGER) {
              const msg = this._errorMsg(
                `${key} cannot exceed MAX_INTEGER (2^256-1), given ${value}`,
              )
              throw new Error(msg)
            }
          }
          break
        default: {
          const msg = this._errorMsg('unimplemented bits value')
          throw new Error(msg)
        }
      }
    }
  }

  /**
   * Return a compact error string representation of the object
   */
  public abstract errorStr(): string

  /**
   * Internal helper function to create an annotated error message
   *
   * @param msg Base error message
   * @hidden
   */
  protected abstract _errorMsg(msg: string): string

  /**
   * Returns the shared error postfix part for _error() method
   * tx type implementations.
   */
  protected _getSharedErrorPostfix() {
    let hash = ''
    try {
      hash = this.isSigned() ? bytesToHex(this.hash()) : 'not available (unsigned)'
    } catch {
      hash = 'error'
    }
    let isSigned = ''
    try {
      isSigned = this.isSigned().toString()
    } catch {
      hash = 'error'
    }
    let hf = ''
    try {
      hf = this.common.hardfork()
    } catch {
      hf = 'error'
    }

    let postfix = `tx type=${this.type} hash=${hash} nonce=${this.nonce} value=${this.value} `
    postfix += `signed=${isSigned} hf=${hf}`

    return postfix
  }
}
