# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 6.0.0-alpha.1 - 2024-10-17

This is a first round of `alpha` releases for our upcoming breaking release round with a focus on bundle size (tree shaking) and security (dependencies down + no WASM (by default)). Note that `alpha` releases are not meant to be fully API-stable yet and are for early testing only. This release series will be then followed by a `beta` release round where APIs are expected to be mostly stable. Final releases can then be expected for late October/early November 2024.

### Renamings

#### Static Constructors

The static constructors for our library classes have been reworked to now be standalone methods (with a similar naming scheme). This allows for better tree shaking of unused constructor code (see PRs [#3489](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3489), [#3549](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3549), [#3550](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3550), [#3558](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3558) and [#3586](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3586)).

`Block` class:

- `Block.fromBlockData()` -> `createBlock()`
- `Block.fromRLPSerializedBlock()` -> `createBlockFromRLP()`
- `Block.fromValuesArray()` -> `createBlockFromValuesArray()`
- `Block.fromRPC()` -> `createBlockFromRPC()`
- `Block.fromJSONRPCProvider()` -> `createBlockFromJSONRPCProvider()`
- `Block.fromExecutionPayload()` -> `createBlockFromExecutionPayload()`
- `Block.fromBeaconPayloadJSON()` -> `createBlockFromBeaconPayloadJSON()`

`Header` class:

- `Header.fromHeaderData()` -> `createBlockHeader()`
- `Header.fromRLPSerializedHeader()` -> `createBlockHeaderFromRLP()`
- `Header.fromValuesArray()` -> `createBlockHeaderFromValuesArray()`
- `Header.fromRPC()` -> `createBlockHeaderFromRPC()`

Also renamed in similar way: Block trie root methods (e.g. `Block.genWithdrawalsTrieRoot()` -> `genWithdrawalsTrieRoot()`)

### Own Block Parameter Set

HF-sensitive parameters like `targetBlobGasPerBlock` were previously by design all provided by the `@ethereumjs/common` library. This meant that all parameter sets were shared among the libraries and libraries carried around a lot of unnecessary parameters.

With the `Common` refactoring from PR [#3537](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3537) parameters now moved over to a dedicated `params.ts` file (exposed as e.g. `paramsBlock`) within the parameter-using library and the library sets its own parameter set by internally calling a new `Common` method `updateParams()`. For shared `Common` instances parameter sets then accumulate as needed.

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

### Clique/Ethash Logic Extraction

Since downgraded in importance and otherwise bloating the core `Block` class too much, most clique and ethash consensus related functionality has been taken out of the core class implementation and moved to standalone methods, see PR [#3571](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3571/).

Both clique and ethash blocks can still be created though and used within the wider EthereumJS stack. For clique, the `cliqueSigner` option has been removed. Instead there is a dedicated static constructor/standalone method to create a clique block:

```ts
let block = createSealedCliqueBlock({
  /* ... */
})
```

Most clique methods are now invoked in a standalone-way, e.g.:

```ts
header.cliqueEpochTransitionSigners(), // old
  cliqueEpochTransitionSigners(header) // new
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

### Removal of TTD Logic (live-Merge Transition Support)

Total terminal difficulty (TTD) logic related to fork switching has been removed from the libraries, see PRs [#3518](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3518) and [#3556](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3556). This means that a Merge-type live hardfork transition solely triggered by TTD is not supported anymore. It is still possible though to replay and deal with both pre- and post Merge HF blocks.

For this library this means:

- The `setHardfork` constructor option is simplified to only accept a `boolean` and no `BigIntLike` for an eventual TD value anymore

### Other Breaking Changes

- New default hardfork: `Shanghai` -> `Cancun`, see PR [#3566](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3566)
- The `normalizeTxParams()` helper method moved over to the tx library, PR [#3588](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3588)
- Renaming all camel-case `Rpc`-> `RPC` and `Json` -> `JSON` names, PR [#3638](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3638)

### Other Changes

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)
- New `createEmptyBlock()` constructor (tree shaking advantages), PR [#3601](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3601)
- kaustinen7 verkle testnet preparation (removes the stateRoot handling and caching for the previous block), PR [#3433](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3433)

## 5.3.0 - 2024-08-15

### Blocks with EIP-7685 Consensus Layer Requests

Starting with this release this library supports requests to the consensus layer (see PRs [#3372](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3372) and [#3393](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3393)) which have been introduced with [EIP-7685](https://eips.ethereum.org/EIPS/eip-7685) and will come into play for deposit and withdrawal requests along the upcoming [Prague](https://eips.ethereum.org/EIPS/eip-7600) hardfork.

#### EIP-6110 Deposit Requests

[EIP-6110](https://eips.ethereum.org/EIPS/eip-6110) introduces deposit requests allowing beacon chain deposits being triggered from the execution layer, see PRs [#3390](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3390) and [#3397](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3397). Starting with this release this library supports deposit requests and a containing block can be instantiated as follows:

```ts
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Block } from '@ethereumjs/block'
import {
  bytesToBigInt,
  DepositRequest,
  randomBytes,
  type CLRequest,
  type CLRequestType,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

const main = async () => {
  const common = new Common({
    chain: Chain.Mainnet,
    hardfork: Hardfork.Prague,
  })

  const depositRequestData = {
    pubkey: randomBytes(48),
    withdrawalCredentials: randomBytes(32),
    amount: bytesToBigInt(randomBytes(8)),
    signature: randomBytes(96),
    index: bytesToBigInt(randomBytes(8)),
  }
  const request = DepositRequest.fromRequestData(depositRequestData) as CLRequest<CLRequestType>
  const requests = [request]
  const requestsRoot = await Block.genRequestsRoot(requests, keccak256)

  const block = Block.fromBlockData(
    {
      requests,
      header: { requestsRoot },
    },
    { common },
  )
  console.log(
    `Instantiated block with ${
      block.requests?.length
    } request, requestTrieValid=${await block.requestsTrieIsValid()}`,
  )
}

main()
```

Have a look at the EIP for some guidance on how to use and fill in the various deposit request parameters.

#### EIP-7002 Withdrawal Requests

[EIP-7002](https://eips.ethereum.org/EIPS/eip-7002) introduces the possibility for validators to trigger exits and partial withdrawals via the execution layer, see PR [#3385](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3385). Starting with this release this library supports withdrawal requests and a containing block can be instantiated as follows:

```ts
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Block } from '@ethereumjs/block'
import {
  bytesToBigInt,
  randomBytes,
  WithdrawalRequest,
  type CLRequest,
  type CLRequestType,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

const main = async () => {
  const common = new Common({
    chain: Chain.Mainnet,
    hardfork: Hardfork.Prague,
  })

  const withdrawalRequestData = {
    sourceAddress: randomBytes(20),
    validatorPubkey: randomBytes(48),
    amount: bytesToBigInt(randomBytes(8)),
  }
  const request = WithdrawalRequest.fromRequestData(
    withdrawalRequestData,
  ) as CLRequest<CLRequestType>
  const requests = [request]
  const requestsRoot = await Block.genRequestsRoot(requests, keccak256)

  const block = Block.fromBlockData(
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

main()
```

Have a look at the EIP for some guidance on how to use and fill in the various withdrawal request parameters.

#### EIP-7251 Consolidation Requests

[EIP-7251](https://eips.ethereum.org/EIPS/eip-7251) introduces consolidation requests allowing staked ETH from more than one validator on the beacon chain to be consolidated into one validator, triggered from the execution layer, see PR [#3477](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3477). Starting with this release this library supports consolidation requests and a containing block can be instantiated as follows:

```ts
// ./examples/7251Requests.ts

import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Block } from '@ethereumjs/block'
import {
  bytesToBigInt,
  ConsolidationRequest,
  randomBytes,
  type CLRequest,
  type CLRequestType,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak.js'

const main = async () => {
  const common = new Common({
    chain: Chain.Mainnet,
    hardfork: Hardfork.Prague,
  })

  const consolidationRequestData = {
    sourceAddress: randomBytes(20),
    sourcePubkey: randomBytes(48),
    targetPubkey: randomBytes(48),
  }
  const request = ConsolidationRequest.fromRequestData(
    consolidationRequestData,
  ) as CLRequest<CLRequestType>
  const requests = [request]
  const requestsRoot = await Block.genRequestsRoot(requests, keccak256)

  const block = Block.fromBlockData(
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

main()
```

Have a look at the EIP for some guidance on how to use and fill in the various deposit request parameters.

### Verkle Updates

- Fixes for Kaustinen4 support, PR [#3269](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3269)
- Update `kzg-wasm` to `0.4.0`, PR [#3358](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3358)
- Shift Verkle to `osaka` hardfork, PR [#3371](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3371)
- Fix the block body parsing as well as save/load from blockchain, PR [#3392](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3392)
- Verkle type/interface refactoring (moved to Common package), PR [#3462](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3462)

### Other Features

- New `Block.toExecutionPayload()` method to map to the execution payload structure from the beacon chain, PR [#3269](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3269)
- Stricter prefixed hex typing, PRs [#3348](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3348), [#3427](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3427) and [#3357](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3357) (some changes removed in PR [#3382](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3382) for backwards compatibility reasons, will be reintroduced along upcoming breaking releases)

### Other Changes

- Make EIP-4895 withdrawals trie check consistent with tx trie, PR [#3338](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3338)
- Rename deposit receipt to deposit request, PR [#3408](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3408)
- Enhances typing of CL requests, PR [#3398](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3398)
- Rename withdrawal request's `validatorPublicKey` to `validatorPubkey`, PR [#3474](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3474)

## 5.2.0 - 2024-03-18

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

### Other Changes

- Fixed a bug in the `Block.fromRPC()` and `BlockHeader.fromRPC()` constructors to not parse the `parentBeaconBlockRoot` correctly, PR [#3283](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3283)

## 5.1.1 - 2024-02-08

- Hotfix release adding a missing `debug` dependency to the `@ethereumjs/trie` package (dependency), PR [#3271](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3271)

## 5.1.0 - 2024-02-08

### Dencun Hardfork Support

While all EIPs contained in the upcoming Dencun hardfork run pretty much stable within the EthereumJS libraries for quite some time, this is the first release round which puts all this in the official space and removes "experimental" labeling preparing for an imminent Dencun launch on the last testnets (Holesky) and mainnet activation! 🎉

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

### Self-Contained (and Working 🙂) README Examples

All code examples in `EthereumJS` monorepo library README files are now self-contained and can be executed "out of the box" by simply copying them over and running "as is", see tracking issue [#3234](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3234) for an overview. Additionally all examples can now be found in the respective library [examples](./examples/) folder (in fact the README examples are now auto-embedded from over there). As a nice side effect all examples are now run in CI on new PRs and so do not risk to get outdated or broken over time.

### Other Changes

- `Block.validateData()` now throws if unsigned txs are added, PR [#3240](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3240)
- New `verifyTxs` flag for `Block.verifyData()` allowing to skip tx verification for certain use cases, PR [#3240](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3240)
- Experimental Verkle block support, PR [#3139](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3139)

## 5.0.1 - 2023-10-26

### Dencun devnet-11 Compatibility

This release contains various fixes and spec updates related to the Dencun (Deneb/Cancun) HF and is now compatible with the specs as used in [devnet-11](https://github.com/ethpandaops/dencun-testnet) (October 2023).

- Update peer dependency for `kzg` module to use the official trusted setup for `mainnet`, PR [#3107](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3107)

## 5.0.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Fblock%405.0.0-rc.1) for the main change description.

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

### New API to set Hardforks

Our APIs to (re-)set a a hardfork within a library had grown old over all changes on how this is done over the years. 😂

We therefore removed the outdated `getHardforkByBlockNumber()` and `setHardforkByBlockNumber()` methods in `@ethereumjs/common` (artificially expanded with the option to also pass a `TD` or `timestamp`) with a more adequate `hardforkBy()` method flexibly taking in the adequate value type for a HF change, see PR [#2798](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2798):

```ts
common.setHardforkBy({ blockNumber: 5000000n }) // Setting a mainnet common to a Block from `Byzantium` (and so: to `Byzantium` HF)
common.setHardforkBy({ timestamp: 1681340000n }) // Setting a mainnet common to a post-Shanghai timestamp
common.setHardforkBy({ blockNumber, timestamp }) // Setting a common with to a not pre-known HF using both block number and timestamp
```

There is a third option `td` which is Merge specific and should normally not be used except for a very rare set of dynamic Merge-HF scenarios.

For the `Block` library we also updated the old concurrent `hardforkByBlockNumber` and `hardforkByTTD` options to a unified and simplified `setHardfork` option for the constructor, see PR [#2800](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2800).

### API Validation Methods Clean-Up

We have cleaned up and unified the validation methods in the `Block` library, see PR [#2792](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2792).

The `Block.validateTransactions()` method, previously overloaded with different return types depending on the input, has been split up into:

```ts
Block.transactionsAreValid(): boolean
Block.getTransactionsValidationErrors(): string[]
```

Other renamings:

```ts
Block.validateTransactionsTrie(): Promise<boolean> // old
Block.transactionsTrieIsValid(): Promise<boolean> // new

Block.validateUnclesHash(): boolean // old
Block.uncleHashIsValid(): boolean // new

Block.validateWithdrawalsTrie(): Promise<boolean> // old
Block.withdrawalsTrieIsValid(): Promise<boolean> // new
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

#### New Block Header field: dataGasUsed / new excessDataGas Helpers

For the Block library the most significant change is that there is now a new header field `dataGasUsed` if `EIP-4844` is activated (via `Common`), see PR [#2750](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2750).

Additionally there are the following three `dataGasUsed`/`excessDataGas` related new helper methods:

```ts
BlockHeader.getDataGasPrice(): bigint
BlockHeader.calcDataFee(numBlobs: number): bigint
BlockHeader.calcNextExcessDataGas(): bigint
```

#### Other Library Changes

- Update eip4844 blocks/txs to decoupled blobs spec, PR [#2567](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2567)

### Block: fromExecutionPayload() / fromBeaconPayloadJson()

Two new handy constructors have been added to the `Block` class to bring the consensus and execution parts of Ethereum closer together:

`Block.fromBeaconPayloadJson()` allows to initialize an Ethereum execution layer (EL) block with a payload received from the beacon chain (consensus layer (CL)) via an RPC call. 🤩 The new constructor can be used as follows:

```ts
const block = await Block.fromBeaconPayloadJson(payload, { common })
```

If you already have the execution payload embedded within a beacon block you can alternatively directly use the `Block.fromExecutionPayload()` constructor.

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
// header
BlockHeader.fromHeaderData(headerData: HeaderData = {}, opts: BlockOptions = {})
BlockHeader.fromRLPSerializedHeader(serializedHeaderData: Uint8Array, opts: BlockOptions = {})
BlockHeader.fromValuesArray(values: BlockHeaderBytes, opts: BlockOptions = {})
new BlockHeader() // deprecated
BlockHeader.raw(): BlockHeaderBytes
BlockHeader.hash(): Uint8Array
BlockHeader.cliqueExtraVanity(): Uint8Array // clique PoA only
BlockHeader.cliqueExtraSeal(): Uint8Array // clique PoA only
BlockHeader.serialize(): Uint8Array

// block
Block.fromBlockData(blockData: BlockData = {}, opts?: BlockOptions)
Block.fromRLPSerializedBlock(serialized: Uint8Array, opts?: BlockOptions)
Block.fromValuesArray(values: BlockBytes, opts?: BlockOptions)
new Block() // deprecated
Block.raw(): BlockBytes
Block.hash(): Uint8Array
Block.serialize(): Uint8Array
```

We have converted existing Buffer conversion methods to Uint8Array conversion methods in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

#### Prefixed Hex Strings as Default

The mixed usage of prefixed and unprefixed hex strings is a constant source of errors in byte-handling code bases.

We have therefore decided to go "prefixed" by default, see PR [#2830](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2830) and [#2845](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2845).

The `hexToBytes` and `bytesToHex` methods, also similar methods like `intToHex`, now take `0x`-prefixed hex strings as input and output prefixed strings. The corresponding unprefixed methods are marked as `deprecated` and usage should be avoided.

Please therefore check your code base on updating and ensure that values you are passing to constructors and methods are prefixed with a `0x`.

### Other Changes

- Support for `Node.js 16` has been removed (minimal version: `Node.js 18`), PR [#2859](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2859)
- Migrate `fromEthersProvider()` to more general `fromJsonRpcProvider()` constructor, remove `Ethers` dependency, PR [#2663](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2663)
- Breaking: `Block._common` property has been renamed to `Block.common`, PR [#2857](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2857)
- While the main `new Block()` constructor should generally not be used (use the static constructor methods instead) just to mention: `withdrawals` and `opts` constructor arguments have been swapped, PR [#2715](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2715)

## 4.2.2 - 2023-04-20

### Bugfixes

- Throw if EIP-4895 is active and no withdrawals are available, PR [#2601](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2601)

### Maintenance

- Removed `Ethers` dependency, alternative `fromEthersProvider()` static constructor implementation, PR [#2633](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2633)
- Bump `@ethereumjs/util` `@chainsafe/ssz` dependency to 0.11.1 (no WASM, native SHA-256 implementation, ES2019 compatible, explicit imports), PRs [#2622](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2622), [#2564](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2564) and [#2656](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2656)
- Update ethereum-cryptography from 1.2 to 2.0 (switch from noble-secp256k1 to noble-curves), PR [#2641](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2641)

## 4.2.1 - 2023-02-27

- Pinned `@ethereumjs/util` `@chainsafe/ssz` dependency to `v0.9.4` due to ES2021 features used in `v0.10.+` causing compatibility issues, PR [#2555](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2555)
- Fixed `kzg` imports in `@ethereumjs/tx`, PR [#2552](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2552)

## 4.2.0 - 2023-01-16

**DEPRECATED**: Release is deprecated due to broken dependencies, please update to the subsequent bugfix release version.

### Functional Shanghai Support

This release fully supports all EIPs included in the [Shanghai](https://github.com/ethereum/execution-specs/blob/master/network-upgrades/mainnet-upgrades/shanghai.md) feature hardfork scheduled for early 2023. Note that a `timestamp` to trigger the `Shanghai` fork update is only added for the `sepolia` testnet and not yet for `goerli` or `mainnet`.

You can instantiate a Shanghai-enabled Common instance for your transactions with:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai })
```

### EIP-4844 Shard Blob Transactions Support (experimental)

This release supports an experimental version of the blob transaction type introduced with [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844) as being specified in the [01d3209](https://github.com/ethereum/EIPs/commit/01d320998d1d53d95f347b5f43feaf606f230703) EIP version from February 8, 2023 and deployed along `eip4844-devnet-4` (January 2023).

#### Initialization

To create blocks which include blob transactions you have to active EIP-4844 in the associated `@ethereumjs/common` library:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai, eips: [4844] })
```

**Note:** Working with blob transactions needs a manual KZG library installation and global initialization, see [KZG Setup](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/tx/README.md#kzg-setup) for instructions.

### Other Changes

- Handle hardfork defaults consistently, PR [#2467](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2467)
- New `generateWithdrawalsSSZRoot()` method, PR [#2488](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2488)
- Allow genesis to be post merge, PR [#2530](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2530)
- Skip extradata check on PoW genesis blocks, PR [#2532](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2532)

## 4.1.0 - 2022-12-09

### Experimental EIP-4895 Beacon Chain Withdrawals Support

This release comes with experimental [EIP-4895](https://eips.ethereum.org/EIPS/eip-4895) beacon chain withdrawals support, see PR [#2353](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2353) for the plain implementation and PR [#2401](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2401) for updated calls for the CL/EL engine API. Also note that there is a new helper module in [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) with a new dedicated `Withdrawal` class together with additional TypeScript types to ease withdrawal handling.

Withdrawals support can be activated by initializing a respective `Common` object, here is an example for a `Block` object initialization:

```ts
import { Block } from '@ethereumjs/block'
import { Common, Chain } from '@ethereumjs/common'
import { Address } from '@ethereumjs/util'
import type { WithdrawalData } from '@ethereumjs/util'

const common = new Common({ chain: Chain.Mainnet, eips: [4895] })

const withdrawal = <WithdrawalData>{
  index: BigInt(0),
  validatorIndex: BigInt(0),
  address: new Address(Buffer.from('20'.repeat(20), 'hex')),
  amount: BigInt(1000),
}

const block = Block.fromBlockData(
  {
    header: {
      withdrawalsRoot: Buffer.from(
        '69f28913c562b0d38f8dc81e72eb0d99052444d301bf8158dc1f3f94a4526357',
        'hex',
      ),
    },
    withdrawals: [withdrawal],
  },
  {
    common,
  },
)
```

There is a new data option `withdrawals` to pass in system-level withdrawal operations, the block header also needs to contain a matching `withdrawalsRoot`, which is mandatory to be passed in when `EIP-4895` is activated.

Validation of the withdrawals trie can be manually triggered with the new async `Block.validateWithdrawalsTrie()` method.

### Hardfork-By-Time Support

The Block library is now ready to work with hardforks triggered by timestamp, which will first be applied along the `Shanghai` HF, see PR [#2437](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2437). This is achieved by integrating a new timestamp supporting `@ethereumjs/common` library version.

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

### New RPC and Ethers Static Constructors

Two new static constructors have been added to the library, see PR [#2315](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2315) `Block.fromEthersProvider()` allows for an easy instantiation of a `Block` object using an [Ethers](https://ethers.io) provider connecting e.g. to a local node or a service provider like Infura. The `Block.fromRPC()` static constructor can be used for a straight-forward block instantiation if the block data is coming from an RPC request. This static constructor replaces the old standalone `blockFromRPC()` method which is now marked as `deprecated`.

### Other Changes and Fixes

- Addressed several typing issues in the `blockFromRPC()` method, PR [#2302](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2302)

## 4.0.0 - 2022-09-06

Final release - tada 🎉 - of a wider breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2, Beta 3 and Release Candidate (RC) 1 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/CHANGELOG.md)).

### Changes

- **Potentially breaking:** Removed acceptance of `receiptRoot` parameter (correct is plural: `receiptsRoot`) for `blockHeaderFromRpc()` function, PR [#2259](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2259)
- Internal refactor: removed ambiguous boolean checks within conditional clauses, PR [#2256](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2256)

## 4.0.0-rc.1 - 2022-08-29

Release candidate 1 for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 and 3 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/CHANGELOG.md)).

### Fixed Mainnet Merge HF Default

Since this bug was so severe it gets its own section: `mainnet` in the underlying `@ethereumjs/common` library (`Chain.Mainnet`) was accidentally not updated yet to default to the `merge` HF (`Hardfork.Merge`) by an undiscovered overwrite back to `london`.

This has been fixed in PR [#2206](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2206) and `mainnet` now default to the `merge` as well.

### Other Changes

- New `skipConsensusFormatValidation` option to skip consensus-related format validation checks (e.g. `extraData` checks on a `PoA` block), PRs [#2139](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2139) and [#2209](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2209)
- Do not auto-activate `hardforkByBlockNumber` in static BlockHeader `fromRLPSerializedHeader()` constructor, PR [#2205](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2205)

### Maintenance Updates

- Added `engine` field to `package.json` limiting Node versions to v14 or higher, PR [#2164](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2164)
- Replaced `nyc` (code coverage) configurations with `c8` configurations, PR [#2192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2192)
- Code formats improvements by adding various new linting rules, see Issue [#1935](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1935)

## 4.0.0-beta.3 - 2022-08-10

Beta 3 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/CHANGELOG.md)).

### Merge Hardfork Default

Since the Merge HF is getting close we have decided to directly jump on the `Merge` HF (before: `Istanbul`) as default in the underlying `@ethereumjs/common` library and skip the `London` default HF as we initially intended to set (see Beta 1 CHANGELOG), see PR [#2087](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2087).

This means that if this library is instantiated without providing an explicit `Common`, the `Merge` HF will be set as the default hardfork and the library will behave according to the HF rules up to the `Merge`.

If you want to prevent these kind of implicit HF switches in the future it is likely a good practice to just always do your upper-level library instantiations with a `Common` instance setting an explicit HF, e.g.:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
const block = Block.fromBlockData(
  {
    // Provide your block data here or use default values
  },
  { common },
)
```

## Other Changes

- **Breaking**: rename `hardforkByTD` option to `hardforkByTTD`, PR [#2075](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2075)
- Set `hardforkByBlockNumber` to `true` on RLP block constructor, PR [#2081](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2081)

## 4.0.0-beta.2 - 2022-07-15

Beta 2 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/CHANGELOG.md)) for the main change set description.

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

- `blockFromRpc()` function
- `blockHeaderFromRpc()` function

## Other Changes

- Added `ESLint` strict boolean expressions linting rule, PR [#2030](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2030)
- Validate consensus format after block is sealed (if applicable) so `extraData` checks will pass, PR [#2031](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2031)

## 4.0.0-beta.1 - 2022-06-30

This release is part of a larger breaking release round where all [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries (VM, Tx, Trie, other) get major version upgrades. This round of releases has been prepared for a long time and we are really pleased with and proud of the result, thanks to all team members and contributors who worked so hard and made this possible! 🙂 ❤️

We have gotten rid of a lot of technical debt and inconsistencies and removed unused functionality, renamed methods, improved on the API and on TypeScript typing, to name a few of the more local type of refactoring changes. There are also broader structural changes like a full transition to native JavaScript `BigInt` values as well as various somewhat deep-reaching refactorings, both within a single package as well as some reaching beyond the scope of a single package. Also two completely new packages - `@ethereumjs/evm` (in addition to the existing `@ethereumjs/vm` package) and `@ethereumjs/statemanager` - have been created, leading to a more modular Ethereum JavaScript VM.

We are very much confident that users of the libraries will greatly benefit from the changes being introduced. However - along the upgrade process - these releases require some extra attention and care since the changeset is both so big and deep reaching. We highly recommend to closely read the release notes, we have done our best to create a full picture on the changes with some special emphasis on delicate code and API parts and give some explicit guidance on how to upgrade and where problems might arise!

So, enjoy the releases (this is a first round of Beta releases, with final releases following a couple of weeks after if things go well)! 🎉

The EthereumJS Team

### London Hardfork Default

In this release the underlying `@ethereumjs/common` version is updated to `v3` which sets the default HF to `London` (before: `Istanbul`).

This means that a Block object instantiated without providing an explicit `Common` is using `London` as the default hardfork as well and behavior of the library changes according to up-to-`London` HF rules.

If you want to prevent these kind of implicit HF switches in the future it is likely a good practice to just always do your upper-level library instantiations with a `Common` instance setting an explicit HF, e.g.:

```ts
import Common, { Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Merge })
const block = Block.fromBlockData(
  {
    // Provide your block data here or use default values
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

While this is convenient, it deviates from the ESM specification and forces downstream users into using these options, which might not be desirable, see [this TypeScript Semver docs section](https://www.semver-ts.org/#module-interop) for some more detailed argumentation.

Along with the breaking releases we have therefore deactivated both of these options and you might therefore need to adapt some import statements accordingly. Note that you still can activate these options in your bundle and/or transpilation pipeline (but now you also have the option _not_ to, which you didn't have before).

### BigInt-Related API Changes

The `Block` option `hardforkByTD` (merge-related) is now taking in `BigIntLike` data types instead of `BNLike`. Header data fields internally represented as a number - like `number` or `gasLimit` - now have `BigInt` as their internal data type and are also passed in as `BigIntLike` instead of `BNLike`.

The following method signatures have been changed along the update and need some attention:

- `BlockHeader.calcNextBaseFee(): bigint`
- `BlockHeader.ethashCanonicalDifficulty(parentBlock: Block): bigint` (method also renamed, see validation-refactor section)
- `Block.ethashCanonicalDifficulty(parentBlock: Block): bigint` (method also renamed, see validation-refactor section)

Also worth to note that both the `raw()` and `toJSON()` methods are actually _not_ affected, respectively delivering values as `Buffer` and `string`.

### API Method/Getter Removals

Additionally the following deprecated methods/getters have been removed from the API, see PR [#1752](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1752):

- `Header.bloom` (getter) (use `Header.logsBloom` instead)
- **Important**: also check for `bloom` usage when passing in `Block` data (also use `logsBloom` instead), this might otherwise auto-fallback to the default value without noticing!
- `toJSON()` method: `baseFee` property (use `baseFeePerGas` instead)
- `toJSON()` method: `bloom` property (use `logsBloom` instead)

### Reworked BlockHeader Constructor API

While the `BlockHeader` library main constructor usage is discouraged in favor of the various static constructor methods (e.g. `BlockHeader.fromHeaderData()`), it will realistically still be directly used and this change is therefore mentioned here in the release notes.

To align with other libraries and simplify usage, the constructor has been reworked in PR [#1787](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1787) to take in a `headerData` object as a first argument instead of a chain of single parameters (`constructor(parentHash, uncleHash, coinbase,...)`).

In doubt check if you use the constructor directly in your code and update accordingly!

### Reduced Bundle Size (MB -> KB)

The bundle size of the library has been dramatically reduced going down from MBs to KBs due to a reworked genesis code handling throughout the library stack in PR [#1916](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1916) allowing the `Common` library to now ship without the bundled (large) genesis state definitions (especially for mainnet).

### Removed Genesis Functionality

PR [#1916](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1916) reworks the genesis code throughout the EthereumJS library stack, see also the bundle size note above.

In the `Block` library the `initWithGenesisHeader` option and the `Block.genesis()` static constructor have been removed, with parts of the functionality moved to the `Blockchain` class where genesis block creation is mostly needed (within the realm of the EthereumJS libraries).

It is still possible to create genesis blocks with the library but it is now needed to explicitly pass in the respective genesis parameters.

Get in touch if you strongly rely on this part of functionality, it might be possible to provide additional helpers here which fit in the current scheme of the refactored libraries structure (providing extra functionality for the `Block` library to directly take in Geth genesis JSON files e.g. or additional helpers for the `Blockchain` package).

### Removed Blockchain-based Validation Methods

In the former code base of the `Block` libraries various validation methods (and therefore the whole library) depended on passing in a `Blockchain` instance, since context from the broader `Blockchain` (in many cases the parent block) was needed for validation. This was an unlucky situation since it led to a somewhat circular dependency situation (a `Block` should not depend on a `Blockchain`).

All these methods have now been removed from the `Block` library in a larger refactoring work in PR [#1959](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1959) and moved over to the `Blockchain` library.

The following methods moved over and also have been partly renamed (see `Blockchain` release notes):

- `BlockHeader.validateDifficulty()`
- `BlockHeader.validateCliqueDifficulty()`
- `BlockHeader.validate()`
- `Block.validate()`
- `Block.validateUncles()` (method still there but functionality reduced to format validation tasks)
- `Block.validateDifficulty()`
- `CLIQUE_DIFF_INTURN`, `CLIQUE_DIFF_NOTURN` (both `Clique` consensus algorithm related)

Additionally some methods have been renamed (same PR):

- `Block(Header).canonicalDifficulty()` -> `Block(Header).ethashCanonicalDifficulty()`

The internal format validation in `BlockHeader` has been reworked a bit as well, `_validateHeaderFields()` (normally private method) has been renamed and split up into `_genericFormatValidation()` as well as `_consensusFormatValidation()` with all consensus-specific validation tasks. This should simplify subclassing use cases if e.g. specific own consensus validation code is needed while the generic validation logic should be preserved.

### RLP Changes

If you are dealing with RLP encoded data and use the EthereumJS RLP library for decoding, please note that RLP library also got a major update and has been renamed along the way from `rlp` to a namespaced `@ethereumjs/rlp`, see RLP `v4.0.0-beta.1` (and following) release notes in the [CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md#400-beta1---2022-06-30).

If you are updating from v2 you will likely also stumble upon the fact that with `v3` RLP replaces Buffers as input and output values in favor of Uint8Arrays for improved performance and greater compatibility with browsers.

New conversion functions have also been added to the `@ethereumjs/util` library, see [RLP docs](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/rlp#buffer-compatibility) on how to use and do the conversion.

### Other Changes

- `Block.validateGasLimit()` now throws instead of returning a `boolean` value (adapt accordingly), PR [#1959](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1959)

## 3.6.2 - 2022-03-15

### Merge Kiln v2 Testnet Support

This release fully supports the Merge [Kiln](https://kiln.themerge.dev/) testnet `v2` complying with the latest Merge [specs](https://hackmd.io/@n0ble/kiln-spec). The release is part of an [@ethereumjs/client](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/client) `v0.4` release which can be used to sync with the testnet, combining with a suited consensus client (e.g. the Lodestar client). See [Kiln](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/client/kiln) instructions to get things going! 🚀

- New `BlockHeader.prevRandao()` method to return the Post-merge `prevRandao` random value from the previous `mixHash` field ([EIP-43399](https://eips.ethereum.org/EIPS/eip-4399) Support: Supplant DIFFICULTY opcode with PREVRANDAO), PRs [#1565](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1565) and [#1750](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1750)

## 3.6.1 - 2022-02-02

- Use initial configured base fee as default for `EIP-1559`-enabled blocks, PR [#1581](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1581)

## 3.6.0 - 2021-11-09

### ArrowGlacier HF Support

This release adds support for the upcoming [ArrowGlacier HF](https://github.com/ethereum/execution-specs/blob/master/network-upgrades/mainnet-upgrades/arrow-glacier.md) (see PR [#1527](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1527)) targeted for December 2021. The only included EIP is [EIP-4345](https://eips.ethereum.org/EIPS/eip-4345) which delays the difficulty bomb to June/July 2022, the difficulty formula on a block will work accordingly if instantiated on the ArrowGlacier HF.

Please note that for backwards-compatibility reasons the associated Common is still instantiated with `istanbul` by default.

An ArrowGlacier block can be instantiated with:

```ts
import { Block } from '@ethereumjs/block'
import Common, { Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.ArrowGlacier })
const block = Block.fromBlockData(
  {
    // Provide your block data here or use default values
  },
  { common },
)
```

### Additional Error Context for Error Messages

This release extends the text of the error messages in the library with some consistent context information (see PR [#1540](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1540)), here an example for illustration:

Before:

```shell
invalid transaction trie
```

New:

```
invalid transaction trie (block number=1 hash=0xe074b7b8d725c4000f278ae55cedbc76262e28906c283899d996cd27ab19b145 hf=istanbul baseFeePerGas=none txs=7 uncles=0)
```

The extended errors give substantial more object and chain context and should ease debugging.

**Potentially breaking**: Attention! If you do react on errors in your code and do exact error matching (`error.message === 'invalid transaction trie'`) things will break. Please make sure to do error comparisons with something like `error.message.includes('invalid transaction trie')` instead. This should generally be the pattern used for all error message comparisons and is assured to be future proof on all error messages (we won't change the core text in non-breaking releases).

### Other Changes

- Fix `blockHeaderFromRpc()` method to continue to work for pre-London blocks, PR [#1509](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1509)
- Allow instantiation of post-London genesis blocks receiving a `baseFeePerGas` value from the associated Common object, PR [#1512](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1512)
- Deprecated `bloom` parameter in favor of `logsBloom` to align with RPC names (as an object parameter, as RPC output in `toJSON()` method and in the TypeScript `HeaderData` interface), please update your code base!, PR [#1509](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1509)
- Deprecated `baseFee` parameter in `toJSON()` method in favor of `baseFeePerGas` to align with RPC names, please update your code base!, PR [#1509](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1509)

## 3.5.1 - 2021-09-28

- Fixed a bug not initializing the HF correctly when run on a custom chain with the `london` HF happening on block 0 or 1, PR [#1492](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1492)

## 3.5.0 - 2021-09-24

### Experimental Merge/PoS Support

This release comes with experimental support for the Merge HF as defined in [EIP-3675](https://eips.ethereum.org/EIPS/eip-3675) respectively support for creating PoS compatible `Block` objects (from an Eth 1.0 perspective).

#### PoS Block Instantiation

Proof-of-Stake compatible execution blocks come with its own set of header field simplifications and associated validation rules. The difficulty is set to `0` since not relevant any more, just to name an example. For a full list of changes see `EIP-3675`.

You can instantiate a Merge/PoS block like this:

```ts
import { Block } from '@ethereumjs/block'
import Common, { Chain, Hardfork } from '@ethereumjs/common'
const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Merge })
const block = Block.fromBlockData(
  {
    // Provide your block data here or use default values
  },
  { common },
)
```

See: PR [#1393](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1393) and PR [#1408](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1393)

#### Set Hardfork by Total Difficulty

There is a new `hardforkByTD` option which expands the current `hardforkByBlockNumber` option and allows for setting the hardfork either by total difficulty or a `Common`-matching block number. The supportive functionality within the `Common` library has been introduced along the `v2.5.0` release.

See. PR [#1473](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1473)

### Other Changes

- The hash from the `block.hash()` method now gets cached for blocks created with the `freeze` option (activated by default), PR [#1445](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1445)

## 3.4.0 - 2021-07-08

### Finalized London HF Support

This release integrates a `Common` library version which provides the `london` HF blocks for all networks including `mainnet` and is therefore the first release with finalized London HF support.

### Included Source Files

Source files from the `src` folder are now included in the distribution build, see PR [#1301](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1301). This allows for a better debugging experience in debug tools like Chrome DevTools by having working source map references to the original sources available for inspection.

### Other Changes

- Fixed RPC value handling for `difficulty`, `gasPrice` and `value` in `blockFromRpc()` when value is provided as a number (thanks @Ghorbanian for the contribution), PR [#1316](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1316)
- Added `baseFeePerGas` to `blockHeaderFromRpc()` (thanks @mfornet for the contribution), PR [#1330](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1330)

## 3.3.0 - 2021-05-26

### Functional London HF Support (no finalized HF blocks yet)

This `Block` release comes with full functional support for the `london` hardfork (all EIPs are finalized and integrated and `london` HF can be activated, there are no final block numbers for the HF integrated though yet). Please note that the default HF is still set to `istanbul`. You therefore need to explicitly set the `hardfork` parameter for instantiating a `Common` instance with a `london` HF activated:

```ts
import { BN } from 'ethereumjs-util'
import { Block } from '@ethereumjs/block'
import Common from '@ethereumjs/common'
const common = new Common({ chain: 'mainnet', hardfork: 'london' })

const block = Block.fromBlockData(
  {
    header: {
      baseFeePerGas: new BN(10),
      gasLimit: new BN(100),
      gasUsed: new BN(60),
    },
  },
  { common },
)

// Base fee will increase for next block since the
// gas used is greater than half the gas limit
block.header.calcNextBaseFee().toNumber() // 11
```

#### EIP-1559: Fee market change for ETH 1.0 chain

This library now supports block structure and related logic coming with the new fee market mechanism introduced by [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559), see PR [#1148](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1148).

Blocks now have an extra `baseFeePerGas` field which can be passed in on instantiation with a `london` (or `EIP-1559`) enabled `common` (otherwise `baseFeePerGas` will default to `new BN(7)`, which is the minimum possible `baseFeePerGas` value).

A block can now also encompass `FeeMarketEIP1559Transaction` txs (type `2`) which are supported by `@ethereumjs/tx` `v3.2.0` or higher. `Transaction` legacy txs (internal type `0`) and `AccessListEIP2930Transaction` txs (type `1`) are still valid.

On block (header) validation with `BlockHeader.validate()` there is a new validity check if the base fee of a block matches the expected calculated base fee derived from the gas used in the parent block and taking the former virtual gas target (gas limit // ELASTICITY_MULTIPLIER (2)) into account.

#### EIP-3554: Difficulty Bomb Delay to December 2021

Support for the `london` difficulty bomb ([EIP-3554](https://eips.ethereum.org/EIPS/eip-3554)) delay has been added along PR [#1245](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1245). A `london`-activated block is now doing difficulty calculation and validation with the updated EIP parameters (only PoW chains).

## 3.2.1 - 2021-04-09

- Fixed `BlockData` interface `transactions` typing for EIP-2930 typed txs, PR [#1185](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1185)

## 3.2.0 - 2021-03-18

### Berlin HF Support

This release gets the `Block` library ready for the `berlin` HF by adding support for [EIP2718](https://eips.ethereum.org/EIPS/eip-2718) Typed Transactions. Transaction objects are now created with the new `TransactionFactory` introduced with the `@ethereumjs/tx` `v3.1.0` release which chooses the correct tx type for the data. The initial tx release supports the old legacy transactions and the newly added [EIP2930](https://eips.ethereum.org/EIPS/eip-2930) Access List Transaction Type, see PR [#1048](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1048).

Please note that the default HF is still set to `istanbul`. You therefore need to explicitly set the `hardfork` parameter for instantiating a `Block` instance with a `berlin` HF activated:

```ts
import { Block } from 'ethereumjs-block'
import Common from '@ethereumjs/common'
const common = new Common({ chain: 'mainnet', hardfork: 'berlin' })
const block = Block.fromBlockData({}, { common })
```

#### EthereumJS Libraries - Typed Transactions Readiness

If you are using this library in conjunction with other EthereumJS libraries make sure to minimally have the following library versions installed for typed transaction support:

- `@ethereumjs/common` `v2.2.0`
- `@ethereumjs/tx` `v3.1.0`
- `@ethereumjs/block` `v3.2.0`
- `@ethereumjs/blockchain` `v5.2.0`
- `@ethereumjs/vm` `v5.2.0`

### Other Changes

- Added support for very large chain IDs when using Block `cliqueSigner()` address recovery, PR [#1139](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1139)
- Fixed a TS compilation failure on install relating to `ethereumjs-util` `v7.0.9`, PR [#1136](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1136)

## 3.1.0 - 2021-02-22

### Clique/PoA Support

This release introduces Clique/PoA support for the `Block` library, see the main PR [#1032](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1032) as well as the follow-up PRs [#1074](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1074) and PR [#1088](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1088). The `BlockHeader.validate()` function now properly validates the various Clique/PoA-specific properties (`extraData` checks and others, see API documentation) and `BlockHeader.validateConsensus()` can be used to properly validate that a Clique/PoA block has the correct signature.

For sealing a block on instantiation there is a new `cliqueSigner` constructor option:

```ts
const cliqueSigner = Buffer.from('PRIVATE_KEY_HEX_STRING', 'hex')
const block = Block.fromHeaderData(headerData, { cliqueSigner })
```

Additionally there are the following new utility methods for Clique/PoA related functionality in the `BlockHeader` class:

- `BlockHeader.validateCliqueDifficulty(blockchain: Blockchain): boolean`
- `BlockHeader.cliqueSigHash()`
- `BlockHeader.cliqueIsEpochTransition(): boolean`
- `BlockHeader.cliqueExtraVanity(): Buffer`
- `BlockHeader.cliqueExtraSeal(): Buffer`
- `BlockHeader.cliqueEpochTransitionSigners(): Address[]`
- `BlockHeader.cliqueVerifySignature(signerList: Address[]): boolean`
- `BlockHeader.cliqueSigner(): Address`

See the API docs for a detailed documentation. Note that these methods will throw if called in a non-Clique/PoA context.

### Other Changes

- The `Common` instance passed is now copied to avoid side-effects towards the outer common instance on HF updates, PR [#1089](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1089)
- Fixed a bug where txs have been created with the wrong HF when `hardforkByBlockNumber` is used along with the static constructors, PR [#1089](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1089)
- Fixed a bug where `Common` has not been passed to the returned block in the `blockFromRpc()` method, PR [#1032](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1032)

## 3.0.0 - 2020-11-24

### New Package Name

**Attention!** This new version is part of a series of EthereumJS releases all moving to a new scoped package name format. In this case the library is renamed as follows:

- `ethereumjs-block` -> `@ethereumjs/block`

Please update your library references accordingly or install with:

```shell
npm i @ethereumjs/block
```

### TypeScript/Library Import

This is the first TypeScript based release of the library, see PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72).
The import structure has slightly changed along:

**TypeScript**

```ts
import { BlockHeader } from 'ethereumjs-block'
import { Block } from 'ethereumjs-block'
```

**JavaScript/Node.js**

```javascript
const BlockHeader = require('ethereumjs-block').BlockHeader
const Block = require('ethereumjs-block').Block
```

The library now also comes with a **type declaration file** distributed along with the package published.

### Major Refactoring - Breaking Changes

This release is a major refactoring of the block library to simplify and strengthen its code base. Refactoring work has been done along PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72) (Promises) and PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883) (refactoring of API and internal code structure).

#### New Constructor Params

The way to instantiate a new `BlockHeader` or `Block` object has been completely reworked and is now more explicit, less error prone and produces more `TypeScript` friendly and readable code.

The old direct constructor usage is now discouraged in favor of different dedicated static factory methods to create new objects.

**Breaking**: While the main constructors can still be called, signatures changed significantly and your old `new Block(...)`, `new BlockHeader(...)` instantiations won't work any more and needs to be updated.

**BlockHeader Class**

There are three new factory methods to create a new `BlockHeader`:

1. Pass in a Header-attribute named dictionary to `BlockHeader.fromHeaderData(headerData: HeaderData = {}, opts?: BlockOptions)`:

```ts
const headerData = {
  number: 15,
  parentHash: '0x6bfee7294bf44572b7266358e627f3c35105e1c3851f3de09e6d646f955725a7',
  difficulty: 131072,
  gasLimit: 8000000,
  timestamp: 1562422144,
}
const header = BlockHeader.fromHeaderData(headerData)
```

2. Create a `BlockHeader` from an RLP-serialized header `Buffer` with `BlockHeader.fromRLPSerializedHeader(serialized: Buffer, opts: BlockOptions)`.

```ts
const serialized = Buffer.from(
  'f901f7a06bfee7294bf44572b7266358e627f3c35105e1c3851f3de09e6d646f955725a7a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000830200000f837a120080845d20ab8080a00000000000000000000000000000000000000000000000000000000000000000880000000000000000',
  'hex',
)
const header = BlockHeader.fromRLPSerializedHeader(serialized)
```

3. Create a `BlockHeader` from an array of `Buffer` values, you can do a first short roundtrip test with:

```ts
const valuesArray = header.raw()
BlockHeader.fromValuesArray(valuesArray)
```

Generally internal types representing block header values are now closer to their domain representation (number, difficulty, gasLimit) instead of having everything represented as a `Buffer`.

**Block Class**

There are analog new static factories for the `Block` class:

- `Block.fromBlockData(blockData: BlockData = {}, opts?: BlockOptions)`
- `Block.fromRLPSerializedBlock(serialized: Buffer, opts?: BlockOptions)`
- `Block.fromValuesArray(values: BlockBuffer, opts?: BlockOptions)`

Learn more about the full API in the [docs](./docs/README.md).

#### Immutability

The returned block is now frozen and immutable. To work with a mutable block, copy it with `const fakeBlock = Object.create(block)`.

If you need `Block` mutability - e.g. because you want to subclass `Block` and modify its behavior - there is a `freeze` option to prevent the `Object.freeze()` call on initialization, see PR [#941](https://github.com/ethereumjs/ethereumjs-monorepo/pull/941).

#### Promise-based API

The API of this library is now completely promise-based and the old callback-style interface has been dropped.

This affects the following methods of the API now being defined as `async` and returning a `Promise`:

**Header Class**

- `BlockHeader.validate(blockchain: Blockchain, height?: BN): Promise<void>`

**Block Class**

- `Block.genTxTrie(): Promise<void>`
- `Block.validate(blockChain: Blockchain): Promise<void>`
- `Block.validateUncles(blockchain: Blockchain): Promise<void>`

Usage example:

```javascript
try {
  await block.validate(blockchain)
  // Block validation has passed
} catch (err) {
  // handle errors appropriately
}
```

### Header Validation Methods > Signature Changes

**Breaking**: The signatures of the following header validation methods have been updated to take a `parentBlockHeader` instead of a `parentBlock` input parameter for consistency and removing a circling dependency with `Block`:

- `BlockHeader.canonicalDifficulty(parentBlockHeader: BlockHeader): BN`
- `BlockHeader.validateDifficulty(parentBlockHeader: BlockHeader): boolean`
- `BlockHeader.validateGasLimit(parentBlockHeader: BlockHeader): boolean`

On the `Block` library new corresponding methods have been added which both operate on a block instance and expect a `parentBlock` as an input parameter.

**Breaking:** Note that `canonicalDifficulty()` and `validateDifficulty()` in block and header now throw on non-PoW chains, see PR [#937](https://github.com/ethereumjs/ethereumjs-monorepo/pull/937).

**Breaking:** Non-blockchain dependent validation checks have been extracted from `validate()` to its own `Block.validateData()` function. For the `validate()` method in block and header `blockchain` is now a mandatory parameter, see PR [#942](https://github.com/ethereumjs/ethereumjs-monorepo/pull/942)

### New Default Hardfork

**Breaking:** The default HF on the library has been updated from `petersburg` to `istanbul`, see PR [#906](https://github.com/ethereumjs/ethereumjs-monorepo/pull/906).

The HF setting is now automatically taken from the HF set for `Common.DEFAULT_HARDFORK`, see PR [#863](https://github.com/ethereumjs/ethereumjs-monorepo/pull/863).

### Dual ES5 and ES2017 Builds

We significantly updated our internal tool and CI setup along the work on PR [#913](https://github.com/ethereumjs/ethereumjs-monorepo/pull/913) with an update to `ESLint` from `TSLint` for code linting and formatting and the introduction of a new build setup.

Packages now target `ES2017` for Node.js builds (the `main` entrypoint from `package.json`) and introduce a separate `ES5` build distributed along using the `browser` directive as an entrypoint, see PR [#921](https://github.com/ethereumjs/ethereumjs-monorepo/pull/921). This will result in performance benefits for Node.js consumers, see [here](https://github.com/ethereumjs/merkle-patricia-tree/pull/117) for a related discussion.

### Other Changes

**Features**

- Added `Block.genesis()` and `BlockHeader.genesis()` aliases to create a genesis block or header, PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- Added `DAO` hardfork support (check for `extraData` attribute if `DAO` HF is active), PR [#843](https://github.com/ethereumjs/ethereumjs-monorepo/pull/843)
- Added the `calcDifficultyFromHeader` constructor option. If this `BlockHeader` is supplied, then the `difficulty` of the constructed `BlockHeader` will be set to the canonical difficulty (also if `difficulty` is set as parameter in the constructor). See [#929](https://github.com/ethereumjs/ethereumjs-monorepo/pull/929)
- Added full uncle validation, which verifies if the uncles' `parentHash` points to the canonical chain, is not yet included and also is an uncle and not a canonical block. See PR [#935](https://github.com/ethereumjs/ethereumjs-monorepo/pull/935)
- Additional consistency and validation checks in `Block.validateUncles()` for included uncle headers, PR [#935](https://github.com/ethereumjs/ethereumjs-monorepo/pull/935)

**Changes and Refactoring**

- Added Node `10`, `12` support, dropped Node `7` support, PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
- Passing in a blockchain is now optional on `Block.validate()`, PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- **Breaking**: `Block.validateTransactions(stringError: true)` now returns a `string[]`, PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- **Breaking**: Decoupling of the `Block.serialize()` and `Block.raw()` methods, `Block.serialize()` now always returns the RLP-encoded block (signature change!), `Block.raw()` always returns the pure `Buffer` array, PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- **Breaking**: `Block.toJSON()` now always returns the labeled `JSON` representation, removal of the `labeled` function parameter, PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- Updated `merkle-patricia-tree` dependency to `v4`, PR [#787](https://github.com/ethereumjs/ethereumjs-monorepo/pull/787)
- Updated `ethereumjs-util` dependency to `v7`, PR [#748](https://github.com/ethereumjs/ethereumjs-monorepo/pull/748)
- Removal of the `async` dependency, PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)

**CI and Testing**

- Browser test run on CI, PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
- Karma browser test run config modernization and simplification, PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
- Updated test source files to `TypeScript`, PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)

**Bug Fixes**

- Signature fix for pre-homestead blocks, PR [#67](https://github.com/ethereumjs/ethereumjs-block/issues/67)
- Fixed bug where block options have not been passed on to the main constructor from the static factory methods, see PR [#941](https://github.com/ethereumjs/ethereumjs-monorepo/pull/941)

## 3.0.0-rc.1 - 2020-11-19

This is the first release candidate towards a final library release, see [beta.2](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Fblock%403.0.0-beta.2) and especially [beta.1](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Fblock%403.0.0-beta.1) release notes for an overview on the full changes since the last publicly released version.

- Additional consistency and validation checks in `Block.validateUncles()` for included uncle headers, PR [#935](https://github.com/ethereumjs/ethereumjs-monorepo/pull/935)

## 3.0.0-beta.2 - 2020-11-12

This is the second beta release towards a final library release, see [beta.1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Ftx%403.0.0-beta.1) for an overview on the full changes since the last publicly released version.

- Added `freeze` option to allow for block freeze deactivation (e.g. to allow for subclassing block and adding additional parameters), see PR [#941](https://github.com/ethereumjs/ethereumjs-monorepo/pull/941)
- **Breaking:** Difficulty-depending methods `canonicalDifficulty()` and `validateDifficulty()` in block and header now throw on non-PoW chains, see PR [#937](https://github.com/ethereumjs/ethereumjs-monorepo/pull/937)
- **Breaking:** Non-blockchain dependent validation checks have been extracted from `validate()` to its own `Block.validateData()` function. For the `validate()` method in block and header `blockchain` is now a mandatory parameter, see PR [#942](https://github.com/ethereumjs/ethereumjs-monorepo/pull/942)
- Fixed bug where block options have not been passed on to the main constructor from the static factory methods, see PR [#941](https://github.com/ethereumjs/ethereumjs-monorepo/pull/941)
- Added full uncle validation, which verifies if the uncles' `parentHash` points to the canonical chain, is not yet included and also is an uncle and not a canonical block. See PR [#935](https://github.com/ethereumjs/ethereumjs-monorepo/pull/935).

## 3.0.0-beta.1 - 2020-10-22

### New Package Name

**Attention!** This new version is part of a series of EthereumJS releases all moving to a new scoped package name format. In this case the library is renamed as follows:

- `ethereumjs-block` -> `@ethereumjs/block`

Please update your library references accordingly or install with:

```shell
npm i @ethereumjs/block
```

### TypeScript/Library Import

This is the first TypeScript based release of the library, see PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72).
The import structure has slightly changed along:

**TypeScript**

```ts
import { BlockHeader } from 'ethereumjs-block'
import { Block } from 'ethereumjs-block'
```

**JavaScript/Node.js**

```javascript
const BlockHeader = require('ethereumjs-block').BlockHeader
const Block = require('ethereumjs-block').Block
```

The library now also comes with a **type declaration file** distributed
along with the package published.

### Major Refactoring - Breaking Changes

This release is a major refactoring of the block library to simplify and strengthen its code base.
Refactoring work has been done along PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
(Promises) and PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883) (refactoring of API
and internal code structure).

#### New Constructor Params

The way to instantiate a new `BlockHeader` or `Block` object has been completely reworked and is
now more explicit, less error prone and produces more `TypeScript` friendly and readable code.

The old direct constructor usage is now discouraged in favor of different dedicated static
factory methods to create new objects.

**Breaking**: While the main constructors can still be called, signatures changed significantly and
your old `new Block(...)`, `new BlockHeader(...)` instantiations won't work any more and needs to be
updated.

**BlockHeader Class**

There are three new factory methods to create a new `BlockHeader`:

1. Pass in a Header-attribute named dictionary to `BlockHeader.fromHeaderData(headerData: HeaderData = {}, opts?: BlockOptions)`:

```ts
const headerData = {
  number: 15,
  parentHash: '0x6bfee7294bf44572b7266358e627f3c35105e1c3851f3de09e6d646f955725a7',
  difficulty: 131072,
  gasLimit: 8000000,
  timestamp: 1562422144,
}
const header = BlockHeader.fromHeaderData(headerData)
```

2. Create a `BlockHeader` from an RLP-serialized header `Buffer` with `BlockHeader.fromRLPSerializedHeader(serialized: Buffer, opts: BlockOptions)`.

```ts
const serialized = Buffer.from(
  'f901f7a06bfee7294bf44572b7266358e627f3c35105e1c3851f3de09e6d646f955725a7a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000830200000f837a120080845d20ab8080a00000000000000000000000000000000000000000000000000000000000000000880000000000000000',
  'hex',
)
const header = BlockHeader.fromRLPSerializedHeader(serialized)
```

3. Create a `BlockHeader` from an array of `Buffer` values, you can do a first short roundtrip test with:

```ts
const valuesArray = header.raw()
BlockHeader.fromValuesArray(valuesArray)
```

Generally internal types representing block header values are now closer to their domain representation
(number, difficulty, gasLimit) instead of having everything represented as a `Buffer`.

**Block Class**

There are analog new static factories for the `Block` class:

- `Block.fromBlockData(blockData: BlockData = {}, opts?: BlockOptions)`
- `Block.fromRLPSerializedBlock(serialized: Buffer, opts?: BlockOptions)`
- `Block.fromValuesArray(values: BlockBuffer, opts?: BlockOptions)`

Learn more about the full API in the [docs](./docs/README.md).

#### Immutability

The returned block is now frozen and immutable. To work with a mutable block, copy it with `const fakeBlock = Object.create(block)`.

#### Promise-based API

The API of this library is now completely promise-based and the old callback-style interface
has been dropped.

This affects the following methods of the API now being defined as `async` and
returning a `Promise`:

**Header Class**

- `BlockHeader.validate(blockchain: Blockchain, height?: BN): Promise<void>`

**Block Class**

- `Block.genTxTrie(): Promise<void>`
- `Block.validate(blockChain: Blockchain): Promise<void>`
- `Block.validateUncles(blockchain: Blockchain): Promise<void>`

Usage example:

```javascript
try {
  await block.validate(blockchain)
  // Block validation has passed
} catch (err) {
  // handle errors appropriately
}
```

### Header Validation Methods > Signature Changes

**Breaking**: The signatures of the following header validation methods have been updated to take a `parentBlockHeader` instead of a
`parentBlock` input parameter for consistency and removing a circling dependency with `Block`:

- `BlockHeader.canonicalDifficulty(parentBlockHeader: BlockHeader): BN`
- `BlockHeader.validateDifficulty(parentBlockHeader: BlockHeader): boolean`
- `BlockHeader.validateGasLimit(parentBlockHeader: BlockHeader): boolean`

On the `Block` library new corresponding methods have been added which both operate on a block instance and expect a `parentBlock`
as an input parameter.

### New Default Hardfork

**Breaking:** The default HF on the library has been updated from `petersburg` to `istanbul`, see PR [#906](https://github.com/ethereumjs/ethereumjs-monorepo/pull/906).
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

**Features**

- Added `Block.genesis()` and `BlockHeader.genesis()` aliases to create
  a genesis block or header,
  PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- Added `DAO` hardfork support (check for `extraData` attribute if `DAO` HF is active),
  PR [#843](https://github.com/ethereumjs/ethereumjs-monorepo/pull/843)
- Added the `calcDifficultyFromHeader` constructor option. If this `BlockHeader` is supplied, then the `difficulty` of the constructed `BlockHeader` will be set to the canonical difficulty (also if `difficulty` is set as parameter in the constructor). See [#929](https://github.com/ethereumjs/ethereumjs-monorepo/pull/929)

**Changes and Refactoring**

- Added Node `10`, `12` support, dropped Node `7` support,
  PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
- Passing in a blockchain is now optional on `Block.validate()`,
  PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- **Breaking**: `Block.validateTransactions(stringError: true)` now returns a `string[]`,
  PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- **Breaking**: Decoupling of the `Block.serialize()` and `Block.raw()` methods,
  `Block.serialize()` now always returns the RLP-encoded block (signature change!),
  `Block.raw()` always returns the pure `Buffer` array,
  PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- **Breaking**: `Block.toJSON()` now always returns the labeled `JSON` representation,
  removal of the `labeled` function parameter,
  PR [#883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/883)
- Updated `merkle-patricia-tree` dependency to `v4`,
  PR [#787](https://github.com/ethereumjs/ethereumjs-monorepo/pull/787)
- Updated `ethereumjs-util` dependency to `v7`,
  PR [#748](https://github.com/ethereumjs/ethereumjs-monorepo/pull/748)
- Removal of the `async` dependency,
  PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)

**CI and Testing**

- Browser test run on CI,
  PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
- Karma browser test run config modernization and simplification
  PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)
- Updated test source files to `TypeScript`,
  PR [#72](https://github.com/ethereumjs/ethereumjs-block/pull/72)

**Bug Fixes**

- Signature fix for pre-homestead blocks,
  PR [#67](https://github.com/ethereumjs/ethereumjs-block/issues/67)

## [2.2.2] - 2019-12-17

**MuirGlacier** support by updating to the new difficulty formula as stated
in [EIP-2384](https://eips.ethereum.org/EIPS/eip-2384).

Please note that this release does not contain all the changes merged into
master since the `v2.2.0` release and only backports the difficulty formula
adjustments to support MuirGlacier without having to go through migration to
the `v3.0.0` which contains breaking changes.

[2.2.2]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%402.2.1...%40ethereumjs%2Fblock%402.2.2

## [2.2.1] - 2019-11-14

**Istanbul** support by updating to the most recent `ethereumjs-tx` version
[v2.1.1](https://github.com/ethereumjs/ethereumjs-tx/releases/tag/v2.1.1).

Please note that this release does not contain all the changes merged into
master since the `v2.2.0` release and only backports the most recent
`ethereumjs-tx` version to allow users to support Istanbul without having
to go through migration to the `v3.0.0` which contains breaking changes.

[2.2.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%402.2.0...%40ethereumjs%2Fblock%402.2.1

## [2.2.0] - 2019-02-06

**Petersburg** (aka `constantinopleFix`) as well as **Goerli**
support/readiness by updating to a supporting `ethereumjs-common` version
[v1.1.0](https://github.com/ethereumjs/ethereumjs-common/releases/tag/v1.1.0),
PR [#64](https://github.com/ethereumjs/ethereumjs-block/pull/64)

**Other Changes:**

- Fixed package size issue by excluding tests and docs from being included in
  the package, PR [#66](https://github.com/ethereumjs/ethereumjs-block/pull/66)
- Error message fixes in `index.js`,
  PR [#62](https://github.com/ethereumjs/ethereumjs-block/pull/62)
- Replace uses of deprecated `new Buffer` with `Buffer.from`,
  PR [#60](https://github.com/ethereumjs/ethereumjs-block/pull/60)
- Remove `ethereumjs-testing` dependency (much smaller dev dependencies),
  PR [#61](https://github.com/ethereumjs/ethereumjs-block/pull/61)

[2.2.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%402.1.0...%40ethereumjs%2Fblock%402.2.0

## [2.1.0] - 2018-10-19

- **Constantinople** support, added difficulty bomb delay (EIP-1234), PR [#54](https://github.com/ethereumjs/ethereumjs-block/pull/54)
- Updated test data, added Constantinople tests, PR [#56](https://github.com/ethereumjs/ethereumjs-block/pull/56), [#57](https://github.com/ethereumjs/ethereumjs-block/pull/57)
- Added `timestamp` field to `setGenesisParams()`, PR [#52](https://github.com/ethereumjs/ethereumjs-block/pull/52)

[2.1.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%402.0.1...%40ethereumjs%2Fblock%402.1.0

## [2.0.1] - 2018-08-08

- Fixes `BlockHeader.prototype.validate()` bug, see PR [#49](https://github.com/ethereumjs/ethereumjs-block/pull/49)

[2.0.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%402.0.0...%40ethereumjs%2Fblock%402.0.1

## [2.0.0] - 2018-06-25

This release introduces both support for different `chains` (`mainnet`, `ropsten`, ...)
and `hardforks` up to the latest applied HF (`byzantium`). Parameters and genesis values
are provided by the new [ethereumjs-common](https://github.com/ethereumjs/ethereumjs-common)
library which also defines the set of supported chains and forks.

Changes in detail:

- New initialization parameters `opts.chain` (default: `mainnet`) and `opts.hardfork`
  (default: `null`, block number-based behaviour), PR [#44](https://github.com/ethereumjs/ethereumjs-block/pull/44)
- Alternatively a `Common` class object can be provided directly with the `opts.common` parameter,
  see [API](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/docs/index.md) docs
- Correct block validation for all know hardforks, PR
  [#47](https://github.com/ethereumjs/ethereumjs-block/pull/47), if no hardfork is set validation logic
  is determined by block number in combination with the `chain` set
- Genesis block initialization depending on the `chain` set (see `ethereumjs-common` for supported chains)
- Extensive test additions to cover the newly introduced capabilities and changes
- Fix default value for `nonce` (empty buffer -> `<Buffer 00 00 00 00 00 00 00 00>`), PR [#42](https://github.com/ethereumjs/ethereumjs-block/pull/42)

[2.0.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.7.1...%40ethereumjs%2Fblock%402.0.0

## [1.7.1] - 2018-02-15

- Fix `browserify` issue blocking updates for packages depending on `ethereumjs-block`
  library, PR [#40](https://github.com/ethereumjs/ethereumjs-block/pull/40)
- Updated `ethereumjs/common` dependency, PR [#38](https://github.com/ethereumjs/ethereumjs-block/pull/38)

[1.7.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.7.0...%40ethereumjs%2Fblock%401.7.1

## [1.7.0] - 2017-10-11

- `Metro-Byzantium` compatible
- New difficulty formula (EIP 100)
- Difficulty bomb delay (EIP 649)
- Removed `isHomestead`, `isHomesteadReprice` from API methods

[1.7.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.6.0...%40ethereumjs%2Fblock%401.7.0

## [1.6.0] - 2017-07-12

- Breakout header-from-rpc as separate module

[1.6.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.5.1...%40ethereumjs%2Fblock%401.6.0

## [1.5.1] - 2017-06-04

- Dev dependency updates
- BN for gas limit

[1.5.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.5.0...%40ethereumjs%2Fblock%401.5.1

## Older releases:

- [1.5.0](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.4.0...%40ethereumjs%2Fblock%401.5.0) - 2017-01-31
- [1.4.0](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.3.1...%40ethereumjs%2Fblock%401.4.0) - 2016-12-15
- [1.3.1](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.3.0...%40ethereumjs%2Fblock%401.3.1) - 2016-10-14
- [1.3.0](https://github.com/ethereumjs/ethereumjs-monorepo/compare/%40ethereumjs%2Fblock%401.2.2...%40ethereumjs%2Fblock%401.3.0) - 2017-10-11
