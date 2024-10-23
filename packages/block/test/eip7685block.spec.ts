import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import {
  KECCAK256_RLP,
  SHA256_NULL,
  bytesToBigInt,
  createDepositRequest,
  createWithdrawalRequest,
  randomBytes,
} from '@ethereumjs/util'
import { sha256 } from 'ethereum-cryptography/keccak.js'
import { assert, describe, expect, it } from 'vitest'

import { genRequestsRoot } from '../src/helpers.js'
import {
  Block,
  createBlock,
  createBlockFromBytesArray,
  createBlockFromRPC,
  createBlockHeader,
} from '../src/index.js'

import type { JSONRPCBlock } from '../src/index.js'
import type { CLRequest, CLRequestType } from '@ethereumjs/util'

function getRandomDepositRequest(): CLRequest<CLRequestType> {
  const depositRequestData = {
    pubkey: randomBytes(48),
    withdrawalCredentials: randomBytes(32),
    amount: randomBytes(8),
    signature: randomBytes(96),
    index: randomBytes(8),
  }
  return createDepositRequest(depositRequestData) as CLRequest<CLRequestType>
}

function getRandomWithdrawalRequest(): CLRequest<CLRequestType> {
  const withdrawalRequestData = {
    sourceAddress: randomBytes(20),
    validatorPubkey: randomBytes(48),
    amount: bytesToBigInt(randomBytes(8)),
  }
  return createWithdrawalRequest(withdrawalRequestData) as CLRequest<CLRequestType>
}

const common = new Common({
  chain: Mainnet,
  hardfork: Hardfork.Cancun,
  eips: [7685, 4844, 4788],
})
describe('7685 tests', () => {
  it('should instantiate block with defaults', () => {
    const block = createBlock({}, { common })
    assert.deepEqual(block.header.requestsHash, SHA256_NULL)
    const block2 = new Block(undefined, undefined, undefined, undefined, { common })
    assert.deepEqual(block2.header.requestsHash, SHA256_NULL)
  })
  it('should instantiate a block with requests', async () => {
    const request = getRandomDepositRequest()
    const requestsHash = genRequestsRoot([request], sha256)
    const block = createBlock(
      {
        requests: [request],
        header: { requestsHash },
      },
      { common },
    )
    assert.equal(block.requests?.length, 1)
    assert.deepEqual(block.header.requestsHash, requestsHash)
  })
  it('RequestsRootIsValid should return false when requestsHash is invalid', async () => {
    const request = getRandomDepositRequest()
    const block = createBlock(
      {
        requests: [request],
        header: { requestsHash: randomBytes(32) },
      },
      { common },
    )

    assert.equal(await block.requestsTrieIsValid(), false)
  })
  it('should validate requests order', async () => {
    const request1 = getRandomDepositRequest()
    const request2 = getRandomDepositRequest()
    const request3 = getRandomWithdrawalRequest()
    const requests = [request1, request2, request3]
    const requestsHash = genRequestsRoot(requests, sha256)

    // Construct block with requests in correct order

    const block = createBlock(
      {
        requests,
        header: { requestsHash },
      },
      { common },
    )

    assert.ok(await block.requestsTrieIsValid())

    // Throws when requests are not ordered correctly
    await expect(async () =>
      createBlock(
        {
          requests: [request1, request3, request2],
          header: { requestsHash },
        },
        { common },
      ),
    ).rejects.toThrow('ascending order')
  })
})

describe('createWithdrawalFromBytesArray tests', () => {
  it('should construct a block with empty requests root', () => {
    const block = createBlockFromBytesArray(
      [createBlockHeader({}, { common }).raw(), [], [], [], []],
      {
        common,
      },
    )
    assert.deepEqual(block.header.requestsHash, KECCAK256_RLP)
  })
  it('should construct a block with a valid requests array', async () => {
    const request1 = getRandomDepositRequest()
    const request2 = getRandomWithdrawalRequest()
    const request3 = getRandomWithdrawalRequest()
    const requests = [request1, request2, request3]
    const requestsHash = genRequestsRoot(requests, sha256)
    const serializedRequests = [request1.serialize(), request2.serialize(), request3.serialize()]

    const block = createBlockFromBytesArray(
      [createBlockHeader({ requestsHash }, { common }).raw(), [], [], [], serializedRequests],
      {
        common,
      },
    )
    assert.deepEqual(block.header.requestsHash, requestsHash)
    assert.equal(block.requests?.length, 3)
  })
})

describe('fromRPC tests', () => {
  it('should construct a block from a JSON object', async () => {
    const request1 = getRandomDepositRequest()
    const request2 = getRandomDepositRequest()
    const request3 = getRandomWithdrawalRequest()
    const requests = [request1, request2, request3]
    const requestsHash = genRequestsRoot(requests, sha256)
    const serializedRequests = [request1.serialize(), request2.serialize(), request3.serialize()]

    const block = createBlockFromBytesArray(
      [createBlockHeader({ requestsHash }, { common }).raw(), [], [], [], serializedRequests],
      {
        common,
      },
    )
    const JSONBlock = block.toJSON()
    const RPCBlock = { ...JSONBlock.header, requests: JSONBlock.requests }
    const createBlockFromJSON = createBlockFromRPC(RPCBlock as JSONRPCBlock, undefined, { common })
    assert.deepEqual(block.hash(), createBlockFromJSON.hash())
  })
})
