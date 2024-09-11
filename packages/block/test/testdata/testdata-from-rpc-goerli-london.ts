import type { JSONRPCBlock } from '../../src/index.js'

export const testdataFromRPCGoerliLondonData: JSONRPCBlock = {
  baseFeePerGas: '0x7',
  difficulty: '0x1',
  extraData:
    '0x696e667572612d696f00000000000000000000000000000000000000000000001da4547ff7dfdfe4c70a52e1f40d60d0259803e733aba7f5024ec054265017725febb042946985654f62c284c010b56a7fb2cd43d0c8968dbd081a1d0db45d4b00',
  gasLimit: '0x1c9c380',
  gasUsed: '0xfe1a',
  hash: '0xec0b5cf01a11c514e6fecb2577adf82594083a79eda699eeaf7d11ebef226063',
  logsBloom:
    '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000040000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  miner: '0x0000000000000000000000000000000000000000',
  mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  nonce: '0x0000000000000000',
  number: '0x4ddb6a',
  parentHash: '0xb8a6ba8f2d6c13be07a0580add9d9ccc8e4301bd1244e3b0da53d025ce926370',
  receiptsRoot: '0x1e8cf75ab79f5c5bc40035d507a6d26e287fbc0530959afc0edcd84434131288',
  sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
  size: '0x334',
  stateRoot: '0x1ce2cb2fc266096dac2d41eda3e74220f693b1f05f963a1fee8e5230cbb9690e',
  timestamp: '0x60e652d7',
  totalDifficulty: '0x71d437',
  transactions: [
    {
      blockHash: '0xec0b5cf01a11c514e6fecb2577adf82594083a79eda699eeaf7d11ebef226063',
      blockNumber: '0x4ddb6a',
      from: '0xa121d112a8ca7ee375b537c1b05f0420aa78f790',
      gas: '0x3d090',
      gasPrice: '0x1176592e00',
      hash: '0x2bdcc1dc5f41bf1420b4594f43d2e72c133f01350638b3a639171c2ea1d2ff81',
      input:
        '0x4b2a026d00000000000000000000000000000000000000000000000000000000000024d700000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000',
      nonce: '0x1cde',
      r: '0x90b768024ddd5e88b3131b3d4cf2ea34f5d6133d8a9dbd118e4395283c1411f5',
      s: '0x1d4db88bb1c7b847660d751459c9b705356cef9518a947582600f3107ea7565',
      to: '0xaa6ce64b8c7aee2fa652ea4d240bbffcb7d98d1b',
      transactionIndex: '0x0',
      type: '0x0',
      v: '0x2e',
      value: '0x0',
    },
  ],
  transactionsRoot: '0x43fd7e89d018b7034792877bfee31aa4aeeeed66a4a770d617a470267a626b7c',
  uncles: [],
}
