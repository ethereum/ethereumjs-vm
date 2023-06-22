import { bytesToPrefixedHexString } from '@ethereumjs/util'

import { findCommonPrefix, getSharedNibbles } from '../../util/nibbles.js'
import { BranchNode, ExtensionNode, LeafNode } from '../node/index.js'

import { _cleanupNode } from './cleanup.js'

import type { MerklePatriciaTrie } from '../merklePatricia.js'
import type { ProofNode } from '../node/index.js'
import type { NodeType, TNode } from '../node/types.js'
import type { Debugger } from 'debug'

export async function _insertAtNode(
  this: MerklePatriciaTrie,
  node: TNode,
  keyNibbles: number[],
  value: Uint8Array | null,
  debug: Debugger
): Promise<TNode> {
  const type = node.type ?? 'NullNode'
  debug = debug.extend('insert')
  debug(`nibbles: [${keyNibbles}]`)
  debug(`at Node: [${node.getPartialKey()}]`)
  // debug = debug.extend('insertAtNode').extend(type)
  const _insert: {
    [type in NodeType]: () => Promise<TNode>
  } = {
    NullNode: async (): Promise<LeafNode> => {
      debug.extend('NULL_NODE')(`inserting as LeafNode`)
      const leaf = new LeafNode({ key: keyNibbles, value, hashFunction: this.hashFunction })
      await this.storeNode(leaf)
      return leaf
    },
    LeafNode: async (): Promise<TNode> => {
      const toReplace = node as LeafNode
      const toReplaceNibbles = toReplace.getPartialKey()
      const { commonPrefix, remainingNibbles1, remainingNibbles2 } = findCommonPrefix(
        keyNibbles,
        toReplaceNibbles
      )
      const remainingNibblesNew = remainingNibbles1
      const remainingNibblesOld = remainingNibbles2
      if (remainingNibblesNew.length === 0 && remainingNibblesOld.length === 0) {
        debug.extend('LeafNode')(`inserting into LeafNode with same key`)
        const leafNode = new LeafNode({ key: keyNibbles, value, hashFunction: this.hashFunction })
        await this.storeNode(leafNode)
        return leafNode
      } else {
        debug.extend(`inserting into LeafNode`)
        debug(`shared:  [${commonPrefix}]`)
        if (commonPrefix.length > 0) {
          debug.extend('ExtensionNode').extend(`[${commonPrefix}]`).extend('[]')(
            `[${remainingNibblesOld}]`
          )
          debug.extend('ExtensionNode').extend(`[${commonPrefix}]`).extend('[]')(
            `[${remainingNibblesNew}]`
          )
        } else {
          debug(`remainingNibblesOld: [${remainingNibblesOld}]`)
          debug(`remainingNibblesNew: [${remainingNibblesNew}]`)
        }
        let branchNode: TNode = new BranchNode({ hashFunction: this.hashFunction, value: null })
        if (remainingNibblesOld.length === 0) {
          debug.extend('LeafNode*')(
            `splitting into BranchNode with child on branch ${remainingNibblesNew[0]}`
          )
          branchNode = branchNode.updateValue(toReplace.getValue())
          const newChild = new LeafNode({
            key: remainingNibblesNew.slice(1),
            value,
            hashFunction: this.hashFunction,
          })
          debug.extend('BranchNode*')(
            `putting new LeafNode (${bytesToPrefixedHexString(newChild.hash())}) on branch ${
              remainingNibblesNew[0]
            } with nibbles [${newChild.getPartialKey()}]`
          )
          branchNode = (branchNode as BranchNode).setChild(remainingNibblesNew[0], newChild)
          debug.extend('BranchNode*')(`hash: ${bytesToPrefixedHexString(branchNode.hash())}`)
          debug.extend('BranchNode*')(`branches: {
              ${[...(branchNode as BranchNode).branches.entries()].map(([index, child]) => {
                return `${index}: ${child}`
              })}
            }`)
          await this.storeNode(newChild)
          await this.storeNode(branchNode)
        } else if (remainingNibblesNew.length === 0) {
          debug.extend('LeafNode*')(
            `splitting into BranchNode with child on branch ${remainingNibblesOld[0]}`
          )
          branchNode = branchNode.updateValue(value)
          const newChild = new LeafNode({
            key: remainingNibblesOld.slice(1),
            value: toReplace.getValue(),
            hashFunction: this.hashFunction,
          })
          debug.extend('BranchNode*')(
            `putting new LeafNode (${bytesToPrefixedHexString(newChild.hash())}) on branch ${
              remainingNibblesOld[0]
            } with nibbles [${newChild.getPartialKey()}]`
          )
          branchNode = (branchNode as BranchNode).setChild(remainingNibblesOld[0], newChild)
          await this.storeNode(newChild)
          await this.storeNode(branchNode)
        } else {
          debug(
            `creating BranchNode with children on branches ${remainingNibblesNew[0]} and ${remainingNibblesOld[0]}`
          )

          const newReplacement = new LeafNode({
            key: remainingNibblesOld.slice(1),
            value: toReplace.getValue(),
          })
          const newChild = new LeafNode({
            key: remainingNibblesNew.slice(1),
            value,
            hashFunction: this.hashFunction,
          })
          debug
            .extend('branch*')
            .extend(`[${remainingNibblesOld[0]}]`)
            .extend(`[${toReplace.getPartialKey()}]`)(
            `${toReplace.getType()} => ${bytesToPrefixedHexString(toReplace.hash())})`
          )
          debug
            .extend('branch*')
            .extend(`[${remainingNibblesNew[0]}]`)
            .extend(`[${newChild.getPartialKey()}]`)(
            `${newChild.getType()} => ${bytesToPrefixedHexString(newChild.hash())})`
          )

          branchNode = (branchNode as BranchNode).setChild(remainingNibblesOld[0], newReplacement)
          branchNode = (branchNode as BranchNode).setChild(remainingNibblesNew[0], newChild)
          await this.storeNode(newReplacement)
          await this.storeNode(newChild)
          await this.storeNode(branchNode)
        }
        // If there's a common prefix, create an extension node.
        if (commonPrefix.length > 0) {
          debug.extend(`BranchNode*`)(
            `Embedding into ExtensionNode with shared nibbles: [${commonPrefix}]`
          )
          return new ExtensionNode({
            keyNibbles: commonPrefix,
            subNode: branchNode,
            hashFunction: this.hashFunction,
            source: debug,
          })
        } else {
          debug.extend('BranchNode*')(`inserting as new branchNode`)
          return branchNode
        }
      }
    },
    BranchNode: async () => {
      let branchNode: TNode = node as BranchNode
      const childIndex = keyNibbles.shift()!
      debug.extend('BranchNode')(`insert at index ${childIndex}`)
      let childNode = await branchNode.getChild(childIndex)
      debug.extend('BranchNode').extend('branch').extend(childIndex.toString())(
        `${childNode.getType()}: [${childNode.getPartialKey()}] => {${bytesToPrefixedHexString(
          childNode.hash()
        )}}`
      )
      if (childNode.getType() !== 'NullNode') {
        if (childNode.getType() === 'ProofNode') {
          childNode = (await this.lookupNodeByHash(childNode.hash())) ?? childNode
        }
        debug.extend('BranchNode')(
          `${childNode.getType()}: ${bytesToPrefixedHexString(
            childNode.hash()
          )} found at index ${childIndex}.  Updating child.`
        )
        const newChild = await this._insertAtNode(childNode, keyNibbles, value, debug)
        await this.storeNode(newChild)
        branchNode = branchNode.updateChild(newChild, childIndex)
      } else {
        debug(`NullNode found at index ${childIndex}.  Creating new LeafNode and updating child.`)
        childNode = new LeafNode({ key: keyNibbles, value, hashFunction: this.hashFunction })
        await this.storeNode(childNode)
        branchNode = (branchNode as BranchNode).setChild(childIndex, childNode)
      }
      debug(`updated BranchNode: ${bytesToPrefixedHexString(branchNode.hash())}`)
      await this.storeNode(branchNode)
      return branchNode
    },
    ExtensionNode: async () => {
      let extensionNode: TNode = node as ExtensionNode
      const sharedNibbles = getSharedNibbles(keyNibbles, extensionNode.getPartialKey())
      debug(`shared:  [${sharedNibbles}]`)
      if (sharedNibbles.length === extensionNode.getPartialKey().length) {
        const oldChild = await (extensionNode as ExtensionNode).getChild()
        if (sharedNibbles.length === keyNibbles.length) {
          debug.extend('ExtensionNode').extend(`[${extensionNode.getPartialKey()}]`)(
            `shared nibbles match entrirely.  update child value.`
          )
          const newChild = oldChild.updateValue(value)
          await this.storeNode(newChild)
          extensionNode = extensionNode.updateChild(newChild)
          return extensionNode
        }
        debug.extend('ExtensionNode').extend(`[${extensionNode.getPartialKey()}]`)(
          `shared nibbles match node key and continue.  update child {${oldChild.getType()}} with remaining nibbles: ${keyNibbles.slice(
            sharedNibbles.length
          )}.`
        )
        const newChild = await this._insertAtNode(
          oldChild,
          keyNibbles.slice(sharedNibbles.length),
          value,
          debug.extend('ExtensionNode').extend(`[${extensionNode.getPartialKey()}]`).extend('[]')
        )
        await this.storeNode(newChild)
        extensionNode = extensionNode.updateChild(newChild)
        // await this.storeNode(extensionNode)
        return extensionNode
      } else {
        if (sharedNibbles.length === 0) {
          debug(`shared nibbles: ${sharedNibbles} do not match at all.`)
        } else {
          debug(`shared nibbles: ${sharedNibbles} do not match entirely.`)
        }
        const _remainingOldNibbles = node.getPartialKey().slice(sharedNibbles.length)
        const _remainingNewNibbles = keyNibbles.slice(sharedNibbles.length)
        debug(`remainingOldNibbles: [${_remainingOldNibbles}]`)
        debug(`remainingNewNibbles: [${_remainingNewNibbles}]`)
        const oldBranchNodeIndex = _remainingOldNibbles[0]
        const newLeafNodeIndex = _remainingNewNibbles[0]
        const remainingOldNibbles = _remainingOldNibbles.slice(1)
        const remainingNewNibbles = _remainingNewNibbles.slice(1)
        debug(
          `splitting ExtensionNode into BranchNode with children on branches ${newLeafNodeIndex} and ${oldBranchNodeIndex}`
        )
        let branchNode: TNode = new BranchNode({ hashFunction: this.hashFunction, value: null })
        const newLeafNode = new LeafNode({
          key: remainingNewNibbles,
          value,
          hashFunction: this.hashFunction,
        })
        await this.storeNode(newLeafNode)
        let newBranch: TNode
        if (remainingOldNibbles.length > 0) {
          const subNode = await extensionNode.getChild()
          const newExtensionNode = new ExtensionNode({
            keyNibbles: remainingOldNibbles,
            subNode,
            hashFunction: this.hashFunction,
          })
          debug.extend('ExtensionNode').extend(`[${remainingOldNibbles}]`)(
            `inserting with ${subNode.getType()}: [${extensionNode.getPartialKey()}] as child`
          )
          debug(
            `putting ${newExtensionNode.getType()}: ${bytesToPrefixedHexString(
              newExtensionNode.hash()
            )} as child on branch ${oldBranchNodeIndex}`
          )
          newBranch = await this._cleanupNode(newExtensionNode)
        } else {
          const subNode = await extensionNode.getChild()
          debug.extend('BranchNode')(
            `Replacing ExtensionNode with child: ${subNode.getType()}: ${bytesToPrefixedHexString(
              subNode.hash()
            )} on branch ${oldBranchNodeIndex}`
          )
          newBranch = subNode
          await this.storeNode(newBranch)
        }
        branchNode = (branchNode as BranchNode).setChild(oldBranchNodeIndex, newBranch)
        branchNode = (branchNode as BranchNode).setChild(newLeafNodeIndex, newLeafNode)
        debug.extend('BranchNode').extend(`[${oldBranchNodeIndex}]`)(
          `[${remainingOldNibbles}] => ${newBranch.getType()} (${bytesToPrefixedHexString(
            newBranch.hash()
          )})`
        )
        debug.extend('BranchNode').extend(`[${newLeafNodeIndex}]`)(
          `[${remainingNewNibbles}] => ${newLeafNode.getType()} (${bytesToPrefixedHexString(
            newLeafNode.hash()
          )})`
        )
        if (sharedNibbles.length > 0) {
          debug.extend('ExtensionNode').extend(`${sharedNibbles}`)(
            `inserting with BranchNode as child`
          )
          const newExtension = new ExtensionNode({
            keyNibbles: sharedNibbles,
            subNode: branchNode,
            hashFunction: this.hashFunction,
          })
          await this.storeNode(branchNode)
          return newExtension
        } else {
          branchNode.value = ((await extensionNode.getChild()) as any).value
          debug(`inserting as new branchNode`)
          return branchNode
        }
      }
    },
    ProofNode: async () => {
      const proofNode: TNode = node as ProofNode
      const stored = await proofNode.load()
      if (stored && stored.getType() !== 'ProofNode') {
        node = stored
        return _insert[node.getType()]()
      }
      return new LeafNode({ key: keyNibbles, value, hashFunction: this.hashFunction })
    },
  }
  const preCleanup = await _insert[type]()
  const newRoot = await this._cleanupNode(preCleanup, debug)
  debug.extend('NEW_ROOT')(bytesToPrefixedHexString(newRoot.hash()))
  this._rootNode = newRoot
  this.root(newRoot.hash())
  return newRoot
}
