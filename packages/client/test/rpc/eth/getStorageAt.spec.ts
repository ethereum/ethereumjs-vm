import { Block } from '@ethereumjs/block'
import { Transaction } from '@ethereumjs/tx'
import { Account, Address, hexStringToBytes } from '@ethereumjs/util'
import * as tape from 'tape'

import { INVALID_PARAMS } from '../../../src/rpc/error-code'
import { baseRequest, params, setupChain } from '../helpers'
import { checkError } from '../util'

import pow = require('./../../testdata/geth-genesis/pow.json')

const method = 'eth_getStorageAt'

tape(`${method}: call with valid arguments`, async (t) => {
  const address = Address.fromString(`0x${'11'.repeat(20)}`)
  const emptySlotStr = `0x${'00'.repeat(32)}`

  const { execution, common, server, chain } = await setupChain(pow, 'pow')

  let req = params(method, [address.toString(), '0x0', 'latest'])
  let expectRes = (res: any) => {
    const msg = 'should return the empty slot for nonexistent account'
    t.equal(res.body.result, emptySlotStr, msg)
  }
  await baseRequest(t, server, req, 200, expectRes, false)

  await execution.vm.stateManager.putAccount(address, new Account())
  await execution.vm.stateManager.checkpoint()
  await execution.vm.stateManager.commit()

  req = params(method, [address.toString(), '0x0', 'latest'])
  expectRes = (res: any) => {
    const msg = 'should return the empty slot for nonexistent slot'
    t.equal(res.body.result, emptySlotStr, msg)
  }
  await baseRequest(t, server, req, 200, expectRes, false)

  const key = `0x${'01'.repeat(32)}`
  const value = `0x01`
  const valueAsBytes32 = `0x${'00'.repeat(31)}01`
  await execution.vm.stateManager.putContractStorage(
    address,
    hexStringToBytes(key),
    hexStringToBytes(value)
  )
  await execution.vm.stateManager.checkpoint()
  await execution.vm.stateManager.commit()

  req = params(method, [address.toString(), key, 'latest'])
  expectRes = (res: any) => {
    const msg = 'should return the correct slot value'
    t.equal(res.body.result, valueAsBytes32, msg)
  }
  await baseRequest(t, server, req, 200, expectRes, false)

  // sample contract from https://ethereum.stackexchange.com/a/70791
  const data =
    '0x608060405234801561001057600080fd5b506040516020806100ef8339810180604052602081101561003057600080fd5b810190808051906020019092919050505080600081905550506098806100576000396000f3fe6080604052600436106039576000357c010000000000000000000000000000000000000000000000000000000090048063a2a9679914603e575b600080fd5b348015604957600080fd5b5060506066565b6040518082815260200191505060405180910390f35b6000548156fea165627a7a72305820fe2ba3506418c87a075f8f3ae19bc636bd4c18ebde0644bcb45199379603a72c00290000000000000000000000000000000000000000000000000000000000000064'
  const expectedSlotValue = `0x${data.slice(data.length - 64)}`

  // construct block with tx
  const gasLimit = 2000000
  const tx = Transaction.fromTxData({ gasLimit, data }, { common, freeze: false })
  const signedTx = tx.sign(tx.getMessageToSign())
  const parent = await chain.blockchain.getCanonicalHeadHeader()
  const block = Block.fromBlockData(
    {
      header: {
        parentHash: parent.hash(),
        number: 1,
        gasLimit,
      },
    },
    { common, calcDifficultyFromHeader: parent }
  )
  block.transactions[0] = signedTx

  // deploy contract
  let ranBlock: Block | undefined = undefined
  execution.vm.events.once('afterBlock', (result: any) => (ranBlock = result.block))
  const result = await execution.vm.runBlock({ block, generate: true, skipBlockValidation: true })
  const { createdAddress } = result.results[0]
  await execution.vm.blockchain.putBlock(ranBlock!)

  // call with 'earliest' tag to see if getStorageAt allows addressing blocks that are older than the latest block by tag
  req = params(method, [createdAddress!.toString(), '0x0', 'earliest'])
  expectRes = (res: any) => {
    const msg =
      'should not have new slot value for block that is addressed by "earliest" tag and is older than latest'
    t.notEqual(res.body.result, expectedSlotValue, msg)
  }
  await baseRequest(t, server, req, 200, expectRes, false)

  // call with integer for block number to see if getStorageAt allows addressing blocks by number index
  req = params(method, [createdAddress!.toString(), '0x0', '0x1'])
  expectRes = (res: any) => {
    const msg =
      'should return the correct slot value when addressing the latest block by integer index'
    t.equal(res.body.result, expectedSlotValue, msg)
  }
  await baseRequest(t, server, req, 200, expectRes, false)

  // call with unsupported block argument
  req = params(method, [address.toString(), '0x0', 'pending'])
  expectRes = checkError(t, INVALID_PARAMS, '"pending" is not yet supported')
  await baseRequest(t, server, req, 200, expectRes)
})
