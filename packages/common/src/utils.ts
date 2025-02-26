import { EthereumJSErrorWithoutCode, intToHex, isHexString, stripHexPrefix } from '@ethereumjs/util'

import { Holesky, Kaustinen6, Mainnet, Sepolia } from './chains.js'
import { Hardfork } from './enums.js'
import { hardforksDict } from './hardforks.js'

import type { HardforksDict } from './types.js'
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
    throw EthereumJSErrorWithoutCode(
      'EIP155 block number must equal EIP 158 block number since both are part of SpuriousDragon hardfork and the client only supports activating the full hardfork',
    )
  }

  let customHardforks: HardforksDict | undefined = undefined
  if (config.blobSchedule !== undefined) {
    customHardforks = {}
    const blobGasPerBlob = 131072
    for (const [hfKey, hfSchedule] of Object.entries(config.blobSchedule)) {
      const hfConfig = hardforksDict[hfKey]
      if (hfConfig === undefined) {
        throw EthereumJSErrorWithoutCode(`unknown hardfork=${hfKey} specified in blobSchedule`)
      }
      const {
        target,
        max,
        baseFeeUpdateFraction: blobGasPriceUpdateFraction,
      } = hfSchedule as { target?: number; max?: number; baseFeeUpdateFraction?: undefined }
      if (target === undefined || max === undefined || blobGasPriceUpdateFraction === undefined) {
        throw EthereumJSErrorWithoutCode(
          `undefined target, max or baseFeeUpdateFraction specified in blobSchedule for hardfork=${hfKey}`,
        )
      }

      // copy current hardfork info to custom and add blob config
      const customHfConfig = JSON.parse(JSON.stringify(hfConfig))
      customHfConfig.params = {
        ...customHardforks.params,
        // removes blobGasPriceUpdateFraction key to prevent undefined overriding if undefined
        ...{
          targetBlobGasPerBlock: blobGasPerBlob * target,
          maxBlobGasPerBlock: blobGasPerBlob * max,
          blobGasPriceUpdateFraction,
        },
      }

      customHardforks[hfKey] = customHfConfig
    }
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
    customHardforks,
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
    [Hardfork.ArrowGlacier]: { name: 'arrowGlacierBlock' },
    [Hardfork.GrayGlacier]: { name: 'grayGlacierBlock' },
    [Hardfork.Paris]: { name: 'mergeForkBlock', postMerge: true },
    [Hardfork.MergeNetsplitBlock]: { name: 'mergeNetsplitBlock', postMerge: true },
    [Hardfork.Shanghai]: { name: 'shanghaiTime', postMerge: true, isTimestamp: true },
    [Hardfork.Cancun]: { name: 'cancunTime', postMerge: true, isTimestamp: true },
    [Hardfork.Prague]: { name: 'pragueTime', postMerge: true, isTimestamp: true },
    [Hardfork.Verkle]: { name: 'verkleTime', postMerge: true, isTimestamp: true },
  }

  // forkMapRev is the map from config field name to Hardfork
  const forkMapRev = Object.keys(forkMap).reduce(
    (acc, elem) => {
      acc[forkMap[elem].name] = elem
      return acc
    },
    {} as { [key: string]: string },
  )

  params.hardforks = Object.entries(forkMapRev)
    .map(([nameBlock, hardfork]) => ({
      name: hardfork,
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
  const mergeIndex = params.hardforks.findIndex((hf) => hf.name === Hardfork.Paris)
  let mergeNetsplitBlockIndex = params.hardforks.findIndex(
    (hf) => hf.name === Hardfork.MergeNetsplitBlock,
  )
  const firstPostMergeHFIndex = params.hardforks.findIndex(
    (hf) => hf.timestamp !== undefined && hf.timestamp !== null,
  )

  // If we are missing a mergeNetsplitBlock, we assume it is at the same block as Paris (if present)
  if (mergeIndex !== -1 && mergeNetsplitBlockIndex === -1) {
    params.hardforks.splice(mergeIndex + 1, 0, {
      name: Hardfork.MergeNetsplitBlock,
      block: params.hardforks[mergeIndex].block!,
    })
    mergeNetsplitBlockIndex = mergeIndex + 1
  }
  // or zero if not and a postmerge hardfork is set (since testnets using the geth genesis format are all currently start postmerge)
  if (firstPostMergeHFIndex !== -1) {
    if (mergeNetsplitBlockIndex === -1) {
      params.hardforks.splice(firstPostMergeHFIndex, 0, {
        name: Hardfork.MergeNetsplitBlock,
        block: 0,
      })
      mergeNetsplitBlockIndex = firstPostMergeHFIndex
    }
    if (mergeIndex === -1) {
      // If we don't have a Paris hardfork, add it at the mergeNetsplitBlock
      params.hardforks.splice(mergeNetsplitBlockIndex, 0, {
        name: Hardfork.Paris,
        block: params.hardforks[mergeNetsplitBlockIndex].block!,
      })
    }
    // Check for terminalTotalDifficultyPassed param in genesis config if no post merge hardforks are set
  } else if (config.terminalTotalDifficultyPassed === true) {
    if (mergeIndex === -1) {
      // If we don't have a Paris hardfork, add it at end of hardfork array
      params.hardforks.push({
        name: Hardfork.Paris,
        block: 0,
      })
    }
    // If we don't have a MergeNetsplitBlock hardfork, add it at end of hardfork array
    if (mergeNetsplitBlockIndex === -1) {
      params.hardforks.push({
        name: Hardfork.MergeNetsplitBlock,
        block: 0,
      })
      mergeNetsplitBlockIndex = firstPostMergeHFIndex
    }
  }

  // TODO: Decide if we actually need to do this since `ForkMap` specifies the order we expect things in
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
      throw EthereumJSErrorWithoutCode(
        `Invalid format, expected geth genesis field "${missingField}" missing`,
      )
    }

    // We copy the JSON object here because it's frozen in browser and properties can't be modified
    const finalJSON = { ...json }

    if (name !== undefined) {
      finalJSON.name = name
    }
    return parseGethParams(finalJSON)
  } catch (e: any) {
    throw EthereumJSErrorWithoutCode(`Error parsing parameters file: ${e.message}`)
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
