import { Block, blockFromBlockData } from '@ethereumjs/block'
import { Chain, Common, Hardfork } from '@ethereumjs/common'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Chainstart })

console.log(common.consensusType()) // 'pow'
console.log(common.consensusAlgorithm()) // 'ethash'

blockFromBlockData({}, { common })
console.log(`Old Proof-of-Work block created`)
