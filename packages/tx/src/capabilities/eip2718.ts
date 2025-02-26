import { RLP } from '@ethereumjs/rlp'
import { BIGINT_0, BIGINT_1, EthereumJSErrorWithoutCode, concatBytes } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { txTypeBytes } from '../util.js'

import { errorMsg } from './legacy.js'

import type { EIP2718CompatibleTx } from '../types.js'
import type { Input } from '@ethereumjs/rlp'

export function getHashedMessageToSign(tx: EIP2718CompatibleTx): Uint8Array {
  const keccakFunction = tx.common.customCrypto.keccak256 ?? keccak256
  return keccakFunction(tx.getMessageToSign())
}

export function serialize(tx: EIP2718CompatibleTx, base?: Input): Uint8Array {
  return concatBytes(txTypeBytes(tx.type), RLP.encode(base ?? tx.raw()))
}

export function validateYParity(tx: EIP2718CompatibleTx) {
  const { v } = tx
  if (v !== undefined && v !== BIGINT_0 && v !== BIGINT_1) {
    const msg = errorMsg(tx, 'The y-parity of the transaction should either be 0 or 1')
    throw EthereumJSErrorWithoutCode(msg)
  }
}
