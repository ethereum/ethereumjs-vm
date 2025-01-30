import { createCommonFromGethGenesis } from './src/index.js'

const json = {
  config: {
    ethash: {},
    chainId: 3503995874084926,
    homesteadBlock: 0,
    eip150Block: 6,
    eip155Block: 12,
    eip158Block: 12,
    byzantiumBlock: 18,
    constantinopleBlock: 24,
    petersburgBlock: 30,
    istanbulBlock: 36,
    muirGlacierBlock: 42,
    berlinBlock: 48,
    londonBlock: 54,
    arrowGlacierBlock: 60,
    grayGlacierBlock: 66,
    mergeForkBlock: 72,
    terminalTotalDifficulty: 9454784,
    shanghaiTime: 780,
    cancunTime: 840,
    blobSchedule: {
      prague: {
        target: 6,
        max: 9,
        baseFeeUpdateFraction: 5007716,
      },
    },
  },
  nonce: '0x0',
  timestamp: '0x0',
  extraData: '0x68697665636861696e',
  gasLimit: '0x23f3e20',
  difficulty: '0x20000',
  mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  coinbase: '0x0000000000000000000000000000000000000000',
  alloc: {
    '000f3df6d732807ef1319fb7b8bb8522d0beac02': {
      code: '0x3373fffffffffffffffffffffffffffffffffffffffe14604d57602036146024575f5ffd5b5f35801560495762001fff810690815414603c575f5ffd5b62001fff01545f5260205ff35b5f5ffd5b62001fff42064281555f359062001fff015500',
      balance: '0x2a',
    },
    '0c2c51a0990aee1d73c1228de158688341557508': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '14e46043e63d0e3cdcf2530519f4cfaf35058cb2': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '16c57edf7fa9d9525378b0b81bf8a3ced0620c1c': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '1f4924b14f34e24159387c0a4cdbaa32f3ddb0cf': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '1f5bde34b4afc686f136c7a3cb6ec376f7357759': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '2d389075be5be9f2246ad654ce152cf05990b209': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '3ae75c08b4c907eb63a8960c45b86e1e9ab6123c': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '4340ee1b812acb40a1eb561c019c327b243b92df': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '4a0f1452281bcec5bd90c3dce6162a5995bfe9df': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '4dde844b71bcdf95512fb4dc94e84fb67b512ed8': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '5f552da00dfb4d3749d9e62dcee3c918855a86a0': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '654aa64f5fbefb84c270ec74211b81ca8c44a72e': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '717f8aa2b982bee0e29f573d31df288663e1ce16': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '7435ed30a8b4aeb0877cef0c6e8cffe834eb865f': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '83c7e323d189f18725ac510004fdc2941f8c4a78': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '84e75c28348fb86acea1a93a39426d7d60f4cc46': {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    '8bebc8ba651aee624937e7d897853ac30c95a067': {
      storage: {
        '0x0000000000000000000000000000000000000000000000000000000000000001':
          '0x0000000000000000000000000000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000000000000000000000000000002':
          '0x0000000000000000000000000000000000000000000000000000000000000002',
        '0x0000000000000000000000000000000000000000000000000000000000000003':
          '0x0000000000000000000000000000000000000000000000000000000000000003',
      },
      balance: '0x1',
      nonce: '0x1',
    },
    c7b99a164efd027a93f147376cc7da7c67c6bbe0: {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    d803681e487e6ac18053afc5a6cd813c86ec3e4d: {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    e7d13f7aa2a838d24c59b40186a0aca1e21cffcc: {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
    eda8645ba6948855e3b3cd596bbb07596d59c603: {
      balance: '0xc097ce7bc90715b34b9f1000000000',
    },
  },
  number: '0x0',
  gasUsed: '0x0',
  parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

const common = createCommonFromGethGenesis(json, {})
console.log(common.hardforks())
