# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 7.0.0-alpha.1 - 2024-10-17

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

### Other Changes

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)
- "Guard" logging to only run with `ethjs` guard, PR [#3654](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3654/)
- Debug logger namespace standardization (use with `#` for the core logger, so e.g. `devp2p:#`), PR [#3692](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3692)

## 6.1.3 - 2024-08-15

Maintenance release with downstream dependency updates, see PR [#3527](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3527)

## 6.1.2 - 2024-03-18

- Fix a type error related to the `lru-cache` dependency, PR [#3285](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3285)
- Downstream dependency updates, see PR [#3297](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3297)

## 6.1.1 - 2024-02-08

- Hotfix release adding a missing `debug` dependency to the `@ethereumjs/trie` package (dependency), PR [#3271](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3271)

## 6.1.0 - 2024-02-08

### WASM Crypto Support

With this release round there is a new way to replace the native JS crypto primitives used within the EthereumJS ecosystem by custom/other implementations in a controlled fashion, see PR [#3192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3192).

This can e.g. be used to replace time-consuming primitives like the commonly used `keccak256` hash function with a more performant WASM based implementation, see `@ethereumjs/common` [README](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/common) for some detailed guidance on how to use.

### Self-Contained (and Working 🙂) README Examples

All code examples in `EthereumJS` monorepo library README files are now self-contained and can be executed "out of the box" by simply copying them over and running "as is", see tracking issue [#3234](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3234) for an overview. Additionally all examples can now be found in the respective library [examples](./examples/) folder (in fact the README examples are now auto-embedded from over there). As a nice side effect all examples are now run in CI on new PRs and so do not risk to get outdated or broken over time.

### Other Changes

- Debug log optimizations, PR [#3165](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3165)
- Dependency updates, PR [#3212](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3212)

## 6.0.1 - 2023-10-26

- Kademlia bucket add fix, PR [#2957](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2957)
- Performance: only create `DEBUG` msgs if debugging, PR [#2958](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2958)
- Pin `scanf` dependency (fixes broken types), PR [#3060](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3060)
- Minimal `RLPx` test suite, PR [#3126](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3126)

## 6.0.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Fdevp2p%406.0.0-rc.1) for the main change description.

Following additional changes since RC1:

### Event Emitter Refactor

We have reworked the `EventEmitter` integration for the library and switched away from the structure where all central classes (like e.g. `RLPx`) directly inherit from `EventEmitter`. Instead, we now have the `EventEmitter` in a dedicated `events` property associated with the respective class, see PR [#2893](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2893). This aligns with how event emitters are implemented in other libraries (e.g. the VM or the client), leads to a cleaner API usage (autocomplete in an IDE now only shows the relevant methods) and allows for an easier customization of the library.

Event usage has to be adopted as follows:

```ts
rlpx.on('peer:added', (peer) => { // old
  // Do something
}

rlpx.events.on('peer:added', (peer) => { // new
  // Do something
}
```

Event emitter logic in the following components from the public API has been reworked:

- `DPT`
- `RLPx`
- `ETH`
- `LES`
- `SNAP` (in development)

### Other Changes

- Address security vulnerabilities, PR [#2912](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2912)

## 6.0.0-rc.1 - 2023-07-18

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

### ETH/67 and ETH/68 Support

Support for both `ETH/67` (see PR [#2263](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2263)) and `ETH/68` (see PR [#2828](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2828)) have been added to the library.

The [ETH/67](https://github.com/ethereum/devp2p/blob/master/caps/eth.md#eth67-eip-4938-march-2022) protocol version removes `GetNodeData` and `NodeData` messages, now largely substituted by the `SNAP` protocol.

The [ETH/68](https://github.com/ethereum/devp2p/blob/master/caps/eth.md#eth68-eip-5793-october-2022) protocol version "changes the `NewPooledTransactionHashes` message to include types and sizes of the announced transactions".

### Improved Typing / API Changes

Typing for the `devp2p` library has been significantly improved with PR [#2863](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2863) and the API has been consolidated along PR [#2889(https://github.com/ethereumjs/ethereumjs-monorepo/pull/2889).

There are the following distinct API changes:

- Types and interfaces generally have been consolidated in a `types.ts` file (as in the other EthereumJS libraries)
- Rename: `devp2p.DISCONNECT_REASONS` -> `devp2p.DISCONNECT_REASON`
- Rename: `EthProtocol` -> `ProtocolType` (e.g. `ProtocolType.ETH`)

Beyond all `_*` methods and properties are now explicitly marked as `protected` (to leave some room for extensibility) in TypeScript which makes the API easier to use in IDEs and the like and avoids accidental accesses.

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
// DPT
new DPT(privateKey: Uint8Array, options: DPTOptions)
DPT.getPeer(obj: string | Uint8Array | PeerInfo)
DPT.getClosestPeers(id: Uint8Array)
DPT.banPeer(obj: string | Uint8Array | PeerInfo, maxAge?: number)

// RLPx
new RLPx(privateKey: Uint8Array, options: RLPxOptions)
RLPx.disconnect(id: Uint8Array)

// ETH
ETH.senStatus()
ETH.sendMessage()
ETH.on('message', () => { ... })
```

Eventually it is a good idea to generally have a closer look at code parts where events are received, so e.g. do an ".on" search in your IDE.

We have converted existing Buffer conversion methods to Uint8Array conversion methods in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

#### Prefixed Hex Strings as Default

The mixed usage of prefixed and unprefixed hex strings is a constant source of errors in byte-handling code bases.

We have therefore decided to go "prefixed" by default, see PR [#2830](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2830) and [#2845](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2845).

The `hexToBytes` and `bytesToHex` methods, also similar methods like `intToHex`, now take `0x`-prefixed hex strings as input and output prefixed strings. The corresponding unprefixed methods are marked as `deprecated` and usage should be avoided.

Please therefore check you code base on updating and ensure that values you are passing to constructors and methods are prefixed with a `0x`.

### Other Changes

- Support for `Node.js 16` has been removed (minimal version: `Node.js 18`), PR [#2859](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2859)

## 5.1.2 - 2023-04-20

- Update ethereum-cryptography from 1.2 to 2.0 (switch from noble-secp256k1 to noble-curves), PR [#2641](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2641)
- Bump `@ethereumjs/util` `@chainsafe/ssz` dependency to 0.11.1 (no WASM, native SHA-256 implementation, ES2019 compatible, explicit imports), PRs [#2622](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2622), [#2564](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2564) and [#2656](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2656)

## 5.1.1 - 2023-02-27

- Pinned `@ethereumjs/util` `@chainsafe/ssz` dependency to `v0.9.4` due to ES2021 features used in `v0.10.+` causing compatibility issues, PR [#2555](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2555)

## 5.1.0 - 2023-02-21

**DEPRECATED**: Release is deprecated due to broken dependencies, please update to the subsequent bugfix release version.

This release updates the underlying `@ethereumjs/common` dependency version to make the library ready for the upcoming `Shanghai` hardfork (scheduled for early 2023) regarding the `forkHash` related fork switch logic, see PR [#2521](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2521). Note that a `timestamp` to trigger the `Shanghai` fork update is only added to Common for the `sepolia` testnet and not yet for `goerli` or `mainnet`.

You can instantiate a Shanghai-enabled Common instance with:

```ts
import { Common, Chain, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai })
```

### Other Changes

- Fixed DNS Discovery ENR record decoding (better connectivity, avoids loosing DNS peer suggestions), PR [#2546](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2546)
- Removed outdated Parity DPT ping/pong hack, PR [#2538](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2538)
- Improved devp2p HELLO logging message (added protocol version and client ID), PR [#2538](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2538)

## 5.0.2 - 2022-12-09

### Hardfork-By-Time Support

The devp2p library is now ready to work with hardforks triggered by timestamp, which will first be applied along the `Shanghai` HF, see PR [#2437](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2437). This is achieved by integrating a new timestamp supporting `@ethereumjs/common` library version.

One specific devp2p change is that the forkid is now calculated based on timestamps for timestamp-based HFs, see [EIP-6122](https://github.com/ethereum/EIPs/pull/6122).

## 5.0.1 - 2022-10-18

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

### Other Changes and Fixes

- Added env check (performance optimization) for DEBUG mode using `debug` package, PR [#2311](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2311)

## 5.0.0 - 2022-09-06

Final release - tada 🎉 - of a wider breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2, Beta 3 and Release Candidate (RC) 1 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/devp2p/CHANGELOG.md)).

### Changes

- Internal refactor: removed ambiguous boolean checks within conditional clauses, PR [#2254](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2254)

## 5.0.0-rc.1 - 2022-08-29

Release candidate 1 for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 and 3 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/devp2p/CHANGELOG.md)).

### Fixed Mainnet Merge HF Default

Since this bug was so severe it gets its own section: `mainnet` in the underlying `@ethereumjs/common` library (`Chain.Mainnet`) was accidentally not updated yet to default to the `merge` HF (`Hardfork.Merge`) by an undiscovered overwrite back to `london`.

This has been fixed in PR [#2206](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2206) and `mainnet` now default to the `merge` as well.

### Maintenance Updates

- Added `engine` field to `package.json` limiting Node versions to v14 or higher, PR [#2164](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2164)
- Replaced `nyc` (code coverage) configurations with `c8` configurations, PR [#2192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2192)
- Code formats improvements by adding various new linting rules, see Issue [#1935](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1935)

## 5.0.0-beta.3 - 2022-08-10

Beta 3 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/devp2p/CHANGELOG.md)).

### Merge Hardfork Default

Since the Merge HF is getting close we have decided to directly jump on the `Merge` HF (before: `Istanbul`) as default in the underlying `@ethereumjs/common` library and skip the `London` default HF as we initially intended to set (see Beta 1 CHANGELOG), see PR [#2087](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2087).

This change should not directly affect this library but might be relevant since it is not recommended to use different Common library versions between the different EthereumJS libraries.

## 5.0.0-beta.2 - 2022-07-15

Beta 2 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/devp2p/CHANGELOG.md)) for the main change set description.

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

## SNAP Protocol Support

[Ethereum Snapshot Protocol](https://github.com/ethereum/devp2p/blob/master/caps/snap.md) (SNAP) support has been added in PR [#1883](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1883). This allows to run the SNAP protocol as a side-protocol to the ETH protocol for exchanging state snapshots between peers.

## Other Changes

- Added `ESLint` strict boolean expressions linting rule, PR [#2030](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2030)

## 5.0.0-beta.1 - 2022-06-30

This release is part of a larger breaking release round where all [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries (VM, Tx, Trie, other) get major version upgrades. This round of releases has been prepared for a long time and we are really pleased with and proud of the result, thanks to all team members and contributors who worked so hard and made this possible! 🙂 ❤️

We have gotten rid of a lot of technical debt and inconsistencies and removed unused functionality, renamed methods, improved on the API and on TypeScript typing, to name a few of the more local type of refactoring changes. There are also broader structural changes like a full transition to native JavaScript `BigInt` values as well as various somewhat deep-reaching refactorings, both within a single package as well as some reaching beyond the scope of a single package. Also two completely new packages - `@ethereumjs/evm` (in addition to the existing `@ethereumjs/vm` package) and `@ethereumjs/statemanager` - have been created, leading to a more modular Ethereum JavaScript VM.

We are very much confident that users of the libraries will greatly benefit from the changes being introduced. However - along the upgrade process - these releases require some extra attention and care since the changeset is both so big and deep reaching. We highly recommend to closely read the release notes, we have done our best to create a full picture on the changes with some special emphasis on delicate code and API parts and give some explicit guidance on how to upgrade and where problems might arise!

So, enjoy the releases (this is a first round of Beta releases, with final releases following a couple of weeks after if things go well)! 🎉

The EthereumJS Team

### BigInt Introduction / ES2020 Build Target

With this round of breaking releases the whole EthereumJS library stack removes the [BN.js](https://github.com/indutny/bn.js/) library and switches to use native JavaScript [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) values for large-number operations and interactions.

This makes the libraries more secure and robust (no more BN.js v4 vs v5 incompatibilities) and generally comes with substantial performance gains for the large-number-arithmetic-intense parts of the libraries (particularly the VM).

To allow for BigInt support our build target has been updated to [ES2020](https://262.ecma-international.org/11.0/). We feel that some still remaining browser compatibility issues on the edges (old Safari versions e.g.) are justified by the substantial gains this step brings along.

See [#1671](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1671) and [#1771](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1771) for the core `BigInt` transition PRs.

### Disabled esModuleInterop and allowSyntheticDefaultImports TypeScript Compiler Options

The above TypeScript options provide some semantic sugar like allowing to write an import like `import React from "react"` instead of `import * as React from "react"`, see [esModuleInterop](https://www.typescriptlang.org/tsconfig#esModuleInterop) and [allowSyntheticDefaultImports](https://www.typescriptlang.org/tsconfig#allowSyntheticDefaultImports) docs for some details.

While this is convenient, it deviates from the ESM specification and forces downstream users into using these options, which might not be desirable, see [this TypeScript Semver docs section](https://www.semver-ts.org/#module-interop) for some more detailed argumentation.

Along with the breaking releases we have therefore deactivated both of these options and you might therefore need to adapt some import statements accordingly. Note that you still can activate these options in your bundle and/or transpilation pipeline (but now you also have the option _not_ to, which you didn't have before).

### Other Changes

- Removed Node.js specific `assert` usage, PR [#1924](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1924)
- Deduplicated `keccak` and `secp256k1` library usage in favor of `ethereum-cryptography`, Noble crypto library uses, PR [#1947](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1947)
- Replaced `hi-base32` dependency with `@scure/base` from [@paulmillr](https://github.com/paulmillr) (Noble crypto library author), PR [#1947](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1947)

## 4.2.2 - 2022-04-29

- Solved memory leak "DPT discovers nodes when open_slots = 0", PR [#1816](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1816)
- Fixed per-message debug logging, PR [#1776](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1776)
- ETH-LES class refactor, PR [#1600](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1600)

## 4.2.1 - 2022-02-01

- Dependencies: deduplicated RLP import, PR [#1549](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1549)
- Fixed duplicated debug messages (`DEBUG` logger, see `README`), PR [#1643](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1643)

## 4.2.0 - 2021-09-24

### EIP-706 Snappy Compression (RLPx v5)

This release adds support for RLPx v5 allowing for the compression of RLPx messages with the Snappy compression algorithm as defined in [EIP-706](https://eips.ethereum.org/EIPS/eip-706). If the connecting peer doesn't support v5, the connection falls back to v4 and does the communication without compressing the payload.

See: PRs [#1399](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1399), [#1442](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1442) and [#1484](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1484)

### Improved Per-Message Debugging

Per-message debugging with the `debug` package has been substantially expanded and allow for a much more targeted debugging experience.

There are new debug loggers added to:

- Debug per specific `ETH` or `LES` message (e.g. `devp2p:eth:GET_BLOCK_HEADERS`)
- Debug per disconnect reason (e.g. `devp2p:rlpx:peer:DISCONNECT:TOO_MANY_PEERS`)
- Debug per peer IP address (e.g. `devp2p:3.209.45.79`)
- Debug per first connected peer (`DEBUG=devp2p:FIRST_PEER`)

See: PR [#1449](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1449)

## 4.1.0 - 2021-07-15

### Finalized London HF Support

This release integrates a `Common` library version which provides the `london` HF blocks for all networks including `mainnet` and is therefore the first release with finalized London HF support. For the `devp2p` library this particularly means that the fork hashes for the `london` HF will be correct when using eth/64 or higher.

### Support for eth/66 and les/4

PR [#1331](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1331) added support for eth/66 and [#1324](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1324) for les/4. Be sure to check out the updated peer communication [examples](./examples).

### Included Source Files

Source files from the `src` folder are now included in the distribution build, see PR [#1301](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1301). This allows for a better debugging experience in debug tools like Chrome DevTools by having working source map references to the original sources available for inspection.

### Bug Fixes

- Fixed zero Buffer forkhash bug in case no future fork known, PR #1148 commit [`afd00a8`](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1148/commits/afd00a8bfee1b524352a0f6c79f3bcfe43debe4c)

## 4.0.0 - 2021-04-22

**Attention!** This new version is part of a series of EthereumJS releases all moving to a new scoped package name format. In this case the library is renamed as follows:

- `ethereumjs-devp2p` -> `@ethereumjs/devp2p`

Please update your library references accordingly or install with:

```shell
npm i @ethereumjs/devp2p
```

This is the first-production ready release of this library. During our work on the [EthereumJS Client](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/client) we were finally able to battle-test this library in a real-world environment (so: towards `mainnet`, the main official testnets like `goerli` or `rinkeby` as well as ephemeral testnets like `yolov3`). We fixed a myriad of partly critical bugs along the way (which are extremely hard to reproduce just in a test environment) and can now fully recommend to use this library for `ETH` protocol integrations up to version `ETH/65` in a production setup. Note that the `LES` support in the library is still outdated (but working), an update is planned (let us know if you have demand).

### ETH/64 and ETH/65 Support

The `ETH` protocol support has been updated to now also support versions `64` and `65`. Biggest protocol update here is `ETH/64` introduced with PR [#82](https://github.com/ethereumjs/ethereumjs-devp2p/pull/82) which adds support for selecting peers by fork ID (see associated [EIP-2124](https://eips.ethereum.org/EIPS/eip-2124)). This allows for a much more differentiated chain selection and avoids connecting to peers which are on a different chain but having a shared chain history with the same blocks and the same block hashes.

`ETH/65` implemented in PR [#1159](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1159) adds three new message types `NewPooledTransactionHashes (0x08)`, `GetPooledTransactions (0x09)` and `PooledTransactions (0x0a)` for a more efficient exchange on txs from the tx pool ([EIP-2464](https://eips.ethereum.org/EIPS/eip-2464)).

### DNS Discovery Support

Node discovery via DNS has been added to quickly acquire testnet (or mainnet) peers from the DNS ENR tree per [EIP-1459](https://eips.ethereum.org/EIPS/eip-1459), see PRs [#1070](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1070), [#1097](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1097) and [#1149](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1149). This allows for easier peer discovery especially on the testnets. Peer search is randomized as being recommended in the EIP and the implementation avoids to download the entire DNS tree at once.

DNS discovery can be activated in the `DPT` module with the `shouldGetDnsPeers` option, in addition there is a new `shouldFindNeighbours` option allowing to deactivate the classical v4 discovery process. Both discovery methods can be used in conjunction though. DNS Peer discovery can be customized/configured with additional constructor options `dnsRefreshQuantity`, `dnsNetworks` and `dnsAddress`. See [API section](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/devp2p#api) in the README for a description.

### Other Features / Changes

- Updated `goerli` bootnodes, PR [#1031](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1031)
- `maxPeers`, `dpt`, and `listenPort` are now optional in `RLPxOptions`, PR [#1019](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1019)
- New `DPTOptions` interface, `DPT` type improvements, PR [#1029](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1029)
- Improved `RLPx` disconnect reason debug output, PR [#1031](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1031)
- `LES`: unify `ETH` and `LES` `sendMessage()` signature by somewhat change payload semantics and pass in `reqId` along, PR [#1087](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1087)
- `RLPx`: limit connection refill debug logging to a restarted interval log message to not bloat logging too much, PR [#1087](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1087)

### Connection Reliability / Bug Fixes

- Subdivided interval calls to refill `RLPx` peer connections to improve networking distribution and connection reliability, PR [#1036](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1036)
- Fixed an error in `DPT` not properly banning old peers and replacing with a new peer on `KBucket` ping, PR [#1036](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1036)
- Connection reliability: distribute network traffic on `DPT` additions of new neighbour peers, PR [#1036](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1036)
- Fixed a critical peer data processing bug, PR [#1064](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1064)
- Added socket destroyed checks on peer message sending to safeguard against stream-was-destroyed error, PR [#1075](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1075)
- `DPT`: fixed undefined array access in ETH.\_getStatusString() on malformed ETH/64 status msgs, PR [#1029](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1029)

### Maintenance / Testing / CI

- Added dedicated browser build published to `dist.browser` to `package.json`, PR [#1184](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1184)
- Updated `rlp-encoding` dependency to the EthereumJS `rlp` library, PR [#94](https://github.com/ethereumjs/ethereumjs-devp2p/pull/94)
- `RLPx` type improvements, PR [#1036](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1036)
- Switched to `Codecov`, PR [#92](https://github.com/ethereumjs/ethereumjs-devp2p/pull/92)
- Upgraded dev deps (config 2.0, monorepo betas, typedoc), PR [#93](https://github.com/ethereumjs/ethereumjs-devp2p/pull/93)

## [3.0.3] - 2020-09-29

- Moved `TypeScript` type packages for `lru-cache` and `bl` from `devDependencies` to
  `dependencies`, PR [#90](https://github.com/ethereumjs/ethereumjs-devp2p/pull/90)

[3.0.3]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v3.0.2...v3.0.3

## [3.0.2] - 2020-09-28

- Fixed `TypeScript` import issue causing problems when integrating the library in a
  `TypeScript` project, PR [#88](https://github.com/ethereumjs/ethereumjs-devp2p/pull/88)
- Updated `k-bucket` library to `v5`, added types from new `@types/k-bucket` package from
  @tomonari-t, PR [#88](https://github.com/ethereumjs/ethereumjs-devp2p/pull/88)

[3.0.2]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v3.0.1...v3.0.2

## [3.0.1] - 2020-06-10

This release focuses on improving the [debugging](https://github.com/ethereumjs/ethereumjs-devp2p#debugging)
capabilities of the library. PR [#72](https://github.com/ethereumjs/ethereumjs-devp2p/pull/72)
reduces the **verbosity** of the log output to cut on noise on everyday debugging. There is a new `verbose`
logger to retain the more verbose output (e.g. with full message bodies) which can be used like this:

```shell
DEBUG=devp2p:*,verbose node -r ts-node/register ./examples/peer-communication.ts
```

**Other Logging Improvements**

Relevant PRs [#75](https://github.com/ethereumjs/ethereumjs-devp2p/pull/75) and
[#73](https://github.com/ethereumjs/ethereumjs-devp2p/pull/73):

- Added number of peers to `refillConnections()` debug message
- Replaced try/catch logic for EIP-8 auth check to avoid side-effects and get rid of misleading _wrong-ecies-header_ debug output
- Moved debug output in `BanList.add()` after the set operation to get the correct size output
- Added debug message for `DISCONNECT` reason from peer (this was always some constant re-debug reason, and at the end it's mostly `TOO_MANY_PEERS`)
- Internalize detached logger output from the `devp2p:util` logger

**Other Changes**

- Refactored `Peer` class for better code readability, PR [#77](https://github.com/ethereumjs/ethereumjs-devp2p/pull/77)

There has also been a new [high-level diagram](https://github.com/ethereumjs/ethereumjs-devp2p#api) added to the `README` which can be used to get an overview on the structure, available loggers and the event flow of the library (PR [#76](https://github.com/ethereumjs/ethereumjs-devp2p/pull/76)).

[3.0.1]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v3.0.0...v3.0.1

## [3.0.0] - 2020-05-25

First `TypeScript` release of the library, see PR [#56](https://github.com/ethereumjs/ethereumjs-devp2p/pull/56) for all the changes and associated discussion.

All source parts of the library have been ported to `TypeScript` and working with the library should now therefore be much more reliable due to the additional type safety features provided by the `TypeScript` language. The API of the library remains unchanged in a `JavaScript` context.

**Noteworthy Changes from PR [#56](https://github.com/ethereumjs/ethereumjs-devp2p/pull/56):**

- Type additions for all method signatures and class members of all protocol components (`dpt`, `eth`, `les`, `rlpx`)
- Addition of various structuring interfaces (like [PeerInfo](https://github.com/ethereumjs/ethereumjs-devp2p/blob/master/src/dpt/message.ts#L10) for `DPT` message input) and `enum` constructs (like [MESSAGE_CODES](https://github.com/ethereumjs/ethereumjs-devp2p/blob/master/src/eth/index.ts#L186) from the `ETH` protocol)
- Port of the [examples](https://github.com/ethereumjs/ethereumjs-devp2p/tree/master/examples) to `TypeScript`
- Port of all the [test cases](https://github.com/ethereumjs/ethereumjs-devp2p/tree/master/test) to `TypeScript`
- Integration of the library into the common [ethereumjs-config](https://github.com/ethereumjs/ethereumjs-config) EthereumJS configuration setup (`standard` -> `TSLint` linting, docs with `TypeDoc`, `TypeScript` compilation, `Prettier` formatting rules)
- Lots of code cleanups and code part modernizations

Thanks @dryajov for all the great work on this! ❤

**Other Updates:**

- Added Node 12,13 support, upgrade from Travis to GitHub actions, PR [#57](https://github.com/ethereumjs/ethereumjs-devp2p/pull/57)
- Updated `ethereumjs-common` dependency to `v1.5.1` for a bootnode update, PR [#67](https://github.com/ethereumjs/ethereumjs-devp2p/pull/67)
- Removed Node 6, 8 support, updated `secp256k1` dependency to from `v3.1.0` to `v4.0.1`, PR [#68](https://github.com/ethereumjs/ethereumjs-devp2p/pull/68)
- Updated `keccak` dependency to `v3.0.0`, PR [#64](https://github.com/ethereumjs/ethereumjs-devp2p/pull/64)
- Some dependency cleanup, PRs [#62](https://github.com/ethereumjs/ethereumjs-devp2p/pull/62), [#65](https://github.com/ethereumjs/ethereumjs-devp2p/pull/65), [#58](https://github.com/ethereumjs/ethereumjs-devp2p/pull/58)

[3.0.0]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.5.1...v3.0.0

## [2.5.1] - 2018-12-12

- Fix connection error by ignoring `RLPX` peers with missing tcp port, PR [#45](https://github.com/ethereumjs/ethereumjs-devp2p/pull/45)

[2.5.1]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.5.0...v2.5.1

## [2.5.0] - 2018-03-22

- Light client protocol (`LES/2`) implementation, PR [#21](https://github.com/ethereumjs/ethereumjs-devp2p/pull/21)
- `LES/2` usage example, see: `examples/peer-communication-les.js`
- Better test coverage for upper-layer protocols (`ETH`, `LES/2`), PR [#34](https://github.com/ethereumjs/ethereumjs-devp2p/pull/34)

[2.5.0]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.4.0...v2.5.0

## [2.4.0] - 2018-02-28

- First release providing a reliable `ETH` connection
- Fix Parity `DPT` ping echo hash bug preventing the library to connect
  to Parity clients, PR [#32](https://github.com/ethereumjs/ethereumjs-devp2p/pull/32)
- Fixed a bug not setting weHello in peer after sent `HELLO` msg

[2.4.0]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.3.0...v2.4.0

## [2.3.0] - 2018-02-27

- Fix critical `RLPX` bug leading to not processing incoming `EIP-8` `Auth` or `Ack` messages, PR [#26](https://github.com/ethereumjs/ethereumjs-devp2p/pull/26)
- Fix bug not forwarding `k-bucket` remove event through `DPT` (so `peer:removed` from
  `DPT` was not working), PR [#27](https://github.com/ethereumjs/ethereumjs-devp2p/pull/27)
- Fix updating `ingressMac` with wrong `Auth` msg leading to diverging `Mac` hashes, PR [#29](https://github.com/ethereumjs/ethereumjs-devp2p/pull/29)
- Fix bug not let first `ETH` `status` message emit a `message` event, PR [#30](https://github.com/ethereumjs/ethereumjs-devp2p/pull/30)
- Large rework of the test setup, additional `DPT`, `RLPX` and `ETH` simulator tests,
  improving test coverage from 48% to 84%, PR [#25](https://github.com/ethereumjs/ethereumjs-devp2p/pull/25)

[2.3.0]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.2.0...v2.3.0

## [2.2.0] - 2017-12-07

- `EIP-8` compatibility
- Improved debug messages
- Fixes a bug on DPT ping timeout being triggered even if pong message is received
- Only send connect event after both HELLO msgs are exchanged (fixes unreliable upper-protocol communication start)
- Connection reliability improvements for `peer-communication` example
- API documentation

[2.2.0]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.1.3...v2.2.0

## [2.1.3] - 2017-11-09

- Dependency updates
- Improved README documentation

[2.1.3]: https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.1.2...v2.1.3

## Older releases:

- [2.1.2](https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.1.1...v2.1.2) - 2017-05-16
- [2.1.1](https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.1.0...v2.1.1) - 2017-04-27
- [2.1.0](https://github.com/ethereumjs/ethereumjs-devp2p/compare/v2.0.0...v2.1.0) - 2016-12-11
- [2.0.0](https://github.com/ethereumjs/ethereumjs-devp2p/compare/v1.0.0...v2.0.0) - 2016-11-14
- 1.0.0 - 2016-10-18
