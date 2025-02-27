# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 6.0.0-alpha.1 - 2024-10-17

This is a first round of `alpha` releases for our upcoming breaking release round with a focus on bundle size (tree shaking) and security (dependencies down + no WASM (by default)). Note that `alpha` releases are not meant to be fully API-stable yet and are for early testing only. This release series will be then followed by a `beta` release round where APIs are expected to be mostly stable. Final releases can then be expected for late October/early November 2024.

### Renamings

#### Transaction Classes

The names for the tx classes have been shortened and simplified (see PRs [#3533](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3533)):

- `FeeMarketEIP1559Transaction` -> `FeeMarket1559Tx`
- `AccessListEIP2930Transaction` -> `AccessList2930Tx`
- `BlobEIP4844Transaction` -> `Blob4844Tx`
- `EOACodeEIP7702Transaction` -> `EOACode7702Tx`

#### Static Constructors

The static constructors for our library classes have been reworked to now be standalone methods (with a similar naming scheme). This allows for better tree shaking of unused constructor code (see PRs [#3533](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3533) and [#3597](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3597)).

Here an example for the `FeeMarket1559Tx` class:

- `FeeMarketEIP1559Transaction.fromTxData()` -> `createFeeMarket1559Tx()`
- `FeeMarketEIP1559Transaction.fromSerializedTx()` -> `createFeeMarket1559TxFromRLP()`
- `FeeMarketEIP1559Transaction.fromValuesArray()` -> `create1559FeeMarketTxFromBytesArray()`

New names from other tx types, to grasp the scheme:

- `createBlob4844Tx()`
- `createAccessList2930Tx()`
- `createEOACode7702Tx()`

#### Transaction Factory

Similar renamings have been done for the generic `TransactionFactory` (see PRs [#3514](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3514) and [#3667](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3667)):

- `TransactionFactory.fromTxData()` -> `createTx()`
- `TransactionFactory.fromSerializedData()` -> `createTxFromRLP()`
- `TransactionFactory.fromBlockBodyData()` -> `createTxFromBlockBodyData()`
- `TransactionFactory.fromJsonRpcProvider()` -> `createTxFromJSONRPCProvider()`
- New: `createTxFromRPC()` (just from the data, without the provider fetch)

#### Library Methods

See: PR [#3535](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3535)

- `*Tx.getBaseFee()` -> `*Tx.getIntrinsicGas()` (avoid confusion with 1559 base fee)
- `*Tx.getDataFee()` -> `*Tx.getDataGas()` (be more explicit about method's gas unit)

### EIP-7702 EOA Account Abstraction Support (experimental)

The tx library now support the creation of [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) txs, which allow to transform an EOA into a smart contract for the period of one transaction and execute the respective bytecode, see PRs [#3470](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3470) and [#3577](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3577).

The following is an example on how to create an EIP-7702 tx (note that you need to replace the `authorizationList` parameters with real-world tx and signature values):

```ts
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createEOACode7702Tx } from '@ethereumjs/tx'
import { type PrefixedHexString, createAddressFromPrivateKey, randomBytes } from '@ethereumjs/util'

const ones32 = `0x${'01'.repeat(32)}` as PrefixedHexString

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun, eips: [7702] })
const tx = createEOACode7702Tx(
  {
    authorizationList: [
      {
        chainId: '0x2',
        address: `0x${'20'.repeat(20)}`,
        nonce: '0x1',
        yParity: '0x1',
        r: ones32,
        s: ones32,
      },
    ],
    to: createAddressFromPrivateKey(randomBytes(32)),
  },
  { common },
)
```

#### Own Tx Parameter Set

HF-sensitive parameters like `txGas` were previously by design all provided by the `@ethereumjs/common` library. This meant that all parameter sets were shared among the libraries and libraries carried around a lot of unnecessary parameters.

With the `Common` refactoring from PR [#3537](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3537) parameters now moved over to a dedicated `params.ts` file (exposed as e.g. `paramsTx`) within the parameter-using library and the library sets its own parameter set by internally calling a new `Common` method `updateParams()`. For shared `Common` instances parameter sets then accumulate as needed.

Beside having a lighter footprint this additionally allows for easier parameter customization. There is a new `params` constructor option which leverages this new possibility and where it becomes possible to provide a fully customized set of core library parameters.

### New Common API

There is a new Common API for simplification and better tree shaking, see PR [#3545](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3545). Change your `Common` initializations as follows (see `Common` release for more details):

```ts
// old
import { Chain, Common } from '@ethereumjs/common'
const common = new Common({ chain: Chain.Mainnet })

// new
import { Common, Mainnet } from '@ethereumjs/common'
const common = new Common({ chain: Mainnet })
```

### JavaScript KZG Support (no more WASM)

The WASM based KZG integration for 4844 support has been replaced with a pure JS-based solution ([micro-eth-singer](https://github.com/paulmillr/micro-eth-signer), thanks to @paulmillr for the cooperation and Andrew for the integration! ❤️), see PR [#3674](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3674). This makes this library fully independent from Web Assembly code for all supported functionality! 🎉 The JS version is indeed even faster then the WASM one (we benchmarked), so we recommend to just switch over!

KZG is one-time initialized by providing to `Common`, in the updated version now like this:

```ts
import { trustedSetup } from '@paulmillr/trusted-setups/fast.js'
import { KZG as microEthKZG } from 'micro-eth-signer/kzg'

const kzg = new microEthKZG(trustedSetup)
// Pass the following Common to the EthereumJS library
const common = new Common({
  chain: Mainnet,
  customCrypto: {
    kzg,
  },
})
```

### Other Breaking Changes

- New default hardfork: `Shanghai` -> `Cancun`, see PR [#3566](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3566)
- Renaming all camel-case `Rpc`-> `RPC` and `Json` -> `JSON` names, PR [#3638](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3638)

### Other Changes

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Add T9N (TransactionTool) test consumption, PR [#3742](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3742)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)

## 5.4.0 - 2024-08-15

#### EOA Code Transaction (EIP-7702) (outdated)

This release introduces support for a non-final version of [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) EOA code transactions, see PR [#3470](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3470). This tx type allows to run code in the context of an EOA and therefore extend the functionality which can be "reached" from respectively integrated into the scope of an otherwise limited EOA account.

The following is a simple example how to use an `EOACodeEIP7702Transaction` with one authorization list item:

```ts
// ./examples/EOACodeTx.ts

import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { EOACodeEIP7702Transaction } from '@ethereumjs/tx'
import type { PrefixedHexString } from '@ethereumjs/util'

const ones32 = `0x${'01'.repeat(32)}` as PrefixedHexString

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun, eips: [7702] })
const tx = EOACodeEIP7702Transaction.fromTxData(
  {
    authorizationList: [
      {
        chainId: '0x1',
        address: `0x${'20'.repeat(20)}`,
        nonce: ['0x1'],
        yParity: '0x1',
        r: ones32,
        s: ones32,
      },
    ],
  },
  { common },
)

console.log(
  `EIP-7702 EOA code tx created with ${tx.authorizationList.length} authorization list item(s).`,
)
```

Note: Things move fast with `EIP-7702` and the released implementation is based on [this](https://github.com/ethereum/EIPs/blob/14400434e1199c57d912082127b1d22643788d11/EIPS/eip-7702.md) commit and therefore already outdated. An up-to-date version will be released along our breaking release round planned for early September 2024.

### Verkle Updates

- Update `kzg-wasm` to `0.4.0`, PR [#3358](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3358)
- Shift Verkle to `osaka` hardfork, PR [#3371](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3371)

### Other Features

- Extend `BlobEIP4844Transaction.networkWrapperToJson()` to also include the 4844 fields, PR [#3365](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3365)
- Stricter prefixed hex typing, PRs [#3348](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3348), [#3427](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3427) and [#3357](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3357) (some changes removed in PR [#3382](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3382) for backwards compatibility reasons, will be reintroduced along upcoming breaking releases)

### Bugfixes

- Fix bug in generic error message regarding chain ID reporting, PR [#3386](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3386)

## 5.3.0 - 2024-03-18

### Full 4844 Browser Readiness

#### WASM KZG

Shortly following the "Dencun Hardfork Support" release round from last month, this is now the first round of releases where the EthereumJS libraries are now fully browser compatible regarding the new 4844 functionality, see PRs [#3294](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3294) and [#3296](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3296)! 🎉

Our WASM wizard @acolytec3 has spent the last two weeks and created a WASM build of the [c-kzg](https://github.com/benjaminion/c-kzg) library which we have released under the `kzg-wasm` name on npm (and you can also use independently for other projects). See the newly created [GitHub repository](https://github.com/ethereumjs/kzg-wasm) for some library-specific documentation.

This WASM KZG library can now be used for KZG initialization (replacing the old recommended `c-kzg` initialization), see the respective [README section](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/README.md#kzg-initialization) from the tx library for usage instructions (which is also accurate for the other using upstream libraries like block or EVM).

Note that `kzg-wasm` needs to be added manually to your own dependencies and the KZG initialization code needs to be adopted like the following (which you will likely want to do in most cases, so if you deal with post Dencun EVM bytecode and/or 4844 blob txs in any way):

```typescript
import { loadKZG } from 'kzg-wasm'
import { Chain, Common, Hardfork } from '@ethereumjs/common'

const kzg = await loadKZG()

// Instantiate `common`
const common = new Common({
  chain: Chain.Mainnet,
  hardfork: Hardfork.Cancun,
  customCrypto: { kzg },
})
```

Manual addition is necessary because we did not want to bundle our libraries with WASM code by default, since some projects are then prevented from using our libraries.

Note that passing in the KZG setup file is not necessary anymore, since this is now defaulting to the setup file from the official [KZG ceremony](https://ceremony.ethereum.org/) (which is now bundled with the KZG library).

#### Trie Node.js Import Bug

Since this fits well also to be placed here relatively prominently for awareness: we had a relatively nasty bug in the `@ethereumjs/trie` library with a `Node.js` web stream import also affecting browser compatibility, see PR [#3280](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3280). This bug has been fixed along with these releases and this library now references the updated trie library version.

## 5.2.1 - 2024-02-08

- Hotfix release adding a missing `debug` dependency to the `@ethereumjs/trie` package (dependency), PR [#3271](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3271)

## 5.2.0 - 2024-02-08

### Dencun Hardfork Support

While all EIPs contained in the upcoming Dencun hardfork run pretty much stable within the EthereumJS libraries for quite some time, this is the first release round which puts all this in the official space and removes "experimental" labelling preparing for an imminent Dencun launch on the last testnets (Holesky) and mainnet activation! 🎉

Dencun hardfork on the execution side is called [Cancun](https://github.com/ethereum/execution-specs/blob/master/network-upgrades/mainnet-upgrades/cancun.md) and can be activated within the EthereumJS libraries (default hardfork still `Shanghai`) with a following `common` instance:

```typescript
import * as kzg from 'c-kzg'
import { Common, Chain, Hardfork } from '@ethereumjs/common'
import { initKZG } from '@ethereumjs/util'

initKZG(kzg, __dirname + '/../../client/src/trustedSetups/official.txt')
const common = new Common({
  chain: Chain.Mainnet,
  hardfork: Hardfork.Cancun,
  customCrypto: { kzg: kzg },
})
console.log(common.customCrypto.kzg) // Should print the initialized KZG interface
```

Note that the `kzg` initialization slightly changed from previous experimental releases and a custom KZG instance is now passed to `Common` by using the `customCrypto` parameter, see PR [#3262](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3262).

At the moment using the Node.js bindings for the `c-kzg` library is the only option to get KZG related functionality to work, note that this solution is not browser compatible. We are currently working on a WASM build of that respective library. Let us know on the urgency of this task! 😆

While `EIP-4844` - activating shard blob transactions - is for sure the most prominent EIP from this hardfork, enabling better scaling for the Ethereum ecosystem by providing cheaper block space for L2s, there are in total 6 EIPs contained in the Dencun hardfork. The following is an overview of which EthereumJS libraries mainly implement the various EIPs:

- EIP-1153: Transient storage opcodes (`@ethereumjs/evm`)
- EIP-4788: Beacon block root in the EVM (`@ethereumjs/block`, `@ethereumjs/evm`, `@ethereumjs/vm`)
- EIP-4844: Shard Blob Transactions (`@ethereumjs/tx`, `@ethereumjs/block`, `@ethereumjs/evm`)
- EIP-5656: MCOPY - Memory copying instruction (`@ethereumjs/evm`)
- EIP-6780: SELFDESTRUCT only in same transaction (`@ethereumjs/vm`)
- EIP-7516: BLOBBASEFEE opcode (`@ethereumjs/block`, `@ethereumjs/evm`)

### WASM Crypto Support

With this release round there is a new way to replace the native JS crypto primitives used within the EthereumJS ecosystem by custom/other implementations in a controlled fashion, see PR [#3192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3192).

This can e.g. be used to replace time-consuming primitives like the commonly used `keccak256` hash function with a more performant WASM based implementation, see `@ethereumjs/common` [README](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/common) for some detailed guidance on how to use.

### New addSignature() API Method

There is a new dedicated method `addSignature()` introduced for all tx types which allows to add the raw signature values to a transaction without the need to call into `tx.sign()`, which would need a private key to do so, see PR [#3238](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3238).

This functionality is e.g. handy for hardware wallet implementations where the signature generation is taking place externally.

### Self-Contained (and Working 🙂) README Examples

All code examples in `EthereumJS` monorepo library README files are now self-contained and can be executed "out of the box" by simply copying them over and running "as is", see tracking issue [#3234](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3234) for an overview. Additionally all examples can now be found in the respective library [examples](./examples/) folder (in fact the README examples are now auto-embedded from over there). As a nice side effect all examples are now run in CI on new PRs and so do not risk to get outdated or broken over time.

## 5.1.0 - 2023-10-26

### More Type-Aligned Library Structure

This release gently introduces a backwards-compatible new/adopted library structure which is more aligned with the idea of independent tx types, bundling various functionalities together in a way that is not necessarily hierarchical, see PR [#2993](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2993) and [#3010](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3010).

Reused functionality (e.g. calculating the upfront-cost (`getUpfrontCost()`) of an `EIP-1559`-compatible tx - is internally bundled in capability files (e.g. `capabilities/eip1559.ts`), which provide static call access to the respective methods.

These methods are then called and the functionality exposed by the respective methods in the tx classes, see the following example code for an `FeeMarketEIP1559Transaction`:

```ts
getUpfrontCost(baseFee: bigint = BigInt(0)): bigint {
    return EIP1559.getUpfrontCost(this, baseFee)
  }
```

This makes creating additional or custom tx types and reusing of existing functionality substantially easier and makes the library substantially more robust by largely consolidating previously redundant code parts.

### Dencun devnet-11 Compatibility

This release contains various fixes and spec updates related to the Dencun (Deneb/Cancun) HF and is now compatible with the specs as used in [devnet-11](https://github.com/ethpandaops/dencun-testnet) (October 2023).

- Update peer dependency for `kzg` module to use the official trusted setup for `mainnet`, PR [#3107](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3107)

### Other Changes

- Performance: cache tx sender to avoid redundant and costly `ecrecover` calls, PR [#2985](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2985)
- Add new method `getDataFee()` to `BlobEIP4844Transaction`, PR [#2955](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2955)

## 5.0.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Ftx%405.0.0-rc.1) for the main change description.

Following additional changes since RC1:

- 4844: Rename `dataGas` to `blobGas` (see EIP-4844 PR [#7354](https://github.com/ethereum/EIPs/pull/7354)), PR [#2919](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2919)

## 5.0.0-rc.1 - 2023-07-18

This is the release candidate (RC1) for the upcoming breaking releases on the various EthereumJS libraries. The associated release notes below are the main source of information on the changeset, also for the upcoming final releases, where we'll just provide change addition summaries + references to these RC1 notes.

At time of the RC1 releases there is/was no plan for a second RC round and breaking releases following relatively shorty (2-3 weeks) after the RC1 round. Things may change though depending on the feedback we'll receive.

### Introduction

This round of breaking releases brings the EthereumJS libraries to the browser. Finally! 🤩

While you could use our libraries in the browser libraries before, there had been caveats.

WE HAVE ELIMINATED ALL OF THEM.

The largest two undertakings: First: we have rewritten all (half) of our API and eliminated the usage of Node.js specific `Buffer` all over the place and have rewritten with using `Uint8Array` byte objects. Second: we went through our whole stack, rewrote imports and exports, replaced and updated dependencies all over and are now able to provide a hybrid CommonJS/ESM build, for all libraries. Both of these things are huge.

Together with some few other modifications this now allows to run each (maybe adding an asterisk for client and devp2p) of our libraries directly in the browser - more or less without any modifications - see the `examples/browser.html` file in each package folder for an easy to set up example.

This is generally a big thing for Ethereum cause this brings the full Ethereum Execution Layer (EL) protocol stack to the browser in an easy accessible way for developers, for the first time ever! 🎉

This will allow for easy-to-setup browser applications both around the existing as well as the upcoming Ethereum EL protocol stack in the future. 🏄🏾‍♂️ We are beyond excitement to see what you guys will be building with this for "Browser-Ethereum". 🤓

Browser is not the only thing though why this release round is exciting: default Shanghai hardfork, full Cancun support, significantly smaller bundle sizes for various libraries, new database abstractions, a simpler to use EVM, API clean-ups throughout the whole stack. These are just the most prominent additional things here to mention which will make the developer heart beat a bit faster hopefully when you are scanning to the vast release notes for every of the 15 (!) releases! 🧑🏽‍💻

So: jump right in and enjoy. We can't wait to hear your feedback and see if you agree that these releases are as good as we think they are. 🙂 ❤️

The EthereumJS Team

### Default Shanghai HF / Merge -> Paris Renaming / Full Cancun Hardfork Support

The Shanghai hardfork is now the default HF in `@ethereumjs/common` and therefore for all libraries who use a Common-based HF setting internally (e.g. Tx, Block or EVM), see PR [#2655](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2655).

Also the Merge HF has been renamed to Paris (`Hardfork.Paris`) which is the correct HF name on the execution side, see [#2652](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2652). To set the HF to Paris in Common you can do:

```ts
import { Chain, Common, Hardfork } from '@ethereumjs/common'
const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Paris })
```

And third on hardforks 🙂: the upcoming Cancun hardfork is now fully supported and all EIPs are included (see PRs [#2659](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2659) and [#2892](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2892)). The Cancun HF can be activated with:

```ts
import { Chain, Common, Hardfork } from '@ethereumjs/common'
const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun })
```

Note that not all Cancun EIPs are in a `FINAL` EIP state though and particularly `EIP-4844` will likely still receive some changes.

### API Validation Methods Clean-Up

We have cleaned up and unified the validation methods in the `Tx` library, see PR [#2792](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2792).

The `Tx.validate()` method (so: for all tx types), previously overloaded with different return types depending on the input, has been split up into:

```ts
Tx.isValid(): boolean
Tx.getValidationErrors(): string[] // If you are interested in the errors, can also be used for validation by checking return array length
```

The overloaded method `Tx.getMessageToSign()` has been split up into two methods:

```ts
getMessageToSign(): Uint8Array | Uint8Array[] // For the unhashed message
getHashedMessageToSign(): Uint8Array // For the hashed message
```

### EIP-4844 Support (Status: Review, 4844-devnet-7, July 2023)

While there might be last-round final tweaks, [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844) is closing in on its final format. A lot of spec changes happened during the last 2-3 months and these are included in this release round. So the released version should be relatively close to a future production ready version.

This release supports EIP-4844 along this snapshot [b9a5a11](https://github.com/ethereum/EIPs/commit/b9a5a117ab7e1dc18f937841d00598b527c306e7)from the EIP repository with the EIP being in `Review` status and features/changes included which made it into [4844-devnet-7](https://github.com/ethpandaops/4844-testnet).

#### KZG Initialization -> @ethereumjs/util

The global initialization method for the KZG setup has been moved to a dedicated [kzg.ts](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/util/src/kzg.ts) module in `@ethereumjs/util` for easy reuse across the libraries, see PR [#2567](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2567).

The `initKZG()` method can be used as follows:

```ts
// Make the kzg library available globally
import * as kzg from 'c-kzg'
import { initKZG } from '@ethereumjs/util'

// Initialize the trusted setup
initKZG(kzg, 'path/to/my/trusted_setup.txt')
```

For further information on this see the respective section in `@ethereumjs-util` [README](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util).

### Simple Blob Constructor Parameter

We have added a new `blobsData` parameter to `BlobEIP4844TxData` which allows for an easier Tx initialization with arbitrary blob data, see PR [#2755](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2755).

You can simply pass any arbitrary data to this new data parameter, and separate blobs are automatically extracted and `kzgCommitments` and `versionedHashes` computed for you 🤯:

```ts
import { BlobEIP4844Transaction } from '@ethereumjs/tx'

const simpleBlobTx = BlobEIP4844Transaction.fromTxData(
  {
    blobsData: ['hello world'],
    maxFeePerDataGas: 100000000n,
    gasLimit: 0xffffffn,
    to: 0x1122334455667788991011121314151617181920,
  },
  { common },
)
```

#### Library Changes

The following changes are included:

- Update blob tx type to 0x03, PR [#2363](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2636)
- Fix the deserialization of blob txs and add no empty blobs validation, PR [#2640](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2640)
- Update eip4844 blocks/txs to decoupled blobs spec, PR [#2567](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2567)
- Update c-kzg to big endian implementation (versioned hashes), PR [#2746](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2746)
- Update the kzg validation and replace trusted setup with latest (devnet6), PR [#2756](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2756)

### Hybrid CJS/ESM Build

We now provide both a CommonJS and an ESM build for all our libraries. 🥳 This transition was a huge undertaking and should make the usage of our libraries in the browser a lot more straight-forward, see PR [#2685](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2685), [#2783](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2783), [#2786](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2786), [#2764](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2764), [#2804](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2804) and [#2809](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2809) (and others). We rewrote the whole set of imports and exports within the libraries, updated or completely removed a lot of dependencies along the way and removed the usage of all native Node.js primitives (like `https` or `util`).

There are now two different build directories in our `dist` folder, being `dist/cjs` for the CommonJS and `dist/esm` for the `ESM` build. That means that direct imports (which you generally should try to avoid, rather open an issue on your import needs), need an update within your code (do a `dist` or the like code search).

Both builds have respective separate entrypoints in the distributed `package.json` file.

A CommonJS import of our libraries can then be done like this:

```ts
const { Chain, Common } = require('@ethereumjs/common')
const common = new Common({ chain: Chain.Mainnet })
```

And this is how an ESM import looks like:

```ts
import { Chain, Common } from '@ethereumjs/common'
const common = new Common({ chain: Chain.Mainnet })
```

Using ESM will give you additional advantages over CJS beyond browser usage like static code analysis / Tree Shaking which CJS can not provide.

Side note: along this transition we also rewrote our whole test suite (yes!!!) to now work with [Vitest](https://vitest.dev/) instead of `Tape`.

### Buffer -> Uint8Array

With these releases we remove all Node.js specific `Buffer` usages from our libraries and replace these with [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) representations, which are available both in Node.js and the browser (`Buffer` is a subclass of `Uint8Array`). While this is a big step towards interoperability and browser compatibility of our libraries, this is also one of the most invasive operations we have ever done, see the huge changeset from PR [#2566](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2566) and [#2607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2607). 😋

We nevertheless think this is very much worth it and we tried to make transition work as easy as possible.

#### How to upgrade?

For this library you should check if you use one of the following constructors, methods, constants or types and do a search and update input and/or output values or general usages and add conversion methods if necessary:

```ts
// All tx types (Transaction is placeholder for specific type class, e.g. FeeMarketEIP1559Transaction)
TransactionFactory.fromTxData() // data field
Transaction.fromValuesArray() // whole array
Transaction.fromSerializedTx()
Transaction.accessList: AccessListBytes // property
Transaction.raw()
Transaction.serialize(): Uint8Array
Transaction.getMessageToSign(), Transaction.getHashedMessageToSign() // Generally refactored
Transaction.hash(): Uint8Array
Transaction.getMessageToVerifySignature(): Uint8Array
Transaction.getSenderPublicKey(): Uint8Array
Transaction.sign(privateKey: Uint8Array): TransactionObject

// TransactionFactory
TransactionFactory.fromTxData()
TransactionFactory.fromSerializedData()
TransactionFactory.fromBlockBodyData()

// 2930 transactions
TransactionFactory.fromTxData() // accessList

// 1559 transactions
// All 2930 changes + ...
FeeMarketEIP1559Transaction.maxFeePerGas // property
FeeMarketEIP1559Transaction.maxPriorityFeePerGas // property

// 4844 transactions
// All 1559 changes + ...
BlobEIP4844Transaction.fromTxData() // versionedHashes, blobs, kzgCommitments, kzgProof
BlobEIP4844Transaction.versionedHashes: Uint8Array[] // property
BlobEIP4844Transaction.blobs?: Uint8Array[] // optional property
BlobEIP4844Transaction.kzgCommitments?: Uint8Array[] // optional property
BlobEIP4844Transaction.aggregateKzgProof?: Uint8Array // optional property
BlobEIP4844Transaction.fromSerializedBlobTxNetworkWrapper()
BlobEIP4844Transaction.serializeNetworkWrapper()
BlobEIP4844Transaction.unsignedHash(): Uint8Array

// Types
type AccessListBytesItem // old: AccessListBufferItem
type AccessListBytes // old: AccessListBuffer
isAccessListBytes() // old: isAccessListBuffer()
isAccessList()
type TxData

// util
AccessLists.getAccessListData()
AccessLists.verifyAccessList()
AccessLists.getAccessListJSON()
AccessLists.getDataFeeEIP2930()

// blobHelpers
getBlobs()
blobsToCommitments()
commitmentsToVersionedHashes()
```

We have converted existing Buffer conversion methods to Uint8Array conversion methods in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

#### Prefixed Hex Strings as Default

The mixed usage of prefixed and unprefixed hex strings is a constant source of errors in byte-handling code bases.

We have therefore decided to go "prefixed" by default, see PR [#2830](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2830) and [#2845](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2845).

The `hexToBytes` and `bytesToHex` methods, also similar methods like `intToHex`, now take `0x`-prefixed hex strings as input and output prefixed strings. The corresponding unprefixed methods are marked as `deprecated` and usage should be avoided.

Please therefore check you code base on updating and ensure that values you are passing to constructors and methods are prefixed with a `0x`.

### Other Changes

- Support for `Node.js 16` has been removed (minimal version: `Node.js 18`), PR [#2859](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2859)
- Migrate `fromEthersProvider()` to more general `fromJsonRpcProvider()` constructor, remove `Ethers` dependency, PR [#2663](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2663)
- EIP-4844: De-sszify 4844 blob transaction, PR [#2708](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2708)
- Normalize `toJSON()` for different tx types, PR [#2707](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2707)
- Remove `@chainsafe/ssz` dependency, PR [#2717](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2717)

## 4.1.2 - 2023-04-20

### Features

- Add `allowUnlimitedInitcodeSize` option to partially disable EIP-3860, PR [#2594](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2594)
- Better Optimism RPC compatibility, new `TransactionFactory.fromRPCTx()` static constructor, PR [#2613](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2613)

### Bugfixes

- Fixed EIP-3860 (max init code size) check when deserializing RLPs, PR [#2601](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2601)
- EIP-3860: only check max init code size on create contract tx, PR [#2575](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2575)

### Maintenance

- Removed `Ethers` dependency, alternative `fromEthersProvider()` static constructor implementation, PR [#2633](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2633)
- Bump `@ethereumjs/util` `@chainsafe/ssz` dependency to 0.11.1 (no WASM, native SHA-256 implementation, ES2019 compatible, explicit imports), PRs [#2622](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2622), [#2564](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2564) and [#2656](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2656)
- Update ethereum-cryptography from 1.2 to 2.0 (switch from noble-secp256k1 to noble-curves), PR [#2641](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2641)

## 4.1.1 - 2023-02-27

- Pinned `@ethereumjs/util` `@chainsafe/ssz` dependency to `v0.9.4` due to ES2021 features used in `v0.10.+` causing compatibility issues, PR [#2555](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2555)
- Fixed `kzg` imports, PR [#2552](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2552)

## 4.1.0 - 2023-02-21

**DEPRECATED**: Release is deprecated due to broken dependencies, please update to the subsequent bugfix release version.

### Functional Shanghai Support

This release fully supports all EIPs included in the [Shanghai](https://github.com/ethereum/execution-specs/blob/master/network-upgrades/mainnet-upgrades/shanghai.md) feature hardfork scheduled for early 2023. Note that a `timestamp` to trigger the `Shanghai` fork update is only added for the `sepolia` testnet and not yet for `goerli` or `mainnet`.

You can instantiate a Shanghai-enabled Common instance for your transactions with:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai })
```

### Experimental EIP-4844 Shard Blob Transactions Support

This release supports an experimental version of the blob transaction type introduced with [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844) as being specified in the [01d3209](https://github.com/ethereum/EIPs/commit/01d320998d1d53d95f347b5f43feaf606f230703) EIP version from February 8, 2023 and deployed along `eip4844-devnet-4` (January 2023), see PR [#2349](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2349) as well as PRs [#2522](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2522) and [#2526](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2526).

**Note:** This functionality needs a manual KZG library installation and global initialization, see [KZG Setup](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/tx/README.md#kzg-setup) for instructions.

##### Usage

See the following code snipped for an example on how to instantiate.

```ts
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { BlobEIP4844Transaction, initKZG } from '@ethereumjs/tx'
import * as kzg from 'c-kzg'

initKZG(kzg, 'path/to/my/trusted_setup.txt')
const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai, eips: [4844] })

const txData = {
  data: '0x1a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  gasLimit: '0x02625a00',
  maxPriorityFeePerGas: '0x01',
  maxFeePerGas: '0xff',
  maxFeePerDataGas: '0xfff',
  nonce: '0x00',
  to: '0xcccccccccccccccccccccccccccccccccccccccc',
  value: '0x0186a0',
  v: '0x01',
  r: '0xafb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9',
  s: '0x479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64',
  chainId: '0x01',
  accessList: [],
  type: '0x05',
  versionedHashes: ['0xabc...'], // Test with empty array on a first run
  kzgCommitments: ['0xdef...'], // Test with empty array on a first run
  blobs: ['0xghi...'], // Test with empty array on a first run
}

const tx = BlobEIP4844Transaction.fromTxData(txData, { common })
```

Note that `versionedHashes` and `kzgCommitments` have a real length of 32 bytes and `blobs` have a real length of `4096` bytes and values are trimmed here for brevity.

See the [Blob Transaction Tests](./test/eip4844.spec.ts) for examples of usage in instantiating, serializing, and deserializing these transactions.

## 4.0.2 - 2022-12-09

Maintenance release with dependency updates, PR [#2445](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2445)

## 4.0.1 - 2022-10-18

### Support for Geth genesis.json Genesis Format

For lots of custom chains (for e.g. devnets and testnets), you might come across a [Geth genesis.json config](https://geth.ethereum.org/docs/interface/private-network) which has both config specification for the chain as well as the genesis state specification.

`Common` now has a new constructor `Common.fromGethGenesis()` - see PRs [#2300](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2300) and [#2319](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2319) - which can be used in following manner to instantiate for example a VM run or a tx with a `genesis.json` based Common:

```ts
import { Common } from '@ethereumjs/common'
// Load geth genesis json file into lets say `genesisJson` and optional `chain` and `genesisHash`
const common = Common.fromGethGenesis(genesisJson, { chain: 'customChain', genesisHash })
// If you don't have `genesisHash` while initiating common, you can later configure common (for e.g.
// calculating it afterwards by using the `@ethereumjs/blockchain` package)
common.setForkHashes(genesisHash)
```

### New Ethers Static Constructor

There is a new static constructor `TransactionFactory.fromEthersProvider()` which has been added to the library, see PR [#2315](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2315). The new constructor allows for an easy instantiation of a fitting transaction object using an [Ethers](https://ethers.io) provider connecting e.g. to a local node or a service provider like Infura.

### Other Changes and Fixes

- Disallow tx initialization with values incorrectly passed in as arrays, PR [#2284](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2284)

## 4.0.0 - 2022-09-06

Final release - tada 🎉 - of a wider breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2, Beta 3 and Release Candidate (RC) 1 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/CHANGELOG.md)).

### Changes

- Internal refactor: removed ambiguous boolean checks within conditional clauses, PR [#2250](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2250)

## 4.0.0-rc.1 - 2022-08-29

Release candidate 1 for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 and 3 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/CHANGELOG.md)).

### Fixed Mainnet Merge HF Default

Since this bug was so severe it gets its own section: `mainnet` in the underlying `@ethereumjs/common` library (`Chain.Mainnet`) was accidentally not updated yet to default to the `merge` HF (`Hardfork.Merge`) by an undiscovered overwrite back to `london`.

This has been fixed in PR [#2206](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2206) and `mainnet` now default to the `merge` as well.

### Maintenance Updates

- Added `engine` field to `package.json` limiting Node versions to v14 or higher, PR [#2164](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2164)
- Replaced `nyc` (code coverage) configurations with `c8` configurations, PR [#2192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2192)
- Code formats improvements by adding various new linting rules, see Issue [#1935](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1935)

## 4.0.0-beta.3 - 2022-08-10

Beta 3 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/CHANGELOG.md)).

### Merge Hardfork Default

Since the Merge HF is getting close we have decided to directly jump on the `Merge` HF (before: `Istanbul`) as default in the underlying `@ethereumjs/common` library and skip the `London` default HF as we initially intended to set (see Beta 1 CHANGELOG), see PR [#2087](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2087).

This means that if this library is instantiated without providing an explicit `Common`, the `Merge` HF will be set as the default hardfork and the behavior of the library changes according to up-to-`Merge` HF rules.

If you want to prevent these kind of implicit HF switches in the future it is likely a good practice to just always do your upper-level library instantiations with a `Common` instance setting an explicit HF, e.g.:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
const tx = LegacyTransaction.fromTxData(
  {
    // Provide your tx data here or use default values
  },
  { common },
)
```

## 4.0.0-beta.2 - 2022-07-15

Beta 2 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/CHANGELOG.md)) for the main change set description.

### Removed Default Exports

The change with the biggest effect on UX since the last Beta 1 releases is for sure that we have removed default exports all across the monorepo, see PR [#2018](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2018), we even now added a new linting rule that completely disallows using.

Default exports were a common source of error and confusion when using our libraries in a CommonJS context, leading to issues like Issue [#978](https://github.com/ethereumjs/ethereumjs-monorepo/issues/978).

Now every import is a named import and we think the long term benefits will very much outweigh the one-time hassle of some import adoptions.

#### Common Library Import Updates

Since our [@ethereumjs/common](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/common) library is used all across our libraries for chain and HF instantiation this will likely be the one being the most prevalent regarding the need for some import updates.

So Common import and usage is changing from:

```ts
import Common, { Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Merge })
```

to:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Merge })
```

### Removed Default Imports in this Library

While the root import of the tx type classes didn't change you might need to adopt your tx type imports if you have some custom or unusual ways to import (e.g. using deeper-referencing than necessary import paths).

## Other Changes

- Added `ESLint` strict boolean expressions linting rule, PR [#2030](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2030)

## 4.0.0-beta.1 - 2022-06-30

This release is part of a larger breaking release round where all [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries (VM, Tx, Trie, other) get major version upgrades. This round of releases has been prepared for a long time and we are really pleased with and proud of the result, thanks to all team members and contributors who worked so hard and made this possible! 🙂 ❤️

We have gotten rid of a lot of technical debt and inconsistencies and removed unused functionality, renamed methods, improved on the API and on TypeScript typing, to name a few of the more local type of refactoring changes. There are also broader structural changes like a full transition to native JavaScript `BigInt` values as well as various somewhat deep-reaching refactorings, both within a single package as well as some reaching beyond the scope of a single package. Also two completely new packages - `@ethereumjs/evm` (in addition to the existing `@ethereumjs/vm` package) and `@ethereumjs/statemanager` - have been created, leading to a more modular Ethereum JavaScript VM.

We are very much confident that users of the libraries will greatly benefit from the changes being introduced. However - along the upgrade process - these releases require some extra attention and care since the changeset is both so big and deep reaching. We highly recommend to closely read the release notes, we have done our best to create a full picture on the changes with some special emphasis on delicate code and API parts and give some explicit guidance on how to upgrade and where problems might arise!

So, enjoy the releases (this is a first round of Beta releases, with final releases following a couple of weeks after if things go well)! 🎉

The EthereumJS Team

### London Hardfork Default

In this release the underlying `@ethereumjs/common` version is updated to `v3` which sets the default HF to `London` (before: `Istanbul`).

This means that a Transaction object instantiated without providing an explicit `Common` is using `London` as the default hardfork as well and behavior of the library changes according to up-to-`London` HF rules.

If you want to prevent these kind of implicit HF switches in the future it is likely a good practice to just always do your upper-level library instantiations with a `Common` instance setting an explicit HF, e.g.:

```ts
import Common, { Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Merge })
const tx = LegacyTransaction.fromTxData(
  {
    // Provide your tx data here or use default values
  },
  { common },
)
```

### BigInt Introduction / ES2020 Build Target

With this round of breaking releases the whole EthereumJS library stack removes the [BN.js](https://github.com/indutny/bn.js/) library and switches to use native JavaScript [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) values for large-number operations and interactions.

This makes the libraries more secure and robust (no more BN.js v4 vs v5 incompatibilities) and generally comes with substantial performance gains for the large-number-arithmetic-intense parts of the libraries (particularly the VM).

To allow for BigInt support our build target has been updated to [ES2020](https://262.ecma-international.org/11.0/). We feel that some still remaining browser compatibility issues on the edges (old Safari versions e.g.) are justified by the substantial gains this step brings along.

See [#1671](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1671) and [#1771](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1771) for the core `BigInt` transition PRs.

### Disabled esModuleInterop and allowSyntheticDefaultImports TypeScript Compiler Options

The above TypeScript options provide some semantic sugar like allowing to write an import like `import React from "react"` instead of `import * as React from "react"`, see [esModuleInterop](https://www.typescriptlang.org/tsconfig#esModuleInterop) and [allowSyntheticDefaultImports](https://www.typescriptlang.org/tsconfig#allowSyntheticDefaultImports) docs for some details.

While this is convenient it deviates from the ESM specification and forces downstream users into these options which might not be desirable, see [this TypeScript Semver docs section](https://www.semver-ts.org/#module-interop) for some more detailed argumentation.

Along the breaking releases we have therefore deactivated both of these options and you might therefore need to adopt some import statements accordingly. Note that you still have got the possibility to activate these options in your bundle and/or transpilation pipeline (but now you also have the option to _not_ do which you didn't have before).

### BigInt-Related API Changes

All transaction data input which have been previously taken in as `BNLike` (see `Util` library) - like `gasPrice` or `nonce` - are now taken in as `BigIntLike` and internally stored as a `BigInt`.

Have a look at your object instantiations on how you do things and if you need to update.

The following method signatures have been changed along the update and need some attention:

- `getBaseFee(): bigint`
- `getDataFee(): bigint`
- `getUpfrontCost(): bigint`

### API Method/Getter Removals

Additionally the following deprecated methods/getters have been removed from the API, see PR [#1742](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1742):

- `get transactionType()`
- `get senderR()` (alias for `r`)
- `get senderS()` (`alias for s`)
- `get yParity()` (`alias for v`)
- `tx.fromRlpSerializedTx()`
- `TransactionFactory.getTransactionClass()`

### Reduced Bundle Size (MB -> KB)

The bundle size of the library has been dramatically reduced going down from MBs to KBs due to a reworked genesis code handling throughout the library stack in PR [#1916](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1916) allowing the `Common` library to now ship without the bundled (large) genesis state definitions (especially for mainnet).

### RLP Changes

If you are dealing with RLP encoded data and use the EthereumJS RLP library for decoding, please note that RLP library also got a major update and has been renamed along the way from `rlp` to a namespaced `@ethereumjs/rlp`, see RLP `v4.0.0-beta.1` (and following) release notes in the [CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md#400-beta1---2022-06-30).

If you are updating from v2 you will likely also stumble upon the fact that with `v3` RLP replaces Buffers as input and output values in favor of Uint8Arrays for improved performance and greater compatibility with browsers.

New conversion functions have also been added to the `@ethereumjs/util` library, see [RLP docs](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/rlp#buffer-compatibility) on how to use and do the conversion.

### Other Changes

- The `hash()` function is now throwing when called on an unsigned legacy tx (this aligns the behavior with the other tx types), PR [#1894](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1894)
- Signature processing code has been updated to use `@ethereumjs/util` `v8`, PR [#1945](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1945)

## 3.5.2 - 2022-06-02

- Fixed a bug where tx options would not propagate from an unsigned to a signed tx when using the `sign()` function (there are not that many tx options, this is therefore in most cases not practically relevant and rather a guard for future option additions), PR [#1884](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1884)
- Stricter `v` value validation for legacy txs, PR [#1905](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1905)

## 3.5.1 - 2022-03-15

### EIP-3860 Support: Limit and Meter Initcode

Support for [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860) has been added to the Tx library. This EIP limits the maximum size of initcode to 49152, see PR [#1619](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1619).

Note that this EIP is not part of a specific hardfork yet and is considered `EXPERIMENTAL` (implementation can change along bugfix releases).

For now the EIP has to be activated manually which can be done by using a respective `Common` instance:

```ts
const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London, eips: [3860] })
```

## 3.5.0 - 2022-02-01

This release comes with various additional checks on integrity and maximally allowed values for input values on tx creation. All these checks are activated by default as being suggested by the respective EIPs (e.g. `EIP-2681`).

- [EIP-2681](https://eips.ethereum.org/EIPS/eip-2681) support: Limit account nonce to 2^64-1, PR [#1568](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1568)
- `gasLimit` limited to 2^64-1 (`MAX_UINT64`) (geth behaviour), PR [#1568](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1568)
- No-leading-zeros validation for serialized (RLP based) integer value input, so e.g the `nonce` or `gasLimit` values (`fromSerializedTx()` and `fromValuesArray()` static constructor methods), PR [#1568](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1568)
- `MAX_INTEGER` (2^256) `gasLimit * maxFeePerGas`, `gasLimit * gasPrice` checks, PR [#1568](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1568)
- Tx creation now fails when trying to instantiate with a negative `BN` value, PR [#1606](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1606)

## 3.4.0 - 2021-11-09

### ArrowGlacier HF Support

This release adds support for the upcoming [ArrowGlacier HF](https://github.com/ethereum/execution-specs/blob/master/network-upgrades/mainnet-upgrades/arrow-glacier.md) (see PR [#1527](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1527)) targeted for December 2021. The only included EIP is [EIP-4345](https://eips.ethereum.org/EIPS/eip-4345) which delays the difficulty bomb to June/July 2022.

Please note that for backwards-compatibility reasons the associated Common is still instantiated with `istanbul` by default.

An ArrowGlacier transaction can be instantiated with:

```ts
import { Transaction } from '@ethereumjs/tx'
import Common, { Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.ArrowGlacier })
const tx = LegacyTransaction.fromTxData({}, { common })
```

### Additional Error Context for Error Messages

This release extends the text of the error messages in the library with some consistent context information (see PR [#1540](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1540)), here an example for illustration:

Before:

```shell
Invalid Signature: s-values greater than secp256k1n/2 are considered invalid
```

New:

```
Invalid Signature: s-values greater than secp256k1n/2 are considered invalid (tx type=1 hash=0xbf78bd19410294cb3c08fbbbdd675b4bd79e46b96b38e850091f5c03e0571be0 nonce=0 value=0 signed=true hf=london gasPrice=0 accessListCount=0)
```

The extended errors give substantial more object and chain context and should ease debugging.

**Potentially breaking**: Attention! If you do react on errors in your code and do exact error matching (`error.message === 'invalid transaction trie'`) things will break. Please make sure to do error comparisons with something like `error.message.includes('invalid transaction trie')` instead. This should generally be the pattern used for all error message comparisons and is assured to be future proof on all error messages (we won't change the core text in non-breaking releases).

## Other Changes

- The `dataFee` from `tx.getDataFee()` now gets cached for txs created with the `freeze` option (activated by default), PR [#1532](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1532) and PR [#1550](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1550)

## 3.3.2 - 2021-09-30

This release updates the `ethereumjs-util` library to `v7.1.2` which provides a safer conversion of integer values with the `intToHex` and `intToBuffer` functions by replacing the re-exported functions with own implementations which throw on wrong integer input (decimal values, non-safe integers, negative numbers,...), see PR [#1500](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1500).

An upgrade is recommended since this provides a safer user experience for the tx library by not allowing malformed integer values to be passed in for tx number values (e.g. `gasPrice` or `maxPriorityFeePerGas`) which could lead to undefined behavior before.

## 3.3.1 - 2021-09-24

- The hash from the `tx.hash()` method now gets cached for txs created with the `freeze` option (activated by default), PR [#1445](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1445)
- Fixed `getMessageToSign()` return type for `EIP1559Transaction`, PR [#1382](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1382)

## 3.3.0 - 2021-07-08

### Finalized London HF Support

This release integrates a `Common` library version which provides the `london` HF blocks for all networks including `mainnet` and is therefore the first release with finalized London HF support.

### Improved L2 Tx Support

This tx release bumps the `Common` library dependency version to `v2.4.0` and is therefore assured to work with the reworked `Common.custom()` method which can be used for an easier instantiation of common custom chain instances for sending txs to a custom (L2) network.

`Common.custom()` comes with support for predefined custom chains (Arbitrum testnet, Polygon testnet & mainnet, xDai chain), see e.g. the following code example:

```ts
import { Transaction } from '@ethereumjs/tx'
import Common from '@ethereumjs/common'

const from = 'PUBLIC_KEY'
const PRIV_KEY = process.argv[2]
const to = 'DESTINATION_ETHEREUM_ADDRESS'

const common = Common.custom(CustomChain.xDaiChain)

const txData = {
  from,
  nonce: 0,
  gasPrice: 1000000000,
  gasLimit: 21000,
  to,
  value: 1,
}

const tx = LegacyTransaction.fromTxData(txData, { common })
const signedTx = tx.sign(Buffer.from(PRIV_KEY, 'hex'))
```

For a non-predefined custom chain it is also possible to just provide a chain ID as well as other parameters to `Common`:

```ts
const common = Common.custom({ chainId: 1234 })
```

See the tx [README](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/tx) for some more detailed documentation on the new improved L2 support for the tx library.

### New supports(capability) Method

There is a new `tx.supports(capability)` method which can be used for a cleaner and more future-proof switch on txs based on the supported (EIP) capabilities. This is useful if you don't know about your tx type in advance, e.g. since txs are taken from a generic source (a tx pool, user input,...) and instantiated with the provided tx factory.

While it sometimes might make sense to do a switch by `tx.type` it is often more fitting a use case (and also more future proof) to do a switch by a desired tx capability. Does the tx support an EIP-1559 style gas fee market mechanism? Does the tx support access lists?

Such a switch can now be done with the method above

```ts
import { Transaction, Capability } from '@ethereumjs/tx'

// 1. Instantiate tx

// 2. Switch by capability
if (tx.supports(Capability.EIP2930AccessLists)) {
  // Do something which only makes sense for txs with support for access lists
}
```

The following capabilities are currently supported:

```ts
enum Capability {
  EIP155ReplayProtection: 155, // Only for legacy txs
  EIP1559FeeMarket: 1559,
  EIP2718TypedTransaction: 2718, // Use for a typed-tx-or-not switch
  EIP2930AccessLists: 2930
}
```

### Included Source Files

Source files from the `src` folder are now included in the distribution build, see PR [#1301](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1301). This allows for a better debugging experience in debug tools like Chrome DevTools by having working source map references to the original sources available for inspection.

## 3.2.1 - 2021-06-11

This release comes with significant library usability improvements by allowing a tx instantiation more independently from the `Common` library. This was reported and requested by Web3.js (thanks to @gregthegreek for giving some guidance on the discussion) and others, since they needed the possibility of a tx instantiation in unknown contexts where the chain or HF state is somewhat unclear.

So we've decided to do the following tweaks to the libray:

### New Rules for Internal Default HF Setting

Up to `v3.2.0` it was simply necessary/mandatory to pass in a `Common` instance for typed tx instantiation (otherwise the instantiation process would have thrown an error). For compatibility reasons the tx library was still on `istanbul` as the default HF and both `EIP-2930` (access lists) and `EIP-1559` (fee market) txs needed a higher (`berlin` respectively `london`) HF setting. After some reflection we have therefore decided to adopt our tx library tx type default HF setting and go with the following expanded rule:

"The default HF is the default HF from `Common` if the tx type is active on that HF. Otherwise it is set to the first greater HF where the tx is active."

This has been done in PR [#1292](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1292). This should be safe to do since there just are no txs of the specific type before this new default HF (`EIP-2930`: `istanbul` -> `berlin`, `EIP-1559`: `istanbul` -> `london`).

### More Intelligent Default Chain Instantiation

We tried to get more intelligent on the instantiation with a default chain if no `Common` is provided. On older versions of the library `mainnet` was the default fallback here. For typed txs the chain ID is also provided as a data parameter along instantiation. This chain ID parameter is now used for the internal `Common` and therefore the internal chain setting. Same for signed EIP-155 respecting legacy txs, there the chain ID is now extracted from the `v` parameter provided and initialized with the internal `Common` accordingly. For unsigned or non-EIP-1559 legacy txs the chain for `Common` still defaults back to `mainnet`.

Both these changes with the new default HF rules and the more intelligent chain ID instantiation now allows for an e.g. `EIP-155` tx instantiation without a Common (and generally for a safer non-Common tx instantiation) like this:

```ts
import Common from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'

const txData = {
  data: '0x1a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  gasLimit: '0x02625a00',
  maxPriorityFeePerGas: '0x01',
  maxFeePerGas: '0xff',
  nonce: '0x00',
  to: '0xcccccccccccccccccccccccccccccccccccccccc',
  value: '0x0186a0',
  v: '0x01',
  r: '0xafb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9',
  s: '0x479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64',
  chainId: '0x01',
  accessList: [],
  type: '0x02',
}

const tx = FeeMarketEIP1559Transaction.fromTxData(txData)
```

Note that depending on your usage context it might still be a good idea to instantiate with `Common` since you then have a deterministic state setup, explicitly know what rule set your tx is operating on, and are safe towards eventual future behavioral changes (e.g. on a default HF update along a major version tx library bump).

### Signing Txs with a Hardware Wallet

This is just a note on documentation. There has been some confusion around how to use the tx library for signing of a tx with a HW wallet device (e.g. a Ledger) - see Issue [#1228](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1228) - especially around the usage of `tx.getMessageToSign()`. This is now better documented in the code. Dropping here the associated code on how to do for awareness, for some more context have a look into the associated issue:

```ts
import { rlp } from 'ethereumjs-util'
import Common from '@ethereumjs/common'
import { Transaction } from '@ethereumjs/tx'

const common = new Common({ chain: 'goerli', hardfork: 'berlin' })
const tx = LegacyTransaction.fromTxData({}, { common })

const message = tx.getMessageToSign(false)
const serializedMessage = rlp.encode(message) // use this for the ledger input
```

### Other Changes

- EIP-1559 Validation (spec update): The `maxFeePerGas` and `maxPriorityFeePerGas` parameters are now limited in size to not exceed 256-bit to prevent chain spamming, PR [#1272](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1272)
- Code docs have been improved substantially, PR [#1283](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1283)
- Deprecation of `tx.transactionType`, use `tx.type` instead, PR [#1283](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1283)
- Deprecation of `tx.yParity`, `tx.senderR` and `tx.senderS`, use `v`, `r` and `s` instead, PR [#1283](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1283)

## 3.2.0 - 2021-05-26

### Functional London HF Support (no finalized HF blocks yet)

This `Tx` release comes with full functional support for the `london` hardfork (all EIPs are finalized and integrated and `london` HF can be activated, there are no final block numbers for the HF integrated though yet). There is a new [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559) transaction type `FeeMarketEIP1559Transaction` (type `2`) added together with the new data types `FeeMarketEIP1559TxData` (for instantiation with the `fromTxData()` static constructor method) and `FeeMarketEIP1559ValuesArray` (for instantiation with `fromValuesArray()`), see PR [#1148](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1148) for the main implementation work.

An `EIP-1559` tx inherits the access list feature from the `AccessListEIP2930Transaction` (type `1`) but comes with its own gas fee market mechanism. There is no `gasPrice` field in favor of two new gas related properties `maxFeePerGas` - which represents the total gas fee the tx sender is willing to pay for the tx (including the priority fee) - and the `maxPriorityFeePerGas` property - which represents the fee the sender is willing to give as some tip to the miner to prioritize a tx.

An `EIP-1559` tx can be instantiated with:

```ts
import Common from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'

const common = new Common({ chain: 'mainnet', hardfork: 'london' })

const txData = {
  data: '0x1a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  gasLimit: '0x02625a00',
  maxPriorityFeePerGas: '0x01',
  maxFeePerGas: '0xff',
  nonce: '0x00',
  to: '0xcccccccccccccccccccccccccccccccccccccccc',
  value: '0x0186a0',
  v: '0x01',
  r: '0xafb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9',
  s: '0x479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64',
  chainId: '0x01',
  accessList: [],
  type: '0x02',
}

const tx = FeeMarketEIP1559Transaction.fromTxData(txData, { common })
```

Please note that the default HF is still set to `istanbul`. You therefore need to explicitly set the `hardfork` parameter for instantiating a `Tx` instance with a `london` HF activated.

### Bug Fixes

- Fixed `getMessageToSign()` return type for typed txs, PR [#1255](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1255)

### Other Changes

- Deprecated `TransactionFactory.getTransactionClass()` method, PR [#1148](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1148)

## 3.1.4 - 2021-04-22

- Added a new boolean `hashMessage` parameter (defaulting to `true`) to `getMessageToSign()` to allow for returning the raw unsigned `EIP-155` tx and not only the hash, PR [#1188](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1188)

## 3.1.3 - 2021-04-09

This release fixes a critical EIP-2930 tx constructor bug which slipped through our tests and where a tx is not initialized correctly when a `v` value of `0` is passed (which is a common case for EIP-2930 txs). This makes the typed txs unusable on prior versions and an update from a version `v3.1.0` or higher is necessary for working typed tx support. Releases `v3.1.0`, `v3.1.1` and `v3.1.2` are marked as deprecated.

**Change Summary**

- Fixed `AccessListEIP2930Transaction` constructor bug with `v=0`, PR [#1190](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1190)
- Added alias `type` for `transactionType` so it can be interpreted correctly for an `AccessListEIP2930Transaction` instantiation when passed to `fromTxData()`, PR [#1185](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1185)
- `TransactionFactory.fromTxData()`: fixed a bug where instantiation was breaking when `type` was passed in as a 0x-prefixed hex string, PR [#1185](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1185)
- `AccessListEIP2930Transaction`: added a test that initializes correctly from its own data (adds coverage for `type` property alias), PR [#1185](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1185)
- EIP-2930 aliases for `senderS`, `senderR`, `yParity` are now marked as _deprecated_, use `v`, `r`, `s` instead

## 3.1.2 - 2021-03-31

**DEPRECATED**: Release is deprecated in favor of 3.1.3 which fixes a critical EIP-2930 tx constructor bug.

- Fixed default value for empty access lists in the `AccessListEIP2930Transaction.fromValuesArray()` static constructor method, PR [#1179](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1179)

## 3.1.1 - 2021-03-23

**DEPRECATED**: Release is deprecated in favor of 3.1.3 which fixes a critical EIP-2930 tx constructor bug.

This release fixes a bug in the `v3.1.0` Berlin HF `@ethereumjs/tx` release where the import path for `eip2930Transaction` was broken on operating systems with case sensitive filename resolution.

The `v3.1.0` release has been deprecated in favor of this new version.

## 3.1.0 - 2021-03-18

**DEPRECATED**: Release is deprecated in favor of 3.1.1 which fixes an import-path bug.

### Berlin HF Support

This release comes with full support for the `berlin` hardfork by updating the library to support typed transactions ([EIP-2718](https://eips.ethereum.org/EIPS/eip-2718)). The first supported transaction type is the `AccessListEIP2930Transaction` ([EIP-2930](https://eips.ethereum.org/EIPS/eip-2930)) which adds optional access lists to the mix and is activated along with the `berlin` hardfork.

`EIP-2930` transactions can be instantiated with:

```ts
import Common from '@ethereumjs/common'
import { AccessListEIP2930Transaction } from '@ethereumjs/tx'

const common = new Common({ chain: 'mainnet', hardfork: 'berlin' })

const txData = {
  data: '0x1a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  gasLimit: '0x02625a00',
  gasPrice: '0x01',
  nonce: '0x00',
  to: '0xcccccccccccccccccccccccccccccccccccccccc',
  value: '0x0186a0',
  v: '0x01',
  r: '0xafb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9',
  s: '0x479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64',
  chainId: '0x01',
  accessList: [
    {
      address: '0x0000000000000000000000000000000000000101',
      storageKeys: [
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x00000000000000000000000000000000000000000000000000000000000060a7',
      ],
    },
  ],
  type: '0x01',
}

const tx = AccessListEIP2930Transaction.fromTxData(txData, { common })
```

Please note that the default HF is still set to `istanbul`. You therefore need to explicitly set the `hardfork` parameter for instantiating a `Transaction` instance with a `berlin` HF activated.

The now called "legacy" transactions are still supported and can be used as before by using the `Transaction` class. If the type of a tx is only known at runtime there is a new `TransactionFactory` class introduced for your convenience. This factory class decides on the tx type based on the input data and uses the corresponding tx type class for instantiation.

For more guidance on how to use the new tx types and the tx factory have a look at the [README](./README.md) of this library which has received an extensive update along with this release.

#### EthereumJS Libraries - Typed Transactions Readiness

If you are using this library in conjunction with other EthereumJS libraries make sure to minimally have the following library versions installed for typed transaction support:

- `@ethereumjs/common` `v2.2.0`
- `@ethereumjs/tx` `v3.1.0`
- `@ethereumjs/block` `v3.2.0`
- `@ethereumjs/blockchain` `v5.2.0`
- `@ethereumjs/vm` `v5.2.0`

### EIP-2718/EIP-2930 Changes

- Base implementation of both EIPs, PR [#1048](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1048)
- Tx Renaming / Improve backwards-compatibility, PR [#1138](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1138)
- Improvements and additional tests, PR [#1141](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1141)
- Further improvements and small fixes, PR [#1144](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1144)

## 3.0.2 - 2021-02-16

Follow-up release on `v3.0.1` which only partly addressed a **critical** bug. An update is - again - strongly recommended.

- Fixes `tx.isSigned()` always returning true when using the `Tx.fromValuesArray()` static constructor, see PR [#1077](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1077)
- The `Common` instance passed is now copied to avoid side-effects towards the outer common instance on HF updates, PR [#1088](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1088)

## 3.0.1 - 2021-01-20

- Fixes `tx.isSigned()` always returning true - so also for unsigned transactions - due to a bug in the `Transaction` class constructor. This bug is regarded as **critical** and an update is strongly recommended. See PR [#1042](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1042)

## 3.0.0 - 2020-11-24

### New Package Name

**Attention!** This new version is part of a series of EthereumJS releases all moving to a new scoped package name format. In this case the library is renamed as follows:

- `ethereumjs-tx` -> `@ethereumjs/tx`

Please update your library references accordingly or install with:

```shell
npm i @ethereumjs/tx
```

### Major Refactoring - Breaking Changes

This release is a major refactoring of the transaction library to simplify and strengthen its code base. Refactoring work has been done along PR [#812](https://github.com/ethereumjs/ethereumjs-monorepo/pull/812) and PR [#887](https://github.com/ethereumjs/ethereumjs-monorepo/pull/887).

#### New Constructor Params

The constructor has been reworked and new static factory methods `fromTxData`, `fromRlpSerializedTx`, and `fromValuesArray` have been added for a more `TypeScript` friendly and less error-prone way to initialize a `Transaction` object. The direct usage of the main constructor (now just being an alias to `Tx.fromTxData()`, see PR [#944](https://github.com/ethereumjs/ethereumjs-monorepo/pull/944)) is now discouraged and the static factory methods should be used.

**Breaking:** Note that you **need** to adopt your `Transaction` initialization code since the constructor API has changed!

Examples:

```ts
// Initializing from serialized data
const s1 = tx1.serialize().toString('hex')
const tx = Transaction.fromRlpSerializedTx(toBuffer('0x' + s1))

// Initializing with object
const txData = {
  gasPrice: 1000,
  gasLimit: 10000000,
  value: 42,
}
const tx = LegacyTransaction.fromTxData(txData)

// Initializing from array of 0x-prefixed strings.
// First, convert to array of Buffers.
const arr = txFixture.raw.map(toBuffer)
const tx = Transaction.fromValuesArray(arr)
```

Learn more about the full API in the [docs](./docs/README.md).

#### Immutability

The returned transaction is now frozen and immutable. To work with a mutable transaction, copy it with `const fakeTx = Object.create(tx)`. For security reasons it is highly recommended to stay in a freezed `Transaction` context on usage.

If you need `Transaction` mutability - e.g. because you want to subclass `Transaction` and modify its behavior - there is a `freeze` option to prevent the `Object.freeze()` call on initialization, see PR [#941](https://github.com/ethereumjs/ethereumjs-monorepo/pull/941).

#### from

The `tx.from` alias was removed, please use `const from = tx.getSenderAddress()`.

#### Message to sign

Getting a message to sign has been changed from calling `tx.hash(false)` to `tx.getMessageToSign()`.

#### Fake Transaction

The `FakeTransaction` class was removed since its functionality can now be implemented with less code. To create a fake transaction for use in e.g. `VM.runTx()` overwrite `getSenderAddress` with your own `Address`. See a full example in the section in the [README](./README.md#fake-transaction).

### New Default Hardfork

**Breaking:** The default HF on the library has been updated from `petersburg` to `istanbul`, see PR [#906](https://github.com/ethereumjs/ethereumjs-monorepo/pull/906).

The HF setting is now automatically taken from the HF set for `Common.DEFAULT_HARDFORK`, see PR [#863](https://github.com/ethereumjs/ethereumjs-monorepo/pull/863).

### Dual ES5 and ES2017 Builds

We significantly updated our internal tool and CI setup along the work on PR [#913](https://github.com/ethereumjs/ethereumjs-monorepo/pull/913) with an update to `ESLint` from `TSLint` for code linting and formatting and the introduction of a new build setup.

Packages now target `ES2017` for Node.js builds (the `main` entrypoint from `package.json`) and introduce a separate `ES5` build distributed along using the `browser` directive as an entrypoint, see PR [#921](https://github.com/ethereumjs/ethereumjs-monorepo/pull/921). This will result in performance benefits for Node.js consumers, see [here](https://github.com/ethereumjs/merkle-patricia-tree/pull/117) for a related discussion.

### Other Changes

**Changes and Refactoring**

- Updated `ethereumjs-util` to v7, PR [#748](https://github.com/ethereumjs/ethereumjs-monorepo/pull/748)
- Replaced `new Buffer()` (deprecated) statements with `Buffer.from()`, PR [#721](https://github.com/ethereumjs/ethereumjs-monorepo/pull/721)
- Dropped `ethereumjs-testing` dev dependency, PR [#953](https://github.com/ethereumjs/ethereumjs-monorepo/pull/953)

## 3.0.0-rc.1 - 2020-11-19

This is the first release candidate towards a final library release, see [beta.2](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Ftx%403.0.0-beta.2) and especially [beta.1](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Ftx%403.0.0-beta.1) release notes for an overview on the full changes since the last publicly released version.

- Dropped `ethereumjs-testing` dev dependency, PR [#953](https://github.com/ethereumjs/ethereumjs-monorepo/pull/953)

## 3.0.0-beta.2 - 2020-11-12

This is the second beta release towards a final library release, see [beta.1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Ftx%403.0.0-beta.1) for an overview on the full changes since the last publicly released version.

- Added `freeze` option to allow for transaction freeze deactivation (e.g. to allow for subclassing tx and adding additional parameters), see PR [#941](https://github.com/ethereumjs/ethereumjs-monorepo/pull/941)
- **Breaking:** Reworked constructor to take in data as a `TxData` typed dictionary instead of single values, the `Tx.fromTxData()` factory method becomes an alias for the constructor with this change, see PR [#944](https://github.com/ethereumjs/ethereumjs-monorepo/pull/944)

## 3.0.0-beta.1 - 2020-10-22

### New Package Name

**Attention!** This new version is part of a series of EthereumJS releases all moving to a new scoped package name format. In this case the library is renamed as follows:

- `ethereumjs-tx` -> `@ethereumjs/tx`

Please update your library references accordingly or install with:

```shell
npm i @ethereumjs/tx
```

### Major Refactoring - Breaking Changes

This release is a major refactoring of the transaction library to simplify and strengthen its code base. Refactoring work has been done along PR [#812](https://github.com/ethereumjs/ethereumjs-monorepo/pull/812) and PR [#887](https://github.com/ethereumjs/ethereumjs-monorepo/pull/887).

#### New Constructor Params

The constructor used to accept a varying amount of options but now has the following shape:

```ts
  Transaction(
    nonce: BN,
    gasPrice: BN,
    gasLimit: BN,
    to: Address | undefined,
    value: BN,
    data: Buffer,
    v?: BN,
    r?: BN,
    s?: BN,
    opts?: TxOptions
  )
```

Initializing from other data types is assisted with new static factory helpers `fromTxData`, `fromRlpSerializedTx`, and `fromValuesArray`.

Examples:

```ts
// Initializing from serialized data
const s1 = tx1.serialize().toString('hex')
const tx = Transaction.fromRlpSerializedTx(toBuffer('0x' + s1))

// Initializing with object
const txData = {
  gasPrice: 1000,
  gasLimit: 10000000,
  value: 42,
}
const tx = LegacyTransaction.fromTxData(txData)

// Initializing from array of 0x-prefixed strings.
// First, convert to array of Buffers.
const arr = txFixture.raw.map(toBuffer)
const tx = Transaction.fromValuesArray(arr)
```

Learn more about the full API in the [docs](./docs/README.md).

#### Immutability

The returned transaction is now frozen and immutable. To work with a mutable transaction, copy it with `const fakeTx = Object.create(tx)`.

#### from

The `tx.from` alias was removed, please use `const from = tx.getSenderAddress()`.

#### Message to sign

Getting a message to sign has been changed from calling `tx.hash(false)` to `tx.getMessageToSign()`.

#### Fake Transaction

The `FakeTransaction` class was removed since its functionality can now be implemented with less code. To create a fake transaction for use in e.g. `VM.runTx()` overwrite `getSenderAddress` with your own `Address`. See a full example in the section in the [README](./README.md#fake-transaction).

### New Default Hardfork

**Breaking:** The default HF on the library has been updated from `petersburg` to `istanbul`, see PR [#906](https://github.com/ethereumjs/ethereumjs-monorepo/pull/906).
The HF setting is now automatically taken from the HF set for `Common.DEFAULT_HARDFORK`,
see PR [#863](https://github.com/ethereumjs/ethereumjs-monorepo/pull/863).

### Dual ES5 and ES2017 Builds

We significantly updated our internal tool and CI setup along the work on
PR [#913](https://github.com/ethereumjs/ethereumjs-monorepo/pull/913) with an update to `ESLint` from `TSLint`
for code linting and formatting and the introduction of a new build setup.

Packages now target `ES2017` for Node.js builds (the `main` entrypoint from `package.json`) and introduce
a separate `ES5` build distributed along using the `browser` directive as an entrypoint, see
PR [#921](https://github.com/ethereumjs/ethereumjs-monorepo/pull/921). This will result
in performance benefits for Node.js consumers, see [here](https://github.com/ethereumjs/merkle-patricia-tree/pull/117) for a related discussion.

### Other Changes

**Changes and Refactoring**

- Updated `ethereumjs-util` to v7,
  PR [#748](https://github.com/ethereumjs/ethereumjs-monorepo/pull/748)
- Replaced `new Buffer()` (deprecated) statements with `Buffer.from()`,
  PR [#721](https://github.com/ethereumjs/ethereumjs-monorepo/pull/721)

## [2.1.2] - 2019-12-19

- Added support for the `MuirGlacier` HF by updating the `ethereumjs-common` dependency
  to [v1.5.0](https://github.com/ethereumjs/ethereumjs-common/releases/tag/v1.5.0)

[2.1.2]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%402.1.1...%40ethereumjs%2Ftx%402.1.2

## [2.1.1] - 2019-08-30

- Added support for `Istanbul` reduced non-zero call data gas prices
  ([EIP-2028](https://eips.ethereum.org/EIPS/eip-2028)),
  PR [#171](https://github.com/ethereumjs/ethereumjs-tx/pull/171)

[2.1.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%402.1.0...%40ethereumjs%2Ftx%402.1.1

## [2.1.0] - 2019-06-28

**Using testnets and custom/private networks is now easier**

This release is focused on making this library easier to use in chains other than `mainnet`.

Using standard testnets can be as easy as passing their names to the `Transaction` constructor. For
example, `new Transaction(rawTx, {chain: 'ropsten', hardfork: 'byzantium'})` is enough to use this
library with Ropsten on Byzantium.

If you are using a custom network, you can take advantage of [ethereumjs-common](https://github.com/ethereumjs/ethereumjs-common),
which contains all the network parameters. In this version of `ethereumjs-tx` you can use its new
`Common.forCustomNetwork` to create a `Common` instance based on a standard network with some
parameters changed. You can see an example of how to do this [here](https://github.com/ethereumjs/ethereumjs-common/blob/9e624f86107cea904d8171524130d92c99bf9302/src/index.ts).

List of changes:

- Upgraded [ethereumjs-common](https://github.com/ethereumjs/ethereumjs-common) to `^1.3.0`
- Added more documentation and examples on how to create transactions for public testnets and
  custom networks.

[2.1.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%402.0.0...%40ethereumjs%2Ftx%402.1.0

## [2.0.0] - 2019-06-03

**TypeScript / Module Import / Node Support**

First `TypeScript` based release of the library, see
PR [#145](https://github.com/ethereumjs/ethereumjs-tx/pull/145) for details.

This comes along with some changes on the API, Node import of the exposed
classes now goes like this:

```javascript
const EthereumTx = require('ethereumjs-transaction').Transaction
const FakeEthereumTx = require('ethereumjs-transaction').FakeTransaction
```

The library now also comes with a **type declaration file** distributed along
with the package published.

Along with this release we drop official support for `Node` versions `4`,`5`
and `6`. Officially tested versions are now `Node` `8`, `10` and `11`
(see PRs [#138](https://github.com/ethereumjs/ethereumjs-tx/pull/138) and
[#146](https://github.com/ethereumjs/ethereumjs-tx/pull/146)).

**Hardfork Support / Official Test Updates**

Along with a long overdue update of the official Ethereum Transaction tests
(see PRs [#131](https://github.com/ethereumjs/ethereumjs-tx/pull/131) and
[#138](https://github.com/ethereumjs/ethereumjs-tx/pull/138) for
`FakeTransaction`) and
an introduction of setting chain and hardfork by using our shared
[ethereumjs-common](https://github.com/ethereumjs/ethereumjs-common) class
(see PR [#131](https://github.com/ethereumjs/ethereumjs-tx/pull/130)) the
transaction library now supports all HFs up to the `Petersburg` hardfork,
see [constructor option docs](https://github.com/ethereumjs/ethereumjs-tx/blob/master/docs/interfaces/transactionoptions.md) for information on instantiation and default values (current hardfork default: `petersburg`).

API Changes:

- Removal of the `data.chainId` parameter, use the `opts.chain` parameter or a custom `Common` instance

**Default EIP-155 Support**

Along with defaulting to a post-`Spurious Dragon` HF replay protection from
[EIP-155](https://eips.ethereum.org/EIPS/eip-155) is now activated by default. Transactions are subsequently also by default signed with `EIP-155` replay protection,
see PRs [#153](https://github.com/ethereumjs/ethereumjs-tx/pull/153),
[#147](https://github.com/ethereumjs/ethereumjs-tx/pull/147) and
[#143](https://github.com/ethereumjs/ethereumjs-tx/pull/143).

This comes with some changes in how different `v` values passed on instantiation
or changed on runtime are handled:

- The constructor throws if the `v` value is present, indicates that `EIP-155`
  was enabled, and the chain id it indicates doesn't match the one of the
  internal `common` object
- No default `v` is set. If a transaction isn't signed, it would be an empty
  buffer
- If `v` is changed after construction its value is validated in its setter

For activating non-`EIP-155` behavior instantiate the transaction with a
pre-`Spurious Dragon` hardfork option.

[2.0.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.7...%40ethereumjs%2Ftx%402.0.0

## [1.3.7] - 2018-07-25

- Fix bug causing `FakeTransaction.from` to not retrieve sender address from tx signature, see PR [#118](https://github.com/ethereumjs/ethereumjs-tx/pull/118)

[1.3.7]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.6...%40ethereumjs%2Ftx%401.3.7

## [1.3.6] - 2018-07-02

- Fixes issue [#108](https://github.com/ethereumjs/ethereumjs-tx/issues/108) with the `FakeTransaction.hash()` function by reverting the introduced signature handling changes in Fake transaction hash creation from PR [#94](https://github.com/ethereumjs/ethereumjs-tx/pull/94) introduced in `v1.3.5`. The signature is now again only created and added to the hash when `from` address is set and `from` is not defaulting to the zero address any more, see PR [#110](https://github.com/ethereumjs/ethereumjs-tx/pull/110)
- Added additional tests to cover issue described above

[1.3.6]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.5...%40ethereumjs%2Ftx%401.3.6

## [1.3.5] - 2018-06-22

- Include signature by default in `FakeTransaction.hash`, PR [#97](https://github.com/ethereumjs/ethereumjs-tx/pull/97)
- Fix `FakeTransaction` signature failure bug, PR [#94](https://github.com/ethereumjs/ethereumjs-tx/pull/94)

[1.3.5]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.4...%40ethereumjs%2Ftx%401.3.5

## [1.3.4] - 2018-03-06

- Fix a bug producing hash collisions on `FakeTransaction` for different senders, PR [#81](https://github.com/ethereumjs/ethereumjs-tx/pull/81)
- Switched from deprecated `es2015` to `env` babel preset, PR [#86](https://github.com/ethereumjs/ethereumjs-tx/pull/86)
- Dropped Node 4 support

[1.3.4]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.3...%40ethereumjs%2Ftx%401.3.4

## [1.3.3] - 2017-07-12

- Allow zeros in `v`,`r`,`s` signature values
- Dropped `browserify` transform from `package.json`
- (combined v1.3.3 and v1.3.2 release notes)

[1.3.3]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.1...%40ethereumjs%2Ftx%401.3.3

## [1.3.1] - 2017-05-13

- Added `ES5` build

[1.3.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.3.0...%40ethereumjs%2Ftx%401.3.1

## [1.3.0] - 2017-04-24

- `EIP155`: allow `v` value to be greater than one byte (replay attack protection)
- Added `browserify` `ES2015` transform to `package.json`
- Improved documentation
- (combined v1.3.0, v1.2.5 and v1.2.4 release notes)

[1.3.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.2.3...%40ethereumjs%2Ftx%401.3.0

## [1.2.3] - 2017-01-30

- `EIP155` hash implementation
- README example and doc fixes

[1.2.3]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.2.2...%40ethereumjs%2Ftx%401.2.3

## [1.2.2] - 2016-12-15

- Moved `chainId` param to `txParams`, parse `sig` for `chainId` (`EIP155` refactor)
- Test improvements
- (combined v1.2.2 and v1.2.1 release notes)

[1.2.2]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.2.0...%40ethereumjs%2Ftx%401.2.2

## [1.2.0] - 2016-12-14

- Added `EIP155` changes
- Renamed `chain_id` to `chainId`
- Node 4/5 compatibility
- `ES6` standards

[1.2.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.1.4...%40ethereumjs%2Ftx%401.2.0

## Older releases:

- [1.1.4](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.1.3...%40ethereumjs%2Ftx%401.1.4) - 2016-11-17
- [1.1.3](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.1.2...%40ethereumjs%2Ftx%401.1.3) - 2016-11-10
- [1.1.2](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.1.1...%40ethereumjs%2Ftx%401.1.2) - 2016-07-17
- [1.1.1](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.1.0...%40ethereumjs%2Ftx%401.1.1) - 2016-03-05
- [1.1.0](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.0.1...%40ethereumjs%2Ftx%401.1.0) - 2016-03-03
- [1.0.1](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%401.0.0...%40ethereumjs%2Ftx%401.0.1) - 2016-03-03
- [1.0.0](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Ftx%400.7.3...%40ethereumjs%2Ftx%401.0.0) - 2016-02-11
