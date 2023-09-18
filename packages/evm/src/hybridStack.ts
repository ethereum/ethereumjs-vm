import { bigIntToBytes, bytesToBigInt } from '@ethereumjs/util'

import { ERROR, EvmError } from './exceptions.js'

import type { EVMStack } from './types.js'

/**
 * Hybrid stack implementation for the EVM, containing either bytes (preferred) or bigint values.
 *
 * This stack implementation is significantly more performant than the single type stack. Atm it is however
 * not activated by default for backwards compatibility reasons.
 *
 * In the current EVM version this stack performs significantly worse than the hybrid type stack on the EVM
 * `step` event (if used), since there is mapping to a single type stack needed on each step.
 *
 * Developer notes:
 *
 * 1. If there are bigint/bytes conversions in opcode implementations before or after accessing the stack,
 * direct calling into the type-named methods here should be preferred and the conversion removed from the
 * opcode implementation.
 * 2. If a byte-based opcode implementation has no direct performance penalties towards the bigint version,
 * the bytes version should be used (respectively: replace the bigint version)
 */

type StackElement = [bigint | undefined, Uint8Array | undefined]
type Store = StackElement[]

export class HybridStack implements EVMStack {
  // This array is initialized as an empty array. Once values are pushed, the array size will never decrease.
  private _store: Store
  private _maxHeight: number

  private _len: number = 0

  constructor(maxHeight?: number) {
    // It is possible to initialize the array with `maxHeight` items. However,
    // this makes the constructor 10x slower and there do not seem to be any observable performance gains
    this._store = []
    this._maxHeight = maxHeight ?? 1024
  }

  get length() {
    return this._len
  }

  /**
   * Push an item to the stack.
   * @deprecated use the type-named version of the method
   * @param value
   */
  push(value: bigint) {
    this.pushBigInt(value)
  }

  /**
   * Push an item to the stack.
   * @param value
   */
  pushBigInt(value: bigint) {
    if (this._len >= this._maxHeight) {
      throw new EvmError(ERROR.STACK_OVERFLOW)
    }

    // Read current length, set `_store` to value, and then increase the length
    this._store[this._len++] = [value, undefined]
  }

  /**
   * Push an item to the stack.
   * @param value
   */
  pushBytes(value: Uint8Array) {
    if (this._len >= this._maxHeight) {
      throw new EvmError(ERROR.STACK_OVERFLOW)
    }

    // Read current length, set `_store` to value, and then increase the length
    this._store[this._len++] = [undefined, value]
  }

  /**
   * Pop an item from the stack.
   * @deprecated use the type-named version of the method
   * @param value
   */
  pop(): bigint {
    return this.popBigInt()
  }

  /**
   * Pop an item from the stack.
   * @param value
   */
  popBigInt(): bigint {
    if (this._len < 1) {
      throw new EvmError(ERROR.STACK_UNDERFLOW)
    }

    // Length is checked above, so pop shouldn't return undefined
    // First decrease current length, then read the item and return it
    // Note: this does thus not delete the item from the internal array
    // However, the length is decreased, so it is not accessible to external observors
    const elem = this._store[--this._len]
    if (elem[0] !== undefined) {
      return elem[0]
    }
    return bytesToBigInt(elem[1]!)
  }

  /**
   * Pop an item from the stack.
   * @param value
   */
  popBytes(): Uint8Array {
    if (this._len < 1) {
      throw new EvmError(ERROR.STACK_UNDERFLOW)
    }

    // Length is checked above, so pop shouldn't return undefined
    // First decrease current length, then read the item and return it
    // Note: this does thus not delete the item from the internal array
    // However, the length is decreased, so it is not accessible to external observors
    const elem = this._store[--this._len]
    if (elem[1] !== undefined) {
      return elem[1]
    }
    return bigIntToBytes(elem[0]!)
  }

  /**
   * Pop multiple items from stack. Top of stack is first item
   * in returned array.
   * @deprecated use the type-named version of the method
   * @param num - Number of items to pop
   */
  popN(num: number = 1): bigint[] {
    return this.popNBigInt(num)
  }

  /**
   * Pop multiple items from stack. Top of stack is first item
   * in returned array.
   * @param num - Number of items to pop
   */
  popNBigInt(num: number = 1): bigint[] {
    if (this._len < num) {
      throw new EvmError(ERROR.STACK_UNDERFLOW)
    }

    if (num === 0) {
      return []
    }

    const arr: bigint[] = Array(num)
    const cache = this._store

    for (let pop = 0; pop < num; pop++) {
      // Note: this thus also (correctly) reduces the length of the internal array (without deleting items)
      const elem = cache[--this._len]
      if (elem[0] !== undefined) {
        arr[pop] = elem[0]
      } else {
        arr[pop] = bytesToBigInt(elem[1]!)
      }
    }

    return arr
  }

  /**
   * Pop multiple items from stack. Top of stack is first item
   * in returned array.
   * @param num - Number of items to pop
   */
  popNBytes(num: number = 1): Uint8Array[] {
    if (this._len < num) {
      throw new EvmError(ERROR.STACK_UNDERFLOW)
    }

    if (num === 0) {
      return []
    }

    const arr: Uint8Array[] = Array(num)
    const cache = this._store

    for (let pop = 0; pop < num; pop++) {
      // Note: this thus also (correctly) reduces the length of the internal array (without deleting items)
      const elem = cache[--this._len]
      if (elem[1] !== undefined) {
        arr[pop] = elem[1]
      } else {
        arr[pop] = bigIntToBytes(elem[0]!)
      }
    }

    return arr
  }

  /**
   * Return items from the stack
   * @deprecated use the type-named version of the method
   * @param num Number of items to return
   * @throws {@link ERROR.STACK_UNDERFLOW}
   */
  peek(num: number = 1): bigint[] {
    return this.peekBigInt(num)
  }

  /**
   * Return items from the stack
   * @param num Number of items to return
   * @throws {@link ERROR.STACK_UNDERFLOW}
   */
  peekBigInt(num: number = 1): bigint[] {
    const peekArray: bigint[] = Array(num)
    let start = this._len

    for (let peek = 0; peek < num; peek++) {
      const index = --start
      if (index < 0) {
        throw new EvmError(ERROR.STACK_UNDERFLOW)
      }
      if (this._store[index][0] !== undefined) {
        peekArray[peek] = this._store[index][0]!
      } else {
        const valueBigInt = bytesToBigInt(this._store[index][1]!)
        this._store[index][0] = valueBigInt
        peekArray[peek] = valueBigInt
      }
    }
    return peekArray
  }

  /**
   * Return items from the stack
   * @param num Number of items to return
   * @throws {@link ERROR.STACK_UNDERFLOW}
   */
  peekBytes(num: number = 1): Uint8Array[] {
    const peekArray: Uint8Array[] = Array(num)
    let start = this._len

    for (let peek = 0; peek < num; peek++) {
      const index = --start
      if (index < 0) {
        throw new EvmError(ERROR.STACK_UNDERFLOW)
      }
      if (this._store[index][1] !== undefined) {
        peekArray[peek] = this._store[index][1]!
      } else {
        const valueBytes = bigIntToBytes(this._store[index][0]!)
        this._store[index][1] = valueBytes
        peekArray[peek] = valueBytes
      }
    }
    return peekArray
  }

  /**
   * Swap top of stack with an item in the stack.
   * @param position - Index of item from top of the stack (0-indexed)
   */
  swap(position: number) {
    if (this._len <= position) {
      throw new EvmError(ERROR.STACK_UNDERFLOW)
    }

    const head = this._len - 1
    const i = head - position
    const storageCached = this._store

    const tmp = storageCached[head]
    storageCached[head] = storageCached[i]
    storageCached[i] = tmp
  }

  /**
   * Pushes a copy of an item in the stack.
   * @param position - Index of item to be copied (1-indexed)
   */
  // I would say that we do not need this method any more
  // since you can't copy a primitive data type
  // Nevertheless not sure if we "loose" something here?
  // Will keep commented out for now
  dup(position: number) {
    const len = this._len
    if (len < position) {
      throw new EvmError(ERROR.STACK_UNDERFLOW)
    }

    // Note: this code is borrowed from `push()` (avoids a call)
    if (len >= this._maxHeight) {
      throw new EvmError(ERROR.STACK_OVERFLOW)
    }

    const i = len - position
    this._store[this._len++] = this._store[i]
  }

  /**
   * Returns a copy of the current stack. This represents the actual state of the stack
   * (not the internal state of the stack, which might have unreachable elements in it)
   */
  getStack() {
    return this._store.slice(0, this._len).map((elem: StackElement) => {
      if (elem[0] !== undefined) {
        return elem[0]
      } else {
        return bytesToBigInt(elem[1]!)
      }
    })
  }
}
