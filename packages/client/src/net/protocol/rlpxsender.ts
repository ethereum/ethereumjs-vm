import { Sender } from './sender.js'

import type { ETH as Devp2pETH, LES as Devp2pLES, SNAP as Devp2pSNAP } from '@ethereumjs/devp2p'

/**
 * DevP2P/RLPx protocol sender
 * @emits message
 * @emits status
 * @memberof module:net/protocol
 */
export class RlpxSender extends Sender {
  private sender: Devp2pETH | Devp2pLES | Devp2pSNAP

  /**
   * Creates a new DevP2P/Rlpx protocol sender
   * @param rlpxProtocol protocol object from @ethereumjs/devp2p
   */
  constructor(rlpxProtocol: Devp2pETH | Devp2pLES | Devp2pSNAP) {
    super()

    this.sender = rlpxProtocol
    this.sender.events.on('status', (status: any) => {
      this.status = status
    })
    this.sender.events.on('message', (code: number, payload: any) => {
      this.emit('message', { code, payload })
    })
  }

  /**
   * Send a status to peer
   * @param status
   */
  sendStatus(status: any) {
    try {
      this.sender.sendStatus(status)
    } catch (err) {
      this.emit('error', err)
    }
  }

  /**
   * Send a message to peer
   * @param code message code
   * @param data message payload
   */
  sendMessage(code: number, data: any) {
    try {
      //@ts-ignore "type number is not assignable to type never"
      this.sender.sendMessage(code, data)
    } catch (err) {
      this.emit('error', err)
    }
  }
}
