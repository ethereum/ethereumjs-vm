import { Chain, Common, Hardfork } from '@ethereumjs/common'
import * as path from 'path'

/**
 * Default tests path (git submodule: ethereum-tests)
 */
export const DEFAULT_TESTS_PATH = path.resolve('../ethereum-tests')

/**
 * Default hardfork rules to run tests against
 */
export const DEFAULT_FORK_CONFIG = 'Paris'

/**
 * Tests which should be fixed
 */
export const SKIP_BROKEN = [
  'ForkStressTest', // Only BlockchainTest, temporary till fixed (2020-05-23)
  'ChainAtoChainB', // Only BlockchainTest, temporary, along expectException fixes (2020-05-23)

  // In these tests, we have access to two forked chains. Their total difficulty is equal. There are errors in the second chain, but we have no reason to execute this chain if the TD remains equal.
  'blockChainFrontierWithLargerTDvsHomesteadBlockchain2_FrontierToHomesteadAt5',
  'blockChainFrontierWithLargerTDvsHomesteadBlockchain_FrontierToHomesteadAt5',
  'HomesteadOverrideFrontier_FrontierToHomesteadAt5',
]

/**
 * Tests skipped due to system specifics / design considerations
 */
export const SKIP_PERMANENT = [
  'SuicidesMixingCoinbase', // suicides to the coinbase, since we run a blockLevel we create coinbase account.
  'static_SuicidesMixingCoinbase', // suicides to the coinbase, since we run a blockLevel we create coinbase account.
  'ForkUncle', // Only BlockchainTest, correct behavior unspecified (?)
  'UncleFromSideChain', // Only BlockchainTest, same as ForkUncle, the TD is the same for two different branches so its not clear which one should be the finally chain
]

/**
 * tests running slow (run from time to time)
 */
export const SKIP_SLOW = [
  'Call50000_sha256',
  'static_Call50000',
  'static_Call50000_ecrec',
  'static_Call50000_identity',
  'static_Call50000_identity2',
  'static_Call50000_rip160',
  'static_Return50000_2',
  'Return50000',
  'Return50000_2',
  'static_Call50000_sha256',
  'CALLBlake2f_MaxRounds',
  // vmPerformance tests
  'loopMul',
  'loopExp',
]

/**
 * VMTests have been deprecated, see https://github.com/ethereum/tests/issues/593
 * skipVM test list is currently not used but might be useful in the future since VMTests
 * have now been converted to BlockchainTests, see https://github.com/ethereum/tests/pull/680
 * Disabling this due to ESLint, but will keep it here for possible future reference
 */
/*const SKIP_VM = [
  // slow performance tests
  'loop-mul',
  'loop-add-10M',
  'loop-divadd-10M',
  'loop-divadd-unr100-10M',
  'loop-exp-16b-100k',
  'loop-exp-1b-1M',
  'loop-exp-2b-100k',
  'loop-exp-32b-100k',
  'loop-exp-4b-100k',
  'loop-exp-8b-100k',
  'loop-exp-nop-1M',
  'loop-mulmod-2M',
  'ABAcalls0',
  'ABAcallsSuicide0',
  'ABAcallsSuicide1',
  'sha3_bigSize',
  'CallRecursiveBomb0',
  'CallToNameRegistrator0',
  'CallToPrecompiledContract',
  'CallToReturn1',
  'PostToNameRegistrator0',
  'PostToReturn1',
  'callcodeToNameRegistrator0',
  'callcodeToReturn1',
  'callstatelessToNameRegistrator0',
  'callstatelessToReturn1',
  'createNameRegistrator',
  'randomTest643',
]*/

/**
 * Returns an alias for specified hardforks to meet test dependencies requirements/assumptions.
 * @param {String} forkConfig - the name of the hardfork for which an alias should be returned
 * @returns {String} Either an alias of the forkConfig param, or the forkConfig param itself
 */
export function getRequiredForkConfigAlias(forkConfig: string) {
  const indexOfPlus = forkConfig.indexOf('+')
  const remainder = indexOfPlus !== -1 ? forkConfig.substring(indexOfPlus) : ''
  // Chainstart is also called Frontier and is called as such in the tests
  if (String(forkConfig).match(/^chainstart$/i)) {
    return 'Frontier' + remainder
  }
  // TangerineWhistle is named EIP150 (attention: misleading name)
  // in the client-independent consensus test suite
  if (String(forkConfig).match(/^tangerineWhistle$/i)) {
    return 'EIP150' + remainder
  }
  // SpuriousDragon is named EIP158 (attention: misleading name)
  // in the client-independent consensus test suite
  if (String(forkConfig).match(/^spuriousDragon$/i)) {
    return 'EIP158' + remainder
  }
  // Run the Istanbul tests for MuirGlacier since there are no dedicated tests
  if (String(forkConfig).match(/^muirGlacier/i)) {
    return 'Istanbul' + remainder
  }
  // Petersburg is named ConstantinopleFix
  // in the client-independent consensus test suite
  if (String(forkConfig).match(/^petersburg$/i)) {
    return 'ConstantinopleFix' + remainder
  }
  // Paris is named Merge
  if (String(forkConfig).match(/^paris/i)) {
    return 'Merge' + remainder
  }
  return forkConfig
}

export const normalHardforks = [
  'chainstart',
  'homestead',
  'dao',
  'tangerineWhistle',
  'spuriousDragon',
  'byzantium',
  'constantinople',
  'petersburg',
  'istanbul',
  'muirGlacier',
  'berlin',
  'london',
  'paris',
  'shanghai',
  'arrowGlacier', // This network has no tests, but need to add it due to common generation logic
  'cancun',
]

export const transitionNetworks = {
  ArrowGlacierToMergeAtDiffC0000: {
    arrowGlacier: 0,
    paris: 8,
    dao: null,
    finalSupportedFork: 'paris',
    startFork: 'arrowGlacier',
  },
  ByzantiumToConstantinopleFixAt5: {
    byzantium: 0,
    constantinople: 5,
    petersburg: 5,
    dao: null,
    finalSupportedFork: 'petersburg',
    startFork: 'byzantium',
  },
  EIP158ToByzantiumAt5: {
    spuriousDragon: 0,
    byzantium: 5,
    dao: null,
    finalSupportedFork: 'byzantium',
    startFork: 'spuriousDragon',
  },
  FrontierToHomesteadAt5: {
    chainstart: 0,
    homestead: 5,
    dao: null,
    finalSupportedFork: 'homestead',
    startFork: 'chainstart',
  },
  HomesteadToDaoAt5: {
    homestead: 0,
    dao: 5,
    finalSupportedFork: 'dao',
    startFork: 'homestead',
  },
  HomesteadToEIP150At5: {
    homestead: 0,
    tangerineWhistle: 5,
    dao: null,
    finalSupportedFork: 'tangerineWhistle',
    startFork: 'homestead',
  },
  BerlinToLondonAt5: {
    berlin: 0,
    london: 5,
    dao: null,
    finalSupportedFork: 'london',
    startFork: 'berlin',
  },
}

const retestethAlias = {
  Frontier: 'chainstart',
  EIP150: 'tangerineWhistle',
  EIP158: 'spuriousDragon',
  ConstantinopleFix: 'petersburg',
  Merge: 'paris',
}

export const testLegacy = {
  chainstart: true,
  homestead: true,
  tangerineWhistle: true,
  spuriousDragon: true,
  byzantium: true,
  constantinople: true,
  petersburg: true,
  istanbul: false,
  muirGlacier: false,
  berlin: false,
  london: false,
  paris: false,
  ByzantiumToConstantinopleFixAt5: false,
  EIP158ToByzantiumAt5: false,
  FrontierToHomesteadAt5: false,
  HomesteadToDaoAt5: false,
  HomesteadToEIP150At5: false,
  BerlinToLondonAt5: false,
}

/**
 * Returns an array of dirs to run tests on
 * @param network (fork identifier)
 * @param testType (BlockchainTests/StateTests)
 */
export function getTestDirs(network: string, testType: string) {
  const testDirs = [testType]
  for (const key in testLegacy) {
    if (
      key.toLowerCase() === network.toLowerCase() &&
      testLegacy[key as keyof typeof testLegacy] === true
    ) {
      // Tests for HFs before Istanbul have been moved under `LegacyTests/Constantinople`:
      // https://github.com/ethereum/tests/releases/tag/v7.0.0-beta.1
      testDirs.push('LegacyTests/Constantinople/' + testType)
      break
    }
  }
  return testDirs
}

export function inferHardfork(network: string) {
  let networkLowercase: string // This only consists of the target hardfork, so without the EIPs
  if (network.includes('+')) {
    const index = network.indexOf('+')
    networkLowercase = network.slice(0, index).toLowerCase()
  } else {
    networkLowercase = network.toLowerCase()
  }
  // normal hard fork, return the common with this hard fork
  // find the right upper/lowercased version
  const hfName = normalHardforks.reduce((previousValue, currentValue) =>
    currentValue.toLowerCase() === networkLowercase ? currentValue : previousValue
  )
  return hfName
}
/**
 * Setups the common with networks
 * @param network Network target (this can include EIPs, such as Byzantium+2537+2929)
 * @param ttd If set: total terminal difficulty to switch to merge
 * @returns
 */
export function setupCommonWithNetworks(network: string, ttd?: number, timestamp?: number): Common {
  // normal hard fork, return the common with this hard fork
  // find the right upper/lowercased version
  const hfName = inferHardfork(network)
  const mainnetCommon = new Common({ chain: Chain.Mainnet, hardfork: hfName })
  const hardforks = mainnetCommon.hardforks()
  const testHardforks = []
  for (const hf of hardforks) {
    // check if we enable this hf
    // disable dao hf by default (if enabled at block 0 forces the first 10 blocks to have dao-hard-fork in extraData of block header)
    if (mainnetCommon.gteHardfork(hf.name) === true && hf.name !== Hardfork.Dao) {
      // this hardfork should be activated at block 0
      testHardforks.push({
        name: hf.name,
        // Current type definition Partial<Chain> in Common is currently not allowing to pass in forkHash
        // forkHash: hf.forkHash,
        block: 0,
      })
    } else {
      // disable hardforks newer than the test hardfork (but do add "support" for it, it just never gets activated)
      if (ttd === undefined) {
        testHardforks.push({
          name: hf.name,
          //forkHash: hf.forkHash,
          block: null,
        })
      } else if (hf.name === 'paris') {
        // merge will currently always be after a hardfork, so add it here
        testHardforks.push({
          name: hf.name,
          block: null,
          ttd: BigInt(ttd),
        })
      }
      if (timestamp !== undefined && hf.name !== Hardfork.Dao) {
        testHardforks.push({
          name: hf.name,
          block: null,
          timestamp,
        })
      }
    }
  }
  const common = Common.custom(
    {
      hardforks: testHardforks,
      defaultHardfork: hfName,
    },
    { eips: [3607] }
  )
  // Activate EIPs
  const eips = network.match(/(?<=\+)(.\d+)/g)
  if (eips) {
    common.setEIPs(eips.map((e: string) => parseInt(e)))
  }
  return common
}

/**
 * Returns a Common for the given network (a test parameter)
 * @param network - the network field of a test.
 * If this network has a `+` sign, it will also include these EIPs.
 * For instance, London+3855 will activate the network on the London hardfork, but will also activate EIP 3855.
 * Multiple EIPs can also be activated by separating them with a `+` sign.
 * For instance, "London+3855+3860" will also activate EIP-3855 and EIP-3860.
 * @returns the Common which should be used
 */
export function getCommon(network: string): Common {
  if (retestethAlias[network as keyof typeof retestethAlias] !== undefined) {
    network = retestethAlias[network as keyof typeof retestethAlias]
  }
  let networkLowercase = network.toLowerCase()
  if (network.includes('+')) {
    const index = network.indexOf('+')
    networkLowercase = network.slice(0, index).toLowerCase()
  }
  if (normalHardforks.map((str) => str.toLowerCase()).includes(networkLowercase)) {
    // Case 1: normal network, such as "London" or "Byzantium" (without any EIPs enabled, and it is not a transition network)
    return setupCommonWithNetworks(network)
  } else if (networkLowercase.match('tomergeatdiff')) {
    // Case 2: special case of a transition network, this setups the right common with the right Merge properties (TTD)
    // This is a HF -> Merge transition
    const start = networkLowercase.match('tomergeatdiff')!.index!
    const end = start + 'tomergeatdiff'.length
    const startNetwork = network.substring(0, start) // HF before the merge
    const TTD = Number('0x' + network.substring(end)) // Total difficulty to transition to PoS
    return setupCommonWithNetworks(startNetwork, TTD)
  } else if (networkLowercase === 'shanghaitocancunattime15k') {
    return setupCommonWithNetworks('Shanghai', undefined, 15000)
  } else {
    // Case 3: this is not a "default fork" network, but it is a "transition" network. Test the VM if it transitions the right way
    const transitionForks =
      network in transitionNetworks
        ? transitionNetworks[network as keyof typeof transitionNetworks]
        : transitionNetworks[
            (network.charAt(0).toUpperCase() + network.slice(1)) as keyof typeof transitionNetworks
          ]
    if (transitionForks === undefined) {
      throw new Error('network not supported: ' + network)
    }
    const mainnetCommon = new Common({
      chain: Chain.Mainnet,
      hardfork: transitionForks.finalSupportedFork,
    })
    const hardforks = mainnetCommon.hardforks()
    const testHardforks = []
    for (const hf of hardforks) {
      if (mainnetCommon.gteHardfork(hf.name) === true) {
        // this hardfork should be activated at block 0
        const forkBlockNumber = transitionForks[hf.name as keyof typeof transitionForks] as
          | number
          | null
          | undefined
        testHardforks.push({
          name: hf.name,
          block: forkBlockNumber ?? 0, // If hardfork isn't in transitionForks, activate at 0
        })
      } else {
        // disable the hardfork
        testHardforks.push({
          name: hf.name,
          block: null,
        })
      }
    }
    return Common.custom(
      {
        hardforks: testHardforks,
      },
      {
        baseChain: 'mainnet',
        hardfork: transitionForks.startFork,
        eips: [3607],
      }
    )
  }
}

const expectedTestsFull: {
  BlockchainTests: Record<string, number | undefined>
  GeneralStateTests: Record<string, number | undefined>
} = {
  BlockchainTests: {
    Chainstart: 4496,
    Homestead: 7321,
    Dao: 0,
    TangerineWhistle: 4609,
    SpuriousDragon: 4632,
    Byzantium: 15703,
    Constantinople: 33146,
    Petersburg: 33128,
    Istanbul: 38773,
    MuirGlacier: 38773,
    Berlin: 41365,
    London: 61197,
    ArrowGlacier: 0,
    Paris: 60373,
    Shanghai: 61563,
    ByzantiumToConstantinopleFixAt5: 3,
    EIP158ToByzantiumAt5: 3,
    FrontierToHomesteadAt5: 13,
    HomesteadToDaoAt5: 32,
    HomesteadToEIP150At5: 3,
    BerlinToLondonAt5: 24,
  },
  GeneralStateTests: {
    Chainstart: 1045,
    Homestead: 2078,
    Dao: 0,
    TangerineWhistle: 1200,
    SpuriousDragon: 1325,
    Byzantium: 4857,
    Constantinople: 10648,
    Petersburg: 10642,
    Istanbul: 12439,
    MuirGlacier: 12439,
    Berlin: 13214,
    London: 19449,
    Paris: 19598,
    Shanghai: 19564,
    ByzantiumToConstantinopleFixAt5: 0,
    EIP158ToByzantiumAt5: 0,
    FrontierToHomesteadAt5: 0,
    HomesteadToDaoAt5: 0,
    HomesteadToEIP150At5: 0,
    BerlinToLondonAt5: 0,
  },
}

/**
 * Returns the amount of expected tests for a given fork, assuming all tests are ran
 */
export function getExpectedTests(
  fork: string,
  name: 'BlockchainTests' | 'GeneralStateTests'
): number | undefined {
  if (expectedTestsFull[name] === undefined) {
    return
  }
  for (const key in expectedTestsFull[name]) {
    if (fork.toLowerCase() === key.toLowerCase()) {
      return expectedTestsFull[name][key]
    }
  }
}

/**
 * Returns an aggregated array with the tests to skip
 * @param choices comma-separated list with skip options, e.g. BROKEN,PERMANENT
 * @param defaultChoice if to use `NONE` or `ALL` as default choice
 * @returns array with test names
 */
export function getSkipTests(choices: string, defaultChoice: string): string[] {
  let skipTests: string[] = []
  if (!choices) {
    choices = defaultChoice
  }
  choices = choices.toLowerCase()
  if (choices !== 'none') {
    const choicesList = choices.split(',')
    const all = choicesList.includes('all')
    if (all || choicesList.includes('broken')) {
      skipTests = skipTests.concat(SKIP_BROKEN)
    }
    if (all || choicesList.includes('permanent')) {
      skipTests = skipTests.concat(SKIP_PERMANENT)
    }
    if (all || choicesList.includes('slow')) {
      skipTests = skipTests.concat(SKIP_SLOW)
    }
  }
  return skipTests
}
