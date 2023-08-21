import { assert, describe, expect, it, suite } from 'vitest'

import {
  DEFAULT_FORK_CONFIG,
  DEFAULT_TESTS_PATH,
  SKIP_BROKEN,
  SKIP_PERMANENT,
  SKIP_SLOW,
  getCommon,
  getRequiredForkConfigAlias,
  getSkipTests,
  getTestDirs,
  inferHardfork,
  normalHardforks,
  setupCommonWithNetworks,
  testLegacy,
  transitionNetworks,
} from './config'

suite('tester unit test', async () => {
  describe('defaults & constants', async () => {
    const expected = '/packages/ethereum-tests'
    const defaultTestPath = DEFAULT_TESTS_PATH.slice(-expected.length)
    const defaultFork = DEFAULT_FORK_CONFIG
    it(`should produce correct path to tests` + expected, async () => {
      expect(defaultTestPath.toLowerCase()).toEqual(expected)
      expect(defaultFork.toLowerCase()).toEqual('paris')
    })
  })
  describe('getRequiredForkConfigAlias', async () => {
    const alternateNames: Record<string, string> = {
      chainstart: 'Frontier',
      tangerineWhistle: 'EIP150',
      spuriousDragon: 'EIP158',
      muirGlacier: 'Istanbul',
      petersburg: 'ConstantinopleFix',
      paris: 'Merge',
    }
    const hardforks = Object.keys(testLegacy)
    for await (const [idx, hardfork] of hardforks.entries()) {
      const alias = alternateNames[hardfork] ?? hardfork
      it(`${idx + 1}/${hardforks.length}should return ${alias} for ${hardfork}`, async () => {
        const result = getRequiredForkConfigAlias(hardfork)
        expect(result).toEqual(alias)
      })
    }
    it(`Should return uknown hardfork`, async () => {
      const unknown = 'unknown'
      expect(getRequiredForkConfigAlias(unknown)).toEqual(unknown)
    })
  })
  describe('getTestDirs', async () => {
    const hardforks = Object.keys(testLegacy)
    for await (const hardfork of hardforks) {
      it(`should return state test dirs`, async () => {
        const result = getTestDirs(hardfork, 'GeneralStateTests')
        if (testLegacy[hardfork as keyof typeof testLegacy] === true) {
          assert.deepEqual(
            result,
            ['GeneralStateTests', 'LegacyTests/Constantinople/GeneralStateTests'],
            `should return 2 dirs for ${hardfork}`
          )
        } else {
          assert.deepEqual(result, ['GeneralStateTests'], `should return 2 dirs for ${hardfork}`)
        }
      })
    }
  })
  describe('setupCommonWithNetworks', async () => {
    const hardforks = Object.keys(testLegacy)
    for await (const hardfork of hardforks) {
      it(`should infer hardfork name from network`, async () => {
        const network = hardfork
        const hfName = inferHardfork(network)
        expect(normalHardforks).includes(hfName)
      })
      it(`should setup common`, async () => {
        const common = setupCommonWithNetworks(hardfork)
        const hfName = inferHardfork(hardfork)
        expect(common).exist
        expect(common.hardfork()).toEqual(hfName)
        expect(common.eips().length).toEqual(1)
      })
    }
    it(`should setup common with EIPs`, async () => {
      const network = 'Byzantium + 2537 + 2929'
      const hfName = inferHardfork(network)
      const common = setupCommonWithNetworks(network)
      expect(common).exist
      expect(common.hardfork()).toEqual(hfName)
      assert.deepEqual(common.eips(), [2537, 2929])
    })
  })
  describe('getCommon', async () => {
    const networks = Object.keys(testLegacy)
    for await (const network of networks) {
      it(`should setup common for ${network}`, async () => {
        const hfName = inferHardfork(network)
        const common = getCommon(network)
        expect(common).exist
        expect(common.eips().length).toEqual(1)
        if (Object.keys(transitionNetworks).includes(network)) {
          expect(common.hardfork()).toEqual(
            transitionNetworks[network as keyof typeof transitionNetworks].startFork
          )
        } else {
          expect(common.hardfork()).toEqual(hfName)
        }
      })
    }
    it(`should setup common with EIPs`, async () => {
      const network = 'London+3855+3860'
      const common = getCommon(network)
      expect(common).exist
      expect(common.hardfork()).toEqual('london')
      assert.deepEqual(common.eips(), [3855, 3860])
    })
  })

  describe('getSkipTests', async () => {
    const choices = [SKIP_BROKEN, SKIP_PERMANENT, SKIP_SLOW]
    const choicesStr = ['BROKEN', 'PERMANENT', 'SLOW']
    for (const [idx, choice] of choicesStr.entries()) {
      const skipsNone = getSkipTests(choice, 'NONE')
      const skipsAll = getSkipTests(choice, 'ALL')
      it(`should skip none for ${choice}`, async () => {
        expect(skipsNone.length).toEqual(choices[idx].length)
      })
      it(`should skip all for ${choice}`, async () => {
        expect(skipsAll.length).toEqual(choices[idx].length)
      })
      for (const [_idx, _choice] of choicesStr.entries()) {
        if (idx !== idx) {
          it('should skip none for ' + choice + ' and ' + _choice, async () => {
            const skips = getSkipTests(`${choice},${_choice}`, 'NONE')
            expect(skips.length).toEqual(0)
          })
          it('should skip all for ' + choice + ' and ' + _choice, async () => {
            const skips = getSkipTests(`${choice},${_choice}`, 'ALL')
            expect(skips.length).toEqual(choices[idx].length)
          })
        }
      }
    }
    it('should get all skip tests', async () => {
      const skipsAll = getSkipTests('all', 'ALL')
      const skipsNone = getSkipTests('all', 'NONE')
      expect(skipsAll.length).toEqual(choices.reduce((acc, cur) => acc.concat(cur), []).length)
      expect(skipsNone.length).toEqual(choices.reduce((acc, cur) => acc.concat(cur), []).length)
      expect(skipsNone.length).toEqual(choices.reduce((acc, cur) => acc.concat(cur), []).length)
    })
  })
})
