import { EthereumJSError } from '@ethereumjs/util'

import type { EOFError } from './eof/errors.js'

// TODO: merge EOF errors in here
export enum EVMErrorCode {
  OUT_OF_GAS = 'out of gas',
  CODESTORE_OUT_OF_GAS = 'code store out of gas',
  CODESIZE_EXCEEDS_MAXIMUM = 'code size to deposit exceeds maximum code size',
  STACK_UNDERFLOW = 'stack underflow',
  STACK_OVERFLOW = 'stack overflow',
  INVALID_JUMP = 'invalid JUMP',
  INVALID_OPCODE = 'invalid opcode',
  OUT_OF_RANGE = 'value out of range',
  REVERT = 'revert',
  STATIC_STATE_CHANGE = 'static state change',
  INTERNAL_ERROR = 'internal error',
  CREATE_COLLISION = 'create collision',
  STOP = 'stop',
  REFUND_EXHAUSTED = 'refund exhausted',
  VALUE_OVERFLOW = 'value overflow',
  INSUFFICIENT_BALANCE = 'insufficient balance',
  INVALID_BYTECODE_RESULT = 'invalid bytecode deployed',
  INITCODE_SIZE_VIOLATION = 'initcode exceeds max initcode size',
  INVALID_INPUT_LENGTH = 'invalid input length',
  INVALID_EOF_FORMAT = 'invalid EOF format',
  INVALID_PRECOMPILE = 'invalid precompile',

  // BLS errors
  BLS_12_381_INVALID_INPUT_LENGTH = 'invalid input length',
  BLS_12_381_POINT_NOT_ON_CURVE = 'point not on curve',
  BLS_12_381_INPUT_EMPTY = 'input is empty',
  BLS_12_381_FP_NOT_IN_FIELD = 'fp point not in field',

  // BN254 errors
  BN254_FP_NOT_IN_FIELD = 'fp point not in field',

  // Point Evaluation Errors
  INVALID_COMMITMENT = 'kzg commitment does not match versioned hash',
  INVALID_INPUTS = 'kzg inputs invalid',
  INVALID_PROOF = 'kzg proof invalid',
}

type EVMErrorType =
  | {
      code: EVMErrorCode | EOFError
    }
  | { code: EVMErrorCode.REVERT; revertBytes: Uint8Array }

export class EVMError extends EthereumJSError<EVMErrorType> {
  constructor(type: EVMErrorType, message?: string) {
    super(type, message)
  }

  // TODO: add helper method to format the error in a human readable way
}
