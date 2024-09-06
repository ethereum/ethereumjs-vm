import { Account, Address, MapDB } from '@ethereumjs/util'
// @ts-ignore - package has no types...
import { run, mark, logMem } from 'micro-bmark'
import { DefaultStateManager, FlatStateManager } from '@ethereumjs/statemanager'

import { keccak256 } from 'ethereum-cryptography/keccak.js'

let curr = keccak256(new Uint8Array(32))

export const keys: Uint8Array[] = []

for (let i = 0; i < 5000; curr = keccak256(curr), i++) {
  keys.push(curr)
}

const flatStateManager = new FlatStateManager()
const defaultStateManager = new DefaultStateManager({
  codeCacheOpts: { deactivate: true },
  accountCacheOpts: { deactivate: true },
  storageCacheOpts: { deactivate: true },
})

run(async () => {
  for (const samples of [100, 500, 1000, 5000]) {
    await mark(`FSM putting Checkpointing: ${samples} iterations`, samples, async (i: number) => {
      flatStateManager.checkpoint()
      await flatStateManager.putAccount(new Address(keys[i].slice(0, 20)), new Account())
      await flatStateManager.commit()
    })
  }
  for (const samples of [100, 500, 1000, 5000]) {
    await mark(`DSM putting Checkpointing: ${samples} iterations`, samples, async (i: number) => {
      defaultStateManager.checkpoint()
      await defaultStateManager.putAccount(new Address(keys[i].slice(0, 20)), new Account())
      await defaultStateManager.commit()
    })
  }

  for (const samples of [100, 500, 1000, 5000]) {
    await mark(`FSM getting Checkpointing: ${samples} iterations`, samples, async (i: number) => {
      flatStateManager.checkpoint()
      await flatStateManager.getAccount(new Address(keys[i].slice(0, 20)))
      await flatStateManager.commit()
    })
  }
  for (const samples of [100, 500, 1000, 5000]) {
    await mark(`DSM getting Checkpointing: ${samples} iterations`, samples, async (i: number) => {
      defaultStateManager.checkpoint()
      await defaultStateManager.getAccount(new Address(keys[i].slice(0, 20)))
      await defaultStateManager.commit()
    })
  }
  logMem()
})
