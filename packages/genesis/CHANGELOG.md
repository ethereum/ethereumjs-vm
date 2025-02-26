# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
(modification: no type change headlines) and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 0.3.0-alpha.1 - 2024-10-17

- Upgrade to TypeScript 5, PR [#3607](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3607)
- Node 22 support, PR [#3669](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3669)
- Upgrade `ethereum-cryptography` to v3, PR [#3668](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3668)

## 0.2.3 - 2024-08-15

Maintenance release with downstream dependency updates, see PR [#3527](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3527)

## 0.2.2 - 2024-03-18

Maintenance release with downstream dependency updates, see PR [#3297](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3297)

## 0.2.1 - 2024-02-08

Maintenance release with dependency updates, see PR [#3261](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3261)

## 0.2.0 - 2023-10-26

### Holesky Testnet Support

This release comes with full support for the [Holesky](https://holesky.ethpandaops.io/) public Ethereum testnet replacing the `Goerli` test network.

- Add Holesky genesis specification, PR [2982](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2982), [#2989](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2989), [#2997](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2997), [#3049](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3049), [#3074](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3074) and [#3088](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3088)

### Other Changes

- Package CI integration, PR [#3098](https://github.com/ethereumjs/ethereumjs-monorepo/pull/3098)

## 0.1.0 - 2023-08-09

Final release version from the breaking release round from Summer 2023 on the EthereumJS libraries, thanks to the whole team for this amazing accomplishment! ❤️ 🥳

See [RC1 release notes](https://github.com/ethereumjs/ethereumjs-monorepo/releases/tag/%40ethereumjs%2Fgenesis%400.1.0-rc.1) for the main change description.

## 0.1.0-rc.1 - 2023-07-18

Initial release.

This package contains all genesis state files (currently for Goerli, Mainnet and Sepolia) previously included in the `@ethereumjs/blockchain` package, see PR [#2768](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2768), [#2815](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2815 and [#2886](https://github.com/ethereumjs/ethereumjs-monorepo/pull/2886)) for package introduction.

This is to reduce bundle and distribution sizes for other packages, mainly Blockchain, EVM and VM, since genesis state information (particularly the large Mainnet state) is often not necessary for large parts of API usage.
