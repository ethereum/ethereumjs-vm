import { EthereumJSErrorWithoutCode, verifyVerkleProof } from '@ethereumjs/util'

import type { Proof } from '../index.js'
import type { StatelessVerkleStateManager } from '../statelessVerkleStateManager.js'
import type { Address } from '@ethereumjs/util'

export function getVerkleStateProof(
  sm: StatelessVerkleStateManager,
  _: Address,
  __: Uint8Array[] = [],
): Promise<Proof> {
  throw EthereumJSErrorWithoutCode('Not implemented yet')
}
/**
 * Verifies whether the execution witness matches the stateRoot
 * @param {Uint8Array} stateRoot - The stateRoot to verify the executionWitness against
 * @returns {boolean} - Returns true if the executionWitness matches the provided stateRoot, otherwise false
 */
export function verifyVerkleStateProof(sm: StatelessVerkleStateManager): boolean {
  if (sm['_executionWitness'] === undefined) {
    sm['DEBUG'] && sm['_debug']('Missing executionWitness')
    return false
  }

  return verifyVerkleProof(sm.verkleCrypto, sm['_executionWitness'])
}
