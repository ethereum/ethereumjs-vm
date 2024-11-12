import { createBlock } from '@ethereumjs/block'
import { createBlockchain } from '@ethereumjs/blockchain'
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { createLegacyTx } from '@ethereumjs/tx'
import {
  Account,
  Address,
  BIGINT_1,
  bigIntToBytes,
  bigIntToHex,
  bytesToHex,
  createAddressFromPublicKey,
  createAddressFromString,
  equalsBytes,
  generateAddress,
  privateToAddress,
  setLengthLeft,
} from '@ethereumjs/util'
import { hexToBytes } from 'ethereum-cryptography/utils'
import { assert, describe, it } from 'vitest'

import { bytesToBigInt } from '../../../../util/src/bytes.js'
import { BIGINT_0 } from '../../../../util/src/constants.js'
import { buildBlock, createVM, paramsVM, runBlock, runTx } from '../../../src/index.js'

import type { Block } from '@ethereumjs/block'
import type { LegacyTxData } from '@ethereumjs/tx'
import type { PrefixedHexString } from '@ethereumjs/util'
import type { VM } from '../../../src/index.js'

function eip2935ActiveAtCommon(timestamp: number, address: bigint) {
  const hfs = [
    Hardfork.Chainstart,
    Hardfork.Homestead,
    Hardfork.Dao,
    Hardfork.Chainstart,
    Hardfork.SpuriousDragon,
    Hardfork.Byzantium,
    Hardfork.Constantinople,
    Hardfork.Petersburg,
    Hardfork.Istanbul,
    Hardfork.Berlin,
    Hardfork.London,
    Hardfork.ArrowGlacier,
    Hardfork.GrayGlacier,
    Hardfork.Shanghai,
    Hardfork.Paris,
    Hardfork.MergeForkIdTransition,
    Hardfork.Shanghai,
    Hardfork.Cancun,
  ]
  const hardforks = []
  for (const hf of hfs) {
    hardforks.push({
      name: hf,
      block: 0,
    })
  }
  hardforks.push({
    name: 'testEIP2935Hardfork',
    block: null,
    timestamp,
  })
  const c = createCustomCommon(
    {
      customHardforks: {
        testEIP2935Hardfork: {
          eips: [2935, 7709],
          params: {
            historyStorageAddress: bigIntToHex(address),
          },
        },
      },
      hardforks,
      /*genesis: {
      gasLimit: 30_000_000,
      timestamp: "0x0",
      extraData: "0x",
      difficulty: "0x0",
      nonce: "0x0000000000000000"
    }*/
    },
    Mainnet,
  )

  return c
}

const callerPrivateKey = hexToBytes(`0x${'44'.repeat(32)}`)
const callerAddress = new Address(privateToAddress(callerPrivateKey))
const PREBALANCE = BigInt(10000000)

// array of different deployment configurations
const deploymentConfigs = [
  // may 25 configuration with set on the lines of 4788
  [
    // contract code
    '0x3373fffffffffffffffffffffffffffffffffffffffe1460575767ffffffffffffffff5f3511605357600143035f3511604b575f35612000014311604b57611fff5f3516545f5260205ff35b5f5f5260205ff35b5f5ffd5b5f35611fff60014303165500',
    // deployment tx input
    '0x60648060095f395ff33373fffffffffffffffffffffffffffffffffffffffe1460575767ffffffffffffffff5f3511605357600143035f3511604b575f35612000014311604b57611fff5f3516545f5260205ff35b5f5f5260205ff35b5f5ffd5b5f35611fff60014303165500',
    // v r s
    ['0x1b', '0x539', '0x1b9b6eb1f0'],
    // sender, hash, deployed address
    [
      '0xe473f7e92ba2490e9fcbbe8bb9c3be3adbb74efc',
      '0x3c769a03d6e2212f1d26ab59ba797dce0900df29ffd23c1dd391fd6b217973ad',
      '0x0aae40965e6800cd9b1f4b05ff21581047e3f91e',
    ],
  ],
]

describe('EIP 2935: historical block hashes', () => {
  for (const deploymentConfig of deploymentConfigs) {
    const [
      contract2935CodeHex,
      deploymentTxData,
      [deploymentV, deploymentR, deploymentS],
      [deploymentSender, deploymentTxHash, deployedToAddress],
    ] = deploymentConfig

    const historyAddress = createAddressFromString(deployedToAddress)
    const historyAddressBigInt = bytesToBigInt(historyAddress.bytes)
    const contract2935Code = hexToBytes(contract2935CodeHex as string)

    // eslint-disable-next-line no-inner-declarations
    async function testBlockhashContract(vm: VM, block: Block, i: bigint): Promise<Uint8Array> {
      const tx = createLegacyTx({
        to: historyAddress,
        gasLimit: 1000000,
        gasPrice: 10,
        data: bytesToHex(setLengthLeft(bigIntToBytes(i), 32)),
      }).sign(callerPrivateKey)

      await vm.stateManager.putAccount(callerAddress, new Account())
      const account = await vm.stateManager.getAccount(callerAddress)
      account!.balance = PREBALANCE
      await vm.stateManager.putAccount(callerAddress, account!)
      await vm.stateManager.putCode(historyAddress, contract2935Code)

      const result = await runTx(vm, {
        tx,
        block,
        skipHardForkValidation: true,
      })
      const blockHash = result.execResult.returnValue
      return blockHash
    }

    it(`should validate the deployment tx`, async () => {
      const deployContractTxData: LegacyTxData = {
        type: '0x0',
        nonce: '0x0',
        gasLimit: '0x3d090',
        gasPrice: '0xe8d4a51000',
        value: '0x0',
        // input from the EIP is data here
        data: deploymentTxData as PrefixedHexString,
        v: deploymentV as PrefixedHexString,
        r: deploymentR as PrefixedHexString,
        s: deploymentS as PrefixedHexString,
      }

      const deployTx = createLegacyTx(deployContractTxData)
      const txSender = createAddressFromPublicKey(deployTx.getSenderPublicKey()).toString()
      assert.equal(txSender, deploymentSender, 'tx sender should match')

      const txHash = bytesToHex(deployTx.hash())
      assert.equal(txHash, deploymentTxHash, 'tx hash should match')

      // tx sender is a random address with likely no tx history
      const txToAddress = bytesToHex(generateAddress(hexToBytes(txSender), bigIntToBytes(BIGINT_0)))
      assert.equal(txToAddress, deployedToAddress, 'deployment address should match')
    })

    it('should save genesis block hash to the history block hash contract', async () => {
      const commonGenesis = eip2935ActiveAtCommon(1, historyAddressBigInt)
      const blockchain = await createBlockchain({
        common: commonGenesis,
        validateBlocks: false,
        validateConsensus: false,
      })
      const vm = await createVM({ common: commonGenesis, blockchain })
      // Ensure 2935 system code exists
      await vm.stateManager.putCode(historyAddress, contract2935Code)
      commonGenesis.setHardforkBy({
        timestamp: 1,
      })
      const genesis = (await vm.blockchain.getBlock(0)) as Block
      const { block } = await (
        await buildBlock(vm, {
          parentBlock: genesis,
          blockOpts: {
            putBlockIntoBlockchain: false,
          },
        })
      ).build()
      await vm.blockchain.putBlock(block)
      await runBlock(vm, { block, generate: true })

      const storage = await vm.stateManager.getStorage(
        historyAddress,
        setLengthLeft(bigIntToBytes(BigInt(0)), 32),
      )
      assert.ok(equalsBytes(storage, genesis.hash()))
    })
    it('should ensure blocks older than 256 blocks can be retrieved from the history contract', async () => {
      // Test: build a chain with 256+ blocks and then retrieve BLOCKHASH of the genesis block and block 1
      const blocksActivation = 256 // This ensures that only block 255 gets stored into the hash contract
      // More than blocks activation to build, so we can ensure that we can also retrieve block 0 or block 1 hash at block 300
      const blocksToBuild = 500
      const commonGetHistoryServeWindow = eip2935ActiveAtCommon(0, historyAddressBigInt)
      commonGetHistoryServeWindow.setEIPs([2935])
      commonGetHistoryServeWindow.updateParams(paramsVM)
      const common = eip2935ActiveAtCommon(blocksActivation, historyAddressBigInt)
      const historyServeWindow = commonGetHistoryServeWindow.param('historyServeWindow')

      const blockchain = await createBlockchain({
        common,
        validateBlocks: false,
        validateConsensus: false,
      })
      const vm = await createVM({ common, blockchain })
      // Ensure 2935 system code exists
      await vm.stateManager.putCode(historyAddress, contract2935Code)
      let lastBlock = (await vm.blockchain.getBlock(0)) as Block
      for (let i = 1; i <= blocksToBuild; i++) {
        const buildResult = await (
          await buildBlock(vm, {
            parentBlock: lastBlock,
            blockOpts: {
              putBlockIntoBlockchain: false,
              setHardfork: true,
            },
            headerData: {
              timestamp: lastBlock.header.number + BIGINT_1,
            },
          })
        ).build()
        lastBlock = buildResult.block
        await vm.blockchain.putBlock(lastBlock)
        await runBlock(vm, {
          block: lastBlock,
          generate: true,
          skipHeaderValidation: true,
          setHardfork: true,
        })
      }

      // swap out the blockchain to test from storage
      const blockchainEmpty = await createBlockchain({
        common,
        validateBlocks: false,
        validateConsensus: false,
      })
      ;(vm as any).blockchain = blockchainEmpty
      ;(vm.evm as any).blockchain = blockchainEmpty

      for (let i = 1; i <= blocksToBuild; i++) {
        const block = await blockchain.getBlock(i)
        const storage = await vm.stateManager.getStorage(
          historyAddress,
          setLengthLeft(bigIntToBytes(BigInt(i) % historyServeWindow), 32),
        )

        // we will evaluate on lastBlock where 7709 is active and BLOCKHASH
        // will look from the state if within 256 window
        const ret = await vm.evm.runCall({
          // Code: RETURN the BLOCKHASH of block i
          // PUSH(i) BLOCKHASH PUSH(32) MSTORE PUSH(64) PUSH(0) RETURN
          // Note: need to return a contract with starting zero bytes to avoid non-deployable contracts by EIP 3540
          data: hexToBytes('0x61' + i.toString(16).padStart(4, '0') + '4060205260406000F3'),
          block: lastBlock,
        })

        // contract will only have hashes between blocksActivation -1 and blocksToBuild -1 threshold by
        // historyServeWindow window
        if (
          i >= blocksActivation - 1 &&
          i <= blocksToBuild - 1 &&
          i >= blocksToBuild - Number(historyServeWindow)
        ) {
          assert.ok(equalsBytes(setLengthLeft(storage, 32), block.hash()))
          if (i >= blocksToBuild - 256) {
            assert.ok(equalsBytes(ret.execResult.returnValue, setLengthLeft(block.hash(), 64)))
          } else {
            assert.ok(equalsBytes(ret.execResult.returnValue, new Uint8Array(64)))
          }
        } else {
          assert.ok(equalsBytes(ret.execResult.returnValue, new Uint8Array(64)))
        }
      }

      // validate the contract code cases
      // const result = await runTx(vm, { tx, block, skipHardForkValidation: true })
      const block = createBlock(
        {
          header: {
            baseFeePerGas: BigInt(7),
            number: blocksToBuild,
          },
        },
        { common },
      )

      // should be able to resolve blockhash via contract code but from the blocksActivation -1 onwards
      for (const i of [blocksActivation - 1, blocksActivation, blocksToBuild - 1]) {
        const blockHashI = await testBlockhashContract(vm, block, BigInt(i))
        const blockI = await blockchain.getBlock(i)
        assert.ok(equalsBytes(blockHashI, blockI.hash()))
      }

      // should be able to return 0 if input >= current block
      for (const i of [blocksToBuild, blocksToBuild + 100]) {
        const blockHashI = await testBlockhashContract(vm, block, BigInt(i))
        assert.ok(equalsBytes(blockHashI, setLengthLeft(bigIntToBytes(BigInt(0)), 32)))
      }
    })
  }
})
