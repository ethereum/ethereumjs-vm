import { createAccount, createAddressFromPrivateKey, randomBytes } from '@ethereumjs/util'
import { createVerkleTree } from '@ethereumjs/verkle'
import { assert, describe, it } from 'vitest'

import { StatefulVerkleStateManager } from '../src/statefulVerkleStateManager.js'

describe('Verkle Tree API tests', () => {
  it('should get an account from the trie', async () => {
    const trie = await createVerkleTree()
    const sm = new StatefulVerkleStateManager({ trie, verkleCrypto: trie['verkleCrypto'] })
    const address = createAddressFromPrivateKey(randomBytes(32))
    const account = createAccount({ nonce: 3n, balance: 0xfffn })
    await sm.putAccount(address, account)
    const retrievedAccount = await sm.getAccount(address)
    assert.equal(retrievedAccount?.balance, account.balance)
  })
})
