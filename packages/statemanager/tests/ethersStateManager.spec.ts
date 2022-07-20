import { Address } from '@ethereumjs/util'
import { CloudflareProvider } from '@ethersproject/providers'
import * as tape from 'tape'
import { EthersStateManager } from '../src/ethersStateManager'

import { VM } from '@ethereumjs/vm'
import { Chain, Common } from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'

const provider = new CloudflareProvider()

tape('Ethers State Manager API tests', async (t) => {
  const state = new EthersStateManager({ provider: provider })
  const vitalikDotEth = Address.fromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  const account = await state.getAccount(vitalikDotEth)
  t.ok(account.nonce > 0n, 'Vitalik.eth returned a valid nonce')

  await state.putAccount(vitalikDotEth, account)

  t.ok(
    (state as any).accountsCache.get(vitalikDotEth.toString()).nonce > 0,
    'Vitalik.eth is stored in accountCache'
  )
  const doesThisAccountExist = await state.accountExists(
    Address.fromString('0xccAfdD642118E5536024675e776d32413728DD07')
  )
  t.ok(!doesThisAccountExist, 'accountExists returns false for non-existent account')

  const UNIerc20ContractAddress = Address.fromString('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')
  const UNIContractCode = await state.getContractCode(UNIerc20ContractAddress)

  t.ok(UNIContractCode.length > 0, 'was able to retrieve UNI contract code')

  await state.putContractCode(UNIerc20ContractAddress, UNIContractCode)

  t.ok(
    typeof (state as any).contractCache.get(UNIerc20ContractAddress.toString()) !== 'undefined',
    'UNI ERC20 contract code was found in cache'
  )
  const storageSlot = await state.getContractStorage(
    Address.fromString('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'),
    Buffer.from('1', 'hex')
  )
  t.ok(storageSlot.length > 0, 'was able to retrieve storage slot 1 for the UNI contract')
  t.end()
})

tape('runTx tests', async (t) => {
  const common = new Common({ chain: Chain.Mainnet })
  const state = new EthersStateManager({ provider: provider })
  const vm = await VM.create({ common, stateManager: state })
  const vitalikDotEth = Address.fromString('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  const privateKey = Buffer.from(
    'e331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109',
    'hex'
  )
  const tx = FeeMarketEIP1559Transaction.fromTxData(
    { to: vitalikDotEth, value: '0x100', gasLimit: 500000n, maxFeePerGas: 7 },
    { common }
  ).sign(privateKey)
  const result = await vm.runTx({
    skipBalance: true,
    skipNonce: true,
    tx,
  })

  t.equal(result.totalGasSpent, 21000n, 'sent some ETH to vitalik.eth')
  t.end()
})
