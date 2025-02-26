import { Block, BlockHeader, createBlock, createBlockHeader } from '@ethereumjs/block'
import { RLP } from '@ethereumjs/rlp'
import {
  BIGINT_0,
  EthereumJSErrorWithoutCode,
  KeyEncoding,
  TWO_POW256,
  ValueEncoding,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  concatBytes,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
} from '@ethereumjs/util'
import { keccak256, keccak512 } from 'ethereum-cryptography/keccak.js'

import {
  bytesReverse,
  fnv,
  fnvBytes,
  getCacheSize,
  getEpoc,
  getFullSize,
  getSeed,
  params,
} from './util.js'

import type { BlockData, HeaderData } from '@ethereumjs/block'
import type { DB, DBObject, PrefixedHexString } from '@ethereumjs/util'

function xor(a: Uint8Array, b: Uint8Array) {
  const len = Math.max(a.length, b.length)
  const res = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    res[i] = a[i] ^ b[i]
  }
  return res
}

export type Solution = {
  mixHash: Uint8Array
  nonce: Uint8Array
}

export class Miner {
  private blockHeader: BlockHeader
  private block?: Block
  private ethash: Ethash

  public solution?: Solution

  private currentNonce: bigint
  private headerHash?: Uint8Array
  private stopMining: boolean

  /**
   * Create a Miner object
   * @param mineObject - The object to mine on, either a `BlockHeader` or a `Block` object
   * @param ethash - Ethash object to use for mining
   */

  constructor(mineObject: BlockHeader | Block, ethash: Ethash) {
    if (mineObject instanceof BlockHeader) {
      this.blockHeader = mineObject
    } else if (mineObject instanceof Block) {
      this.block = mineObject
      this.blockHeader = mineObject.header
    } else {
      throw EthereumJSErrorWithoutCode('unsupported mineObject')
    }
    this.currentNonce = BIGINT_0
    this.ethash = ethash
    this.stopMining = false
  }

  /**
   * Stop the miner on the next iteration
   */
  stop() {
    this.stopMining = true
  }

  /**
   * Iterate `iterations` time over nonces, returns a `BlockHeader` or `Block` if a solution is found, `undefined` otherwise
   * @param iterations - Number of iterations to iterate over. If `-1` is passed, the loop runs until a solution is found
   * @returns - `undefined` if no solution was found within the iterations, or a `BlockHeader` or `Block`
   *           with valid PoW based upon what was passed in the constructor
   */
  async mine(iterations: number = 0): Promise<undefined | BlockHeader | Block> {
    const solution = await this.iterate(iterations)

    if (solution) {
      if (this.block) {
        const data = <BlockData>this.block.toJSON()
        data.header!.mixHash = solution.mixHash
        data.header!.nonce = solution.nonce
        return createBlock(data, { common: this.block.common })
      } else {
        const data = <HeaderData>this.blockHeader.toJSON()
        data.mixHash = solution.mixHash
        data.nonce = solution.nonce
        return createBlockHeader(data, { common: this.blockHeader.common })
      }
    }
  }

  /**
   * Iterate `iterations` times over nonces to find a valid PoW. Caches solution if one is found
   * @param iterations - Number of iterations to iterate over. If `-1` is passed, the loop runs until a solution is found
   * @returns - `undefined` if no solution was found, or otherwise a `Solution` object
   */
  async iterate(iterations: number = 0): Promise<undefined | Solution> {
    if (this.solution) {
      return this.solution
    }
    if (!this.headerHash) {
      this.headerHash = this.ethash.headerHash(this.blockHeader.raw())
    }
    const headerHash = this.headerHash
    const { number, difficulty } = this.blockHeader

    await this.ethash.loadEpoc(number)

    while (iterations !== 0 && !this.stopMining) {
      // The promise/setTimeout construction is necessary to ensure we jump out of the event loop
      // Without this, for high-difficulty blocks JS never jumps out of the Promise
      const solution: Solution | null = await new Promise((resolve) => {
        setTimeout(() => {
          const nonce = setLengthLeft(bigIntToBytes(this.currentNonce), 8)

          const a = this.ethash.run(headerHash, nonce)
          const result = bytesToBigInt(a.hash)

          if (TWO_POW256 / difficulty > result) {
            const solution: Solution = {
              mixHash: a.mix,
              nonce,
            }
            this.solution = solution
            resolve(solution)
            return
          }

          this.currentNonce++
          iterations--

          resolve(null)
        }, 0)
      })

      if (solution !== null) {
        return solution
      }
    }
  }
}

export class Ethash {
  dbOpts: Object
  cacheDB?: DB<number, DBObject>
  cache: Uint8Array[]
  epoc?: number
  fullSize?: number
  cacheSize?: number
  seed?: Uint8Array

  constructor(cacheDB?: DB<number, DBObject>) {
    this.dbOpts = {
      valueEncoding: 'json',
    }
    this.cacheDB = cacheDB
    this.cache = []
  }

  mkcache(cacheSize: number, seed: Uint8Array) {
    const n = Math.floor(cacheSize / params.HASH_BYTES)
    const o = [keccak512(seed)]

    let i
    for (i = 1; i < n; i++) {
      o.push(keccak512(o[o.length - 1]))
    }

    for (let _ = 0; _ < params.CACHE_ROUNDS; _++) {
      for (i = 0; i < n; i++) {
        const v = new DataView(o[i].buffer).getUint32(0, true) % n
        o[i] = keccak512(xor(o[(i - 1 + n) % n], o[v]))
      }
    }

    this.cache = o
    return this.cache
  }

  calcDatasetItem(i: number): Uint8Array {
    const n = this.cache.length
    const r = Math.floor(params.HASH_BYTES / params.WORD_BYTES)
    let mix = new Uint8Array(this.cache[i % n])
    const mixView = new DataView(mix.buffer)
    mixView.setUint32(0, mixView.getUint32(0, true) ^ i, true)
    mix = keccak512(mix)
    for (let j = 0; j < params.DATASET_PARENTS; j++) {
      const cacheIndex = fnv(i ^ j, new DataView(mix.buffer).getUint32((j % r) * 4, true))
      mix = fnvBytes(mix, this.cache[cacheIndex % n])
    }
    return keccak512(mix)
  }

  run(val: Uint8Array, nonce: Uint8Array, fullSize?: number) {
    if (fullSize === undefined) {
      if (this.fullSize === undefined) {
        throw EthereumJSErrorWithoutCode('fullSize needed')
      } else {
        fullSize = this.fullSize
      }
    }
    const n = Math.floor(fullSize / params.HASH_BYTES)
    const w = Math.floor(params.MIX_BYTES / params.WORD_BYTES)
    const s = keccak512(concatBytes(val, bytesReverse(nonce)))
    const mixhashes = Math.floor(params.MIX_BYTES / params.HASH_BYTES)
    let mix = concatBytes(...Array(mixhashes).fill(s))

    let i
    for (i = 0; i < params.ACCESSES; i++) {
      const p =
        (fnv(
          i ^ new DataView(s.buffer).getUint32(0, true),
          new DataView(mix.buffer).getUint32((i % w) * 4, true),
        ) %
          Math.floor(n / mixhashes)) *
        mixhashes
      const newdata: Uint8Array[] = []
      for (let j = 0; j < mixhashes; j++) {
        newdata.push(this.calcDatasetItem(p + j))
      }
      mix = fnvBytes(mix, concatBytes(...newdata))
    }

    const cmix = new Uint8Array(mix.length / 4)
    const cmixView = new DataView(cmix.buffer)
    const mixView = new DataView(mix.buffer)
    for (i = 0; i < mix.length / 4; i = i + 4) {
      const a = fnv(mixView.getUint32(i * 4, true), mixView.getUint32((i + 1) * 4, true))
      const b = fnv(a, mixView.getUint32((i + 2) * 4, true))
      const c = fnv(b, mixView.getUint32((i + 3) * 4, true))
      cmixView.setUint32(i, c, true)
    }

    return {
      mix: cmix,
      hash: keccak256(concatBytes(s, cmix)),
    }
  }

  cacheHash() {
    // Concatenate all the cache bytes together
    // We can't use `concatBytes` because calling `concatBytes(...this.cache)` results
    // in a `Max call stack size exceeded` error due to the spread operator pushing all
    // of the array elements onto the stack and the ethash cache can be quite large
    const length = this.cache.reduce((a, arr) => a + arr.length, 0)
    const result = new Uint8Array(length)
    for (let i = 0, pad = 0; i < this.cache.length; i++) {
      const arr = this.cache[i]
      result.set(arr, pad)
      pad += arr.length
    }
    return keccak256(result)
  }

  headerHash(rawHeader: Uint8Array[]) {
    return keccak256(RLP.encode(rawHeader.slice(0, -2)))
  }

  /**
   * Loads the seed and cache given a block number.
   */
  async loadEpoc(number: bigint) {
    const epoc = getEpoc(number)

    if (this.epoc === epoc) {
      return
    }

    this.epoc = epoc

    if (!this.cacheDB) {
      throw EthereumJSErrorWithoutCode('cacheDB needed')
    }

    // gives the seed the first epoc found
    const findLastSeed = async (epoc: number): Promise<[Uint8Array, number]> => {
      if (epoc === 0) {
        return [new Uint8Array(32), 0]
      }

      const dbData = await this.cacheDB!.get(epoc, {
        keyEncoding: KeyEncoding.Number,
        valueEncoding: ValueEncoding.JSON,
      })
      if (dbData !== undefined) {
        const data = {
          cache: (dbData.cache as PrefixedHexString[]).map((el) => hexToBytes(el)),
          fullSize: dbData.fullSize,
          cacheSize: dbData.cacheSize,
          seed: hexToBytes(dbData.seed as PrefixedHexString),
        }
        return [data.seed, epoc]
      } else {
        return findLastSeed(epoc - 1)
      }
    }

    let data
    const dbData = await this.cacheDB!.get(epoc, {
      keyEncoding: KeyEncoding.Number,
      valueEncoding: ValueEncoding.JSON,
    })
    if (dbData !== undefined) {
      data = {
        cache: (dbData.cache as PrefixedHexString[]).map((el) => hexToBytes(el)),
        fullSize: dbData.fullSize,
        cacheSize: dbData.cacheSize,
        seed: hexToBytes(dbData.seed as PrefixedHexString),
      }
    }
    if (!data) {
      this.cacheSize = await getCacheSize(epoc)
      this.fullSize = await getFullSize(epoc)

      const [seed, foundEpoc] = await findLastSeed(epoc)
      this.seed = getSeed(seed, foundEpoc, epoc)
      const cache = this.mkcache(this.cacheSize!, this.seed!)
      // store the generated cache
      await this.cacheDB!.put(
        epoc,
        {
          cacheSize: this.cacheSize,
          fullSize: this.fullSize,
          seed: bytesToHex(this.seed),
          cache: cache.map((el) => bytesToHex(el)),
        },
        {
          keyEncoding: KeyEncoding.Number,
          valueEncoding: ValueEncoding.JSON,
        },
      )
    } else {
      this.cache = data.cache.map((a: Uint8Array) => {
        return Uint8Array.from(a)
      })
      this.cacheSize = data.cacheSize as number
      this.fullSize = data.fullSize as number
      this.seed = Uint8Array.from(data.seed)
    }
  }

  /**
   * Returns a `Miner` object
   * To mine a `BlockHeader` or `Block`, use the one-liner `await ethash.getMiner(block).mine(-1)`
   * @param mineObject - Object to mine on, either a `BlockHeader` or a `Block`
   * @returns - A miner object
   */
  getMiner(mineObject: BlockHeader | Block): Miner {
    return new Miner(mineObject, this)
  }

  async _verifyPOW(header: BlockHeader) {
    const headerHash = this.headerHash(header.raw())
    const { number, difficulty, mixHash, nonce } = header

    await this.loadEpoc(number)
    const a = this.run(headerHash, nonce)
    const result = bytesToBigInt(a.hash)
    return equalsBytes(a.mix, mixHash) && TWO_POW256 / difficulty > result
  }

  async verifyPOW(block: Block) {
    // don't validate genesis blocks
    if (block.header.isGenesis()) {
      return true
    }

    const valid = await this._verifyPOW(block.header)
    if (!valid) {
      return false
    }

    for (let index = 0; index < block.uncleHeaders.length; index++) {
      const valid = await this._verifyPOW(block.uncleHeaders[index])
      if (!valid) {
        return false
      }
    }

    return true
  }
}
