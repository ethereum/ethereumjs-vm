import { Block } from '@ethereumjs/block'
import { BN, bufferToHex } from 'ethereumjs-util'
import tape from 'tape'
import { INVALID_PARAMS } from '../../../lib/rpc/error-code'
import { startRPC, createManager, createClient, params, baseRequest } from '../helpers'
import { checkError } from '../util'

const mockedTxData = {
  nonce: '0x',
  gasPrice: '0x',
  gasLimit: '0x',
  to: '0x',
  value: '0x',
  data: '0x',
  v: '0x',
  r: '0x',
  s: '0x',
}

function createChain() {
  const genesisBlockHash = Buffer.from(
    'dcf93da321b27bca12087d6526d2c10540a4c8dc29db1b36610c3004e0e5d2d5',
    'hex'
  )
  const blockHash = Buffer.from(
    'dcf93da321b27bca12087d6526d2c10540a4c8dc29db1b36610c3004e0e5d2d5',
    'hex'
  )
  const txHash = Buffer.from(
    'c6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b',
    'hex'
  )
  const txHash2 = Buffer.from(
    'a2285835057e8252ebd4980cf498f7538cedb3600dc183f1c523c6971b6889aa',
    'hex'
  )

  const transactions = [{ hash: bufferToHex(txHash) }]
  const transactions2 = [{ hash: bufferToHex(txHash2) }]
  const genesisBlock = {
    hash: () => genesisBlockHash,
    header: {
      number: new BN(0),
    },
    toJSON: () => ({ ...Block.fromBlockData({ header: { number: 0 } }).toJSON(), transactions }),
    transactions: [{ hash: () => txHash }],
    uncleHeaders: [],
  }
  const block = {
    hash: () => blockHash,
    header: {
      number: new BN(1),
    },
    toJSON: () => ({
      ...Block.fromBlockData({ header: { number: 1 } }).toJSON(),
      transactions: transactions2,
    }),
    transactions: [{ hash: () => txHash2, toJSON: () => mockedTxData }],
    uncleHeaders: [],
  }
  return {
    blocks: { latest: block },
    getBlock: () => genesisBlock,
    getLatestBlock: () => block,
    getLatestHeader: () => block.header,
    getTd: () => new BN(0),
  }
}

const method = 'eth_getBlockByNumber'

tape(`${method}: call with valid arguments`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['0x0', false])
  const expectRes = (res: any) => {
    const msg = 'should return a valid block'
    t.equal(res.body.result.number, '0x0', msg)
  }
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with false for second argument`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['0x0', false])
  const expectRes = (res: any) => {
    let msg = 'should return a valid block'
    t.equal(res.body.result.number, '0x0', msg)
    msg = 'should return only the hashes of the transactions'
    t.equal(typeof res.body.result.transactions[0], 'string', msg)
  }
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with earliest param`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['earliest', false])
  const expectRes = (res: any) => {
    const msg = 'should return the genesis block number'
    t.equal(res.body.result.number, '0x0', msg)
  }
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with latest param`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['latest', false])
  const expectRes = (res: any) => {
    const msg = 'should return a block number'
    t.equal(res.body.result.number, '0x1', msg)
  }
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with unimplemented pending param`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['pending', true])

  const expectRes = checkError(t, INVALID_PARAMS, '"pending" is not yet supported')
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with non-string block number`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, [10, true])
  const expectRes = checkError(t, INVALID_PARAMS, 'invalid argument 0: argument must be a string')
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with invalid block number`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['WRONG BLOCK NUMBER', true])
  const expectRes = checkError(
    t,
    INVALID_PARAMS,
    'invalid argument 0: block option must be a valid 0x-prefixed block hash or hex integer, or "latest", "earliest" or "pending"'
  )

  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call without second parameter`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['0x0'])
  const expectRes = checkError(t, INVALID_PARAMS, 'missing value for required argument 1')
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with invalid second parameter`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())

  const req = params(method, ['0x0', 'INVALID PARAMETER'])
  const expectRes = checkError(t, INVALID_PARAMS)
  await baseRequest(t, server, req, 200, expectRes)
})

tape(`${method}: call with transaction objects`, async (t) => {
  const manager = createManager(createClient({ chain: createChain() }))
  const server = startRPC(manager.getMethods())
  const req = params(method, ['latest', true])

  const expectRes = (res: any) => {
    const [transactionData] = res.body.result.transactions
    const { gasLimit: gas, data: input, ...txData } = mockedTxData
    t.deepEqual(transactionData, { ...txData, input, gas })
  }
  await baseRequest(t, server, req, 200, expectRes)
})
