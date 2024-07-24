import type { ParamsDict } from './types.js'

export const paramsDict: ParamsDict = {
  /** Frontier/Chainstart */
  1: {
    // gasConfig
    minGasLimit: 5000, // Minimum the gas limit may ever be
    gasLimitBoundDivisor: 1024, // The bound divisor of the gas limit, used in update calculations
    maxRefundQuotient: 2, // Maximum refund quotient; max tx refund is min(tx.gasUsed/maxRefundQuotient, tx.gasRefund)
    targetBlobGasPerBlock: 0, // Base value needed here since called pre-4844 in BlockHeader.calcNextExcessBlobGas()
    blobGasPerBlob: 0,
    maxblobGasPerBlock: 0,
    // gasPrices
    basefeeGas: 2, // Gas base cost, used e.g. for ChainID opcode (Istanbul)
    expGas: 10, // Base fee of the EXP opcode
    expByteGas: 10, // Times ceil(log256(exponent)) for the EXP instruction
    keccak256Gas: 30, // Base fee of the SHA3 opcode
    keccak256WordGas: 6, // Once per word of the SHA3 operation's data
    sloadGas: 50, // Base fee of the SLOAD opcode
    sstoreSetGas: 20000, // Once per SSTORE operation if the zeroness changes from zero
    sstoreResetGas: 5000, // Once per SSTORE operation if the zeroness does not change from zero
    sstoreRefundGas: 15000, // Once per SSTORE operation if the zeroness changes to zero
    jumpdestGas: 1, // Base fee of the JUMPDEST opcode
    logGas: 375, // Base fee of the LOG opcode
    logDataGas: 8, // Per byte in a LOG* operation's data
    logTopicGas: 375, // Multiplied by the * of the LOG*, per LOG transaction. e.g. LOG0 incurs 0 * c_txLogTopicGas, LOG4 incurs 4 * c_txLogTopicGas
    createGas: 32000, // Base fee of the CREATE opcode
    callGas: 40, // Base fee of the CALL opcode
    callStipendGas: 2300, // Free gas given at beginning of call
    callValueTransferGas: 9000, // Paid for CALL when the value transfor is non-zero
    callNewAccountGas: 25000, // Paid for CALL when the destination address didn't exist prior
    selfdestructRefundGas: 24000, // Refunded following a selfdestruct operation
    memoryGas: 3, // Times the address of the (highest referenced byte in memory + 1). NOTE: referencing happens on read, write and in instructions such as RETURN and CALL
    quadCoeffDivGas: 512, // Divisor for the quadratic particle of the memory cost equation
    createDataGas: 200, //
    txGas: 21000, // Per transaction. NOTE: Not payable on data of calls between transactions
    txCreationGas: 32000, // The cost of creating a contract via tx
    txDataZeroGas: 4, // Per byte of data attached to a transaction that equals zero. NOTE: Not payable on data of calls between transactions
    txDataNonZeroGas: 68, // Per byte of data attached to a transaction that is not equal to zero. NOTE: Not payable on data of calls between transactions
    copyGas: 3, // Multiplied by the number of 32-byte words that are copied (round up) for any *COPY operation and added
    ecRecoverGas: 3000,
    sha256Gas: 60,
    sha256WordGas: 12,
    ripemd160Gas: 600,
    ripemd160WordGas: 120,
    identityGas: 15,
    identityWordGas: 3,
    stopGas: 0, // Base fee of the STOP opcode
    addGas: 3, // Base fee of the ADD opcode
    mulGas: 5, // Base fee of the MUL opcode
    subGas: 3, // Base fee of the SUB opcode
    divGas: 5, // Base fee of the DIV opcode
    sdivGas: 5, // Base fee of the SDIV opcode
    modGas: 5, // Base fee of the MOD opcode
    smodGas: 5, // Base fee of the SMOD opcode
    addmodGas: 8, // Base fee of the ADDMOD opcode
    mulmodGas: 8, // Base fee of the MULMOD opcode
    signextendGas: 5, // Base fee of the SIGNEXTEND opcode
    ltGas: 3, // Base fee of the LT opcode
    gtGas: 3, // Base fee of the GT opcode
    sltGas: 3, // Base fee of the SLT opcode
    sgtGas: 3, // Base fee of the SGT opcode
    eqGas: 3, // Base fee of the EQ opcode
    iszeroGas: 3, // Base fee of the ISZERO opcode
    andGas: 3, // Base fee of the AND opcode
    orGas: 3, // Base fee of the OR opcode
    xorGas: 3, // Base fee of the XOR opcode
    notGas: 3, // Base fee of the NOT opcode
    byteGas: 3, // Base fee of the BYTE opcode
    addressGas: 2, // Base fee of the ADDRESS opcode
    balanceGas: 20, // Base fee of the BALANCE opcode
    originGas: 2, // Base fee of the ORIGIN opcode
    callerGas: 2, // Base fee of the CALLER opcode
    callvalueGas: 2, // Base fee of the CALLVALUE opcode
    calldataloadGas: 3, // Base fee of the CALLDATALOAD opcode
    calldatasizeGas: 2, // Base fee of the CALLDATASIZE opcode
    calldatacopyGas: 3, // Base fee of the CALLDATACOPY opcode
    codesizeGas: 2, // Base fee of the CODESIZE opcode
    codecopyGas: 3, // Base fee of the CODECOPY opcode
    gaspriceGas: 2, // Base fee of the GASPRICE opcode
    extcodesizeGas: 20, // Base fee of the EXTCODESIZE opcode
    extcodecopyGas: 20, // Base fee of the EXTCODECOPY opcode
    blockhashGas: 20, // Base fee of the BLOCKHASH opcode
    coinbaseGas: 2, // Base fee of the COINBASE opcode
    timestampGas: 2, // Base fee of the TIMESTAMP opcode
    numberGas: 2, // Base fee of the NUMBER opcode
    difficultyGas: 2, // Base fee of the DIFFICULTY opcode
    gaslimitGas: 2, // Base fee of the GASLIMIT opcode
    popGas: 2, // Base fee of the POP opcode
    mloadGas: 3, // Base fee of the MLOAD opcode
    mstoreGas: 3, // Base fee of the MSTORE opcode
    mstore8Gas: 3, // Base fee of the MSTORE8 opcode
    sstoreGas: 0, // Base fee of the SSTORE opcode
    jumpGas: 8, // Base fee of the JUMP opcode
    jumpiGas: 10, // Base fee of the JUMPI opcode
    pcGas: 2, // Base fee of the PC opcode
    msizeGas: 2, // Base fee of the MSIZE opcode
    gasGas: 2, // Base fee of the GAS opcode
    pushGas: 3, // Base fee of the PUSH opcode
    dupGas: 3, // Base fee of the DUP opcode
    swapGas: 3, // Base fee of the SWAP opcode
    callcodeGas: 40, // Base fee of the CALLCODE opcode
    returnGas: 0, // Base fee of the RETURN opcode
    invalidGas: 0, // Base fee of the INVALID opcode
    selfdestructGas: 0, // Base fee of the SELFDESTRUCT opcode
    prevrandaoGas: 0, // TODO: these below 0-gas additons might also point to non-clean implementations in the code base
    authGas: 0, // ...allowing access to non-existing gas parameters. Might be worth to fix at some point.
    authcallGas: 0,
    accessListStorageKeyGas: 0,
    accessListAddressGas: 0,
    // vm
    stackLimit: 1024, // Maximum size of VM stack allowed
    callCreateDepth: 1024, // Maximum depth of call/create stack
    maxExtraDataSize: 32, // Maximum size extra data may be after Genesis
    // pow
    minimumDifficulty: 131072, // The minimum that the difficulty may ever be
    difficultyBoundDivisor: 2048, // The bound divisor of the difficulty, used in the update calculations
    durationLimit: 13, // The decision boundary on the blocktime duration used to determine whether difficulty should go up or not
    epochDuration: 30000, // Duration between proof-of-work epochs
    timebombPeriod: 100000, // Exponential difficulty timebomb period
    minerReward: BigInt('5000000000000000000'), // the amount a miner get rewarded for mining a block
    difficultyBombDelay: 0, // the amount of blocks to delay the difficulty bomb with
  },
  /**
.  * Homestead HF Meta EIP
.  */
  606: {
    // gasPrices
    delegatecallGas: 40, // Base fee of the DELEGATECALL opcode
  },
  /**
.  * TangerineWhistle HF Meta EIP
.  */
  608: {
    // gasPrices
    sloadGas: 200, // Once per SLOAD operation
    callGas: 700, // Once per CALL operation & message call transaction
    extcodesizeGas: 700, // Base fee of the EXTCODESIZE opcode
    extcodecopyGas: 700, // Base fee of the EXTCODECOPY opcode
    balanceGas: 400, // Base fee of the BALANCE opcode
    delegatecallGas: 700, // Base fee of the DELEGATECALL opcode
    callcodeGas: 700, // Base fee of the CALLCODE opcode
    selfdestructGas: 5000, // Base fee of the SELFDESTRUCT opcode
  },
  /**
.  * Spurious Dragon HF Meta EIP
.  */
  607: {
    // gasPrices
    expByteGas: 50, // Times ceil(log256(exponent)) for the EXP instruction
    // vm
    maxCodeSize: 24576, // Maximum length of contract code
  },
  /**
.  * Byzantium HF Meta EIP
.  */
  609: {
    // gasPrices
    modexpGquaddivisorGas: 20, // Gquaddivisor from modexp precompile for gas calculation
    ecAddGas: 500, // Gas costs for curve addition precompile
    ecMulGas: 40000, // Gas costs for curve multiplication precompile
    ecPairingGas: 100000, // Base gas costs for curve pairing precompile
    ecPairingWordGas: 80000, // Gas costs regarding curve pairing precompile input length
    revertGas: 0, // Base fee of the REVERT opcode
    staticcallGas: 700, // Base fee of the STATICCALL opcode
    returndatasizeGas: 2, // Base fee of the RETURNDATASIZE opcode
    returndatacopyGas: 3, // Base fee of the RETURNDATACOPY opcode
    // pow
    minerReward: BigInt('3000000000000000000'), // the amount a miner get rewarded for mining a block
    difficultyBombDelay: 3000000, // the amount of blocks to delay the difficulty bomb with
  },
  /**
.  * Constantinope HF Meta EIP
.  */
  1013: {
    // gasPrices
    netSstoreNoopGas: 200, // Once per SSTORE operation if the value doesn't change
    netSstoreInitGas: 20000, // Once per SSTORE operation from clean zero
    netSstoreCleanGas: 5000, // Once per SSTORE operation from clean non-zero
    netSstoreDirtyGas: 200, // Once per SSTORE operation from dirty
    netSstoreClearRefundGas: 15000, // Once per SSTORE operation for clearing an originally existing storage slot
    netSstoreResetRefundGas: 4800, // Once per SSTORE operation for resetting to the original non-zero value
    netSstoreResetClearRefundGas: 19800, // Once per SSTORE operation for resetting to the original zero value
    shlGas: 3, // Base fee of the SHL opcode
    shrGas: 3, // Base fee of the SHR opcode
    sarGas: 3, // Base fee of the SAR opcode
    extcodehashGas: 400, // Base fee of the EXTCODEHASH opcode
    create2Gas: 32000, // Base fee of the CREATE2 opcode
    // pow
    minerReward: BigInt('2000000000000000000'), // The amount a miner gets rewarded for mining a block
    difficultyBombDelay: 5000000, // the amount of blocks to delay the difficulty bomb with
  },
  /**
.  * Petersburg HF Meta EIP
.  */
  1716: {
    // gasPrices
    netSstoreNoopGas: null, // Removed along EIP-1283
    netSstoreInitGas: null, // Removed along EIP-1283
    netSstoreCleanGas: null, // Removed along EIP-1283
    netSstoreDirtyGas: null, // Removed along EIP-1283
    netSstoreClearRefundGas: null, // Removed along EIP-1283
    netSstoreResetRefundGas: null, // Removed along EIP-1283
    netSstoreResetClearRefundGas: null, // Removed along EIP-1283
  },
  /**
.  * Istanbul HF Meta EIP
.  */
  1679: {
    // gasPrices
    blake2RoundGas: 1, // Gas cost per round for the Blake2 F precompile
    ecAddGas: 150, // Gas costs for curve addition precompile
    ecMulGas: 6000, // Gas costs for curve multiplication precompile
    ecPairingGas: 45000, // Base gas costs for curve pairing precompile
    ecPairingWordGas: 34000, // Gas costs regarding curve pairing precompile input length
    txDataNonZeroGas: 16, // Per byte of data attached to a transaction that is not equal to zero. NOTE: Not payable on data of calls between transactions
    sstoreSentryEIP2200Gas: 2300, // Minimum gas required to be present for an SSTORE call, not consumed
    sstoreNoopEIP2200Gas: 800, // Once per SSTORE operation if the value doesn't change
    sstoreDirtyEIP2200Gas: 800, // Once per SSTORE operation if a dirty value is changed
    sstoreInitEIP2200Gas: 20000, // Once per SSTORE operation from clean zero to non-zero
    sstoreInitRefundEIP2200Gas: 19200, // Once per SSTORE operation for resetting to the original zero value
    sstoreCleanEIP2200Gas: 5000, // Once per SSTORE operation from clean non-zero to something else
    sstoreCleanRefundEIP2200Gas: 4200, // Once per SSTORE operation for resetting to the original non-zero value
    sstoreClearRefundEIP2200Gas: 15000, // Once per SSTORE operation for clearing an originally existing storage slot
    balanceGas: 700, // Base fee of the BALANCE opcode
    extcodehashGas: 700, // Base fee of the EXTCODEHASH opcode
    chainidGas: 2, // Base fee of the CHAINID opcode
    selfbalanceGas: 5, // Base fee of the SELFBALANCE opcode
    sloadGas: 800, // Base fee of the SLOAD opcode
  },
  /**
.  * MuirGlacier HF Meta EIP
.  */
  2384: {
    // pow
    difficultyBombDelay: 9000000, // the amount of blocks to delay the difficulty bomb with
  },
  /**
.  * SWAPN, DUPN and EXCHANGE instructions
.  */
  663: {
    // gasPrices
    dupnGas: 3, // Base fee of the DUPN opcode
    swapnGas: 3, // Base fee of the SWAPN opcode
    exchangeGas: 3, // Base fee of the EXCHANGE opcode
  },
  /**
.  * Transient storage opcodes
.  */
  1153: {
    // gasPrices
    tstoreGas: 100, // Base fee of the TSTORE opcode
    tloadGas: 100, // Base fee of the TLOAD opcode
  },
  /**
.  * Fee market change for ETH 1.0 chain
.  */
  1559: {
    // gasConfig
    baseFeeMaxChangeDenominator: 8, // Maximum base fee change denominator
    elasticityMultiplier: 2, // Maximum block gas target elasticity
    initialBaseFee: 1000000000, // Initial base fee on first EIP1559 block
  },
  /**
.  * ModExp gas cost
.  */
  2565: {
    // gasPrices
    modexpGquaddivisorGas: 3, // Gquaddivisor from modexp precompile for gas calculation
  },
  /**
   * BLS12-381 precompiles
   */
  2537: {
    // gasPrices
    Bls12381G1AddGas: 500, // Gas cost of a single BLS12-381 G1 addition precompile-call
    Bls12381G1MulGas: 12000, // Gas cost of a single BLS12-381 G1 multiplication precompile-call
    Bls12381G2AddGas: 800, // Gas cost of a single BLS12-381 G2 addition precompile-call
    Bls12381G2MulGas: 45000, // Gas cost of a single BLS12-381 G2 multiplication precompile-call
    Bls12381PairingBaseGas: 65000, // Base gas cost of BLS12-381 pairing check
    Bls12381PairingPerPairGas: 43000, // Per-pair gas cost of BLS12-381 pairing check
    Bls12381MapG1Gas: 5500, // Gas cost of BLS12-381 map field element to G1
    Bls12381MapG2Gas: 75000, // Gas cost of BLS12-381 map field element to G2
  },
  /**
.  * Typed Transaction Envelope
.  */
  2718: {},
  /**
.  * Gas cost increases for state access opcodes
.  */
  2929: {
    // gasPrices
    coldsloadGas: 2100, // Gas cost of the first read of storage from a given location (per transaction)
    coldaccountaccessGas: 2600, // Gas cost of the first read of a given address (per transaction)
    warmstoragereadGas: 100, // Gas cost of reading storage locations which have already loaded 'cold'
    sstoreCleanEIP2200Gas: 2900, // Once per SSTORE operation from clean non-zero to something else
    sstoreNoopEIP2200Gas: 100, // Once per SSTORE operation if the value doesn't change
    sstoreDirtyEIP2200Gas: 100, // Once per SSTORE operation if a dirty value is changed
    sstoreInitRefundEIP2200Gas: 19900, // Once per SSTORE operation for resetting to the original zero value
    sstoreCleanRefundEIP2200Gas: 4900, // Once per SSTORE operation for resetting to the original non-zero value
    callGas: 0, // Base fee of the CALL opcode
    callcodeGas: 0, // Base fee of the CALLCODE opcode
    delegatecallGas: 0, // Base fee of the DELEGATECALL opcode
    staticcallGas: 0, // Base fee of the STATICCALL opcode
    balanceGas: 0, // Base fee of the BALANCE opcode
    extcodesizeGas: 0, // Base fee of the EXTCODESIZE opcode
    extcodecopyGas: 0, // Base fee of the EXTCODECOPY opcode
    extcodehashGas: 0, // Base fee of the EXTCODEHASH opcode
    sloadGas: 0, // Base fee of the SLOAD opcode
    sstoreGas: 0, // Base fee of the SSTORE opcode
  },
  /**
.  * Optional access lists
.  */
  2930: {
    // gasPrices
    accessListStorageKeyGas: 1900, // Gas cost per storage key in an Access List transaction
    accessListAddressGas: 2400, // Gas cost per storage key in an Access List transaction
  },
  /**
   * Save historical block hashes in state (Verkle related usage, UNSTABLE)
   */
  2935: {
    // vm
    historyStorageAddress: BigInt('0x0aae40965e6800cd9b1f4b05ff21581047e3f91e'), // The address where the historical blockhashes are stored
    historyServeWindow: BigInt(8192), // The amount of blocks to be served by the historical blockhash contract
  },
  /**
.  * AUTH and AUTHCALL opcodes
.  */
  3074: {
    // gasPrices
    authGas: 3100, // Gas cost of the AUTH opcode
    authcallGas: 0, // Gas cost of the AUTHCALL opcode
    authcallValueTransferGas: 6700, // Paid for CALL when the value transfer is non-zero
  },
  /**
.  * BASEFEE opcode
.  */
  3198: {
    // gasPrices
    basefeeGas: 2, // Gas cost of the BASEFEE opcode
  },
  /**
.  * Reduction in refunds
.  */
  3529: {
    // gasConfig
    maxRefundQuotient: 5, // Maximum refund quotient; max tx refund is min(tx.gasUsed/maxRefundQuotient, tx.gasRefund)
    // gasPrices
    selfdestructRefundGas: 0, // Refunded following a selfdestruct operation
    sstoreClearRefundEIP2200Gas: 4800, // Once per SSTORE operation for clearing an originally existing storage slot
  },
  /**
   * EVM Object Format (EOF) v1
   */
  3540: {},
  /**
.  * Reject new contracts starting with the 0xEF byte
.  */
  3541: {},
  /**
.  * Difficulty Bomb Delay to December 1st 2021
.  */
  3554: {
    // pow
    difficultyBombDelay: 9500000, // the amount of blocks to delay the difficulty bomb with
  },
  /**
.  * Reject transactions from senders with deployed code
.  */
  3607: {},
  /**
.  * Warm COINBASE
.  */
  3651: {},
  /**
   * EOF - Code Validation
   */
  3670: {},
  /**
   * Upgrade consensus to Proof-of-Stake
   */
  3675: {},
  /**
.  * PUSH0 instruction
.  */
  3855: {
    // gasPrices
    push0Gas: 2, // Base fee of the PUSH0 opcode
  },
  /**
.  * Limit and meter initcode
.  */
  3860: {
    // gasPrices
    initCodeWordGas: 2, // Gas to pay for each word (32 bytes) of initcode when creating a contract
    // vm
    maxInitCodeSize: 49152, // Maximum length of initialization code when creating a contract
  },
  /**
   * EOF - Static relative jumps
   */
  4200: {
    // gasPrices
    rjumpGas: 2, // Base fee of the RJUMP opcode
    rjumpiGas: 4, // Base fee of the RJUMPI opcode
    rjumpvGas: 4, // Base fee of the RJUMPV opcode
  },
  /**
.  * Difficulty Bomb Delay to June 2022
.  */
  4345: {
    // pow
    difficultyBombDelay: 10700000, // the amount of blocks to delay the difficulty bomb with
  },
  /**
.  * Supplant DIFFICULTY opcode with PREVRANDAO
.  */
  4399: {
    // gasPrices
    prevrandaoGas: 2, // Base fee of the PREVRANDAO opcode (previously DIFFICULTY)
  },
  /**
   * EOF - Functions
   */
  4750: {
    // gasPrices
    callfGas: 5, // Base fee of the CALLF opcode
    retfGas: 3, // Base fee of the RETF opcode
  },
  /**
.  * Beacon block root in the EVM
.  */
  4788: {
    // vm
    historicalRootsLength: 8191, // The modulo parameter of the beaconroot ring buffer in the beaconroot statefull precompile
  },
  /**
.  * Shard Blob Transactions
.  */
  4844: {
    // gasConfig
    blobGasPerBlob: 131072, // The base fee for blob gas per blob
    targetBlobGasPerBlock: 393216, // The target blob gas consumed per block
    maxblobGasPerBlock: 786432, // The max blob gas allowable per block
    blobGasPriceUpdateFraction: 3338477, // The denominator used in the exponential when calculating a blob gas price
    // gasPrices
    simplePerBlobGas: 12000, // The basic gas fee for each blob
    minBlobGas: 1, // The minimum fee per blob gas
    kzgPointEvaluationPrecompileGas: 50000, // The fee associated with the point evaluation precompile
    blobhashGas: 3, // Base fee of the BLOBHASH opcode
    // sharding
    blobCommitmentVersionKzg: 1, // The number indicated a versioned hash is a KZG commitment
    fieldElementsPerBlob: 4096, // The number of field elements allowed per blob
  },
  /**
.  * Beacon chain push withdrawals as operations
.  */
  4895: {},
  /**
   * Delaying Difficulty Bomb to mid-September 2022
   */
  5133: {
    // pow
    difficultyBombDelay: 11400000, // the amount of blocks to delay the difficulty bomb with
  },
  /**
   * EOF - Stack Validation
   */
  5450: {},
  /**
   * MCOPY - Memory copying instruction
   */
  5656: {
    // gasPrices
    mcopyGas: 3, // Base fee of the MCOPY opcode
  },
  /**
.  * Supply validator deposits on chain
.  */
  6110: {},
  /**
   * EOF - JUMPF and non-returning functions
   */
  6206: {
    // gasPrices
    jumpfGas: 5, // Base fee of the JUMPF opcode
  },
  /**
.  * SELFDESTRUCT only in same transaction
.  */
  6780: {},
  /**
   * Ethereum state using a unified verkle tree (experimental)
   */
  6800: {
    // gasPrices
    createGas: 1000, // Base fee of the CREATE opcode
    coldsloadGas: 0, // Gas cost of the first read of storage from a given location (per transaction)
    // vm
    // kaustinen 6 current uses this address, however this will be updated to correct address
    // in next iteration
    historyStorageAddress: BigInt('0xfffffffffffffffffffffffffffffffffffffffe'), // The address where the historical blockhashes are stored
  },
  /**
   * Execution layer triggerable withdrawals (experimental)
   */
  7002: {
    // vm
    withdrawalRequestType: BigInt(0x01), // The withdrawal request type for EIP-7685
    excessWithdrawalsRequestStorageSlot: BigInt(0), // The storage slot of the excess withdrawals
    withdrawalsRequestCountStorage: BigInt(1), // The storage slot of the withdrawal request count
    withdrawalsRequestQueueHeadStorageSlot: BigInt(2), // The storage slot of the withdrawal request head of the queue
    withdrawalsRequestTailHeadStorageSlot: BigInt(3), // The storage slot of the withdrawal request tail of the queue
    withdrawalsRequestQueueStorageOffset: BigInt(4), // The storage slot of the withdrawal request queue offset
    maxWithdrawalRequestsPerBlock: BigInt(16), // The max withdrawal requests per block
    targetWithdrawalRequestsPerBlock: BigInt(2), // The target withdrawal requests per block
    minWithdrawalRequestFee: BigInt(1), // The minimum withdrawal request fee (in wei)
    withdrawalRequestFeeUpdateFraction: BigInt(17), // The withdrawal request fee update fraction (used in the fake exponential)
    systemAddress: BigInt('0xfffffffffffffffffffffffffffffffffffffffe'), // The system address to perform operations on the withdrawal requests predeploy address
    withdrawalRequestPredeployAddress: BigInt('0x00A3ca265EBcb825B45F985A16CEFB49958cE017'), // Address of the validator excess address
  },
  /**
.  * Revamped CALL instructions
.  */
  7069: {
    /* Note: per EIP these are the additionally required EIPs:
      EIP 150 - This is the entire Tangerine Whistle hardfork
      EIP 211 - (RETURNDATASIZE / RETURNDATACOPY) - Included in Byzantium
      EIP 214 - (STATICCALL) - Included in Byzantium
    */
    // gasPrices
    extcallGas: 0, // Base fee of the EXTCALL opcode
    extdelegatecallGas: 0, // Base fee of the EXTDELEGATECALL opcode
    extstaticcallGas: 0, // Base fee of the EXTSTATICCALL opcode
    returndataloadGas: 3, // Base fee of the RETURNDATALOAD opcode
    minRetainedGas: 5000, // Minimum gas retained prior to executing an EXT*CALL opcode (this is the minimum gas available after performing the EXT*CALL)
    minCalleeGas: 2300, //Minimum gas available to the the address called by an EXT*CALL opcode
  },
  /**
   * Increase the MAX_EFFECTIVE_BALANCE -> Execution layer triggered consolidations (experimental)
   */
  7251: {
    // vm
    consolidationRequestType: BigInt(0x02), // The withdrawal request type for EIP-7685
    systemAddress: BigInt('0xfffffffffffffffffffffffffffffffffffffffe'), // The system address to perform operations on the consolidation requests predeploy address
    consolidationRequestPredeployAddress: BigInt('0x00b42dbF2194e931E80326D950320f7d9Dbeac02'), // Address of the consolidations contract
  },
  /**
   * EOF - Data section access instructions
   */
  7480: {
    // gasPrices
    dataloadGas: 4, // Base fee of the DATALOAD opcode
    dataloadnGas: 3, // Base fee of the DATALOADN opcode
    datasizeGas: 2, // Base fee of the DATASIZE opcode
    datacopyGas: 3, // Base fee of the DATACOPY opcode
  },
  /**
.  * BLOBBASEFEE opcode
.  */
  7516: {
    // gasPrices
    blobbasefeeGas: 2, // Gas cost of the BLOBBASEFEE opcode
  },
  /**
.  * EOF Contract Creation
.  */
  7620: {
    /* Note: per EIP these are the additionally required EIPs:
      EIP 170 - (Max contract size) - Included in Spurious Dragon
    */
    // gasPrices
    eofcreateGas: 32000, // Base fee of the EOFCREATE opcode (Same as CREATE/CREATE2)
    returncontractGas: 0, // Base fee of the RETURNCONTRACT opcode
  },
  /**
.  * General purpose execution layer requests
.  */
  7685: {},
  /**
   * EVM Object Format (EOFv1) Meta
   */
  7692: {},
  /**
   * EOF - Creation transaction
   */
  7698: {},
  /**
.  * Set EOA account code for one transaction
.  */
  7702: {
    // TODO: Set correct minimum hardfork
    // gasPrices
    perAuthBaseGas: 2500, // Gas cost of each authority item
  },
  /**
.  * Use historical block hashes saved in state for BLOCKHASH
.  */
  7709: {},
}
