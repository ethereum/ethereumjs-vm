# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 3.0.0-alpha.1 - 2024-10-17

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)

## 2.0.4 - 2024-08-15

Maintenance release with downstream dependency updates, see PR [#3527](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3527)

## 2.0.3 - 2024-03-18

Maintenance release with downstream dependency updates, see PR [#3297](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3297)

## 2.0.2 - 2024-02-08

### Self-Contained (and Working 🙂) README Examples

All code examples in `EthereumJS` monorepo library README files are now self-contained and can be executed "out of the box" by simply copying them over and running "as is", see tracking issue [#3234](https://github.com/ethereumjs/ethereumjs-monorepo/issues/3234) for an overview. Additionally all examples can now be found in the respective library [examples](./examples/) folder (in fact the README examples are now auto-embedded from over there). As a nice side effect all examples are now run in CI on new PRs and so do not risk to get outdated or broken over time.

### Other Changes

- Dependency version updates, PR [#3261](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3261)

## 2.0.1 - 2023-10-26

- Add `fromMnemonic()` static constructor to BIP32 HD wallet, PR [#192](https://github.com/ethereumjs/ethereumjs-wallet/pull/192)

## 2.0.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Fwallet%402.0.0-rc.1) for the main change description.

## 2.0.0-rc.1 - 2023-07-18

### New Package Name and General Library Update

This is the first release of this library under a new namespaced package name switching from:

- `ethereumjs-wallet` -> `@ethereumjs/wallet`

So the new version of the library can now be installed with:

```shell
npm i @ethereumjs/wallet
```

The wallet library has now also been integrated into the EthereumJS monorepo, see PR [#2729](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2729) and PR [#2739](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2739) and got a general update along the way aligning with the other EthereumJS libraries by e.g. switching from Buffer usage to Uint8Array and providing a hybrid CJS/ESM build.

### Removed default Exports

All default exports for the libraries have been removed since these cause reoccurring import problems under certain build and usage conditions.

So imports needs to be updated as follows:

```ts
import Wallet from 'ethereumjs-wallet'
import { Wallet } from '@ethereumjs/wallet'

import { thirdparty } from 'ethereumjs-wallet'
import { thirdparty } from '@ethereumjs/wallet'

import { hdkey } from 'ethereumjs-wallet'
import { hdkey } from '@ethereumjs/wallet'
```

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

With these releases we remove all Node.js specific `Buffer` usages from our libraries and replace these with [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) representations, which are available both in Node.js and the browser (`Buffer` is a subclass of `Uint8Array`). While this is a big step towards interoperability and browser compatibility of our libraries, this is also one of the most invasive operations we have ever done, see the huge changeset from PR [#2566](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2566), additional updates in [#2607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2607) as well as the Wallet specific update in [#2739](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2739). 😋

We nevertheless think this is very much worth it and we tried to make transition work as easy as possible.

#### How to upgrade?

For this library you should check if you use one of the following constructors, methods, constants or types and do a search and update input and/or output values or general usages and add conversion methods if necessary:

```ts
// wallet
Wallet.fromPrivateKey()
Wallet.getPublicKey()
Wallet.verifyPublicKey()
Wallet.getAddress()
Wallet.toV3String()
Wallet.toV3()

// hdkey
EthereumHDKey.fromMasterSeed()
```

We have converted existing Buffer conversion methods to Uint8Array conversion methods in the [@ethereumjs/util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) `bytes` module, see the respective README section for guidance.

#### Prefixed Hex Strings as Default

The mixed usage of prefixed and unprefixed hex strings is a constant source of errors in byte-handling code bases.

We have therefore decided to go "prefixed" by default, see PR [#2830](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2830) and [#2845](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2845).

The `hexToBytes` and `bytesToHex` methods, also similar methods like `intToHex`, now take `0x`-prefixed hex strings as input and output prefixed strings. The corresponding unprefixed methods are marked as `deprecated` and usage should be avoided.

Please therefore check you code base on updating and ensure that values you are passing to constructors and methods are prefixed with a `0x`.

## [1.0.2] - 2021-10-08

- Updated dependencies to latest, added browser build, PR [#157](https://github.com/ethereumjs/ethereumjs-wallet/pull/157)

#### Included Source Files

Source files from the `src` folder are now included in the distribution build. This allows for a better debugging experience in debug tools like Chrome DevTools by having working source map references to the original sources available for inspection.

[1.0.2]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v1.0.1...v1.0.2

## [1.0.1] - 2020-09-25

- Fixed a browser issue in `Wallet.fromV3()` and `Wallet.toV3()` triggered when using web bundlers using Buffer v4 shim (Webpack 4),
  see PR [#135](https://github.com/ethereumjs/ethereumjs-wallet/pull/135)

[1.0.1]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v1.0.0...v1.0.1

## [1.0.0] - 2020-06-23

This is the first `TypeScript` release on the library (thanks @the-jackalope for the rewrite! ❤️), see PR [#93](https://github.com/ethereumjs/ethereumjs-wallet/pull/93) for the main PR here. The release comes with various breaking changes.

### Libray Import / API Documentation

The way submodules are exposed has been changed along the `TypeScript` rewrite and you will likely have to update your imports. Here is an example for the `hdkey` submodule:

Node.js / ES5:

```js
const { hdkey } = require('ethereumjs-wallet')
```

ESM / TypeScript:

```js
import { hdkey } from 'ethereumjs-wallet'
```

See [README](https://github.com/ethereumjs/ethereumjs-wallet#wallet-api) for examples on the other submodules.

Together with the switch to `TypeScript` the previously static documentation has been automated to now being generated with `TypeDoc` to reflect all latest changes, see PR [#98](https://github.com/ethereumjs/ethereumjs-wallet/pull/98). See the new [docs](https://github.com/ethereumjs/ethereumjs-wallet/blob/master/docs/README.md) for an overview on the `TypeScript` based API.

### API Changes

The API of the library hasn't been changed intentionally but has become more strict on type input by the explcit type definitions from the `TypeScript` code in function signatures together with the introduction of the `ethereumjs-util` [v7](https://github.com/ethereumjs/ethereumjs-util/releases) library within the `Wallet` library, which behaves more strict on type input on the various utility functions.

This leads to cases where some input - while not having been the intended way to use the library - might have been worked before through implicit type conversion and is now not possible any more.

One example for this is the `Wallet.fromPublicKey()` function, here is the old code of the function:

```js
Wallet.fromPublicKey = function (pub, nonStrict) {
  if (nonStrict) {
    pub = ethUtil.importPublic(pub)
  }
  return new Wallet(null, pub)
}
```

and here the new `TypeScript` code:

```ts
public static fromPublicKey(publicKey: Buffer, nonStrict: boolean = false): Wallet {
  if (nonStrict) {
    publicKey = importPublic(publicKey)
  }
  return new Wallet(undefined, publicKey)
}
```

This function worked in the `v0.6.x` version also with passing in a string, since the `ethereumjs-util` `v6` `importPublic` method converted the input implicitly to a `Buffer`, the `v1.0.0` version now directly enforces the `fromPublicKey` input to be a `Buffer` first hand.

There will likely be more cases like this in the code since the type input of the library hasn't been documented in the older version. So we recommend here to go through all your function signature usages and see if you uses the correct input types. While a bit annoying this is a one-time task you will never have to do again since you can now profit from the clear `TypeScript` input types being both documented and enforced by the `TypeScript` compiler.

### Pure JS Crypto Dependencies

This library now uses pure JS crypto dependencies which doesn't bring in the need for native compilation on installation. For `scrypt` key derivation [scrypt-js](https://github.com/ricmoo/scrypt-js) from @ricmoo is used (see PR [#125](https://github.com/ethereumjs/ethereumjs-wallet/pull/125)).

For BIP-32 key derivation the new [ethereum-cryptography](https://github.com/ethereum/js-ethereum-cryptography) library is used which is a new Ethereum Foundation backed and formally audited libray to provide pure JS cryptographic primitives within the Ethereum ecosystem (see PR [#128](https://github.com/ethereumjs/ethereumjs-wallet/pull/128)).

### Removed ProviderEngine

Support for Provider Engine has been removed for security reasons, since the package is not very actively maintained and superseded by [`json-rpc-engine`](https://github.com/MetaMask/web3-provider-engine#web3-providerengine).

If you need the removed functionality, it should be relatively easily possible to do this integration by adopting the code from [provider-engine.ts](https://github.com/ethereumjs/ethereumjs-wallet/blob/v0.6.x/src/provider-engine.js).

See also: PR [#117](https://github.com/ethereumjs/ethereumjs-wallet/pull/117)

### Other Changes

#### Bug Fixes

- Fixes a bug where `salt`, `iv` and/or `uuid` options - being supplied as strings to `Wallet.toV3()` - could lead to errors during encryption and/or output that could not be decrypted,
  PR [#95](https://github.com/ethereumjs/ethereumjs-wallet/pull/95)

#### Refactoring & Maintenance

- `ES6` class rewrite,
  PR [#93](https://github.com/ethereumjs/ethereumjs-wallet/pull/93) (`TypeScript` PR)
- Added support for Node 12, 13, and 14, upgraded CI provider to use GH Actions in place of Travis,
  PR [#120](https://github.com/ethereumjs/ethereumjs-wallet/pull/120)
- Updated `ethereumjs-util` dependency from `v6` to
  [v7.0.2](https://github.com/ethereumjs/ethereumjs-util/releases/tag/v7.0.2 (stricter types),
  PR [#126](https://github.com/ethereumjs/ethereumjs-wallet/pull/126)
- Refactored `Wallet.deciperBuffer()`, <!-- cspell:disable-line -->
  PR [#82](https://github.com/ethereumjs/ethereumjs-wallet/pull/82)

#### Development & CI

- Integrated the `ethereumjs-config` EthereumJS developer configuration standards,
  PR [#93](https://github.com/ethereumjs/ethereumjs-wallet/pull/93) (`TypeScript` PR)
- Added org links and Git hooks,
  PR [#88](https://github.com/ethereumjs/ethereumjs-wallet/pull/88)

[0.6.4]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.6.3...v1.0.0

## [0.6.4] - 2020-05-01

This is the last release from the `v0.6.x` release series. It adds Node 12 compatibility while maintaining compatibility
down to Node 6. To be able to do so the `scrypt.js` key derivation library is exchanged with `scryptsy`. While this solution is backwards-compatible the changed library only provides a pure JS implementation and no native bindings. If you need native performance pin your dependency to `v0.6.3` or update to the `v1.0.0` library version to be released shortly after this release.

Change Summary:

- v0.6.x back patch: added node v12 support, switched to `scryptsy` key derivation library (pure JS implementation),
  PR [#114](https://github.com/ethereumjs/ethereumjs-wallet/pull/114)
- Updated `hdkey` to `v1.1.1`,
  PR [#87](https://github.com/ethereumjs/ethereumjs-wallet/pull/87)
- Refactored `decipherBuffer()`,
  PR [#82](https://github.com/ethereumjs/ethereumjs-wallet/pull/82)
- Added more tests for `Wallet.fromEthSale()`,
  PR [#80](https://github.com/ethereumjs/ethereumjs-wallet/pull/80)

[0.6.4]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.6.3...v0.6.4

## [0.6.3] - 2018-12-19

- Fixed installation errors for certain packaging tools, PR [#67](https://github.com/ethereumjs/ethereumjs-wallet/pull/67)
- Remove dependency on `crypto.randomBytes` and use `randombytes` package instead, PR [#63](https://github.com/ethereumjs/ethereumjs-wallet/pull/63)
- Add comprehensive test coverage for `fromV3`, PR [#62](https://github.com/ethereumjs/ethereumjs-wallet/pull/62)
- Remove excess parameter from `decipherBuffer` usage, PR [#77](https://github.com/ethereumjs/ethereumjs-wallet/pull/77)
- Update dependencies, including a fixed `scrypt.js`, which should resolve more installation issues, PR [#78](https://github.com/ethereumjs/ethereumjs-wallet/pull/78)

[0.6.3]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.6.2...v0.6.3

## [0.6.2] - 2018-08-08

- [PLEASE UPDATE!] Fixes a critical import bug introduced in `v0.6.1` accidentally
  changing the import path for the different submodules, see PR [#65](https://github.com/ethereumjs/ethereumjs-wallet/pull/65)

[0.6.2]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.6.1...v0.6.2

## [0.6.1] - 2018-07-28 [DEPRECATED]

- Added support for vanity address generation, PR [#5](https://github.com/ethereumjs/ethereumjs-wallet/pull/5)
- Fixed typo in provider-engine, PR [#16](https://github.com/ethereumjs/ethereumjs-wallet/pull/16)
- Accept the true range of addresses for ICAP direct, PR [#6](https://github.com/ethereumjs/ethereumjs-wallet/pull/6)
- Switched to babel ES5 build, PR [#37](https://github.com/ethereumjs/ethereumjs-wallet/pull/37)
- Improve test coverage (at 88% now), PR [#27](https://github.com/ethereumjs/ethereumjs-wallet/pull/27)
- Various dependency updates, PR [#25](https://github.com/ethereumjs/ethereumjs-wallet/pull/25)

[0.6.1]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.6.0...v0.6.1

## [0.6.0] - 2016-04-27

- Added provider-engine integration, PR [#7](https://github.com/ethereumjs/ethereumjs-wallet/pull/7)

[0.6.0]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.5.2...v0.6.0

## [0.5.2] - 2016-04-25

- Dependency updates

[0.5.2]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.5.1...v0.5.2

## [0.5.1] - 2016-03-26

- Bugfix for `EthereumHDKey.privateExtendedKey()`
- Added travis and coveralls support
- Documentation and test improvements

[0.5.1]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.5.0...v0.5.1

## [0.5.0] - 2016-03-23

- Support HD keys using `cryptocoinjs/hdkey`
- Ensure private keys are valid according to the curve
- Support instantiation with public keys
- Support importing BIP32 xpub/xpriv
- Only support Ethereum keys internally, non-strict mode for importing compressed ones
- Thirdparty API doc improvements

[0.5.0]: https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.4.0...v0.5.0

## Older releases:

- [0.4.0](https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.3.0...v0.4.0) - 2016-03-16
- [0.3.0](https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.2.1...v0.3.0) - 2016-03-09
- [0.2.1](https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.2.0...v0.2.1) - 2016-03-07
- [0.2.0](https://github.com/ethereumjs/ethereumjs-wallet/compare/v0.1.0...v0.2.0) - 2016-03-07
- 0.1.0 - 2016-02-23
