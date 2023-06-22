// The example does these things:
//
// 1. Instantiates a VM and a Blockchain
// 2. Creates the accounts from ../utils/blockchain-mock-data "pre" attribute
// 3. Creates a genesis block
// 4. Puts the blocks from ../utils/blockchain-mock-data "blocks" attribute into the Blockchain
// 5. Runs the Blockchain on the VM.

import {
  Account,
  Address,
  toBytes,
  setLengthLeft,
  bytesToPrefixedHexString,
} from '@ethereumjs/util'
import { Block } from '@ethereumjs/block'
import { Blockchain } from '@ethereumjs/blockchain'
import { Common, ConsensusType } from '@ethereumjs/common'
import { VM } from '@ethereumjs/vm'
//import testData from './helpers/blockchain-mock-data.json'
import { hexToBytes } from 'ethereum-cryptography/utils'

const testData = require('./helpers/blockchain-mock-data.json')
async function main() {
  const common = new Common({ chain: 1, hardfork: testData.network.toLowerCase() })
  const validatePow = common.consensusType() === ConsensusType.ProofOfWork
  const validateBlocks = true

  const genesisBlock = Block.fromBlockData({ header: testData.genesisBlockHeader }, { common })

  const blockchain = await Blockchain.create({
    common,
    validateConsensus: validatePow,
    validateBlocks,
    genesisBlock,
  })

  const vm = await VM.create({ blockchain, common })

  await setupPreConditions(vm, testData)

  await putBlocks(blockchain, common, testData)

  await blockchain.iterator('vm', async (block: Block, reorg: boolean) => {
    const parentBlock = await blockchain!.getBlock(block.header.parentHash)
    const parentState = parentBlock.header.stateRoot
    // run block
    await vm.runBlock({ block, root: parentState, skipHardForkValidation: true })
  })

  const blockchainHead = await vm.blockchain.getIteratorHead!()

  console.log('--- Finished processing the Blockchain ---')
  console.log('New head:', bytesToPrefixedHexString(blockchainHead.hash()))
  console.log('Expected:', testData.lastblockhash)
}

async function setupPreConditions(vm: VM, data: any) {
  await vm.stateManager.checkpoint()

  for (const [addr, acct] of Object.entries(data.pre)) {
    const { nonce, balance, storage, code } = acct as any

    const address = new Address(hexToBytes(addr.slice(2)))
    const account = Account.fromAccountData({ nonce, balance })
    await vm.stateManager.putAccount(address, account)

    for (const [key, val] of Object.entries(storage)) {
      const storageKey = setLengthLeft(hexToBytes(key), 32)
      const storageVal = hexToBytes(val as string)
      await vm.stateManager.putContractStorage(address, storageKey, storageVal)
    }

    const codeBuf = hexToBytes(code.slice(2))
    await vm.stateManager.putContractCode(address, codeBuf)
  }

  await vm.stateManager.commit()
}

async function putBlocks(blockchain: Blockchain, common: Common, data: typeof testData) {
  for (const blockData of data.blocks) {
    const blockRlp = toBytes(blockData.rlp)
    const block = Block.fromRLPSerializedBlock(blockRlp, { common })
    await blockchain.putBlock(block)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
