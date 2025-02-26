import { ConsensusAlgorithm } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  Address,
  BIGINT_0,
  BIGINT_27,
  EthereumJSErrorWithoutCode,
  bigIntToBytes,
  bytesToBigInt,
  concatBytes,
  createAddressFromPublicKey,
  createZeroAddress,
  ecrecover,
  ecsign,
  equalsBytes,
} from '@ethereumjs/util'

import type { BlockHeader } from '../index.js'
import type { CliqueConfig } from '@ethereumjs/common'

// Fixed number of extra-data prefix bytes reserved for signer vanity
export const CLIQUE_EXTRA_VANITY = 32
// Fixed number of extra-data suffix bytes reserved for signer seal
export const CLIQUE_EXTRA_SEAL = 65

// This function is not exported in the index file to keep it internal
export function requireClique(header: BlockHeader, name: string) {
  if (header.common.consensusAlgorithm() !== ConsensusAlgorithm.Clique) {
    const msg = header['_errorMsg'](
      `BlockHeader.${name}() call only supported for clique PoA networks`,
    )
    throw EthereumJSErrorWithoutCode(msg)
  }
}

/**
 * PoA clique signature hash without the seal.
 */
export function cliqueSigHash(header: BlockHeader) {
  requireClique(header, 'cliqueSigHash')
  const raw = header.raw()
  raw[12] = header.extraData.subarray(0, header.extraData.length - CLIQUE_EXTRA_SEAL)
  return header['keccakFunction'](RLP.encode(raw))
}

/**
 * Checks if the block header is an epoch transition
 * header (only clique PoA, throws otherwise)
 */
export function cliqueIsEpochTransition(header: BlockHeader): boolean {
  requireClique(header, 'cliqueIsEpochTransition')
  const epoch = BigInt((header.common.consensusConfig() as CliqueConfig).epoch)
  // Epoch transition block if the block number has no
  // remainder on the division by the epoch length
  return header.number % epoch === BIGINT_0
}

/**
 * Returns extra vanity data
 * (only clique PoA, throws otherwise)
 */
export function cliqueExtraVanity(header: BlockHeader): Uint8Array {
  requireClique(header, 'cliqueExtraVanity')
  return header.extraData.subarray(0, CLIQUE_EXTRA_VANITY)
}

/**
 * Returns extra seal data
 * (only clique PoA, throws otherwise)
 */
export function cliqueExtraSeal(header: BlockHeader): Uint8Array {
  requireClique(header, 'cliqueExtraSeal')
  return header.extraData.subarray(-CLIQUE_EXTRA_SEAL)
}

/**
 * Returns a list of signers
 * (only clique PoA, throws otherwise)
 *
 * This function throws if not called on an epoch
 * transition block and should therefore be used
 * in conjunction with {@link BlockHeader.cliqueIsEpochTransition}
 */
export function cliqueEpochTransitionSigners(header: BlockHeader): Address[] {
  requireClique(header, 'cliqueEpochTransitionSigners')
  if (!cliqueIsEpochTransition(header)) {
    const msg = header['_errorMsg']('Signers are only included in epoch transition blocks (clique)')
    throw EthereumJSErrorWithoutCode(msg)
  }

  const start = CLIQUE_EXTRA_VANITY
  const end = header.extraData.length - CLIQUE_EXTRA_SEAL
  const signerBytes = header.extraData.subarray(start, end)

  const signerList: Uint8Array[] = []
  const signerLength = 20
  for (let start = 0; start <= signerBytes.length - signerLength; start += signerLength) {
    signerList.push(signerBytes.subarray(start, start + signerLength))
  }
  return signerList.map((buf) => new Address(buf))
}

/**
 * Returns the signer address
 */
export function cliqueSigner(header: BlockHeader): Address {
  requireClique(header, 'cliqueSigner')
  const extraSeal = cliqueExtraSeal(header)
  // Reasonable default for default blocks
  if (extraSeal.length === 0 || equalsBytes(extraSeal, new Uint8Array(65))) {
    return createZeroAddress()
  }
  const r = extraSeal.subarray(0, 32)
  const s = extraSeal.subarray(32, 64)
  const v = bytesToBigInt(extraSeal.subarray(64, 65)) + BIGINT_27
  const pubKey = ecrecover(cliqueSigHash(header), v, r, s)
  return createAddressFromPublicKey(pubKey)
}

/**
 * Verifies the signature of the block (last 65 bytes of extraData field)
 * (only clique PoA, throws otherwise)
 *
 *  Method throws if signature is invalid
 */
export function cliqueVerifySignature(header: BlockHeader, signerList: Address[]): boolean {
  requireClique(header, 'cliqueVerifySignature')
  const signerAddress = cliqueSigner(header)
  const signerFound = signerList.find((signer) => {
    return signer.equals(signerAddress)
  })
  return !!signerFound
}

/**
 * Generates the extraData from a sealed block header
 * @param header block header from which to retrieve extraData
 * @param cliqueSigner clique signer key used for creating sealed block
 * @returns clique seal (i.e. extradata) for the block
 */
export function generateCliqueBlockExtraData(
  header: BlockHeader,
  cliqueSigner: Uint8Array,
): Uint8Array {
  // Ensure extraData is at least length CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL
  const minExtraDataLength = CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL
  if (header.extraData.length < minExtraDataLength) {
    const remainingLength = minExtraDataLength - header.extraData.length
    ;(header.extraData as any) = concatBytes(header.extraData, new Uint8Array(remainingLength))
  }

  requireClique(header, 'generateCliqueBlockExtraData')

  const ecSignFunction = header.common.customCrypto?.ecsign ?? ecsign
  const signature = ecSignFunction(cliqueSigHash(header), cliqueSigner)
  const signatureB = concatBytes(signature.r, signature.s, bigIntToBytes(signature.v - BIGINT_27))

  const extraDataWithoutSeal = header.extraData.subarray(
    0,
    header.extraData.length - CLIQUE_EXTRA_SEAL,
  )
  const extraData = concatBytes(extraDataWithoutSeal, signatureB)
  return extraData
}
