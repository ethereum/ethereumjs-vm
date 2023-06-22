import { doKeysMatch } from '../../util/nibbles.js'
import { NullNode } from '../node/index.js'

import type { MerklePatriciaTrie } from '../merklePatricia.js'
import type { BranchNode, ExtensionNode, LeafNode, ProofNode } from '../node/index.js'
import type { TNode } from '../node/types.js'
import type { Debugger } from 'debug'

export type WalkResult = {
  node: TNode
  path: TNode[]
  remainingNibbles: number[]
}
export async function _getNodePath(
  this: MerklePatriciaTrie,
  keyNibbles: number[],
  debug: Debugger
): Promise<WalkResult> {
  debug = debug.extend('_getNodePath')
  let nibbleIndex = 0
  let currentNode: TNode = await this.rootNode()
  // const keyNibbles = bytesToNibbles(key)
  const path = [currentNode]
  debug(`From Root: ${currentNode.getType()} [${currentNode.getPartialKey()}]`)
  debug(`Seeking Node Path: [${keyNibbles}]`)
  while (currentNode.type !== 'NullNode') {
    if (currentNode.getType() === 'ProofNode') {
      currentNode = (await this.lookupNodeByHash(currentNode.hash())) ?? currentNode
    }
    debug = debug.extend(currentNode.getType())
    debug(`Pushing ${currentNode.getType()} to path`)
    let childIndex: number | undefined
    path.push(currentNode)
    let childNode: TNode | undefined
    let nodeNibbles: number[]
    let sharedNibbles: number[]
    if (currentNode.getType() === 'ProofNode') {
      currentNode = (await this.lookupNodeByHash(currentNode.hash())) ?? currentNode
    }
    switch (currentNode.type) {
      case 'BranchNode':
        currentNode = currentNode as BranchNode
        childIndex = keyNibbles[nibbleIndex]
        if (childIndex === undefined) {
          debug(`Child at index ${nibbleIndex} is undefined, returning`)
          return {
            node: currentNode as BranchNode,
            path,
            remainingNibbles: keyNibbles.slice(nibbleIndex),
          }
        }
        debug(`navigating to child at index [${keyNibbles[nibbleIndex]}]`)
        childNode = await (currentNode as BranchNode).getChild(childIndex)
        debug(`found child: ${childNode.getType()}`)
        debug = debug.extend(`[${childIndex}]`)
        if (childNode.getType() === 'NullNode') {
          debug.extend(`${childIndex}`)(`Child not found, returning`)
          return { node: new NullNode({}), path, remainingNibbles: keyNibbles.slice(nibbleIndex) }
        } else {
          nibbleIndex++
          currentNode = childNode
        }
        break
      case 'ExtensionNode':
        debug = debug.extend(`[${currentNode.getPartialKey()}]`)
        currentNode = currentNode as ExtensionNode
        nodeNibbles = currentNode.getPartialKey()
        sharedNibbles = keyNibbles.slice(nibbleIndex, nibbleIndex + nodeNibbles.length)
        debug(`keyNibbles: ${keyNibbles}`)
        debug(`nodeNibbles: ${nodeNibbles}`)
        debug(`sharedNibbles: ${sharedNibbles}`)
        if (doKeysMatch(nodeNibbles, sharedNibbles)) {
          debug(`Shared nibbles match entirely.`)
          nibbleIndex += nodeNibbles.length
          if (nibbleIndex === keyNibbles.length) {
            let child = await currentNode.getChild()
            debug(`Reached end of key with ExtensionNode child: ${child.getType()}`)
            if (child.getType() === 'ProofNode') {
              child = (await (child as ProofNode).load()) ?? child
            }
            return { node: child, path, remainingNibbles: [] }
          }
          currentNode = await currentNode.getChild()
        } else if (nodeNibbles.length !== sharedNibbles.length) {
          debug(`Shared nibbles do not match entirely.`)
          nibbleIndex += sharedNibbles.length
          return {
            node: currentNode.child,
            path,
            remainingNibbles: keyNibbles.slice(nibbleIndex),
          }
        } else {
          debug.extend(currentNode.getType())(`Shared nibbles do not match.`)
          return {
            node: new NullNode({ hashFunction: this.hashFunction }),
            path,
            remainingNibbles: keyNibbles.slice(nibbleIndex),
          }
        }
        break
      case 'LeafNode':
        currentNode = currentNode as LeafNode
        if (doKeysMatch(keyNibbles.slice(nibbleIndex), currentNode.getPartialKey())) {
          debug.extend(currentNode.getType())(`Nibbles Match`)
          return { node: currentNode, path, remainingNibbles: [] }
        } else {
          debug(`Nibbles Do Not Match`)
          return {
            node: new NullNode({ hashFunction: this.hashFunction }),
            path,
            remainingNibbles: keyNibbles.slice(nibbleIndex),
          }
        }
      case 'ProofNode':
        currentNode = (await currentNode.load()) ?? currentNode
        if (currentNode.getType() === 'ProofNode') {
          this.debug(`Can't resolve ProofNode with nibbles${currentNode.getPartialKey()}`)
          return { node: currentNode, path, remainingNibbles: keyNibbles.slice(nibbleIndex) }
        }
    }
    debug(`NextNode: ${currentNode.getType()}: [${currentNode.getPartialKey()}]`)
  }
  debug(`Returning NullNode`)
  return {
    node: new NullNode({ hashFunction: this.hashFunction }),
    path,
    remainingNibbles: keyNibbles.slice(nibbleIndex),
  }
}
