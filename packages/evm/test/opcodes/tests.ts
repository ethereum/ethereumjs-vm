import { Block } from '@ethereumjs/block'
import {
  Address,
  BIGINT_1,
  BIGINT_160,
  BIGINT_2,
  BIGINT_224,
  BIGINT_2EXP160,
  BIGINT_2EXP224,
  BIGINT_2EXP96,
  BIGINT_96,
  bigIntToBytes,
  hexToBytes,
  setLengthLeft,
  zeros,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import { toTwos } from '../../src/opcodes/util.js'

import type { OpcodeTests } from './utils.js'

const BIGINT_2EXP256 = BigInt(2) ** BigInt(256)
const STACK_MAX_NUMBER = BIGINT_2EXP256 - BigInt(1)

const ADDR_ARRAY: { address: Address; bigInt: bigint }[] = [
  { address: Address.fromString('0x' + '00'.repeat(17) + '111111'), bigInt: BigInt(0x111111) },
  { address: Address.fromString('0x' + '00'.repeat(17) + '222222'), bigInt: BigInt(0x222222) },
  { address: Address.fromString('0x' + '00'.repeat(17) + '333333'), bigInt: BigInt(0x333333) },
]

function pow2(pow: number) {
  return BigInt(2) ** BigInt(pow)
}

function sign(input: bigint | number) {
  if (typeof input === 'number') {
    return toTwos(BigInt(input))
  }
  return toTwos(input)
}

// The lowest signed number (-2^255)
const SIGNED_LOW = sign(-(BigInt(2) ** BigInt(255)))
// The highest signed number (2^255 - 1)
const SIGNED_HIGH = sign(-SIGNED_LOW - BigInt(1))

export const opcodeTests: {
  [testSetName: string]: OpcodeTests
} = {
  /* 0x01-0x0B */
  arithmetic: {
    ADD: [
      { stack: [0, 0], expected: 0 },
      { stack: [1, 0], expected: 1 },
      { stack: [0, 1], expected: 1 },
      { stack: [1, 1], expected: 2 },
      { stack: [STACK_MAX_NUMBER, 1], expected: 0, name: 'overflow check' },
    ],
    MUL: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 1], expected: 0 },
      { stack: [1, 0], expected: 0 },
      { stack: [1, 1], expected: 1 },
      { stack: [1, 2], expected: 2 },
      { stack: [2, 2], expected: 4 },
      { stack: [BIGINT_2EXP256 / BigInt(2), 2], expected: 0, name: 'overflow check' },
    ],
    SUB: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 1], expected: STACK_MAX_NUMBER, name: 'underflow check' },
      { stack: [1, 0], expected: 1 },
      { stack: [1, 1], expected: 0 },
      { stack: [2, 1], expected: 1 },
      { stack: [4, 2], expected: 2 },
    ],
    DIV: [
      { stack: [0, 0], expected: 0, name: '0/0 check' },
      { stack: [0, 1], expected: 0 },
      { stack: [1, 0], expected: 0, name: '1/0 check' },
      { stack: [1, 1], expected: 1 },
      { stack: [2, 1], expected: 2 },
      { stack: [4, 2], expected: 2 },
      { stack: [pow2(255), 2], expected: pow2(254) },
    ],
    SDIV: [
      { stack: [0, 0], expected: 0, name: '0/0 check' },
      { stack: [0, 1], expected: 0 },
      { stack: [1, 0], expected: 0, name: '1/0 check' },
      { stack: [1, 1], expected: 1 },
      { stack: [2, 1], expected: 2 },
      { stack: [4, 2], expected: 2 },
      { stack: [0, sign(-1)], expected: 0 },
      { stack: [1, sign(-1)], expected: sign(-1) },
      { stack: [sign(-1), sign(-1)], expected: 1 },
      { stack: [2, sign(-1)], expected: sign(-2) },
      { stack: [4, sign(-2)], expected: sign(-2) },
    ],
    MOD: [
      { stack: [0, 0], expected: 0, name: '0%0 check' },
      { stack: [1, 0], expected: 0, name: '1%0 check' },
      { stack: [1, 1], expected: 0 },
      { stack: [2, 1], expected: 0 },
      { stack: [4, 2], expected: 0 },
      { stack: [5, 2], expected: 1 },
      { stack: [STACK_MAX_NUMBER, 2], expected: 1 },
    ],
    SMOD: [
      { stack: [0, 0], expected: 0, name: '0%0 check' },
      { stack: [1, 0], expected: 0, name: '1%0 check' },
      { stack: [1, 1], expected: 0 },
      { stack: [2, 1], expected: 0 },
      { stack: [4, 2], expected: 0 },
      { stack: [5, 2], expected: 1 },
      { stack: [sign(-1), 2], expected: sign(-1) },
      { stack: [sign(-1), sign(-2)], expected: sign(-1) },
      { stack: [sign(-1), sign(-1)], expected: sign(0) },
    ],
    ADDMOD: [
      { stack: [0, 0, 0], expected: 0, name: '(0+0)%0 check' },
      { stack: [0, 1, 0], expected: 0, name: '(0+1)%0 check' },
      { stack: [1, 0, 0], expected: 0, name: '(1+0)%0 check' },
      { stack: [1, 1, 0], expected: 0, name: '(1+1)%0 check' },
      { stack: [1, 1, 2], expected: 0 },
      { stack: [1, 2, 2], expected: 1 },
      { stack: [STACK_MAX_NUMBER, 2, 2], expected: 1 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER, 2], expected: 0 },
    ],
    MULMOD: [
      { stack: [0, 0, 0], expected: 0, name: '(0*0)%0 check' },
      { stack: [0, 1, 0], expected: 0, name: '(0*1)%0 check' },
      { stack: [1, 0, 0], expected: 0, name: '(1*0)%0 check' },
      { stack: [1, 1, 0], expected: 0, name: '(1*1)%0 check' },
      { stack: [1, 1, 2], expected: 1 },
      { stack: [1, 2, 2], expected: 0 },
      { stack: [STACK_MAX_NUMBER, 2, 2], expected: 0 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER, 2], expected: 1 },
    ],
    EXP: [
      // Note: the return values have been verified against results on Sepolia
      { stack: [0, 0], expected: 1, name: '0**0 check' },
      { stack: [0, 1], expected: 0, name: '0**1 check' },
      { stack: [1, 0], expected: 1, name: '1**0 check' },
      { stack: [1, 1], expected: 1 },
      { stack: [2, BIGINT_96], expected: BIGINT_2EXP96, name: '2**96 check' },
      { stack: [2, BIGINT_160], expected: BIGINT_2EXP160, name: '2**160 check' },
      { stack: [2, BIGINT_224], expected: BIGINT_2EXP224, name: '2**224 check' },
      { stack: [3, 2], expected: 3 ** 2 },
      { stack: [3, 3], expected: 3 ** 3 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: STACK_MAX_NUMBER },
    ],
    SIGNEXTEND: [
      // SIGNEXTEND opcode explanation:
      // There are two items on the stack, the [byteLength, value]:
      // The value is interpreted to have the signed bit set at index `byteLength * 8` + 7 (call this `signIndex`)
      // Now, the signed value is extended to 256 bits
      // In practice this means:
      // If value[signIndex] = 1, this means the number is negative
      // Now left-fill all bits with 1 (so, when interpeting this number as signed in EVM, the original number does not change)
      // If value[signIndex] = 0, left-fill all bits with 0
      // This is thus handy if on stack there is an item which should be interpreted as, lets say int16 or uint16
      // If one would take this item from stack from dirty memory, this could mean that the bytes left of this
      // value are dirty, so we can clean it up.
      // Also handy to left-fill bytes with either 1s or 0s depending on the situation
      { stack: [0, 0b10000000], expected: sign(-128) },
      { stack: [0, 0b1111111100000011], expected: 3 },
      { stack: [32, STACK_MAX_NUMBER], expected: STACK_MAX_NUMBER },
      { stack: [32, 1], expected: 1 },
    ],
  },
  /* 0x10-0x1D */
  byteOperations: {
    LT: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 1], expected: 1 },
      { stack: [1, 0], expected: 0 },
      { stack: [1, 1], expected: 0 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: 0 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER - BIGINT_1], expected: 0 },
      { stack: [STACK_MAX_NUMBER - BIGINT_1, STACK_MAX_NUMBER], expected: 1 },
    ],
    GT: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 1], expected: 0 },
      { stack: [1, 0], expected: 1 },
      { stack: [1, 1], expected: 0 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: 0 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER - BIGINT_1], expected: 1 },
      { stack: [STACK_MAX_NUMBER - BIGINT_1, STACK_MAX_NUMBER], expected: 0 },
    ],
    SLT: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 1], expected: 1 },
      { stack: [1, 0], expected: 0 },
      { stack: [1, 1], expected: 0 },
      { stack: [0, sign(-1)], expected: 0 },
      { stack: [sign(-1), 0], expected: 1 },
      { stack: [sign(-1), sign(-1)], expected: 0 },
      { stack: [SIGNED_HIGH, SIGNED_HIGH], expected: 0 },
      { stack: [SIGNED_HIGH, SIGNED_HIGH - BIGINT_1], expected: 0 },
      { stack: [SIGNED_HIGH - BIGINT_1, SIGNED_HIGH], expected: 1 },
      { stack: [SIGNED_LOW, SIGNED_LOW], expected: 0 },
      { stack: [SIGNED_LOW, SIGNED_LOW + BIGINT_1], expected: 1 },
      { stack: [SIGNED_LOW + BIGINT_1, SIGNED_LOW], expected: 0 },
      { stack: [SIGNED_HIGH, SIGNED_LOW], expected: 0 },
      { stack: [SIGNED_LOW, SIGNED_HIGH], expected: 1 },
    ],
    SGT: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 1], expected: 0 },
      { stack: [1, 0], expected: 1 },
      { stack: [1, 1], expected: 0 },
      { stack: [0, sign(-1)], expected: 1 },
      { stack: [sign(-1), 0], expected: 0 },
      { stack: [sign(-1), sign(-1)], expected: 0 },
      { stack: [SIGNED_HIGH, SIGNED_HIGH], expected: 0 },
      { stack: [SIGNED_HIGH, SIGNED_HIGH - BIGINT_1], expected: 1 },
      { stack: [SIGNED_HIGH - BIGINT_1, SIGNED_HIGH], expected: 0 },
      { stack: [SIGNED_LOW, SIGNED_LOW], expected: 0 },
      { stack: [SIGNED_LOW, SIGNED_LOW + BIGINT_1], expected: 0 },
      { stack: [SIGNED_LOW + BIGINT_1, SIGNED_LOW], expected: 1 },
      { stack: [SIGNED_HIGH, SIGNED_LOW], expected: 1 },
      { stack: [SIGNED_LOW, SIGNED_HIGH], expected: 0 },
    ],
    EQ: [
      { stack: [0, 0], expected: 1 },
      { stack: [1, 0], expected: 0 },
      { stack: [0, 1], expected: 0 },
      { stack: [1, 1], expected: 1 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: 1 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER - BIGINT_1], expected: 0 },
      { stack: [STACK_MAX_NUMBER - BIGINT_1, STACK_MAX_NUMBER], expected: 0 },
    ],
    ISZERO: [
      { stack: [0], expected: 1 },
      { stack: [1], expected: 0 },
      { stack: [STACK_MAX_NUMBER], expected: 0 },
    ],
    AND: [
      { stack: [0, 0], expected: 0 },
      { stack: [0b0110, 0b0101], expected: 0b0100 },
      { stack: [STACK_MAX_NUMBER, 128], expected: 128 },
    ],
    OR: [
      { stack: [0, 0], expected: 0 },
      { stack: [0b0110, 0b0101], expected: 0b0111 },
      { stack: [STACK_MAX_NUMBER, 128], expected: STACK_MAX_NUMBER },
    ],
    XOR: [
      { stack: [0, 0], expected: 0 },
      { stack: [0b0110, 0b0101], expected: 0b0011 },
      // 0b10000000 = 128
      { stack: [STACK_MAX_NUMBER, 0b10000000], expected: STACK_MAX_NUMBER - BigInt(0b10000000) },
    ],
    NOT: [
      { stack: [0], expected: STACK_MAX_NUMBER },
      { stack: [STACK_MAX_NUMBER], expected: 0 },
      { stack: [1], expected: STACK_MAX_NUMBER - BIGINT_1 },
      { stack: [12345], expected: STACK_MAX_NUMBER - BigInt(12345) },
    ],
    BYTE: [
      { stack: [0, 0], expected: 0 },
      { stack: [31, 0], expected: 0 },
      { stack: [31, 0xffee], expected: 0xee },
      { stack: [30, 0xffee], expected: 0xff },
      { stack: [29, 0xffee], expected: 0 },
      { stack: [0, STACK_MAX_NUMBER], expected: 0xff },
      { stack: [31, STACK_MAX_NUMBER], expected: 0xff },
      { stack: [32, STACK_MAX_NUMBER], expected: 0 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: 0 },
    ],
    SHL: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 0xff], expected: 0xff },
      { stack: [1, 0xff], expected: 0xff << 1 },
      { stack: [8, 0xff], expected: 0xff << 8 },
      { stack: [1, STACK_MAX_NUMBER], expected: STACK_MAX_NUMBER - BIGINT_1 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: 0 },
    ],
    SHR: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 0xff], expected: 0xff },
      { stack: [1, 0xff], expected: 0xff >> 1 },
      { stack: [8, 0xff], expected: 0xff >> 8 },
      { stack: [1, STACK_MAX_NUMBER], expected: STACK_MAX_NUMBER / BIGINT_2 },
      { stack: [STACK_MAX_NUMBER, STACK_MAX_NUMBER], expected: 0 },
    ],
    SAR: [
      { stack: [0, 0], expected: 0 },
      { stack: [0, 0xff], expected: 0xff },
      { stack: [1, 0xff], expected: 0xff >> 1 },
      { stack: [8, 0xff], expected: 0xff >> 8 },
      { stack: [1, sign(-1)], expected: sign(-1 >> 1) },
      { stack: [2, sign(-1)], expected: sign(-1 >> 2) },
      { stack: [2, sign(-2)], expected: sign(-2 >> 2) },
      { stack: [2, sign(-1)], expected: sign(-2 >> 1) },
      { stack: [STACK_MAX_NUMBER, sign(-12345)], expected: sign(-1) },
      { stack: [STACK_MAX_NUMBER, SIGNED_LOW], expected: sign(-1) },
      { stack: [STACK_MAX_NUMBER, SIGNED_HIGH], expected: 0 },
    ],
  },
  /* 0x20 */
  crypto: {
    KECCAK256: [
      { stack: [0, 0], expected: keccak256(new Uint8Array()) },
      { initMem: [1], stack: [0, 32], expected: keccak256(setLengthLeft(new Uint8Array([1]), 32)) },
    ],
  },
  /* 0x30 - 0x48 */
  environment: {
    ADDRESS: [
      { expected: 0 },
      { expected: ADDR_ARRAY[0].bigInt, evmOpts: { to: ADDR_ARRAY[0].address } },
    ],
    BALANCE: [{ stack: [0], expected: 0 }],
    ORIGIN: [
      { expected: 0 },
      { expected: ADDR_ARRAY[0].bigInt, evmOpts: { origin: ADDR_ARRAY[0].address } },
    ],
    CALLER: [
      { expected: 0 },
      { expected: ADDR_ARRAY[0].bigInt, evmOpts: { caller: ADDR_ARRAY[0].address } },
    ],
    CALLVALUE: [{ expected: 0 }, { expected: 1, evmOpts: { value: BigInt(1) } }],
    CALLDATALOAD: [
      { expected: 0, stack: [0] },
      { expected: 1, stack: [0], evmOpts: { data: setLengthLeft(bigIntToBytes(BigInt(1)), 32) } },
    ],
    CALLDATASIZE: [{ expected: 0 }, { expected: 32, evmOpts: { data: zeros(32) } }],
    CALLDATACOPY: [
      { expectedReturnType: 'memory', expected: zeros(0), stack: [0, 0, 0] },
      {
        expectedReturnType: 'memory',
        expected: hexToBytes('0x01' + '00'.repeat(31)),
        stack: [0, 0, 1],
        evmOpts: { data: hexToBytes('0x01') },
      },
    ],
    // TODO codecopy / codesize,
    GASPRICE: [{ expected: 0 }, { expected: 1, evmOpts: { gasPrice: BigInt(1) } }],
    EXTCODESIZE: [
      { expected: 0, stack: [12345678] },
      {
        expected: 1,
        stack: [ADDR_ARRAY[0].address.bytes],
        preState: {
          [ADDR_ARRAY[0].address.toString()]: {
            code: '0xFF',
          },
        },
      },
    ],
    EXTCODECOPY: [
      { expected: '0x', stack: [12345678, 0, 0, 0] },
      {
        expected: '0x' + 'FF'.repeat(32),
        stack: [ADDR_ARRAY[0].address.bytes, 0, 0, 32],
        preState: {
          [ADDR_ARRAY[0].address.toString()]: {
            code: '0x' + 'FF'.repeat(32),
          },
        },
        expectedReturnType: 'memory',
      },
    ],
    // TODO RETURNDATASIZE/RETURNDATACOPY/EXTCODEHASH/BLOCKHASH
    COINBASE: [
      { expected: zeros(32) },
      {
        expected: ADDR_ARRAY[0].address.bytes,
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              coinbase: ADDR_ARRAY[0].address,
            },
          }),
        },
      },
    ],
    TIMESTAMP: [
      { expected: BigInt(0) },
      {
        expected: BigInt(1),
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              timestamp: BigInt(1),
            },
          }),
        },
      },
    ],
    NUMBER: [
      { expected: BigInt(0) },
      {
        expected: BigInt(1),
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              number: BigInt(1),
            },
          }),
        },
      },
    ],
    PREVRANDAO: [
      { expected: BigInt(0) },
      {
        expected: BigInt(1),
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              mixHash: setLengthLeft(bigIntToBytes(BigInt(1)), 32), // TODO This field should be renamed
            },
          }),
        },
      },
    ],
    GASLIMIT: [
      { expected: BigInt(0) },
      {
        expected: BigInt(1),
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              gasLimit: BigInt(1),
            },
          }),
        },
      },
    ],
    CHAINID: [{ expected: BigInt(1) }],
    SELFBALANCE: [
      { expected: BigInt(0) },
      {
        expected: BigInt(1),
        preState: {
          [Address.zero().toString()]: {
            balance: '0x01',
          },
        },
      },
    ],
    BASEFEE: [
      {
        expected: BigInt(0),
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              baseFeePerGas: BigInt(0),
            },
          }),
        },
      },
      {
        expected: BigInt(1),
        evmOpts: {
          block: Block.fromBlockData({
            header: {
              baseFeePerGas: BigInt(1),
            },
          }),
        },
      },
    ],
  },
}
