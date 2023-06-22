import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { DefaultStateManager } from '@ethereumjs/statemanager'
import { bytesToHex, hexStringToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { EVM } from '../../src'

type Situation = {
  pre: string
  post: string
  dst: number
  src: number
  length: number
}

const situations: Situation[] = [
  {
    pre: '0000000000000000000000000000000000000000000000000000000000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    post: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    dst: 0,
    src: 32,
    length: 32,
  },
  {
    pre: '0101010101010101010101010101010101010101010101010101010101010101',
    post: '0101010101010101010101010101010101010101010101010101010101010101',
    dst: 0,
    src: 0,
    length: 32,
  },
  {
    pre: '0001020304050607080000000000000000000000000000000000000000000000',
    post: '0102030405060708080000000000000000000000000000000000000000000000',
    dst: 0,
    src: 1,
    length: 8,
  },
  {
    pre: '0001020304050607080000000000000000000000000000000000000000000000',
    post: '0000010203040506070000000000000000000000000000000000000000000000',
    src: 1,
    dst: 0,
    length: 8,
  },
]

function numToOpcode(num: number) {
  return num.toString(16).padStart(2, '0')
}

const PUSH1 = '60'
const MSTORE8 = '53'
const MCOPY = '5E'
const STOP = '00'

describe('should test mcopy', () => {
  for (const situation of situations) {
    it('should produce correct output', async () => {
      // create bytecode
      let bytecode = ''
      // prepare the memory
      for (let i = 0; i < situation.pre.length / 2; i++) {
        const start = i * 2
        const hexNum = situation.pre.slice(start, start + 2)
        bytecode += PUSH1 + hexNum + PUSH1 + numToOpcode(i) + MSTORE8
      }
      // mcopy
      bytecode +=
        PUSH1 +
        numToOpcode(situation.length) +
        PUSH1 +
        numToOpcode(situation.src) +
        PUSH1 +
        numToOpcode(situation.dst)
      bytecode += MCOPY + STOP

      const common = new Common({
        chain: Chain.Mainnet,
        hardfork: Hardfork.Shanghai,
        eips: [5656],
      })

      const evm = await EVM.create({
        common,
        stateManager: new DefaultStateManager(),
      })

      let currentMem = ''

      evm.events.on('step', (e) => {
        console.log(e.opcode.name)
        if (e.opcode.name === 'STOP') {
          currentMem = bytesToHex(e.memory)
        }
      })

      await evm.runCall({
        data: hexStringToBytes(bytecode),
        gasLimit: BigInt(0xffffff),
      })

      assert.equal(currentMem, situation.post, 'post-memory correct')
    })
  }
})
