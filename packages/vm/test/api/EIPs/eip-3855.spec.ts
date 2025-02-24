import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { EVMErrorCode } from '@ethereumjs/evm'
import { hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createVM } from '../../../src/index.js'

describe('EIP 3855 tests', () => {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart, eips: [3855] })
  const commonNoEIP3855 = new Common({
    chain: Mainnet,
    hardfork: Hardfork.Chainstart,
    eips: [],
  })

  it('should correctly use push0 opcode', async () => {
    const vm = await createVM({ common })
    let stack: bigint[]
    vm.evm.events!.on('step', (e, resolve) => {
      stack = e.stack
      resolve?.()
    })

    const result = await vm.evm.runCode!({
      code: hexToBytes('0x5F00'),
      gasLimit: BigInt(10),
    })

    assert.ok(stack!.length === 1)
    assert.equal(stack![0], BigInt(0))
    assert.equal(result.executionGasUsed, common.param('push0Gas'))
  })

  it('should correctly use push0 to create a stack with stack limit length', async () => {
    const vm = await createVM({ common })
    let stack: bigint[] = []
    vm.evm.events!.on('step', (e, resolve) => {
      stack = e.stack
      resolve?.()
    })

    const depth = Number(common.param('stackLimit'))

    const result = await vm.evm.runCode!({
      code: hexToBytes(`0x${'5F'.repeat(depth)}00`),
      gasLimit: BigInt(10000),
    })

    assert.ok(stack.length === depth)
    for (const elem of stack) {
      if (elem !== BigInt(0)) {
        assert.fail('stack element is not 0')
      }
    }
    assert.equal(result.executionGasUsed, common.param('push0Gas')! * BigInt(depth))
  })

  it('should correctly use push0 to create a stack with stack limit + 1 length', async () => {
    const vm = await createVM({ common })

    const depth = Number(common.param('stackLimit')!) + 1

    const result = await vm.evm.runCode!({
      code: hexToBytes(`0x${'5F'.repeat(depth)}`),
      gasLimit: BigInt(10000),
    })

    assert.equal(result.exceptionError?.type.code, EVMErrorCode.STACK_OVERFLOW)
  })

  it('push0 is not available if EIP3855 is not activated', async () => {
    const vm = await createVM({ common: commonNoEIP3855 })

    const result = await vm.evm.runCode!({
      code: hexToBytes('0x5F'),
      gasLimit: BigInt(10000),
    })

    assert.equal(result.exceptionError!.type.code, EVMErrorCode.INVALID_OPCODE)
  })
})
