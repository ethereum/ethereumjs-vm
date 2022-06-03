/**
 * Generic EthereumJS error class with metadata attached
 *
 * Kudos to https://github.com/ChainSafe/lodestar monorepo
 * for the inspiration :-)
 */
type EthereumJSErrorType = {
  objectContext: string
}

export class EthereumJSError<T> extends Error {
  code: string
  context: T | {}

  constructor(msg: string, code: string, context?: T) {
    super(msg)
    this.code = code
    this.context = context ?? {}
  }

  getContext(): Record<string, string | number | null> {
    return { code: this.code, ...this.context }
  }

  /**
   * Get the metadata and the stacktrace for the error.
   */
  toObject(): Record<string, string | number | null> {
    return {
      ...this.getContext(),
      stack: this.stack ?? '',
    }
  }
}

/**
 * Error Codes
 */
export enum ErrorCode {
  // Value Errors
  INVALID_OBJECT = 'INVALID_OBJECT',
  INVALID_VALUE = 'INVALID_VALUE',
  INVALID_VALUE_LENGTH = 'INVALID_VALUE_LENGTH',
  TOO_FEW_VALUES = 'TOO_FEW_VALUES',
  TOO_MANY_VALUES = 'TOO_MANY_VALUES',

  // Usage Errors
  EIP_NOT_ACTIVATED = 'EIP_NOT_ACTIVATED',
  INCOMPATIBLE_LIBRARY_VERSION = 'INCOMPATIBLE_LIBRARY_VERSION',
  INVALID_OPTION_USAGE = 'INVALID_OPTION_USAGE',
  INVALID_METHOD_CALL = 'INVALID_METHOD_CALL',
}

/**
 * Generic error types
 */

/**
 * Type flavors for ValueError
 */
export type ValueErrorType =
  | {
      received: string
    }
  | {
      objectContext: string
      received: string
    }
  | EthereumJSErrorType

/**
 * Type flavors for UsageError
 */
export type UsageErrorType = EthereumJSErrorType

/**
 * Generic Errors
 *
 * Use directly or in a subclassed context for error comparison (`e instanceof ValueError`)
 */

/**
 * Error along Object Value
 */
export class ValueError extends EthereumJSError<ValueErrorType> {}

/**
 * Error along API Usage
 *
 * Use directly or in a subclassed context for error comparison (`e instanceof UsageError`)
 */
export class UsageError extends EthereumJSError<UsageErrorType> {}
