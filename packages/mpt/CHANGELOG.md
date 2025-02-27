# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 7.0.0-alpha.1 - 2024-10-17

This is a first round of `alpha` releases for our upcoming breaking release round with a focus on bundle size (tree shaking) and security (dependencies down + no WASM (by default)). Note that `alpha` releases are not meant to be fully API-stable yet and are for early testing only. This release series will be then followed by a `beta` release round where APIs are expected to be mostly stable. Final releases can then be expected for late October/early November 2024.

### Renamings

#### New Package Name

The trie package itself has been renamed, see PR [#3719](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3719):

- `@ethereumjs/trie` -> `@ethereumjs/mpt`

This is to avoid confusion with Verkle in the future! Please update your dependencies and imports accordingly! The versioning of the package will be continuous from the old package and not "restart" in whatever way.

#### Main Class

The main class has been renamed to avoid confusion with Verkle, see PR [#3717](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3717):

- `Trie` -> `MerklePatriciaTrie`

#### Static Constructors

The static constructors for our library classes have been reworked to now be standalone methods (with a similar naming scheme). This allows for better tree shaking of unused constructor code (see PRs [#3515](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3515):

- `Trie.create()` -> `createMPT()`

#### Proof Functionality

Proof functionality also has been extracted from the trie class to make the core code base smaller, see PR [#3551](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3551), also the names have been made more expressive to better distinguish between Merkle/Verkle, see PRs [#3557](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3557), [#3718](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3718) and [#3730](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3730):

- `Trie.createFromProof()` -> `createMPTFromProof()`
- `Trie.verifyProof()` -> `verifyMerkleProof()`
- `Trie.verifyRangeProof()` -> `verifyMerkleRangeProof()`
- `Trie.createProof()` -> `createMerkleProof()`
- `Trie.updateFromProof()` -> `updateMPTFromMerkleProof()`

### Replaced Stream Functionality

One of the largest burdens for the trie library - dependency wise - was the `readable-stream` dependency, used for implementing a read stream for full trie dumps in a platform independent way. This dependency has a lot of downstream dependencies and posed therefore a strong and unnecessary security risk for our upstream stack.

We have now removed the stream functionality and the associated dependency and replaced with a simpler async value map retrieval by using `trie.getValueMap()`, see PR [#3519](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3519). For an example see the MPT [examples](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/mpt/examples) folder.

### Other Breaking Changes

- Refactor trie util helpers, PR [#3534](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3534)
- Improve node typings and class architecture, PR [#3708](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3708)
- Rename trie helpers to mpt, PR [#3718](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3718)

### Other Changes

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)
- Address type issues and type-related improvements, PR [#3624](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3624)
- Debug logger namespace standardization (use with `#` for the core logger, so e.g. `mpt:#`), PR [#3692](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3692)

## 6.2.1 - 2024-08-15

### Other Features

- Stricter prefixed hex typing, PRs [#3348](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3348), [#3427](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3427) and [#3357](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3357) (some changes removed in PR [#3382](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3382) for backwards compatibility reasons, will be reintroduced along upcoming breaking releases)

### Bugfixes

- Fixes an issue in the delete operation used for unhashed tries and pruning activated which resulted in a wrong state root (bad!), PR [#3333](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3333)

## 6.2.0 - 2024-03-18

In the hope that you do not have yet integrated: we needed to remove the new more modern async trie iteration with web streams functionality (new `createAsyncReadStream()` method) introduced with the `v6.1.0` release - see PR [#3231](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3231) for context - since the related Node.js web streams API import caused relatively severe problems for all upstream libraries when being used in the browser.

So functionality has been removed in PR [#3280](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3280). We hope we find a good way to re-introduce along with the next breaking release round without limiting browser functionality.

### Other Changes

- Add optional `partialPath` parameter to `trie.findPath()`, PR [#3305](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3305)
- Add export for `Path` interface for better TypeScript integration when using the `findPath()` method, PR [#3292](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3292)
- Improved zero-element proof behavior in `verifyProof()` method, PR [#3047](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3047)
- Fix a type error related to the `lru-cache` dependency, PR [#3285](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3285)

## 6.1.1 - 2024-02-08

- Hotfix release adding a missing `debug` dependency, PR [#3271](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3271)

## 6.1.0 - 2024-02-08

### Extended EIP-1186 Proof Functionality

This release complements on [EIP-1186](https://eips.ethereum.org/EIPS/eip-1186) proof functionality, see PR [#2949](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2949) and [#3267](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3267).

A new static `Trie.createFromProof()` constructor now allows for an easier instantiation of a trie given an EIP-1186 conformant proof, which can be created from an existing trie using the `trie.createProof()` method.

There are also new static methods for the verification of proofs, namely `Trie.verifyProof()` to verify a proof for a single key as well as `Trie.verifyRangeProof()` for a range of keys.

Additionally all proof related functionality is now better documented and there are README examples allowing for an easier entry to the topic.

Also note that along with this release round there is additional higher level proof functionality available shipped within the `@ethereumjs/statemanager` package.

### WASM Crypto Support

With this release round there is a new way to replace the native JS crypto primitives used within the EthereumJS ecosystem by custom/other implementations in a controlled fashion, see PR [#3192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3192).

This can e.g. be used to replace time-consuming primitives like the commonly used `keccak256` hash function with a more performant WASM based implementation, see `@ethereumjs/common` [README](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/common) for some detailed guidance on how to use.

### Self-Contained (and Working 🙂) README Examples

All code examples in the `EthereumJS` monorepo library README files are now self-contained and can be executed "out of the box" by simply copying them over and running "as is", see tracking issue [#3234](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3234) for an overview. Additionally all examples can now be found in their respective library [examples](./examples/) folder (in fact the README examples are now auto-embedded from over there). As a nice side effect, all examples are now run in CI on new PRs and so do not risk getting outdated or broken over time.

### Other Changes

- More modern async trie iteration with web streams (see new `createAsyncReadStream()` method), PR [#3231](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3231)
- Dependency Updates, PR [#3212](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3212)

## 6.0.1 - 2023-10-26

### Native Support for Uint8Array Values in DBs

The trie library now allows to store values being passed as native `Uint8Array` values instead of strings, see PR [#3067](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3067).

This leads to a significant performance increase when dealing with larger state DBs and it is recommended to activate for new DBs by using the new `valueEncoding` option.

**Attention!**: Switching value encoding by using this new option is not compatible with existing databases.

### Debug Logging

The trie library now allows for using debug logging with the `DEBUG=ethjs,trie:*` flag on the command line as already being implemented in other EthereumJS libraries, see PR [#3019](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3019).

See [Debugging](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/trie#debugging) README section for usage instructions. This comes in pretty handy if in-depth trie analysis with step-by-step following of path reads is needed.

### Bugfixes

- Fix empty-root check, PR [#3001](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3001)

### Other Changes

- New parameter `skipKeyTransform` (default: `false`) for Trie `put()`, `del()` and `batch()` method to allow to pass in already hashed keys, PR [#2950](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2950)
- New `keyPrefix` option tries to store node keys with a static prefix (used upstream in the `statemanager` package to speed to storage trie reads), PR [#3023](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3023)
- Performance: `findPath()` optimizations, PR [#3066](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3066)
- Make `null` available as type option for `put()` method value, PR [#3020](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3020)
- Allow partial trie options for `shallowCopy()` (e.g. for a more flexible cache configuration for the trie copy), PR [#3063](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3063)
- Use `lock` class from `@ethereumjs/util`, PR [#3109](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3109)
- Improve util types and handling, PR [#2951](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2951)

## 6.0.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Ftrie%406.0.0-rc.1) for the main change description.

Following additional changes since RC1:

## New API for walking a (sparse) Trie

Starting with this release there is a new API for walking and iterating a trie by using an async walk generator, which now enables to walk tries without altering the walk controller and also now enables to walk a sparse (not completely filled) trie, see PR [#2904](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2904).

The new walk functionality can be used like the following:

```ts
import { Trie } from '@ethereumjs/trie'

const trie = await Trie.create()
const walk = trie.walkTrieIterable(trie.root())

for await (const { node, currentKey } of walk) {
  // ... do something i.e. console.log( { node, currentKey } )
}
```

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

### New Trie Node Cache

There is a new permanent trie node cache which can be leveraged to make Trie operations significantly faster, see PR [#2667](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2667). Since this also increases base-memory usage of a trie instantiation, this new cache is mainly intended to be used in rather long-lived trie scenarios.

The new cache can be activated by setting a fitting cache size with the new `cacheSize` option (default: `0` (deactivated)).

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
Trie.create() / new MerklePatriciaTrie() // root constructor option
Trie.root(value?: Uint8Array | null): Uint8Array
Trie.checkRoot(root: Uint8Array): Promise<boolean>
Trie.get(key: Uint8Array, throwIfMissing = false): Promise<Uint8Array | null>
Trie.put(key: Uint8Array, value: Uint8Array): Promise<void>
Trie.del(key: Uint8Array): Promise<void>
Trie.findPath(key: Uint8Array, throwIfMissing = false): Promise<Path>
Trie.walkTrie(root: Uint8Array, onFound: FoundNodeFunction): Promise<void>
Trie.lookupNode(node: Uint8Array | Uint8Array[]): Promise<TrieNode | null>
Trie.createProof(key: Uint8Array): Promise<Proof>
Trie.verifyProof()
Trie.createReadStream()
Trie.hash(msg: Uint8Array): Uint8Array
```

So basically the whole API. Lol. 😋

We have converted existing Buffer conversion methods to Uint8Array conversion methods in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

#### Prefixed Hex Strings as Default

The mixed usage of prefixed and unprefixed hex strings is a constant source of errors in byte-handling code bases.

We have therefore decided to go "prefixed" by default, see PR [#2830](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2830) and [#2845](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2845).

The `hexToBytes` and `bytesToHex` methods, also similar methods like `intToHex`, now take `0x`-prefixed hex strings as input and output prefixed strings. The corresponding unprefixed methods are marked as `deprecated` and usage should be avoided.

Please therefore check you code base on updating and ensure that values you are passing to constructors and methods are prefixed with a `0x`.

### Other Changes

- Support for `Node.js 16` has been removed (minimal version: `Node.js 18`), PR [#2859](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2859)
- Breaking: `DB` interface and `MapDB` implementation have been moved to [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/util/src/db.ts) (for re-usage), PR [#2669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2669)
- Breaking: The `copy()` method has been renamed to `shallowCopy()` (same underlying state DB), PR [#2826](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2826)

## 5.0.5 - 2023-04-20

- Update ethereum-cryptography from 1.2 to 2.0 (switch from noble-secp256k1 to noble-curves), PR [#2641](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2641)
- Bump `@ethereumjs/util` `@chainsafe/ssz` dependency to 0.11.1 (no WASM, native SHA-256 implementation, ES2019 compatible, explicit imports), PRs [#2622](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2622), [#2564](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2564) and [#2656](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2656)

## 5.0.4 - 2023-02-27

- Pinned `@ethereumjs/util` `@chainsafe/ssz` dependency to `v0.9.4` due to ES2021 features used in `v0.10.+` causing compatibility issues, PR [#2555](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2555)

## 5.0.3 - 2023-02-21

**DEPRECATED**: Release is deprecated due to broken dependencies, please update to the subsequent bugfix release version.

Maintenance release with dependency updates, PR [#2521](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2521)

## 5.0.2 - 2022-12-09

Maintenance release with dependency updates, PR [#2445](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2445)

## 5.0.1 - 2022-10-18

- Fixed a dependency issue when using `TrieReadStream`, PR [#2318](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2318)
- Fixed a pruning verification issue for a case where only the root key is present as a key but not the root value, PR [#2296](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2296)

## 5.0.0 - 2022-09-06

Final release - tada 🎉 - of a wider breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2, Beta 3 and Release Candidate (RC) 1 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/trie/CHANGELOG.md)).

### Trie Pruning

Some great last minute feature (thanks @faustbrian and @jochem-brouwer on this!) allowing to prune a trie on state root updates with a new `useNodePruning` option (default: `false`), see PR [#2203](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2203). This allows for a much smaller DB footprint for the trie for use cases with frequent state root updates.

### Other Changes

- New `setCheckpoints(checkpoints: Checkpoint[])` method to support the manual setting of checkpoints for advanced use cases, PR [#2240](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2240)
- Internal refactor: removed ambiguous boolean checks within conditional clauses, PR [#2249](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2249)

## 5.0.0-rc.1 - 2022-08-29

Release candidate 1 for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 and 3 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/trie/CHANGELOG.md)).

From Beta 3 to RC 1 the `Trie` library has seen the most vast set of changes, thanks again to @faustbrian for this various meaningful refactoring contributions! ❤️

There are various substantial structural changes and reworkings which will make working with the Trie library more flexible and robust. Note that these changes will need some attention though on an upgrade depending on your existing usage of the Trie library.

### Single Trie Class

There is now one single `Trie` class which contains and exposes the functionality previously split into the three separate classes `Trie` -> `CheckpointTrie` and `SecureTrie`, see PRs [#2214](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2214) and [#2215](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2215). Class inheritance has been removed and the existing functionality has been integrated into one class. This should make it easier to extend the Trie class or customize its behavior without having to "dock" into the previous complicated inheritance structure.

#### Default Checkpointing Behavior

The `CheckpointTrie` class has been removed in favor of integrating the functionality into the main `Trie` class and make it a default behaviour. Every Trie instance now comes complete with checkpointing behaviour out of the box, without giving any additional weight or performance penalty if the functionality remains unused.

#### Secure Trie with an Option

The `SecureTrie` class has been removed as well. Instead there is a new constructor option `useKeyHashing` - defaulting to `false`. This effectively reduces the level of inheritance dependencies (for example, in the old structure, you could not create a secure trie without the checkpoint functionality which, in terms of logic, do not correlate in any way). This also provides more room to accommodate future design modifications and/or additions if required.

Updating is a straightforward process:

```ts
// Old
const trie = new SecureTrie()

// New
const trie = new MerklePatriciaTrie({ useKeyHashing: true })
```

### Removed Getter and Setter Functions

Due to the ambiguity of the `get` and `set` functions (also known as getters and setters), usage has been removed from the library. This is because their ambiguity can create the impression of interacting with a property on a trie instance.

#### Trie `root` Getter/Setter

For this reason, a single `root(hash?: Buffer): Buffer` function serves as a replacement for the previous `root` getter and setter and can effectively work to get and set properties, see PR [#2219](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2219). This makes it obvious that you intend to modify an internal property of the trie that is neither accessible or mutable via any other means other than this particular function.

##### Getter Example

```tsx
// Old
const trie = new MerklePatriciaTrie()
trie.root

// New
const trie = new MerklePatriciaTrie()
trie.root()
```

##### Setter Example

```tsx
// Old
const trie = new MerklePatriciaTrie()
trie.root = Buffer.alloc(32)

// New
const trie = new MerklePatriciaTrie()
trie.root(Buffer.alloc(32))
```

#### Trie `isCheckpoint` Getter

The `isCheckpoint` getter function has been removed, see PR [#2218](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2218) The `hasCheckpoints()` function serves as its replacement and offers the same behaviour.

```tsx
// Old
const trie = new MerklePatriciaTrie()
trie.isCheckpoint

// New
const trie = new MerklePatriciaTrie()
trie.hasCheckpoints()
```

### Database Abstraction

Another significant change is that we dropped support for `LevelDB` out of the box. As a result, you will need to have your own implementation available.

#### Motivation

The primary reason for this change is increase the flexibility of this package by allowing developers to select any type of storage for their unique purposes. In addition, this change renders the project far less susceptible to [supply chain attacks](https://en.wikipedia.org/wiki/Supply_chain_attack). We trust that users and developers can appreciate the value of reducing this attack surface in exchange for a little more time spent on their part for the duration of this upgrade.

#### LevelDB Removal

Prior to v5, this package shipped with a LevelDB integration out of the box. Finalized within this RC release round we have introduced a database abstraction and therefore no longer ship with the aforementioned LevelDB implementation, see previous Beta CHANGELOGs as well as PR [#2167](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2167). However, for your convenience, we provide all of the necessary steps so that you can integrate it accordingly.

See our [Upgrade Guide](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/trie/UPGRADING.md) for more instructions on how to use the `Trie` library with LevelDB now.

### Other Changes

- Store `opts` in private property with defaults, PR [#2224](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2224)
- **Potentially breaking:** Mark `db` as protected and rename to `_db` to avoid leaky properties, PR [#2221](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2221)
- Replace `get/set` for `key/value` for nodes with function, PR [#2220](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2220)
- Rename `persistRoot` to `useRootPersistence`, PR [#2223](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2223)

### Maintenance Updates

- Added `engine` field to `package.json` limiting Node versions to v14 or higher, PR [#2164](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2164)
- Replaced `nyc` (code coverage) configurations with `c8` configurations, PR [#2192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2192)
- Code formats improvements by adding various new linting rules, see Issue [#1935](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1935)
- Use `micro-bmark` for benchmarks, PR [#2128](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2128)
- Move `Trie#_findValueNodes()` function to `TrieReadStream`, PR [#2186](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2186)
- Replaced `semaphore-async-await` with simpler implementation, PR [#2187](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2187)
- Renamed `Semaphore` to `Lock`, PR [#2234](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2234)

## 5.0.0-beta.3 - 2022-08-10

Beta 3 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/devp2p/CHANGELOG.md)).

### Root Hash Persistence

The trie library now comes with a new constructor option `useRootPersistence` (note that the option has been called `persistRoot` up to Beta 3) which is disabled by default but allows to persist state root updates along write operations directly in the DB and therefore omits the need to manually set to a new state root, see PR [#2071](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2071) and PR [#2123](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2123), thanks to @faustbrian for the contribution! ❤️

To activate root hash persistence you can set the `useRootPersistence` option on instantiation:

```ts
import { Trie, LevelDB } from '@ethereumjs/trie'
import { Level } from 'level'

const trie = new MerklePatriciaTrie({
  db: new LevelDB(new Level('MY_TRIE_DB_LOCATION')),
  useRootPersistence: true,
})
```

### Other Changes

- Fix: Pass down a custom hash function for hashing on trie copies, PR [#2068](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2068)

# 5.0.0-beta.2 - 2022-07-15

Beta 2 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/trie/CHANGELOG.md)) for the main change set description.

### Removed Default Exports

The change with the biggest effect on UX since the last Beta 1 releases is for sure that we have removed default exports all across the monorepo, see PR [#2018](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2018), we even now added a new linting rule that completely disallows using.

Default exports were a common source of error and confusion when using our libraries in a CommonJS context, leading to issues like Issue [#978](https://github.com/ethereumjs/ethereumjs-monorepo/issues/978).

Now every import is a named import and we think the long term benefits will very much outweigh the one-time hassle of some import adoptions.

So if you use the Trie library together with other EthereumJS libraries check if the respective imports need an update.

## Custom Hash Function

There is a new constructor option `hash` which allows to customize the hash function used for secure trie key hashing - see PR [#2043](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2043) - thanks to @libotony for the great contribution on this! ❤️

This allows to swap out the applied `keccak256` hash functionality from the [@noble/hashes](https://github.com/paulmillr/noble-hashes) library and e.g. use a faster native implementation or an alternative hash function (the PR contribution e.g. was done with the goal to switch to `blake2b256` hashing).

**Breaking:** Note that this change made it necessary to switch the current proof functionality methods from static to object-bound member functions.

So the usage of the following methods change and need to be updated (for all types of tries):

- `Trie.createProof(trie, myKey)` -> `trie.createProof(myKey)`
- `Trie.verifyProof(trie.root(), myKey, proof)` -> `trie.verifyProof(trie.root(), myKey, proof)`
- `Trie.verifyRangeProof(...)` -> `trie.verifyRangeProof(...)`

## Other Changes

- Added `ESLint` strict boolean expressions linting rule, PR [#2030](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2030)

# 5.0.0-beta.1 - 2022-06-30

This release is part of a larger breaking release round where all [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries (VM, Tx, Trie, other) get major version upgrades. This round of releases has been prepared for a long time and we are really pleased with and proud of the result, thanks to all team members and contributors who worked so hard and made this possible! 🙂 ❤️

We have gotten rid of a lot of technical debt and inconsistencies and removed unused functionality, renamed methods, improved on the API and on TypeScript typing, to name a few of the more local type of refactoring changes. There are also broader structural changes like a full transition to native JavaScript `BigInt` values as well as various somewhat deep-reaching refactorings, both within a single package as well as some reaching beyond the scope of a single package. Also two completely new packages - `@ethereumjs/evm` (in addition to the existing `@ethereumjs/vm` package) and `@ethereumjs/statemanager` - have been created, leading to a more modular Ethereum JavaScript VM.

We are very much confident that users of the libraries will greatly benefit from the changes being introduced. However - along the upgrade process - these releases require some extra attention and care since the changeset is both so big and deep reaching. We highly recommend to closely read the release notes, we have done our best to create a full picture on the changes with some special emphasis on delicate code and API parts and give some explicit guidance on how to upgrade and where problems might arise!

So, enjoy the releases (this is a first round of Beta releases, with final releases following a couple of weeks after if things go well)! 🎉

The EthereumJS Team

### New Package Name

**Attention!** This library release aligns (and therefore: changes!) the library name with the other EthereumJS libraries and switches to the new scoped package name format, see PR [#1953](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1953). In this case the library is renamed as follows:

- `merkle-patricia-tree` -> `@ethereumjs/trie`

Please update your library references accordingly and install with:

```shell
npm i @ethereumjs/trie
```

### BigInt Introduction / ES2020 Build Target

With this round of breaking releases the whole EthereumJS library stack removes the [BN.js](https://github.com/indutny/bn.js/) library and switches to use native JavaScript [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) values for large-number operations and interactions.

This makes the libraries more secure and robust (no more BN.js v4 vs v5 incompatibilities) and generally comes with substantial performance gains for the large-number-arithmetic-intense parts of the libraries (particularly the VM).

While the Trie library currently has no specific BigInt usage we have generally updated our build target to [ES2020](https://262.ecma-international.org/11.0/) to allow for BigInt support now or for future functionality additions. We feel that some still remaining browser compatibility issues on the edges (old Safari versions e.g.) are justified by the substantial gains this step brings along.

See [#1671](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1671) and [#1771](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1771) for the core `BigInt` transition PRs.

### Disabled esModuleInterop and allowSyntheticDefaultImports TypeScript Compiler Options

The above TypeScript options provide some semantic sugar like allowing to write an import like `import React from "react"` instead of `import * as React from "react"`, see [esModuleInterop](https://www.typescriptlang.org/tsconfig#esModuleInterop) and [allowSyntheticDefaultImports](https://www.typescriptlang.org/tsconfig#allowSyntheticDefaultImports) docs for some details.

While this is convenient it deviates from the ESM specification and forces downstream users into these options which might not be desirable, see [this TypeScript Semver docs section](https://www.semver-ts.org/#module-interop) for some more detailed argumentation.

Along the breaking releases we have therefore deactivated both of these options and you might therefore need to adopt some import statements accordingly. Note that you still have got the possibility to activate these options in your bundle and/or transpilation pipeline (but now you also have the option to _not_ do which you didn't have before).

### Database Changes

#### Generic DB Interface

In the last round of breaking release preparation @faustbrian came around the corner and came up with some really great DB-related additions to the Trie library, thanks so much for these super valuable contributions! ❤️ ❤️ ❤️

Trie usage has now been decoupled from the tight integration with `LevelDB` and it is now possible to replace the datastore with an own implementation respectively a DB wrapper to an alternative key-value-store solution.

For this there is now a generic `DB` interface defining five methods `get`, `put`, `del`, `batch` and `copy` which a specific `DB` wrapper needs to implement. For `LevelDB` a wrapper with the same name is included and can be directly used.

The base trie implementation (`Trie`) as well as all subclass implementations (`CheckpointTrie` and `SecureTrie`) have been reworked to now accept any `DB` interface-compatible wrapper implementations as a datastore `db` option input. This allows to easily switch on the underlying backend.

The new `DB` interface can be used like this for LevelDB:

```ts
import { Trie, LevelDB } from '@ethereumjs/trie'
import { Level } from 'level'

const trie = new MerklePatriciaTrie({ db: new LevelDB(new Level('MY_TRIE_DB_LOCATION')) })
```

If no `db` option is provided an in-memory [memory-level](https://github.com/Level/memory-level) data storage will be instantiated and used. (Side note: some internal non-persistent trie operations (e.g. proof trie creation for range proofs) will always use the internal `level` based data storage, so there will be some continued `level` DB usage also when you switch to an alternative data store for permanent trie storage).

#### Level DB Upgrade / Browser Compatibility

Along with the DB interface extraction the internal Level DB code has been reworked to now be based and work with the latest Level [v8.0.0](https://github.com/Level/level/releases/tag/v8.0.0) major Level DB release. This allows to use ES6-style `import` syntax to import the `Level` instance and allows for better typing when working with Level DB.

Because of the upgrade, any `level` implementation compliant with the `abstract-level` interface can be use, including `classic-level`, `browser-level` and `memory-level`. This now makes it a lot easier to use the package in browsers without polyfills for `level`. For some context it is worth to mention that the `level` package itself is starting with the v8 release just a proxy for these other packages and has no functionality itself.

### API Changes

Options for the Trie constructor are now also taken in as an options dict like in the other EthereumJS libraries. This makes it easier to add additional options in the future, see PR [#1874](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1874).

Check your Trie instantiations and see if you use constructor options. In this case you need to update to the new format:

- `constructor(db?: LevelUp | null, root?: Buffer, deleteFromDB: boolean = false)` -> `constructor(opts: TrieOpts = {})`

The following deprecated or semi-private methods have been removed, see PR [#1874](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1874) and PR [#1834](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1834).

- `setRoot()` (use `Trie.root` instead)
- Semi-private `_walkTrie()` and `_lookupNode()` methods (should not but might have been used directly)

### New File Layout

The trie source files have been reorganized to provide a more consistent and clean file and folder layout, see PR [#1972](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1972). This might or might not affect you, depending if you use direct file references for importing (if you do you might want to generally switch to use root-level exports from the main `index.ts` file).

All types and Trie options are now bundled in a dedicated `types.ts` file and there are dedicated folders for the different Trie implementations (`trie/`), DB interfaces and classes (`db/`) and proof-related functionality (`proof/`). Additionally some utility functionality has been moved to the `util/` folder.

# 4.2.4 - 2022-03-15

- New `Trie.verifyRangeProof()` function to check whether the given leaf nodes and edge proof can prove the given trie leaves range is matched with the specific root (useful for snapsync, thanks to @samlior for this generous code contribution ❤️), PR [#1731](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1731)

# 4.2.3 - 2022-02-01

- Dependencies: deduplicated RLP import, PR [#1549](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1549)

# 4.2.2 - 2021-10-06

**Bug Fixes**

- Adds try-catch for "Missing node in DB" in ReadStream, PR [#1515](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1515)

## 4.2.1 - 2021-08-17

**Bug Fixes**

- Better error checking for invalid proofs with a differentiation on proofs of non-existence (`Trie.verifyProof()` returns `null`) and invalid proofs where `Trie.verifyProof()` will throw, see [README section](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/trie#merkle-proofs) for further details, PR [#1373](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1373)

**Maintenance**

- Remove use of deprecated setRoot, PR [#1376](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1376)

### Included Source Files

Source files from the `src` folder are now included in the distribution build, see PR [#1301](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1301). This allows for a better debugging experience in debug tools like Chrome DevTools by having working source map references to the original sources available for inspection.

## 4.2.0 - 2021-05-20

### Changed Delete Behavior: NO Default Node Deletes

This release changes the behavior on trie node deletes after doing a `commit()` on a checkpoint trie (`CheckpointTrie`). This was the scenario where trie nodes were deleted from the database in older versions of the library. After a long discussion we decided to switch to a more conservative approach and keep the trie nodes in the DB in all scenarios. This now allows for setting back the state root to an older root (e.g. with the `StateManager` included in the `VM`) and still be sure to operate on a consistent and complete trie. This had been reported as a problem in some usage scenarios by third-party users of the library.

So the default behavior on the trie is now: there are no node deletions happening in all type of setups and usage scenarios, so for a `BaseTrie`, `CheckpointTrie` or `SecureTrie` and working checkpointed or non-checkpointed.

While this change is not directly breaking, it might nevertheless have side effects depending on your usage scenario. If you use a somewhat larger trie and do a lot of change operations, this will significantly increase the disk space used. We have nevertheless decided to make this a non-breaking release since we don't expect this to be the usual way the trie library is used. Instead the former behavior appeared more as some sort of "bug" when reported by developers integrating the library.

If you want to switch back to a trie where nodes are deleted (so for non-checkpointed tries directly along a trie operation or for checkpointed tries along a `commit()`) there is a new parameter `deleteFromDB` introduced which can be used to switch to a delete behavior on instantiation (the default is `false` here).

See: PR [#1219](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1219)

## 4.1.0 - 2021-02-16

This release comes with a reworked checkpointing mechanism (PR [#1030](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1030) and subsequently PR [#1035](https://github.com/ethereumjs/ethereumjs-monorepo/pull/1035)). Instead of copying over the whole DB on checkpoints the operations in between checkpoints are now recorded in memory and either applied in batch on a `Trie.checkpoint()` call or discarded along a `Trie.revert()`. This more fine-grained operational mode leads to a substantial performance gain (up to 50x) when working with larger tries.

Another performance related bug has been fixed along PR [#127](https://github.com/ethereumjs/merkle-patricia-tree/pull/127) removing an unnecessary double-serialization call on nodes. This gives a general performance gain of 10-20% on putting new values in a trie.

Other changes:

## New Features

A new exported `WalkController` class has been added and `trie.walkTrie()` has been made a public method along. This allows for creating own custom ways to traverse a trie. PR [#135](https://github.com/ethereumjs/merkle-patricia-tree/pull/135)

### Refactoring, Development and Documentation

- Better `Trie` code documentation, PR [#125](https://github.com/ethereumjs/merkle-patricia-tree/pull/125)
- Internal `Trie` function reordering & partial retwrite, PR [#125](https://github.com/ethereumjs/merkle-patricia-tree/pull/125)
- Added simple integrated profiling, PR [#128](https://github.com/ethereumjs/merkle-patricia-tree/pull/128)
- Reworked benchmarking to be based on `benchmark.js`, basic CI integration, PR [#130](https://github.com/ethereumjs/merkle-patricia-tree/pull/130)
- Upgrade to `ethereumjs-config` `2.0` libs for linting and formatting, PR [#133](https://github.com/ethereumjs/merkle-patricia-tree/pull/133)
- Switched coverage from `coverall` to `codecov`, PR [#137](https://github.com/ethereumjs/merkle-patricia-tree/pull/137)

## [4.0.0] - 2020-04-17

This release introduces a major API upgrade from callbacks to Promises.

Example using async/await syntax:

```ts
import { BaseTrie as Trie } from 'merkle-patricia-tree'
const trie = new MerklePatriciaTrie()
async function test() {
  await trie.put(Buffer.from('test'), Buffer.from('one'))
  const value = await trie.get(Buffer.from('test'))
  console.log(value.toString()) // 'one'
}
test()
```

### Breaking Changes

#### Trie methods

See the [docs](https://github.com/ethereumjs/merkle-patricia-tree/tree/master/docs) for the latest Promise-based method signatures.

#### Trie.prove renamed to Trie.createProof

To clarify the method's purpose `Trie.prove` has been renamed to `Trie.createProof`. `Trie.prove` has been deprecated but will remain as an alias for `Trie.createProof` until removed.

#### Trie raw methods

`getRaw`, `putRaw` and `delRaw` were deprecated in `v3.0.0` and have been removed from this release. Instead, please use `trie.db.get`, `trie.db.put`, and `trie.db.del`. If using a `SecureTrie` or `CheckpointTrie`, use `trie._maindb` to override the checkpointing mechanism and interact directly with the db.

#### SecureTrie.copy

`SecureTrie.copy` now includes checkpoint metadata by default. To maintain original behavior of _not_ copying checkpoint state, pass `false` to param `includeCheckpoints`.

### Changed

- Convert trieNode to ES6 class ([#71](https://github.com/ethereumjs/merkle-patricia-tree/pull/71))
- Merge checkpoint and secure interface with their ES6 classes ([#73](https://github.com/ethereumjs/merkle-patricia-tree/pull/73))
- Extract db-related methods from baseTrie ([#74](https://github.com/ethereumjs/merkle-patricia-tree/pull/74))
- \_lookupNode callback to use standard error, response pattern ([#83](https://github.com/ethereumjs/merkle-patricia-tree/pull/83))
- Accept leveldb in constructor, minor fixes ([#92](https://github.com/ethereumjs/merkle-patricia-tree/pull/92))
- Refactor TrieNode, add levelup types ([#98](https://github.com/ethereumjs/merkle-patricia-tree/pull/98))
- Promisify rest of library ([#107](https://github.com/ethereumjs/merkle-patricia-tree/pull/107))
- Use `Nibbles` type for `number[]` ([#115](https://github.com/ethereumjs/merkle-patricia-tree/pull/115))
- Upgrade ethereumjs-util to 7.0.0 / Upgrade level-mem to 5.0.1 ([#116](https://github.com/ethereumjs/merkle-patricia-tree/pull/116))
- Create dual ES5 and ES2017 builds ([#117](https://github.com/ethereumjs/merkle-patricia-tree/pull/117))
- Include checkpoints by default in SecureTrie.copy ([#119](https://github.com/ethereumjs/merkle-patricia-tree/pull/119))
- Rename Trie.prove to Trie.createProof ([#122](https://github.com/ethereumjs/merkle-patricia-tree/pull/122))

### Added

- Support for proofs of null/absence. Dried up prove/verify. ([#82](https://github.com/ethereumjs/merkle-patricia-tree/pull/82))
- Add more Ethereum state DB focused example accessing account values ([#89](https://github.com/ethereumjs/merkle-patricia-tree/pull/89))

### Fixed

- Drop ethereumjs-testing dep and fix bug in branch value update ([#69](https://github.com/ethereumjs/merkle-patricia-tree/pull/69))
- Fix prove and verifyProof in SecureTrie ([#79](https://github.com/ethereumjs/merkle-patricia-tree/pull/79))
- Fixed src code links in docs ([#93](https://github.com/ethereumjs/merkle-patricia-tree/pull/93))

### Dev / Testing / CI

- Update tape to v4.10.1 ([#81](https://github.com/ethereumjs/merkle-patricia-tree/pull/81))
- Org links and git hooks ([#87](https://github.com/ethereumjs/merkle-patricia-tree/pull/87))
- Use module.exports syntax in util files ([#90](https://github.com/ethereumjs/merkle-patricia-tree/pull/90))
- Rename deprecated sha3 consts and func to keccak256 ([#91](https://github.com/ethereumjs/merkle-patricia-tree/pull/91))
- Migrate to Typescript ([#96](https://github.com/ethereumjs/merkle-patricia-tree/pull/96))
- Fix Travis's xvfb service ([#97](https://github.com/ethereumjs/merkle-patricia-tree/pull/97))
- Fix test cases and docs ([#104](https://github.com/ethereumjs/merkle-patricia-tree/pull/104))
- Upgrade CI Provider from Travis to GH Actions ([#105](https://github.com/ethereumjs/merkle-patricia-tree/pull/105))
- Upgrade test suite to TS ([#106](https://github.com/ethereumjs/merkle-patricia-tree/pull/106))
- Better document `_formatNode` ([#109](https://github.com/ethereumjs/merkle-patricia-tree/pull/109))
- Move `failingRefactorTests` to `secure.spec.ts` ([#110](https://github.com/ethereumjs/merkle-patricia-tree/pull/110))
- Fix test suite typos ([#114](https://github.com/ethereumjs/merkle-patricia-tree/pull/110))

[4.0.0]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v3.0.0...v4.0.0

## [3.0.0] - 2019-01-03

This release comes along with some major version bump of the underlying `level`
database storage backend. If you have the library deeper integrated in one of
your projects make sure that the new DB version plays well with the rest of the
code.

The release also introduces modern `ES6` JavaScript for the library (thanks @alextsg)
switching to `ES6` classes and clean inheritance on all the modules.

- Replace `levelup` 1.2.1 + `memdown` 1.0.0 with `level-mem` 3.0.1 and upgrade `level-ws` to 1.0.0, PR [#56](https://github.com/ethereumjs/merkle-patricia-tree/pull/56)
- Support for `ES6` classes, PRs [#57](https://github.com/ethereumjs/merkle-patricia-tree/pull/57), [#61](https://github.com/ethereumjs/merkle-patricia-tree/pull/61)
- Updated `async` and `readable-stream` dependencies (resulting in smaller browser builds), PR [#60](https://github.com/ethereumjs/merkle-patricia-tree/pull/60)
- Updated, automated and cleaned up [API documentation](https://github.com/ethereumjs/merkle-patricia-tree/blob/master/docs/index.md) build, PR [#63](https://github.com/ethereumjs/merkle-patricia-tree/pull/63)

[3.0.0]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v2.3.2...v3.0.0

## [2.3.2] - 2018-09-24

- Fixed a bug in verify proof if the tree contains an extension node with an embedded branch node, PR [#51](https://github.com/ethereumjs/merkle-patricia-tree/pull/51)
- Fixed `_scratch` 'leak' to global/window, PR [#42](https://github.com/ethereumjs/merkle-patricia-tree/pull/42)
- Fixed coverage report leaving certain tests, PR [#53](https://github.com/ethereumjs/merkle-patricia-tree/pull/53)

[2.3.2]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v2.3.1...v2.3.2

## [2.3.1] - 2018-03-14

- Fix OutOfMemory bug when trying to create a read stream on large trie structures
  (e.g. a current state DB from a Geth node), PR [#38](https://github.com/ethereumjs/merkle-patricia-tree/pull/38)
- Fix race condition due to mutated `_getDBs`/`_putDBs`, PR [#28](https://github.com/ethereumjs/merkle-patricia-tree/pull/28)

[2.3.1]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v2.3.0...v2.3.1

## [2.3.0] - 2017-11-30

- Methods for merkle proof generation `Trie.prove()` and verification `Trie.verifyProof()` (see [./proof.js](./proof.js))

[2.3.0]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v2.2.0...v2.3.0

## [2.2.0] - 2017-08-03

- Renamed `root` functions argument to `nodeRef` for passing a node reference
- Make `findPath()` (path to node for given key) a public method

[2.2.0]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v2.1.2...v2.2.0

## [2.1.2] - 2016-03-01

- Added benchmark (see [./benchmarks/](./benchmarks/))
- Updated dependencies

[2.1.2]: https://github.com/ethereumjs/merkle-patricia-tree/compare/v2.1.1...v2.1.2

## [2.1.1] - 2016-01-06

- Added README, API documentation
- Dependency updates

[2.1.1]: https://github.com/ethereumjs/merkle-patricia-tree/compare/2.0.3...v2.1.1

## [2.0.3] - 2015-09-24

- Initial, first of the currently released version on npm

[2.0.3]: https://github.com/ethereumjs/merkle-patricia-tree/compare/1.1.x...2.0.3
