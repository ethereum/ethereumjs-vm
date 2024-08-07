import { Block } from '../index.js'

/**
 * Returns the canonical difficulty for this block.
 *
 * @param parentBlock - the parent of this `Block`
 */
export function ethashCanonicalDifficulty(block: Block, parentBlock: Block): bigint {
  return block.header.ethashCanonicalDifficulty(parentBlock.header)
}
