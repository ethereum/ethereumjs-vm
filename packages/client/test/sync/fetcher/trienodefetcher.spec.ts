import { RLP } from '@ethereumjs/rlp'
import { decodeNode } from '@ethereumjs/trie'
import { bytesToHex, hexToBytes } from '@ethereumjs/util'
import { OrderedMap } from '@js-sdsl/ordered-map'
import { assert, describe, it, vi } from 'vitest'

import { Chain } from '../../../src/blockchain/index.js'
import { Config } from '../../../src/config.js'
import { SnapProtocol } from '../../../src/net/protocol/index.js'
import { wait } from '../../integration/util.js'

import type { BranchMPTNode } from '@ethereumjs/trie'

// Collected from Sepolia:
// getTrieNodes({
//   root: '9100b295173da75cf0f160214e47b480abc2c9d2fe11330fe8befa69aac69656',
//   paths: [[Uint8Array.from([0])]],
//   bytes: BigInt(50000),
// })
const _trieNodesRLP =
  '0xf9021b01f90217b90214f90211a07d363fdc4ad4413321005a1981d415a872aed14651c159bea575d713fb1d1fd8a0d51e3a39747ab080d602e8dff07ed7fdf18fd5dd480b85ec8d5ebd86475481fba0382fbb965c19798b116e1b32ad64d99bdf09f8f4ed4c83e1b388ffad0ee8bc62a02ff7448b0092b7926a01bbb4f72e6f38366fdf109f3e9f8ac0794af3dc0e3de4a05db544523b1c10f8aead4252bff05665b8c7d21f02a102b51ac79acb6b3d2854a0cb0c46c37d6b44be6ff2204c4f4cea393099fefeae88cf5aa88195da74cca13fa014a5f2098033bb14420e78780d8288f64de1b9e03be643365b9ef6d174d63f56a082cbce67bd082cb430296662fb1f32aabe866dee947970877abaf4233eb0fb48a0828820316cc02bfefd899aba41340659fd06df1e0a0796287ec2a4110239f6d2a0be88e4724326382a8b56e2328eeef0ad51f18d5bae0e84296afe14c4028c4af9a0318016c98d991aca2d2dac23be0fe9dbfc34717279bbedf35cbd0aeb2a5ff280a091467954490d127631d2a2f39a6edabd702153de817fe8da2ab9a30513e5c6dda01c00f6abbb9bcb3ae9b12c887bc3ea3b13dba33a5dbad455c24778fa7d3ab01ea0899f71abb18c6c956118bf567fac629b75f7e9526873e429d3d8abb6dbb58021a00fd717235298742623c0b3cafb3e4bd86c0b5ab1f71097b4dd19f3d6925d758da0919728a770e275a906d7d71b2d9ae84b199e66f9987ad3282bfe045318de75e680'

describe('[TrieNodeFetcher]', async () => {
  class PeerPool {
    idle() {}
    ban() {}
  }
  PeerPool.prototype.idle = vi.fn()
  PeerPool.prototype.ban = vi.fn()

  const { TrieNodeFetcher } = await import('../../../src/sync/fetcher/trienodefetcher.js')

  it('should start/stop', async () => {
    const config = new Config({ maxPerRequest: 5 })
    const pool = new PeerPool() as any
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(0),
    })
    fetcher.next = () => false
    assert.notOk((fetcher as any).running, 'not started')
    assert.equal((fetcher as any).in.length, 0, 'No jobs have yet been added')
    assert.equal(
      (fetcher as any).pathToNodeRequestData.length,
      1,
      'one node request has been added',
    )

    void fetcher.fetch()
    await wait(100)
    assert.ok((fetcher as any).running, 'started')
    assert.ok(fetcher.write() === false, 'fetcher should not setup a new write pipe')
    fetcher.destroy()
    await wait(100)
    assert.notOk((fetcher as any).running, 'stopped')
  })

  it('should process', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(0),
    })
    const fullResult: any = [Uint8Array.from([0]), Uint8Array.from([1])]
    const NodeDataResponse: any = [Uint8Array.from([0]), Uint8Array.from([1])]
    NodeDataResponse.completed = true
    const task = {
      pathStrings: ['0', '1'],
      paths: [[Uint8Array.from([0])], [Uint8Array.from([1])]],
    }
    ;(fetcher as any).running = true
    fetcher.enqueueTask(task)
    const job = (fetcher as any).in.peek()
    assert.deepEqual(
      (fetcher.process(job, NodeDataResponse) as any)[0],
      fullResult[0],
      'got results',
    )
    assert.notOk(fetcher.process({} as any, { NodeDataResponse: [] } as any), 'bad results')
  })

  it('should request correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(0),
    })
    const partialResult: any = [Uint8Array.from([0]), Uint8Array.from([1])]

    const task = {
      pathStrings: ['0', '1'],
      paths: [[Uint8Array.from([0])], [Uint8Array.from([1])]],
    }
    const peer = {
      snap: {
        getTrieNodes: vi.fn((input) => {
          const expected = {
            root: new Uint8Array(0),
            paths: [[Uint8Array.from([0])], [Uint8Array.from([1])]],
            bytes: BigInt(50000),
          }
          assert.deepEqual(input, expected)
        }),
      },
      id: 'random',
      address: 'random',
      latest: vi.fn(),
    }
    const job = { peer, partialResult, task }
    await fetcher.request(job as any)
  })

  it('should generate child paths for node correctly', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const pool = new PeerPool() as any
    const p = new SnapProtocol({ config, chain })
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(),
    })

    fetcher.pathToNodeRequestData = new OrderedMap<string, any>()
    fetcher.pathToNodeRequestData.setElement('', {
      nodeHash: '9100b295173da75cf0f160214e47b480abc2c9d2fe11330fe8befa69aac69656',
      nodeParentHash: '', // root node does not have a parent
    })

    fetcher.requestedNodeToPath = new Map()
    fetcher.requestedNodeToPath.set(
      '9100b295173da75cf0f160214e47b480abc2c9d2fe11330fe8befa69aac69656',
      '',
    )

    const resData = RLP.decode(hexToBytes(_trieNodesRLP)) as unknown
    const res = p.decode(p.messages.filter((message) => message.name === 'TrieNodes')[0], resData)
    const { reqId, nodes } = res
    const mockedGetTrieNodes = vi.fn(() => {
      return { reqId, nodes }
    })

    const peer = {
      snap: { getTrieNodes: mockedGetTrieNodes },
      id: 'random',
      address: 'random',
      latest: vi.fn(),
    }
    const task = {
      pathStrings: [''],
      paths: [[Uint8Array.from([0])]],
    }
    const job = { peer, partialResult: [], task }
    const requestResult = (await fetcher.request(job as any)) as any
    assert.equal(
      requestResult[0][0],
      res.nodes[0],
      'Request phase should cross-validate received nodes with requested nodes',
    )

    await fetcher.store(requestResult)

    const rootNode = decodeNode(nodes[0] as unknown as Uint8Array) as BranchMPTNode
    const children = rootNode.getChildren()
    assert.equal(
      children.length,
      fetcher.pathToNodeRequestData.length,
      'Should generate requests for all child nodes',
    )
  })
  it('should not throw if undefined', async () => {
    const config = new Config()
    const pool = new PeerPool() as any
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(),
    })
    try {
      await fetcher.store(undefined as any)
      assert.ok('should run without error')
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      assert.fail(err.message)
    }
  })

  it('should find a fetchable peer', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    pool.idle = vi.fn(() => {
      return 'peer0'
    })
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(0),
    })
    assert.equal(fetcher.peer(), 'peer0' as any, 'found peer')
  })

  it('should return an array of tasks with pathStrings and paths', async () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(0),
    })

    fetcher.pathToNodeRequestData = new OrderedMap<string, any>()
    fetcher.pathToNodeRequestData.setElement('', {
      nodeHash: bytesToHex(new Uint8Array(0)),
      nodeParentHash: '',
    })

    const maxTasks = 1
    const tasks = fetcher.tasks(maxTasks)

    assert.equal(tasks.length, maxTasks, `should return ${maxTasks} tasks`)
    assert.equal(tasks[0].pathStrings.length, 1, 'should have pathStrings')
    assert.equal(tasks[0].paths.length, 1, 'should have paths')
  })

  it('should return an object with pathStrings', () => {
    const config = new Config({ accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const fetcher = new TrieNodeFetcher({
      config,
      pool,
      root: new Uint8Array(0),
    })

    fetcher.pathToNodeRequestData = new OrderedMap<string, any>()
    fetcher.pathToNodeRequestData.setElement('0x0b', {
      nodeHash: bytesToHex(new Uint8Array(0)),
      nodeParentHash: '', // root node does not have a parent
    })
    fetcher.pathToNodeRequestData.setElement('0x0a', {
      nodeHash: bytesToHex(new Uint8Array(0)),
      nodeParentHash: '', // root node does not have a parent
    })

    const result = fetcher.getSortedPathStrings()

    assert.deepEqual(result.pathStrings, ['0x0a', '0x0b'], 'should return pathStrings')
  })
})
