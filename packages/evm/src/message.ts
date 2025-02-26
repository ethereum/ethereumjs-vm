import { BIGINT_0, EthereumJSErrorWithoutCode, createZeroAddress } from '@ethereumjs/util'

import type { PrecompileFunc } from './precompiles/index.js'
import type { EOFEnv } from './types.js'
import type { VerkleAccessWitnessInterface } from '@ethereumjs/common'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

const defaults = {
  value: BIGINT_0,
  caller: createZeroAddress(),
  data: new Uint8Array(0),
  depth: 0,
  isStatic: false,
  isCompiled: false,
  delegatecall: false,
  gasRefund: BIGINT_0,
}

interface MessageOpts {
  to?: Address
  value?: bigint
  caller?: Address
  gasLimit: bigint
  data?: Uint8Array
  eofCallData?: Uint8Array
  depth?: number
  code?: Uint8Array | PrecompileFunc
  codeAddress?: Address
  isStatic?: boolean
  isCompiled?: boolean
  salt?: Uint8Array
  /**
   * A set of addresses to selfdestruct, see {@link Message.selfdestruct}
   */
  selfdestruct?: Set<PrefixedHexString>
  /**
   * Map of addresses which were created (used in EIP 6780)
   */
  createdAddresses?: Set<PrefixedHexString>
  delegatecall?: boolean
  gasRefund?: bigint
  blobVersionedHashes?: PrefixedHexString[]
  accessWitness?: VerkleAccessWitnessInterface
}

export class Message {
  to?: Address
  value: bigint
  caller: Address
  gasLimit: bigint
  data: Uint8Array
  eofCallData?: Uint8Array // Only used in EOFCreate to signal an EOF contract to be created with this calldata (via EOFCreate)
  isCreate?: boolean
  depth: number
  code?: Uint8Array | PrecompileFunc
  _codeAddress?: Address
  isStatic: boolean
  isCompiled: boolean
  salt?: Uint8Array
  eof?: EOFEnv
  chargeCodeAccesses?: boolean
  /**
   * Set of addresses to selfdestruct. Key is the unprefixed address.
   */
  selfdestruct?: Set<PrefixedHexString>
  /**
   * Map of addresses which were created (used in EIP 6780)
   */
  createdAddresses?: Set<PrefixedHexString>
  delegatecall: boolean
  gasRefund: bigint // Keeps track of the gasRefund at the start of the frame (used for journaling purposes)
  /**
   * List of versioned hashes if message is a blob transaction in the outer VM
   */
  blobVersionedHashes?: PrefixedHexString[]
  accessWitness?: VerkleAccessWitnessInterface

  constructor(opts: MessageOpts) {
    this.to = opts.to
    this.value = opts.value ?? defaults.value
    this.caller = opts.caller ?? defaults.caller
    this.gasLimit = opts.gasLimit
    this.data = opts.data ?? defaults.data
    this.eofCallData = opts.eofCallData
    this.depth = opts.depth ?? defaults.depth
    this.code = opts.code
    this._codeAddress = opts.codeAddress
    this.isStatic = opts.isStatic ?? defaults.isStatic
    this.isCompiled = opts.isCompiled ?? defaults.isCompiled
    this.salt = opts.salt
    this.selfdestruct = opts.selfdestruct
    this.createdAddresses = opts.createdAddresses
    this.delegatecall = opts.delegatecall ?? defaults.delegatecall
    this.gasRefund = opts.gasRefund ?? defaults.gasRefund
    this.blobVersionedHashes = opts.blobVersionedHashes
    this.accessWitness = opts.accessWitness
    if (this.value < 0) {
      throw EthereumJSErrorWithoutCode(`value field cannot be negative, received ${this.value}`)
    }
  }

  /**
   * Note: should only be called in instances where `_codeAddress` or `to` is defined.
   */
  get codeAddress(): Address {
    const codeAddress = this._codeAddress ?? this.to
    if (!codeAddress) {
      throw EthereumJSErrorWithoutCode('Missing codeAddress')
    }
    return codeAddress
  }
}

export type MessageWithTo = Message & Pick<Required<MessageOpts>, 'to'>
