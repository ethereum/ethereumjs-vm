import { RLP } from '@ethereumjs/rlp'
import { concatBytes } from 'ethereum-cryptography/utils'

import { bigIntToBytes, bigIntToHex, bytesToHex, hexToBigInt, hexToBytes } from './bytes.js'
import { BIGINT_0 } from './constants.js'

import type { PrefixedHexString } from './types.js'

export type RequestBytes = Uint8Array

export enum CLRequestType {
  Deposit = 0x00,
  Withdrawal = 0x01,
}

export type DepositRequestV1 = {
  pubkey: PrefixedHexString // DATA 48 bytes
  withdrawalCredentials: PrefixedHexString // DATA 32 bytes
  amount: PrefixedHexString // QUANTITY 8 bytes in gwei
  signature: PrefixedHexString // DATA 96 bytes
  index: PrefixedHexString // QUANTITY 8 bytes
}

export type WithdrawalRequestV1 = {
  sourceAddress: PrefixedHexString // DATA 20 bytes
  validatorPublicKey: PrefixedHexString // DATA 48 bytes
  amount: PrefixedHexString // QUANTITY 8 bytes in gwei
}

export interface RequestJSON {
  [CLRequestType.Deposit]: DepositRequestV1
  [CLRequestType.Withdrawal]: WithdrawalRequestV1
}

export type DepositRequestData = {
  pubkey: Uint8Array
  withdrawalCredentials: Uint8Array
  amount: bigint
  signature: Uint8Array
  index: bigint
}

export type WithdrawalRequestData = {
  sourceAddress: Uint8Array
  validatorPublicKey: Uint8Array
  amount: bigint
}

export interface RequestData {
  [CLRequestType.Deposit]: DepositRequestData
  [CLRequestType.Withdrawal]: WithdrawalRequestData
}

export type TypedRequestData = RequestData[CLRequestType]

export interface CLRequestInterface<T extends CLRequestType = CLRequestType> {
  readonly type: T
  serialize(): Uint8Array
  toJSON(): RequestJSON[T]
}

export abstract class CLRequest<T extends CLRequestType> implements CLRequestInterface<T> {
  readonly type: T
  abstract serialize(): Uint8Array
  abstract toJSON(): RequestJSON[T]
  constructor(type: T) {
    this.type = type
  }
}

export class DepositRequest extends CLRequest<CLRequestType.Deposit> {
  constructor(
    public readonly pubkey: Uint8Array,
    public readonly withdrawalCredentials: Uint8Array,
    public readonly amount: bigint,
    public readonly signature: Uint8Array,
    public readonly index: bigint
  ) {
    super(CLRequestType.Deposit)
  }

  public static fromRequestData(depositData: DepositRequestData): DepositRequest {
    const { pubkey, withdrawalCredentials, amount, signature, index } = depositData
    return new DepositRequest(pubkey, withdrawalCredentials, amount, signature, index)
  }

  public static fromJSON(jsonData: DepositRequestV1): DepositRequest {
    const { pubkey, withdrawalCredentials, amount, signature, index } = jsonData
    return this.fromRequestData({
      pubkey: hexToBytes(pubkey),
      withdrawalCredentials: hexToBytes(withdrawalCredentials),
      amount: hexToBigInt(amount),
      signature: hexToBytes(signature),
      index: hexToBigInt(index),
    })
  }

  serialize() {
    let indexBytes: Uint8Array

    if (this.index === BIGINT_0) {
      indexBytes = new Uint8Array()
    } else {
      indexBytes = bigIntToBytes(this.index)
    }

    let amountBytes: Uint8Array
    if (this.amount === BIGINT_0) {
      amountBytes = new Uint8Array()
    } else {
      amountBytes = bigIntToBytes(this.amount)
    }

    return concatBytes(
      Uint8Array.from([this.type]),
      RLP.encode([this.pubkey, this.withdrawalCredentials, amountBytes, this.signature, indexBytes])
    )
  }

  toJSON(): DepositRequestV1 {
    return {
      pubkey: bytesToHex(this.pubkey),
      withdrawalCredentials: bytesToHex(this.withdrawalCredentials),
      amount: bigIntToHex(this.amount),
      signature: bytesToHex(this.signature),
      index: bigIntToHex(this.index),
    }
  }

  public static deserialize(_bytes: Uint8Array): DepositRequest {
    throw Error('not implemented')
  }
}

export class WithdrawalRequest extends CLRequest<CLRequestType.Withdrawal> {
  constructor(
    public readonly sourceAddress: Uint8Array,
    public readonly validatorPublicKey: Uint8Array,
    public readonly amount: bigint
  ) {
    super(CLRequestType.Withdrawal)
  }

  public static fromRequestData(withdrawalData: WithdrawalRequestData): WithdrawalRequest {
    const { sourceAddress, validatorPublicKey, amount } = withdrawalData
    return new WithdrawalRequest(sourceAddress, validatorPublicKey, amount)
  }

  public static fromJSON(jsonData: WithdrawalRequestV1): WithdrawalRequest {
    const { sourceAddress, validatorPublicKey, amount } = jsonData
    return this.fromRequestData({
      sourceAddress: hexToBytes(sourceAddress),
      validatorPublicKey: hexToBytes(validatorPublicKey),
      amount: hexToBigInt(amount),
    })
  }

  serialize() {
    let amountBytes: Uint8Array
    if (this.amount === BIGINT_0) {
      amountBytes = new Uint8Array()
    } else {
      amountBytes = bigIntToBytes(this.amount)
    }

    return concatBytes(
      Uint8Array.from([this.type]),
      RLP.encode([this.sourceAddress, this.validatorPublicKey, amountBytes])
    )
  }

  toJSON(): WithdrawalRequestV1 {
    return {
      sourceAddress: bytesToHex(this.sourceAddress),
      validatorPublicKey: bytesToHex(this.validatorPublicKey),
      amount: bigIntToHex(this.amount),
    }
  }

  public static deserialize(_bytes: Uint8Array): WithdrawalRequest {
    throw Error('not implemented')
  }
}

export class CLRequestFactory {
  public static fromSerializedRequest(bytes: Uint8Array): CLRequest<CLRequestType> {
    switch (bytes[0]) {
      case CLRequestType.Deposit:
        return DepositRequest.deserialize(bytes)
      case CLRequestType.Withdrawal:
        return WithdrawalRequest.deserialize(bytes)
      default:
        throw Error(`Invalid request type=${bytes[0]}`)
    }
  }
}
