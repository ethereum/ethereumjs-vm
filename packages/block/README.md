# @ethereumjs/block

[![NPM Package][block-npm-badge]][block-npm-link]
[![GitHub Issues][block-issues-badge]][block-issues-link]
[![Actions Status][block-actions-badge]][block-actions-link]
[![Code Coverage][block-coverage-badge]][block-coverage-link]
[![Discord][discord-badge]][discord-link]

| Implements schema and functions related to Ethereum's block. |
| ------------------------------------------------------------ |

Note: this `README` reflects the state of the library from `v3.0.0` onwards. See `README` from the [standalone repository](https://github.com/ethereumjs/ethereumjs-block) for an introduction on the last preceding release.

## Installation

To obtain the latest version, simply require the project using `npm`:

```shell
npm install @ethereumjs/block
```

**Note:** If you want to work with `EIP-4844` related functionality, you will have additional manual installation steps for the **KZG setup**, see related section below.

## Runtime Support

### Node.js

The current version of this library supports Node `18` and `20` (recommended). Node.js is the main supported platform which is also used internally for development and testing.

TypeScript examples in the [examples](./examples/) folder can be run using [tsx](https://github.com/privatenumber/tsx) like the following:

```shell
tsx examples/simple.ts
```

### Bun

This library has been tested to run with [Bun](https://bun.sh/) [v1.0](https://bun.sh/blog/bun-v1.0) or higher. Note that Bun is still in very active development and a production usage is not recommended (by the Bun team itself) in many cases.

Example run using Bun:

```shell
bun run examples/simple.ts
```

### Browser

This library targets to run in modern browsers which support the JavaScript [ES2020](https://www.w3schools.com/js/js_2020.asp) feature set. There is a dedicated ESM build provided and imports can be done using the normal ES6 [module import](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) syntax.

For browser usage see the dedicated [example](./examples/browser.html) (with usage instructions).

## Usage

### Introduction

There are five standalone functions to instantiate a `Block`:

- `createBlock(blockData: BlockData = {}, opts?: BlockOptions)`
- `createBlockFromRLPSerializedBlock(serialized: Uint8Array, opts?: BlockOptions)`
- `createBlockFromBytesArray(values: BlockBytes, opts?: BlockOptions)`
- `createBlockFromRPC(blockParams: JsonRpcBlock, uncles?: any[], opts?: BlockOptions)`
- `createBlockFromJsonRPCProvider(provider: string | EthersProvider, blockTag: string | bigint, opts: BlockOptions)`

For `BlockHeader` instantiation standalone functions exists for instantiation, see API docs linked below.

Instantiation Example:

```ts
// ./examples/simple.ts

import { createBlockHeader } from '@ethereumjs/block'
import { bytesToHex } from '@ethereumjs/util'

import type { HeaderData } from '@ethereumjs/block'

const headerData: HeaderData = {
  number: 15,
  parentHash: '0x6bfee7294bf44572b7266358e627f3c35105e1c3851f3de09e6d646f955725a7',
  gasLimit: 8000000,
  timestamp: 1562422144,
}
const header = createBlockHeader(headerData)
console.log(`Created block header with hash=${bytesToHex(header.hash())}`)
```

Properties of a `Block` or `BlockHeader` object are frozen with `Object.freeze()` which gives you enhanced security and consistency properties when working with the instantiated object. This behavior can be modified using the `freeze` option in the constructor if needed.

API Usage Example:

```ts
// ./examples/1559.ts#L46-L50

try {
  await blockWithMatchingBaseFee.validateData()
} catch (err) {
  console.log(err) // block validation fails
}
```

### WASM Crypto Support

This library by default uses JavaScript implementations for the basic standard crypto primitives like hashing or signature verification (for included txs). See `@ethereumjs/common` [README](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/common) for instructions on how to replace with e.g. a more performant WASM implementation by using a shared `common` instance.

### EIP-1559 Blocks

This library supports the creation of [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559) compatible blocks starting with `v3.3.0`. For this to work a Block needs to be instantiated with a Hardfork greater or equal to London (`Hardfork.London`).

```ts
// ./examples/1559.ts

import { createBlock } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createTx } from '@ethereumjs/tx'
const common = new Common({ chain: Mainnet, hardfork: Hardfork.London })

const block = createBlock(
  {
    header: {
      baseFeePerGas: BigInt(10),
      gasLimit: BigInt(100),
      gasUsed: BigInt(60),
    },
  },
  { common },
)

// Base fee will increase for next block since the
// gas used is greater than half the gas limit
console.log(Number(block.header.calcNextBaseFee())) // 11

// So for creating a block with a matching base fee in a certain
// chain context you can do:
const blockWithMatchingBaseFee = createBlock(
  {
    header: {
      baseFeePerGas: block.header.calcNextBaseFee(),
      gasLimit: BigInt(100),
      gasUsed: BigInt(60),
    },
  },
  { common },
)

console.log(Number(blockWithMatchingBaseFee.header.baseFeePerGas)) // 11

// successful validation does not throw error
await blockWithMatchingBaseFee.validateData()

// failed validation throws error
const tx = createTx(
  { type: 2, maxFeePerGas: BigInt(20) },
  { common: new Common({ chain: Mainnet, hardfork: Hardfork.London }) },
)
blockWithMatchingBaseFee.transactions.push(tx)
console.log(blockWithMatchingBaseFee.getTransactionsValidationErrors()) // invalid transaction added to block
try {
  await blockWithMatchingBaseFee.validateData()
} catch (err) {
  console.log(err) // block validation fails
}
```

EIP-1559 blocks have an extra `baseFeePerGas` field (default: `BigInt(7)`) and can encompass `FeeMarketEIP1559Transaction` txs (type `2`) (supported by `@ethereumjs/tx` `v3.2.0` or higher) as well as `LegacyTransaction` legacy txs (internal type `0`) and `AccessListEIP2930Transaction` txs (type `1`).

### EIP-4895 Beacon Chain Withdrawals Blocks

Starting with the `v4.1.0` release there is support for [EIP-4895](https://eips.ethereum.org/EIPS/eip-4895) beacon chain withdrawals. Withdrawals support can be activated by initializing a `Common` object with a hardfork set to `shanghai` (default) or higher and then use the `withdrawals` data option to pass in system-level withdrawal operations together with a matching `withdrawalsRoot` (mandatory when `EIP-4895` is activated) along Block creation, see the following example:

```ts
// ./examples/withdrawals.ts

import { createBlock } from '@ethereumjs/block'
import { Common, Mainnet } from '@ethereumjs/common'
import { Address, hexToBytes } from '@ethereumjs/util'

import type { WithdrawalData } from '@ethereumjs/util'

const common = new Common({ chain: Mainnet })

const withdrawal = <WithdrawalData>{
  index: BigInt(0),
  validatorIndex: BigInt(0),
  address: new Address(hexToBytes(`0x${'20'.repeat(20)}`)),
  amount: BigInt(1000),
}

const block = createBlock(
  {
    header: {
      withdrawalsRoot: hexToBytes(
        '0x69f28913c562b0d38f8dc81e72eb0d99052444d301bf8158dc1f3f94a4526357',
      ),
    },
    withdrawals: [withdrawal],
  },
  {
    common,
  },
)

console.log(`Block with ${block.withdrawals!.length} withdrawal(s) created`)
```

Validation of the withdrawals trie can be manually triggered with the newly introduced async `Block.withdrawalsTrieIsValid()` method.

### EIP-4844 Shard Blob Transaction Blocks

This library supports the blob transaction type introduced with [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844).

#### Initialization

To create blocks which include blob transactions you have to active EIP-4844 in the associated `@ethereumjs/common` library or use a 4844-including hardfork like `Cancun`:

```ts
// ./examples/4844.ts

import { createBlock } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createBlob4844Tx } from '@ethereumjs/tx'
import { createAddressFromPrivateKey } from '@ethereumjs/util'
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import { randomBytes } from 'crypto'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'

const main = async () => {
  const kzg = new microEthKZG(trustedSetup)

  const common = new Common({
    chain: Mainnet,
    hardfork: Hardfork.Cancun,
    customCrypto: {
      kzg,
    },
  })
  const blobTx = createBlob4844Tx(
    { blobsData: ['myFirstBlob'], to: createAddressFromPrivateKey(randomBytes(32)) },
    { common },
  )

  const block = createBlock(
    {
      header: {
        excessBlobGas: 0n,
      },
      transactions: [blobTx],
    },
    {
      common,
      skipConsensusFormatValidation: true,
    },
  )

  console.log(
    `4844 block header with excessBlobGas=${block.header.excessBlobGas} created and ${
      block.transactions.filter((tx) => tx.type === 3).length
    } blob transactions`,
  )
}

void main()
```

**Note:** Working with blob transactions needs a manual KZG library installation and global initialization, see [KZG Setup](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/tx/README.md#kzg-setup) for instructions.

### Blocks with EIP-7685 Consensus Layer Requests

Starting with v5.3.0 this library supports requests to the consensus layer which have been introduced with [EIP-7685](https://eips.ethereum.org/EIPS/eip-7685) and will come into play for deposit and withdrawal requests along the upcoming [Prague](https://eips.ethereum.org/EIPS/eip-7600) hardfork.

#### EIP-6110 Deposit Requests

[EIP-6110](https://eips.ethereum.org/EIPS/eip-6110) introduces deposit requests allowing beacon chain deposits being triggered from the execution layer. Starting with v5.3.0 this library supports deposit requests and a containing block can be instantiated as follows:

```ts
// ./examples/6110Requests.ts

import { createBlock, genRequestsRoot } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import {
  type CLRequest,
  CLRequestType,
  bytesToHex,
  createCLRequest,
  randomBytes,
} from '@ethereumjs/util'
import { sha256 } from 'ethereum-cryptography/sha256.js'

const main = async () => {
  const common = new Common({
    chain: Mainnet,
    hardfork: Hardfork.Prague,
  })

  const depositRequestData = {
    pubkey: randomBytes(48),
    withdrawalCredentials: randomBytes(32),
    amount: randomBytes(8),
    signature: randomBytes(96),
    index: randomBytes(8),
  }
  // flatten request bytes as per EIP-7685
  const depositRequestBytes = new Uint8Array(
    Object.values(depositRequestData)
      .map((arr) => Array.from(arr)) // Convert Uint8Arrays to regular arrays
      .reduce((acc, curr) => acc.concat(curr), []), // Concatenate arrays
  )
  const request = createCLRequest(
    new Uint8Array([CLRequestType.Deposit, ...depositRequestBytes]),
  ) as CLRequest<CLRequestType.Deposit>
  const requests = [request]
  const requestsRoot = genRequestsRoot(requests, sha256)

  const block = createBlock(
    {
      header: { requestsHash: requestsRoot },
    },
    { common },
  )
  console.log(`Instantiated block ${block}, requestsHash=${bytesToHex(block.header.requestsHash!)}`)
}

void main()
```

Have a look at the EIP for some guidance on how to use and fill in the various deposit request parameters.

#### EIP-7002 Withdrawal Requests

[EIP-7002](https://eips.ethereum.org/EIPS/eip-7002) introduces the possibility for validators to trigger exits and partial withdrawals via the execution layer. Starting with v5.3.0 this library supports withdrawal requests and a containing block can be instantiated as follows:

```ts
// ./examples/7002Requests.ts

import { createBlock, genRequestsRoot } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import {
  type CLRequest,
  type CLRequestType,
  bytesToBigInt,
  createWithdrawalRequest,
  randomBytes,
} from '@ethereumjs/util'
import { sha256 } from 'ethereum-cryptography/keccak.js'

const main = async () => {
  const common = new Common({
    chain: Mainnet,
    hardfork: Hardfork.Prague,
  })

  const withdrawalRequestData = {
    sourceAddress: randomBytes(20),
    validatorPubkey: randomBytes(48),
    amount: bytesToBigInt(randomBytes(8)),
  }
  const request = createWithdrawalRequest(withdrawalRequestData) as CLRequest<CLRequestType>
  const requests = [request]
  const requestsRoot = genRequestsRoot(requests, sha256)

  const block = createBlock(
    {
      requests,
      header: { requestsRoot },
    },
    { common },
  )
  console.log(
    `Instantiated block with ${
      block.requests?.length
    } withdrawal request, requestTrieValid=${await block.requestsTrieIsValid()}`,
  )
}

void main()
```

Have a look at the EIP for some guidance on how to use and fill in the various withdrawal request parameters.

#### EIP-7251 Consolidation Requests

[EIP-7251](https://eips.ethereum.org/EIPS/eip-7251) introduces consolidation requests allowing staked ETH from more than one validator on the beacon chain to be consolidated into one validator, triggered from the execution layer. Starting with v5.3.0 this library supports consolidation requests and a containing block can be instantiated as follows:

```ts
// ./examples/7251Requests.ts

import { createBlock, genRequestsRoot } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import {
  type CLRequest,
  type CLRequestType,
  createConsolidationRequest,
  randomBytes,
} from '@ethereumjs/util'
import { sha256 } from 'ethereum-cryptography/keccak.js'

const main = async () => {
  const common = new Common({
    chain: Mainnet,
    hardfork: Hardfork.Prague,
  })

  const consolidationRequestData = {
    sourceAddress: randomBytes(20),
    sourcePubkey: randomBytes(48),
    targetPubkey: randomBytes(48),
  }
  const request = createConsolidationRequest(consolidationRequestData) as CLRequest<CLRequestType>
  const requests = [request]
  const requestsRoot = genRequestsRoot(requests, sha256)

  const block = createBlock(
    {
      requests,
      header: { requestsRoot },
    },
    { common },
  )
  console.log(
    `Instantiated block with ${
      block.requests?.length
    } consolidation request, requestTrieValid=${await block.requestsTrieIsValid()}`,
  )
}

void main()
```

Have a look at the EIP for some guidance on how to use and fill in the various deposit request parameters.

### Consensus Types

The block library supports the creation as well as consensus format validation of PoW `ethash` and PoA `clique` blocks (so e.g. do specific `extraData` checks on Clique/PoA blocks).

Consensus format validation logic is encapsulated in the semi-private `BlockHeader._consensusFormatValidation()` method called from the constructor. If you want to add your own validation logic you can overwrite this method with your own rules.

Note: Starting with `v4` consensus validation itself (e.g. Ethash verification) has moved to the `Blockchain` package.

### Ethash/PoW

An Ethash/PoW block can be instantiated as follows:

```ts
// ./examples/pow.ts

import { createBlock } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })

console.log(common.consensusType()) // 'pow'
console.log(common.consensusAlgorithm()) // 'ethash'

createBlock({}, { common })
console.log(`Old Proof-of-Work block created`)
```

To calculate the difficulty when creating the block pass in the block option `calcDifficultyFromHeader` with the preceding (parent) `BlockHeader`.

### Clique/PoA (since v3.1.0)

A clique block can be instantiated as follows:

```ts
// ./examples/clique.ts

import { createBlock } from '@ethereumjs/block'
import { Common, Goerli, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Goerli, hardfork: Hardfork.Chainstart })

console.log(common.consensusType()) // 'poa'
console.log(common.consensusAlgorithm()) // 'clique'

createBlock({ header: { extraData: new Uint8Array(97) } }, { common })
console.log(`Old Clique Proof-of-Authority block created`)
```

For sealing a block on instantiation you can use the `cliqueSigner` constructor option:

```ts
const cliqueSigner = Buffer.from('PRIVATE_KEY_HEX_STRING', 'hex')
const block = createSealedCliqueBlock(blockData, cliqueSigner)
```

Additionally there are the following utility methods for Clique/PoA related functionality in the `BlockHeader` class:

- `BlockHeader.cliqueSigHash()`
- `BlockHeader.cliqueIsEpochTransition(): boolean`
- `BlockHeader.cliqueExtraVanity(): Uint8Array`
- `BlockHeader.cliqueExtraSeal(): Uint8Array`
- `BlockHeader.cliqueEpochTransitionSigners(): Address[]`
- `BlockHeader.cliqueVerifySignature(signerList: Address[]): boolean`
- `BlockHeader.cliqueSigner(): Address`

See the API docs for detailed documentation. Note that these methods will throw if called in a non-Clique/PoA context.

### Casper/PoS (since v3.5.0)

Merge-friendly Casper/PoS blocks have been introduced along with the `v3.5.0` release. Proof-of-Stake compatible execution blocks come with their own set of header field simplifications and associated validation rules. The difficulty is set to `0` since not relevant anymore, just to name an example. For a full list of changes see [EIP-3675](https://eips.ethereum.org/EIPS/eip-3675).

You can instantiate a Merge/PoS block like this:

```ts
// ./examples/pos.ts

import { createBlock } from '@ethereumjs/block'
import { Common, Mainnet } from '@ethereumjs/common'

const common = new Common({ chain: Mainnet })

const block = createBlock(
  {
    // Provide your block data here or use default values
  },
  { common },
)

console.log(`Proof-of-Stake (default) block created with hardfork=${block.common.hardfork()}`)
```

## API

### Docs

Generated TypeDoc API [Documentation](./docs/README.md)

### Hybrid CJS/ESM Builds

With the breaking releases from Summer 2023 we have started to ship our libraries with both CommonJS (`cjs` folder) and ESM builds (`esm` folder), see `package.json` for the detailed setup.

If you use an ES6-style `import` in your code files from the ESM build will be used:

```ts
import { EthereumJSClass } from '@ethereumjs/[PACKAGE_NAME]'
```

If you use Node.js specific `require`, the CJS build will be used:

```ts
const { EthereumJSClass } = require('@ethereumjs/[PACKAGE_NAME]')
```

Using ESM will give you additional advantages over CJS beyond browser usage like static code analysis / Tree Shaking which CJS can not provide.

### Buffer -> Uint8Array

With the breaking releases from Summer 2023 we have removed all Node.js specific `Buffer` usages from our libraries and replace these with [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) representations, which are available both in Node.js and the browser (`Buffer` is a subclass of `Uint8Array`).

We have converted existing Buffer conversion methods to Uint8Array conversion methods in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

### BigInt Support

Starting with v4 the usage of [BN.js](https://github.com/indutny/bn.js/) for big numbers has been removed from the library and replaced with the usage of the native JS [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) data type (introduced in `ES2020`).

Please note that number-related API signatures have changed along with this version update and the minimal build target has been updated to `ES2020`.

## Testing

Tests in the `tests` directory are partly outdated and testing is primarily done by running the `BlockchainTests` from within the [@ethereumjs/vm](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/vm) package.

To avoid bloating this repository with [ethereum/tests](https://github.com/ethereum/tests) JSON files, we usually copy specific JSON files and wrap them with some metadata (source, date, commit hash). There's a helper to aid in that process and can be found at [wrap-ethereum-test.sh](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/scripts/wrap-ethereum-test.sh).

## EthereumJS

See our organizational [documentation](https://ethereumjs.readthedocs.io) for an introduction to `EthereumJS` as well as information on current standards and best practices. If you want to join for work or carry out improvements on the libraries, please review our [contribution guidelines](https://ethereumjs.readthedocs.io/en/latest/contributing.html) first.

## License

[MPL-2.0](<https://tldrlegal.com/license/mozilla-public-license-2.0-(mpl-2)>)

[discord-badge]: https://img.shields.io/static/v1?logo=discord&label=discord&message=Join&color=blue
[discord-link]: https://discord.gg/TNwARpR
[block-npm-badge]: https://img.shields.io/npm/v/@ethereumjs/block.svg
[block-npm-link]: https://www.npmjs.com/package/@ethereumjs/block
[block-issues-badge]: https://img.shields.io/github/issues/ethereumjs/ethereumjs-monorepo/package:%20block?label=issues
[block-issues-link]: https://github.com/ethereumjs/ethereumjs-monorepo/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+block"
[block-actions-badge]: https://github.com/ethereumjs/ethereumjs-monorepo/workflows/Block/badge.svg
[block-actions-link]: https://github.com/ethereumjs/ethereumjs-monorepo/actions?query=workflow%3A%22Block%22
[block-coverage-badge]: https://codecov.io/gh/ethereumjs/ethereumjs-monorepo/branch/master/graph/badge.svg?flag=block
[block-coverage-link]: https://codecov.io/gh/ethereumjs/ethereumjs-monorepo/tree/master/packages/block
