[@ethereumjs/block](../README.md) › ["index"](_index_.md)

# Module: "index"

## Index

### Classes

* [Block](../classes/_index_.block.md)
* [BlockHeader](../classes/_index_.blockheader.md)

### Interfaces

* [BlockData](../interfaces/_index_.blockdata.md)
* [BlockOptions](../interfaces/_index_.blockoptions.md)
* [Blockchain](../interfaces/_index_.blockchain.md)
* [HeaderData](../interfaces/_index_.headerdata.md)
* [JsonBlock](../interfaces/_index_.jsonblock.md)
* [JsonHeader](../interfaces/_index_.jsonheader.md)

### Type aliases

* [BlockBodyBuffer](_index_.md#blockbodybuffer)
* [BlockBuffer](_index_.md#blockbuffer)
* [BlockHeaderBuffer](_index_.md#blockheaderbuffer)
* [TransactionsBuffer](_index_.md#transactionsbuffer)
* [UncleHeadersBuffer](_index_.md#uncleheadersbuffer)

## Type aliases

###  BlockBodyBuffer

Ƭ **BlockBodyBuffer**: *[[TransactionsBuffer](_index_.md#transactionsbuffer), [UncleHeadersBuffer](_index_.md#uncleheadersbuffer)]*

*Defined in [types.ts:102](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/src/types.ts#L102)*

___

###  BlockBuffer

Ƭ **BlockBuffer**: *[[BlockHeaderBuffer](_index_.md#blockheaderbuffer), [TransactionsBuffer](_index_.md#transactionsbuffer), [UncleHeadersBuffer](_index_.md#uncleheadersbuffer)]*

*Defined in [types.ts:100](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/src/types.ts#L100)*

___

###  BlockHeaderBuffer

Ƭ **BlockHeaderBuffer**: *Buffer[]*

*Defined in [types.ts:101](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/src/types.ts#L101)*

___

###  TransactionsBuffer

Ƭ **TransactionsBuffer**: *Buffer[][] | Buffer[]*

*Defined in [types.ts:106](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/src/types.ts#L106)*

TransactionsBuffer can be an array of serialized txs for Typed Transactions or an array of Buffer Arrays for legacy transactions.

___

###  UncleHeadersBuffer

Ƭ **UncleHeadersBuffer**: *Buffer[][]*

*Defined in [types.ts:107](https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/block/src/types.ts#L107)*
