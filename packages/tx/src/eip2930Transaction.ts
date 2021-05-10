import { BN, bnToHex, bnToRlp, ecrecover, keccak256, rlp, toBuffer } from 'ethereumjs-util'
import { BaseTransaction } from './baseTransaction'
import {
  AccessList,
  AccessListBuffer,
  AccessListEIP2930TxData,
  AccessListEIP2930ValuesArray,
  JsonTx,
  TxOptions,
  N_DIV_2,
} from './types'

import { AccessLists } from './util'

const TRANSACTION_TYPE = 1
const TRANSACTION_TYPE_BUFFER = Buffer.from(TRANSACTION_TYPE.toString(16).padStart(2, '0'), 'hex')

/**
 * Typed transaction with optional access lists
 *
 * - TransactionType: 1
 * - EIP: [EIP-2930](https://eips.ethereum.org/EIPS/eip-2930)
 */
export default class AccessListEIP2930Transaction extends BaseTransaction<AccessListEIP2930Transaction> {
  public readonly chainId: BN
  public readonly accessList: AccessListBuffer
  public readonly AccessListJSON: AccessList
  public readonly gasPrice: BN

  /**
   * EIP-2930 alias for `r`
   */
  get senderR() {
    return this.r
  }

  /**
   * EIP-2930 alias for `s`
   */
  get senderS() {
    return this.s
  }

  /**
   * EIP-2930 alias for `v`
   */
  get yParity() {
    return this.v
  }

  /**
   * Instantiate a transaction from a data dictionary
   */
  public static fromTxData(txData: AccessListEIP2930TxData, opts: TxOptions = {}) {
    return new AccessListEIP2930Transaction(txData, opts)
  }

  /**
   * Instantiate a transaction from the serialized tx.
   *
   * Note: this means that the Buffer should start with 0x01.
   */
  public static fromSerializedTx(serialized: Buffer, opts: TxOptions = {}) {
    if (!serialized.slice(0, 1).equals(TRANSACTION_TYPE_BUFFER)) {
      throw new Error(
        `Invalid serialized tx input: not an EIP-2930 transaction (wrong tx type, expected: ${TRANSACTION_TYPE}, received: ${serialized
          .slice(0, 1)
          .toString('hex')}`
      )
    }

    const values = rlp.decode(serialized.slice(1))

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized tx input: must be array')
    }

    return AccessListEIP2930Transaction.fromValuesArray(values as any, opts)
  }

  /**
   * Instantiate a transaction from the serialized tx.
   * (alias of `fromSerializedTx()`)
   *
   * Note: This means that the Buffer should start with 0x01.
   *
   * @deprecated this constructor alias is deprecated and will be removed
   * in favor of the `fromSerializedTx()` constructor
   */
  public static fromRlpSerializedTx(serialized: Buffer, opts: TxOptions = {}) {
    return AccessListEIP2930Transaction.fromSerializedTx(serialized, opts)
  }

  /**
   * Create a transaction from a values array.
   *
   * The format is:
   * chainId, nonce, gasPrice, gasLimit, to, value, data, access_list, yParity (v), senderR (r), senderS (s)
   */
  public static fromValuesArray(values: AccessListEIP2930ValuesArray, opts: TxOptions = {}) {
    if (values.length !== 8 && values.length !== 11) {
      throw new Error(
        'Invalid EIP-2930 transaction. Only expecting 8 values (for unsigned tx) or 11 values (for signed tx).'
      )
    }

    const [chainId, nonce, gasPrice, gasLimit, to, value, data, accessList, v, r, s] = values

    const emptyAccessList: AccessList = []

    return new AccessListEIP2930Transaction(
      {
        chainId: new BN(chainId),
        nonce,
        gasPrice,
        gasLimit,
        to,
        value,
        data,
        accessList: accessList ?? emptyAccessList,
        v: v !== undefined ? new BN(v) : undefined, // EIP2930 supports v's with value 0 (empty Buffer)
        r,
        s,
      },
      opts
    )
  }

  /**
   * This constructor takes the values, validates them, assigns them and freezes the object.
   *
   * It is not recommended to use this constructor directly. Instead use
   * the static factory methods to assist in creating a Transaction object from
   * varying data types.
   */
  public constructor(txData: AccessListEIP2930TxData, opts: TxOptions = {}) {
    const { chainId, accessList, gasPrice } = txData

    super({ ...txData, type: TRANSACTION_TYPE }, opts)

    // EIP-2718 check is done in Common
    if (!this.common.isActivatedEIP(2930)) {
      throw new Error('EIP-2930 not enabled on Common')
    }

    // Populate the access list fields
    const accessListData = AccessLists.getAccessListData(accessList ?? [])
    this.accessList = accessListData.accessList
    this.AccessListJSON = accessListData.AccessListJSON
    // Verify the access list format.
    AccessLists.verifyAccessList(this.accessList)

    this.chainId = chainId ? new BN(toBuffer(chainId)) : this.common.chainIdBN()
    this.gasPrice = new BN(toBuffer(gasPrice === '' ? '0x' : gasPrice))

    this._validateCannotExceedMaxInteger({ gasPrice: this.gasPrice })

    if (!this.chainId.eq(this.common.chainIdBN())) {
      throw new Error('The chain ID does not match the chain ID of Common')
    }

    if (this.v && !this.v.eqn(0) && !this.v.eqn(1)) {
      throw new Error('The y-parity of the transaction should either be 0 or 1')
    }

    if (this.common.gteHardfork('homestead') && this.s?.gt(N_DIV_2)) {
      throw new Error(
        'Invalid Signature: s-values greater than secp256k1n/2 are considered invalid'
      )
    }

    const freeze = opts?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
  }

  /**
   * The amount of gas paid for the data in this tx
   */
  getDataFee(): BN {
    const cost = super.getDataFee()
    cost.iaddn(AccessLists.getDataFeeEIP2930(this.accessList, this.common))
    return cost
  }

  /**
   * The up front amount that an account must have for this transaction to be valid
   * @param baseFee If present, return the upfront cost if the transaction is in an EIP1559 block
   */
  getUpfrontCost(baseFee?: BN): BN {
    if (baseFee) {
      const inclusionFeePerGas = BN.min(this.gasPrice, this.gasPrice.sub(baseFee!))
      const gasPrice = inclusionFeePerGas.add(baseFee!)
      return this.gasLimit.mul(gasPrice).add(this.value)
    } else {
      return this.gasLimit.mul(this.gasPrice).add(this.value)
    }
  }

  /**
   * Returns a Buffer Array of the raw Buffers of this transaction, in order.
   *
   * Use `serialize()` to add to block data for `Block.fromValuesArray()`.
   */
  raw(): AccessListEIP2930ValuesArray {
    return [
      bnToRlp(this.chainId),
      bnToRlp(this.nonce),
      bnToRlp(this.gasPrice),
      bnToRlp(this.gasLimit),
      this.to !== undefined ? this.to.buf : Buffer.from([]),
      bnToRlp(this.value),
      this.data,
      this.accessList,
      this.v !== undefined ? bnToRlp(this.v) : Buffer.from([]),
      this.r !== undefined ? bnToRlp(this.r) : Buffer.from([]),
      this.s !== undefined ? bnToRlp(this.s) : Buffer.from([]),
    ]
  }

  /**
   * Returns the serialized encoding of the transaction.
   */
  serialize(): Buffer {
    const base = this.raw()
    return Buffer.concat([TRANSACTION_TYPE_BUFFER, rlp.encode(base as any)])
  }

  /**
   * Returns the serialized unsigned tx (hashed or raw), which is used to sign the transaction.
   *
   * @param hashMessage - Return hashed message if set to true (default: true)
   */
  getMessageToSign(hashMessage: false): Buffer[]
  getMessageToSign(hashMessage?: true): Buffer
  getMessageToSign(hashMessage = true): Buffer | Buffer[] {
    const base = this.raw().slice(0, 8)
    const message = Buffer.concat([TRANSACTION_TYPE_BUFFER, rlp.encode(base as any)])
    if (hashMessage) {
      return keccak256(message)
    } else {
      return message
    }
  }

  /**
   * Computes a sha3-256 hash of the serialized tx
   */
  public hash(): Buffer {
    if (!this.isSigned()) {
      throw new Error('Cannot call hash method if transaction is not signed')
    }

    return keccak256(this.serialize())
  }

  /**
   * Computes a sha3-256 hash which can be used to verify the signature
   */
  public getMessageToVerifySignature(): Buffer {
    return this.getMessageToSign()
  }

  /**
   * Returns the public key of the sender
   */
  public getSenderPublicKey(): Buffer {
    if (!this.isSigned()) {
      throw new Error('Cannot call this method if transaction is not signed')
    }

    const msgHash = this.getMessageToVerifySignature()

    // All transaction signatures whose s-value is greater than secp256k1n/2 are considered invalid.
    // TODO: verify if this is the case for EIP-2930
    if (this.common.gteHardfork('homestead') && this.s?.gt(N_DIV_2)) {
      throw new Error(
        'Invalid Signature: s-values greater than secp256k1n/2 are considered invalid'
      )
    }

    const { yParity, r, s } = this
    if (yParity === undefined || !r || !s) {
      throw new Error('Missing values to derive sender public key from signed tx')
    }

    try {
      return ecrecover(
        msgHash,
        yParity.addn(27), // Recover the 27 which was stripped from ecsign
        bnToRlp(r),
        bnToRlp(s)
      )
    } catch (e) {
      throw new Error('Invalid Signature')
    }
  }

  _processSignature(v: number, r: Buffer, s: Buffer) {
    const opts = {
      common: this.common,
    }

    return AccessListEIP2930Transaction.fromTxData(
      {
        chainId: this.chainId,
        nonce: this.nonce,
        gasPrice: this.gasPrice,
        gasLimit: this.gasLimit,
        to: this.to,
        value: this.value,
        data: this.data,
        accessList: this.accessList,
        v: new BN(v - 27), // This looks extremely hacky: ethereumjs-util actually adds 27 to the value, the recovery bit is either 0 or 1.
        r: new BN(r),
        s: new BN(s),
      },
      opts
    )
  }

  /**
   * Returns an object with the JSON representation of the transaction
   */
  toJSON(): JsonTx {
    const accessListJSON = AccessLists.getAccessListJSON(this.accessList)

    return {
      chainId: bnToHex(this.chainId),
      nonce: bnToHex(this.nonce),
      gasPrice: bnToHex(this.gasPrice),
      gasLimit: bnToHex(this.gasLimit),
      to: this.to !== undefined ? this.to.toString() : undefined,
      value: bnToHex(this.value),
      data: '0x' + this.data.toString('hex'),
      accessList: accessListJSON,
      v: this.v !== undefined ? bnToHex(this.v) : undefined,
      r: this.r !== undefined ? bnToHex(this.r) : undefined,
      s: this.s !== undefined ? bnToHex(this.s) : undefined,
    }
  }
}
