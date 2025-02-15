import { Chain, Common, Hardfork } from '@ethereumjs/common'
import {
  Account,
  Address,
  BIGINT_0,
  bytesToBigInt,
  bytesToHex,
  bytesToUnprefixedHex,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
  toBytes,
} from '@ethereumjs/util'
import { assert } from 'vitest'

import { EVM } from '../../src/index.js'
import { eipOpcodes, hardforkOpcodes, opcodes } from '../../src/opcodes/codes.js'

import type { EVMRunCodeOpts } from '../../src/index.js'

const allHardforks = Object.keys(Hardfork)

export type Expected = string | 'fails' | number | bigint | Uint8Array
export type InputStackItems = (number | bigint | Uint8Array)[]
// The Initial Memory items are a list of arrays which will then will all be left-padded until 32 zeros
export type InitialMemoryItems = InputStackItems
export type TestReturnType = 'topStack' | 'memory' | 'none'

export type PreState = {
  [address: string]: {
    code?: string
    nonce?: string
    storage?: {
      [key: string]: string
    }
    balance?: string
  }
}

export type OpcodeTests = {
  [opcodeName: string]: {
    stack?: InputStackItems
    expected: Expected
    expectedReturnType?: TestReturnType
    name?: string
    initMem?: InitialMemoryItems
    evmOpts?: EVMRunCodeOpts
    preState?: PreState
  }[]
}

type OpcodeTestOpts = {
  hardforks?: Hardfork[]
  testName?: string
  opcodeName: string
  expected: Expected
  expectedReturnType: TestReturnType
  input?: InputStackItems
  gasLimit?: bigint
  initMem?: InitialMemoryItems
  evmOpts?: EVMRunCodeOpts
  preState?: PreState
}

const defaultOpcodeTestOpts: Partial<OpcodeTestOpts> = {
  hardforks: [Hardfork.Shanghai],
  gasLimit: BigInt(30_000_000),
  initMem: [],
  input: [],
}

type TestOpts = {
  hardforks?: Hardfork[] | 'all'
  testName: string
  testCode: string
  profile?: boolean
  profileOpcode?: string | false
  gasLimit?: bigint
}

const defaultTestOpts: Partial<TestOpts> = {
  hardforks: [Hardfork.Shanghai],
  profile: false,
  profileOpcode: false,
  gasLimit: BigInt(30_000_00),
}

function removeHexPrefix(input: string) {
  while (input.startsWith('0x')) {
    input = input.slice(2)
  }
  return input
}

async function setupPreState(evm: EVM, preState: PreState) {
  for (const addressString in preState) {
    const address = Address.fromString(addressString)
    const fields = preState[addressString]
    const account = (await evm.stateManager.getAccount(address)) ?? new Account()
    if (fields.balance !== undefined) {
      account.balance = bytesToBigInt(hexToBytes(fields.balance))
    }
    if (fields.nonce !== undefined) {
      account.nonce = bytesToBigInt(hexToBytes(fields.nonce))
    }
    await evm.stateManager.putAccount(address, account)
    if (fields.code !== undefined) {
      await evm.stateManager.putContractCode(address, hexToBytes(fields.code))
    }
    if (fields.storage !== undefined) {
      for (const keyString in fields.storage) {
        await evm.stateManager.putContractStorage(
          address,
          setLengthLeft(hexToBytes(keyString), 32),
          setLengthLeft(hexToBytes(fields.storage[keyString]), 32)
        )
      }
    }
  }
}

export function getOpcodeByte(name: string) {
  for (const opNumber in opcodes) {
    const opcode = opcodes[opNumber]
    if (opcode.name === name) {
      return parseInt(opNumber).toString(16).padStart(2, '0')
    }
  }
  for (const entry of hardforkOpcodes) {
    for (const opNumber in entry.opcodes) {
      const opcode = entry.opcodes[opNumber]
      if (opcode.name === name) {
        return parseInt(opNumber).toString(16).padStart(2, '0')
      }
    }
  }
  for (const entry of eipOpcodes) {
    for (const opNumber in entry.opcodes) {
      const opcode = entry.opcodes[opNumber]
      if (opcode.name === name) {
        return parseInt(opNumber).toString(16).padStart(2, '0')
      }
    }
  }
  throw new Error(`Opcode ${name} not found`)
}

function getPush(toPush: number | bigint | Uint8Array) {
  if (typeof toPush === 'number') {
    toPush = BigInt(toPush)
  }
  if (toPush === BIGINT_0) {
    return '6000'
  } else {
    const bytes = toBytes(toPush)
    if (bytes.length === 0) {
      return '6000'
    } else {
      if (bytes.length > 32) {
        throw new Error(
          `Cannot push item, bytes length of ${bytes.length} larger than max of 32 bytes`
        )
      }
      return (0x60 + bytes.length - 1).toString(16) + bytesToUnprefixedHex(bytes)
    }
  }
}

export function getInitMemoryOpcodes(initMem: (number | bigint | Uint8Array)[]) {
  let i = BigInt(0)
  let output = ''
  for (const item of initMem) {
    output += getPush(item)
    output += getPush(i)
    output += '52' // MSTORE opcode
    i += BigInt(32)
  }
  return output
}

/**
 * Setups stack items in the EVM
 * @param stack Stack items to push. The first item of the stack is the topmost item of the resulting stack
 * @returns Hex string output to setup this stack
 */
export function initStack(stack: (number | bigint | Uint8Array)[]) {
  stack = stack.map((e) => {
    if (typeof e === 'number') {
      return BigInt(e)
    } else {
      return e
    }
  })
  let output = ''
  for (const entry of stack.reverse()) {
    output += getPush(entry)
  }
  return output
}

// String to return the topmost stack item from the current frame
export const returnStackItem = '60005260206000F3'

// String to return the contents of memory
export const returnMemory = '596000F3'

/**
 * Returns code which loops forever
 */
export function makeLoopCode(input: string) {
  return '0x5B' + removeHexPrefix(input) + '600056'
}

export function createBytecode(input: string[]) {
  return '0x' + input.join('')
}

export function createOpcodeTest(
  input: InputStackItems,
  opcodeName: string,
  returnType: TestReturnType = 'topStack',
  initialMemory: InitialMemoryItems = []
) {
  const opcode = getOpcodeByte(opcodeName)
  const inputStack = initStack(<(bigint | Uint8Array)[]>input)
  const initMem = getInitMemoryOpcodes(initialMemory)
  let returnCode = ''
  switch (returnType) {
    case 'topStack':
      returnCode = returnStackItem
      break
    case 'memory':
      returnCode = returnMemory
      break
  }
  return createBytecode([initMem, inputStack, opcode, returnCode])
}

export async function runTest(opts: TestOpts) {
  opts = {
    ...defaultTestOpts,
    ...opts,
  }
  const { hardforks, testCode, gasLimit } = <Required<TestOpts>>opts

  const hfs = hardforks === 'all' ? allHardforks : hardforks
  for (const hf of hfs) {
    const common = new Common({ chain: Chain.Mainnet, hardfork: hf })
    const evm = new EVM({
      common,
    })
    await evm.runCode({
      code: hexToBytes(testCode),
      gasLimit,
    })
  }
}

export function getOpcodeTestName(opcodeName: string, stack: InputStackItems, testName?: string) {
  if (testName === undefined) {
    return `${opcodeName}: ${stack.join()}`
  } else {
    return `${opcodeName}: ${testName}`
  }
}

export async function runOpcodeTest(opts: OpcodeTestOpts) {
  opts = {
    ...defaultOpcodeTestOpts,
    ...opts,
  }
  const {
    hardforks,
    gasLimit,
    expected,
    input,
    expectedReturnType,
    opcodeName,
    initMem,
    evmOpts,
    preState,
  } = <Required<OpcodeTestOpts>>opts
  const code = createOpcodeTest(input, opcodeName, expectedReturnType, initMem)
  for (const hf of hardforks) {
    const common = new Common({ chain: Chain.Mainnet, hardfork: hf })
    const evm = new EVM({
      common,
    })
    if (preState !== undefined) {
      await setupPreState(evm, preState)
    }
    const result = await evm.runCode({
      code: hexToBytes(code),
      gasLimit,
      ...evmOpts,
    })
    if (expected === 'fails') {
      if (result.exceptionError !== undefined) {
        assert.fail(`Test ${opts.testName} should throw, but did not throw`)
      }
    } else {
      let expectedReturn: Uint8Array
      if (opts.expected === 0 || opts.expected === BigInt(0)) {
        if (expectedReturnType === 'topStack') {
          expectedReturn = new Uint8Array(32)
        } else {
          expectedReturn = new Uint8Array()
        }
      } else {
        expectedReturn = toBytes(opts.expected)
      }
      expectedReturn = setLengthLeft(expectedReturn, Math.ceil(expectedReturn.length / 32) * 32)
      assert.ok(
        equalsBytes(result.returnValue, expectedReturn),
        `Test ${getOpcodeTestName(
          opcodeName,
          input,
          opts.testName
        )} failed. Output expected: ${bytesToHex(expectedReturn)}, got ${bytesToHex(
          result.returnValue
        )}, hardfork: ${hf}, input code: ${code}`
      )
    }
  }
}
