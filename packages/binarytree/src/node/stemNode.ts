import { RLP } from '@ethereumjs/rlp'
import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'

import { BinaryNodeType, NODE_WIDTH } from './types.js'

import type { BinaryNodeOptions } from './types.js'

export class StemBinaryNode {
  public stem: Uint8Array
  public values: (Uint8Array | null)[] // Array of 256 possible values represented as 32 byte Uint8Arrays

  public type = BinaryNodeType.Stem

  constructor(options: BinaryNodeOptions[BinaryNodeType.Stem]) {
    this.stem = options.stem
    this.values = options.values ?? new Array(256).fill(null)
  }

  static fromRawNode(rawNode: Uint8Array[]): StemBinaryNode {
    const nodeType = rawNode[0][0]
    if (nodeType !== BinaryNodeType.Stem) {
      throw EthereumJSErrorWithoutCode('Invalid node type')
    }

    // The length of the rawNode should be the # of values (node width) + 2 for the node type and the stem
    if (rawNode.length !== NODE_WIDTH + 2) {
      throw EthereumJSErrorWithoutCode('Invalid node length')
    }

    const stem = rawNode[1]
    const rawValues = rawNode.slice(2, rawNode.length)
    const values = rawValues.map((el) => (el.length === 0 ? null : el))

    return new StemBinaryNode({ stem, values })
  }

  /**
   * Generates a new Stem node
   * @param stem the 31 byte stem corresponding to the where the stem node is located in the tree
   * @returns a new Stem node
   */
  static create(stem: Uint8Array): StemBinaryNode {
    return new StemBinaryNode({ stem })
  }

  // Retrieve the value at the provided index from the values array
  getValue(index: number): Uint8Array | null {
    return this.values[index]
  }

  setValue(index: number, value: Uint8Array | null): void {
    this.values[index] = value
  }

  /**
   * @returns the RLP serialized node
   */
  serialize(): Uint8Array {
    return RLP.encode(this.raw())
  }

  /**
   * Returns the raw serialized representation of the node as an array of Uint8Arrays.
   * The returned array is constructed as follows:
   * - The first element is a Uint8Array containing a single byte that represents the node type,
   * - The second element is the node's `stem` property.
   * - The remaining elements are derived from the node's `values` array:
   *   - For each value, if it is `null`, it is converted to an empty Uint8Array.
   *   - Otherwise, the value is included as-is.
   *
   * @returns {Uint8Array[]} An array of Uint8Arrays representing the node's raw data.
   */
  raw(): Uint8Array[] {
    return [
      new Uint8Array([BinaryNodeType.Stem]),
      this.stem,
      ...this.values.map((val) => {
        switch (val) {
          case null:
            return new Uint8Array()
          default:
            return val
        }
      }),
    ]
  }
}
