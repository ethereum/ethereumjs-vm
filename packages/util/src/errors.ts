/**
 * Generic EthereumJS error class with metadata attached
 *
 * Kudos to https://github.com/ChainSafe/lodestar monorepo
 * for the inspiration :-)
 * See: https://github.com/ChainSafe/lodestar/blob/unstable/packages/utils/src/errors.ts
 */
export type EthereumJSErrorMetaData = Record<string, string | number | null>
export type EthereumJSErrorObject = {
  message: string
  stack: string
  className: string
  type: EthereumJSErrorMetaData
}

// In order to update all our errors to use `EthereumJSError`, temporarily include the
// unset error code. All errors throwing this code should be updated to use the relevant
// error code.
export const DEFAULT_ERROR_CODE = 'ETHEREUMJS_DEFAULT_ERROR_CODE'

/**
 * Generic EthereumJS error with attached metadata
 */
export class EthereumJSError<T extends { code: string }> extends Error {
  type: T
  constructor(type: T, message?: string, stack?: string) {
    super(message ?? type.code)
    this.type = type
    if (stack !== undefined) this.stack = stack
  }

  getMetadata(): EthereumJSErrorMetaData {
    return this.type
  }

  /**
   * Get the metadata and the stacktrace for the error.
   */
  toObject(): EthereumJSErrorObject {
    return {
      type: this.getMetadata(),
      message: this.message ?? '',
      stack: this.stack ?? '',
      className: this.constructor.name,
    }
  }
}

/**
 * @deprecated Use `EthereumJSError` with a set error code instead
 * @param message Optional error message
 * @param stack Optional stack trace
 * @returns
 */
export function EthereumJSErrorWithoutCode(message?: string, stack?: string) {
  return new EthereumJSError({ code: DEFAULT_ERROR_CODE }, message, stack)
}

// Below here: specific monorepo-wide errors (examples and commented out)

/*export enum UsageErrorType {
  UNSUPPORTED_FEATURE = 'unsupported feature',
}*

/**
 * Error along API Usage
 *
 * Use directly or in a subclassed context for error comparison (`e instanceof UsageError`)
 */
//export class UsageError extends EthereumJSError<{ code: UsageErrorType }> {}
