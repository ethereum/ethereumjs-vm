import type { ParamsDict } from '@ethereumjs/common'

export const paramsEVM: ParamsDict = {
  /**
   * Frontier/Chainstart
   */
  1: {
    // gasConfig
    maxRefundQuotient: 2, // Maximum refund quotient; max tx refund is min(tx.gasUsed/maxRefundQuotient, tx.gasRefund)
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
    callValueTransferGas: 9000, // Paid for CALL when the value transfer is non-zero
    callNewAccountGas: 25000, // Paid for CALL when the destination address didn't exist prior
    selfdestructRefundGas: 24000, // Refunded following a selfdestruct operation
    memoryGas: 3, // Times the address of the (highest referenced byte in memory + 1). NOTE: referencing happens on read, write and in instructions such as RETURN and CALL
    quadCoefficientDivGas: 512, // Divisor for the quadratic particle of the memory cost equation
    createDataGas: 200, //
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
    prevrandaoGas: 0, // TODO: these below 0-gas additions might also point to non-clean implementations in the code base
    // evm
    stackLimit: 1024, // Maximum size of VM stack allowed
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
    // evm
    maxCodeSize: 24576, // Maximum length of contract code
  },
  /**
.  * Byzantium HF Meta EIP
.  */
  609: {
    // gasPrices
    modexpGquaddivisorGas: 20, // Gquaddivisor from modexp precompile for gas calculation
    bn254AddGas: 500, // Gas costs for curve addition precompile
    bn254MulGas: 40000, // Gas costs for curve multiplication precompile
    bn254PairingGas: 100000, // Base gas costs for curve pairing precompile
    bn254PairingWordGas: 80000, // Gas costs regarding curve pairing precompile input length
    revertGas: 0, // Base fee of the REVERT opcode
    staticcallGas: 700, // Base fee of the STATICCALL opcode
    returndatasizeGas: 2, // Base fee of the RETURNDATASIZE opcode
    returndatacopyGas: 3, // Base fee of the RETURNDATACOPY opcode
  },
  /**
.  * Constantinople HF Meta EIP
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
    bn254AddGas: 150, // Gas costs for curve addition precompile
    bn254MulGas: 6000, // Gas costs for curve multiplication precompile
    bn254PairingGas: 45000, // Base gas costs for curve pairing precompile
    bn254PairingWordGas: 34000, // Gas costs regarding curve pairing precompile input length
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
  1559: {
    elasticityMultiplier: 2, // Maximum block gas target elasticity
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
    bls12381G1AddGas: 375, // Gas cost of a single BLS12-381 G1 addition precompile-call
    bls12381G1MulGas: 12000, // Gas cost of a single BLS12-381 G1 multiplication precompile-call
    bls12381G2AddGas: 600, // Gas cost of a single BLS12-381 G2 addition precompile-call
    bls12381G2MulGas: 22500, // Gas cost of a single BLS12-381 G2 multiplication precompile-call
    bls12381PairingBaseGas: 37700, // Base gas cost of BLS12-381 pairing check
    bls12381PairingPerPairGas: 32600, // Per-pair gas cost of BLS12-381 pairing check
    bls12381MapG1Gas: 5500, // Gas cost of BLS12-381 map field element to G1
    bls12381MapG2Gas: 23800, // Gas cost of BLS12-381 map field element to G2
  },
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
   * Save historical block hashes in state (Verkle related usage, UNSTABLE)
   */
  2935: {
    // evm
    historyStorageAddress: '0x0000F90827F1C53A10CB7A02335B175320002935', // The address where the historical blockhashes are stored
    historyServeWindow: 8192, // The amount of blocks to be served by the historical blockhash contract
    systemAddress: '0xfffffffffffffffffffffffffffffffffffffffe', // The system address
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
.  * Shard Blob Transactions
.  */
  4844: {
    kzgPointEvaluationPrecompileGas: 50000, // The fee associated with the point evaluation precompile
    blobhashGas: 3, // Base fee of the BLOBHASH opcode
    // sharding
    blobCommitmentVersionKzg: 1, // The number indicated a versioned hash is a KZG commitment
    fieldElementsPerBlob: 4096, // The number of field elements allowed per blob
  },
  /**
   * MCOPY - Memory copying instruction
   */
  5656: {
    // gasPrices
    mcopyGas: 3, // Base fee of the MCOPY opcode
  },
  /**
   * EOF - JUMPF and non-returning functions
   */
  6206: {
    // gasPrices
    jumpfGas: 5, // Base fee of the JUMPF opcode
  },
  /**
   * Ethereum state using a unified verkle tree (experimental)
   */
  6800: {
    // gasPrices
    createGas: 1000, // Base fee of the CREATE opcode
    coldsloadGas: 0, // Gas cost of the first read of storage from a given location (per transaction)
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
  9999: {
    /* Not an actual EIP, but a placeholder for future EXECUTE precompile EIP */
    // gasPrices
    executeGasCost: 50000,
    executeCumulativeGasLimit: 10000000,
    executeCumulativeGasTarget: 100000,
  },
}
