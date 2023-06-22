import { bytesToPrefixedHexString } from '@ethereumjs/util'

import { doKeysMatch, getSharedNibbles } from '../../util/nibbles.js'
import { NullNode } from '../node/index.js'

import { _cleanupNode } from './cleanup.js'

import type { MerklePatriciaTrie } from '../merklePatricia.js'
import type { BranchNode, ExtensionNode, LeafNode } from '../node/index.js'
import type { NodeType, TNode } from '../node/types.js'
import type { Debugger } from 'debug'

export async function _deleteAtNode(
  this: MerklePatriciaTrie,
  _node: TNode,
  _keyNibbles: number[],
  debug: Debugger
) {
  debug = debug.extend('delete')
  debug(`nibbles: [${_keyNibbles}]`)
  debug(`at Node: [${_node.getPartialKey()}]`)
  const d: {
    [type in NodeType]: () => Promise<TNode>
  } = {
    NullNode: async () => {
      return _node
    },
    LeafNode: async () => {
      const leafNode = _node as LeafNode
      if (doKeysMatch(leafNode.getPartialKey(), _keyNibbles)) {
        debug(`found leaf node to delete, replacing with null`)
        return new NullNode({ hashFunction: this.hashFunction })
      } else {
        return _node
      }
    },
    ExtensionNode: async () => {
      const extensionNode = _node as ExtensionNode
      const sharedNibbles = getSharedNibbles(_keyNibbles, extensionNode.getPartialKey())
      debug(
        `node_key: (${extensionNode.getPartialKey().length}) [${extensionNode.getPartialKey()}]`
      )
      debug(`shared:  [${sharedNibbles}]`)
      if (sharedNibbles.length === extensionNode.getPartialKey().length) {
        if (_keyNibbles.length === sharedNibbles.length) {
          debug(`shared nibbles match entirely. deleting extension`)
          return new NullNode({ hashFunction: this.hashFunction })
        }
        debug(
          `shared nibbles match with nibbles remaining.  nativagating from extension node into child node`
        )
        debug.extend(`[${sharedNibbles}]`)(
          `Remaining: [${_keyNibbles.slice(sharedNibbles.length)}]`
        )
        const newChild = await this._deleteAtNode(
          await extensionNode.getChild(),
          _keyNibbles.slice(sharedNibbles.length),
          debug
        )
        return extensionNode.updateChild(newChild)
      } else {
        return extensionNode
      }
    },
    BranchNode: async () => {
      let branchNode: TNode = _node as BranchNode
      if (_keyNibbles.length === 0) {
        debug.extend('BranchNode')(`keyNibbles is empty, setting deleting branch`)
        return new NullNode({ hashFunction: this.hashFunction })
      }
      const childIndex = _keyNibbles[0]
      if (_keyNibbles.length === 1) {
        debug.extend('BranchNode')(`remaining keyNibble: [${_keyNibbles}}]`)
        return branchNode.updateChild(new NullNode({ hashFunction: this.hashFunction }), childIndex)
      }
      if ((branchNode as BranchNode).branches[childIndex].length <= 0) {
        debug.extend('BranchNode').extend(`[${childIndex}]`)(
          `branch is empty, returning BranchNode`
        )
        return branchNode
      }
      let childNode = await branchNode.getChild(childIndex)
      debug.extend('BranchNode').extend(`[${childIndex}]`)(`${childNode.getType()}`)
      if (childNode.getType() === 'ProofNode') {
        const lookup = await this.lookupNodeByHash(childNode.hash())
        if (!lookup || lookup.getType() === 'ProofNode') {
          // debug(`can't resolve proofNode.  returning without deleting`)
          return branchNode
          // throw new Error(`can't resolve proofNode.`)
        }
        childNode = lookup
      }
      const childType = childNode.getType()
      const childNibbles = childNode.getPartialKey()
      debug.extend('BranchNode')(
        `${childType} with hash: ${bytesToPrefixedHexString(
          childNode.hash()
        )} at index ${childIndex}`
      )
      debug.extend('BranchNode')(`compare nibbles with child: ${childType} at index ${childIndex}`)
      debug.extend('BranchNode').extend(`[${childIndex}]`)(`[${childNode.getPartialKey()}]`)
      debug.extend('BranchNode')(`[${_keyNibbles[0]}] [${_keyNibbles.slice(1)}]`)
      if (childNode.getType() === 'LeafNode' && doKeysMatch(childNibbles, _keyNibbles.slice(1))) {
        debug(`found LeafNode to delete, replacing with NullNode`)
        debug.extend('BranchNode')(`before: ${bytesToPrefixedHexString(branchNode.hash())}`)
        branchNode = await branchNode.deleteChild(childIndex)
        debug.extend('BranchNode')(`update: ${bytesToPrefixedHexString(branchNode.hash())}`)
        if (branchNode.getType() === 'NullNode') {
          return branchNode
        }
        await this.storeNode(branchNode)
        return branchNode
      }
      if (childNode.getType() === 'LeafNode') {
        debug('WHAAAAAAT???')
        debug.extend(`[${childIndex}]`)(`[${childNode.getPartialKey()}]`)
        debug(`[${_keyNibbles[0]}] [${_keyNibbles.slice(1)}]`)
      }
      const updatedChildNode = await this._deleteAtNode(childNode, _keyNibbles.slice(1), debug)
      debug(`update child at index ${childIndex}`)
      debug(`before: ${childType}: [${childNibbles}]`)
      debug(`update: ${updatedChildNode.getType()}: [${updatedChildNode.getPartialKey()}]`)
      branchNode = branchNode.updateChild(updatedChildNode, childIndex)
      await this.storeNode(branchNode)
      return branchNode
    },
    ProofNode: async () => {
      const lookup = await this.lookupNodeByHash(_node.hash())
      if (lookup && lookup.getType() !== 'ProofNode') {
        return this._deleteAtNode(lookup, _keyNibbles, debug)
      }
      return new NullNode({ hashFunction: this.hashFunction })
    },
  }
  const deleted = await d[_node.getType()]()
  const newRoot = await this._cleanupNode(deleted, debug)
  this._rootNode = newRoot
  this.root(newRoot.hash())
  debug(`new root {${newRoot.getType()}}: ${bytesToPrefixedHexString(newRoot.hash())}`)
  return newRoot
}
