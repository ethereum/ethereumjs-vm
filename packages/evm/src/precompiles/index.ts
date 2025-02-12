import { Hardfork } from '@ethereumjs/common'
import { type Address, bytesToUnprefixedHex } from '@ethereumjs/util'

import { precompile01 } from './01-ecrecover.js'
import { precompile02 } from './02-sha256.js'
import { precompile03 } from './03-ripemd160.js'
import { precompile04 } from './04-identity.js'
import { precompile05 } from './05-modexp.js'
import { precompile06 } from './06-bn254-add.js'
import { precompile07 } from './07-bn254-mul.js'
import { precompile08 } from './08-bn254-pairing.js'
import { precompile09 } from './09-blake2f.js'
import { precompile0a } from './0a-kzg-point-evaluation.js'
import { precompile0b } from './0b-bls12-g1add.js'
import { precompile0c } from './0c-bls12-g1msm.js'
import { precompile0d } from './0d-bls12-g2add.js'
import { precompile0e } from './0e-bls12-g2msm.js'
import { precompile0f } from './0f-bls12-pairing.js'
import { precompile10 } from './10-bls12-map-fp-to-g1.js'
import { precompile11 } from './11-bls12-map-fp2-to-g2.js'
import { precompile12 } from './12-execute.js'
import { MCLBLS, NobleBLS } from './bls12_381/index.js'
import { NobleBN254, RustBN254 } from './bn254/index.js'

import type { PrecompileFunc, PrecompileInput } from './types.js'
import type { Common } from '@ethereumjs/common'

interface PrecompileEntry {
  address: string
  check: PrecompileAvailabilityCheckType
  precompile: PrecompileFunc
  name: string
}

interface Precompiles {
  [key: string]: PrecompileFunc
}

type PrecompileAvailabilityCheckType =
  | PrecompileAvailabilityCheckTypeHardfork
  | PrecompileAvailabilityCheckTypeEIP

enum PrecompileAvailabilityCheck {
  EIP,
  Hardfork,
}

interface PrecompileAvailabilityCheckTypeHardfork {
  type: PrecompileAvailabilityCheck.Hardfork
  param: string
}

interface PrecompileAvailabilityCheckTypeEIP {
  type: PrecompileAvailabilityCheck.EIP
  param: number
}
const BYTES_19 = '00000000000000000000000000000000000000'
const ripemdPrecompileAddress = BYTES_19 + '03'

const precompileEntries: PrecompileEntry[] = [
  {
    address: BYTES_19 + '01',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Chainstart,
    },
    precompile: precompile01,
    name: 'ECRECOVER (0x01)',
  },
  {
    address: BYTES_19 + '02',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Chainstart,
    },
    precompile: precompile02,
    name: 'SHA256 (0x02)',
  },
  {
    address: BYTES_19 + '03',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Chainstart,
    },
    precompile: precompile03,
    name: 'RIPEMD160 (0x03)',
  },
  {
    address: BYTES_19 + '04',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Chainstart,
    },
    precompile: precompile04,
    name: 'IDENTITY (0x04)',
  },
  {
    address: BYTES_19 + '05',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Byzantium,
    },
    precompile: precompile05,
    name: 'MODEXP (0x05)',
  },
  {
    address: BYTES_19 + '06',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Byzantium,
    },
    precompile: precompile06,
    name: 'BN254_ADD (0x06)',
  },
  {
    address: BYTES_19 + '07',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Byzantium,
    },
    precompile: precompile07,
    name: 'BN254_MUL (0x07)',
  },
  {
    address: BYTES_19 + '08',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Byzantium,
    },
    precompile: precompile08,
    name: 'BN254_PAIRING (0x08)',
  },
  {
    address: BYTES_19 + '09',
    check: {
      type: PrecompileAvailabilityCheck.Hardfork,
      param: Hardfork.Istanbul,
    },
    precompile: precompile09,
    name: 'BLAKE2f (0x09)',
  },
  {
    address: BYTES_19 + '0a',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 4844,
    },
    precompile: precompile0a,
    name: 'KZG_POINT_EVALUATION (0x0a)',
  },
  {
    address: BYTES_19 + '0b',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile0b,
    name: 'BLS12_G1ADD (0x0b)',
  },
  {
    address: BYTES_19 + '0c',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile0c,
    name: 'BLS12_G1MSM (0x0c)',
  },
  {
    address: BYTES_19 + '0d',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile0d,
    name: 'BLS12_G2ADD (0x0d)',
  },
  {
    address: BYTES_19 + '0e',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile0e,
    name: 'BLS12_G2MSM (0x0e)',
  },
  {
    address: BYTES_19 + '0f',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile0f,
    name: 'BLS12_PAIRING (0x0f)',
  },
  {
    address: BYTES_19 + '10',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile10,
    name: 'BLS12_MAP_FP_TO_G1 (0x10)',
  },
  {
    address: BYTES_19 + '11',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 2537,
    },
    precompile: precompile11,
    name: 'BLS12_MAP_FP_TO_G2 (0x11)',
  },
  {
    address: BYTES_19 + '12',
    check: {
      type: PrecompileAvailabilityCheck.EIP,
      param: 9999,
    },
    precompile: precompile12,
    name: 'EXECUTE (0x12)',
  },
]

const precompiles: Precompiles = {
  [BYTES_19 + '01']: precompile01,
  [BYTES_19 + '02']: precompile02,
  [ripemdPrecompileAddress]: precompile03,
  [BYTES_19 + '04']: precompile04,
  [BYTES_19 + '05']: precompile05,
  [BYTES_19 + '06']: precompile06,
  [BYTES_19 + '07']: precompile07,
  [BYTES_19 + '08']: precompile08,
  [BYTES_19 + '09']: precompile09,
  [BYTES_19 + '0a']: precompile0a,
  [BYTES_19 + '0b']: precompile0b,
  [BYTES_19 + '0c']: precompile0c,
  [BYTES_19 + '0d']: precompile0d,
  [BYTES_19 + '0e']: precompile0e,
  [BYTES_19 + '0f']: precompile0f,
  [BYTES_19 + '10']: precompile10,
  [BYTES_19 + '11']: precompile11,
  [BYTES_19 + '12']: precompile12,
}

type DeletePrecompile = {
  address: Address
}

type AddPrecompile = {
  address: Address
  function: PrecompileFunc
}

type CustomPrecompile = AddPrecompile | DeletePrecompile

function getActivePrecompiles(
  common: Common,
  customPrecompiles?: CustomPrecompile[],
): Map<string, PrecompileFunc> {
  const precompileMap = new Map()
  if (customPrecompiles) {
    for (const precompile of customPrecompiles) {
      precompileMap.set(
        bytesToUnprefixedHex(precompile.address.bytes),
        'function' in precompile ? precompile.function : undefined,
      )
    }
  }
  for (const entry of precompileEntries) {
    if (precompileMap.has(entry.address)) {
      continue
    }
    const type = entry.check.type

    if (
      (type === PrecompileAvailabilityCheck.Hardfork && common.gteHardfork(entry.check.param)) ||
      (entry.check.type === PrecompileAvailabilityCheck.EIP &&
        common.isActivatedEIP(entry.check.param))
    ) {
      precompileMap.set(entry.address, entry.precompile)
    }
  }
  return precompileMap
}

function getPrecompileName(addressUnprefixedStr: string) {
  if (addressUnprefixedStr.length < 40) {
    addressUnprefixedStr = addressUnprefixedStr.padStart(40, '0')
  }
  for (const entry of precompileEntries) {
    if (entry.address === addressUnprefixedStr) {
      return entry.name
    }
  }
  return ''
}

export {
  getActivePrecompiles,
  getPrecompileName,
  MCLBLS,
  NobleBLS,
  NobleBN254,
  precompileEntries,
  precompiles,
  ripemdPrecompileAddress,
  RustBN254,
}

export type { AddPrecompile, CustomPrecompile, DeletePrecompile, PrecompileFunc, PrecompileInput }
