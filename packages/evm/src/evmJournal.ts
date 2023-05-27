import { Hardfork } from '@ethereumjs/common'
import {
  Address,
  RIPEMD160_ADDRESS_STRING,
  bytesToHex,
  stripHexPrefix,
  toBytes,
} from '@ethereumjs/util'
import { debug as createDebugLogger } from 'debug'

import type { Common, EVMStateManagerInterface } from '@ethereumjs/common'
import type { Account } from '@ethereumjs/util'
import type { Debugger } from 'debug'

type WarmSlots = Set<string>
type AddressString = string
type SlotString = string

type Journal = Map<AddressString, WarmSlots>

/**
 * Journal Diff Item:
 * Index 0: remove warm address
 * Index 1: remove warm slots for this warm address
 * Index 2: remove touched
 */

type JournalDiffItem = [Set<AddressString>, Map<AddressString, Set<SlotString>>, Set<AddressString>]
//AddressString | Map<AddressString, SlotString>
type JournalHeight = number

export class EvmJournal {
  private stateManager: EVMStateManagerInterface
  private common: Common
  private DEBUG: boolean
  private _debug: Debugger

  private journal!: Journal
  private preWarmJournal!: Map<AddressString, Set<SlotString>>
  private touched!: Set<string>
  private journalDiff!: [JournalHeight, JournalDiffItem][]

  private journalHeight: number

  public accessList?: Map<AddressString, Set<SlotString>>

  constructor(stateManager: EVMStateManagerInterface, common: Common) {
    // Skip DEBUG calls unless 'ethjs' included in environmental DEBUG variables
    this.DEBUG = process?.env?.DEBUG?.includes('ethjs') ?? false
    this._debug = createDebugLogger('statemanager:statemanager')

    // TODO maybe call into this.clearJournal
    this.cleanJournal()
    this.journalHeight = 0

    this.stateManager = stateManager
    this.common = common
  }

  reportAccessList() {
    this.accessList = new Map()
  }

  async putAccount(address: Address, account: Account | undefined) {
    this.touchAddress(address)
    return this.stateManager.putAccount(address, account)
  }

  async deleteAccount(address: Address) {
    this.touchAddress(address)
    await this.stateManager.deleteAccount(address)
  }

  private touchAddress(address: Address): void {
    const str = address.toString().slice(2)
    this.touchAccount(str)
  }

  private touchAccount(address: string) {
    if (!this.touched.has(address)) {
      this.touched.add(address)
      const diffArr = this.journalDiff[this.journalDiff.length - 1][1]
      diffArr[2].add(address)
    }
  }
  async commit() {
    this.journalHeight--
    this.journalDiff.push([this.journalHeight, [new Set(), new Map(), new Set()]])
    await this.stateManager.commit()
  }

  async checkpoint() {
    this.journalHeight++
    this.journalDiff.push([this.journalHeight, [new Set(), new Map(), new Set()]])
    await this.stateManager.checkpoint()
  }

  async revert() {
    // Loop backwards over the journal diff and stop if we are at a lower height than current journal height
    // During this process, delete all items.
    // TODO check this logic, if there is this array: height [4,3,4] and we revert height 4, then the final
    // diff arr will be reverted, but it will stop at height 3, so [4,3] are both not reverted..?
    let finalI: number
    for (let i = this.journalDiff.length - 1; i >= 0; i--) {
      finalI = i
      const [height, diff] = this.journalDiff[i]
      if (height < this.journalHeight) {
        break
      }

      const addressSet = diff[0]
      const slotsMap = diff[1]
      const touchedSet = diff[2]

      for (const address of addressSet) {
        // Sanity check, journal should have the item
        if (this.journal.has(address)) {
          this.journal.delete(address)
        }
      }

      for (const [address, delSlots] of slotsMap) {
        // Sanity check, the address SHOULD be in the journal
        if (this.journal.has(address)) {
          const slots = this.journal.get(address)!
          for (const delSlot of delSlots) {
            slots.delete(delSlot)
          }
        }
      }

      for (const address of touchedSet) {
        // Delete the address from the journal
        // NOTE: only delete from warm addresses if it is not pre-warmed
        if (address !== RIPEMD160_ADDRESS_STRING) {
          // If RIPEMD160 is touched, keep it touched.
          // Default behavior for others.
          this.touched.delete(address)
        }
      }
    }

    // the final diffs are reverted and we can dispose those
    this.journalDiff = this.journalDiff.slice(0, finalI! + 1)

    this.journalHeight--

    await this.stateManager.revert()
  }

  public cleanJournal() {
    this.journalHeight = 0
    this.journal = new Map()
    this.preWarmJournal = new Map()
    this.touched = new Set()
    this.journalDiff = [[0, [new Set(), new Map(), new Set()]]]
  }

  /**
   * Removes accounts form the state trie that have been touched,
   * as defined in EIP-161 (https://eips.ethereum.org/EIPS/eip-161).
   * Also cleanups any other internal fields
   */
  async cleanup(): Promise<void> {
    if (this.common.gteHardfork(Hardfork.SpuriousDragon) === true) {
      for (const addressHex of this.touched) {
        const address = new Address(toBytes('0x' + addressHex))
        const empty = await this.stateManager.accountIsEmptyOrNonExistent(address)
        if (empty) {
          await this.deleteAccount(address)
          if (this.DEBUG) {
            this._debug(`Cleanup touched account address=${address} (>= SpuriousDragon)`)
          }
        }
      }
    }
    this.cleanJournal()
    delete this.accessList
  }

  addPreWarmedAddress(addressStr: string) {
    const address = stripHexPrefix(addressStr)
    if (!this.preWarmJournal.has(address)) {
      this.preWarmJournal.set(address, new Set())
    }
    if (this.accessList !== undefined) {
      if (!this.accessList.has(address)) {
        this.accessList.set(address, new Set())
      }
    }
  }

  addPreWarmedSlot(addressStr: string, slotStr: string) {
    const address = stripHexPrefix(addressStr)
    this.addPreWarmedAddress(address)
    const slotsSet = this.preWarmJournal.get(address)!
    const slot = stripHexPrefix(slotStr)
    slotsSet.add(slot)
    if (this.accessList !== undefined) {
      this.accessList.get(address)!.add(slot)
    }
  }

  /**
   * Returns true if the address is warm in the current context
   * @param address - The address (as a Uint8Array) to check
   */
  isWarmedAddress(address: Uint8Array): boolean {
    const addressHex = bytesToHex(address)
    const warm = this.journal.has(addressHex) || this.preWarmJournal.has(addressHex)
    return warm
  }

  /**
   * Add a warm address in the current context
   * @param addressArr - The address (as a Uint8Array) to check
   */
  addWarmedAddress(addressArr: Uint8Array): void {
    const address = bytesToHex(addressArr)
    if (!this.journal.has(address)) {
      this.journal.set(address, new Set())
      const diffArr = this.journalDiff[this.journalDiff.length - 1][1]
      diffArr[0].add(address)
    }
    if (this.accessList !== undefined) {
      if (!this.accessList.has(address)) {
        this.accessList.set(address, new Set())
      }
    }
  }

  /**
   * Returns true if the slot of the address is warm
   * @param address - The address (as a Uint8Array) to check
   * @param slot - The slot (as a Uint8Array) to check
   */
  isWarmedStorage(address: Uint8Array, slot: Uint8Array): boolean {
    const addressHex = bytesToHex(address)
    const slots = this.journal.get(addressHex)
    if (slots === undefined) {
      if (this.preWarmJournal.has(addressHex)) {
        return this.preWarmJournal.get(addressHex)!.has(bytesToHex(slot))
      }
      return false
    }
    if (slots.has(bytesToHex(slot))) {
      return true
    } else if (this.preWarmJournal.has(addressHex)) {
      return this.preWarmJournal.get(addressHex)!.has(bytesToHex(slot))
    }
    return false
  }

  /**
   * Mark the storage slot in the address as warm in the current context
   * @param address - The address (as a Uint8Array) to check
   * @param slot - The slot (as a Uint8Array) to check
   */
  addWarmedStorage(address: Uint8Array, slot: Uint8Array): void {
    const addressHex = bytesToHex(address)
    let slots = this.journal.get(addressHex)
    if (slots === undefined) {
      this.addWarmedAddress(address)
      slots = this.journal.get(addressHex)
    }
    const slotStr = bytesToHex(slot)
    if (!slots!.has(slotStr)) {
      slots!.add(slotStr)
      const diff = this.journalDiff[this.journalDiff.length - 1][1]
      const addressSlotMap = diff[1]
      if (!addressSlotMap.has(addressHex)) {
        addressSlotMap.set(addressHex, new Set())
      }
      const slotsSet = addressSlotMap.get(addressHex)!
      slotsSet.add(slotStr)
    }
    if (this.accessList !== undefined) {
      // Note: in `addWarmedAddress` the address is added to warm addresses
      const addrSet = this.accessList.get(addressHex)!
      addrSet.add(slotStr)
    }
  }
}
