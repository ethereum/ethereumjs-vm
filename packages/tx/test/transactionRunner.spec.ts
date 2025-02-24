import { Common, Mainnet } from '@ethereumjs/common'
import { bytesToHex, hexToBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createTxFromRLP } from '../src/transactionFactory.js'

import type { ForkName, ForkNamesMap, OfficialTransactionTestData } from './types.js'
import type { PrefixedHexString } from '@ethereumjs/util'

const testFiles = import.meta.glob('../../ethereum-tests/TransactionTests/**/*.json')

const forkNames: ForkName[] = [
  'Prague',
  'Cancun',
  'Shanghai',
  'Paris',
  'London+3860',
  'London',
  'Berlin',
  'Istanbul',
  'Byzantium',
  'ConstantinopleFix',
  'Constantinople',
  'EIP150',
  'EIP158',
  'Frontier',
  'Homestead',
]

const forkNameMap: ForkNamesMap = {
  Prague: 'prague',
  'London+3860': 'london',
  Cancun: 'cancun',
  Shanghai: 'shanghai',
  Paris: 'paris',
  London: 'london',
  Berlin: 'berlin',
  Istanbul: 'istanbul',
  Byzantium: 'byzantium',
  ConstantinopleFix: 'petersburg',
  Constantinople: 'constantinople',
  EIP150: 'tangerineWhistle',
  EIP158: 'spuriousDragon',
  Frontier: 'chainstart',
  Homestead: 'homestead',
}

const EIPs: Record<string, number[] | undefined> = {
  'London+3860': [3860],
}

const ps = []

for (const [filePath, testDataLoader] of Object.entries(testFiles) as [
  string,
  () => Promise<{ default: { [key: string]: OfficialTransactionTestData } }>,
][]) {
  const match = filePath.match(/TransactionTests\/(.+)/)
  const relativePath = match ? match[1] : filePath
  const p = testDataLoader().then((data) => {
    const fileTestData = data.default
    describe.concurrent(`TransactionTests - ${relativePath}`, async () => {
      for (const innerTestName of Object.keys(fileTestData)) {
        const testData = fileTestData[innerTestName]
        for (const forkName of forkNames) {
          if (testData.result[forkName] === undefined) {
            continue
          }
          it.concurrent(`${innerTestName} - ${forkName}`, async () => {
            await new Promise((resolve) => {
              const forkTestData = testData.result[forkName]
              const shouldBeInvalid = forkTestData.exception !== undefined

              try {
                const rawTx = hexToBytes(testData.txbytes as PrefixedHexString)
                const hardfork = forkNameMap[forkName]
                const common = new Common({ chain: Mainnet, hardfork })
                const activateEIPs = EIPs[forkName]
                if (activateEIPs !== undefined) {
                  common.setEIPs(activateEIPs)
                }
                const tx = createTxFromRLP(rawTx, { common })
                const sender = tx.getSenderAddress().toString()
                const hash = bytesToHex(tx.hash())
                const txIsValid = tx.isValid()
                const senderIsCorrect = forkTestData.sender === sender
                const hashIsCorrect = forkTestData.hash === hash

                const hashAndSenderAreCorrect = senderIsCorrect && hashIsCorrect
                if (shouldBeInvalid) {
                  assert.ok(!txIsValid, `Transaction should be invalid on ${forkName}`)
                } else {
                  assert.ok(
                    hashAndSenderAreCorrect && txIsValid,
                    `Transaction should be valid on ${forkName}`,
                  )
                }
              } catch (e: any) {
                if (shouldBeInvalid) {
                  assert.ok(shouldBeInvalid, `Transaction should be invalid on ${forkName}`)
                } else {
                  assert.fail(`Transaction should be valid on ${forkName}`)
                }
              }
              resolve(null)
            })
          })
        }
      }
    })
  })
  ps.push(p)
}

await Promise.all(ps)
