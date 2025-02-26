import { EthereumJSErrorWithoutCode, type VerkleCrypto } from '@ethereumjs/util'

import { BaseVerkleNode } from './baseVerkleNode.js'
import { NODE_WIDTH, VerkleNodeType } from './types.js'

import type { ChildNode, VerkleNodeOptions } from './types.js'

export class InternalVerkleNode extends BaseVerkleNode<VerkleNodeType.Internal> {
  // Array of tuples of uncompressed commitments (i.e. 64 byte Uint8Arrays) to child nodes along with the path to that child (i.e. the partial stem)
  public children: Array<ChildNode | null>
  public type = VerkleNodeType.Internal

  constructor(options: VerkleNodeOptions[VerkleNodeType.Internal]) {
    super(options)
    this.children = options.children ?? new Array(256).fill(null)
  }

  // Updates the commitment value for a child node at the corresponding index
  setChild(childIndex: number, child: ChildNode | null) {
    // Get previous child commitment at `index`
    const oldChildReference =
      this.children[childIndex] !== null
        ? this.children[childIndex]
        : {
            commitment: this.verkleCrypto.zeroCommitment,
            path: new Uint8Array(),
          }
    // Updates the commitment to the child node at `index`
    this.children[childIndex] = child !== null ? { ...child } : null
    // Updates the overall node commitment based on the update to this child
    this.commitment = this.verkleCrypto.updateCommitment(
      this.commitment,
      childIndex,
      // The hashed child commitments are used when updating the internal node commitment
      this.verkleCrypto.hashCommitment(oldChildReference!.commitment),
      this.verkleCrypto.hashCommitment(
        child !== null ? child.commitment : this.verkleCrypto.zeroCommitment,
      ),
    )
  }

  static fromRawNode(rawNode: Uint8Array[], verkleCrypto: VerkleCrypto): InternalVerkleNode {
    const nodeType = rawNode[0][0]
    if (nodeType !== VerkleNodeType.Internal) {
      throw EthereumJSErrorWithoutCode('Invalid node type')
    }

    // The length of the rawNode should be the # of children * 2 (for commitments and paths) + 2 for the node type and the commitment
    if (rawNode.length !== NODE_WIDTH * 2 + 2) {
      throw EthereumJSErrorWithoutCode('Invalid node length')
    }

    const commitment = rawNode[rawNode.length - 1]
    const childrenCommitments = rawNode.slice(1, NODE_WIDTH + 1)
    const childrenPaths = rawNode.slice(NODE_WIDTH + 1, NODE_WIDTH * 2 + 1)

    const children = childrenCommitments.map((commitment, idx) => {
      if (commitment.length > 0) return { commitment, path: childrenPaths[idx] }
      return null
    })
    return new InternalVerkleNode({ commitment, verkleCrypto, children })
  }

  /**
   * Generates a new Internal node with default commitment
   */
  static create(verkleCrypto: VerkleCrypto): InternalVerkleNode {
    const node = new InternalVerkleNode({
      commitment: verkleCrypto.zeroCommitment,
      verkleCrypto,
    })

    return node
  }

  /**
   *
   * @param index The index in the children array to retrieve the child node commitment from
   * @returns the uncompressed 64byte commitment for the child node at the `index` position in the children array
   */
  getChildren(index: number): ChildNode | null {
    return this.children[index]
  }

  raw(): Uint8Array[] {
    return [
      new Uint8Array([VerkleNodeType.Internal]),
      ...this.children.map((child) => (child !== null ? child.commitment : new Uint8Array())),
      ...this.children.map((child) => (child !== null ? child.path : new Uint8Array())),
      this.commitment,
    ]
  }
}
