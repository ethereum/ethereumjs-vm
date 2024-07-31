import { createBlockFromBlockData } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Chainstart })

console.log(common.consensusType()) // 'pow'
console.log(common.consensusAlgorithm()) // 'ethash'

createBlockFromBlockData({}, { common })
console.log(`Old Proof-of-Work block created`)
