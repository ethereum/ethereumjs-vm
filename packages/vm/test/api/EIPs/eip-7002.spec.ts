import { createBlock } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { createLegacyTx } from '@ethereumjs/tx'
import {
  Account,
  bigIntToBytes,
  bytesToHex,
  concatBytes,
  createAddressFromPrivateKey,
  createAddressFromString,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
} from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { bytesToBigInt } from '../../../../util/src/bytes.js'
import { runBlock } from '../../../src/index.js'
import { setupVM } from '../utils.js'

import type { Block } from '@ethereumjs/block'

const pkey = hexToBytes(`0x${'20'.repeat(32)}`)
const addr = createAddressFromPrivateKey(pkey)

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun, eips: [7685, 7002] })

// Note: this deployment tx data is the deployment tx in order to setup the EIP-7002 contract
// It is taken from the EIP
const deploymentTxData = {
  nonce: BigInt(0),
  gasLimit: BigInt('0x3d090'),
  gasPrice: BigInt('0xe8d4a51000'),
  data: hexToBytes(
    '0x61049d5f5561013280600f5f395ff33373fffffffffffffffffffffffffffffffffffffffe146090573615156028575f545f5260205ff35b366038141561012e5760115f54600182026001905f5b5f82111560595781019083028483029004916001019190603e565b90939004341061012e57600154600101600155600354806003026004013381556001015f3581556001016020359055600101600355005b6003546002548082038060101160a4575060105b5f5b81811460dd5780604c02838201600302600401805490600101805490600101549160601b83528260140152906034015260010160a6565b910180921460ed579060025560f8565b90505f6002555f6003555b5f548061049d141561010757505f5b60015460028282011161011c5750505f610122565b01600290035b5f555f600155604c025ff35b5f5ffd',
  ),
  v: BigInt('0x1b'),
  r: BigInt('0x539'),
  s: BigInt('0xaba653c9d105790c'),
}

const deploymentTx = createLegacyTx(deploymentTxData)
const sender = deploymentTx.getSenderAddress()
const upfrontCost = deploymentTx.getUpfrontCost()
const acc = new Account()
acc.balance = upfrontCost

const validatorPubkey = hexToBytes(`0x${'20'.repeat(48)}`)
const amount = BigInt(12345678)
const amountBytes = setLengthLeft(bigIntToBytes(amount), 8)

function generateTx(nonce: bigint) {
  const addressBytes = setLengthLeft(
    bigIntToBytes(common.param('withdrawalRequestPredeployAddress')),
    20,
  )
  const withdrawalsAddress = createAddressFromString(bytesToHex(addressBytes))

  return createLegacyTx({
    nonce,
    gasPrice: BigInt(100),
    data: concatBytes(validatorPubkey, amountBytes),
    value: BigInt(1),
    to: withdrawalsAddress,
    gasLimit: 200_000,
  }).sign(pkey)
}

describe('EIP-7002 tests', () => {
  it('should correctly create requests', async () => {
    const vm = await setupVM({ common })
    const block = createBlock(
      {
        header: {
          number: 1,
        },
        transactions: [deploymentTx],
      },
      { common },
    )
    await vm.stateManager.putAccount(sender, acc)
    await vm.stateManager.putAccount(addr, acc)

    // Deploy withdrawals contract
    const results = await runBlock(vm, {
      block,
      skipHeaderValidation: true,
      skipBlockValidation: true,
      generate: true,
    })

    const root = results.stateRoot

    const tx = generateTx(BigInt(0))

    // Call withdrawals contract with a withdrawals request
    const block2 = createBlock(
      {
        header: {
          number: 2,
          parentBeaconBlockRoot: new Uint8Array(32),
        },
        transactions: [tx],
      },
      { common },
    )

    let generatedBlock: Block
    vm.events.on('afterBlock', (e) => {
      generatedBlock = e.block
    })

    await runBlock(vm, {
      block: block2,
      skipHeaderValidation: true,
      skipBlockValidation: true,
      generate: true,
    })

    // Ensure the request is generated
    assert.ok(generatedBlock!.requests!.length === 1)

    const requestDecoded = RLP.decode(generatedBlock!.requests![0].serialize().slice(1))

    const sourceAddressRequest = requestDecoded[0] as Uint8Array
    const validatorPubkeyRequest = requestDecoded[1] as Uint8Array
    const amountRequest = requestDecoded[2] as Uint8Array

    // Ensure the requests are correct
    assert.ok(equalsBytes(sourceAddressRequest, tx.getSenderAddress().bytes))
    assert.ok(equalsBytes(validatorPubkey, validatorPubkeyRequest))
    // the direct byte comparison fails because leading zeros have been stripped
    // off the amountBytes because it was serialized in request from bigint
    assert.equal(bytesToBigInt(amountBytes), bytesToBigInt(amountRequest))

    await runBlock(vm, { block: generatedBlock!, skipHeaderValidation: true, root })

    // Run block with 2 requests

    const tx2 = generateTx(BigInt(1))
    const tx3 = generateTx(BigInt(2))

    const block3 = createBlock(
      {
        header: {
          number: 3,
          parentBeaconBlockRoot: new Uint8Array(32),
        },
        transactions: [tx2, tx3],
      },
      { common },
    )

    await runBlock(vm, {
      block: block3,
      skipHeaderValidation: true,
      skipBlockValidation: true,
      generate: true,
    })

    // Note: generatedBlock is now overridden with the new generated block (this is thus block number 3)
    // Ensure there are 2 requests
    assert.ok(generatedBlock!.requests!.length === 2)
  })

  it('should throw when contract is not deployed', async () => {
    const vm = await setupVM({ common })
    const block = createBlock(
      {
        header: {
          number: 1,
        },
      },
      { common },
    )
    try {
      await runBlock(vm, {
        block,
        skipHeaderValidation: true,
        skipBlockValidation: true,
        generate: true,
      })
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      assert.ok(e.message.includes('Attempt to accumulate EIP-7002 requests failed'))
    }
  })
})
