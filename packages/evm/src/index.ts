import { EOFContainer, validateEOF } from './eof/container.js'
import { EVM } from './evm.js'
import { ERROR as EVMErrorMessage, EvmError } from './exceptions.js'
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
  EVMErrorMessage,
  EVMMockBlockchain,
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
export * from './evmmax/fieldContext.js'
export * from './params.js'
export * from './verkleAccessWitness.js'
