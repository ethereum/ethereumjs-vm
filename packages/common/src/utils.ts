import { intToHex, isHexString, stripHexPrefix } from '@ethereumjs/util'

import { Holesky, Kaustinen6, Mainnet, Sepolia } from './chains.js'
import { Hardfork } from './enums.js'

import type { PrefixedHexString } from '@ethereumjs/util'

type ConfigHardfork =
  | { name: string; block: null; timestamp: number }
  | { name: string; block: number; timestamp?: number }
/**
 * Transforms Geth formatted nonce (i.e. hex string) to 8 byte 0x-prefixed string used internally
 * @param nonce string parsed from the Geth genesis file
 * @returns nonce as a 0x-prefixed 8 byte string
 */
function formatNonce(nonce: string): PrefixedHexString {
  if (!nonce || nonce === '0x0') {
    return '0x0000000000000000'
  }
  if (isHexString(nonce)) {
    return `0x${stripHexPrefix(nonce).padStart(16, '0')}`
  }
  return `0x${nonce.padStart(16, '0')}`
}

/**
 * Converts Geth genesis parameters to an EthereumJS compatible `CommonOpts` object
 * @param json object representing the Geth genesis file
 * @returns genesis parameters in a `CommonOpts` compliant object
 */
function parseGethParams(json: any) {
  const {
    name,
    config,
    difficulty,
    mixHash,
    gasLimit,
    coinbase,
    baseFeePerGas,
    excessBlobGas,
    requestsHash,
    extraData: unparsedExtraData,
    nonce: unparsedNonce,
    timestamp: unparsedTimestamp,
  }: {
    name: string
    config: any
    difficulty: PrefixedHexString
    mixHash: PrefixedHexString
    gasLimit: PrefixedHexString
    coinbase: PrefixedHexString
    baseFeePerGas: PrefixedHexString
    excessBlobGas: PrefixedHexString
    requestsHash: PrefixedHexString
    extraData: string
    nonce: string
    timestamp: string
  } = json
  const genesisTimestamp = Number(unparsedTimestamp)
  const {
    chainId,
    depositContractAddress,
  }: { chainId: number; depositContractAddress: PrefixedHexString } = config

  // geth is not strictly putting empty fields with a 0x prefix
  const extraData: PrefixedHexString =
    unparsedExtraData === '' ? '0x' : (unparsedExtraData as PrefixedHexString)

  // geth may use number for timestamp
  const timestamp: PrefixedHexString = isHexString(unparsedTimestamp)
    ? unparsedTimestamp
    : intToHex(parseInt(unparsedTimestamp))

  // geth may not give us a nonce strictly formatted to an 8 byte 0x-prefixed hex string
  const nonce: PrefixedHexString =
    unparsedNonce.length !== 18 ? formatNonce(unparsedNonce) : (unparsedNonce as PrefixedHexString)

  // EIP155 and EIP158 are both part of Spurious Dragon hardfork and must occur at the same time
  // but have different configuration parameters in geth genesis parameters
  if (config.eip155Block !== config.eip158Block) {
    throw new Error(
      'EIP155 block number must equal EIP 158 block number since both are part of SpuriousDragon hardfork and the client only supports activating the full hardfork',
    )
  }

  // Terminal total difficulty logic is not supported any more as the merge has been completed
  // so the Merge/Paris hardfork block must be 0
  if (
    config.terminalTotalDifficulty !== undefined &&
    (BigInt(difficulty) < BigInt(config.terminalTotalDifficulty) ||
      config.terminalTotalDifficultyPassed === false)
  ) {
    throw new Error('nonzero terminal total difficulty is not supported')
  }

  const params = {
    name,
    chainId,
    depositContractAddress,
    genesis: {
      timestamp,
      gasLimit,
      difficulty,
      nonce,
      extraData,
      mixHash,
      coinbase,
      baseFeePerGas,
      excessBlobGas,
      requestsHash,
    },
    hardfork: undefined as string | undefined,
    hardforks: [] as ConfigHardfork[],
    bootstrapNodes: [],
    consensus:
      config.clique !== undefined
        ? {
            type: 'poa',
            algorithm: 'clique',
            clique: {
              // The recent geth genesis seems to be using blockperiodseconds // cspell:disable-line
              // and epochlength for clique specification
              // see: https://hackmd.io/PqZgMpnkSWCWv5joJoFymQ
              period: config.clique.period ?? config.clique.blockperiodseconds, // cspell:disable-line
              epoch: config.clique.epoch ?? config.clique.epochlength,
            },
          }
        : {
            type: 'pow',
            algorithm: 'ethash',
            ethash: {},
          },
  }

  const forkMap: { [key: string]: { name: string; postMerge?: boolean; isTimestamp?: boolean } } = {
    [Hardfork.Homestead]: { name: 'homesteadBlock' },
    [Hardfork.Dao]: { name: 'daoForkBlock' },
    [Hardfork.TangerineWhistle]: { name: 'eip150Block' },
    [Hardfork.SpuriousDragon]: { name: 'eip155Block' },
    [Hardfork.Byzantium]: { name: 'byzantiumBlock' },
    [Hardfork.Constantinople]: { name: 'constantinopleBlock' },
    [Hardfork.Petersburg]: { name: 'petersburgBlock' },
    [Hardfork.Istanbul]: { name: 'istanbulBlock' },
    [Hardfork.MuirGlacier]: { name: 'muirGlacierBlock' },
    [Hardfork.Berlin]: { name: 'berlinBlock' },
    [Hardfork.London]: { name: 'londonBlock' },
    [Hardfork.MergeForkIdTransition]: { name: 'mergeForkBlock', postMerge: true },
    [Hardfork.Shanghai]: { name: 'shanghaiTime', postMerge: true, isTimestamp: true },
    [Hardfork.Cancun]: { name: 'cancunTime', postMerge: true, isTimestamp: true },
    [Hardfork.Prague]: { name: 'pragueTime', postMerge: true, isTimestamp: true },
    [Hardfork.Verkle]: { name: 'verkleTime', postMerge: true, isTimestamp: true },
    [Hardfork.EVMMax]: { name: 'evmmaxTime', postMerge: true, isTimestamp: true },
  }

  // forkMapRev is the map from config field name to Hardfork
  const forkMapRev = Object.keys(forkMap).reduce(
    (acc, elem) => {
      acc[forkMap[elem].name] = elem
      return acc
    },
    {} as { [key: string]: string },
  )
  const configHardforkNames = Object.keys(config).filter(
    (key) => forkMapRev[key] !== undefined && config[key] !== undefined && config[key] !== null,
  )

  params.hardforks = configHardforkNames
    .map((nameBlock) => ({
      name: forkMapRev[nameBlock],
      block:
        forkMap[forkMapRev[nameBlock]].isTimestamp === true || typeof config[nameBlock] !== 'number'
          ? null
          : config[nameBlock],
      timestamp:
        forkMap[forkMapRev[nameBlock]].isTimestamp === true && typeof config[nameBlock] === 'number'
          ? config[nameBlock]
          : undefined,
    }))
    .filter((fork) => fork.block !== null || fork.timestamp !== undefined) as ConfigHardfork[]

  params.hardforks.sort(function (a: ConfigHardfork, b: ConfigHardfork) {
    return (a.block ?? Infinity) - (b.block ?? Infinity)
  })

  params.hardforks.sort(function (a: ConfigHardfork, b: ConfigHardfork) {
    // non timestamp forks come before any timestamp forks
    return (a.timestamp ?? 0) - (b.timestamp ?? 0)
  })

  // only set the genesis timestamp forks to zero post the above sort has happened
  // to get the correct sorting
  for (const hf of params.hardforks) {
    if (hf.timestamp === genesisTimestamp) {
      hf.timestamp = 0
    }
  }

  if (config.terminalTotalDifficulty !== undefined) {
    // Merge fork must be placed at 0 since ttd logic is no longer supported
    const mergeConfig = {
      name: Hardfork.Paris,
      block: 0,
      timestamp: undefined,
    }

    // Merge hardfork has to be placed before first hardfork that is dependent on merge
    const postMergeIndex = params.hardforks.findIndex(
      (hf: any) => forkMap[hf.name]?.postMerge === true,
    )
    if (postMergeIndex !== -1) {
      params.hardforks.splice(postMergeIndex, 0, mergeConfig as unknown as ConfigHardfork)
    } else {
      params.hardforks.push(mergeConfig as unknown as ConfigHardfork)
    }
  }

  const latestHardfork = params.hardforks.length > 0 ? params.hardforks.slice(-1)[0] : undefined
  params.hardfork = latestHardfork?.name
  params.hardforks.unshift({ name: Hardfork.Chainstart, block: 0 })

  return params
}

/**
 * Parses a genesis.json exported from Geth into parameters for Common instance
 * @param json representing the Geth genesis file
 * @param name optional chain name
 * @returns parsed params
 */
export function parseGethGenesis(json: any, name?: string) {
  try {
    const required = ['config', 'difficulty', 'gasLimit', 'nonce', 'alloc']
    if (required.some((field) => !(field in json))) {
      const missingField = required.filter((field) => !(field in json))
      throw new Error(`Invalid format, expected geth genesis field "${missingField}" missing`)
    }

    // We copy the JSON object here because it's frozen in browser and properties can't be modified
    const finalJSON = { ...json }

    if (name !== undefined) {
      finalJSON.name = name
    }
    return parseGethParams(finalJSON)
  } catch (e: any) {
    throw new Error(`Error parsing parameters file: ${e.message}`)
  }
}

/**
 * Return the preset chain config for one of the predefined chain configurations
 * @param chain the representing a network name (e.g. 'mainnet') or number representing the chain ID
 * @returns a {@link ChainConfig}
 */
export const getPresetChainConfig = (chain: string | number) => {
  switch (chain) {
    case 'holesky':
    case 17000:
      return Holesky
    case 'kaustinen6':
    case 69420:
      return Kaustinen6
    case 'sepolia':
    case 11155111:
      return Sepolia
    case 'mainnet':
    case 1:
    default:
      return Mainnet
  }
}
