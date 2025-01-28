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

/**
 * Generic EthereumJS error with attached metadata
 */
export class EthereumJSError<T extends { code: string }> extends Error {
  type: T
  code: string // TODO likely remove this and for error inspection inspect `error.type.code` (like Lodestar)
  constructor(type: T, message?: string, stack?: string) {
    super(message ?? type.code)
    this.type = type
    this.code = type.code
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
