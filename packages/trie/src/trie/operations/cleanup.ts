import { debug as _debug } from 'debug'

import { BranchNode, ExtensionNode, LeafNode, NullNode } from '../node/index.js'

import type { MerklePatriciaTrie } from '../merklePatricia.js'
import type { ProofNode } from '../node/index.js'
import type { NodeType, TNode } from '../node/types.js'
import type { Debugger } from 'debug'

export async function _cleanupNode(
  this: MerklePatriciaTrie,
  node: TNode,
  debug: Debugger = this.debug
): Promise<TNode> {
  debug = debug.extend('_cleanupNode')
  if (node instanceof BranchNode) {
    node = await this._cleanupBranchNode(node, debug)
  } else if (node instanceof ExtensionNode) {
    node = await this._cleanupExtensionNode(node, debug)
  }
  // If the node is not a branch node, or it's a branch node with more than
  // one child, there's nothing to clean up and we return the node as is.
  return node
}

export async function _cleanupBranchNode(
  this: MerklePatriciaTrie,
  node: TNode,
  debug: Debugger
): Promise<TNode> {
  if (!(node instanceof BranchNode)) {
    throw new Error(`_cleanupBranchNode expects a BranchNode`)
  }
  debug = debug.extend('_cleanupBranchNode')
  const childCount = node.childCount()
  const branches = [...(await node.childNodes()).keys()]
  let child: TNode
  switch (childCount) {
    case 0:
      if (!node.value) {
        debug(`Converting BranchNode to NullNode`)
        return new NullNode({})
      } else {
        debug(`Converting BranchNode to LeafNode with same value.`)
        const newNode = new LeafNode({
          key: [],
          value: node.value,
          hashFunction: this.hashFunction,
        })
        await this.storeNode(newNode)
        return newNode
      }
    case 1:
      if (node.value !== null && node.value.length > 0) {
        return node
      } else {
        child = await node.getChild(branches[0])
        const childType = child.getType()
        if (childType === 'ProofNode') {
          child = (await this.lookupNodeByHash(child.hash())) ?? child
        }
        debug.extend(`ONE_CHILD`)(
          `BranchNode is now ExtensionNode: [${branches[0]}]: child: ${childType}`
        )
        child = await this._cleanupNode(child, debug)
        node = new ExtensionNode({
          keyNibbles: [branches[0]],
          subNode: child,
          hashFunction: this.hashFunction,
          source: debug,
        })
        node = await this._cleanupNode(node)
        await this.storeNode(node, debug)
        return node
      }
    default:
      debug(
        `BranchNode has more than 1 child. ${[
          ...(await node.childNodes()).keys(),
        ]}  No cleanup needed.`
      )
      return node
  }
}

export const childCleanupMessage: Record<NodeType, (...args: any) => Record<string, string>> = {
  LeafNode: (parent: number[], child: number[]) => {
    return {
      child: 'LeafNode',
      _: 'compressing ExtensionNode + LeafNode into new LeafNode with combined nibbles',
      combinedNibbles: `[${parent}] + [${child}]`,
    }
  },
  ExtensionNode: (parent: number[], child: number[]) => {
    return {
      child: `ExtensionNode.`,
      _: `compressing ExtensionNode + ExtensionNode into new ExtensionNode with combined nibbles`,
      combinedNibbles: `[${parent}] + [${child}]`,
    }
  },
  ProofNode: () => {
    return {
      child: `ProofNode`,
      _: `attempting to resolve ProofNode before cleanup`,
    }
  },
  BranchNode: () => {
    return {
      child: `BranchNode. Checking child count`,
    }
  },
  NullNode: () => {
    return {
      child: `NullNode. no cleanup needed`,
    }
  },
}
export async function _cleanupExtensionNode(
  this: MerklePatriciaTrie,
  node: ExtensionNode,
  debug: Debugger
): Promise<TNode> {
  const child = await node.getChild()
  const childType = child.getType()
  let combinedNibbles: number[]
  let newNode: TNode
  let newChild: TNode
  let resolved: TNode
  debug = debug.extend('_ExtensionNode').extend(`[${node.getPartialKey()}]`)
  debug(childCleanupMessage[childType](node.getPartialKey(), child.getPartialKey()))
  switch (childType) {
    case 'LeafNode':
      combinedNibbles = [...node.getPartialKey(), ...child.getPartialKey()]
      newNode = new LeafNode({
        key: combinedNibbles,
        value: child.getValue(),
        hashFunction: this.hashFunction,
      })
      await this.storeNode(newNode)
      return newNode
    case 'ExtensionNode':
      combinedNibbles = [...node.getPartialKey(), ...child.getPartialKey()]
      newNode = new ExtensionNode({
        keyNibbles: combinedNibbles,
        subNode: await (child as ExtensionNode).getChild(),
        hashFunction: this.hashFunction,
      })
      newNode = await this._cleanupNode(newNode)
      await this.storeNode(newNode)
      return newNode
    case 'BranchNode':
      if ((child as BranchNode).childCount() > 1) {
        debug(`ExtensionNode child: BranchNode has more than 1 child.  No cleanup needed`)
        await this.storeNode(node)
        return node
      }
      debug(`ExtensionNode child: BranchNode has 1 child: ${child.getType()}`)
      if (
        (child as BranchNode).getValue() instanceof Uint8Array &&
        (child as BranchNode).getValue()!.length > 0
      ) {
        debug(`ExtensionNode child: BranchNode has value.  No cleanup needed`)
        await this.storeNode(node)
        return node
      }
      debug.extend(`ExtensionNode`)(`cleanup child: BranchNode`)
      newChild = await this._cleanupNode(child)
      newNode = node.updateChild(newChild)
      await this.storeNode(newChild)
      // newNode = await this._cleanupNode(newNode)
      await this.storeNode(newNode)
      return newNode
    case 'ProofNode':
      resolved = await this.resolveProofNode((await node.getChild()) as ProofNode)
      newNode = node.updateChild(resolved)
      debug(`ProofNode resolved.  Resuming cleanup`)
      newNode = await this._cleanupNode(newNode)
      await this.storeNode(newNode)
      return newNode
    case 'NullNode':
      return new NullNode({})
  }
}
