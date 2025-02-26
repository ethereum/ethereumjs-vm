import {
  EthereumJSErrorWithoutCode,
  equalsBytes,
  intToBytes,
  setLengthRight,
} from '@ethereumjs/util'

import { BaseVerkleNode } from './baseVerkleNode.js'
import { LeafVerkleNodeValue, NODE_WIDTH, VerkleNodeType } from './types.js'
import { createCValues, createDefaultLeafVerkleValues, createZeroesLeafValue } from './util.js'

import type { VerkleNodeOptions } from './types.js'
import type { VerkleCrypto } from '@ethereumjs/util'

export class LeafVerkleNode extends BaseVerkleNode<VerkleNodeType.Leaf> {
  public stem: Uint8Array
  public values: (Uint8Array | LeafVerkleNodeValue)[] // Array of 256 possible values represented as 32 byte Uint8Arrays or 0 if untouched or 1 if deleted
  public c1?: Uint8Array
  public c2?: Uint8Array
  public type = VerkleNodeType.Leaf

  constructor(options: VerkleNodeOptions[VerkleNodeType.Leaf]) {
    super(options)

    this.stem = options.stem
    this.values = options.values ?? createDefaultLeafVerkleValues()
    this.c1 = options.c1
    this.c2 = options.c2
  }

  /**
   * Create a new leaf node from a stem and values
   * @param stem the 31 byte stem corresponding to the where the leaf node should be placed in the trie
   * @param values the 256 element array of 32 byte values stored in the leaf node
   * @param verkleCrypto the verkle cryptography interface
   * @returns an instantiated leaf node with commitments defined
   */
  static async create(
    stem: Uint8Array,
    verkleCrypto: VerkleCrypto,
    values?: (Uint8Array | LeafVerkleNodeValue)[],
  ): Promise<LeafVerkleNode> {
    // Generate the value arrays for c1 and c2
    if (values !== undefined) {
      values = values.map((el) => {
        // Checks for instances of zeros and replaces with the "deleted" leaf node value
        if (el instanceof Uint8Array && equalsBytes(el, new Uint8Array(32)))
          return LeafVerkleNodeValue.Deleted
        return el
      })
    } else values = createDefaultLeafVerkleValues()

    const c1Values = createCValues(values.slice(0, 128))
    const c2Values = createCValues(values.slice(128))
    let c1 = verkleCrypto.zeroCommitment
    let c2 = verkleCrypto.zeroCommitment

    // Update the c1/c2 commitments for any values that are nonzero
    for (let x = 0; x < 256; x++) {
      if (!equalsBytes(c1Values[x], new Uint8Array(32))) {
        c1 = verkleCrypto.updateCommitment(c1, x, new Uint8Array(32), c1Values[x])
      }
      if (!equalsBytes(c2Values[x], new Uint8Array(32))) {
        c2 = verkleCrypto.updateCommitment(c2, x, new Uint8Array(32), c2Values[x])
      }
    }

    // Generate a commitment for the new leaf node, using the zero commitment as a base
    // 1) Update commitment with Leaf marker (1) in position 0
    // 2) Update commitment with stem (in little endian format) in position 1
    // 3) Update commitment with c1
    // 4) update commitment with c2
    let commitment = verkleCrypto.updateCommitment(
      verkleCrypto.zeroCommitment,
      0,
      new Uint8Array(32),
      setLengthRight(intToBytes(1), 32),
    )
    commitment = verkleCrypto.updateCommitment(
      commitment,
      1,
      new Uint8Array(32),
      setLengthRight(stem, 32),
    )
    commitment = verkleCrypto.updateCommitment(
      commitment,
      2,
      new Uint8Array(32),
      // We hash the commitment when using in the leaf node commitment since c1 is 64 bytes long
      // and we need a 32 byte input for the scalar value in `updateCommitment`
      verkleCrypto.hashCommitment(c1),
    )
    commitment = verkleCrypto.updateCommitment(
      commitment,
      3,
      new Uint8Array(32),
      verkleCrypto.hashCommitment(c2),
    )
    return new LeafVerkleNode({
      stem,
      values,
      commitment,
      c1,
      c2,
      verkleCrypto,
    })
  }

  static fromRawNode(rawNode: Uint8Array[], verkleCrypto: VerkleCrypto): LeafVerkleNode {
    const nodeType = rawNode[0][0]
    if (nodeType !== VerkleNodeType.Leaf) {
      throw EthereumJSErrorWithoutCode('Invalid node type')
    }

    // The length of the rawNode should be the # of values (node width) + 5 for the node type, the stem, the commitment and the 2 commitments
    if (rawNode.length !== NODE_WIDTH + 5) {
      throw EthereumJSErrorWithoutCode('Invalid node length')
    }

    const stem = rawNode[1]
    const commitment = rawNode[2]
    const c1 = rawNode[3]
    const c2 = rawNode[4]

    const values = rawNode
      .slice(5, rawNode.length)
      .map((el) => (el.length === 0 ? 0 : equalsBytes(el, createZeroesLeafValue()) ? 1 : el))
    return new LeafVerkleNode({ stem, values, c1, c2, commitment, verkleCrypto })
  }

  // Retrieve the value at the provided index from the values array
  getValue(index: number): Uint8Array | undefined {
    const value = this.values[index]
    switch (value) {
      case LeafVerkleNodeValue.Untouched:
        return undefined
      case LeafVerkleNodeValue.Deleted:
        // Return zeroes if a value is "deleted" (i.e. overwritten with zeroes)
        return new Uint8Array(32)
      default:
        return value
    }
  }

  /**
   * Set the value at the provided index from the values array and update the node commitments
   * @param index the index of the specific leaf value to be updated
   * @param value the value to insert into the leaf value at `index`
   */
  setValue(index: number, value: Uint8Array | LeafVerkleNodeValue): void {
    // Set the new values in the values array
    this.values[index] = value

    // First we update c1 or c2 (depending on whether the index is < 128 or not)
    // Generate the 16 byte values representing the 32 byte values in the half of the values array that
    // contain the old value for the leaf node
    const cValues =
      index < 128 ? createCValues(this.values.slice(0, 128)) : createCValues(this.values.slice(128))
    // Create a commitment to the cValues returned and then use this to replace the c1/c2 commitment value
    const cCommitment = this.verkleCrypto.commitToScalars(cValues)

    let oldCCommitment: Uint8Array | undefined
    if (index < 128) {
      oldCCommitment = this.c1
      this.c1 = cCommitment
    } else {
      oldCCommitment = this.c2
      this.c2 = cCommitment
    }

    // Update leaf node commitment -- c1 (2) if index is < 128 or c2 (3) otherwise
    const cIndex = index < 128 ? 2 : 3
    this.commitment = this.verkleCrypto.updateCommitment(
      this.commitment,
      cIndex,
      this.verkleCrypto.hashCommitment(oldCCommitment!),
      this.verkleCrypto.hashCommitment(cCommitment),
    )
  }

  raw(): Uint8Array[] {
    return [
      new Uint8Array([VerkleNodeType.Leaf]),
      this.stem,
      this.commitment,
      this.c1 ?? new Uint8Array(),
      this.c2 ?? new Uint8Array(),
      ...this.values.map((val) => {
        switch (val) {
          case LeafVerkleNodeValue.Untouched:
            return new Uint8Array()
          case LeafVerkleNodeValue.Deleted:
            return createZeroesLeafValue()
          default:
            return val
        }
      }),
    ]
  }
}
