/**
 * QHeap types.
 * @types/qheap does not exist, so we define a custom interface here.
 */
declare module 'qheap' {
  type QHeapOptions = {
    comparBefore?(a: any, b: any): boolean
    compar?(a: any, b: any): number
    freeSpace?: number
    size?: number
  }
  export default class QHeap<T> {
    constructor(opts?: QHeapOptions)
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
}
