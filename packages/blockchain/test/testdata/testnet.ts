import type { ChainConfig } from '@ethereumjs/common'

export const testnetData: ChainConfig = {
  name: 'mainnet',
  chainId: 1,
  defaultHardfork: 'london',
  consensus: {
    type: 'pow',
    algorithm: 'ethash',
  },
  comment: 'Private test network',
  url: '[TESTNET_URL]',
  genesis: {
    gasLimit: 5000,
    difficulty: 1,
    nonce: '0xbb00000000000000',
    extraData: '0x11bbe8db4e347b4e8c937c1c8370e4b5ed33adb3db69cbdb7a38e1e50b1b82fa',
  },
  hardforks: [
    {
      name: 'chainstart',
      block: 0,
    },
    {
      name: 'homestead',
      block: 1,
    },
    {
      name: 'tangerineWhistle',
      block: 2,
    },
    {
      name: 'spuriousDragon',
      block: 3,
    },
    {
      name: 'byzantium',
      block: 4,
    },
    {
      name: 'constantinople',
      block: 5,
    },
    {
      name: 'petersburg',
      block: 6,
    },
    {
      name: 'istanbul',
      block: 7,
    },
    {
      name: 'muirGlacier',
      block: 8,
    },
    {
      name: 'berlin',
      block: 9,
    },
    {
      name: 'london',
      block: 10,
    },
    {
      name: 'paris',
      block: 11,
    },
  ],
  bootstrapNodes: [
    {
      ip: '10.0.0.1',
      port: 30303,
      id: '11000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      location: '',
      comment: '',
    },
    {
      ip: '10.0.0.2',
      port: 30303,
      id: '22000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      location: '',
      comment: '',
    },
  ],
}
