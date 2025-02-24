import { Hardfork } from '@ethereumjs/common'
import {
  BIGINT_0,
  BIGINT_1,
  BIGINT_3,
  BIGINT_31,
  BIGINT_32,
  BIGINT_64,
  bigIntToBytes,
  equalsBytes,
  setLengthLeft,
} from '@ethereumjs/util'

import { EOFError } from '../eof/errors.js'
import { EVMError, EVMErrorCode } from '../errors.js'
import { DELEGATION_7702_FLAG } from '../types.js'

import { updateSstoreGasEIP1283 } from './EIP1283.js'
import { updateSstoreGasEIP2200 } from './EIP2200.js'
import { accessAddressEIP2929, accessStorageEIP2929 } from './EIP2929.js'
import {
  createAddressFromStackBigInt,
  divCeil,
  maxCallGas,
  setLengthLeftStorage,
  subMemUsage,
  trap,
  updateSstoreGas,
} from './util.js'

import type { RunState } from '../interpreter.js'
import type { Common } from '@ethereumjs/common'
import type { Address } from '@ethereumjs/util'

const EXTCALL_TARGET_MAX = BigInt(2) ** BigInt(8 * 20) - BigInt(1)

async function eip7702GasCost(
  runState: RunState,
  common: Common,
  address: Address,
  charge2929Gas: boolean,
) {
  const code = await runState.stateManager.getCode(address)
  if (equalsBytes(code.slice(0, 3), DELEGATION_7702_FLAG)) {
    return accessAddressEIP2929(runState, code.slice(3, 24), common, charge2929Gas)
  }
  return BIGINT_0
}

/**
 * This file returns the dynamic parts of opcodes which have dynamic gas
 * These are not pure functions: some edit the size of the memory
 * These functions are therefore not read-only
 */

// The dynamic gas handler methods take a runState and a gas BN
// The gas BN is necessary, since the base fee needs to be included,
// to calculate the max call gas for the call opcodes correctly.
export interface AsyncDynamicGasHandler {
  (runState: RunState, gas: bigint, common: Common): Promise<bigint>
}

export interface SyncDynamicGasHandler {
  (runState: RunState, gas: bigint, common: Common): bigint
}

export const dynamicGasHandlers: Map<number, AsyncDynamicGasHandler | SyncDynamicGasHandler> =
  new Map<number, AsyncDynamicGasHandler>([
    [
      /* EXP */
      0x0a,
      async function (runState, gas, common): Promise<bigint> {
        const [_base, exponent] = runState.stack.peek(2)
        if (exponent === BIGINT_0) {
          return gas
        }
        let byteLength = exponent.toString(2).length / 8
        if (byteLength > Math.trunc(byteLength)) {
          byteLength = Math.trunc(byteLength) + 1
        }
        if (byteLength < 1 || byteLength > 32) {
          trap(
            new EVMError({
              code: EVMErrorCode.OUT_OF_RANGE,
            }),
          )
        }
        const expPricePerByte = common.param('expByteGas')
        gas += BigInt(byteLength) * expPricePerByte
        return gas
      },
    ],
    [
      /* KECCAK256 */
      0x20,
      async function (runState, gas, common): Promise<bigint> {
        const [offset, length] = runState.stack.peek(2)
        gas += subMemUsage(runState, offset, length, common)
        gas += common.param('keccak256WordGas') * divCeil(length, BIGINT_32)
        return gas
      },
    ],
    [
      /* BALANCE */
      0x31,
      async function (runState, gas, common): Promise<bigint> {
        const address = createAddressFromStackBigInt(runState.stack.peek()[0])
        let charge2929Gas = true
        if (common.isActivatedEIP(6800)) {
          const coldAccessGas = runState.env.accessWitness!.readAccountBasicData(address)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(runState, address.bytes, common, charge2929Gas)
        }

        return gas
      },
    ],
    [
      /* CALLDATACOPY */
      0x37,
      async function (runState, gas, common): Promise<bigint> {
        const [memOffset, _dataOffset, dataLength] = runState.stack.peek(3)

        gas += subMemUsage(runState, memOffset, dataLength, common)
        if (dataLength !== BIGINT_0) {
          gas += common.param('copyGas') * divCeil(dataLength, BIGINT_32)
        }
        return gas
      },
    ],
    [
      /* CODECOPY */
      0x39,
      async function (runState, gas, common): Promise<bigint> {
        const [memOffset, _codeOffset, dataLength] = runState.stack.peek(3)

        gas += subMemUsage(runState, memOffset, dataLength, common)
        if (dataLength !== BIGINT_0) {
          gas += common.param('copyGas') * divCeil(dataLength, BIGINT_32)

          if (common.isActivatedEIP(6800) && runState.env.chargeCodeAccesses === true) {
            const contract = runState.interpreter.getAddress()
            let codeEnd = _codeOffset + dataLength
            const codeSize = runState.interpreter.getCodeSize()
            if (codeEnd > codeSize) {
              codeEnd = codeSize
            }

            gas += runState.env.accessWitness!.readAccountCodeChunks(
              contract,
              Number(_codeOffset),
              Number(codeEnd),
            )
          }
        }
        return gas
      },
    ],
    [
      /* EXTCODESIZE */
      0x3b,
      async function (runState, gas, common): Promise<bigint> {
        const address = createAddressFromStackBigInt(runState.stack.peek()[0])

        let charge2929Gas = true
        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(address) === undefined &&
          !address.equals(createAddressFromStackBigInt(common.param('systemAddress')))
        ) {
          let coldAccessGas = BIGINT_0
          coldAccessGas += runState.env.accessWitness!.readAccountBasicData(address)

          gas += coldAccessGas
          // if cold access gas has been charged 2929 gas shouldn't be charged
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(runState, address.bytes, common, charge2929Gas)
        }

        return gas
      },
    ],
    [
      /* EXTCODECOPY */
      0x3c,
      async function (runState, gas, common): Promise<bigint> {
        const [addressBigInt, memOffset, _codeOffset, dataLength] = runState.stack.peek(4)
        const address = createAddressFromStackBigInt(addressBigInt)

        gas += subMemUsage(runState, memOffset, dataLength, common)

        let charge2929Gas = true
        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(address) === undefined &&
          !address.equals(createAddressFromStackBigInt(common.param('systemAddress')))
        ) {
          let coldAccessGas = BIGINT_0
          coldAccessGas += runState.env.accessWitness!.readAccountBasicData(address)

          gas += coldAccessGas
          // if cold access gas has been charged 2929 gas shouldn't be charged
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(runState, address.bytes, common, charge2929Gas)
        }

        if (dataLength !== BIGINT_0) {
          gas += common.param('copyGas') * divCeil(dataLength, BIGINT_32)

          if (common.isActivatedEIP(6800)) {
            let codeEnd = _codeOffset + dataLength
            const codeSize = BigInt((await runState.stateManager.getCode(address)).length)
            if (codeEnd > codeSize) {
              codeEnd = codeSize
            }

            gas += runState.env.accessWitness!.readAccountCodeChunks(
              address,
              Number(_codeOffset),
              Number(codeEnd),
            )
          }
        }
        return gas
      },
    ],
    [
      /* RETURNDATACOPY */
      0x3e,
      async function (runState, gas, common): Promise<bigint> {
        const [memOffset, returnDataOffset, dataLength] = runState.stack.peek(3)

        if (returnDataOffset + dataLength > runState.interpreter.getReturnDataSize()) {
          // For an EOF contract, the behavior is changed (see EIP 7069)
          // RETURNDATACOPY in that case does not throw OOG when reading out-of-bounds
          if (runState.env.eof === undefined) {
            trap(
              new EVMError({
                code: EVMErrorCode.OUT_OF_GAS,
              }),
            )
          }
        }

        gas += subMemUsage(runState, memOffset, dataLength, common)

        if (dataLength !== BIGINT_0) {
          gas += common.param('copyGas') * divCeil(dataLength, BIGINT_32)
        }
        return gas
      },
    ],
    [
      /* EXTCODEHASH */
      0x3f,
      async function (runState, gas, common): Promise<bigint> {
        const address = createAddressFromStackBigInt(runState.stack.peek()[0])
        let charge2929Gas = true

        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(address) === undefined &&
          !address.equals(createAddressFromStackBigInt(common.param('systemAddress')))
        ) {
          let coldAccessGas = BIGINT_0
          coldAccessGas += runState.env.accessWitness!.readAccountCodeHash(address)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(runState, address.bytes, common, charge2929Gas)
        }

        return gas
      },
    ],
    [
      /* MLOAD */
      0x51,
      async function (runState, gas, common): Promise<bigint> {
        const pos = runState.stack.peek()[0]
        gas += subMemUsage(runState, pos, BIGINT_32, common)
        return gas
      },
    ],
    [
      /* MSTORE */
      0x52,
      async function (runState, gas, common): Promise<bigint> {
        const offset = runState.stack.peek()[0]
        gas += subMemUsage(runState, offset, BIGINT_32, common)
        return gas
      },
    ],
    [
      /* MSTORE8 */
      0x53,
      async function (runState, gas, common): Promise<bigint> {
        const offset = runState.stack.peek()[0]
        gas += subMemUsage(runState, offset, BIGINT_1, common)
        return gas
      },
    ],
    [
      /* SLOAD */
      0x54,
      async function (runState, gas, common): Promise<bigint> {
        const key = runState.stack.peek()[0]
        const keyBuf = setLengthLeft(bigIntToBytes(key), 32)

        let charge2929Gas = true
        if (common.isActivatedEIP(6800)) {
          const address = runState.interpreter.getAddress()
          const coldAccessGas = runState.env.accessWitness!.readAccountStorage(address, key)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessStorageEIP2929(runState, keyBuf, false, common, charge2929Gas)
        }

        return gas
      },
    ],
    [
      /* SSTORE */
      0x55,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.interpreter.isStatic()) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        const [key, val] = runState.stack.peek(2)

        const keyBytes = setLengthLeft(bigIntToBytes(key), 32)
        // NOTE: this should be the shortest representation
        let value
        if (val === BIGINT_0) {
          value = Uint8Array.from([])
        } else {
          value = bigIntToBytes(val)
        }

        const currentStorage = setLengthLeftStorage(
          await runState.interpreter.storageLoad(keyBytes),
        )
        const originalStorage = setLengthLeftStorage(
          await runState.interpreter.storageLoad(keyBytes, true),
        )
        if (common.hardfork() === Hardfork.Constantinople) {
          gas += updateSstoreGasEIP1283(
            runState,
            currentStorage,
            originalStorage,
            setLengthLeftStorage(value),
            common,
          )
        } else if (common.gteHardfork(Hardfork.Istanbul)) {
          if (!common.isActivatedEIP(6800)) {
            gas += updateSstoreGasEIP2200(
              runState,
              currentStorage,
              originalStorage,
              setLengthLeftStorage(value),
              keyBytes,
              common,
            )
          }
        } else {
          gas += updateSstoreGas(runState, currentStorage, setLengthLeftStorage(value), common)
        }

        let charge2929Gas = true
        if (common.isActivatedEIP(6800)) {
          const contract = runState.interpreter.getAddress()
          const coldAccessGas = runState.env.accessWitness!.writeAccountStorage(contract, key)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          // We have to do this after the Istanbul (EIP2200) checks.
          // Otherwise, we might run out of gas, due to "sentry check" of 2300 gas,
          // if we deduct extra gas first.
          gas += accessStorageEIP2929(runState, keyBytes, true, common, charge2929Gas)
        }

        return gas
      },
    ],
    [
      /* MCOPY */
      0x5e,
      async function (runState, gas, common): Promise<bigint> {
        const [dst, src, length] = runState.stack.peek(3)
        const wordsCopied = (length + BIGINT_31) / BIGINT_32
        gas += BIGINT_3 * wordsCopied
        gas += subMemUsage(runState, src, length, common)
        gas += subMemUsage(runState, dst, length, common)
        return gas
      },
    ],
    [
      /* LOG */
      0xa0,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.interpreter.isStatic()) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }

        const [memOffset, memLength] = runState.stack.peek(2)

        const topicsCount = runState.opCode - 0xa0

        if (topicsCount < 0 || topicsCount > 4) {
          trap(
            new EVMError({
              code: EVMErrorCode.OUT_OF_RANGE,
            }),
          )
        }

        gas += subMemUsage(runState, memOffset, memLength, common)
        gas +=
          common.param('logTopicGas') * BigInt(topicsCount) + memLength * common.param('logDataGas')
        return gas
      },
    ],
    /* DATACOPY */
    [
      0xd3,
      async function (runState, gas, common) {
        if (runState.env.eof === undefined) {
          // Opcode not available in legacy contracts
          trap(
            new EVMError({
              code: EVMErrorCode.INVALID_OPCODE,
            }),
          )
        }
        const [memOffset, _dataOffset, dataLength] = runState.stack.peek(3)

        gas += subMemUsage(runState, memOffset, dataLength, common)
        if (dataLength !== BIGINT_0) {
          gas += common.param('copyGas') * divCeil(dataLength, BIGINT_32)
        }
        return gas
      },
    ],
    /* EOFCREATE */
    [
      0xec,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.env.eof === undefined) {
          // Opcode not available in legacy contracts
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        // Note: TX_CREATE_COST is in the base fee (this is 32000 and same as CREATE / CREATE2)

        // Note: in `gas.ts` programCounter is not yet incremented (which it is in `functions.ts`)
        // So have to manually add to programCounter here to get the right container index

        // Read container index
        const containerIndex = runState.env.code[runState.programCounter + 1]

        // Pop stack values
        const [_value, _salt, inputOffset, inputSize] = runState.stack.peek(4)

        //if (common.isActivatedEIP(2929)) {
        // TODO: adding or not adding this makes test
        // --test=tests/prague/eip7692_eof_v1/eip7620_eof_create/test_eofcreate.py::test_eofcreate_then_call[fork_CancunEIP7692-blockchain_test]
        // still succeed. This only warms the current address?? This is also in CREATE/CREATE2
        // Can this be removed in both?
        /*gas += accessAddressEIP2929(
            runState,
            runState.interpreter.getAddress().bytes,
            common,
            false
          )
        }*/

        // Expand memory
        gas += subMemUsage(runState, inputOffset, inputSize, common)

        // Read container
        const container = runState.env.eof!.container.body.containerSections[containerIndex]

        // Charge for hashing cost
        gas += common.param('keccak256WordGas') * divCeil(BigInt(container.length), BIGINT_32)

        const gasLeft = runState.interpreter.getGasLeft() - gas
        runState.messageGasLimit = maxCallGas(gasLeft, gasLeft, runState, common)

        return gas
      },
    ],
    /* RETURNCONTRACT */
    [
      0xee,
      async function (runState, gas, common): Promise<bigint> {
        // Pop stack values
        const [auxDataOffset, auxDataSize] = runState.stack.peek(2)

        // Expand memory
        gas += subMemUsage(runState, auxDataOffset, auxDataSize, common)

        return gas
      },
    ],
    [
      /* CREATE */
      0xf0,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.interpreter.isStatic()) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        const [_value, offset, length] = runState.stack.peek(3)

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(
            runState,
            runState.interpreter.getAddress().bytes,
            common,
            false,
          )
        }

        if (common.isActivatedEIP(3860)) {
          gas += ((length + BIGINT_31) / BIGINT_32) * common.param('initCodeWordGas')
        }

        gas += subMemUsage(runState, offset, length, common)

        let gasLimit = BigInt(runState.interpreter.getGasLeft()) - gas
        gasLimit = maxCallGas(gasLimit, gasLimit, runState, common)

        runState.messageGasLimit = gasLimit
        return gas
      },
    ],
    [
      /* CALL */
      0xf1,
      async function (runState, gas, common): Promise<bigint> {
        const [currentGasLimit, toAddr, value, inOffset, inLength, outOffset, outLength] =
          runState.stack.peek(7)
        const toAddress = createAddressFromStackBigInt(toAddr)

        if (runState.interpreter.isStatic() && value !== BIGINT_0) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        gas += subMemUsage(runState, inOffset, inLength, common)
        gas += subMemUsage(runState, outOffset, outLength, common)

        let charge2929Gas = true
        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(toAddress) === undefined
        ) {
          const coldAccessGas = runState.env.accessWitness!.readAccountBasicData(toAddress)
          if (value !== BIGINT_0) {
            const contractAddress = runState.interpreter.getAddress()
            gas += runState.env.accessWitness!.writeAccountBasicData(contractAddress)
            gas += runState.env.accessWitness!.writeAccountBasicData(toAddress)
          }

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(runState, toAddress.bytes, common, charge2929Gas)
        }

        if (common.isActivatedEIP(7702)) {
          gas += await eip7702GasCost(runState, common, toAddress, charge2929Gas)
        }

        if (value !== BIGINT_0 && !common.isActivatedEIP(6800)) {
          gas += common.param('callValueTransferGas')
        }

        if (common.gteHardfork(Hardfork.SpuriousDragon)) {
          // We are at or after Spurious Dragon
          // Call new account gas: account is DEAD and we transfer nonzero value

          const account = await runState.stateManager.getAccount(toAddress)
          let deadAccount = false
          if (account === undefined || account.isEmpty()) {
            deadAccount = true
          }

          if (deadAccount && !(value === BIGINT_0)) {
            gas += common.param('callNewAccountGas')
          }
        } else if ((await runState.stateManager.getAccount(toAddress)) === undefined) {
          // We are before Spurious Dragon and the account does not exist.
          // Call new account gas: account does not exist (it is not in the state trie, not even as an "empty" account)
          gas += common.param('callNewAccountGas')
        }

        const gasLimit = maxCallGas(
          currentGasLimit,
          runState.interpreter.getGasLeft() - gas,
          runState,
          common,
        )
        // note that TangerineWhistle or later this cannot happen
        // (it could have ran out of gas prior to getting here though)
        if (gasLimit > runState.interpreter.getGasLeft() - gas) {
          trap(
            new EVMError({
              code: EVMErrorCode.OUT_OF_GAS,
            }),
          )
        }

        if (gas > runState.interpreter.getGasLeft()) {
          trap(
            new EVMError({
              code: EVMErrorCode.OUT_OF_GAS,
            }),
          )
        }

        runState.messageGasLimit = gasLimit
        return gas
      },
    ],
    [
      /* CALLCODE */
      0xf2,
      async function (runState, gas, common): Promise<bigint> {
        const [currentGasLimit, toAddr, value, inOffset, inLength, outOffset, outLength] =
          runState.stack.peek(7)
        const toAddress = createAddressFromStackBigInt(toAddr)

        gas += subMemUsage(runState, inOffset, inLength, common)
        gas += subMemUsage(runState, outOffset, outLength, common)

        let charge2929Gas = true
        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(toAddress) === undefined
        ) {
          const coldAccessGas = runState.env.accessWitness!.readAccountBasicData(toAddress)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(
            runState,
            createAddressFromStackBigInt(toAddr).bytes,
            common,
            charge2929Gas,
          )
        }

        if (common.isActivatedEIP(7702)) {
          gas += await eip7702GasCost(runState, common, toAddress, charge2929Gas)
        }

        if (value !== BIGINT_0) {
          gas += common.param('callValueTransferGas')
        }

        const gasLimit = maxCallGas(
          currentGasLimit,
          runState.interpreter.getGasLeft() - gas,
          runState,
          common,
        )
        // note that TangerineWhistle or later this cannot happen
        // (it could have ran out of gas prior to getting here though)
        if (gasLimit > runState.interpreter.getGasLeft() - gas) {
          trap(
            new EVMError({
              code: EVMErrorCode.OUT_OF_GAS,
            }),
          )
        }

        runState.messageGasLimit = gasLimit
        return gas
      },
    ],
    [
      /* RETURN */
      0xf3,
      async function (runState, gas, common): Promise<bigint> {
        const [offset, length] = runState.stack.peek(2)
        gas += subMemUsage(runState, offset, length, common)
        return gas
      },
    ],
    [
      /* DELEGATECALL */
      0xf4,
      async function (runState, gas, common): Promise<bigint> {
        const [currentGasLimit, toAddr, inOffset, inLength, outOffset, outLength] =
          runState.stack.peek(6)
        const toAddress = createAddressFromStackBigInt(toAddr)

        gas += subMemUsage(runState, inOffset, inLength, common)
        gas += subMemUsage(runState, outOffset, outLength, common)

        let charge2929Gas = true
        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(toAddress) === undefined
        ) {
          const coldAccessGas = runState.env.accessWitness!.readAccountBasicData(toAddress)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(
            runState,
            createAddressFromStackBigInt(toAddr).bytes,
            common,
            charge2929Gas,
          )
        }

        if (common.isActivatedEIP(7702)) {
          gas += await eip7702GasCost(runState, common, toAddress, charge2929Gas)
        }

        const gasLimit = maxCallGas(
          currentGasLimit,
          runState.interpreter.getGasLeft() - gas,
          runState,
          common,
        )
        // note that TangerineWhistle or later this cannot happen
        // (it could have ran out of gas prior to getting here though)
        if (gasLimit > runState.interpreter.getGasLeft() - gas) {
          trap(
            new EVMError({
              code: EVMErrorCode.OUT_OF_GAS,
            }),
          )
        }

        runState.messageGasLimit = gasLimit
        return gas
      },
    ],
    [
      /* CREATE2 */
      0xf5,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.interpreter.isStatic()) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }

        const [_value, offset, length, _salt] = runState.stack.peek(4)

        gas += subMemUsage(runState, offset, length, common)

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(
            runState,
            runState.interpreter.getAddress().bytes,
            common,
            false,
          )
        }

        if (common.isActivatedEIP(3860)) {
          gas += ((length + BIGINT_31) / BIGINT_32) * common.param('initCodeWordGas')
        }

        gas += common.param('keccak256WordGas') * divCeil(length, BIGINT_32)
        let gasLimit = runState.interpreter.getGasLeft() - gas
        gasLimit = maxCallGas(gasLimit, gasLimit, runState, common) // CREATE2 is only available after TangerineWhistle (Constantinople introduced this opcode)
        runState.messageGasLimit = gasLimit
        return gas
      },
    ],
    /* EXTCALL */
    [
      0xf8,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.env.eof === undefined) {
          // Opcode not available in legacy contracts
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        // Charge WARM_STORAGE_READ_COST (100) -> done in accessAddressEIP2929

        // Peek stack values
        const [toAddr, inOffset, inLength, value] = runState.stack.peek(4)

        // If value is nonzero and in static mode, throw:
        if (runState.interpreter.isStatic() && value !== BIGINT_0) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }

        // If value > 0, charge CALL_VALUE_COST
        if (value > BIGINT_0) {
          gas += common.param('callValueTransferGas')
        }

        // Check if the target address > 20 bytes
        if (toAddr > EXTCALL_TARGET_MAX) {
          trap(
            new EVMError({
              code: EOFError.InvalidExtcallTarget,
            }),
          )
        }

        // Charge for memory expansion
        gas += subMemUsage(runState, inOffset, inLength, common)

        const toAddress = createAddressFromStackBigInt(toAddr)
        // Charge to make address warm (2600 gas)
        // (in case if address is already warm, this charges the 100 gas)
        gas += accessAddressEIP2929(runState, toAddress.bytes, common)

        // Charge account creation cost if value is nonzero
        if (value > BIGINT_0) {
          const account = await runState.stateManager.getAccount(toAddress)
          const deadAccount = account === undefined || account.isEmpty()

          if (deadAccount) {
            gas += common.param('callNewAccountGas')
          }
        }

        const minRetainedGas = common.param('minRetainedGas')
        const minCalleeGas = common.param('minCalleeGas')

        const currentGasAvailable = runState.interpreter.getGasLeft() - gas
        const reducedGas = currentGasAvailable / BIGINT_64
        // Calculate the gas limit for the callee
        // (this is the gas available for the next call frame)
        let gasLimit: bigint
        if (reducedGas < minRetainedGas) {
          gasLimit = currentGasAvailable - minRetainedGas
        } else {
          gasLimit = currentGasAvailable - reducedGas
        }

        if (
          runState.env.depth >= Number(common.param('stackLimit')) ||
          runState.env.contract.balance < value ||
          gasLimit < minCalleeGas
        ) {
          // Note: this is a hack, TODO: get around this hack and clean this up
          // This special case will ensure that the actual EXT*CALL is being ran,
          // But, the code in `function.ts` will note that `runState.messageGasLimit` is set to a negative number
          // This special number signals that `1` should be put on the stack (per spec)
          gasLimit = -BIGINT_1
        }

        runState.messageGasLimit = gasLimit

        return gas
      },
    ],
    /* EXTDELEGATECALL */
    [
      0xf9,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.env.eof === undefined) {
          // Opcode not available in legacy contracts
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        // Charge WARM_STORAGE_READ_COST (100) -> done in accessAddressEIP2929

        // Peek stack values
        const [toAddr, inOffset, inLength] = runState.stack.peek(3)

        // Check if the target address > 20 bytes
        if (toAddr > EXTCALL_TARGET_MAX) {
          trap(
            new EVMError({
              code: EOFError.InvalidExtcallTarget,
            }),
          )
        }

        // Charge for memory expansion
        gas += subMemUsage(runState, inOffset, inLength, common)

        const toAddress = createAddressFromStackBigInt(toAddr)
        // Charge to make address warm (2600 gas)
        // (in case if address is already warm, this charges the 100 gas)
        gas += accessAddressEIP2929(runState, toAddress.bytes, common)

        const minRetainedGas = common.param('minRetainedGas')
        const minCalleeGas = common.param('minCalleeGas')

        const currentGasAvailable = runState.interpreter.getGasLeft() - gas
        const reducedGas = currentGasAvailable / BIGINT_64
        // Calculate the gas limit for the callee
        // (this is the gas available for the next call frame)
        let gasLimit: bigint
        if (reducedGas < minRetainedGas) {
          gasLimit = currentGasAvailable - minRetainedGas
        } else {
          gasLimit = currentGasAvailable - reducedGas
        }

        if (runState.env.depth >= Number(common.param('stackLimit')) || gasLimit < minCalleeGas) {
          // Note: this is a hack, TODO: get around this hack and clean this up
          // This special case will ensure that the actual EXT*CALL is being ran,
          // But, the code in `function.ts` will note that `runState.messageGasLimit` is set to a negative number
          // This special number signals that `1` should be put on the stack (per spec)
          gasLimit = -BIGINT_1
        }

        runState.messageGasLimit = gasLimit

        return gas
      },
    ],
    [
      /* STATICCALL */
      0xfa,
      async function (runState, gas, common): Promise<bigint> {
        const [currentGasLimit, toAddr, inOffset, inLength, outOffset, outLength] =
          runState.stack.peek(6)

        gas += subMemUsage(runState, inOffset, inLength, common)
        gas += subMemUsage(runState, outOffset, outLength, common)

        let charge2929Gas = true
        const toAddress = createAddressFromStackBigInt(toAddr)
        if (
          common.isActivatedEIP(6800) &&
          runState.interpreter._evm.getPrecompile(toAddress) === undefined
        ) {
          const coldAccessGas = runState.env.accessWitness!.readAccountBasicData(toAddress)

          gas += coldAccessGas
          charge2929Gas = coldAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(
            runState,
            createAddressFromStackBigInt(toAddr).bytes,
            common,
            charge2929Gas,
          )
        }

        if (common.isActivatedEIP(7702)) {
          gas += await eip7702GasCost(
            runState,
            common,
            createAddressFromStackBigInt(toAddr),
            charge2929Gas,
          )
        }

        const gasLimit = maxCallGas(
          currentGasLimit,
          runState.interpreter.getGasLeft() - gas,
          runState,
          common,
        ) // we set TangerineWhistle or later to true here, as STATICCALL was available from Byzantium (which is after TangerineWhistle)

        runState.messageGasLimit = gasLimit
        return gas
      },
    ],
    /* EXTSTATICCALL */
    [
      0xfb,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.env.eof === undefined) {
          // Opcode not available in legacy contracts
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        // Charge WARM_STORAGE_READ_COST (100) -> done in accessAddressEIP2929

        // Peek stack values
        const [toAddr, inOffset, inLength] = runState.stack.peek(3)

        // Check if the target address > 20 bytes
        if (toAddr > EXTCALL_TARGET_MAX) {
          trap(
            new EVMError({
              code: EOFError.InvalidExtcallTarget,
            }),
          )
        }

        // Charge for memory expansion
        gas += subMemUsage(runState, inOffset, inLength, common)

        const toAddress = createAddressFromStackBigInt(toAddr)
        // Charge to make address warm (2600 gas)
        // (in case if address is already warm, this charges the 100 gas)
        gas += accessAddressEIP2929(runState, toAddress.bytes, common)

        const minRetainedGas = common.param('minRetainedGas')
        const minCalleeGas = common.param('minCalleeGas')

        const currentGasAvailable = runState.interpreter.getGasLeft() - gas
        const reducedGas = currentGasAvailable / BIGINT_64
        // Calculate the gas limit for the callee
        // (this is the gas available for the next call frame)
        let gasLimit: bigint
        if (reducedGas < minRetainedGas) {
          gasLimit = currentGasAvailable - minRetainedGas
        } else {
          gasLimit = currentGasAvailable - reducedGas
        }

        if (runState.env.depth >= Number(common.param('stackLimit')) || gasLimit < minCalleeGas) {
          // Note: this is a hack, TODO: get around this hack and clean this up
          // This special case will ensure that the actual EXT*CALL is being ran,
          // But, the code in `function.ts` will note that `runState.messageGasLimit` is set to a negative number
          // This special number signals that `1` should be put on the stack (per spec)
          gasLimit = -BIGINT_1
        }

        runState.messageGasLimit = gasLimit

        return gas
      },
    ],
    [
      /* REVERT */
      0xfd,
      async function (runState, gas, common): Promise<bigint> {
        const [offset, length] = runState.stack.peek(2)
        gas += subMemUsage(runState, offset, length, common)
        return gas
      },
    ],
    [
      /* SELFDESTRUCT */
      0xff,
      async function (runState, gas, common): Promise<bigint> {
        if (runState.interpreter.isStatic()) {
          trap(
            new EVMError({
              code: EVMErrorCode.STATIC_STATE_CHANGE,
            }),
          )
        }
        const selfdestructToaddressBigInt = runState.stack.peek()[0]

        const selfdestructToAddress = createAddressFromStackBigInt(selfdestructToaddressBigInt)
        const contractAddress = runState.interpreter.getAddress()

        let deductGas = false
        const balance = await runState.interpreter.getExternalBalance(contractAddress)

        if (common.gteHardfork(Hardfork.SpuriousDragon)) {
          // EIP-161: State Trie Clearing
          if (balance > BIGINT_0) {
            // This technically checks if account is empty or non-existent
            const account = await runState.stateManager.getAccount(selfdestructToAddress)
            if (account === undefined || account.isEmpty()) {
              deductGas = true
            }
          }
        } else if (common.gteHardfork(Hardfork.TangerineWhistle)) {
          // EIP-150 (Tangerine Whistle) gas semantics
          const exists =
            (await runState.stateManager.getAccount(selfdestructToAddress)) !== undefined
          if (!exists) {
            deductGas = true
          }
        }
        if (deductGas) {
          gas += common.param('callNewAccountGas')
        }

        let selfDestructToCharge2929Gas = true
        if (common.isActivatedEIP(6800)) {
          gas += runState.env.accessWitness!.readAccountBasicData(contractAddress)
          if (balance > BIGINT_0) {
            gas += runState.env.accessWitness!.writeAccountBasicData(contractAddress)
          }

          let selfDestructToColdAccessGas =
            runState.env.accessWitness!.readAccountBasicData(selfdestructToAddress)
          if (balance > BIGINT_0) {
            selfDestructToColdAccessGas +=
              runState.env.accessWitness!.writeAccountBasicData(selfdestructToAddress)
          }

          gas += selfDestructToColdAccessGas
          selfDestructToCharge2929Gas = selfDestructToColdAccessGas === BIGINT_0
        }

        if (common.isActivatedEIP(2929)) {
          gas += accessAddressEIP2929(
            runState,
            selfdestructToAddress.bytes,
            common,
            selfDestructToCharge2929Gas,
            true,
          )
        }

        return gas
      },
    ],
  ])

// Set the range [0xa0, 0xa4] to the LOG handler
const logDynamicFunc = dynamicGasHandlers.get(0xa0)!
for (let i = 0xa1; i <= 0xa4; i++) {
  dynamicGasHandlers.set(i, logDynamicFunc)
}
