import { StatefulVerkleStateManager } from '@ethereumjs/statemanager'
import {
  bytesToBigInt,
  bytesToHex,
  createAddressFromString,
  equalsBytes,
  hexToBytes,
} from '@ethereumjs/util'
import { createVerkleTree } from '@ethereumjs/verkle'
import * as ssz from 'micro-eth-signer/ssz'

import { createEVM } from '../constructors.js'
import { EvmErrorResult, OOGResult } from '../evm.js'
import { ERROR, EvmError } from '../exceptions.js'
import { VerkleAccessWitness } from '../verkleAccessWitness.js'

import { gasLimitCheck } from './util.js'

import { getPrecompileName } from './index.js'

import type { EVM } from '../evm.js'
import type { ExecResult } from '../types.js'
import type { generateStateWitness } from '../verkleAccessWitness.js'
import type { PrecompileInput } from './types.js'

const MAX_CALL_DATA_SIZE = 7500000 // Assuming a transaction with all zero bytes fills up an entire block worth of gas
export const traceContainer = ssz.container({
  txs: ssz.list(
    // An ssz list of tx objects that match the `eth_call` tx object format
    256,
    ssz.container({
      to: ssz.bytevector(20),
      from: ssz.bytevector(20),
      gasLimit: ssz.uint64,
      gasPrice: ssz.uint64,
      value: ssz.uint64,
      data: ssz.bytelist(MAX_CALL_DATA_SIZE),
    }),
  ),
  witness: ssz.container({
    // A state witness that contains all the reads and writes to the state that are part of the tx list
    reads: ssz.list(
      1024, // arbitrary limit for now
      ssz.container({
        key: ssz.bytevector(32),
        currentValue: ssz.bytevector(32),
      }),
    ),
    writes: ssz.list(
      1024, // arbitrary limit for now
      ssz.container({
        key: ssz.bytevector(32),
        currentValue: ssz.bytevector(32),
        newValue: ssz.bytevector(32),
      }),
    ),
    parentStateRoot: ssz.bytevector(32),
  }),
})

export const stateWitnessJSONToSSZ = (
  witness: Awaited<ReturnType<typeof generateStateWitness>>,
) => {
  const reads = Array.from(witness.reads.entries()).map(([key, value]) => ({
    key: hexToBytes(key),
    currentValue: hexToBytes(value),
  }))

  const writes = Array.from(witness.writes.entries()).map(([key, value]) => ({
    key: hexToBytes(key),
    currentValue: hexToBytes(value.currentValue),
    newValue: hexToBytes(value.newValue),
  }))

  return {
    reads,
    writes,
    parentStateRoot: hexToBytes(witness.parentStateRoot),
  }
}

export async function precompile12(opts: PrecompileInput): Promise<ExecResult> {
  const pName = getPrecompileName('12')
  const data = opts.data
  const evm = opts._EVM as EVM
  const gasUsed = opts.common.param('executeGasCost')
  if (!gasLimitCheck(opts, gasUsed, pName)) {
    return OOGResult(opts.gasLimit)
  }

  if (data.length !== 128) {
    return EvmErrorResult(new EvmError(ERROR.INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  const _preStateRoot = data.subarray(0, 32) // prestateroot for L2 state
  const postStateRoot = data.subarray(32, 64) // post state root for L2 state
  const traceBlob = evm['executionBlobs'].get(bytesToHex(data.subarray(64, 96))) // reference to state access and transactions
  if (traceBlob === undefined) {
    opts._debug?.(`${pName} error - trace not found`)
    return EvmErrorResult(new EvmError(ERROR.REVERT), opts.gasLimit)
  }

  const decodedTrace = traceContainer.decode(traceBlob)

  if (decodedTrace.txs === undefined || decodedTrace.witness === undefined) {
    opts._debug?.(`${pName} error - trace is invalid`)
    return EvmErrorResult(new EvmError(ERROR.REVERT), opts.gasLimit)
  }
  const executeGasUsed = bytesToBigInt(data.subarray(96))

  const witness = decodedTrace.witness
  const tree = await createVerkleTree({ verkleCrypto: opts.common.customCrypto.verkle })

  // Populate the L2 state trie with the prestate
  for (const chunk of witness.reads) {
    await tree.put(chunk.key.slice(0, 31), [Number(chunk.key.slice(31))], [chunk.currentValue])
  }
  for (const chunk of witness.writes) {
    await tree.put(chunk.key.slice(0, 31), [Number(chunk.key.slice(31))], [chunk.currentValue])
  }
  let executionResult = true

  const stateManager = new StatefulVerkleStateManager({ common: opts.common, trie: tree })
  const l2EVM = await createEVM({ stateManager, common: opts.common })

  l2EVM.verkleAccessWitness = new VerkleAccessWitness({
    verkleCrypto: opts.common.customCrypto.verkle!,
  })
  l2EVM.systemVerkleAccessWitness = new VerkleAccessWitness({
    verkleCrypto: opts.common.customCrypto.verkle!,
  })
  let computedGasUsed = 0n

  // Run each transaction in the trace
  for (const tx of decodedTrace.txs) {
    const res = await l2EVM.runCall({
      to: createAddressFromString(bytesToHex(tx.to)),
      caller: createAddressFromString(bytesToHex(tx.from)),
      gasLimit: BigInt(tx.gasLimit),
      gasPrice: BigInt(tx.gasPrice),
      value: BigInt(tx.value),
      data: tx.data !== undefined ? tx.data : undefined,
    })
    computedGasUsed += res.execResult.executionGasUsed
  }

  if (computedGasUsed !== executeGasUsed) {
    opts._debug?.(`${pName} gas used mismatch: ${computedGasUsed} !== ${executeGasUsed}`)
    executionResult = false
  }

  if (!equalsBytes(postStateRoot, tree.root())) {
    opts._debug?.(`${pName} post state root mismatch`)
    executionResult = false
  }

  opts._debug?.(`${pName} trace executed successfully=${executionResult}`)

  const returnValue = executionResult ? new Uint8Array(1).fill(1) : new Uint8Array(1).fill(0)

  return {
    executionGasUsed: gasUsed,
    returnValue,
  }
}
