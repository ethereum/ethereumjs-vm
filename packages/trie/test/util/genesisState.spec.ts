import { bytesToHex, parseGethGenesisState } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import gethGenesisKiln from '../../../blockchain/test/testdata/geth-genesis-kiln.json'
import ropsten from '../../../genesis/src/genesisStates/ropsten.json'
import { genesisStateRoot } from '../../src/util/genesisState'

describe('[Util/genesisStateRoot]', () => {
  it('should properly generate stateRoot from gethGenesis', async () => {
    // kiln genesis with deposit contract storage set
    const json = gethGenesisKiln
    const genesisState = parseGethGenesisState(json)
    const stateRoot = await genesisStateRoot(genesisState)
    assert.equal(
      bytesToHex(stateRoot),
      '52e628c7f35996ba5a0402d02b34535993c89ff7fc4c430b2763ada8554bee62',
      'kiln stateRoot matches'
    )
  })

  it('should correctly derive ropsten stateRoot from ethereumjs genesis', async () => {
    const json = ropsten
    const stateRoot = await genesisStateRoot(json)
    assert.equal(
      bytesToHex(stateRoot),
      '217b0bbcfb72e2d57e28f33cb361b9983513177755dc3f33ce3e7022ed62b77b',
      'ropsten stateRoot matches'
    )
  })
})
