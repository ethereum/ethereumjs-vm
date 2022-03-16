import tape from 'tape'
import VM from '../../../src'
import Common, { Chain, Hardfork } from '@ethereumjs/common'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'
import { Address, BN, privateToAddress } from 'ethereumjs-util'
import * as eof from '../../../src/evm/opcodes/eof'
const pkey = Buffer.from('20'.repeat(32), 'hex')
const GWEI = new BN('1000000000')
const sender = new Address(privateToAddress(pkey))

async function runTx(vm: VM, data: string, nonce: number) {
  const tx = FeeMarketEIP1559Transaction.fromTxData({
    data,
    gasLimit: 1000000,
    maxFeePerGas: 7,
    nonce,
  }).sign(pkey)
  const result = await vm.runTx({ tx })
  const created = result.createdAddress
  const code = await vm.stateManager.getContractCode(created!)
  return code
}

tape('EIP 3540 tests', (t) => {
  const common = new Common({
    chain: Chain.Mainnet,
    hardfork: Hardfork.London,
    eips: [3540],
  })

  t.test('eof1CodeAnalysis() tests', async (st) => {
    const eofHeader = Buffer.from([eof.FORMAT, eof.MAGIC, eof.VERSION])
    st.ok(
      eof.codeAnalysis(Buffer.concat([eofHeader, Uint8Array.from([0x01, 0x00, 0x01, 0x00, 0x00])]))
        ?.code! > 0,
      'valid code section'
    )
    st.ok(
      eof.codeAnalysis(
        Buffer.concat([
          eofHeader,
          Uint8Array.from([0x01, 0x00, 0x01, 0x02, 0x00, 0x01, 0x00, 0x00, 0xaa]),
        ])
      )?.data! > 0,
      'valid data section'
    )
    st.ok(
      !eof.codeAnalysis(
        Buffer.concat([eofHeader, Uint8Array.from([0x01, 0x00, 0x01, 0x00, 0x00, 0x00])])
      ),
      'invalid container length (too long)'
    )
    st.ok(
      !eof.codeAnalysis(Buffer.concat([eofHeader, Uint8Array.from([0x01, 0x00, 0x01, 0x00])])),
      'invalid container length (too short)'
    )
    st.end()
  })

  t.test('invalid object formats', async (st) => {
    const vm = new VM({ common })
    const account = await vm.stateManager.getAccount(sender)
    const balance = GWEI.muln(21000).muln(10000000)
    account.balance = balance
    await vm.stateManager.putAccount(sender, account)

    let data = '0x60EF60005360016000F3'
    let code = await runTx(vm, data, 0)
    st.ok(code.length === 0, 'no magic')

    data = '0x7FEF0000000000000000000000000000000000000000000000000000000000000060005260206000F3'
    code = await runTx(vm, data, 1)
    st.ok(code.length === 0, 'invalid header')

    data = '0x7FEF0002000000000000000000000000000000000000000000000000000000000060005260206000F3'
    code = await runTx(vm, data, 2)
    st.ok(code.length === 0, 'valid header but invalid EOF format')

    data = '0x7FEF0001000000000000000000000000000000000000000000000000000000000060005260206000F3'
    code = await runTx(vm, data, 3)
    st.ok(code.length === 0, 'valid header and version but no code section')

    data = '0x7FEF0001030000000000000000000000000000000000000000000000000000000060005260206000F3'
    code = await runTx(vm, data, 4)
    st.ok(code.length === 0, 'valid header and version but unknown section type')

    data = '0x7FEF0001010002006000DEADBEEF0000000000000000000000000000000000000060005260206000F3'
    code = await runTx(vm, data, 5)
    st.ok(code.length === 0, 'code section with trailing bytes')
  })
})

tape('valid contract creation cases', async (st) => {
  const common = new Common({
    chain: Chain.Mainnet,
    hardfork: Hardfork.London,
    eips: [3540],
  })
  const vm = new VM({ common })
  const account = await vm.stateManager.getAccount(sender)
  const balance = GWEI.muln(21000).muln(10000000)
  account.balance = balance
  await vm.stateManager.putAccount(sender, account)

  let data = '0x67EF0001010001000060005260086018F3'
  let code = await runTx(vm, data, 0)
  st.ok(code.length > 0, 'code section with no data section')

  data = '0x6BEF00010100010200010000AA600052600C6014F3'
  code = await runTx(vm, data, 1)
  st.ok(code.length > 0, 'code section with data section')
})

function generateEOFCode(code: string) {
  const len = (code.length / 2).toString(16).padStart(4, '0')
  return '0xEF000101' + len + '00' + code
}

function generateInvalidEOFCode(code: string) {
  const len = (code.length / 2 + 1).toString(16).padStart(4, '0') // len will be 1 too long
  return '0xEF000101' + len + '00' + code
}

const offset = '13'
const CREATEDeploy = '0x60' + offset + '380360' + offset + '60003960' + offset + '380360006000F000'

const create2offset = '15'
const CREATE2Deploy =
  '0x600060' +
  create2offset +
  '380360' +
  create2offset +
  '60003960' +
  create2offset +
  '380360006000F500'

function deployCreateCode(initcode: string) {
  return CREATEDeploy + initcode
}

function deployCreate2Code(initcode: string) {
  return CREATE2Deploy + initcode
}

tape('ensure invalid EOF initcode in EIP-3540 does not consume all gas', (t) => {
  t.test('case: tx', async (st) => {
    const common = new Common({
      chain: Chain.Mainnet,
      hardfork: Hardfork.London,
      eips: [3540],
    })
    const vm = new VM({ common })
    const account = await vm.stateManager.getAccount(sender)
    const balance = GWEI.muln(21000).muln(10000000)
    account.balance = balance
    await vm.stateManager.putAccount(sender, account)

    let tx = FeeMarketEIP1559Transaction.fromTxData({
      data: generateEOFCode('60016001F3'),
      gasLimit: 1000000,
      maxFeePerGas: 7,
      nonce: 0,
    }).sign(pkey)
    const result = await vm.runTx({ tx })

    tx = FeeMarketEIP1559Transaction.fromTxData({
      data: generateInvalidEOFCode('60016001F3'),
      gasLimit: 1000000,
      maxFeePerGas: 7,
      nonce: 1,
    }).sign(pkey)
    const result2 = await vm.runTx({ tx })
    st.ok(result.gasUsed.gt(result2.gasUsed), 'invalid initcode did not consume all gas')
  })

  t.test('case: create', async (st) => {
    const common = new Common({
      chain: Chain.Mainnet,
      hardfork: Hardfork.London,
      eips: [3540],
    })
    const vm = new VM({ common })
    const account = await vm.stateManager.getAccount(sender)
    const balance = GWEI.muln(21000).muln(10000000)
    account.balance = balance
    await vm.stateManager.putAccount(sender, account)

    let tx = FeeMarketEIP1559Transaction.fromTxData({
      data: deployCreateCode(generateEOFCode('60016001F3').substring(2)),
      gasLimit: 1000000,
      maxFeePerGas: 7,
      nonce: 0,
    }).sign(pkey)
    const result = await vm.runTx({ tx })

    tx = FeeMarketEIP1559Transaction.fromTxData({
      data: deployCreateCode(generateInvalidEOFCode('60016001F3').substring(2)),
      gasLimit: 1000000,
      maxFeePerGas: 7,
      nonce: 1,
    }).sign(pkey)
    const result2 = await vm.runTx({ tx })
    st.ok(result.gasUsed.gt(result2.gasUsed), 'invalid initcode did not consume all gas')
  })

  t.test('case: create2', async (st) => {
    const common = new Common({
      chain: Chain.Mainnet,
      hardfork: Hardfork.London,
      eips: [3540],
    })
    const vm = new VM({ common })
    const account = await vm.stateManager.getAccount(sender)
    const balance = GWEI.muln(21000).muln(10000000)
    account.balance = balance
    await vm.stateManager.putAccount(sender, account)

    let tx = FeeMarketEIP1559Transaction.fromTxData({
      data: deployCreate2Code(generateEOFCode('60016001F3').substring(2)),
      gasLimit: 1000000,
      maxFeePerGas: 7,
      nonce: 0,
    }).sign(pkey)
    const result = await vm.runTx({ tx })

    tx = FeeMarketEIP1559Transaction.fromTxData({
      data: deployCreate2Code(generateInvalidEOFCode('60016001F3').substring(2)),
      gasLimit: 1000000,
      maxFeePerGas: 7,
      nonce: 1,
    }).sign(pkey)
    const result2 = await vm.runTx({ tx })
    st.ok(result.gasUsed.gt(result2.gasUsed), 'invalid initcode did not consume all gas')
  })
})
