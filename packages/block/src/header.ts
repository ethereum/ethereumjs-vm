import Common, {
  Chain,
  ConsensusAlgorithm,
  ConsensusType,
  Hardfork,
  CliqueConfig,
} from '@ethereumjs/common'
import { keccak256 } from 'ethereum-cryptography/keccak'
import {
  Address,
  arrToBufArr,
  bigIntToHex,
  bigIntToUnpaddedBuffer,
  bufArrToArr,
  bufferToBigInt,
  bufferToHex,
  ecrecover,
  ecsign,
  intToBuffer,
  KECCAK256_RLP_ARRAY,
  KECCAK256_RLP,
  toType,
  TypeOutput,
  zeros,
  ValueError,
  UsageError,
  ErrorCode,
} from 'ethereumjs-util'
import RLP from 'rlp'
import { Blockchain, BlockHeaderBuffer, BlockOptions, HeaderData, JsonHeader } from './types'
import {
  CLIQUE_EXTRA_VANITY,
  CLIQUE_EXTRA_SEAL,
  CLIQUE_DIFF_INTURN,
  CLIQUE_DIFF_NOTURN,
} from './clique'

interface HeaderCache {
  hash: Buffer | undefined
}

const DEFAULT_GAS_LIMIT = BigInt('0xffffffffffffff')

/**
 * An object that represents the block header.
 */
export class BlockHeader {
  public readonly parentHash: Buffer
  public readonly uncleHash: Buffer
  public readonly coinbase: Address
  public readonly stateRoot: Buffer
  public readonly transactionsTrie: Buffer
  public readonly receiptTrie: Buffer
  public readonly logsBloom: Buffer
  public readonly difficulty: bigint
  public readonly number: bigint
  public readonly gasLimit: bigint
  public readonly gasUsed: bigint
  public readonly timestamp: bigint
  public readonly extraData: Buffer
  public readonly mixHash: Buffer
  public readonly nonce: Buffer
  public readonly baseFeePerGas?: bigint

  public readonly _common: Common

  private cache: HeaderCache = {
    hash: undefined,
  }

  /**
   * EIP-4399: After merge to PoS, `mixHash` supplanted as `prevRandao`
   *
   * Note: this is Merge-related functionality and considered `experimental`,
   * use with care.
   */
  get prevRandao() {
    if (!this._common.isActivatedEIP(4399)) {
      throw new UsageError(
        'The prevRandao parameter can only be accessed when EIP-4399 is activated',
        ErrorCode.EIP_NOT_ACTIVATED,
        {
          objectContext: this.errorStr(),
        }
      )
    }
    return this.mixHash
  }

  /**
   * Static constructor to create a block header from a header data dictionary
   *
   * @param headerData
   * @param opts
   */
  public static fromHeaderData(headerData: HeaderData = {}, opts: BlockOptions = {}) {
    return new BlockHeader(headerData, opts)
  }

  /**
   * Static constructor to create a block header from a RLP-serialized header
   *
   * @param headerData
   * @param opts
   */
  public static fromRLPSerializedHeader(serialized: Buffer, opts: BlockOptions = {}) {
    const values = arrToBufArr(RLP.decode(Uint8Array.from(serialized))) as Buffer[]

    if (!Array.isArray(values)) {
      throw new ValueError(
        'Invalid serialized header input. Must be array',
        ErrorCode.INVALID_VALUE
      )
    }

    return BlockHeader.fromValuesArray(values, opts)
  }

  /**
   * Static constructor to create a block header from an array of Buffer values
   *
   * @param values
   * @param opts
   */
  public static fromValuesArray(values: BlockHeaderBuffer, opts: BlockOptions = {}) {
    const [
      parentHash,
      uncleHash,
      coinbase,
      stateRoot,
      transactionsTrie,
      receiptTrie,
      logsBloom,
      difficulty,
      number,
      gasLimit,
      gasUsed,
      timestamp,
      extraData,
      mixHash,
      nonce,
      baseFeePerGas,
    ] = values

    if (values.length > 16) {
      throw new ValueError(
        'invalid header. More values than expected were received',
        ErrorCode.TOO_MANY_VALUES
      )
    }
    if (values.length < 15) {
      throw new ValueError(
        'invalid header. Less values than expected were received',
        ErrorCode.TOO_FEW_VALUES
      )
    }

    return new BlockHeader(
      {
        parentHash,
        uncleHash,
        coinbase,
        stateRoot,
        transactionsTrie,
        receiptTrie,
        logsBloom,
        difficulty,
        number,
        gasLimit,
        gasUsed,
        timestamp,
        extraData,
        mixHash,
        nonce,
        baseFeePerGas,
      },
      opts
    )
  }
  /**
   * This constructor takes the values, validates them, assigns them and freezes the object.
   *
   * @deprecated Use the public static factory methods to assist in creating a Header object from
   * varying data types. For a default empty header, use {@link BlockHeader.fromHeaderData}.
   *
   */
  constructor(headerData: HeaderData, options: BlockOptions = {}) {
    if (options.common) {
      this._common = options.common.copy()
    } else {
      this._common = new Common({
        chain: Chain.Mainnet, // default
      })
    }

    if (options.hardforkByBlockNumber !== undefined && options.hardforkByTD !== undefined) {
      throw new UsageError(
        `The hardforkByBlockNumber and hardforkByTD options can't be used in conjunction`,
        ErrorCode.INVALID_OPTION_USAGE
      )
    }

    const defaults = {
      parentHash: zeros(32),
      uncleHash: KECCAK256_RLP_ARRAY,
      coinbase: Address.zero(),
      stateRoot: zeros(32),
      transactionsTrie: KECCAK256_RLP,
      receiptTrie: KECCAK256_RLP,
      logsBloom: zeros(256),
      difficulty: BigInt(0),
      number: BigInt(0),
      gasLimit: DEFAULT_GAS_LIMIT,
      gasUsed: BigInt(0),
      timestamp: BigInt(0),
      extraData: Buffer.from([]),
      mixHash: zeros(32),
      nonce: zeros(8),
      baseFeePerGas: undefined,
    }

    const parentHash = toType(headerData.parentHash, TypeOutput.Buffer) ?? defaults.parentHash
    const uncleHash = toType(headerData.uncleHash, TypeOutput.Buffer) ?? defaults.uncleHash
    const coinbase = headerData.coinbase
      ? new Address(toType(headerData.coinbase, TypeOutput.Buffer))
      : defaults.coinbase
    const stateRoot = toType(headerData.stateRoot, TypeOutput.Buffer) ?? defaults.stateRoot
    const transactionsTrie =
      toType(headerData.transactionsTrie, TypeOutput.Buffer) ?? defaults.transactionsTrie
    const receiptTrie = toType(headerData.receiptTrie, TypeOutput.Buffer) ?? defaults.receiptTrie
    const logsBloom = toType(headerData.logsBloom, TypeOutput.Buffer) ?? defaults.logsBloom
    const difficulty = toType(headerData.difficulty, TypeOutput.BigInt) ?? defaults.difficulty
    const number = toType(headerData.number, TypeOutput.BigInt) ?? defaults.number
    const gasLimit = toType(headerData.gasLimit, TypeOutput.BigInt) ?? defaults.gasLimit
    const gasUsed = toType(headerData.gasUsed, TypeOutput.BigInt) ?? defaults.gasUsed
    const timestamp = toType(headerData.timestamp, TypeOutput.BigInt) ?? defaults.timestamp
    const extraData = toType(headerData.extraData, TypeOutput.Buffer) ?? defaults.extraData
    const mixHash = toType(headerData.mixHash, TypeOutput.Buffer) ?? defaults.mixHash
    const nonce = toType(headerData.nonce, TypeOutput.Buffer) ?? defaults.nonce
    let baseFeePerGas =
      toType(headerData.baseFeePerGas, TypeOutput.BigInt) ?? defaults.baseFeePerGas

    const hardforkByBlockNumber = options.hardforkByBlockNumber ?? false
    if (hardforkByBlockNumber || options.hardforkByTD !== undefined) {
      this._common.setHardforkByBlockNumber(number, options.hardforkByTD)
    }

    if (this._common.isActivatedEIP(1559)) {
      if (baseFeePerGas === undefined) {
        const londonHfBlock = this._common.hardforkBlock(Hardfork.London)
        const isInitialEIP1559Block = number === londonHfBlock
        if (isInitialEIP1559Block) {
          baseFeePerGas = this._common.param('gasConfig', 'initialBaseFee')
        } else {
          // Minimum possible value for baseFeePerGas is 7,
          // so we use it as the default if the field is missing.
          baseFeePerGas = BigInt(7)
        }
      }
    } else {
      if (baseFeePerGas) {
        throw new UsageError(
          'A base fee for a block can only be set with EIP1559 being activated',
          ErrorCode.EIP_NOT_ACTIVATED
        )
      }
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

    this._validateHeaderFields()
    this._validateDAOExtraData()

    // Now we have set all the values of this Header, we possibly have set a dummy
    // `difficulty` value (defaults to 0). If we have a `calcDifficultyFromHeader`
    // block option parameter, we instead set difficulty to this value.
    if (
      options.calcDifficultyFromHeader &&
      this._common.consensusAlgorithm() === ConsensusAlgorithm.Ethash
    ) {
      this.difficulty = this.canonicalDifficulty(options.calcDifficultyFromHeader)
    }

    // If cliqueSigner is provided, seal block with provided privateKey.
    if (options.cliqueSigner) {
      // Ensure extraData is at least length CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL
      const minExtraDataLength = CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL
      if (this.extraData.length < minExtraDataLength) {
        const remainingLength = minExtraDataLength - this.extraData.length
        this.extraData = Buffer.concat([this.extraData, Buffer.alloc(remainingLength)])
      }

      this.extraData = this.cliqueSealBlock(options.cliqueSigner)
    }

    const freeze = options?.freeze ?? true
    if (freeze) {
      Object.freeze(this)
    }
  }

  /**
   * Validates correct buffer lengths, throws if invalid.
   */
  _validateHeaderFields() {
    const {
      parentHash,
      uncleHash,
      stateRoot,
      transactionsTrie,
      receiptTrie,
      difficulty,
      extraData,
      mixHash,
      nonce,
    } = this

    if (parentHash.length !== 32) {
      throw new ValueError(`parentHash must be 32 bytes`, ErrorCode.INVALID_VALUE_LENGTH, {
        objectContext: this.errorStr(),
        received: `${parentHash.length} bytes`,
      })
    }
    if (stateRoot.length !== 32) {
      throw new ValueError(`stateRoot must be 32 bytes`, ErrorCode.INVALID_VALUE_LENGTH, {
        objectContext: this.errorStr(),
        received: `${stateRoot.length} bytes`,
      })
    }
    if (transactionsTrie.length !== 32) {
      throw new ValueError('transactionsTrie must be 32 bytes', ErrorCode.INVALID_VALUE_LENGTH, {
        objectContext: this.errorStr(),
        received: `${transactionsTrie.toString('hex')} (${transactionsTrie.length} bytes)`,
      })
    }
    if (receiptTrie.length !== 32) {
      throw new ValueError('receiptTrie must be 32 bytes', ErrorCode.INVALID_VALUE_LENGTH, {
        objectContext: this.errorStr(),
        received: `${receiptTrie.toString('hex')} (${receiptTrie.length} bytes)`,
      })
    }
    if (mixHash.length !== 32) {
      throw new ValueError('mixHash must be 32 bytes', ErrorCode.INVALID_VALUE_LENGTH, {
        objectContext: this.errorStr(),
        received: `${mixHash.toString('hex')} (${mixHash.length} bytes)`,
      })
    }

    if (nonce.length !== 8) {
      // Hack to check for Kovan due to non-standard nonce length (65 bytes)
      if (this._common.networkId() === BigInt(42)) {
        if (nonce.length !== 65) {
          throw new ValueError('nonce must be 65 bytes on kovan', ErrorCode.INVALID_VALUE_LENGTH, {
            objectContext: this.errorStr(),
            received: `${nonce.toString('hex')} (${nonce.length} bytes)`,
          })
        }
      } else {
        throw new ValueError('nonce must be 8 bytes', ErrorCode.INVALID_VALUE_LENGTH, {
          objectContext: this.errorStr(),
          received: `${nonce.toString('hex')} (${nonce.length} bytes)`,
        })
      }
    }

    // Validation for PoS blocks (EIP-3675)
    if (this._common.consensusType() === ConsensusType.ProofOfStake) {
      let error = false
      let errorMsg = ''

      if (!uncleHash.equals(KECCAK256_RLP_ARRAY)) {
        errorMsg += `, uncleHash: ${uncleHash.toString(
          'hex'
        )} (expected: ${KECCAK256_RLP_ARRAY.toString('hex')})`
        error = true
      }
      if (difficulty !== BigInt(0)) {
        errorMsg += `, difficulty: ${difficulty} (expected: 0)`
        error = true
      }
      if (extraData.length > 32) {
        errorMsg += `, extraData: ${extraData.toString(
          'hex'
        )} (cannot exceed 32 bytes length, received ${extraData.length} bytes)`
        error = true
      }
      if (!nonce.equals(zeros(8))) {
        errorMsg += `, nonce: ${nonce.toString('hex')} (expected: ${zeros(8).toString('hex')})`
        error = true
      }
      if (error) {
        throw new ValueError(`Invalid PoS block${errorMsg}`, ErrorCode.INVALID_OBJECT, {
          objectContext: this.errorStr(),
        })
      }
    }
  }

  /**
   * Returns the canonical difficulty for this block.
   *
   * @param parentBlockHeader - the header from the parent `Block` of this header
   */
  canonicalDifficulty(parentBlockHeader: BlockHeader): bigint {
    if (this._common.consensusType() !== ConsensusType.ProofOfWork) {
      throw new UsageError(
        'difficulty calculation is only supported on PoW chains',
        ErrorCode.INVALID_METHOD_CALL,
        {
          objectContext: this.errorStr(),
        }
      )
    }
    if (this._common.consensusAlgorithm() !== ConsensusAlgorithm.Ethash) {
      throw new UsageError(
        'difficulty calculation currently only supports the ethash algorithm',
        ErrorCode.INVALID_METHOD_CALL,
        {
          objectContext: this.errorStr(),
        }
      )
    }
    const hardfork = this._common.hardfork()
    const blockTs = this.timestamp
    const { timestamp: parentTs, difficulty: parentDif } = parentBlockHeader
    const minimumDifficulty = this._common.paramByHardfork('pow', 'minimumDifficulty', hardfork)
    const offset =
      parentDif / this._common.paramByHardfork('pow', 'difficultyBoundDivisor', hardfork)
    let num = this.number

    // We use a ! here as TS cannot follow this hardfork-dependent logic, but it always gets assigned
    let dif!: bigint

    if (this._common.hardforkGteHardfork(hardfork, Hardfork.Byzantium)) {
      // max((2 if len(parent.uncles) else 1) - ((timestamp - parent.timestamp) // 9), -99) (EIP100)
      const uncleAddend = parentBlockHeader.uncleHash.equals(KECCAK256_RLP_ARRAY) ? 1 : 2
      let a = BigInt(uncleAddend) - (blockTs - parentTs) / BigInt(9)
      const cutoff = BigInt(-99)
      // MAX(cutoff, a)
      if (cutoff > a) {
        a = cutoff
      }
      dif = parentDif + offset * a
    }

    if (this._common.hardforkGteHardfork(hardfork, Hardfork.Byzantium)) {
      // Get delay as parameter from common
      num = num - this._common.param('pow', 'difficultyBombDelay')
      if (num < BigInt(0)) {
        num = BigInt(0)
      }
    } else if (this._common.hardforkGteHardfork(hardfork, Hardfork.Homestead)) {
      // 1 - (block_timestamp - parent_timestamp) // 10
      let a = BigInt(1) - (blockTs - parentTs) / BigInt(10)
      const cutoff = BigInt(-99)
      // MAX(cutoff, a)
      if (cutoff > a) {
        a = cutoff
      }
      dif = parentDif + offset * a
    } else {
      // pre-homestead
      if (parentTs + this._common.paramByHardfork('pow', 'durationLimit', hardfork) > blockTs) {
        dif = offset + parentDif
      } else {
        dif = parentDif - offset
      }
    }

    const exp = num / BigInt(100000) - BigInt(2)
    if (exp >= 0) {
      // eslint-disable-next-line
      dif = dif + BigInt(2) ** exp
    }

    if (dif < minimumDifficulty) {
      dif = minimumDifficulty
    }

    return dif
  }

  /**
   * Checks that the block's `difficulty` matches the canonical difficulty.
   *
   * @param parentBlockHeader - the header from the parent `Block` of this header
   */
  validateDifficulty(parentBlockHeader: BlockHeader): boolean {
    return this.canonicalDifficulty(parentBlockHeader) === this.difficulty
  }

  /**
   * For poa, validates `difficulty` is correctly identified as INTURN or NOTURN.
   * Returns false if invalid.
   */
  validateCliqueDifficulty(blockchain: Blockchain): boolean {
    this._requireClique('validateCliqueDifficulty')
    if (this.difficulty !== CLIQUE_DIFF_INTURN && this.difficulty !== CLIQUE_DIFF_NOTURN) {
      throw new ValueError(
        'difficulty for clique block must be INTURN (2) or NOTURN (1)',
        ErrorCode.INVALID_VALUE,
        {
          objectContext: this.errorStr(),
          received: `${this.difficulty}`,
        }
      )
    }
    if ('cliqueActiveSigners' in (blockchain as any).consensus === false) {
      throw new UsageError(
        'PoA blockchain requires method blockchain.consensus.cliqueActiveSigners() to validate clique difficulty',
        ErrorCode.INCOMPATIBLE_LIBRARY_VERSION,
        {
          objectContext: this.errorStr(),
        }
      )
    }
    const signers = (blockchain as any).consensus.cliqueActiveSigners()
    if (signers.length === 0) {
      // abort if signers are unavailable
      return true
    }
    const signerIndex = signers.findIndex((address: Address) => address.equals(this.cliqueSigner()))
    const inTurn = this.number % BigInt(signers.length) === BigInt(signerIndex)
    if (
      (inTurn && this.difficulty === CLIQUE_DIFF_INTURN) ||
      (!inTurn && this.difficulty === CLIQUE_DIFF_NOTURN)
    ) {
      return true
    }
    return false
  }

  /**
   * Validates if the block gasLimit remains in the
   * boundaries set by the protocol.
   *
   * @param parentBlockHeader - the header from the parent `Block` of this header
   */
  validateGasLimit(parentBlockHeader: BlockHeader): boolean {
    let parentGasLimit = parentBlockHeader.gasLimit
    // EIP-1559: assume double the parent gas limit on fork block
    // to adopt to the new gas target centered logic
    const londonHardforkBlock = this._common.hardforkBlock(Hardfork.London)
    if (londonHardforkBlock && this.number === londonHardforkBlock) {
      const elasticity = this._common.param('gasConfig', 'elasticityMultiplier')
      parentGasLimit = parentGasLimit * elasticity
    }
    const gasLimit = this.gasLimit
    const hardfork = this._common.hardfork()

    const a =
      parentGasLimit / this._common.paramByHardfork('gasConfig', 'gasLimitBoundDivisor', hardfork)
    const maxGasLimit = parentGasLimit + a
    const minGasLimit = parentGasLimit - a

    const result =
      gasLimit < maxGasLimit &&
      gasLimit > minGasLimit &&
      gasLimit >= this._common.paramByHardfork('gasConfig', 'minGasLimit', hardfork)

    return result
  }

  /**
   * Validates the block header, throwing if invalid. It is being validated against the reported `parentHash`.
   * It verifies the current block against the `parentHash`:
   * - The `parentHash` is part of the blockchain (it is a valid header)
   * - Current block number is parent block number + 1
   * - Current block has a strictly higher timestamp
   * - Additional PoW checks ->
   *   - Current block has valid difficulty and gas limit
   *   - In case that the header is an uncle header, it should not be too old or young in the chain.
   * - Additional PoA clique checks ->
   *   - Various extraData checks
   *   - Checks on coinbase and mixHash
   *   - Current block has a timestamp diff greater or equal to PERIOD
   *   - Current block has difficulty correctly marked as INTURN or NOTURN
   * @param blockchain - validate against an @ethereumjs/blockchain
   * @param height - If this is an uncle header, this is the height of the block that is including it
   */
  async validate(blockchain: Blockchain, height?: bigint): Promise<void> {
    if (this.isGenesis()) {
      return
    }
    const hardfork = this._common.hardfork()
    // Consensus type dependent checks
    if (this._common.consensusAlgorithm() === ConsensusAlgorithm.Ethash) {
      // PoW/Ethash
      if (
        this.extraData.length > this._common.paramByHardfork('vm', 'maxExtraDataSize', hardfork)
      ) {
        const msg = this._errorMsg('invalid amount of extra data')
        throw new Error(msg)
      }
    }
    if (this._common.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      // PoA/Clique
      const minLength = CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL
      if (!this.cliqueIsEpochTransition()) {
        // ExtraData length on epoch transition
        if (this.extraData.length !== minLength) {
          const msg = this._errorMsg(
            `extraData must be ${minLength} bytes on non-epoch transition blocks, received ${this.extraData.length} bytes`
          )
          throw new Error(msg)
        }
      } else {
        const signerLength = this.extraData.length - minLength
        if (signerLength % 20 !== 0) {
          const msg = this._errorMsg(
            `invalid signer list length in extraData, received signer length of ${signerLength} (not divisible by 20)`
          )
          throw new Error(msg)
        }
        // coinbase (beneficiary) on epoch transition
        if (!this.coinbase.isZero()) {
          const msg = this._errorMsg(
            `coinbase must be filled with zeros on epoch transition blocks, received ${this.coinbase}`
          )
          throw new Error(msg)
        }
      }
      // MixHash format
      if (!this.mixHash.equals(Buffer.alloc(32))) {
        const msg = this._errorMsg(`mixHash must be filled with zeros, received ${this.mixHash}`)
        throw new Error(msg)
      }
      if (!this.validateCliqueDifficulty(blockchain)) {
        const msg = this._errorMsg(`invalid clique difficulty`)
        throw new Error(msg)
      }
    }

    const parentHeader = await this._getHeaderByHash(blockchain, this.parentHash)

    if (!parentHeader) {
      const msg = this._errorMsg('could not find parent header')
      throw new Error(msg)
    }

    const { number } = this
    if (number !== parentHeader.number + BigInt(1)) {
      const msg = this._errorMsg('invalid number')
      throw new Error(msg)
    }

    if (this.timestamp <= parentHeader.timestamp) {
      const msg = this._errorMsg('invalid timestamp')
      throw new Error(msg)
    }

    if (this._common.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      const period = (this._common.consensusConfig() as CliqueConfig).period
      // Timestamp diff between blocks is lower than PERIOD (clique)
      if (parentHeader.timestamp + BigInt(period) > this.timestamp) {
        const msg = this._errorMsg('invalid timestamp diff (lower than period)')
        throw new Error(msg)
      }
    }

    if (this._common.consensusType() === 'pow') {
      if (!this.validateDifficulty(parentHeader)) {
        const msg = this._errorMsg('invalid difficulty')
        throw new Error(msg)
      }
    }

    if (!this.validateGasLimit(parentHeader)) {
      const msg = this._errorMsg('invalid gas limit')
      throw new Error(msg)
    }

    if (height) {
      const dif = height - parentHeader.number
      if (!(dif < BigInt(8) && dif > BigInt(1))) {
        const msg = this._errorMsg('uncle block has a parent that is too old or too young')
        throw new Error(msg)
      }
    }

    // check if the block used too much gas
    if (this.gasUsed > this.gasLimit) {
      const msg = this._errorMsg('Invalid block: too much gas used')
      throw new Error(msg)
    }

    if (this._common.isActivatedEIP(1559)) {
      if (!this.baseFeePerGas) {
        const msg = this._errorMsg('EIP1559 block has no base fee field')
        throw new Error(msg)
      }
      const londonHfBlock = this._common.hardforkBlock(Hardfork.London)
      const isInitialEIP1559Block = londonHfBlock && this.number === londonHfBlock
      if (isInitialEIP1559Block) {
        const initialBaseFee = this._common.param('gasConfig', 'initialBaseFee')
        if (this.baseFeePerGas! !== initialBaseFee) {
          const msg = this._errorMsg('Initial EIP1559 block does not have initial base fee')
          throw new Error(msg)
        }
      } else {
        // check if the base fee is correct
        const expectedBaseFee = parentHeader.calcNextBaseFee()

        if (this.baseFeePerGas! !== expectedBaseFee) {
          const msg = this._errorMsg('Invalid block: base fee not correct')
          throw new Error(msg)
        }
      }
    }
  }

  /**
   * Calculates the base fee for a potential next block
   */
  public calcNextBaseFee(): bigint {
    if (!this._common.isActivatedEIP(1559)) {
      const msg = this._errorMsg(
        'calcNextBaseFee() can only be called with EIP1559 being activated'
      )
      throw new Error(msg)
    }
    let nextBaseFee: bigint
    const elasticity = this._common.param('gasConfig', 'elasticityMultiplier')
    const parentGasTarget = this.gasLimit / elasticity

    if (parentGasTarget === this.gasUsed) {
      nextBaseFee = this.baseFeePerGas!
    } else if (this.gasUsed > parentGasTarget) {
      const gasUsedDelta = this.gasUsed - parentGasTarget
      const baseFeeMaxChangeDenominator = this._common.param(
        'gasConfig',
        'baseFeeMaxChangeDenominator'
      )

      const calculatedDelta =
        (this.baseFeePerGas! * gasUsedDelta) / parentGasTarget / baseFeeMaxChangeDenominator
      nextBaseFee =
        (calculatedDelta > BigInt(1) ? calculatedDelta : BigInt(1)) + this.baseFeePerGas!
    } else {
      const gasUsedDelta = parentGasTarget - this.gasUsed
      const baseFeeMaxChangeDenominator = this._common.param(
        'gasConfig',
        'baseFeeMaxChangeDenominator'
      )

      const calculatedDelta =
        (this.baseFeePerGas! * gasUsedDelta) / parentGasTarget / baseFeeMaxChangeDenominator
      nextBaseFee =
        this.baseFeePerGas! - calculatedDelta > BigInt(0)
          ? this.baseFeePerGas! - calculatedDelta
          : BigInt(0)
    }
    return nextBaseFee
  }

  /**
   * Returns a Buffer Array of the raw Buffers in this header, in order.
   */
  raw(): BlockHeaderBuffer {
    const rawItems = [
      this.parentHash,
      this.uncleHash,
      this.coinbase.buf,
      this.stateRoot,
      this.transactionsTrie,
      this.receiptTrie,
      this.logsBloom,
      bigIntToUnpaddedBuffer(this.difficulty),
      bigIntToUnpaddedBuffer(this.number),
      bigIntToUnpaddedBuffer(this.gasLimit),
      bigIntToUnpaddedBuffer(this.gasUsed),
      bigIntToUnpaddedBuffer(this.timestamp ?? BigInt(0)),
      this.extraData,
      this.mixHash,
      this.nonce,
    ]

    if (this._common.isActivatedEIP(1559)) {
      rawItems.push(bigIntToUnpaddedBuffer(this.baseFeePerGas!))
    }

    return rawItems
  }

  /**
   * Returns the hash of the block header.
   */
  hash(): Buffer {
    if (Object.isFrozen(this)) {
      if (!this.cache.hash) {
        this.cache.hash = Buffer.from(keccak256(RLP.encode(bufArrToArr(this.raw()))))
      }
      return this.cache.hash
    }

    return Buffer.from(keccak256(RLP.encode(bufArrToArr(this.raw()))))
  }

  /**
   * Checks if the block header is a genesis header.
   */
  isGenesis(): boolean {
    return this.number === BigInt(0)
  }

  private _requireClique(name: string) {
    if (this._common.consensusAlgorithm() !== ConsensusAlgorithm.Clique) {
      const msg = this._errorMsg(
        `BlockHeader.${name}() call only supported for clique PoA networks`
      )
      throw new Error(msg)
    }
  }

  /**
   * PoA clique signature hash without the seal.
   */
  cliqueSigHash() {
    this._requireClique('cliqueSigHash')
    const raw = this.raw()
    raw[12] = this.extraData.slice(0, this.extraData.length - CLIQUE_EXTRA_SEAL)
    return Buffer.from(keccak256(RLP.encode(bufArrToArr(raw))))
  }

  /**
   * Checks if the block header is an epoch transition
   * header (only clique PoA, throws otherwise)
   */
  cliqueIsEpochTransition(): boolean {
    this._requireClique('cliqueIsEpochTransition')
    const epoch = BigInt((this._common.consensusConfig() as CliqueConfig).epoch)
    // Epoch transition block if the block number has no
    // remainder on the division by the epoch length
    return this.number % epoch === BigInt(0)
  }

  /**
   * Returns extra vanity data
   * (only clique PoA, throws otherwise)
   */
  cliqueExtraVanity(): Buffer {
    this._requireClique('cliqueExtraVanity')
    return this.extraData.slice(0, CLIQUE_EXTRA_VANITY)
  }

  /**
   * Returns extra seal data
   * (only clique PoA, throws otherwise)
   */
  cliqueExtraSeal(): Buffer {
    this._requireClique('cliqueExtraSeal')
    return this.extraData.slice(-CLIQUE_EXTRA_SEAL)
  }

  /**
   * Seal block with the provided signer.
   * Returns the final extraData field to be assigned to `this.extraData`.
   * @hidden
   */
  private cliqueSealBlock(privateKey: Buffer) {
    this._requireClique('cliqueSealBlock')

    const signature = ecsign(this.cliqueSigHash(), privateKey)
    const signatureB = Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)])

    const extraDataWithoutSeal = this.extraData.slice(0, this.extraData.length - CLIQUE_EXTRA_SEAL)
    const extraData = Buffer.concat([extraDataWithoutSeal, signatureB])
    return extraData
  }

  /**
   * Returns a list of signers
   * (only clique PoA, throws otherwise)
   *
   * This function throws if not called on an epoch
   * transition block and should therefore be used
   * in conjunction with {@link BlockHeader.cliqueIsEpochTransition}
   */
  cliqueEpochTransitionSigners(): Address[] {
    this._requireClique('cliqueEpochTransitionSigners')
    if (!this.cliqueIsEpochTransition()) {
      const msg = this._errorMsg('Signers are only included in epoch transition blocks (clique)')
      throw new Error(msg)
    }

    const start = CLIQUE_EXTRA_VANITY
    const end = this.extraData.length - CLIQUE_EXTRA_SEAL
    const signerBuffer = this.extraData.slice(start, end)

    const signerList: Buffer[] = []
    const signerLength = 20
    for (let start = 0; start <= signerBuffer.length - signerLength; start += signerLength) {
      signerList.push(signerBuffer.slice(start, start + signerLength))
    }
    return signerList.map((buf) => new Address(buf))
  }

  /**
   * Verifies the signature of the block (last 65 bytes of extraData field)
   * (only clique PoA, throws otherwise)
   *
   *  Method throws if signature is invalid
   */
  cliqueVerifySignature(signerList: Address[]): boolean {
    this._requireClique('cliqueVerifySignature')
    const signerAddress = this.cliqueSigner()
    const signerFound = signerList.find((signer) => {
      return signer.equals(signerAddress)
    })
    return !!signerFound
  }

  /**
   * Returns the signer address
   */
  cliqueSigner(): Address {
    this._requireClique('cliqueSigner')
    const extraSeal = this.cliqueExtraSeal()
    // Reasonable default for default blocks
    if (extraSeal.length === 0) {
      return Address.zero()
    }
    const r = extraSeal.slice(0, 32)
    const s = extraSeal.slice(32, 64)
    const v = bufferToBigInt(extraSeal.slice(64, 65)) + BigInt(27)
    const pubKey = ecrecover(this.cliqueSigHash(), v, r, s)
    return Address.fromPublicKey(pubKey)
  }

  /**
   * Returns the rlp encoding of the block header.
   */
  serialize(): Buffer {
    return Buffer.from(RLP.encode(bufArrToArr(this.raw())))
  }

  /**
   * Returns the block header in JSON format.
   */
  toJSON(): JsonHeader {
    const jsonDict: JsonHeader = {
      parentHash: '0x' + this.parentHash.toString('hex'),
      uncleHash: '0x' + this.uncleHash.toString('hex'),
      coinbase: this.coinbase.toString(),
      stateRoot: '0x' + this.stateRoot.toString('hex'),
      transactionsTrie: '0x' + this.transactionsTrie.toString('hex'),
      receiptTrie: '0x' + this.receiptTrie.toString('hex'),
      logsBloom: '0x' + this.logsBloom.toString('hex'),
      difficulty: bigIntToHex(this.difficulty),
      number: bigIntToHex(this.number),
      gasLimit: bigIntToHex(this.gasLimit),
      gasUsed: bigIntToHex(this.gasUsed),
      timestamp: bigIntToHex(this.timestamp),
      extraData: '0x' + this.extraData.toString('hex'),
      mixHash: '0x' + this.mixHash.toString('hex'),
      nonce: '0x' + this.nonce.toString('hex'),
    }
    if (this._common.isActivatedEIP(1559)) {
      jsonDict.baseFeePerGas = bigIntToHex(this.baseFeePerGas!)
    }
    return jsonDict
  }

  private async _getHeaderByHash(
    blockchain: Blockchain,
    hash: Buffer
  ): Promise<BlockHeader | undefined> {
    try {
      const header = (await blockchain.getBlock(hash)).header
      return header
    } catch (error: any) {
      if (error.type === 'NotFoundError') {
        return undefined
      } else {
        throw error
      }
    }
  }

  /**
   * Validates extra data is DAO_ExtraData for DAO_ForceExtraDataRange blocks after DAO
   * activation block (see: https://blog.slock.it/hard-fork-specification-24b889e70703)
   */
  private _validateDAOExtraData() {
    if (!this._common.hardforkIsActiveOnBlock(Hardfork.Dao, this.number)) {
      return
    }
    const DAOActivationBlock = this._common.hardforkBlock(Hardfork.Dao)
    if (
      !DAOActivationBlock ||
      DAOActivationBlock === BigInt(0) ||
      this.number < DAOActivationBlock
    ) {
      return
    }
    const DAO_ExtraData = Buffer.from('64616f2d686172642d666f726b', 'hex')
    const DAO_ForceExtraDataRange = BigInt(9)
    const drift = this.number - DAOActivationBlock
    if (drift <= DAO_ForceExtraDataRange && !this.extraData.equals(DAO_ExtraData)) {
      const msg = this._errorMsg("extraData should be 'dao-hard-fork'")
      throw new Error(msg)
    }
  }

  /**
   * Return a compact error string representation of the object
   */
  public errorStr() {
    let hash = ''
    try {
      hash = bufferToHex(this.hash())
    } catch (e: any) {
      hash = 'error'
    }
    let hf = ''
    try {
      hf = this._common.hardfork()
    } catch (e: any) {
      hf = 'error'
    }
    let errorStr = `block header number=${this.number} hash=${hash} `
    errorStr += `hf=${hf} baseFeePerGas=${this.baseFeePerGas ?? 'none'}`
    return errorStr
  }

  /**
   * Internal helper function to create an annotated error message
   *
   * @param msg Base error message
   * @hidden
   */
  protected _errorMsg(msg: string) {
    return `${msg} (${this.errorStr()})`
  }
}
