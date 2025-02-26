import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'

import type { Config } from '../../config.js'
import type { Sender } from './sender.js'

export interface ProtocolOptions {
  config: Config

  /* Handshake timeout in ms (default: 8000) */
  timeout?: number
}

export type Message = {
  name: string
  code: number
  payload?: any
  // TODO: check semantics of this field
  response?: number
  // TODO: check if this should be optional
  encode?: Function
  // TODO: check if this should be optional
  decode?: Function
}

/**
 * Protocol message
 * @typedef {Object} Protocol~Message
 * @property {string} name message name
 * @property {number} code message code
 * @property {response} response code of response message
 * @property {boolean} flow true if message includes flow control
 * @property {function(...*): *} encode encode message arguments
 * @property {function(*): *} decode decodes message payload
 */

/**
 * Base class for all wire protocols
 * @memberof module:net/protocol
 */
export class Protocol {
  public config: Config
  public timeout: number
  public opened: boolean

  /**
   * Create new protocol
   */
  constructor(options: ProtocolOptions) {
    this.config = options.config
    this.timeout = options.timeout ?? 8000

    this.opened = false
  }

  /**
   * Opens protocol and any associated dependencies
   */
  async open(): Promise<boolean | void> {
    this.opened = true
  }

  /**
   * Perform handshake given a sender from subclass.
   */
  async handshake(sender: Sender) {
    const status = this.encodeStatus()
    sender.sendStatus(status)
    return new Promise((resolve, reject) => {
      let timeout: any = setTimeout(() => {
        timeout = null
        reject(EthereumJSErrorWithoutCode(`Handshake timed out after ${this.timeout}ms`))
      }, this.timeout)
      const handleStatus = (status: any) => {
        if (timeout !== null && timeout !== 0) {
          clearTimeout(timeout)
          resolve(this.decodeStatus(status))
        }
      }
      if (sender.status !== undefined && sender.status !== null && sender.status !== 0) {
        handleStatus(sender.status)
      } else {
        sender.once('status', handleStatus)
      }
    })
  }

  /**
   * Abstract getter for name of protocol
   */
  get name() {
    return 'protocol'
  }

  /**
   * Protocol versions supported
   */
  get versions(): number[] {
    throw EthereumJSErrorWithoutCode('Unimplemented')
  }

  /**
   * Messages defined by this protocol
   */
  get messages(): Message[] {
    throw EthereumJSErrorWithoutCode('Unimplemented')
  }

  /**
   * Encodes status into status message payload. Must be implemented by subclass.
   */
  encodeStatus(): any {
    throw EthereumJSErrorWithoutCode('Unimplemented')
  }

  /**
   * Decodes status message payload into a status object.  Must be implemented
   * by subclass.
   * @param _status status message payload
   */
  decodeStatus(_status: any): Object {
    throw EthereumJSErrorWithoutCode('Unimplemented')
  }

  /**
   * Encodes message into proper format before sending
   * @param message message definition
   * @param args message arguments
   */
  encode(message: Message, args: any): any {
    if (message.encode) {
      return message.encode(args)
    }
    return args
  }

  /**
   * Decodes message payload
   * @param message message definition
   * @param payload message payload
   */
  decode(message: Message, payload: any): any {
    if (message.decode) {
      return message.decode(payload)
    }
    return payload
  }
}
