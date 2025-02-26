import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { secp256k1 } from 'ethereum-cryptography/secp256k1.js'

import {
  bytesToBigInt,
  bytesToHex,
  bytesToInt,
  concatBytes,
  setLengthLeft,
  toBytes,
  utf8ToBytes,
} from './bytes.js'
import {
  BIGINT_0,
  BIGINT_1,
  BIGINT_2,
  BIGINT_27,
  SECP256K1_ORDER,
  SECP256K1_ORDER_DIV_2,
} from './constants.js'
import { EthereumJSErrorWithoutCode } from './errors.js'
import { assertIsBytes } from './helpers.js'

import type { PrefixedHexString } from './types.js'

export interface ECDSASignature {
  v: bigint
  r: Uint8Array
  s: Uint8Array
}

export interface ECSignOpts {
  chainId?: bigint
  extraEntropy?: Uint8Array | boolean
}

/**
 * Returns the ECDSA signature of a message hash.
 *
 * If {@link ECSignOpts.chainId} is provided assume an EIP-155-style signature and calculate the `v` value
 * accordingly, otherwise return a "static" `v` just derived from the `recovery` bit
 *
 * {@link ECSignOpts.extraEntropy} defaults to `true`. This will create a "hedged signature" which is
 * non-deterministic and provides additional protections against private key extraction attack vectors,
 * as described in https://github.com/ethereumjs/ethereumjs-monorepo/issues/3801. It will yield a
 * different, random signature each time `ecsign` is called on the same `msgHash` and `privateKey`.
 * In particular: each time a transaction is signed, this will thus yield a different, random
 * transaction hash. If this is not desired, set `extraEntropy` to `false`.
 * Additionally, a `Uint8Array` can be passed to `extraEntropy` to provide custom entropy.
 * For more information, see: https://github.com/ethereumjs/ethereumjs-monorepo/issues/3801
 */
export function ecsign(
  msgHash: Uint8Array,
  privateKey: Uint8Array,
  ecSignOpts: { chainId?: bigint; extraEntropy?: Uint8Array | boolean } = { extraEntropy: true },
): ECDSASignature {
  const { chainId, extraEntropy } = ecSignOpts
  const sig = secp256k1.sign(msgHash, privateKey, { extraEntropy: extraEntropy ?? true })
  const buf = sig.toCompactRawBytes()
  const r = buf.slice(0, 32)
  const s = buf.slice(32, 64)

  if ([2, 3].includes(sig.recovery)) {
    // From the yellow paper:
    /* The recovery identifier is a 1 byte value specifying the parity and finiteness of the coordinates 
       of the curve point for which r is the x-value; this value is in the range of [0, 3], 
       however we declare the upper two possibilities, representing infinite values, invalid. */
    throw EthereumJSErrorWithoutCode(
      `Invalid recovery value: values 2/3 are invalid, received: ${sig.recovery}`,
    )
  }

  const v =
    chainId === undefined
      ? BigInt(sig.recovery! + 27)
      : BigInt(sig.recovery! + 35) + BigInt(chainId) * BIGINT_2

  return { r, s, v }
}

export function calculateSigRecovery(v: bigint, chainId?: bigint): bigint {
  if (v === BIGINT_0 || v === BIGINT_1) return v

  if (chainId === undefined) {
    return v - BIGINT_27
  }
  return v - (chainId * BIGINT_2 + BigInt(35))
}

function isValidSigRecovery(recovery: bigint): boolean {
  return recovery === BIGINT_0 || recovery === BIGINT_1
}

/**
 * ECDSA public key recovery from signature.
 * NOTE: Accepts `v === 0 | v === 1` for EIP1559 transactions
 * @returns Recovered public key
 */
export const ecrecover = function (
  msgHash: Uint8Array,
  v: bigint,
  r: Uint8Array,
  s: Uint8Array,
  chainId?: bigint,
): Uint8Array {
  const signature = concatBytes(setLengthLeft(r, 32), setLengthLeft(s, 32))
  const recovery = calculateSigRecovery(v, chainId)
  if (!isValidSigRecovery(recovery)) {
    throw EthereumJSErrorWithoutCode('Invalid signature v value')
  }

  const sig = secp256k1.Signature.fromCompact(signature).addRecoveryBit(Number(recovery))
  const senderPubKey = sig.recoverPublicKey(msgHash)
  return senderPubKey.toRawBytes(false).slice(1)
}

/**
 * Convert signature parameters into the format of `eth_sign` RPC method.
 * NOTE: Accepts `v === 0 | v === 1` for EIP1559 transactions
 * @returns Signature
 */
export const toRPCSig = function (
  v: bigint,
  r: Uint8Array,
  s: Uint8Array,
  chainId?: bigint,
): string {
  const recovery = calculateSigRecovery(v, chainId)
  if (!isValidSigRecovery(recovery)) {
    throw EthereumJSErrorWithoutCode('Invalid signature v value')
  }

  // geth (and the RPC eth_sign method) uses the 65 byte format used by Bitcoin

  return bytesToHex(concatBytes(setLengthLeft(r, 32), setLengthLeft(s, 32), toBytes(v)))
}

/**
 * Convert signature parameters into the format of Compact Signature Representation (EIP-2098).
 * NOTE: Accepts `v === 0 | v === 1` for EIP1559 transactions
 * @returns Signature
 */
export const toCompactSig = function (
  v: bigint,
  r: Uint8Array,
  s: Uint8Array,
  chainId?: bigint,
): string {
  const recovery = calculateSigRecovery(v, chainId)
  if (!isValidSigRecovery(recovery)) {
    throw EthereumJSErrorWithoutCode('Invalid signature v value')
  }

  const ss = Uint8Array.from([...s])
  if ((v > BigInt(28) && v % BIGINT_2 === BIGINT_1) || v === BIGINT_1 || v === BigInt(28)) {
    ss[0] |= 0x80
  }

  return bytesToHex(concatBytes(setLengthLeft(r, 32), setLengthLeft(ss, 32)))
}

/**
 * Convert signature format of the `eth_sign` RPC method to signature parameters
 *
 * NOTE: For an extracted `v` value < 27 (see Geth bug https://github.com/ethereum/go-ethereum/issues/2053)
 * `v + 27` is returned for the `v` value
 * NOTE: After EIP1559, `v` could be `0` or `1` but this function assumes
 * it's a signed message (EIP-191 or EIP-712) adding `27` at the end. Remove if needed.
 */
export const fromRPCSig = function (sig: PrefixedHexString): ECDSASignature {
  const bytes: Uint8Array = toBytes(sig)

  let r: Uint8Array
  let s: Uint8Array
  let v: bigint
  if (bytes.length >= 65) {
    r = bytes.subarray(0, 32)
    s = bytes.subarray(32, 64)
    v = bytesToBigInt(bytes.subarray(64))
  } else if (bytes.length === 64) {
    // Compact Signature Representation (https://eips.ethereum.org/EIPS/eip-2098)
    r = bytes.subarray(0, 32)
    s = bytes.subarray(32, 64)
    v = BigInt(bytesToInt(bytes.subarray(32, 33)) >> 7)
    s[0] &= 0x7f
  } else {
    throw EthereumJSErrorWithoutCode('Invalid signature length')
  }

  // support both versions of `eth_sign` responses
  if (v < 27) {
    v = v + BIGINT_27
  }

  return {
    v,
    r,
    s,
  }
}

/**
 * Validate a ECDSA signature.
 * NOTE: Accepts `v === 0 | v === 1` for EIP1559 transactions
 * @param homesteadOrLater Indicates whether this is being used on either the homestead hardfork or a later one
 */
export const isValidSignature = function (
  v: bigint,
  r: Uint8Array,
  s: Uint8Array,
  homesteadOrLater: boolean = true,
  chainId?: bigint,
): boolean {
  if (r.length !== 32 || s.length !== 32) {
    return false
  }

  if (!isValidSigRecovery(calculateSigRecovery(v, chainId))) {
    return false
  }

  const rBigInt = bytesToBigInt(r)
  const sBigInt = bytesToBigInt(s)

  if (
    rBigInt === BIGINT_0 ||
    rBigInt >= SECP256K1_ORDER ||
    sBigInt === BIGINT_0 ||
    sBigInt >= SECP256K1_ORDER
  ) {
    return false
  }

  if (homesteadOrLater && sBigInt >= SECP256K1_ORDER_DIV_2) {
    return false
  }

  return true
}

/**
 * Returns the keccak-256 hash of `message`, prefixed with the header used by the `eth_sign` RPC call.
 * The output of this function can be fed into `ecsign` to produce the same signature as the `eth_sign`
 * call for a given `message`, or fed to `ecrecover` along with a signature to recover the public key
 * used to produce the signature.
 */
export const hashPersonalMessage = function (message: Uint8Array): Uint8Array {
  assertIsBytes(message)
  const prefix = utf8ToBytes(`\u0019Ethereum Signed Message:\n${message.length}`)
  return keccak256(concatBytes(prefix, message))
}
