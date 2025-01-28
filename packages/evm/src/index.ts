import { EOFContainer, validateEOF } from './eof/container.js'
import {
  RuntimeErrorMessage as EVMRuntimeErrorMessage,
  EvmError,
  EvmErrorCode,
  EvmErrorType,
} from './errors.js'
import { EVM } from './evm.js'
import { Message } from './message.js'
import { getOpcodesForHF } from './opcodes/index.js'
import {
  MCLBLS,
  NobleBLS,
  NobleBN254,
  type PrecompileInput,
  RustBN254,
  getActivePrecompiles,
} from './precompiles/index.js'
import { EVMMockBlockchain } from './types.js'

import type { InterpreterStep } from './interpreter.js'
import type {
  EVMBLSInterface,
  EVMBN254Interface,
  EVMInterface,
  EVMMockBlockchainInterface,
  EVMOpts,
  EVMResult,
  EVMRunCallOpts,
  EVMRunCodeOpts,
  ExecResult,
  Log,
} from './types.js'
export * from './logger.js'

export type {
  EVMBLSInterface,
  EVMBN254Interface,
  EVMInterface,
  EVMMockBlockchainInterface,
  EVMOpts,
  EVMResult,
  EVMRunCallOpts,
  EVMRunCodeOpts,
  ExecResult,
  InterpreterStep,
  Log,
  PrecompileInput,
}

export {
  EOFContainer,
  EVM,
  EvmError,
  EvmErrorCode,
  EvmErrorType,
  EVMMockBlockchain,
  EVMRuntimeErrorMessage,
  getActivePrecompiles,
  getOpcodesForHF,
  MCLBLS,
  Message,
  NobleBLS,
  NobleBN254,
  RustBN254,
  validateEOF,
}

export * from './constructors.js'
export * from './params.js'
export * from './verkleAccessWitness.js'
