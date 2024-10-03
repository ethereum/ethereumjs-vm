import { createBlock, genRequestsTrieRoot } from '@ethereumjs/block'
import { ConsensusType, Hardfork } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { StatelessVerkleStateManager, verifyVerkleStateProof } from '@ethereumjs/statemanager'
import { MerklePatriciaTrie } from '@ethereumjs/trie'
import { TransactionType } from '@ethereumjs/tx'
import {
  Account,
  Address,
  BIGINT_0,
  BIGINT_1,
  BIGINT_8,
  GWEI_TO_WEI,
  KECCAK256_RLP,
  bigIntToAddressBytes,
  bigIntToBytes,
  bytesToHex,
  concatBytes,
  createAddressFromString,
  equalsBytes,
  getVerkleTreeIndicesForStorageSlot,
  hexToBytes,
  intToBytes,
  setLengthLeft,
  short,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import debugDefault from 'debug'

import { Bloom } from './bloom/index.js'
import { emitEVMProfile } from './emitEVMProfile.js'
import { accumulateRequests } from './requests.js'

import { runTx } from './index.js'

import type {
  AfterBlockEvent,
  ApplyBlockResult,
  PostByzantiumTxReceipt,
  PreByzantiumTxReceipt,
  RunBlockOpts,
  RunBlockResult,
  RunTxResult,
  TxReceipt,
} from './types.js'
import type { VM } from './vm.js'
import type { Block } from '@ethereumjs/block'
import type { Common } from '@ethereumjs/common'
import type { EVM, EVMInterface } from '@ethereumjs/evm'
import type { CLRequest, CLRequestType, PrefixedHexString } from '@ethereumjs/util'

const debug = debugDefault('vm:block')

const parentBeaconBlockRootAddress = createAddressFromString(
  '0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02',
)

let enableProfiler = false
const stateRootCPLabel = 'New state root, DAO HF, checkpoints, block validation'
const processTxsLabel = 'Tx processing [ use per-tx profiler for more details ]'
const withdrawalsRewardsCommitLabel = 'Withdrawals, Rewards, EVM journal commit'
const entireBlockLabel = 'Entire block'

/**
 * Processes the `block` running all of the transactions it contains and updating the miner's account
 *
 * vm method modifies the state. If `generate` is `true`, the state modifications will be
 * reverted if an exception is raised. If it's `false`, it won't revert if the block's header is
 * invalid. If an error is thrown from an event handler, the state may or may not be reverted.
 *
 * @param {VM} vm
 * @param {RunBlockOpts} opts - Default values for options:
 *  - `generate`: false
 */
export async function runBlock(vm: VM, opts: RunBlockOpts): Promise<RunBlockResult> {
  if (vm['_opts'].profilerOpts?.reportAfterBlock === true) {
    enableProfiler = true
    // eslint-disable-next-line no-console
    console.time(entireBlockLabel)
  }

  const stateManager = vm.stateManager

  const { root } = opts
  const clearCache = opts.clearCache ?? true
  const setHardfork = opts.setHardfork ?? false
  let { block } = opts
  const generateFields = opts.generate === true

  if (enableProfiler) {
    const title = `Profiler run - Block ${block.header.number} (${bytesToHex(block.hash())} with ${
      block.transactions.length
    } txs`
    // eslint-disable-next-line no-console
    console.log(title)
    // eslint-disable-next-line no-console
    console.time(stateRootCPLabel)
  }

  /**
   * The `beforeBlock` event.
   *
   * @event Event: beforeBlock
   * @type {Object}
   * @property {Block} block emits the block that is about to be processed
   */
  await vm._emit('beforeBlock', block)

  if (setHardfork !== false || vm['_setHardfork'] !== false) {
    const setHardforkUsed = setHardfork ?? vm['_setHardfork']
    if (setHardforkUsed === true) {
      vm.common.setHardforkBy({
        blockNumber: block.header.number,
        timestamp: block.header.timestamp,
      })
    }
  }

  if (vm.DEBUG) {
    debug('-'.repeat(100))
    debug(
      `Running block hash=${bytesToHex(block.hash())} number=${
        block.header.number
      } hardfork=${vm.common.hardfork()}`,
    )
  }

  // Set state root if provided
  if (root) {
    if (vm.DEBUG) {
      debug(`Set provided state root ${bytesToHex(root)} clearCache=${clearCache}`)
    }
    await stateManager.setStateRoot(root, clearCache)
  }

  if (vm.common.isActivatedEIP(6800)) {
    if (typeof stateManager.initVerkleExecutionWitness !== 'function') {
      throw Error(`StatelessVerkleStateManager needed for execution of verkle blocks`)
    }

    if (vm.DEBUG) {
      debug(`Initializing StatelessVerkleStateManager executionWitness`)
    }
    if (clearCache) {
      stateManager.clearCaches()
    }

    // Update the stateRoot cache
    await stateManager.setStateRoot(block.header.stateRoot)

    // Populate the execution witness
    stateManager.initVerkleExecutionWitness!(block.header.number, block.executionWitness)

    if (
      stateManager instanceof StatelessVerkleStateManager &&
      verifyVerkleStateProof(stateManager) === false
    ) {
      throw Error(`Verkle proof verification failed`)
    }

    if (vm.DEBUG) {
      debug(`Verkle proof verification succeeded`)
    }
  } else {
    if (typeof stateManager.initVerkleExecutionWitness === 'function') {
      throw Error(`StatelessVerkleStateManager can't execute merkle blocks`)
    }
  }

  // check for DAO support and if we should apply the DAO fork
  if (
    vm.common.hardforkIsActiveOnBlock(Hardfork.Dao, block.header.number) &&
    block.header.number === vm.common.hardforkBlock(Hardfork.Dao)!
  ) {
    if (vm.DEBUG) {
      debug(`Apply DAO hardfork`)
    }

    await vm.evm.journal.checkpoint()
    await _applyDAOHardfork(vm.evm)
    await vm.evm.journal.commit()
  }

  // Checkpoint state
  await vm.evm.journal.checkpoint()
  if (vm.DEBUG) {
    debug(`block checkpoint`)
  }

  let result: ApplyBlockResult

  try {
    result = await applyBlock(vm, block, opts)
    if (vm.DEBUG) {
      debug(
        `Received block results gasUsed=${result.gasUsed} bloom=${short(result.bloom.bitvector)} (${
          result.bloom.bitvector.length
        } bytes) receiptsRoot=${bytesToHex(result.receiptsRoot)} receipts=${
          result.receipts.length
        } txResults=${result.results.length}`,
      )
    }
  } catch (err) {
    await vm.evm.journal.revert()
    if (vm.DEBUG) {
      debug(`block checkpoint reverted`)
    }
    if (enableProfiler) {
      // eslint-disable-next-line no-console
      console.timeEnd(withdrawalsRewardsCommitLabel)
    }
    throw err
  }

  let requestsRoot: Uint8Array | undefined
  let requests: CLRequest<CLRequestType>[] | undefined
  if (block.common.isActivatedEIP(7685)) {
    requests = await accumulateRequests(vm, result.results)
    requestsRoot = await genRequestsTrieRoot(requests)
  }

  // Persist state
  await vm.evm.journal.commit()
  if (vm.DEBUG) {
    debug(`block checkpoint committed`)
  }

  const stateRoot = await stateManager.getStateRoot()

  // Given the generate option, either set resulting header
  // values to the current block, or validate the resulting
  // header values against the current block.
  if (generateFields) {
    const bloom = result.bloom.bitvector
    const gasUsed = result.gasUsed
    const receiptTrie = result.receiptsRoot
    const transactionsTrie = await _genTxTrie(block)
    const generatedFields = {
      stateRoot,
      bloom,
      gasUsed,
      receiptTrie,
      transactionsTrie,
      requestsRoot,
    }
    const blockData = {
      ...block,
      requests,
      header: { ...block.header, ...generatedFields },
    }
    block = createBlock(blockData, { common: vm.common })
  } else {
    if (vm.common.isActivatedEIP(7685)) {
      const valid = await block.requestsTrieIsValid(requests)
      if (!valid) {
        const validRoot = await genRequestsTrieRoot(requests!)
        if (vm.DEBUG)
          debug(
            `Invalid requestsRoot received=${bytesToHex(
              block.header.requestsRoot!,
            )} expected=${bytesToHex(validRoot)}`,
          )
        const msg = _errorMsg('invalid requestsRoot', vm, block)
        throw new Error(msg)
      }
    }
    if (!vm.common.isActivatedEIP(6800)) {
      // Only validate the following headers if verkle blocks aren't activated
      if (equalsBytes(result.receiptsRoot, block.header.receiptTrie) === false) {
        if (vm.DEBUG) {
          debug(
            `Invalid receiptTrie received=${bytesToHex(result.receiptsRoot)} expected=${bytesToHex(
              block.header.receiptTrie,
            )}`,
          )
        }
        const msg = _errorMsg('invalid receiptTrie', vm, block)
        throw new Error(msg)
      }
      if (!(equalsBytes(result.bloom.bitvector, block.header.logsBloom) === true)) {
        if (vm.DEBUG) {
          debug(
            `Invalid bloom received=${bytesToHex(result.bloom.bitvector)} expected=${bytesToHex(
              block.header.logsBloom,
            )}`,
          )
        }
        const msg = _errorMsg('invalid bloom', vm, block)
        throw new Error(msg)
      }
      if (result.gasUsed !== block.header.gasUsed) {
        if (vm.DEBUG) {
          debug(`Invalid gasUsed received=${result.gasUsed} expected=${block.header.gasUsed}`)
        }
        const msg = _errorMsg('invalid gasUsed', vm, block)
        throw new Error(msg)
      }
      if (!(equalsBytes(stateRoot, block.header.stateRoot) === true)) {
        if (vm.DEBUG) {
          debug(
            `Invalid stateRoot received=${bytesToHex(stateRoot)} expected=${bytesToHex(
              block.header.stateRoot,
            )}`,
          )
        }
        const msg = _errorMsg(
          `invalid block stateRoot, got: ${bytesToHex(stateRoot)}, want: ${bytesToHex(
            block.header.stateRoot,
          )}`,
          vm,
          block,
        )
        throw new Error(msg)
      }
    } else if (vm.common.isActivatedEIP(6800)) {
      // If verkle is activated, only validate the post-state
      if (vm['_opts'].stateManager!.verifyPostState!() === false) {
        throw new Error(`Verkle post state verification failed on block ${block.header.number}`)
      }
      debug(`Verkle post state verification succeeded`)
    }
  }

  if (enableProfiler) {
    // eslint-disable-next-line no-console
    console.timeEnd(withdrawalsRewardsCommitLabel)
  }

  const results: RunBlockResult = {
    receipts: result.receipts,
    logsBloom: result.bloom.bitvector,
    results: result.results,
    stateRoot,
    gasUsed: result.gasUsed,
    receiptsRoot: result.receiptsRoot,
    preimages: result.preimages,
    requestsRoot,
    requests,
  }

  const afterBlockEvent: AfterBlockEvent = { ...results, block }

  /**
   * The `afterBlock` event
   *
   * @event Event: afterBlock
   * @type {AfterBlockEvent}
   * @property {AfterBlockEvent} result emits the results of processing a block
   */
  await vm._emit('afterBlock', afterBlockEvent)
  if (vm.DEBUG) {
    debug(
      `Running block finished hash=${bytesToHex(block.hash())} number=${
        block.header.number
      } hardfork=${vm.common.hardfork()}`,
    )
  }

  if (enableProfiler) {
    // eslint-disable-next-line no-console
    console.timeEnd(entireBlockLabel)
    const logs = (<EVM>vm.evm).getPerformanceLogs()
    if (logs.precompiles.length === 0 && logs.opcodes.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No block txs with precompile or opcode execution.')
    }

    emitEVMProfile(logs.precompiles, 'Precompile performance')
    emitEVMProfile(logs.opcodes, 'Opcodes performance')
    ;(<EVM>vm.evm).clearPerformanceLogs()
  }

  return results
}

/**
 * Validates and applies a block, computing the results of
 * applying its transactions. vm method doesn't modify the
 * block itself. It computes the block rewards and puts
 * them on state (but doesn't persist the changes).
 * @param {Block} block
 * @param {RunBlockOpts} opts
 */
async function applyBlock(vm: VM, block: Block, opts: RunBlockOpts): Promise<ApplyBlockResult> {
  // Validate block
  if (opts.skipBlockValidation !== true) {
    if (block.header.gasLimit >= BigInt('0x8000000000000000')) {
      const msg = _errorMsg('Invalid block with gas limit greater than (2^63 - 1)', vm, block)
      throw new Error(msg)
    } else {
      if (vm.DEBUG) {
        debug(`Validate block`)
      }
      // TODO: decide what block validation method is appropriate here
      if (opts.skipHeaderValidation !== true) {
        if (typeof (<any>vm.blockchain).validateHeader === 'function') {
          await (<any>vm.blockchain).validateHeader(block.header)
        } else {
          throw new Error('cannot validate header: blockchain has no `validateHeader` method')
        }
      }
      await block.validateData()
    }
  }
  if (vm.common.isActivatedEIP(4788)) {
    if (vm.DEBUG) {
      debug(`accumulate parentBeaconBlockRoot`)
    }
    await accumulateParentBeaconBlockRoot(
      vm,
      block.header.parentBeaconBlockRoot!,
      block.header.timestamp,
    )
  }
  if (vm.common.isActivatedEIP(2935)) {
    if (vm.DEBUG) {
      debug(`accumulate parentBlockHash `)
    }

    await accumulateParentBlockHash(vm, block.header.number, block.header.parentHash)
  }

  if (enableProfiler) {
    // eslint-disable-next-line no-console
    console.timeEnd(stateRootCPLabel)
  }

  // Apply transactions
  if (vm.DEBUG) {
    debug(`Apply transactions`)
  }
  const blockResults = await applyTransactions(vm, block, opts)

  if (enableProfiler) {
    // eslint-disable-next-line no-console
    console.time(withdrawalsRewardsCommitLabel)
  }

  // Add txResult preimages to the blockResults preimages
  // Also add the coinbase preimage

  if (opts.reportPreimages === true) {
    if (vm.evm.stateManager.getAppliedKey === undefined) {
      throw new Error(
        'applyBlock: evm.stateManager.getAppliedKey can not be undefined if reportPreimages is true',
      )
    }
    blockResults.preimages.set(
      bytesToHex(vm.evm.stateManager.getAppliedKey(block.header.coinbase.toBytes())),
      block.header.coinbase.toBytes(),
    )
    for (const txResult of blockResults.results) {
      if (txResult.preimages !== undefined) {
        for (const [key, preimage] of txResult.preimages) {
          blockResults.preimages.set(key, preimage)
        }
      }
    }
  }

  if (vm.common.isActivatedEIP(4895)) {
    if (opts.reportPreimages === true) vm.evm.journal.startReportingPreimages!()
    await assignWithdrawals(vm, block)
    if (opts.reportPreimages === true && vm.evm.journal.preimages !== undefined) {
      for (const [key, preimage] of vm.evm.journal.preimages) {
        blockResults.preimages.set(key, preimage)
      }
    }
    await vm.evm.journal.cleanup()
  }
  // Pay ommers and miners
  if (block.common.consensusType() === ConsensusType.ProofOfWork) {
    await assignBlockRewards(vm, block)
  }

  return blockResults
}

/**
 * vm method runs the logic of EIP 2935 (save blockhashes to state)
 * It will put the `parentHash` of the block to the storage slot of `block.number - 1` of the history storage contract.
 * vm contract is used to retrieve BLOCKHASHes in EVM if EIP 2935 is activated.
 * In case that the previous block of `block` is pre-EIP-2935 (so we are on the EIP 2935 fork block), additionally
 * also add the currently available past blockhashes which are available by BLOCKHASH (so, the past 256 block hashes)
 * @param vm The VM to run on
 * @param block The current block to save the parent block hash of
 */
export async function accumulateParentBlockHash(
  vm: VM,
  currentBlockNumber: bigint,
  parentHash: Uint8Array,
) {
  if (!vm.common.isActivatedEIP(2935)) {
    throw new Error('Cannot call `accumulateParentBlockHash`: EIP 2935 is not active')
  }
  const historyAddress = new Address(bigIntToAddressBytes(vm.common.param('historyStorageAddress')))
  const historyServeWindow = vm.common.param('historyServeWindow')

  // getAccount with historyAddress will throw error as witnesses are not bundled
  // but we need to put account so as to query later for slot
  const code = await vm.stateManager.getCode(historyAddress)

  if (code.length === 0) {
    // Exit early, system contract has no code so no storage is written
    // TODO: verify with Gabriel that this is fine regarding verkle (should we put an empty account?)
    return
  }

  async function putBlockHash(vm: VM, hash: Uint8Array, number: bigint) {
    // ringKey is the key the hash is actually put in (it is a ring buffer)
    const ringKey = number % historyServeWindow

    // generate access witness
    if (vm.common.isActivatedEIP(6800)) {
      const { treeIndex, subIndex } = getVerkleTreeIndicesForStorageSlot(ringKey)
      // just create access witnesses without charging for the gas
      vm.stateManager.accessWitness!.touchAddressOnWriteAndComputeGas(
        historyAddress,
        treeIndex,
        subIndex,
      )
    }
    const key = setLengthLeft(bigIntToBytes(ringKey), 32)
    await vm.stateManager.putStorage(historyAddress, key, hash)
  }
  await putBlockHash(vm, parentHash, currentBlockNumber - BIGINT_1)

  // do cleanup if the code was not deployed
  await vm.evm.journal.cleanup()
}

export async function accumulateParentBeaconBlockRoot(vm: VM, root: Uint8Array, timestamp: bigint) {
  if (!vm.common.isActivatedEIP(4788)) {
    throw new Error('Cannot call `accumulateParentBeaconBlockRoot`: EIP 4788 is not active')
  }
  // Save the parentBeaconBlockRoot to the beaconroot stateful precompile ring buffers
  const historicalRootsLength = BigInt(vm.common.param('historicalRootsLength'))
  const timestampIndex = timestamp % historicalRootsLength
  const timestampExtended = timestampIndex + historicalRootsLength

  /**
   * Note: (by Gabriel)
   * Get account will throw an error in stateless execution b/c witnesses are not bundled
   * But we do need an account so we are able to put the storage
   */
  const code = await vm.stateManager.getCode(parentBeaconBlockRootAddress)

  if (code.length === 0) {
    // Exit early, system contract has no code so no storage is written
    // TODO: verify with Gabriel that this is fine regarding verkle (should we put an empty account?)
    return
  }

  await vm.stateManager.putStorage(
    parentBeaconBlockRootAddress,
    setLengthLeft(bigIntToBytes(timestampIndex), 32),
    bigIntToBytes(timestamp),
  )
  await vm.stateManager.putStorage(
    parentBeaconBlockRootAddress,
    setLengthLeft(bigIntToBytes(timestampExtended), 32),
    root,
  )

  // do cleanup if the code was not deployed
  await vm.evm.journal.cleanup()
}

/**
 * Applies the transactions in a block, computing the receipts
 * as well as gas usage and some relevant data. vm method is
 * side-effect free (it doesn't modify the block nor the state).
 * @param {Block} block
 * @param {RunBlockOpts} opts
 */
async function applyTransactions(vm: VM, block: Block, opts: RunBlockOpts) {
  if (enableProfiler) {
    // eslint-disable-next-line no-console
    console.time(processTxsLabel)
  }

  const bloom = new Bloom(undefined, vm.common)
  // the total amount of gas used processing these transactions
  let gasUsed = BIGINT_0

  let receiptTrie: MerklePatriciaTrie | undefined = undefined
  if (block.transactions.length !== 0) {
    receiptTrie = new MerklePatriciaTrie({ common: vm.common })
  }

  const receipts: TxReceipt[] = []
  const txResults: RunTxResult[] = []

  /*
   * Process transactions
   */
  for (let txIdx = 0; txIdx < block.transactions.length; txIdx++) {
    const tx = block.transactions[txIdx]

    let maxGasLimit
    if (vm.common.isActivatedEIP(1559)) {
      maxGasLimit = block.header.gasLimit * vm.common.param('elasticityMultiplier')
    } else {
      maxGasLimit = block.header.gasLimit
    }
    const gasLimitIsHigherThanBlock = maxGasLimit < tx.gasLimit + gasUsed
    if (gasLimitIsHigherThanBlock) {
      const msg = _errorMsg('tx has a higher gas limit than the block', vm, block)
      throw new Error(msg)
    }

    // Run the tx through the VM
    const { skipBalance, skipNonce, skipHardForkValidation, reportPreimages } = opts

    const txRes = await runTx(vm, {
      tx,
      block,
      skipBalance,
      skipNonce,
      skipHardForkValidation,
      blockGasUsed: gasUsed,
      reportPreimages,
    })
    txResults.push(txRes)
    if (vm.DEBUG) {
      debug('-'.repeat(100))
    }

    // Add to total block gas usage
    gasUsed += txRes.totalGasSpent
    if (vm.DEBUG) {
      debug(`Add tx gas used (${txRes.totalGasSpent}) to total block gas usage (-> ${gasUsed})`)
    }

    // Combine blooms via bitwise OR
    bloom.or(txRes.bloom)

    // Add receipt to trie to later calculate receipt root
    receipts.push(txRes.receipt)
    const encodedReceipt = encodeReceipt(txRes.receipt, tx.type)
    await receiptTrie!.put(RLP.encode(txIdx), encodedReceipt)
  }

  if (enableProfiler) {
    // eslint-disable-next-line no-console
    console.timeEnd(processTxsLabel)
  }

  const receiptsRoot = receiptTrie !== undefined ? receiptTrie.root() : KECCAK256_RLP

  return {
    bloom,
    gasUsed,
    preimages: new Map<PrefixedHexString, Uint8Array>(),
    receiptsRoot,
    receipts,
    results: txResults,
  }
}

async function assignWithdrawals(vm: VM, block: Block): Promise<void> {
  const withdrawals = block.withdrawals!
  for (const withdrawal of withdrawals) {
    const { address, amount } = withdrawal
    // Withdrawal amount is represented in Gwei so needs to be
    // converted to wei
    // Note: event if amount is 0, still reward the account
    // such that the account is touched and marked for cleanup if it is empty
    await rewardAccount(vm.evm, address, amount * GWEI_TO_WEI, vm.common)
  }
}

/**
 * Calculates block rewards for miner and ommers and puts
 * the updated balances of their accounts to state.
 */
async function assignBlockRewards(vm: VM, block: Block): Promise<void> {
  if (vm.DEBUG) {
    debug(`Assign block rewards`)
  }
  const minerReward = vm.common.param('minerReward')
  const ommers = block.uncleHeaders
  // Reward ommers
  for (const ommer of ommers) {
    const reward = calculateOmmerReward(ommer.number, block.header.number, minerReward)
    const account = await rewardAccount(vm.evm, ommer.coinbase, reward, vm.common)
    if (vm.DEBUG) {
      debug(`Add uncle reward ${reward} to account ${ommer.coinbase} (-> ${account.balance})`)
    }
  }
  // Reward miner
  const reward = calculateMinerReward(minerReward, ommers.length)
  const account = await rewardAccount(vm.evm, block.header.coinbase, reward, vm.common)
  if (vm.DEBUG) {
    debug(`Add miner reward ${reward} to account ${block.header.coinbase} (-> ${account.balance})`)
  }
}

function calculateOmmerReward(
  ommerBlockNumber: bigint,
  blockNumber: bigint,
  minerReward: bigint,
): bigint {
  const heightDiff = blockNumber - ommerBlockNumber
  let reward = ((BIGINT_8 - heightDiff) * minerReward) / BIGINT_8
  if (reward < BIGINT_0) {
    reward = BIGINT_0
  }
  return reward
}

export function calculateMinerReward(minerReward: bigint, ommersNum: number): bigint {
  // calculate nibling reward
  const niblingReward = minerReward / BigInt(32)
  const totalNiblingReward = niblingReward * BigInt(ommersNum)
  const reward = minerReward + totalNiblingReward
  return reward
}

export async function rewardAccount(
  evm: EVMInterface,
  address: Address,
  reward: bigint,
  common?: Common,
): Promise<Account> {
  let account = await evm.stateManager.getAccount(address)
  if (account === undefined) {
    if (common?.isActivatedEIP(6800) === true) {
      evm.stateManager.accessWitness!.touchAndChargeProofOfAbsence(address)
    }
    account = new Account()
  }
  account.balance += reward
  await evm.journal.putAccount(address, account)

  if (common?.isActivatedEIP(6800) === true) {
    // use vm utility to build access but the computed gas is not charged and hence free
    evm.stateManager.accessWitness!.touchTxTargetAndComputeGas(address, { sendsValue: true })
  }
  return account
}

/**
 * Returns the encoded tx receipt.
 */
export function encodeReceipt(receipt: TxReceipt, txType: TransactionType) {
  const encoded = RLP.encode([
    (receipt as PreByzantiumTxReceipt).stateRoot ??
      ((receipt as PostByzantiumTxReceipt).status === 0 ? Uint8Array.from([]) : hexToBytes('0x01')),
    bigIntToBytes(receipt.cumulativeBlockGasUsed),
    receipt.bitvector,
    receipt.logs,
  ])

  if (txType === TransactionType.Legacy) {
    return encoded
  }

  // Serialize receipt according to EIP-2718:
  // `typed-receipt = tx-type || receipt-data`
  return concatBytes(intToBytes(txType), encoded)
}

/**
 * Apply the DAO fork changes to the VM
 */
async function _applyDAOHardfork(evm: EVMInterface) {
  const state = evm.stateManager

  /* DAO account list */
  const DAOAccountList = DAOConfig.DAOAccounts
  const DAORefundContract = DAOConfig.DAORefundContract

  const DAORefundContractAddress = new Address(unprefixedHexToBytes(DAORefundContract))
  if ((await state.getAccount(DAORefundContractAddress)) === undefined) {
    await evm.journal.putAccount(DAORefundContractAddress, new Account())
  }
  let DAORefundAccount = await state.getAccount(DAORefundContractAddress)
  if (DAORefundAccount === undefined) {
    DAORefundAccount = new Account()
  }

  for (const addr of DAOAccountList) {
    // retrieve the account and add it to the DAO's Refund accounts' balance.
    const address = new Address(unprefixedHexToBytes(addr))
    let account = await state.getAccount(address)
    if (account === undefined) {
      account = new Account()
    }
    DAORefundAccount.balance += account.balance
    // clear the accounts' balance
    account.balance = BIGINT_0
    await evm.journal.putAccount(address, account)
  }

  // finally, put the Refund Account
  await evm.journal.putAccount(DAORefundContractAddress, DAORefundAccount)
}

async function _genTxTrie(block: Block) {
  if (block.transactions.length === 0) {
    return KECCAK256_RLP
  }
  const trie = new MerklePatriciaTrie({ common: block.common })
  for (const [i, tx] of block.transactions.entries()) {
    await trie.put(RLP.encode(i), tx.serialize())
  }
  return trie.root()
}

/**
 * Internal helper function to create an annotated error message
 *
 * @param msg Base error message
 * @hidden
 */
function _errorMsg(msg: string, vm: VM, block: Block) {
  const blockErrorStr = 'errorStr' in block ? block.errorStr() : 'block'

  const errorMsg = `${msg} (${vm.errorStr()} -> ${blockErrorStr})`
  return errorMsg
}

const DAOConfig = {
  DAOAccounts: [
    'd4fe7bc31cedb7bfb8a345f31e668033056b2728',
    'b3fb0e5aba0e20e5c49d252dfd30e102b171a425',
    '2c19c7f9ae8b751e37aeb2d93a699722395ae18f',
    'ecd135fa4f61a655311e86238c92adcd779555d2',
    '1975bd06d486162d5dc297798dfc41edd5d160a7',
    'a3acf3a1e16b1d7c315e23510fdd7847b48234f6',
    '319f70bab6845585f412ec7724b744fec6095c85',
    '06706dd3f2c9abf0a21ddcc6941d9b86f0596936',
    '5c8536898fbb74fc7445814902fd08422eac56d0',
    '6966ab0d485353095148a2155858910e0965b6f9',
    '779543a0491a837ca36ce8c635d6154e3c4911a6',
    '2a5ed960395e2a49b1c758cef4aa15213cfd874c',
    '5c6e67ccd5849c0d29219c4f95f1a7a93b3f5dc5',
    '9c50426be05db97f5d64fc54bf89eff947f0a321',
    '200450f06520bdd6c527622a273333384d870efb',
    'be8539bfe837b67d1282b2b1d61c3f723966f049',
    '6b0c4d41ba9ab8d8cfb5d379c69a612f2ced8ecb',
    'f1385fb24aad0cd7432824085e42aff90886fef5',
    'd1ac8b1ef1b69ff51d1d401a476e7e612414f091',
    '8163e7fb499e90f8544ea62bbf80d21cd26d9efd',
    '51e0ddd9998364a2eb38588679f0d2c42653e4a6',
    '627a0a960c079c21c34f7612d5d230e01b4ad4c7',
    'f0b1aa0eb660754448a7937c022e30aa692fe0c5',
    '24c4d950dfd4dd1902bbed3508144a54542bba94',
    '9f27daea7aca0aa0446220b98d028715e3bc803d',
    'a5dc5acd6a7968a4554d89d65e59b7fd3bff0f90',
    'd9aef3a1e38a39c16b31d1ace71bca8ef58d315b',
    '63ed5a272de2f6d968408b4acb9024f4cc208ebf',
    '6f6704e5a10332af6672e50b3d9754dc460dfa4d',
    '77ca7b50b6cd7e2f3fa008e24ab793fd56cb15f6',
    '492ea3bb0f3315521c31f273e565b868fc090f17',
    '0ff30d6de14a8224aa97b78aea5388d1c51c1f00',
    '9ea779f907f0b315b364b0cfc39a0fde5b02a416',
    'ceaeb481747ca6c540a000c1f3641f8cef161fa7',
    'cc34673c6c40e791051898567a1222daf90be287',
    '579a80d909f346fbfb1189493f521d7f48d52238',
    'e308bd1ac5fda103967359b2712dd89deffb7973',
    '4cb31628079fb14e4bc3cd5e30c2f7489b00960c',
    'ac1ecab32727358dba8962a0f3b261731aad9723',
    '4fd6ace747f06ece9c49699c7cabc62d02211f75',
    '440c59b325d2997a134c2c7c60a8c61611212bad',
    '4486a3d68fac6967006d7a517b889fd3f98c102b',
    '9c15b54878ba618f494b38f0ae7443db6af648ba',
    '27b137a85656544b1ccb5a0f2e561a5703c6a68f',
    '21c7fdb9ed8d291d79ffd82eb2c4356ec0d81241',
    '23b75c2f6791eef49c69684db4c6c1f93bf49a50',
    '1ca6abd14d30affe533b24d7a21bff4c2d5e1f3b',
    'b9637156d330c0d605a791f1c31ba5890582fe1c',
    '6131c42fa982e56929107413a9d526fd99405560',
    '1591fc0f688c81fbeb17f5426a162a7024d430c2',
    '542a9515200d14b68e934e9830d91645a980dd7a',
    'c4bbd073882dd2add2424cf47d35213405b01324',
    '782495b7b3355efb2833d56ecb34dc22ad7dfcc4',
    '58b95c9a9d5d26825e70a82b6adb139d3fd829eb',
    '3ba4d81db016dc2890c81f3acec2454bff5aada5',
    'b52042c8ca3f8aa246fa79c3feaa3d959347c0ab',
    'e4ae1efdfc53b73893af49113d8694a057b9c0d1',
    '3c02a7bc0391e86d91b7d144e61c2c01a25a79c5',
    '0737a6b837f97f46ebade41b9bc3e1c509c85c53',
    '97f43a37f595ab5dd318fb46e7a155eae057317a',
    '52c5317c848ba20c7504cb2c8052abd1fde29d03',
    '4863226780fe7c0356454236d3b1c8792785748d',
    '5d2b2e6fcbe3b11d26b525e085ff818dae332479',
    '5f9f3392e9f62f63b8eac0beb55541fc8627f42c',
    '057b56736d32b86616a10f619859c6cd6f59092a',
    '9aa008f65de0b923a2a4f02012ad034a5e2e2192',
    '304a554a310c7e546dfe434669c62820b7d83490',
    '914d1b8b43e92723e64fd0a06f5bdb8dd9b10c79',
    '4deb0033bb26bc534b197e61d19e0733e5679784',
    '07f5c1e1bc2c93e0402f23341973a0e043f7bf8a',
    '35a051a0010aba705c9008d7a7eff6fb88f6ea7b',
    '4fa802324e929786dbda3b8820dc7834e9134a2a',
    '9da397b9e80755301a3b32173283a91c0ef6c87e',
    '8d9edb3054ce5c5774a420ac37ebae0ac02343c6',
    '0101f3be8ebb4bbd39a2e3b9a3639d4259832fd9',
    '5dc28b15dffed94048d73806ce4b7a4612a1d48f',
    'bcf899e6c7d9d5a215ab1e3444c86806fa854c76',
    '12e626b0eebfe86a56d633b9864e389b45dcb260',
    'a2f1ccba9395d7fcb155bba8bc92db9bafaeade7',
    'ec8e57756626fdc07c63ad2eafbd28d08e7b0ca5',
    'd164b088bd9108b60d0ca3751da4bceb207b0782',
    '6231b6d0d5e77fe001c2a460bd9584fee60d409b',
    '1cba23d343a983e9b5cfd19496b9a9701ada385f',
    'a82f360a8d3455c5c41366975bde739c37bfeb8a',
    '9fcd2deaff372a39cc679d5c5e4de7bafb0b1339',
    '005f5cee7a43331d5a3d3eec71305925a62f34b6',
    '0e0da70933f4c7849fc0d203f5d1d43b9ae4532d',
    'd131637d5275fd1a68a3200f4ad25c71a2a9522e',
    'bc07118b9ac290e4622f5e77a0853539789effbe',
    '47e7aa56d6bdf3f36be34619660de61275420af8',
    'acd87e28b0c9d1254e868b81cba4cc20d9a32225',
    'adf80daec7ba8dcf15392f1ac611fff65d94f880',
    '5524c55fb03cf21f549444ccbecb664d0acad706',
    '40b803a9abce16f50f36a77ba41180eb90023925',
    'fe24cdd8648121a43a7c86d289be4dd2951ed49f',
    '17802f43a0137c506ba92291391a8a8f207f487d',
    '253488078a4edf4d6f42f113d1e62836a942cf1a',
    '86af3e9626fce1957c82e88cbf04ddf3a2ed7915',
    'b136707642a4ea12fb4bae820f03d2562ebff487',
    'dbe9b615a3ae8709af8b93336ce9b477e4ac0940',
    'f14c14075d6c4ed84b86798af0956deef67365b5',
    'ca544e5c4687d109611d0f8f928b53a25af72448',
    'aeeb8ff27288bdabc0fa5ebb731b6f409507516c',
    'cbb9d3703e651b0d496cdefb8b92c25aeb2171f7',
    '6d87578288b6cb5549d5076a207456a1f6a63dc0',
    'b2c6f0dfbb716ac562e2d85d6cb2f8d5ee87603e',
    'accc230e8a6e5be9160b8cdf2864dd2a001c28b6',
    '2b3455ec7fedf16e646268bf88846bd7a2319bb2',
    '4613f3bca5c44ea06337a9e439fbc6d42e501d0a',
    'd343b217de44030afaa275f54d31a9317c7f441e',
    '84ef4b2357079cd7a7c69fd7a37cd0609a679106',
    'da2fef9e4a3230988ff17df2165440f37e8b1708',
    'f4c64518ea10f995918a454158c6b61407ea345c',
    '7602b46df5390e432ef1c307d4f2c9ff6d65cc97',
    'bb9bc244d798123fde783fcc1c72d3bb8c189413',
    '807640a13483f8ac783c557fcdf27be11ea4ac7a',
  ],
  DAORefundContract: 'bf4ed7b27f1d666546e30d74d50d173d20bca754',
}
