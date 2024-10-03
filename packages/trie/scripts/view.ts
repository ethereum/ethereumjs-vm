import { debug as _debug } from 'debug'
import {
  bytesToHex,
  equalsBytes,
  hexToBytes,
  PrefixedHexString,
  utf8ToBytes,
} from '@ethereumjs/util'

import { BranchMPTNode, ExtensionMPTNode, LeafMPTNode } from '../node/index.js'
import { MerklePatriciaTrie } from '../trie.js'

import { _walkTrie } from './asyncWalk.js'

import type { MPTNode } from '../types.js'
import type { Debugger } from 'debug'

const debug = _debug('trieview') // cspell:disable-line
const delimiters = {
  0: debug.extend(''),
  1: debug.extend('::'),
  2: debug.extend('::::'),
  3: debug.extend('::::::'),
  4: debug.extend('::::::::'),
  5: debug.extend('::::::::::'),
} as const
type Delimiter = keyof typeof delimiters
const delimiter = (level: Delimiter): void => {
  delimiters[level]('-'.repeat(50 - level * 2))
}
const tNode = ['br', 'lf', 'ex', 'rt', 'nl', 'pf', 'vl'] as const
type TNode = (typeof tNode)[number]
const debugN = (type: TNode, d?: Debugger) => {
  d = d ?? debug
  const nodeDebuggers = {
    br: d.extend('BranchNode'),
    lf: d.extend('ExtensionNode'),
    ex: d.extend('LeafNode'),
    rt: d.extend('RootNode'),
    nl: d.extend('NullNode'),
    pf: d.extend('ProofNode'),
    vl: d.extend('ValueNode'),
  }
  return nodeDebuggers[type]
}
const debugT = debug.extend('Trie')

function getNodeType(node: MPTNode): TNode {
  return node instanceof BranchMPTNode
    ? 'br'
    : node instanceof ExtensionMPTNode
      ? 'ex'
      : node instanceof LeafMPTNode
        ? 'lf'
        : 'nl'
}

function logNode(trie: MerklePatriciaTrie, node: MPTNode, currentKey: number[]): void {
  delimiter(3)
  const type = getNodeType(node)
  if (equalsBytes(trie.hash(node.serialize()), trie.root())) {
    debugN('rt').extend(type)(
      `{ 0x${bytesToHex(trie.hash(node.serialize())).slice(
        0,
        12,
      )}... } ---- \uD83D\uDCA5  \u211B \u2134 \u2134 \u0164  \u0147 \u2134 \u0221 \u2211  \u2737`,
    )
  } else {
    debugN(type)(`{ 0x${bytesToHex(trie.hash(node.serialize())).slice(0, 12)}... } ----`)
  }
  debugT.extend('Walking')(`from [${currentKey}]`)
  if ('_nibbles' in node) {
    debugT(`to =>`, `[${node._nibbles}]`)
    debugT(`next key: [${[...currentKey, node._nibbles]}]`)
  } else if ('_branches' in node) {
    let first = true
    for (const [idx, k] of [...node._branches.entries()]
      .filter(([_, child]) => child !== null && child.length > 0)
      .map(([nibble, _]) => nibble)
      .entries()) {
      first || debugN('br').extend(idx.toString())('\uD83D\uDDD8  \u0026')
      first = false
      debugT(`to =>`, `[${k}]`)
      debugT(`next key: [${[...currentKey, [k]]}]`)
    }
  }
  delimiter(3)
}

export const view = async (testName: string, inputs: any[], root: string) => {
  const trie = new MerklePatriciaTrie()
  const expect = root
  const testKeys: Map<string, Uint8Array | null> = new Map()
  const testStrings: Map<string, [string, string | null]> = new Map()
  for await (const [idx, input] of inputs.entries()) {
    const stringPair: [string, string] = [inputs[idx][0], inputs[idx][1] ?? 'null']
    for (let i = 0; i < 2; i++) {
      if (typeof input[i] === 'string' && input[i].slice(0, 2) === '0x') {
        input[i] = hexToBytes(input[i])
      } else if (typeof input[i] === 'string') {
        input[i] = utf8ToBytes(input[i])
      }
    }
    try {
      await trie.put(input[0], input[1])
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      debugT(`trie.put error: ${e.message}`)
    }
    trie.checkpoint()
    await trie.commit()
    trie.flushCheckpoints()
    testKeys.set(bytesToHex(input[0]), input[1])
    testStrings.set(bytesToHex(input[0]), stringPair)
    for await (const [key, _val] of testKeys.entries()) {
      const retrieved = await trie.get(hexToBytes(key as PrefixedHexString))
      debugT.extend('get')(
        `[${key}]: ${retrieved && equalsBytes(retrieved, hexToBytes(key as PrefixedHexString))}`,
      )
    }
  }
  debugT(bytesToHex(trie.root()), expect)
  const walker = trie.walkTrieIterable(trie.root(), [])
  delimiter(4)
  debug.extend('TEST_NAME')(testName)
  for await (const { currentKey, node } of walker) {
    logNode(trie, node, currentKey)
  }
}
