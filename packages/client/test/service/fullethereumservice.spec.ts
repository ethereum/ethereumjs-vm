import { Common, Hardfork } from '@ethereumjs/common'
import { TransactionFactory, TransactionType } from '@ethereumjs/tx'
import { hexStringToBytes, randomBytes } from '@ethereumjs/util'
import { equalsBytes, hexToBytes } from 'ethereum-cryptography/utils'
import * as td from 'testdouble'
import { assert, describe, it } from 'vitest'

import { Chain } from '../../src/blockchain'
import { Config } from '../../src/config'
import { Event } from '../../src/types'
import genesisJSON = require('../testdata/geth-genesis/post-merge.json')

import type { Log } from '@ethereumjs/evm'

describe('[FullEthereumService]', async () => {
  class PeerPool {
    open() {}
    close() {}
    start() {}
    stop() {}
  }
  PeerPool.prototype.open = td.func<any>()
  PeerPool.prototype.close = td.func<any>()
  PeerPool.prototype.start = td.func<any>()
  PeerPool.prototype.stop = td.func<any>()
  td.replace<any>('../../src/net/peerpool', { PeerPool })
  const MockChain = td.constructor([] as any)
  MockChain.prototype.open = td.func<any>()
  td.replace<any>('../../src/blockchain', { Chain: MockChain })
  const EthProtocol = td.constructor([] as any)
  const LesProtocol = td.constructor([] as any)
  td.replace<any>('../../src/net/protocol/ethprotocol', { EthProtocol })
  td.replace<any>('../../src/net/protocol/lesprotocol', { LesProtocol })
  class FullSynchronizer {
    start() {}
    stop() {}
    open() {}
    close() {}
    handleNewBlock() {}
    handleNewBlockHashes() {}
  }
  FullSynchronizer.prototype.start = td.func<any>()
  FullSynchronizer.prototype.stop = td.func<any>()
  FullSynchronizer.prototype.open = td.func<any>()
  FullSynchronizer.prototype.close = td.func<any>()
  FullSynchronizer.prototype.handleNewBlock = td.func<any>()
  FullSynchronizer.prototype.handleNewBlockHashes = td.func<any>()
  class BeaconSynchronizer {
    start() {}
    stop() {}
    open() {}
    close() {}
  }
  BeaconSynchronizer.prototype.start = td.func<any>()
  BeaconSynchronizer.prototype.stop = td.func<any>()
  BeaconSynchronizer.prototype.open = td.func<any>()
  BeaconSynchronizer.prototype.close = td.func<any>()
  td.replace<any>('../../src/sync', { FullSynchronizer, BeaconSynchronizer })

  class Block {
    static fromValuesArray() {
      return {}
    }
  }
  td.replace<any>('@ethereumjs/block', { Block })
  const { FullEthereumService } = await import('../../src/service/fullethereumservice')

  it('should initialize correctly', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    assert.ok(service.synchronizer instanceof FullSynchronizer, 'full mode')
    assert.equal(service.name, 'eth', 'got name')
  })

  it('should get protocols', async () => {
    let config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    let service = new FullEthereumService({ config, chain })
    assert.ok(service.protocols.filter((p) => p instanceof EthProtocol).length > 0, 'full protocol')
    assert.notOk(
      service.protocols.filter((p) => p instanceof LesProtocol).length > 0,
      'no light protocol'
    )
    config = new Config({ transports: [], lightserv: true })
    service = new FullEthereumService({ config, chain })
    assert.ok(service.protocols.filter((p) => p instanceof EthProtocol).length > 0, 'full protocol')
    assert.ok(
      service.protocols.filter((p) => p instanceof LesProtocol).length > 0,
      'lightserv protocols'
    )
  })

  it('should open', async () => {
    const server = td.object() as any
    const config = new Config({ servers: [server], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    await service.open()
    td.verify(service.synchronizer!.open())
    td.verify(server.addProtocols(td.matchers.anything()))
    service.config.events.on(Event.SYNC_SYNCHRONIZED, () => assert.ok(true, 'synchronized'))
    service.config.events.on(Event.SYNC_ERROR, (err) => {
      if (err.message === 'error0') assert.ok(true, 'got error 1')
    })
    service.config.events.emit(Event.SYNC_SYNCHRONIZED, BigInt(0))
    service.config.events.emit(Event.SYNC_ERROR, new Error('error0'))
    service.config.events.on(Event.SERVER_ERROR, (err) => {
      if (err.message === 'error1') assert.ok(true, 'got error 2')
    })
    service.config.events.emit(Event.SERVER_ERROR, new Error('error1'), server)
    await service.close()
  })

  it('should start/stop', async () => {
    const server = td.object() as any
    const config = new Config({ servers: [server], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })

    await service.start()

    td.verify(service.synchronizer!.start())
    assert.notOk(await service.start(), 'already started')
    await service.stop()
    td.verify(service.synchronizer!.stop())
    assert.notOk(await service.stop(), 'already stopped')
  })

  it('should correctly handle GetBlockHeaders', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    chain.getHeaders = () => [{ number: 1n }] as any
    const service = new FullEthereumService({ config, chain })
    await service.handle(
      {
        name: 'GetBlockHeaders',
        data: { reqId: 1, block: 5n, max: 1, skip: false, reverse: true },
      },
      'eth',
      {
        eth: {
          send: (title: string, msg: any) => {
            assert.ok(
              title === 'BlockHeaders' && msg.headers.length === 0,
              'sent empty headers when block height is too high'
            )
          },
        } as any,
      } as any
    )
    ;(service.chain as any)._headers = {
      height: 5n,
      td: null,
      latest: 5n,
    }

    await service.handle(
      {
        name: 'GetBlockHeaders',
        data: { reqId: 1, block: 1n, max: 1, skip: false, reverse: false },
      },
      'eth',
      {
        eth: {
          send: (title: string, msg: any) => {
            assert.ok(
              title === 'BlockHeaders' && msg.headers.length === 1,
              'sent 1 header when requested'
            )
          },
        } as any,
      } as any
    )
  })

  it('should call handleNewBlock on NewBlock and handleNewBlockHashes on NewBlockHashes', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    await service.handle({ name: 'NewBlock', data: [{}, BigInt(1)] }, 'eth', undefined as any)
    td.verify((service.synchronizer as any).handleNewBlock({}, undefined))
    await service.handle({ name: 'NewBlockHashes', data: [{}, BigInt(1)] }, 'eth', undefined as any)
    td.verify((service.synchronizer as any).handleNewBlockHashes([{}, BigInt(1)]))
    // should not call when using BeaconSynchronizer
    // (would error if called since handleNewBlock and handleNewBlockHashes are not available on BeaconSynchronizer)
    await service.switchToBeaconSync()
    assert.ok(service.synchronizer instanceof BeaconSynchronizer, 'switched to BeaconSynchronizer')
    assert.ok(service.beaconSync, 'can access BeaconSynchronizer')
    await service.handle({ name: 'NewBlock', data: [{}, BigInt(1)] }, 'eth', undefined as any)
    await service.handle({ name: 'NewBlockHashes', data: [{}, BigInt(1)] }, 'eth', undefined as any)
  })

  it('should ban peer for sending NewBlock/NewBlockHashes after merge', async () => {
    const common = new Common({ chain: 'mainnet', hardfork: Hardfork.Paris })
    const config = new Config({ common, transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    service.pool.ban = () => {
      assert.ok(true, 'banned peer when NewBlock/NewBlockHashes announced after Merge')
    }

    await service.handle({ name: 'NewBlock', data: [{}, BigInt(1)] }, 'eth', { id: 1 } as any)
    await service.handle({ name: 'NewBlockHashes', data: [] }, 'eth', { id: 1 } as any)
  })

  it('should send Receipts on GetReceipts', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    service.execution = {
      receiptsManager: { getReceipts: td.func<any>() },
    } as any
    const blockHash = new Uint8Array(32).fill(1)
    const receipts = [
      {
        status: 1 as 0 | 1,
        cumulativeBlockGasUsed: BigInt(100),
        bitvector: new Uint8Array(256),
        logs: [
          [
            new Uint8Array(20),
            [new Uint8Array(32), new Uint8Array(32).fill(1)],
            new Uint8Array(10),
          ],
        ] as Log[],
        txType: TransactionType.FeeMarketEIP1559,
      },
      {
        status: 0 as 0 | 1,
        cumulativeBlockGasUsed: BigInt(1000),
        bitvector: new Uint8Array(25).fill(1),
        logs: [
          [
            new Uint8Array(20).fill(1),
            [new Uint8Array(32).fill(1), new Uint8Array(32).fill(1)],
            new Uint8Array(10),
          ],
        ] as Log[],
        txType: TransactionType.Legacy,
      },
    ]
    td.when(service.execution.receiptsManager!.getReceipts(blockHash, true, true)).thenResolve(
      receipts
    )
    const peer = { eth: { send: td.func() } } as any
    await service.handle({ name: 'GetReceipts', data: [BigInt(1), [blockHash]] }, 'eth', peer)
    td.verify(peer.eth.send('Receipts', { reqId: BigInt(1), receipts }))
  })

  it('should handle Transactions', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    service.txPool.handleAnnouncedTxs = async (msg, _peer, _pool) => {
      assert.deepEqual(
        msg[0],
        TransactionFactory.fromTxData({ type: 2 }),
        'handled Transactions message'
      )
    }

    await service.handle(
      {
        name: 'Transactions',
        data: [TransactionFactory.fromTxData({ type: 2 })],
      },
      'eth',
      undefined as any
    )
  })

  it('should handle NewPooledTransactionHashes', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    service.txPool.handleAnnouncedTxHashes = async (msg, _peer, _pool) => {
      assert.deepEqual(msg[0], hexStringToBytes('0xabcd'), 'handled NewPooledTransactionhashes')
    }

    await service.handle(
      {
        name: 'NewPooledTransactionHashes',
        data: [hexToBytes('0xabcd')],
      },
      'eth',
      undefined as any
    )
  })

  it('should handle GetPooledTransactions', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const chain = await Chain.create({ config })
    const service = new FullEthereumService({ config, chain })
    ;(service.txPool as any).validate = () => {}

    const tx = TransactionFactory.fromTxData({ type: 2 }).sign(randomBytes(32))
    await service.txPool.add(tx)

    await service.handle(
      { name: 'GetPooledTransactions', data: { reqId: 1, hashes: [tx.hash()] } },
      'eth',
      {
        eth: {
          send: (_: string, data: any): any => {
            assert.ok(equalsBytes(data.txs[0].hash(), tx.hash()), 'handled getPooledTransactions')
          },
        } as any,
      } as any
    )
  })

  it('should start on beacon sync when past merge', async () => {
    const common = Common.fromGethGenesis(genesisJSON, { chain: 'post-merge' })
    common.setHardforkBy({ blockNumber: BigInt(0), td: BigInt(0) })
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000, common })
    const chain = await Chain.create({ config })
    let service = new FullEthereumService({ config, chain })
    assert.ok(service.beaconSync, 'beacon sync should be available')
    const configDisableBeaconSync = new Config({ transports: [], common, disableBeaconSync: true })
    service = new FullEthereumService({ config: configDisableBeaconSync, chain })
    assert.notOk(service.beaconSync, 'beacon sync should not be available')
  })

  it('should reset td', () => {
    td.reset()
  })
})
