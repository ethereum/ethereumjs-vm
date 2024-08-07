import { CliqueConfig, ConsensusAlgorithm } from '@ethereumjs/common'
import { BlockHeader } from '../index.js'
import { RLP } from '@ethereumjs/rlp'
import { BIGINT_0 } from '@ethereumjs/util'
import { Address } from '@ethereumjs/util'

// Fixed number of extra-data prefix bytes reserved for signer vanity
export const CLIQUE_EXTRA_VANITY = 32
// Fixed number of extra-data suffix bytes reserved for signer seal
export const CLIQUE_EXTRA_SEAL = 65

// This function is not exported in the index file to keep it internal
export function _requireClique(header: BlockHeader, name: string) {
  if (header.common.consensusAlgorithm() !== ConsensusAlgorithm.Clique) {
    const msg = header['_errorMsg'](
      `BlockHeader.${name}() call only supported for clique PoA networks`,
    )
    throw new Error(msg)
  }
}

/**
 * PoA clique signature hash without the seal.
 */
export function cliqueSigHash(header: BlockHeader) {
  _requireClique(header, 'cliqueSigHash')
  const raw = header.raw()
  raw[12] = header.extraData.subarray(0, header.extraData.length - CLIQUE_EXTRA_SEAL)
  return header['keccakFunction'](RLP.encode(raw))
}

/**
 * Checks if the block header is an epoch transition
 * header (only clique PoA, throws otherwise)
 */
export function cliqueIsEpochTransition(header: BlockHeader): boolean {
  _requireClique(header, 'cliqueIsEpochTransition')
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
  _requireClique(header, 'cliqueExtraVanity')
  return header.extraData.subarray(0, CLIQUE_EXTRA_VANITY)
}

/**
 * Returns extra seal data
 * (only clique PoA, throws otherwise)
 */
export function cliqueExtraSeal(header: BlockHeader): Uint8Array {
  _requireClique(header, 'cliqueExtraSeal')
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
  _requireClique(header, 'cliqueEpochTransitionSigners')
  if (!cliqueIsEpochTransition(header)) {
    const msg = header['_errorMsg']('Signers are only included in epoch transition blocks (clique)')
    throw new Error(msg)
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
