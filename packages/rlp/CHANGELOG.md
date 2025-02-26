# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 6.0.0-alpha.1 - 2024-10-17

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)
- Use `noble` bytes conversion utilities internally, PR [#3698](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3698)

## 5.0.2 - 2024-02-08

### 10-30x Decode Speedup

The `RLP.decode()` method has been optimized (thanks @wemeetagain for the contribution! ❤️) which results in a reproducible 10-30x speedup for JS native decoding 🎉, see PR [#3243](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3243).

### Self-Contained (and Working 🙂) README Examples

All code examples in `EthereumJS` monorepo library README files are now self-contained and can be executed "out of the box" by simply copying them over and running "as is", see tracking issue [#3234](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3234) for an overview. Additionally all examples can now be found in the respective library [examples](./examples/) folder (in fact the README examples are now auto-embedded from over there). As a nice side effect all examples are now run in CI on new PRs and so do not risk to get outdated or broken over time.

## 5.0.1 - 2023-10-26

- Fixes the RLP CLI, PR [#3007](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3007)

## 5.0.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Frlp%405.0.0-rc.1) for the main change description.

## 5.0.0-rc.1 - 2023-07-18

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

The `@ethereumjs/rlp` library is the only EthereumJS library where the Buffer -> Uint8Array transition has already taken place in the major release version before, so `v4.0.0`.

If you upgrade from a version below you can nevertheless now benefit from a more seamless integration of this library with the other libraries since Uint8Array is now the standard data type for byte values throughout the whole set of libraries.

We now have also added helper methods for "Buffer -> Uint8Array" conversions in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

## 4.0.1 - 2023-02-21

- Avoid copy in `RLP.encode()`, PR [#2476](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2476)

## 4.0.0 - 2022-09-06

Final release - tada 🎉 - of a wider breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2, Beta 3 and Release Candidate (RC) 1 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md)).

This release contains no additional changes compared to the RC 1 release.

## 4.0.0-rc.1 - 2022-08-29

Release candidate 1 for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 and 3 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md)).

### Maintenance Updates

- Added `engine` field to `package.json` limiting Node versions to v14 or higher, PR [#2164](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2164)
- Replaced `nyc` (code coverage) configurations with `c8` configurations, PR [#2192](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2192)
- Code formats improvements by adding various new linting rules, see Issue [#1935](https://github.com/ethereumjs/ethereumjs-monorepo/issues/1935)

## 4.0.0-beta.3 - 2022-08-10

Beta 3 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes for the main long change set description as well as the Beta 2 release notes for notes on some additional changes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md)).

### New Package Name

**Attention!** This library has been renamed along this release and moved to the scoped package name format already used for most of the other EthereumJS libraries, see PR [#2092](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2092). In this case the library is renamed as follows:

- `rlp` -> `@ethereumjs/rlp`

Please update your library references accordingly or install with:

```shell
npm i @ethereumjs/rlp
```

## 4.0.0-beta.2 - 2022-07-15

Beta 2 release for the upcoming breaking release round on the [EthereumJS monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) libraries, see the Beta 1 release notes ([CHANGELOG](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md)) for the main change set description.

### Removed Default Exports

The change with the biggest effect on UX since the last Beta 1 releases is for sure that we have removed default exports all across the monorepo, see PR [#2018](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2018), we even now added a new linting rule that completely disallows using.

Default exports were a common source of error and confusion when using our libraries in a CommonJS context, leading to issues like Issue [#978](https://github.com/ethereumjs/ethereumjs-monorepo/issues/978).

Now every import is a named import and we think the long term benefits will very much outweigh the one-time hassle of some import adoptions.

### Removed Default Imports in this Library

The main `RLP` class import has been updated, so import changes from:

```ts
import RLP from '@ethereumjs/rlp'
```

to:

```ts
import { RLP } from '@ethereumjs/rlp'
```

## Other Changes

- Added `ESLint` strict boolean expressions linting rule, PR [#2030](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2030)

## 4.0.0-beta.1 - 2022-06-30

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

### Uint8Array / Buffer Removal

This is technically not a change from the v4 version as it was already introduced in v3, but since a lot of people will likely update from a v2 `RLP` version, we will also mention it here:

The v3 release replaces Buffers as input and output values in favor of Uint8Arrays for improved performance and greater compatibility with browsers, see `v3.0.0` [release notes](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/rlp/CHANGELOG.md#300---2022-01-27).

There are new conversion functions added to the `@ethereumjs/util` library, see [RLP docs](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/rlp#buffer-compatibility) on how to use and do the conversion.

## 3.0.0 - 2022-01-27

rlp v3 is a breaking release with several important updates. Special thanks to [@paulmillr](https://github.com/paulmillr) for the majority of this work in PR [#90](https://github.com/ethereumjs/rlp/pull/90).

### Dependencies

bn.js was removed in favor of BigInt support so the package now contains zero dependencies.

### Default export

A new default export `RLP` now contains `encode` and `decode`.

You can now import and use RLP like this:

```javascript
import RLP from '@ethereumjs/rlp'
RLP.encode(1)
```

### Uint8Array

Buffers were replaced in favor of using Uint8Arrays for improved performance and greater compatibility with browsers.

When upgrading from rlp v2 to v3, you must convert your Buffers to Uint8Arrays before passing in. To help, two new utility methods were added to `ethereumjs-util v7.1.4`: `arrToBufArr` and `bufArrToArr`. These will recursively step through your arrays to replace Buffers with Uint8Arrays, or vise versa.

Example:

```ts
// Old, rlp v2
import * as rlp from '@ethereumjs/rlp'
const bufArr = [Buffer.from('123', 'hex'), Buffer.from('456', 'hex')]
const encoded = rlp.encode(bufArr)
const decoded = rlp.decode(encoded)

// New, rlp v3
import RLP from '@ethereumjs/rlp'
const encoded: Uint8Array = RLP.encode(bufArrToArr(bufArr))
const encodedAsBuffer = Buffer.from(encoded)
const decoded: Uint8Array[] = RLP.decode(encoded)
const decodedAsBuffers = arrToBufArr(decoded)
```

### Invalid RLPs

Increased strictness has been added to ensure invalid RLPs are not decoded, see PR [#101](https://github.com/ethereumjs/rlp/pull/101).

---

PRs included in this release:

- Fix karma, readme updates, combine source to one file, PR [#109](https://github.com/ethereumjs/rlp/pull/109)
- Add browser support, remove dependencies, PR [#90](https://github.com/ethereumjs/rlp/pull/90)
- Readme and typedoc updates, normalize source error messages to capital RLP, PR [#108](https://github.com/ethereumjs/rlp/pull/108)
- Improve cli interface, PR [#95](https://github.com/ethereumjs/rlp/pull/95)
- Ensure we do not decode invalid RLPs, PR [#101](https://github.com/ethereumjs/rlp/pull/101)

[v3.0.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.7...rlp@3.0.0

## [v2.2.7] - 2021-10-06

- Performance: Avoid creating new array when checking first two chars, PR [#100](https://github.com/ethereumjs/rlp/pull/100)
- Update BN from require to import, PR [#99](https://github.com/ethereumjs/rlp/pull/99)
- Update dependencies to latest and add browser build, PR [#102](https://github.com/ethereumjs/rlp/pull/102)

#### Included Source Files

Source files from the `src` folder are now included in the distribution build, see PR [#97](https://github.com/ethereumjs/rlp/pull/97). This allows for a better debugging experience in debug tools like Chrome DevTools by having working source map references to the original sources available for inspection.

[v2.2.7]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.6...rlp@2.2.7

## [v2.2.6] - 2020-07-17

- Fixed a few edge-cases in decoding long strings that previously could cause
  OOM (Out of Memory) crash,
  PR [#91](https://github.com/ethereumjs/rlp/pull/91)
- Updated GitHub `actions/checkout` to v2,
  PR [#92](https://github.com/ethereumjs/rlp/pull/92)

[v2.2.6]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.5...rlp@2.2.6

## [v2.2.5] - 2020-05-25

- Added `BigInt` as an accepted encoding type,
  PR [#85](https://github.com/ethereumjs/rlp/pull/85)
- Added support/testing for Node 10, 12, 13, 14, moved from Travis to GitHub Actions,
  PR [#87](https://github.com/ethereumjs/rlp/pull/87)
- Formatting and config cleanups,
  PRs [#86](https://github.com/ethereumjs/rlp/pull/86) and
  [#88](https://github.com/ethereumjs/rlp/pull/88)

[v2.2.5]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.4...rlp@2.2.5

## [v2.2.4] - 2019-11-02

- Removed unused `Dictionary` `Input` type for `RLP.encode()` and `RLP.decode()`,
  PR [#74](https://github.com/ethereumjs/rlp/pull/74)
- Removed unused `safe-buffer` dependency,
  PR [#80](https://github.com/ethereumjs/rlp/pull/80)

[v2.2.4]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.3...rlp@2.2.4

## [v2.2.3] - 2019-03-19

- More robust `Array` type checking in `RLP.encode()` function,
  PR [#70](https://github.com/ethereumjs/rlp/pull/70)
- Library now throws an error when trying to encode negative integer
  values (e.g. `RLP.encode(-1)`),
  PR [#71](https://github.com/ethereumjs/rlp/pull/70)

[v2.2.3]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.2...rlp@2.2.3

## [v2.2.2] - 2019-01-15

- Added `bn.js` dependency to fix module resolution bug when require the module after
  clean install, PR [#64](https://github.com/ethereumjs/rlp/pull/64)
- Use local version of official tests, fixed testing issue, PR [#66](https://github.com/ethereumjs/rlp/pull/66)

[v2.2.2]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.1...rlp@2.2.2

## [v2.2.1] - 2018-12-20

- Fixed a bug introduced in `v2.2.0` causing the CLI `bin/rlp` command not to
  work, see PR [#60](https://github.com/ethereumjs/rlp/pull/60)
- Additional exports of types used by `decode` and `encode`
  (PR [#59](https://github.com/ethereumjs/rlp/pull/59)):
  - `Input`: input type for `encode()`
  - `Dictionary` and `List`: interfaces for possible `Input` values
  - `Decoded`: interface for `decode()` return type
- Additional test structure and new integration tests for distribution and
  `bin/rlp` CLI command, see PR [#57](https://github.com/ethereumjs/rlp/pull/57)

[v2.2.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.2.0...rlp@2.2.1

## [v2.2.0] - 2018-12-17

[DEPRECATED] Please update to `v2.2.1`, release contains a broken CLI `bin/rlp`
command!

First `TypeScript` based release of `EthereumJS` libraries, thanks @krzkaczor,
@GrandSchtroumpf, @whymarrh, @holgerd77 for the great work on this!

This release doesn't introduce any main new features but will serve as a basis
for further `TypeScript` transitions coming along with greater type safety
for `EthereumJS` libraries. If you are developing in `TypeScript` you can
further already benefit from the `RLP` type declarations published from now on
along new releases.

See PR [#37](https://github.com/ethereumjs/rlp/pull/37) and subsequent PRs merged
towards the associated `typescript` branch to get an overview on the changes.
The release also comes along with the introduction of a new repo
[ethereumjs-config](https://github.com/ethereumjs/ethereumjs-config) centralizing
configuration for `EthereumJS` libraries on `TypeScript` itself as well as
linting, formatting and testing.

This release passes all existing unit tests and other checks. If you nevertheless
experience problems please report on the `EthereumJS`
[Gitter](https://gitter.im/ethereum/ethereumjs) channel.

Other changes:

- Added `LICENSE` file for `MPL2.0`, see PR [#31](https://github.com/ethereumjs/rlp/pull/31)

[v2.2.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.1.0...rlp@2.2.0

## [v2.1.0] - 2018-06-28

- Updated supported Node versions, PR [#13](https://github.com/ethereumjs/rlp/pull/13)
- Switched to `safe-buffer` for backwards compatibility, PR [#18](https://github.com/ethereumjs/rlp/pull/18)
- Increased test coverage, PR [#22](https://github.com/ethereumjs/rlp/pull/22)
- Example code tweaks, PR [#12](https://github.com/ethereumjs/rlp/pull/12)
- Fix test runs on Windows, Issue [#7](https://github.com/ethereumjs/rlp/issues/7)
- Added code coverage, PR [#8](https://github.com/ethereumjs/rlp/pull/8)

[v2.1.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@2.0.0...rlp@2.1.0

## [2.0.0] - 2015-09-23

- User `Buffer` values as input for encoding

[2.0.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@1.1.2...rlp@2.0.0

## [1.1.2] - 2015-09-22

- Fix zero encoding

[1.1.2]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@1.1.1...rlp@1.1.2

## [1.1.1] - 2015-09-21

- Fixes for `bin`

[1.1.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@1.1.0...rlp@1.1.1

## [1.1.0] - 2015-09-21

- Added `getLength()` method
- Added hex prefix stripping (`isHexPrefix()` / `stripHexPrefix()`)
- Code formatting clean-ups

[1.1.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@1.0.1...rlp@1.1.0

## [1.0.1] - 2015-06-27

- Code formatting clean-ups

[1.0.1]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@1.0.0...rlp@1.0.1

## [1.0.0] - 2015-06-06

- Added check for invalid 0
- Hardened rlp

[1.0.0]: https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@0.0.14...rlp@1.0.0

## Older releases:

- [0.0.14](https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@0.0.13...rlp@0.0.14) - 2015-03-31
- [0.0.13](https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@0.0.12...rlp@0.0.13) - 2015-03-30
- [0.0.12](https://github.com/ethereumjs/ethereumjs-monorepo/compare/rlp@0.0.11...rlp@0.0.12) - 2014-12-26
