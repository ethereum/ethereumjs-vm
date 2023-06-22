import { bytesToPrefixedHexString } from '@ethereumjs/util'
import { Readable } from 'readable-stream'

import { nibblesEqual } from '../../util/nibbles.js'
import { BranchNode, LeafNode } from '../node/index.js'

import type { FoundNodeFunction, WalkFilterFunction } from '../../types.js'
import type { TNode } from '../node/types.js'
import type { TrieWrap } from '../trieWrapper.js'

export class TrieReadStream extends Readable {
  private trie: TrieWrap
  private _started: boolean
  private nodeStream: AsyncIterator<{ node: TNode; currentKey: number[] }>
  private _nextValuePromise: Promise<IteratorResult<{ node: TNode; currentKey: number[] }>>
  constructor(trie: TrieWrap) {
    super({ objectMode: true })

    this.trie = trie
    this._started = false
    this.nodeStream = this.trie._walkTrieRecursively(this.trie.root())[Symbol.asyncIterator]()
    this._nextValuePromise = this.nodeStream.next()
  }

  async _read() {
    this.trie.debug.extend(`readStream`)('_read')

    this.trie.debug.extend(`readStream`)('starting')
    this._started = true
    let result: IteratorResult<{ node: TNode; currentKey: number[] }> = await this._nextValuePromise
    let done: boolean | undefined
    let value: { node: TNode; currentKey: number[] }
    do {
      result = await this._nextValuePromise
      done = result.done
      value = result.value
      this.trie.debug.extend(`readStream`)(
        `${
          done === true
            ? 'done'
            : `value: currentKey: ${value.currentKey}, node: ${value.node.getType()}}`
        }`
      )
      this._nextValuePromise = this.nodeStream.next()
      if (done === true) {
        this.push(null)
      } else if (value.node.getValue() && value.node.getValue()!.length > 0) {
        this.trie.debug.extend(`readStream`).extend(`${value.node.getType()}`)(
          `key: ${value.currentKey}}`
        )
        this.trie.debug.extend(`readStream`).extend(`${value.node.getType()}`)(
          `key that we're about to add: *`
        )

        this.trie.debug.extend(`readStream`).extend(`${value.node.getType()}`)(
          `value: ${value.node.getValue()}`
        )
        const key = [...value.currentKey]
        this.trie.debug.extend(`readStream`)(`key: ${key}`)
        if (!nibblesEqual(key, value.node.getPartialKey())) {
          key.push(...value.node.getPartialKey())
        }
        this.trie.debug.extend(`readStream`)(`key: ${key}`)
        const keyValue = {
          key: Uint8Array.from(key),
          value: value.node.getValue(),
        }
        this.trie.debug.extend(`readStream`).extend(`${value.node.getType()}`)(
          `key: ${bytesToPrefixedHexString(keyValue.key)}`
        )
        this.trie.debug.extend(`readStream`).extend(`${value.node.getType()}`)(
          `val: ${keyValue.value && bytesToPrefixedHexString(keyValue.value)}`
        )
        this.push(keyValue)
      }
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    } while (!done)
  }

  /**
   * Finds all nodes that store k,v values
   * called by {@link TrieReadStream}
   * @private
   */
  async _findValueNodes(onFound: (key: number[], value: Uint8Array) => Promise<void>) {
    const filter: WalkFilterFunction = async (node: TNode, _key: number[]) => {
      return node instanceof BranchNode || node instanceof LeafNode
    }

    const onFoundDuringWalk: FoundNodeFunction = async (node: TNode, key: number[]) => {
      const value = node.getValue()
      if (value && value.length > 0) {
        await onFound(key, value)
      }
    }

    const walk = async (node: TNode, currentKey: number[] = []) => {
      const fullKey = [...currentKey, ...node.getPartialKey()]

      if (await filter(node, fullKey)) {
        await onFoundDuringWalk(node, fullKey)
      }

      if (node.type === 'BranchNode') {
        for (const [nibble, childNode] of (await (node as BranchNode).childNodes()).entries()) {
          await walk(childNode, [...fullKey, nibble])
        }
      } else if (node.type === 'ExtensionNode') {
        await walk(await node.getChild(), [...fullKey])
      }
    }

    await walk(await this.trie.rootNode())
  }
}
