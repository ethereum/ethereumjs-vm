import { toBytes } from '@ethereumjs/util'

/**
 * Converts a bytes to a nibble array.
 * @private
 * @param key
 */
export function bytesToNibbles(key: Uint8Array): number[] {
  const bkey = toBytes(key)
  const nibbles = [] as number[]

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
export function nibblestoBytes(arr: number[]): Uint8Array {
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
export function nibblesCompare(n1: number[], n2: number[]) {
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
export function matchingNibbleLength(nib1: number[], nib2: number[]): number {
  const maxLength = Math.min(nib1.length, nib2.length)
  let i = 0
  while (i < maxLength && nib1[i] === nib2[i]) {
    i++
  }
  return i
}

/**
 * Compare two nibble array keys.
 * @param keyA
 * @param keyB
 */
export function doKeysMatch(keyA: number[], keyB: number[]): boolean {
  const length = matchingNibbleLength(keyA, keyB)
  return length === keyA.length && length === keyB.length
}

export function firstNibble(key: Uint8Array): number {
  return key[0] >> 4
}
export function concatNibbles(a: number[], b: number[]): number[] {
  return [...a, ...b]
}
export type CommonPrefixResult = {
  commonPrefix: number[]
  remainingNibbles1: number[]
  remainingNibbles2: number[]
}
export function findCommonPrefix(nibbles1: number[], nibbles2: number[]): CommonPrefixResult {
  const matching = matchingNibbleLength(nibbles1, nibbles2)
  return {
    commonPrefix: nibbles1.slice(0, matching),
    remainingNibbles1: nibbles1.slice(matching),
    remainingNibbles2: nibbles2.slice(matching),
  }
}
export function hasMatchingNibbles(a: number[], b: number[]): boolean {
  const minLength = Math.min(a.length, b.length)
  for (let i = 0; i < minLength; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}
export function getSharedNibbles(nibbles1: number[], nibbles2: number[]): number[] {
  const sharedNibbles = []
  for (let i = 0; i < Math.min(nibbles1.length, nibbles2.length); i++) {
    if (nibbles1[i] !== nibbles2[i]) {
      break
    }
    sharedNibbles.push(nibbles1[i])
  }
  return sharedNibbles
}

export function nibblesEqual(nib1: number[], nib2: number[]) {
  if (nib1.length !== nib2.length) {
    return false
  }
  for (let i = 0; i < nib1.length; i++) {
    if (nib1[i] !== nib2[i]) {
      return false
    }
  }
  return true
}
