import { PrioritizedTaskExecutor } from '@ethereumjs/util'

import { BranchMPTNode, ExtensionMPTNode, LeafMPTNode } from '../node/index.js'

import type { MerklePatriciaTrie } from '../trie.js'
import type { FoundNodeFunction, MPTNode, Nibbles } from '../types.js'

/**
 * WalkController is an interface to control how the trie is being traversed.
 */
export class WalkController {
  readonly onNode: FoundNodeFunction
  readonly taskExecutor: PrioritizedTaskExecutor
  readonly trie: MerklePatriciaTrie
  private resolve: Function
  private reject: Function

  /**
   * Creates a new WalkController
   * @param onNode - The `FoundNodeFunction` to call if a node is found.
   * @param trie - The `Trie` to walk on.
   * @param poolSize - The size of the task queue.
   */
  private constructor(onNode: FoundNodeFunction, trie: MerklePatriciaTrie, poolSize: number) {
    this.onNode = onNode
    this.taskExecutor = new PrioritizedTaskExecutor(poolSize)
    this.trie = trie
    this.resolve = () => {}
    this.reject = () => {}
  }

  /**
   * Async function to create and start a new walk over a trie.
   * @param onNode - The `FoundNodeFunction to call if a node is found.
   * @param trie - The trie to walk on.
   * @param root - The root key to walk on.
   * @param poolSize - Task execution pool size to prevent OOM errors. Defaults to 500.
   */
  static async newWalk(
    onNode: FoundNodeFunction,
    trie: MerklePatriciaTrie,
    root: Uint8Array,
    poolSize?: number,
  ): Promise<void> {
    const strategy = new WalkController(onNode, trie, poolSize ?? 500)
    await strategy.startWalk(root)
  }

  private async startWalk(root: Uint8Array): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      let node
      try {
        node = await this.trie.lookupNode(root)
      } catch (error) {
        if (!(error instanceof Error)) {
          error = new Error(error)
        }
        return this.reject(error)
      }
      this.processNode(root, node, [])
    })
  }

  /**
   * Run all children of a node. Priority of these nodes are the key length of the children.
   * @param node - Node to get all children of and call onNode on.
   * @param key - The current `key` which would yield the `node` when trying to get this node with a `get` operation.
   */
  allChildren(node: MPTNode, key: Nibbles = []) {
    if (node instanceof LeafMPTNode) {
      return
    }
    let children
    if (node instanceof ExtensionMPTNode) {
      children = [[node.key(), node.value()]]
    } else if (node instanceof BranchMPTNode) {
      children = node.getChildren().map((b) => [[b[0]], b[1]])
    }
    if (!children) {
      return
    }
    for (const child of children) {
      const keyExtension = child[0] as Nibbles
      const childRef = child[1] as Uint8Array
      const childKey = key.concat(keyExtension)
      const priority = childKey.length
      this.pushNodeToQueue(childRef, childKey, priority)
    }
  }

  /**
   * Push a node to the queue. If the queue has places left for tasks, the node is executed immediately, otherwise it is queued.
   * @param nodeRef - Push a node reference to the event queue. This reference is a 32-byte keccak hash of the value corresponding to the `key`.
   * @param key - The current key.
   * @param priority - Optional priority, defaults to key length
   */
  pushNodeToQueue(nodeRef: Uint8Array, key: Nibbles = [], priority?: number) {
    this.taskExecutor.executeOrQueue(
      priority ?? key.length,
      async (taskFinishedCallback: Function) => {
        let childNode
        try {
          childNode = await this.trie.lookupNode(nodeRef)
        } catch (error) {
          if (!(error instanceof Error)) {
            error = new Error(error)
          }
          return this.reject(error)
        }
        taskFinishedCallback() // this marks the current task as finished. If there are any tasks left in the queue, this will immediately execute the first task.
        this.processNode(nodeRef as Uint8Array, childNode as MPTNode, key)
      },
    )
  }

  /**
   * Push a branch of a certain BranchMPTNode to the event queue.
   * @param node - The node to select a branch on. Should be a BranchMPTNode.
   * @param key - The current key which leads to the corresponding node.
   * @param childIndex - The child index to add to the event queue.
   * @param priority - Optional priority of the event, defaults to the total key length.
   */
  onlyBranchIndex(node: BranchMPTNode, key: Nibbles = [], childIndex: number, priority?: number) {
    if (!(node instanceof BranchMPTNode)) {
      throw new Error('Expected branch node')
    }
    const childRef = node.getBranch(childIndex)
    if (!childRef) {
      throw new Error('Could not get branch of childIndex')
    }
    const childKey = key.slice() // This copies the key to a new array.
    childKey.push(childIndex)
    const prio = priority ?? childKey.length
    this.pushNodeToQueue(childRef as Uint8Array, childKey, prio)
  }

  private processNode(nodeRef: Uint8Array, node: MPTNode | null, key: Nibbles = []) {
    this.onNode(nodeRef, node, key, this)
    if (this.taskExecutor.finished()) {
      // onNode should schedule new tasks. If no tasks was added and the queue is empty, then we have finished our walk.
      this.resolve()
    }
  }
}
