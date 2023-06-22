// import { bytesToPrefixedHexString } from '@ethereumjs/util'

import { bytesToPrefixedHexString, hexStringToBytes } from '@ethereumjs/util'

import { BranchNode, ExtensionNode, LeafNode, NullNode, ProofNode } from '../trie/index.js'
import { nibblesCompare, nibblesEqual } from '../util/index.js'

import type { ProofDatabase } from '../db/index.js'
import type { NodeType, TNode } from '../trie/node/types.js'
import type { TrieWrap } from '../trie/trieWrapper.js'

// import { NullNode, ProofNode } from '../trie'
// import { BranchNode, ExtensionNode, LeafNode } from '../trie/node'
// import { nibblesCompare, nibblesEqual } from '../util/nibbles'

// import type { ProofDatabase } from '../db'
// import type { MerklePatriciaTrie } from '../trie/merklePatricia'
// import type { NodeType, TNode } from '../trie/node/types'
// import type { TrieWrap } from '../trie/trieWrapper'

export async function proofToPath(
  this: TrieWrap,
  rootHash: Uint8Array,
  root: TNode | null,
  key: number[],
  proofDb: ProofDatabase,
  allowNonExistent: boolean
): Promise<[TNode, Uint8Array] | [TNode | null, null]> {
  const resolveNode = async (hash: Uint8Array): Promise<[TNode | null, string | null]> => {
    let rlp = await proofDb.get(hash)
    if (rlp === undefined) {
      this.debug(`proof node (hash ${bytesToPrefixedHexString(hash)}) missing`)
      return [null, null]
    }
    rlp = rlp instanceof Uint8Array ? rlp : hexStringToBytes(rlp)
    const node = await this._decodeToNode(rlp)
    return [node, null]
  }

  if (root === null) {
    const [node] = await resolveNode(rootHash)
    if (!node) {
      return [null, null]
    }
    root = node
  }

  let child: TNode | null
  let parent: TNode | null
  let keyrest: number[]
  let valnode: Uint8Array | null = null
  parent = root
  while (parent !== null) {
    ;[keyrest, child] = await this.getChildOf(parent, key, false)
    if (child === null || child instanceof NullNode) {
      if (allowNonExistent) {
        return [root, null]
      }
      this.debug('the node is not contained in trie')
      return [null, null]
    } else if (child instanceof ExtensionNode || child instanceof BranchNode) {
      key = keyrest
      parent = child
      continue
    } else if (child instanceof ProofNode) {
      ;[child] = await resolveNode(child.rlpEncode())
      if (!child) {
        return [null, null]
      }
    } else if (child instanceof LeafNode) {
      valnode = child.rlpEncode()
    }
    if (parent instanceof ExtensionNode) {
      parent.updateChild(child)
    } else if (parent instanceof BranchNode) {
      parent.setChild(key[0], child)
    } else {
      throw new Error(`${typeof parent}: invalid node: ${parent}`)
    }
    if (valnode) {
      return [root, valnode]
    }
    key = keyrest
    parent = child
  }
  this.debug('this code should not be reachable')
  return [root, null]
}
export function hasRightElement(parent: TNode, key: number[], pos: number): boolean {
  let partial = []
  const _hasRightElement: Record<NodeType, () => boolean> = {
    BranchNode: () => {
      if (parent.getValue() !== null && pos === key.length) {
        return true
      }
      for (let i = key[pos] + 1; i < 16; i++) {
        if (parent.getChild(i) !== null) {
          return true
        }
      }
      return false
    },
    LeafNode: () => {
      partial = parent.getPartialKey()
      if (!nibblesEqual(partial, key.slice(pos, pos + partial.length))) {
        return nibblesCompare(partial, key.slice(pos)) > 0
      }
      return true
    },
    ExtensionNode: () => {
      parent = parent as ExtensionNode
      partial = parent.getPartialKey()
      if (!nibblesEqual(partial, key.slice(pos, pos + partial.length))) {
        return nibblesCompare(partial, key.slice(pos)) > 0
      }
      return hasRightElement(parent.child, key, pos + partial.length)
    },
    NullNode: () => {
      return false
    },
    ProofNode: () => {
      return false
    },
  }
  return _hasRightElement[parent.getType()]()
}
export async function getChildOf(
  this: TrieWrap,
  parent: TNode | null,
  key: number[],
  skipResolved: boolean
): Promise<[number[], TNode | null]> {
  while (parent) {
    if (parent instanceof ExtensionNode) {
      if (
        key.length < parent.getPartialKey().length ||
        !nibblesEqual(parent.getPartialKey(), key.slice(0, parent.getPartialKey().length))
      ) {
        return [[], null]
      }
      parent = parent.child
      key = key.slice(parent.getPartialKey().length)
      if (!skipResolved) {
        return [key, parent]
      }
    } else if (parent instanceof BranchNode) {
      parent = (await parent.getChild(key[0])) ?? null
      key = key.slice(1)
      if (!skipResolved) {
        return [key, parent]
      }
    } else if (parent instanceof ProofNode) {
      return [key, parent]
    } else if (parent === null) {
      return [key, null]
    } else if (parent instanceof LeafNode) {
      return [[], parent]
    } else {
      throw new Error('Node Get failed')
    }
  }
  // shouldn't get here right?
  return [key, parent]
}
export async function unset(
  parent: TNode,
  child: TNode,
  key: number[],
  pos: number,
  removeLeft: boolean
): Promise<Error | null> {
  const _unset: Record<NodeType, () => Promise<Error | null>> = {
    BranchNode: async () => {
      for (let i = removeLeft ? 0 : key[pos] + 1; i < (removeLeft ? key[pos] : 16); i++) {
        await child.deleteChild(i)
      }
      child.markDirty()
      return unset(child, await child.getChild(key[pos])!, key, pos + 1, removeLeft)
    },
    ExtensionNode: async () => {
      return null
    },
    LeafNode: async () => {
      const partial = child.getPartialKey()
      if (!nibblesEqual(partial, key.slice(pos, pos + partial.length))) {
        if (
          removeLeft
            ? nibblesCompare(partial, key.slice(pos)) < 0
            : nibblesCompare(partial, key.slice(pos)) > 0
        ) {
          await parent.deleteChild(key[pos - 1])
        }
        return null
      }
      return null
    },
    NullNode: async () => {
      return null
    },
    ProofNode: async () => {
      return null
    },
  }
  return _unset[child.getType()]()
}
export async function unsetInternal(
  this: TrieWrap,
  n: TNode | null,
  left: number[],
  right: number[]
): Promise<boolean> {
  const pos = 0
  const parent: TNode | null = null
  const shortForkLeft = 0,
    shortForkRight = 0
  while (n !== null) {
    if (n instanceof ExtensionNode || n instanceof BranchNode) {
      //   if (
      //     (shortForkLeft === -1 && shortForkRight === -1) ||
      //     (shortForkLeft === 1 && shortForkRight === 1)
      //   ) {
      //     this.debug.extend('_unsetInternal')('error: empty range')
      //     return false
      //   }
      if (shortForkLeft !== 0 && shortForkRight !== 0) {
        if (parent === null) {
          return true
        }
        await (parent as BranchNode).deleteChild(left[pos - 1])
        return false
      }
      //   if (shortForkLeft !== 0) {
      //     const childL = n.getChild(left[pos])!
      //     const err = await unset(n, childL, left, pos + 1, true)
      //     if (err !== null) {
      //       return true
      //     }
      //     if (!hasRightElement(n, left, pos + 1)) {
      //       if (parent === null) {
      //         return true
      //       }
      //       await (parent as BranchNode).deleteChild(left[pos - 1])
      //     }
      //     return false
      //   }
      if (shortForkRight !== 0) {
        const childR = await n.getChild(right[pos])!

        const err = await unset(n, childR, right, pos + 1, false)
        if (err !== null) {
          return false
        }
        if (parent !== null && !hasRightElement(n, right, pos + 1)) {
          await (parent as BranchNode).deleteChild(right[pos - 1])
        }
        return true
      }

      const childL = await n.getChild(left[pos])!
      const err = await unset(n, childL, left, pos + 1, true)
      if (err !== null) {
        return false
      }
      if (!hasRightElement(n, left, pos + 1)) {
        if (parent === null) {
          return true
        }
        await (parent as BranchNode).deleteChild(left[pos - 1])
        return false
      }
      const childR = await n.getChild(right[pos])!
      const errRight = await unset(n, childR, right, pos + 1, false)
      if (errRight !== null) {
        return false
      }
      if (parent !== null && !hasRightElement(n, right, pos + 1)) {
        await (parent as BranchNode).deleteChild(right[pos - 1])
      }
      return true
    } else if (n instanceof LeafNode) {
      // Check if the leaf's key falls within the range to remove
      if (
        nibblesCompare(n.getPartialKey(), left) >= 0 &&
        nibblesCompare(n.getPartialKey(), right) <= 0
      ) {
        // If parent is null, it means the root of the trie is the leaf node,
        // and it is in the range to be unset. In this case, the whole trie should be unset.
        if (parent === null) {
          return true
        }

        // If the leaf is in the range, unset it from the parent.
        // As parent can't be a LeafNode or HashNode (leaf is at the end of the path), it must be a BranchNode.
        await (parent as BranchNode).deleteChild(left[pos - 1])
      }
      return false
    } else {
      return false
      // throw new Error(`Invalid node: ${n}`);
    }
  }

  // probably wrong
  return true
}
