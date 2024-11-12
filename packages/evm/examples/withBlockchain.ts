import { createBlockchain } from '@ethereumjs/blockchain'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createEVM } from '@ethereumjs/evm'
import { MerkleStateManager } from '@ethereumjs/statemanager'
import { bytesToHex, hexToBytes } from '@ethereumjs/util'

import type { PrefixedHexString } from '@ethereumjs/util'

const main = async () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai })
  const stateManager = new MerkleStateManager()
  const blockchain = await createBlockchain()

  const evm = await createEVM({
    common,
    stateManager,
    blockchain,
  })

  const stop = '00'
  const add = '01'
  const push1 = '60'

  // Note that numbers added are hex values, so '20' would be '32' as decimal e.g.
  const code = [push1, '03', push1, '05', add, stop]

  evm.events.on('step', (data) => {
    // Note that data.stack is not immutable, i.e. it is a reference to the vm's internal stack object
    console.log(`Opcode: ${data.opcode.name}\tStack: ${data.stack}`)
  })

  const results = await evm.runCode({
    code: hexToBytes(('0x' + code.join('')) as PrefixedHexString),
    gasLimit: BigInt(0xffff),
  })

  console.log(`Returned: ${bytesToHex(results.returnValue)}`)
  console.log(`gasUsed: ${results.executionGasUsed.toString()}`)
}

void main()
