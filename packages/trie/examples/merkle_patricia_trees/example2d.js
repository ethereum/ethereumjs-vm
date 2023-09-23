// Example 2d - Creating and looking up an extension node

const { Trie } = require('../../dist/cjs') // We import the library required to create a basic Merkle Patricia Tree
const { bytesToHex, utf8ToBytes } = require('../../../util/dist/cjs')

const trie = new Trie() // We create an empty Merkle Patricia Tree

async function test() {
  console.log(bytesToHex(utf8ToBytes('testKey')))
  console.log(bytesToHex(utf8ToBytes('testKey0001')))
  console.log(bytesToHex(utf8ToBytes('testKey000A')))

  await trie.put(utf8ToBytes('testKey'), utf8ToBytes('testValue'))
  await trie.put(utf8ToBytes('testKey0001'), utf8ToBytes('testValue1'))
  await trie.put(utf8ToBytes('testKey000A'), utf8ToBytes('testValueA'))

  const node1 = await trie.findPath(utf8ToBytes('testKey'))
  console.log(node1.node) // The branch node
  console.log('Node: ', node1.node._branches[3]) // The address of our child node. Let's look it up:

  const node2 = await trie.lookupNode(node1.node._branches[3])
  console.log(node2) // An extension node!

  const node3 = await trie.lookupNode(node2._value)
  console.log(node3)
}

test()
