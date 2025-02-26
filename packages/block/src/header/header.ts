import { Common, ConsensusAlgorithm, ConsensusType, Hardfork, Mainnet } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  Address,
  BIGINT_0,
  BIGINT_1,
  BIGINT_2,
  BIGINT_7,
  EthereumJSErrorWithoutCode,
  KECCAK256_RLP,
  KECCAK256_RLP_ARRAY,
  SHA256_NULL,
  TypeOutput,
  bigIntToHex,
  bigIntToUnpaddedBytes,
  bytesToHex,
  bytesToUtf8,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
  toType,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

import {
  CLIQUE_EXTRA_SEAL,
  CLIQUE_EXTRA_VANITY,
  cliqueIsEpochTransition,
} from '../consensus/clique.js'
import { computeBlobGasPrice } from '../helpers.js'
import { paramsBlock } from '../params.js'

import type { BlockHeaderBytes, BlockOptions, HeaderData, JSONHeader } from '../types.js'

interface HeaderCache {
  hash: Uint8Array | undefined
}

const DEFAULT_GAS_LIMIT = BigInt('0xffffffffffffff')

/**
 * An object that represents the block header.
 */
export class BlockHeader {
  public readonly parentHash: Uint8Array
  public readonly uncleHash: Uint8Array
  public readonly coinbase: Address
  public readonly stateRoot: Uint8Array
  public readonly transactionsTrie: Uint8Array
  public readonly receiptTrie: Uint8Array
  public readonly logsBloom: Uint8Array
  public readonly difficulty: bigint
  public readonly number: bigint
  public readonly gasLimit: bigint
  public readonly gasUsed: bigint
  public readonly timestamp: bigint
  public readonly extraData: Uint8Array
  public readonly mixHash: Uint8Array
  public readonly nonce: Uint8Array
  public readonly baseFeePerGas?: bigint
  public readonly withdrawalsRoot?: Uint8Array
  public readonly blobGasUsed?: bigint
  public readonly excessBlobGas?: bigint
  public readonly parentBeaconBlockRoot?: Uint8Array
  public readonly requestsHash?: Uint8Array

  public readonly common: Common

  protected keccakFunction: (msg: Uint8Array) => Uint8Array

  protected cache: HeaderCache = {
    hash: undefined,
  }

  /**
   * EIP-4399: After merge to PoS, `mixHash` supplanted as `prevRandao`
   */
  get prevRandao() {
    if (!this.common.isActivatedEIP(4399)) {
      const msg = this._errorMsg(
        'The prevRandao parameter can only be accessed when EIP-4399 is activated',
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
    return this.mixHash
  }

  /**
   * This constructor takes the values, validates them, assigns them and freezes the object.
   *
   * @deprecated Use the public static factory methods to assist in creating a Header object from
   * varying data types. For a default empty header, use {@link createBlockHeader}.
   *
   */
  constructor(headerData: HeaderData, opts: BlockOptions = {}) {
    if (opts.common) {
      this.common = opts.common.copy()
    } else {
      this.common = new Common({
        chain: Mainnet, // default
      })
    }
    this.common.updateParams(opts.params ?? paramsBlock)

    this.keccakFunction = this.common.customCrypto.keccak256 ?? keccak256

    const skipValidateConsensusFormat = opts.skipConsensusFormatValidation ?? false

    const defaults = {
      parentHash: new Uint8Array(32),
      uncleHash: KECCAK256_RLP_ARRAY,
      coinbase: createZeroAddress(),
      stateRoot: new Uint8Array(32),
      transactionsTrie: KECCAK256_RLP,
      receiptTrie: KECCAK256_RLP,
      logsBloom: new Uint8Array(256),
      difficulty: BIGINT_0,
      number: BIGINT_0,
      gasLimit: DEFAULT_GAS_LIMIT,
      gasUsed: BIGINT_0,
      timestamp: BIGINT_0,
      extraData: new Uint8Array(0),
      mixHash: new Uint8Array(32),
      nonce: new Uint8Array(8),
    }

    const parentHash = toType(headerData.parentHash, TypeOutput.Uint8Array) ?? defaults.parentHash
    const uncleHash = toType(headerData.uncleHash, TypeOutput.Uint8Array) ?? defaults.uncleHash
    const coinbase = new Address(
      toType(headerData.coinbase ?? defaults.coinbase, TypeOutput.Uint8Array),
    )
    const stateRoot = toType(headerData.stateRoot, TypeOutput.Uint8Array) ?? defaults.stateRoot
    const transactionsTrie =
      toType(headerData.transactionsTrie, TypeOutput.Uint8Array) ?? defaults.transactionsTrie
    const receiptTrie =
      toType(headerData.receiptTrie, TypeOutput.Uint8Array) ?? defaults.receiptTrie
    const logsBloom = toType(headerData.logsBloom, TypeOutput.Uint8Array) ?? defaults.logsBloom
    const difficulty = toType(headerData.difficulty, TypeOutput.BigInt) ?? defaults.difficulty
    const number = toType(headerData.number, TypeOutput.BigInt) ?? defaults.number
    const gasLimit = toType(headerData.gasLimit, TypeOutput.BigInt) ?? defaults.gasLimit
    const gasUsed = toType(headerData.gasUsed, TypeOutput.BigInt) ?? defaults.gasUsed
    const timestamp = toType(headerData.timestamp, TypeOutput.BigInt) ?? defaults.timestamp
    const extraData = toType(headerData.extraData, TypeOutput.Uint8Array) ?? defaults.extraData
    const mixHash = toType(headerData.mixHash, TypeOutput.Uint8Array) ?? defaults.mixHash
    const nonce = toType(headerData.nonce, TypeOutput.Uint8Array) ?? defaults.nonce

    const setHardfork = opts.setHardfork ?? false
    if (setHardfork === true) {
      this.common.setHardforkBy({
        blockNumber: number,
        timestamp,
      })
    }

    // Hardfork defaults which couldn't be paired with earlier defaults
    const hardforkDefaults = {
      baseFeePerGas: this.common.isActivatedEIP(1559)
        ? number === this.common.hardforkBlock(Hardfork.London)
          ? this.common.param('initialBaseFee')
          : BIGINT_7
        : undefined,
      withdrawalsRoot: this.common.isActivatedEIP(4895) ? KECCAK256_RLP : undefined,
      blobGasUsed: this.common.isActivatedEIP(4844) ? BIGINT_0 : undefined,
      excessBlobGas: this.common.isActivatedEIP(4844) ? BIGINT_0 : undefined,
      parentBeaconBlockRoot: this.common.isActivatedEIP(4788) ? new Uint8Array(32) : undefined,
      // Note: as of devnet-4 we stub the null SHA256 hash, but for devnet5 this will actually
      // be the correct hash for empty requests.
      requestsHash: this.common.isActivatedEIP(7685) ? SHA256_NULL : undefined,
    }

    const baseFeePerGas =
      toType(headerData.baseFeePerGas, TypeOutput.BigInt) ?? hardforkDefaults.baseFeePerGas
    const withdrawalsRoot =
      toType(headerData.withdrawalsRoot, TypeOutput.Uint8Array) ?? hardforkDefaults.withdrawalsRoot
    const blobGasUsed =
      toType(headerData.blobGasUsed, TypeOutput.BigInt) ?? hardforkDefaults.blobGasUsed
    const excessBlobGas =
      toType(headerData.excessBlobGas, TypeOutput.BigInt) ?? hardforkDefaults.excessBlobGas
    const parentBeaconBlockRoot =
      toType(headerData.parentBeaconBlockRoot, TypeOutput.Uint8Array) ??
      hardforkDefaults.parentBeaconBlockRoot
    const requestsHash =
      toType(headerData.requestsHash, TypeOutput.Uint8Array) ?? hardforkDefaults.requestsHash

    if (!this.common.isActivatedEIP(1559) && baseFeePerGas !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'A base fee for a block can only be set with EIP1559 being activated',
      )
    }

    if (!this.common.isActivatedEIP(4895) && withdrawalsRoot !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'A withdrawalsRoot for a header can only be provided with EIP4895 being activated',
      )
    }

    if (!this.common.isActivatedEIP(4844)) {
      if (blobGasUsed !== undefined) {
        throw EthereumJSErrorWithoutCode(
          'blob gas used can only be provided with EIP4844 activated',
        )
      }

      if (excessBlobGas !== undefined) {
        throw EthereumJSErrorWithoutCode(
          'excess blob gas can only be provided with EIP4844 activated',
        )
      }
    }

    if (!this.common.isActivatedEIP(4788) && parentBeaconBlockRoot !== undefined) {
      throw EthereumJSErrorWithoutCode(
        'A parentBeaconBlockRoot for a header can only be provided with EIP4788 being activated',
      )
    }

    if (!this.common.isActivatedEIP(7685) && requestsHash !== undefined) {
      throw EthereumJSErrorWithoutCode('requestsHash can only be provided with EIP 7685 activated')
    }

    this.parentHash = parentHash
    this.uncleHash = uncleHash
    this.coinbase = coinbase
    this.stateRoot = stateRoot
    this.transactionsTrie = transactionsTrie
    this.receiptTrie = receiptTrie
    this.logsBloom = logsBloom
    this.difficulty = difficulty
    this.number = number
    this.gasLimit = gasLimit
    this.gasUsed = gasUsed
    this.timestamp = timestamp
    this.extraData = extraData
    this.mixHash = mixHash
    this.nonce = nonce
    this.baseFeePerGas = baseFeePerGas
    this.withdrawalsRoot = withdrawalsRoot
    this.blobGasUsed = blobGasUsed
    this.excessBlobGas = excessBlobGas
    this.parentBeaconBlockRoot = parentBeaconBlockRoot
    this.requestsHash = requestsHash
    this._genericFormatValidation()
    this._validateDAOExtraData()

    // Now we have set all the values of this Header, we possibly have set a dummy
    // `difficulty` value (defaults to 0). If we have a `calcDifficultyFromHeader`
    // block option parameter, we instead set difficulty to this value.
    if (
      opts.calcDifficultyFromHeader &&
      this.common.consensusAlgorithm() === ConsensusAlgorithm.Ethash
    ) {
      this.difficulty = this.ethashCanonicalDifficulty(opts.calcDifficultyFromHeader)
    }

    // Validate consensus format after block is sealed (if applicable) so extraData checks will pass
    if (skipValidateConsensusFormat === false) this._consensusFormatValidation()

    const freeze = opts?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
  }

  /**
   * Validates correct buffer lengths, throws if invalid.
   */
  protected _genericFormatValidation() {
    const { parentHash, stateRoot, transactionsTrie, receiptTrie, mixHash, nonce } = this

    if (parentHash.length !== 32) {
      const msg = this._errorMsg(`parentHash must be 32 bytes, received ${parentHash.length} bytes`)
      throw EthereumJSErrorWithoutCode(msg)
    }
    if (stateRoot.length !== 32) {
      const msg = this._errorMsg(`stateRoot must be 32 bytes, received ${stateRoot.length} bytes`)
      throw EthereumJSErrorWithoutCode(msg)
    }
    if (transactionsTrie.length !== 32) {
      const msg = this._errorMsg(
        `transactionsTrie must be 32 bytes, received ${transactionsTrie.length} bytes`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
    if (receiptTrie.length !== 32) {
      const msg = this._errorMsg(
        `receiptTrie must be 32 bytes, received ${receiptTrie.length} bytes`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
    if (mixHash.length !== 32) {
      const msg = this._errorMsg(`mixHash must be 32 bytes, received ${mixHash.length} bytes`)
      throw EthereumJSErrorWithoutCode(msg)
    }

    if (nonce.length !== 8) {
      const msg = this._errorMsg(`nonce must be 8 bytes, received ${nonce.length} bytes`)
      throw EthereumJSErrorWithoutCode(msg)
    }

    // check if the block used too much gas
    if (this.gasUsed > this.gasLimit) {
      const msg = this._errorMsg(
        `Invalid block: too much gas used. Used: ${this.gasUsed}, gas limit: ${this.gasLimit}`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }

    // Validation for EIP-1559 blocks
    if (this.common.isActivatedEIP(1559)) {
      if (typeof this.baseFeePerGas !== 'bigint') {
        const msg = this._errorMsg('EIP1559 block has no base fee field')
        throw EthereumJSErrorWithoutCode(msg)
      }
      const londonHfBlock = this.common.hardforkBlock(Hardfork.London)
      if (
        typeof londonHfBlock === 'bigint' &&
        londonHfBlock !== BIGINT_0 &&
        this.number === londonHfBlock
      ) {
        const initialBaseFee = this.common.param('initialBaseFee')
        if (this.baseFeePerGas !== initialBaseFee) {
          const msg = this._errorMsg('Initial EIP1559 block does not have initial base fee')
          throw EthereumJSErrorWithoutCode(msg)
        }
      }
    }

    if (this.common.isActivatedEIP(4895)) {
      if (this.withdrawalsRoot === undefined) {
        const msg = this._errorMsg('EIP4895 block has no withdrawalsRoot field')
        throw EthereumJSErrorWithoutCode(msg)
      }
      if (this.withdrawalsRoot?.length !== 32) {
        const msg = this._errorMsg(
          `withdrawalsRoot must be 32 bytes, received ${this.withdrawalsRoot!.length} bytes`,
        )
        throw EthereumJSErrorWithoutCode(msg)
      }
    }

    if (this.common.isActivatedEIP(4788)) {
      if (this.parentBeaconBlockRoot === undefined) {
        const msg = this._errorMsg('EIP4788 block has no parentBeaconBlockRoot field')
        throw EthereumJSErrorWithoutCode(msg)
      }
      if (this.parentBeaconBlockRoot?.length !== 32) {
        const msg = this._errorMsg(
          `parentBeaconBlockRoot must be 32 bytes, received ${
            this.parentBeaconBlockRoot!.length
          } bytes`,
        )
        throw EthereumJSErrorWithoutCode(msg)
      }
    }

    if (this.common.isActivatedEIP(7685)) {
      if (this.requestsHash === undefined) {
        const msg = this._errorMsg('EIP7685 block has no requestsHash field')
        throw EthereumJSErrorWithoutCode(msg)
      }
    }
  }

  /**
   * Checks static parameters related to consensus algorithm
   * @throws if any check fails
   */
  protected _consensusFormatValidation() {
    const { nonce, uncleHash, difficulty, extraData, number } = this

    // Consensus type dependent checks
    if (this.common.consensusAlgorithm() === ConsensusAlgorithm.Ethash) {
      // PoW/Ethash
      if (number > BIGINT_0 && this.extraData.length > this.common.param('maxExtraDataSize')) {
        // Check length of data on all post-genesis blocks
        const msg = this._errorMsg('invalid amount of extra data')
        throw EthereumJSErrorWithoutCode(msg)
      }
    }
    if (this.common.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      // PoA/Clique
      const minLength = CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL
      if (!cliqueIsEpochTransition(this)) {
        // ExtraData length on epoch transition
        if (this.extraData.length !== minLength) {
          const msg = this._errorMsg(
            `extraData must be ${minLength} bytes on non-epoch transition blocks, received ${this.extraData.length} bytes`,
          )
          throw EthereumJSErrorWithoutCode(msg)
        }
      } else {
        const signerLength = this.extraData.length - minLength
        if (signerLength % 20 !== 0) {
          const msg = this._errorMsg(
            `invalid signer list length in extraData, received signer length of ${signerLength} (not divisible by 20)`,
          )
          throw EthereumJSErrorWithoutCode(msg)
        }
        // coinbase (beneficiary) on epoch transition
        if (!this.coinbase.isZero()) {
          const msg = this._errorMsg(
            `coinbase must be filled with zeros on epoch transition blocks, received ${this.coinbase}`,
          )
          throw EthereumJSErrorWithoutCode(msg)
        }
      }
      // MixHash format
      if (!equalsBytes(this.mixHash, new Uint8Array(32))) {
        const msg = this._errorMsg(`mixHash must be filled with zeros, received ${this.mixHash}`)
        throw EthereumJSErrorWithoutCode(msg)
      }
    }
    // Validation for PoS blocks (EIP-3675)
    if (this.common.consensusType() === ConsensusType.ProofOfStake) {
      let error = false
      let errorMsg = ''

      if (!equalsBytes(uncleHash, KECCAK256_RLP_ARRAY)) {
        errorMsg += `, uncleHash: ${bytesToHex(uncleHash)} (expected: ${bytesToHex(
          KECCAK256_RLP_ARRAY,
        )})`
        error = true
      }
      if (number !== BIGINT_0) {
        // Skip difficulty, nonce, and extraData check for PoS genesis block as genesis block may have non-zero difficulty (if TD is > 0)
        if (difficulty !== BIGINT_0) {
          errorMsg += `, difficulty: ${difficulty} (expected: 0)`
          error = true
        }
        if (extraData.length > 32) {
          errorMsg += `, extraData: ${bytesToHex(
            extraData,
          )} (cannot exceed 32 bytes length, received ${extraData.length} bytes)`
          error = true
        }
        if (!equalsBytes(nonce, new Uint8Array(8))) {
          errorMsg += `, nonce: ${bytesToHex(nonce)} (expected: ${bytesToHex(new Uint8Array(8))})`
          error = true
        }
      }
      if (error) {
        const msg = this._errorMsg(`Invalid PoS block: ${errorMsg}`)
        throw EthereumJSErrorWithoutCode(msg)
      }
    }
  }

  /**
   * Validates if the block gasLimit remains in the boundaries set by the protocol.
   * Throws if out of bounds.
   *
   * @param parentBlockHeader - the header from the parent `Block` of this header
   */
  validateGasLimit(parentBlockHeader: BlockHeader) {
    let parentGasLimit = parentBlockHeader.gasLimit
    // EIP-1559: assume double the parent gas limit on fork block
    // to adopt to the new gas target centered logic
    const londonHardforkBlock = this.common.hardforkBlock(Hardfork.London)
    if (
      typeof londonHardforkBlock === 'bigint' &&
      londonHardforkBlock !== BIGINT_0 &&
      this.number === londonHardforkBlock
    ) {
      const elasticity = this.common.param('elasticityMultiplier')
      parentGasLimit = parentGasLimit * elasticity
    }
    const gasLimit = this.gasLimit

    const a = parentGasLimit / this.common.param('gasLimitBoundDivisor')
    const maxGasLimit = parentGasLimit + a
    const minGasLimit = parentGasLimit - a

    if (gasLimit >= maxGasLimit) {
      const msg = this._errorMsg(
        `gas limit increased too much. Gas limit: ${gasLimit}, max gas limit: ${maxGasLimit}`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }

    if (gasLimit <= minGasLimit) {
      const msg = this._errorMsg(
        `gas limit decreased too much. Gas limit: ${gasLimit}, min gas limit: ${minGasLimit}`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }

    if (gasLimit < this.common.param('minGasLimit')) {
      const msg = this._errorMsg(
        `gas limit decreased below minimum gas limit. Gas limit: ${gasLimit}, minimum gas limit: ${this.common.param(
          'minGasLimit',
        )}`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
  }

  /**
   * Calculates the base fee for a potential next block
   */
  public calcNextBaseFee(): bigint {
    if (!this.common.isActivatedEIP(1559)) {
      const msg = this._errorMsg(
        'calcNextBaseFee() can only be called with EIP1559 being activated',
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
    let nextBaseFee: bigint
    const elasticity = this.common.param('elasticityMultiplier')
    const parentGasTarget = this.gasLimit / elasticity

    if (parentGasTarget === this.gasUsed) {
      nextBaseFee = this.baseFeePerGas!
    } else if (this.gasUsed > parentGasTarget) {
      const gasUsedDelta = this.gasUsed - parentGasTarget
      const baseFeeMaxChangeDenominator = this.common.param('baseFeeMaxChangeDenominator')

      const calculatedDelta =
        (this.baseFeePerGas! * gasUsedDelta) / parentGasTarget / baseFeeMaxChangeDenominator
      nextBaseFee = (calculatedDelta > BIGINT_1 ? calculatedDelta : BIGINT_1) + this.baseFeePerGas!
    } else {
      const gasUsedDelta = parentGasTarget - this.gasUsed
      const baseFeeMaxChangeDenominator = this.common.param('baseFeeMaxChangeDenominator')

      const calculatedDelta =
        (this.baseFeePerGas! * gasUsedDelta) / parentGasTarget / baseFeeMaxChangeDenominator
      nextBaseFee =
        this.baseFeePerGas! - calculatedDelta > BIGINT_0
          ? this.baseFeePerGas! - calculatedDelta
          : BIGINT_0
    }
    return nextBaseFee
  }

  /**
   * Returns the price per unit of blob gas for a blob transaction in the current/pending block
   * @returns the price in gwei per unit of blob gas spent
   */
  getBlobGasPrice(): bigint {
    if (this.excessBlobGas === undefined) {
      throw EthereumJSErrorWithoutCode('header must have excessBlobGas field populated')
    }
    return computeBlobGasPrice(this.excessBlobGas, this.common)
  }

  /**
   * Returns the total fee for blob gas spent for including blobs in block.
   *
   * @param numBlobs number of blobs in the transaction/block
   * @returns the total blob gas fee for numBlobs blobs
   */
  calcDataFee(numBlobs: number): bigint {
    const blobGasPerBlob = this.common.param('blobGasPerBlob')
    const blobGasUsed = blobGasPerBlob * BigInt(numBlobs)

    const blobGasPrice = this.getBlobGasPrice()
    return blobGasUsed * blobGasPrice
  }

  /**
   * Calculates the excess blob gas for next (hopefully) post EIP 4844 block.
   */
  public calcNextExcessBlobGas(childCommon: Common): bigint {
    // The validation of the fields and 4844 activation is already taken care in BlockHeader constructor
    const targetGasConsumed = (this.excessBlobGas ?? BIGINT_0) + (this.blobGasUsed ?? BIGINT_0)
    const targetBlobGasPerBlock = childCommon.param('targetBlobGasPerBlock')

    if (targetGasConsumed <= targetBlobGasPerBlock) {
      return BIGINT_0
    } else {
      return targetGasConsumed - targetBlobGasPerBlock
    }
  }

  /**
   * Calculate the blob gas price of the block built on top of this one
   * @returns The blob gas price
   */
  public calcNextBlobGasPrice(childCommon: Common): bigint {
    return computeBlobGasPrice(this.calcNextExcessBlobGas(childCommon), childCommon)
  }

  /**
   * Returns a Uint8Array Array of the raw Bytes in this header, in order.
   */
  raw(): BlockHeaderBytes {
    const rawItems = [
      this.parentHash,
      this.uncleHash,
      this.coinbase.bytes,
      this.stateRoot,
      this.transactionsTrie,
      this.receiptTrie,
      this.logsBloom,
      bigIntToUnpaddedBytes(this.difficulty),
      bigIntToUnpaddedBytes(this.number),
      bigIntToUnpaddedBytes(this.gasLimit),
      bigIntToUnpaddedBytes(this.gasUsed),
      bigIntToUnpaddedBytes(this.timestamp ?? BIGINT_0),
      this.extraData,
      this.mixHash,
      this.nonce,
    ]

    if (this.common.isActivatedEIP(1559)) {
      rawItems.push(bigIntToUnpaddedBytes(this.baseFeePerGas!))
    }

    if (this.common.isActivatedEIP(4895)) {
      rawItems.push(this.withdrawalsRoot!)
    }

    // in kaustinen 2 verkle is scheduled after withdrawals, will eventually be post deneb hopefully
    if (this.common.isActivatedEIP(6800)) {
      // execution witness is not mandatory part of the the block so nothing to push here
      // but keep this comment segment for clarity regarding the same and move it according as per the
      // HF sequence eventually planned
    }

    if (this.common.isActivatedEIP(4844)) {
      rawItems.push(bigIntToUnpaddedBytes(this.blobGasUsed!))
      rawItems.push(bigIntToUnpaddedBytes(this.excessBlobGas!))
    }
    if (this.common.isActivatedEIP(4788)) {
      rawItems.push(this.parentBeaconBlockRoot!)
    }
    if (this.common.isActivatedEIP(7685)) {
      rawItems.push(this.requestsHash!)
    }

    return rawItems
  }

  /**
   * Returns the hash of the block header.
   */
  hash(): Uint8Array {
    if (Object.isFrozen(this)) {
      if (!this.cache.hash) {
        this.cache.hash = this.keccakFunction(RLP.encode(this.raw())) as Uint8Array
      }
      return this.cache.hash
    }
    return this.keccakFunction(RLP.encode(this.raw()))
  }

  /**
   * Checks if the block header is a genesis header.
   */
  isGenesis(): boolean {
    return this.number === BIGINT_0
  }

  /**
   * Returns the canonical difficulty for this block.
   *
   * @param parentBlockHeader - the header from the parent `Block` of this header
   */
  ethashCanonicalDifficulty(parentBlockHeader: BlockHeader): bigint {
    if (this.common.consensusType() !== ConsensusType.ProofOfWork) {
      const msg = this._errorMsg('difficulty calculation is only supported on PoW chains')
      throw EthereumJSErrorWithoutCode(msg)
    }
    if (this.common.consensusAlgorithm() !== ConsensusAlgorithm.Ethash) {
      const msg = this._errorMsg(
        'difficulty calculation currently only supports the ethash algorithm',
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
    const blockTs = this.timestamp
    const { timestamp: parentTs, difficulty: parentDif } = parentBlockHeader
    const minimumDifficulty = this.common.param('minimumDifficulty')
    const offset = parentDif / this.common.param('difficultyBoundDivisor')
    let num = this.number

    // We use a ! here as TS cannot follow this hardfork-dependent logic, but it always gets assigned
    let dif!: bigint

    if (this.common.gteHardfork(Hardfork.Byzantium)) {
      // max((2 if len(parent.uncles) else 1) - ((timestamp - parent.timestamp) // 9), -99) (EIP100)
      const uncleAddend = equalsBytes(parentBlockHeader.uncleHash, KECCAK256_RLP_ARRAY) ? 1 : 2
      let a = BigInt(uncleAddend) - (blockTs - parentTs) / BigInt(9)
      const cutoff = BigInt(-99)
      // MAX(cutoff, a)
      if (cutoff > a) {
        a = cutoff
      }
      dif = parentDif + offset * a
    }

    if (this.common.gteHardfork(Hardfork.Byzantium)) {
      // Get delay as parameter from common
      num = num - this.common.param('difficultyBombDelay')
      if (num < BIGINT_0) {
        num = BIGINT_0
      }
    } else if (this.common.gteHardfork(Hardfork.Homestead)) {
      // 1 - (block_timestamp - parent_timestamp) // 10
      let a = BIGINT_1 - (blockTs - parentTs) / BigInt(10)
      const cutoff = BigInt(-99)
      // MAX(cutoff, a)
      if (cutoff > a) {
        a = cutoff
      }
      dif = parentDif + offset * a
    } else {
      // pre-homestead
      if (parentTs + this.common.param('durationLimit') > blockTs) {
        dif = offset + parentDif
      } else {
        dif = parentDif - offset
      }
    }

    const exp = num / BigInt(100000) - BIGINT_2
    if (exp >= 0) {
      dif = dif + BIGINT_2 ** exp
    }

    if (dif < minimumDifficulty) {
      dif = minimumDifficulty
    }

    return dif
  }

  /**
   * Returns the rlp encoding of the block header.
   */
  serialize(): Uint8Array {
    return RLP.encode(this.raw())
  }

  /**
   * Returns the block header in JSON format.
   */
  toJSON(): JSONHeader {
    const withdrawalAttr = this.withdrawalsRoot
      ? { withdrawalsRoot: bytesToHex(this.withdrawalsRoot) }
      : {}
    const JSONDict: JSONHeader = {
      parentHash: bytesToHex(this.parentHash),
      uncleHash: bytesToHex(this.uncleHash),
      coinbase: this.coinbase.toString(),
      stateRoot: bytesToHex(this.stateRoot),
      transactionsTrie: bytesToHex(this.transactionsTrie),
      ...withdrawalAttr,
      receiptTrie: bytesToHex(this.receiptTrie),
      logsBloom: bytesToHex(this.logsBloom),
      difficulty: bigIntToHex(this.difficulty),
      number: bigIntToHex(this.number),
      gasLimit: bigIntToHex(this.gasLimit),
      gasUsed: bigIntToHex(this.gasUsed),
      timestamp: bigIntToHex(this.timestamp),
      extraData: bytesToHex(this.extraData),
      mixHash: bytesToHex(this.mixHash),
      nonce: bytesToHex(this.nonce),
    }
    if (this.common.isActivatedEIP(1559)) {
      JSONDict.baseFeePerGas = bigIntToHex(this.baseFeePerGas!)
    }
    if (this.common.isActivatedEIP(4844)) {
      JSONDict.blobGasUsed = bigIntToHex(this.blobGasUsed!)
      JSONDict.excessBlobGas = bigIntToHex(this.excessBlobGas!)
    }
    if (this.common.isActivatedEIP(4788)) {
      JSONDict.parentBeaconBlockRoot = bytesToHex(this.parentBeaconBlockRoot!)
    }
    if (this.common.isActivatedEIP(7685)) {
      JSONDict.requestsHash = bytesToHex(this.requestsHash!)
    }
    return JSONDict
  }

  /**
   * Validates extra data is DAO_ExtraData for DAO_ForceExtraDataRange blocks after DAO
   * activation block (see: https://blog.slock.it/hard-fork-specification-24b889e70703)
   */
  protected _validateDAOExtraData() {
    if (!this.common.hardforkIsActiveOnBlock(Hardfork.Dao, this.number)) {
      return
    }
    const DAOActivationBlock = this.common.hardforkBlock(Hardfork.Dao)
    if (DAOActivationBlock === null || this.number < DAOActivationBlock) {
      return
    }
    const DAO_ExtraData = hexToBytes('0x64616f2d686172642d666f726b')
    const DAO_ForceExtraDataRange = BigInt(9)
    const drift = this.number - DAOActivationBlock
    if (drift <= DAO_ForceExtraDataRange && !equalsBytes(this.extraData, DAO_ExtraData)) {
      const msg = this._errorMsg(
        `extraData should be 'dao-hard-fork', got ${bytesToUtf8(this.extraData)} (hex: ${bytesToHex(
          this.extraData,
        )})`,
      )
      throw EthereumJSErrorWithoutCode(msg)
    }
  }

  /**
   * Return a compact error string representation of the object
   */
  public errorStr() {
    let hash = ''
    try {
      hash = bytesToHex(this.hash())
    } catch (e: any) {
      hash = 'error'
    }
    let hf = ''
    try {
      hf = this.common.hardfork()
    } catch (e: any) {
      hf = 'error'
    }
    let errorStr = `block header number=${this.number} hash=${hash} `
    errorStr += `hf=${hf} baseFeePerGas=${this.baseFeePerGas ?? 'none'}`
    return errorStr
  }

  /**
   * Helper function to create an annotated error message
   *
   * @param msg Base error message
   * @hidden
   */
  protected _errorMsg(msg: string) {
    return `${msg} (${this.errorStr()})`
  }
}
