import { EventEmitter } from 'events'
import type multiaddr from 'multiaddr'
import type { Block, BlockHeader } from '@ethereumjs/block'
import type Connection from '../../../node_modules/libp2p-interfaces/dist/src/connection/connection'
import type { MuxedStream } from '../../../node_modules/libp2p-interfaces/dist/src/stream-muxer/types'
import { Libp2pPeer, RlpxPeer } from './net/peer'
import { Peer as Devp2pRlpxPeer } from '@ethereumjs/devp2p'
/**
 * Types for the central event bus, emitted
 * by different components of the client.
 */
export enum Event {
  CHAIN_UPDATED = 'blockchain:chain:updated',
  SYNC_EXECUTION_VM_ERROR = 'sync:execution:vm:error',
  SYNC_FETCHER_FETCHED = 'sync:fetcher:fetched',
  SYNC_SYNCHRONIZED = 'sync:synchronized',
  PEER_CONNECTED = 'peer:connected',
}
export interface EventParams {
  [Event.CHAIN_UPDATED]: []
  [Event.SYNC_EXECUTION_VM_ERROR]: [Error]
  [Event.SYNC_FETCHER_FETCHED]: [Block[] | BlockHeader[]]
  [Event.SYNC_SYNCHRONIZED]: []
  [Event.PEER_CONNECTED]: [Libp2pPeer | RlpxPeer | Devp2pRlpxPeer]
}
export declare interface EventBus<T extends Event> {
  emit(event: T, ...args: EventParams[T]): boolean
  on(event: T, listener: (...args: EventParams[T]) => void): this
}
export class EventBus<T extends Event> extends EventEmitter {}
export type EventBusType = EventBus<Event.CHAIN_UPDATED> &
  EventBus<Event.SYNC_EXECUTION_VM_ERROR> &
  EventBus<Event.SYNC_FETCHER_FETCHED> &
  EventBus<Event.SYNC_SYNCHRONIZED> &
  EventBus<Event.PEER_CONNECTED>

/**
 * Like types
 */
export type Key = Buffer
export type KeyLike = string | Key

export type MultiaddrLike = string | string[] | multiaddr | multiaddr[]

/**
 * DNS
 */
export type DnsNetwork = string

/**
 * Libp2p aliases for convenience
 */
export type Libp2pConnection = Connection
export type Libp2pMuxedStream = MuxedStream

/**
 * QHeap types.
 * @types/qheap does not exist, so we define a custom interface here.
 */
type QHeapOptions = {
  comparBefore(a: any, b: any): boolean
  compar(a: any, b: any): number
  freeSpace: number
  size: number
}
export interface QHeap<T> {
  // eslint-disable-next-line @typescript-eslint/no-misused-new
  new (opts: QHeapOptions): QHeap<T>
  insert(item: T): void
  push(item: T): void
  enqueue(item: T): void
  remove(): T | undefined
  shift(): T | undefined
  dequeue(): T | undefined
  peek(): T | undefined
  length: number
  gc(opts: { minLength: number; maxLength: number }): void
}
