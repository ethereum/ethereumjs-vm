import { VM } from '../../dist/cjs/vm'
import { Account, Address } from '@ethereumjs/util'

export const keyPair = {
  secretKey: '0x3cd7232cd6f3fc66a57a6bedc1a8ed6c228fff0a327e169c2bcc5e869ed49511',
  publicKey:
    '0x0406cc661590d48ee972944b35ad13ff03c7876eae3fd191e8a2f77311b0a3c6613407b5005e63d7d8d76b89d5f900cde691497688bb281e07a5052ff61edebdc0',
}

export const insertAccount = async (vm: VM, address: Address) => {
  const acctData = {
    nonce: 0,
    balance: BigInt(10) ** BigInt(18), // 1 eth
  }
  const account = Account.fromAccountData(acctData)

  await vm.stateManager.putAccount(address, account)
}

export const getAccountNonce = async (vm: VM, accountPrivateKey: Uint8Array) => {
  const address = Address.fromPrivateKey(accountPrivateKey)
  const account = await vm.stateManager.getAccount(address)
  if (account) {
    return account.nonce
  } else {
    return BigInt(0)
  }
}
