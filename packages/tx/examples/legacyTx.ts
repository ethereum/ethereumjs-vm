import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { createLegacyTx } from '@ethereumjs/tx'
import { bytesToHex } from '@ethereumjs/util'
import { hexToBytes } from 'ethereum-cryptography/utils'

const txParams = {
  nonce: '0x0',
  gasPrice: '0x09184e72a000',
  gasLimit: '0x2710',
  to: '0x0000000000000000000000000000000000000000',
  value: '0x00',
  data: '0x7f7465737432000000000000000000000000000000000000000000000000000000600057',
}

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
const tx = createLegacyTx(txParams, { common })

const privateKey = hexToBytes('0xe331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109')

const signedTx = tx.sign(privateKey)

const serializedTx = signedTx.serialize()
console.log(bytesToHex(signedTx.hash())) // 0x894b72d87f8333fccd29d1b3aca39af69d97a6bc281e7e7a3a60640690a3cd2b
