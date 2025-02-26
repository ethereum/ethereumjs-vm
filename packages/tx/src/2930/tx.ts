import {
  BIGINT_27,
  EthereumJSErrorWithoutCode,
  MAX_INTEGER,
  bigIntToHex,
  bigIntToUnpaddedBytes,
  bytesToBigInt,
  toBytes,
} from '@ethereumjs/util'

import * as EIP2718 from '../capabilities/eip2718.js'
import * as EIP2930 from '../capabilities/eip2930.js'
import * as Legacy from '../capabilities/legacy.js'
import { getBaseJSON, sharedConstructor, valueBoundaryCheck } from '../features/util.js'
import { TransactionType } from '../types.js'
import { AccessLists } from '../util.js'

import { createAccessList2930Tx } from './constructors.js'

import type {
  AccessList,
  AccessListBytes,
  TxData as AllTypesTxData,
  TxValuesArray as AllTypesTxValuesArray,
  Capability,
  JSONTx,
  TransactionCache,
  TransactionInterface,
  TxOptions,
} from '../types.js'
import type { Common } from '@ethereumjs/common'
import type { Address } from '@ethereumjs/util'

export type TxData = AllTypesTxData[TransactionType.AccessListEIP2930]
export type TxValuesArray = AllTypesTxValuesArray[TransactionType.AccessListEIP2930]

/**
 * Typed transaction with optional access lists
 *
 * - TransactionType: 1
 * - EIP: [EIP-2930](https://eips.ethereum.org/EIPS/eip-2930)
 */
export class AccessList2930Tx implements TransactionInterface<TransactionType.AccessListEIP2930> {
  public type: number = TransactionType.AccessListEIP2930 // 2930 tx type

  // Tx data part (part of the RLP)
  public readonly gasPrice: bigint
  public readonly nonce!: bigint
  public readonly gasLimit!: bigint
  public readonly value!: bigint
  public readonly data!: Uint8Array
  public readonly to?: Address
  public readonly accessList: AccessListBytes
  public readonly chainId: bigint

  // Props only for signed txs
  public readonly v?: bigint
  public readonly r?: bigint
  public readonly s?: bigint

  // End of Tx data part

  public readonly AccessListJSON: AccessList

  public readonly common!: Common

  readonly txOptions!: TxOptions

  readonly cache: TransactionCache = {}

  /**
   * List of tx type defining EIPs,
   * e.g. 1559 (fee market) and 2930 (access lists)
   * for FeeMarket1559Tx objects
   */
  protected activeCapabilities: number[] = []

  /**
   * This constructor takes the values, validates them, assigns them and freezes the object.
   *
   * It is not recommended to use this constructor directly. Instead use
   * the static factory methods to assist in creating a Transaction object from
   * varying data types.
   */
  public constructor(txData: TxData, opts: TxOptions = {}) {
    sharedConstructor(this, { ...txData, type: TransactionType.AccessListEIP2930 }, opts)
    const { chainId, accessList, gasPrice } = txData

    if (chainId !== undefined && bytesToBigInt(toBytes(chainId)) !== this.common.chainId()) {
      throw EthereumJSErrorWithoutCode(
        `Common chain ID ${this.common.chainId} not matching the derived chain ID ${chainId}`,
      )
    }
    this.chainId = this.common.chainId()

    // EIP-2718 check is done in Common
    if (!this.common.isActivatedEIP(2930)) {
      throw EthereumJSErrorWithoutCode('EIP-2930 not enabled on Common')
    }
    this.activeCapabilities = this.activeCapabilities.concat([2718, 2930])

    // Populate the access list fields
    const accessListData = AccessLists.getAccessListData(accessList ?? [])
    this.accessList = accessListData.accessList
    this.AccessListJSON = accessListData.AccessListJSON
    // Verify the access list format.
    AccessLists.verifyAccessList(this.accessList)

    this.gasPrice = bytesToBigInt(toBytes(gasPrice))

    valueBoundaryCheck({ gasPrice: this.gasPrice })

    if (this.gasPrice * this.gasLimit > MAX_INTEGER) {
      const msg = Legacy.errorMsg(this, 'gasLimit * gasPrice cannot exceed MAX_INTEGER')
      throw EthereumJSErrorWithoutCode(msg)
    }

    EIP2718.validateYParity(this)
    Legacy.validateHighS(this)

    const freeze = opts?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
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

  getEffectivePriorityFee(baseFee?: bigint): bigint {
    return Legacy.getEffectivePriorityFee(this.gasPrice, baseFee)
  }

  /**
   * The amount of gas paid for the data in this tx
   */
  getDataGas(): bigint {
    return EIP2930.getDataGas(this)
  }

  /**
   * The up front amount that an account must have for this transaction to be valid
   */
  getUpfrontCost(): bigint {
    return this.gasLimit * this.gasPrice + this.value
  }

  /**
   * The minimum gas limit which the tx to have to be valid.
   * This covers costs as the standard fee (21000 gas), the data fee (paid for each calldata byte),
   * the optional creation fee (if the transaction creates a contract), and if relevant the gas
   * to be paid for access lists (EIP-2930) and authority lists (EIP-7702).
   */
  getIntrinsicGas(): bigint {
    return Legacy.getIntrinsicGas(this)
  }

  // TODO figure out if this is necessary
  /**
   * If the tx's `to` is to the creation address
   */
  toCreationAddress(): boolean {
    return Legacy.toCreationAddress(this)
  }

  /**
   * Returns a Uint8Array Array of the raw Bytes of the EIP-2930 transaction, in order.
   *
   * Format: `[chainId, nonce, gasPrice, gasLimit, to, value, data, accessList,
   * signatureYParity (v), signatureR (r), signatureS (s)]`
   *
   * Use {@link AccessList2930Tx.serialize} to add a transaction to a block
   * with {@link createBlockFromBytesArray}.
   *
   * For an unsigned tx this method uses the empty Bytes values for the
   * signature parameters `v`, `r` and `s` for encoding. For an EIP-155 compliant
   * representation for external signing use {@link AccessList2930Tx.getMessageToSign}.
   */
  raw(): TxValuesArray {
    return [
      bigIntToUnpaddedBytes(this.chainId),
      bigIntToUnpaddedBytes(this.nonce),
      bigIntToUnpaddedBytes(this.gasPrice),
      bigIntToUnpaddedBytes(this.gasLimit),
      this.to !== undefined ? this.to.bytes : new Uint8Array(0),
      bigIntToUnpaddedBytes(this.value),
      this.data,
      this.accessList,
      this.v !== undefined ? bigIntToUnpaddedBytes(this.v) : new Uint8Array(0),
      this.r !== undefined ? bigIntToUnpaddedBytes(this.r) : new Uint8Array(0),
      this.s !== undefined ? bigIntToUnpaddedBytes(this.s) : new Uint8Array(0),
    ]
  }

  /**
   * Returns the serialized encoding of the EIP-2930 transaction.
   *
   * Format: `0x01 || rlp([chainId, nonce, gasPrice, gasLimit, to, value, data, accessList,
   * signatureYParity (v), signatureR (r), signatureS (s)])`
   *
   * Note that in contrast to the legacy tx serialization format this is not
   * valid RLP any more due to the raw tx type preceding and concatenated to
   * the RLP encoding of the values.
   */
  serialize(): Uint8Array {
    return EIP2718.serialize(this)
  }

  /**
   * Returns the raw serialized unsigned tx, which can be used
   * to sign the transaction (e.g. for sending to a hardware wallet).
   *
   * Note: in contrast to the legacy tx the raw message format is already
   * serialized and doesn't need to be RLP encoded any more.
   *
   * ```javascript
   * const serializedMessage = tx.getMessageToSign() // use this for the HW wallet input
   * ```
   */
  getMessageToSign(): Uint8Array {
    return EIP2718.serialize(this, this.raw().slice(0, 8))
  }

  /**
   * Returns the hashed serialized unsigned tx, which can be used
   * to sign the transaction (e.g. for sending to a hardware wallet).
   *
   * Note: in contrast to the legacy tx the raw message format is already
   * serialized and doesn't need to be RLP encoded any more.
   */
  getHashedMessageToSign(): Uint8Array {
    return EIP2718.getHashedMessageToSign(this)
  }

  /**
   * Computes a sha3-256 hash of the serialized tx.
   *
   * This method can only be used for signed txs (it throws otherwise).
   * Use {@link Transaction.getMessageToSign} to get a tx hash for the purpose of signing.
   */
  hash(): Uint8Array {
    return Legacy.hash(this)
  }

  /**
   * Computes a sha3-256 hash which can be used to verify the signature
   */
  public getMessageToVerifySignature(): Uint8Array {
    return this.getHashedMessageToSign()
  }

  /**
   * Returns the public key of the sender
   */
  public getSenderPublicKey(): Uint8Array {
    return Legacy.getSenderPublicKey(this)
  }

  addSignature(
    v: bigint,
    r: Uint8Array | bigint,
    s: Uint8Array | bigint,
    convertV: boolean = false,
  ): AccessList2930Tx {
    r = toBytes(r)
    s = toBytes(s)
    const opts = { ...this.txOptions, common: this.common }

    return createAccessList2930Tx(
      {
        chainId: this.chainId,
        nonce: this.nonce,
        gasPrice: this.gasPrice,
        gasLimit: this.gasLimit,
        to: this.to,
        value: this.value,
        data: this.data,
        accessList: this.accessList,
        v: convertV ? v - BIGINT_27 : v, // This looks extremely hacky: @ethereumjs/util actually adds 27 to the value, the recovery bit is either 0 or 1.
        r: bytesToBigInt(r),
        s: bytesToBigInt(s),
      },
      opts,
    )
  }

  /**
   * Returns an object with the JSON representation of the transaction
   */
  toJSON(): JSONTx {
    const accessListJSON = AccessLists.getAccessListJSON(this.accessList)
    const baseJSON = getBaseJSON(this)

    return {
      ...baseJSON,
      chainId: bigIntToHex(this.chainId),
      gasPrice: bigIntToHex(this.gasPrice),
      accessList: accessListJSON,
    }
  }

  getValidationErrors(): string[] {
    return Legacy.getValidationErrors(this)
  }

  isValid(): boolean {
    return Legacy.isValid(this)
  }

  verifySignature(): boolean {
    return Legacy.verifySignature(this)
  }

  getSenderAddress(): Address {
    return Legacy.getSenderAddress(this)
  }

  sign(privateKey: Uint8Array, extraEntropy: Uint8Array | boolean = true): AccessList2930Tx {
    return <AccessList2930Tx>Legacy.sign(this, privateKey, extraEntropy)
  }

  isSigned(): boolean {
    return Legacy.isSigned(this)
  }

  /**
   * Return a compact error string representation of the object
   */
  public errorStr() {
    let errorStr = Legacy.getSharedErrorPostfix(this)
    // Keep ? for this.accessList since this otherwise causes Hardhat E2E tests to fail
    errorStr += ` gasPrice=${this.gasPrice} accessListCount=${this.accessList?.length ?? 0}`
    return errorStr
  }
}
