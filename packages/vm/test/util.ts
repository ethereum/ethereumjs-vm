import { Block, BlockHeader } from '@ethereumjs/block'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import {
  AccessListEIP2930Transaction,
  FeeMarketEIP1559Transaction,
  LegacyTransaction,
} from '@ethereumjs/tx'
import {
  Account,
  Address,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  equalsBytes,
  hexToBytes,
  isHexPrefixed,
  setLengthLeft,
  stripHexPrefix,
  toBytes,
} from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { assert } from 'vitest'

import type { BlockOptions } from '@ethereumjs/block'
import type { EVMStateManagerInterface } from '@ethereumjs/common'
import type { TxOptions } from '@ethereumjs/tx'

export function dumpState(state: any, cb: Function) {
  function readAccounts(state: any) {
    return new Promise((resolve) => {
      const accounts: Account[] = []
      const rs = state.createReadStream()
      rs.on('data', function (data: any) {
        const rlp = data.value
        const account = Account.fromRlpSerializedAccount(rlp)
        accounts.push(account)
      })
      rs.on('end', function () {
        resolve(accounts)
      })
    })
  }

  function readStorage(state: any, account: Account) {
    return new Promise((resolve) => {
      const storage: any = {}
      const storageTrie = state.copy(false)
      storageTrie.root(account.storageRoot)
      const storageRS = storageTrie.createReadStream()

      storageRS.on('data', function (data: any) {
        storage[bytesToHex(data.key)] = bytesToHex(data.value)
      })

      storageRS.on('end', function () {
        resolve(storage)
      })
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  readAccounts(state).then(async function (accounts: any) {
    const results: any = []
    for (let key = 0; key < accounts.length; key++) {
      const result = await readStorage(state, accounts[key])
      results.push(result)
    }
    for (let i = 0; i < results.length; i++) {
      console.log('Hashed address: ' + bytesToHex(results[i].address))
      console.log('\tstorage root: ' + bytesToHex(results[i].storageRoot))
      console.log('\tstorage: ')
      for (const storageKey in results[i].storage) {
        console.log('\t\t' + storageKey + ': ' + results[i].storage[storageKey])
      }
      console.log('\tnonce: ' + BigInt(results[i].nonce))
      console.log('\tbalance: ' + BigInt(results[i].balance))
    }
    cb()
  })
}

export function format(a: any, toZero: boolean = false, isHex: boolean = false): Uint8Array {
  if (a === '') {
    return new Uint8Array()
  }

  if (typeof a === 'string' && isHexPrefixed(a)) {
    a = a.slice(2)
    if (a.length % 2) a = '0' + a
    a = hexToBytes('0x' + a)
  } else if (!isHex) {
    try {
      a = bigIntToBytes(BigInt(a))
    } catch {
      // pass
    }
  } else {
    if (a.length % 2) a = '0' + a
    a = hexToBytes('0x' + a)
  }

  if (toZero && bytesToHex(a) === '0x') {
    a = Uint8Array.from([0])
  }

  return a
}

/**
 * Make a tx using JSON from tests repo
 * @param {Object} txData The tx object from tests repo
 * @param {TxOptions} opts Tx opts that can include an @ethereumjs/common object
 * @returns {FeeMarketEIP1559Transaction | AccessListEIP2930Transaction | LegacyTransaction} Transaction to be passed to VM.runTx function
 */
export function makeTx(
  txData: any,
  opts?: TxOptions
): FeeMarketEIP1559Transaction | AccessListEIP2930Transaction | LegacyTransaction {
  let tx
  if (txData.maxFeePerGas !== undefined) {
    tx = FeeMarketEIP1559Transaction.fromTxData(txData, opts)
  } else if (txData.accessLists !== undefined) {
    tx = AccessListEIP2930Transaction.fromTxData(txData, opts)
  } else {
    tx = LegacyTransaction.fromTxData(txData, opts)
  }

  if (txData.secretKey !== undefined) {
    const privKey = toBytes(txData.secretKey)
    return tx.sign(privKey)
  }

  return tx
}

export async function verifyPostConditions(state: any, testData: any) {
  return new Promise<void>((resolve) => {
    const hashedAccounts: any = {}
    const keyMap: any = {}

    for (const key in testData) {
      const hash = bytesToHex(keccak256(hexToBytes(stripHexPrefix(key))))
      hashedAccounts[hash] = testData[key]
      keyMap[hash] = key
    }

    const queue: any = []

    const stream = state.createReadStream()

    stream.on('data', function (data: any) {
      const rlp = data.value
      const account = Account.fromRlpSerializedAccount(rlp)
      const key = bytesToHex(data.key)
      const testData = hashedAccounts[key]
      const address = keyMap[key]
      delete keyMap[key]

      if (testData !== undefined) {
        const promise = verifyAccountPostConditions(state, address, account, testData)
        queue.push(promise)
      } else {
        assert.ok('invalid account in the trie: ' + <string>key)
      }
    })

    stream.on('end', async function () {
      await Promise.all(queue)
      for (const [_key, address] of Object.entries(keyMap)) {
        assert.ok(`Missing account!: ${address}`)
      }
      resolve()
    })
  })
}

/**
 * verifyAccountPostConditions using JSON from tests repo
 * @param state    DB/trie
 * @param address   Account Address
 * @param account  to verify
 * @param acctData postconditions JSON from tests repo
 */
export function verifyAccountPostConditions(
  state: any,
  address: string,
  account: Account,
  acctData: any
) {
  // return new Promise<void>((resolve) => {
  assert.ok('Account: ' + address)
  if (!equalsBytes(format(account.balance, true), format(acctData.balance, true))) {
    assert.ok(
      `Expected balance of ${bytesToBigInt(format(acctData.balance, true))}, but got ${
        account.balance
      }`
    )
  }
  if (!equalsBytes(format(account.nonce, true), format(acctData.nonce, true))) {
    assert.ok(
      `Expected nonce of ${bytesToBigInt(format(acctData.nonce, true))}, but got ${account.nonce}`
    )
  }

  // validate storage
  const origRoot = state.root()

  const hashedStorage: any = {}
  for (const key in acctData.storage) {
    hashedStorage[bytesToHex(keccak256(setLengthLeft(hexToBytes(key.slice(2)), 32)))] =
      acctData.storage[key]
  }

  state.root(account.storageRoot)
  const rs = state.createReadStream()
  rs.on('data', function (data: any) {
    let key = bytesToHex(data.key)
    const val = bytesToHex(RLP.decode(data.value) as Uint8Array)

    if (key === '0x') {
      key = '0x00'
      acctData.storage['0x00'] = acctData.storage['0x00'] ?? acctData.storage['0x']
      delete acctData.storage['0x']
    }

    if (val !== hashedStorage[key]) {
      assert.ok(
        `Expected storage key 0x${bytesToHex(data.key)} at address ${address} to have value ${
          hashedStorage[key] ?? '0x'
        }, but got ${val}}`
      )
    }
    delete hashedStorage[key]
  })

  rs.on('end', function () {
    for (const key in hashedStorage) {
      if (hashedStorage[key] !== '0x00') {
        assert.ok(`key: ${key} not found in storage at address ${address}`)
      }
    }

    state.root(origRoot)
    // resolve()
    // })
  })
}

/**
 * verifyGas by computing the difference of coinbase account balance
 * @param {Object} results  to verify
 * @param {Object} testData from tests repo
 */
export function verifyGas(results: any, testData: any) {
  const coinbaseAddr = testData.env.currentCoinbase
  const preBal = testData.pre[coinbaseAddr] !== undefined ? testData.pre[coinbaseAddr].balance : 0

  if (testData.post[coinbaseAddr] === undefined) {
    return
  }

  const postBal = BigInt(testData.post[coinbaseAddr].balance)
  const balance = postBal - preBal
  if (balance !== BigInt(0)) {
    const amountSpent = results.gasUsed * testData.transaction.gasPrice
    assert.equal(BigInt(amountSpent), balance, 'correct gas')
  } else {
    assert.equal(results, undefined)
  }
}

export function makeBlockHeader(data: any, opts?: BlockOptions) {
  const {
    currentTimestamp,
    currentGasLimit,
    previousHash,
    currentCoinbase,
    currentDifficulty,
    currentNumber,
    currentBaseFee,
    currentRandom,
    parentGasLimit,
    parentGasUsed,
    parentBaseFee,
  } = data
  const headerData: any = {
    number: currentNumber,
    coinbase: currentCoinbase,
    parentHash: previousHash,
    difficulty: currentDifficulty,
    gasLimit: currentGasLimit,
    timestamp: currentTimestamp,
  }
  if (opts?.common && opts.common.gteHardfork('london')) {
    headerData['baseFeePerGas'] = currentBaseFee
    if (currentBaseFee === undefined) {
      const parentBlockHeader = BlockHeader.fromHeaderData(
        {
          gasLimit: parentGasLimit,
          gasUsed: parentGasUsed,
          baseFeePerGas: parentBaseFee,
        },
        { common: opts.common }
      )
      headerData['baseFeePerGas'] = parentBlockHeader.calcNextBaseFee()
    }
  }
  if (opts?.common && opts.common.gteHardfork('paris')) {
    headerData['mixHash'] = currentRandom
    headerData['difficulty'] = 0
  }
  return BlockHeader.fromHeaderData(headerData, opts)
}

/**
 * makeBlockFromEnv - helper to create a block from the env object in tests repo
 * @param env object from tests repo
 * @param opts block options (optional)
 * @returns the block
 */
export function makeBlockFromEnv(env: any, opts?: BlockOptions): Block {
  const header = makeBlockHeader(env, opts)
  return new Block(header)
}

/**
 * setupPreConditions given JSON testData
 * @param state - the state DB/trie
 * @param testData - JSON from tests repo
 */
export async function setupPreConditions(state: EVMStateManagerInterface, testData: any) {
  await state.checkpoint()
  for (const addressStr of Object.keys(testData.pre)) {
    const { nonce, balance, code, storage } = testData.pre[addressStr]

    const addressBuf = format(addressStr)
    const address = new Address(addressBuf)
    await state.putAccount(address, new Account())

    const codeBuf = format(code)
    const codeHash = keccak256(codeBuf)

    // Set contract storage
    for (const storageKey of Object.keys(storage)) {
      const val = format(storage[storageKey])
      if (['0x', '0x00'].includes(bytesToHex(val))) {
        continue
      }
      const key = setLengthLeft(format(storageKey), 32)
      await state.putContractStorage(address, key, val)
    }

    // Put contract code
    await state.putContractCode(address, codeBuf)

    const storageRoot = (await state.getAccount(address))!.storageRoot

    if (testData.exec?.address === addressStr) {
      testData.root(storageRoot)
    }

    // Put account data
    const account = Account.fromAccountData({ nonce, balance, codeHash, storageRoot })
    await state.putAccount(address, account)
  }
  await state.commit()
}

/**
 * Returns a DAO common which has a different activation block than the default block
 */
export function getDAOCommon(activationBlock: number) {
  // here: get the default fork list of mainnet and only edit the DAO fork block (thus copy the rest of the "default" hardfork settings)
  const defaultDAOCommon = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Dao })
  // retrieve the hard forks list from defaultCommon...
  const forks = defaultDAOCommon.hardforks()
  const editedForks = []
  // explicitly edit the "dao" block number:
  for (const fork of forks) {
    if (fork.name === Hardfork.Dao) {
      editedForks.push({
        name: Hardfork.Dao,
        forkHash: fork.forkHash,
        block: activationBlock,
      })
    } else {
      editedForks.push(fork)
    }
  }
  const DAOCommon = Common.custom(
    {
      hardforks: editedForks,
    },
    {
      baseChain: 'mainnet',
      hardfork: Hardfork.Dao,
    }
  )
  return DAOCommon
}
