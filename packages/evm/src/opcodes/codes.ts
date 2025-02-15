import { Hardfork } from '@ethereumjs/common'

import { handlers } from './functions.js'
import { dynamicGasHandlers } from './gas.js'
import { getFullname } from './util.js'

import type { CustomOpcode } from '../types.js'
import type { OpHandler } from './functions.js'
import type { AsyncDynamicGasHandler, SyncDynamicGasHandler } from './gas.js'
import type { Common } from '@ethereumjs/common'

export class Opcode {
  readonly code: number
  readonly name: string
  readonly fullName: string
  readonly fee: number
  readonly feeBigInt: bigint
  readonly isAsync: boolean
  readonly dynamicGas: boolean
  readonly isInvalid: boolean

  constructor({
    code,
    name,
    fullName,
    fee,
    isAsync,
    dynamicGas,
  }: {
    code: number
    name: string
    fullName: string
    fee: number
    isAsync: boolean
    dynamicGas: boolean
  }) {
    this.code = code
    this.name = name
    this.fullName = fullName
    this.fee = fee
    this.feeBigInt = BigInt(fee)
    this.isAsync = isAsync
    this.dynamicGas = dynamicGas
    this.isInvalid = this.name === 'INVALID'

    // Opcode isn't subject to change, thus all further modifications are prevented.
    Object.freeze(this)
  }
}

export type OpcodeList = Map<number, Opcode>
type OpcodeEntry = { [key: number]: { name: string; isAsync: boolean; dynamicGas: boolean } }
type OpcodeEntryFee = OpcodeEntry & { [key: number]: { fee: number } }

// Default: sync and no dynamic gas
const defaultOp = (name: string) => {
  return { name, isAsync: false, dynamicGas: false }
}
const dynamicGasOp = (name: string) => {
  return { name, isAsync: false, dynamicGas: true }
}
const asyncOp = (name: string) => {
  return { name, isAsync: true, dynamicGas: false }
}
const asyncAndDynamicGasOp = (name: string) => {
  return { name, isAsync: true, dynamicGas: true }
}

// Base opcode list. The opcode list is extended in future hardforks
export const opcodes: OpcodeEntry = {
  // 0x0 range - arithmetic ops
  // name, async
  0x00: defaultOp('STOP'),
  0x01: defaultOp('ADD'),
  0x02: defaultOp('MUL'),
  0x03: defaultOp('SUB'),
  0x04: defaultOp('DIV'),
  0x05: defaultOp('SDIV'),
  0x06: defaultOp('MOD'),
  0x07: defaultOp('SMOD'),
  0x08: defaultOp('ADDMOD'),
  0x09: defaultOp('MULMOD'),
  0x0a: dynamicGasOp('EXP'),
  0x0b: defaultOp('SIGNEXTEND'),

  // 0x10 range - bit ops
  0x10: defaultOp('LT'),
  0x11: defaultOp('GT'),
  0x12: defaultOp('SLT'),
  0x13: defaultOp('SGT'),
  0x14: defaultOp('EQ'),
  0x15: defaultOp('ISZERO'),
  0x16: defaultOp('AND'),
  0x17: defaultOp('OR'),
  0x18: defaultOp('XOR'),
  0x19: defaultOp('NOT'),
  0x1a: defaultOp('BYTE'),

  // 0x20 range - crypto
  0x20: dynamicGasOp('KECCAK256'),

  // 0x30 range - closure state
  0x30: asyncOp('ADDRESS'),
  0x31: asyncAndDynamicGasOp('BALANCE'),
  0x32: asyncOp('ORIGIN'),
  0x33: asyncOp('CALLER'),
  0x34: asyncOp('CALLVALUE'),
  0x35: asyncOp('CALLDATALOAD'),
  0x36: asyncOp('CALLDATASIZE'),
  0x37: asyncAndDynamicGasOp('CALLDATACOPY'),
  0x38: defaultOp('CODESIZE'),
  0x39: dynamicGasOp('CODECOPY'),
  0x3a: defaultOp('GASPRICE'),
  0x3b: asyncAndDynamicGasOp('EXTCODESIZE'),
  0x3c: asyncAndDynamicGasOp('EXTCODECOPY'),

  // '0x40' range - block operations
  0x40: asyncOp('BLOCKHASH'),
  0x41: asyncOp('COINBASE'),
  0x42: asyncOp('TIMESTAMP'),
  0x43: asyncOp('NUMBER'),
  0x44: asyncOp('DIFFICULTY'),
  0x45: asyncOp('GASLIMIT'),

  // 0x50 range - 'storage' and execution
  0x50: defaultOp('POP'),
  0x51: dynamicGasOp('MLOAD'),
  0x52: dynamicGasOp('MSTORE'),
  0x53: dynamicGasOp('MSTORE8'),
  0x54: asyncAndDynamicGasOp('SLOAD'),
  0x55: asyncAndDynamicGasOp('SSTORE'),
  0x56: defaultOp('JUMP'),
  0x57: defaultOp('JUMPI'),
  0x58: defaultOp('PC'),
  0x59: defaultOp('MSIZE'),
  0x5a: defaultOp('GAS'),
  0x5b: defaultOp('JUMPDEST'),

  // 0x60, range
  0x60: defaultOp('PUSH'),
  0x61: defaultOp('PUSH'),
  0x62: defaultOp('PUSH'),
  0x63: defaultOp('PUSH'),
  0x64: defaultOp('PUSH'),
  0x65: defaultOp('PUSH'),
  0x66: defaultOp('PUSH'),
  0x67: defaultOp('PUSH'),
  0x68: defaultOp('PUSH'),
  0x69: defaultOp('PUSH'),
  0x6a: defaultOp('PUSH'),
  0x6b: defaultOp('PUSH'),
  0x6c: defaultOp('PUSH'),
  0x6d: defaultOp('PUSH'),
  0x6e: defaultOp('PUSH'),
  0x6f: defaultOp('PUSH'),
  0x70: defaultOp('PUSH'),
  0x71: defaultOp('PUSH'),
  0x72: defaultOp('PUSH'),
  0x73: defaultOp('PUSH'),
  0x74: defaultOp('PUSH'),
  0x75: defaultOp('PUSH'),
  0x76: defaultOp('PUSH'),
  0x77: defaultOp('PUSH'),
  0x78: defaultOp('PUSH'),
  0x79: defaultOp('PUSH'),
  0x7a: defaultOp('PUSH'),
  0x7b: defaultOp('PUSH'),
  0x7c: defaultOp('PUSH'),
  0x7d: defaultOp('PUSH'),
  0x7e: defaultOp('PUSH'),
  0x7f: defaultOp('PUSH'),

  0x80: defaultOp('DUP'),
  0x81: defaultOp('DUP'),
  0x82: defaultOp('DUP'),
  0x83: defaultOp('DUP'),
  0x84: defaultOp('DUP'),
  0x85: defaultOp('DUP'),
  0x86: defaultOp('DUP'),
  0x87: defaultOp('DUP'),
  0x88: defaultOp('DUP'),
  0x89: defaultOp('DUP'),
  0x8a: defaultOp('DUP'),
  0x8b: defaultOp('DUP'),
  0x8c: defaultOp('DUP'),
  0x8d: defaultOp('DUP'),
  0x8e: defaultOp('DUP'),
  0x8f: defaultOp('DUP'),

  0x90: defaultOp('SWAP'),
  0x91: defaultOp('SWAP'),
  0x92: defaultOp('SWAP'),
  0x93: defaultOp('SWAP'),
  0x94: defaultOp('SWAP'),
  0x95: defaultOp('SWAP'),
  0x96: defaultOp('SWAP'),
  0x97: defaultOp('SWAP'),
  0x98: defaultOp('SWAP'),
  0x99: defaultOp('SWAP'),
  0x9a: defaultOp('SWAP'),
  0x9b: defaultOp('SWAP'),
  0x9c: defaultOp('SWAP'),
  0x9d: defaultOp('SWAP'),
  0x9e: defaultOp('SWAP'),
  0x9f: defaultOp('SWAP'),

  0xa0: dynamicGasOp('LOG'),
  0xa1: dynamicGasOp('LOG'),
  0xa2: dynamicGasOp('LOG'),
  0xa3: dynamicGasOp('LOG'),
  0xa4: dynamicGasOp('LOG'),

  // '0xf0' range - closures
  0xf0: asyncAndDynamicGasOp('CREATE'),
  0xf1: asyncAndDynamicGasOp('CALL'),
  0xf2: asyncAndDynamicGasOp('CALLCODE'),
  0xf3: dynamicGasOp('RETURN'),

  // '0x70', range - other
  0xfe: defaultOp('INVALID'),
  0xff: asyncAndDynamicGasOp('SELFDESTRUCT'),
}

// Array of hard forks in order. These changes are repeatedly applied to `opcodes` until the hard fork is in the future based upon the common
// TODO: All gas price changes should be moved to common
// If the base gas cost of any of the operations change, then these should also be added to this list.
// If there are context variables changed (such as "warm slot reads") which are not the base gas fees,
// Then this does not have to be added.
export const hardforkOpcodes: { hardfork: Hardfork; opcodes: OpcodeEntry }[] = [
  {
    hardfork: Hardfork.Homestead,
    opcodes: {
      0xf4: asyncAndDynamicGasOp('DELEGATECALL'), // EIP-7
    },
  },
  {
    hardfork: Hardfork.TangerineWhistle,
    opcodes: {
      0x54: asyncAndDynamicGasOp('SLOAD'),
      0xf1: asyncAndDynamicGasOp('CALL'),
      0xf2: asyncAndDynamicGasOp('CALLCODE'),
      0x3b: asyncAndDynamicGasOp('EXTCODESIZE'),
      0x3c: asyncAndDynamicGasOp('EXTCODECOPY'),
      0xf4: asyncAndDynamicGasOp('DELEGATECALL'), // EIP-7
      0xff: asyncAndDynamicGasOp('SELFDESTRUCT'),
      0x31: asyncAndDynamicGasOp('BALANCE'),
    },
  },
  {
    hardfork: Hardfork.Byzantium,
    opcodes: {
      0xfd: dynamicGasOp('REVERT'), // EIP-140
      0xfa: asyncAndDynamicGasOp('STATICCALL'), // EIP-214
      0x3d: asyncOp('RETURNDATASIZE'), // EIP-211
      0x3e: asyncAndDynamicGasOp('RETURNDATACOPY'), // EIP-211
    },
  },
  {
    hardfork: Hardfork.Constantinople,
    opcodes: {
      0x1b: defaultOp('SHL'), // EIP-145
      0x1c: defaultOp('SHR'), // EIP-145
      0x1d: defaultOp('SAR'), // EIP-145
      0x3f: asyncAndDynamicGasOp('EXTCODEHASH'), // EIP-1052
      0xf5: asyncAndDynamicGasOp('CREATE2'), // EIP-1014
    },
  },
  {
    hardfork: Hardfork.Istanbul,
    opcodes: {
      0x46: defaultOp('CHAINID'), // EIP-1344
      0x47: defaultOp('SELFBALANCE'), // EIP-1884
    },
  },
  {
    hardfork: Hardfork.Paris,
    opcodes: {
      0x44: asyncOp('PREVRANDAO'), // EIP-4399
    },
  },
]

export const eipOpcodes: { eip: number; opcodes: OpcodeEntry }[] = [
  {
    eip: 663,
    opcodes: {
      0xe6: defaultOp('DUPN'),
      0xe7: defaultOp('SWAPN'),
      0xe8: defaultOp('EXCHANGE'),
    },
  },
  {
    eip: 1153,
    opcodes: {
      0x5c: defaultOp('TLOAD'),
      0x5d: defaultOp('TSTORE'),
    },
  },
  {
    eip: 3198,
    opcodes: {
      0x48: defaultOp('BASEFEE'),
    },
  },
  {
    eip: 3855,
    opcodes: {
      0x5f: defaultOp('PUSH0'),
    },
  },
  {
    eip: 4200,
    opcodes: {
      0xe0: defaultOp('RJUMP'),
      0xe1: defaultOp('RJUMPI'),
      0xe2: defaultOp('RJUMPV'),
    },
  },
  {
    eip: 4750,
    opcodes: {
      0xe3: defaultOp('CALLF'),
      0xe4: defaultOp('RETF'),
    },
  },
  {
    eip: 4844,
    opcodes: {
      0x49: defaultOp('BLOBHASH'),
    },
  },
  {
    eip: 5656,
    opcodes: {
      0x5e: dynamicGasOp('MCOPY'),
    },
  },
  {
    eip: 6206,
    opcodes: {
      0xe5: defaultOp('JUMPF'),
    },
  },
  {
    eip: 7069,
    opcodes: {
      0xf7: defaultOp('RETURNDATALOAD'),
      0xf8: asyncAndDynamicGasOp('EXTCALL'),
      0xf9: asyncAndDynamicGasOp('EXTDELEGATECALL'),
      0xfb: asyncAndDynamicGasOp('EXTSTATICCALL'),
    },
  },
  {
    eip: 7480,
    opcodes: {
      0xd0: defaultOp('DATALOAD'),
      0xd1: defaultOp('DATALOADN'),
      0xd2: defaultOp('DATASIZE'),
      0xd3: dynamicGasOp('DATACOPY'),
    },
  },
  {
    eip: 7516,
    opcodes: {
      0x4a: defaultOp('BLOBBASEFEE'),
    },
  },
  {
    eip: 7620,
    opcodes: {
      0xec: asyncAndDynamicGasOp('EOFCREATE'),
      0xee: asyncAndDynamicGasOp('RETURNCONTRACT'),
    },
  },
]

/**
 * Convert basic opcode info dictionary into complete OpcodeList instance.
 *
 * @param opcodes {Object} Receive basic opcodes info dictionary.
 * @returns {OpcodeList} Complete Opcode list
 */
function createOpcodes(opcodes: OpcodeEntryFee): OpcodeList {
  const result: OpcodeList = new Map()
  for (const [key, value] of Object.entries(opcodes)) {
    const code = parseInt(key, 10)
    if (isNaN(value.fee)) value.fee = 0
    result.set(
      code,
      new Opcode({
        code,
        fullName: getFullname(code, value.name),
        ...value,
      }),
    )
  }
  return result
}

type OpcodeContext = {
  dynamicGasHandlers: Map<number, AsyncDynamicGasHandler | SyncDynamicGasHandler>
  handlers: Map<number, OpHandler>
  opcodes: OpcodeList
  opcodeMap: OpcodeMap
}

export type OpcodeMapEntry = {
  opcodeInfo: Opcode
  opHandler: OpHandler
  gasHandler: AsyncDynamicGasHandler | SyncDynamicGasHandler
}
export type OpcodeMap = OpcodeMapEntry[]

/**
 * Get suitable opcodes for the required hardfork.
 *
 * @param common {Common} Ethereumjs Common metadata object.
 * @param customOpcodes List with custom opcodes (see EVM `customOpcodes` option description).
 * @returns {OpcodeList} Opcodes dictionary object.
 */
export function getOpcodesForHF(common: Common, customOpcodes?: CustomOpcode[]): OpcodeContext {
  let opcodeBuilder: any = { ...opcodes }

  const handlersCopy = new Map(handlers)
  const dynamicGasHandlersCopy = new Map(dynamicGasHandlers)

  for (let fork = 0; fork < hardforkOpcodes.length; fork++) {
    if (common.gteHardfork(hardforkOpcodes[fork].hardfork)) {
      opcodeBuilder = { ...opcodeBuilder, ...hardforkOpcodes[fork].opcodes }
    }
  }
  for (const eipOps of eipOpcodes) {
    if (common.isActivatedEIP(eipOps.eip)) {
      opcodeBuilder = { ...opcodeBuilder, ...eipOps.opcodes }
    }
  }

  for (const key in opcodeBuilder) {
    const baseFee = Number(common.param(`${opcodeBuilder[key].name.toLowerCase()}Gas`))
    // explicitly verify that we have defined a base fee
    if (baseFee === undefined) {
      throw new Error(`base fee not defined for: ${opcodeBuilder[key].name}`)
    }
    opcodeBuilder[key].fee = baseFee
  }

  if (customOpcodes) {
    for (const _code of customOpcodes) {
      const code = <any>_code
      if (code.logicFunction === undefined) {
        delete opcodeBuilder[code.opcode]
        continue
      }

      // Sanity checks
      if (code.opcodeName === undefined || code.baseFee === undefined) {
        throw new Error(
          `Custom opcode ${code.opcode} does not have the required values: opcodeName and baseFee are required`,
        )
      }
      const entry = {
        [code.opcode]: {
          name: code.opcodeName,
          isAsync: true,
          dynamicGas: code.gasFunction !== undefined,
          fee: code.baseFee,
          feeBigInt: BigInt(code.baseFee),
        },
      }
      opcodeBuilder = { ...opcodeBuilder, ...entry }
      if (code.gasFunction !== undefined) {
        dynamicGasHandlersCopy.set(code.opcode, code.gasFunction)
      }
      // logicFunction is never undefined
      handlersCopy.set(code.opcode, code.logicFunction)
    }
  }

  //const dynamicGasHandlers = dynamicGasHandlersCopy
  //const handlers = handlersCopy
  const ops = createOpcodes(opcodeBuilder)

  const opcodeMap: OpcodeMap = []

  for (const [opNumber, op] of ops) {
    const dynamicGas = dynamicGasHandlersCopy.get(opNumber)!
    const handler = handlersCopy.get(opNumber)!
    opcodeMap[opNumber] = {
      opcodeInfo: op,
      opHandler: handler,
      gasHandler: dynamicGas,
    }
  }

  const INVALID = opcodeMap[0xfe]

  for (let i = 0x0; i <= 0xff; i++) {
    if (opcodeMap[i] === undefined) {
      opcodeMap[i] = INVALID
    }
  }

  return {
    dynamicGasHandlers: dynamicGasHandlersCopy,
    handlers: handlersCopy,
    opcodes: ops,
    opcodeMap,
  }
}
