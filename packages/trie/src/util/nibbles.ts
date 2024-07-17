import { toBytes } from '@ethereumjs/util'

import type { Nibbles } from '../types.js'
import type { BatchDBOp } from '@ethereumjs/util'

/**
 * Converts a bytes to a nibble array.
 * @private
 * @param key
 */
export function bytesToNibbles(key: Uint8Array): Nibbles {
  const bkey = toBytes(key)
  const nibbles = [] as Nibbles

  for (let i = 0; i < bkey.length; i++) {
    let q = i * 2
    nibbles[q] = bkey[i] >> 4
    ++q
    nibbles[q] = bkey[i] % 16
  }

  return nibbles
}

/**
 * Converts a nibble array into bytes.
 * @private
 * @param arr - Nibble array
 */
export function nibblestoBytes(arr: Nibbles): Uint8Array {
  const buf = new Uint8Array(arr.length / 2)
  for (let i = 0; i < buf.length; i++) {
    let q = i * 2
    buf[i] = (arr[q] << 4) + arr[++q]
  }
  return buf
}

/**
 * Compare two nibble array.
 * * `0` is returned if `n2` === `n1`.
 * * `1` is returned if `n2` > `n1`.
 * * `-1` is returned if `n2` < `n1`.
 * @param n1 - Nibble array
 * @param n2 - Nibble array
 */
export function nibblesCompare(n1: Nibbles, n2: Nibbles) {
  const cmpLength = Math.min(n1.length, n2.length)

  let res = 0
  for (let i = 0; i < cmpLength; i++) {
    if (n1[i] < n2[i]) {
      res = -1
      break
    } else if (n1[i] > n2[i]) {
      res = 1
      break
    }
  }

  if (res === 0) {
    if (n1.length < n2.length) {
      res = -1
    } else if (n1.length > n2.length) {
      res = 1
    }
  }

  return res
}

/**
 * Returns the number of in order matching nibbles of two give nibble arrays.
 * @private
 * @param nib1
 * @param nib2
 */
export function matchingNibbleLength(nib1: Nibbles, nib2: Nibbles): number {
  let i = 0
  while (nib1[i] === nib2[i] && nib1.length > i) {
    i++
  }
  return i
}

/**
 * Compare two nibble array keys.
 * @param keyA
 * @param keyB
 */
export function doKeysMatch(keyA: Nibbles, keyB: Nibbles): boolean {
  const length = matchingNibbleLength(keyA, keyB)
  return length === keyA.length && length === keyB.length
}

export function orderBatch(
  ops: BatchDBOp[],
  keyTransform: (msg: Uint8Array) => Uint8Array = (msg: Uint8Array) => {
    return msg
  }
): BatchDBOp[] {
  const keyNibbles: [number, number[]][] = ops.map((o, i) => {
    const appliedKey = keyTransform(o.key)
    const nibbles: number[] = bytesToNibbles(appliedKey)
    return [i, nibbles]
  })
  keyNibbles.sort(([_, a], [__, b]) => {
    return nibblesCompare(a, b)
  })
  return keyNibbles.map(([i, _]) => ops[i])
}
