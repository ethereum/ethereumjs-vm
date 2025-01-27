import { bigIntToHex } from '@ethereumjs/util'

import type { ExecutionPayload } from './types.js'
import type {
  NumericString,
  PrefixedHexString,
  VerkleExecutionWitness,
  ssz,
} from '@ethereumjs/util'

type BeaconWithdrawal = {
  index: PrefixedHexString
  validator_index: PrefixedHexString
  address: PrefixedHexString
  amount: PrefixedHexString
}

export type BeaconFeesPerGasV1 = {
  regular: PrefixedHexString | null // Quantity 64 bytes
  blob: PrefixedHexString | null // Quantity 64 bytes
}

export type BeaconAccessTupleV1 = {
  address: PrefixedHexString // DATA 20 bytes
  storage_keys: PrefixedHexString[] // Data 32 bytes MAX_ACCESS_LIST_STORAGE_KEYS array
}

export type BeaconAuthorizationPayloadV1 = {
  magic: PrefixedHexString
  chain_id: PrefixedHexString
  address: PrefixedHexString
  nonce: PrefixedHexString
}

export type BeaconExecutionSignatureV1 = {
  secp256k1: PrefixedHexString | null // DATA 65 bytes or null
}

export type BeaconAuthorizationV1 = {
  payload: BeaconAuthorizationPayloadV1
  signature: BeaconExecutionSignatureV1
}

export type BeaconTransactionPayloadV1 = {
  type: PrefixedHexString | null // Quantity, 1 byte
  chain_id: PrefixedHexString | null // Quantity 8 bytes
  nonce: PrefixedHexString | null // Quantity 8 bytes
  max_fees_per_gas: BeaconFeesPerGasV1 | null
  gas: PrefixedHexString | null // Quantity 8 bytes
  to: PrefixedHexString | null // DATA 20 bytes
  value: PrefixedHexString | null // Quantity 64 bytes
  input: PrefixedHexString | null // max MAX_CALLDATA_SIZE bytes,
  access_list: BeaconAccessTupleV1[] | null
  max_priority_fees_per_gas: BeaconFeesPerGasV1 | null
  blob_versioned_hashes: PrefixedHexString[] | null // DATA 32 bytes array
  authorization_list: BeaconAuthorizationV1[] | null
}

type BeaconTransactionV1 = {
  payload: BeaconTransactionPayloadV1
  signature: BeaconExecutionSignatureV1
}

// Payload json that one gets using the beacon apis
// curl localhost:5052/eth/v2/beacon/blocks/56610 | jq .data.message.body.execution_payload
export type BeaconPayloadJSON = {
  parent_hash: PrefixedHexString
  fee_recipient: PrefixedHexString
  state_root: PrefixedHexString
  receipts_root: PrefixedHexString
  logs_bloom: PrefixedHexString
  prev_randao: PrefixedHexString
  block_number: NumericString
  gas_limit: NumericString
  gas_used: NumericString
  timestamp: NumericString
  extra_data: PrefixedHexString
  base_fee_per_gas: NumericString
  block_hash: PrefixedHexString
  transactions: PrefixedHexString[] | BeaconTransactionV1[]
  withdrawals?: BeaconWithdrawal[]
  blob_gas_used?: NumericString
  excess_blob_gas?: NumericString
  parent_beacon_block_root?: PrefixedHexString
  requests_hash?: PrefixedHexString
  system_logs_root?: PrefixedHexString
  // the casing of VerkleExecutionWitness remains same camel case for now
  execution_witness?: VerkleExecutionWitness
}

type VerkleProofSnakeJSON = {
  commitments_by_path: PrefixedHexString[]
  d: PrefixedHexString
  depth_extension_present: PrefixedHexString
  ipa_proof: {
    cl: PrefixedHexString[]
    cr: PrefixedHexString[]
    final_evaluation: PrefixedHexString
  }
  other_stems: PrefixedHexString[]
}

type VerkleStateDiffSnakeJSON = {
  stem: PrefixedHexString
  suffix_diffs: {
    current_value: PrefixedHexString | null
    new_value: PrefixedHexString | null
    suffix: number | string
  }[]
}

type VerkleExecutionWitnessSnakeJSON = {
  parent_state_root: PrefixedHexString
  state_diff: VerkleStateDiffSnakeJSON[]
  verkle_proof: VerkleProofSnakeJSON
}

function parseExecutionWitnessFromSnakeJSON({
  parent_state_root,
  state_diff,
  verkle_proof,
}: VerkleExecutionWitnessSnakeJSON): VerkleExecutionWitness {
  return {
    parentStateRoot: parent_state_root,
    stateDiff: state_diff.map(({ stem, suffix_diffs }) => ({
      stem,
      suffixDiffs: suffix_diffs.map(({ current_value, new_value, suffix }) => ({
        currentValue: current_value,
        newValue: new_value,
        suffix,
      })),
    })),
    verkleProof: {
      commitmentsByPath: verkle_proof.commitments_by_path,
      d: verkle_proof.d,
      depthExtensionPresent: verkle_proof.depth_extension_present,
      ipaProof: {
        cl: verkle_proof.ipa_proof.cl,
        cr: verkle_proof.ipa_proof.cr,
        finalEvaluation: verkle_proof.ipa_proof.final_evaluation,
      },
      otherStems: verkle_proof.other_stems,
    },
  }
}

/**
 * Converts a beacon block execution payload JSON object {@link BeaconPayloadJSON} to the {@link ExecutionPayload} data needed to construct a {@link Block}.
 * The JSON data can be retrieved from a consensus layer (CL) client on this Beacon API `/eth/v2/beacon/blocks/[block number]`
 */
export function executionPayloadFromBeaconPayload(payload: BeaconPayloadJSON): ExecutionPayload {
  const transactions =
    typeof payload.transactions[0] === 'object'
      ? (payload.transactions as BeaconTransactionV1[]).map((btxv1) => {
          return {
            payload: {
              type: btxv1.payload.type,
              chainId: btxv1.payload.chain_id,
              nonce: btxv1.payload.nonce,
              maxFeesPerGas: btxv1.payload.max_fees_per_gas,
              to: btxv1.payload.to,
              value: btxv1.payload.value,
              input: btxv1.payload.input,
              accessList:
                btxv1.payload.access_list?.map((bal: BeaconAccessTupleV1) => {
                  return {
                    address: bal.address,
                    storageKeys: bal.storage_keys,
                  }
                }) ?? null,
              maxPriorityFeesPerGas: btxv1.payload.max_priority_fees_per_gas,
              blobVersionedHashes: btxv1.payload.blob_versioned_hashes,
              authorizationList:
                btxv1.payload.authorization_list?.map((bal: BeaconAuthorizationV1) => {
                  const { payload, signature } = bal
                  return {
                    payload: {
                      magic: payload.magic,
                      chainId: payload.chain_id,
                      address: payload.address,
                      nonce: payload.nonce,
                    },
                    signature,
                  }
                }) ?? null,
            },
            signature: {
              secp256k1: btxv1.signature.secp256k1,
            },
          } as ssz.TransactionV1
        })
      : (payload.transactions as PrefixedHexString[])

  const executionPayload: ExecutionPayload = {
    parentHash: payload.parent_hash,
    feeRecipient: payload.fee_recipient,
    stateRoot: payload.state_root,
    receiptsRoot: payload.receipts_root,
    logsBloom: payload.logs_bloom,
    prevRandao: payload.prev_randao,
    blockNumber: bigIntToHex(BigInt(payload.block_number)),
    gasLimit: bigIntToHex(BigInt(payload.gas_limit)),
    gasUsed: bigIntToHex(BigInt(payload.gas_used)),
    timestamp: bigIntToHex(BigInt(payload.timestamp)),
    extraData: payload.extra_data,
    baseFeePerGas: bigIntToHex(BigInt(payload.base_fee_per_gas)),
    blockHash: payload.block_hash,
    transactions,
  }

  if (payload.withdrawals !== undefined && payload.withdrawals !== null) {
    executionPayload.withdrawals = payload.withdrawals.map((wd) => ({
      index: bigIntToHex(BigInt(wd.index)),
      validatorIndex: bigIntToHex(BigInt(wd.validator_index)),
      address: wd.address,
      amount: bigIntToHex(BigInt(wd.amount)),
    }))
  }

  if (payload.blob_gas_used !== undefined && payload.blob_gas_used !== null) {
    executionPayload.blobGasUsed = bigIntToHex(BigInt(payload.blob_gas_used))
  }
  if (payload.excess_blob_gas !== undefined && payload.excess_blob_gas !== null) {
    executionPayload.excessBlobGas = bigIntToHex(BigInt(payload.excess_blob_gas))
  }
  if (payload.parent_beacon_block_root !== undefined && payload.parent_beacon_block_root !== null) {
    executionPayload.parentBeaconBlockRoot = payload.parent_beacon_block_root
  }
  if (payload.requests_hash !== undefined && payload.requests_hash !== null) {
    executionPayload.requestsHash = payload.requests_hash
  }

  if (payload.system_logs_root !== undefined && payload.system_logs_root !== null) {
    executionPayload.systemLogsRoot = payload.system_logs_root
  }

  if (payload.execution_witness !== undefined && payload.execution_witness !== null) {
    // the casing structure in payload could be camel case or snake depending upon the CL
    executionPayload.executionWitness =
      payload.execution_witness.verkleProof !== undefined
        ? payload.execution_witness
        : parseExecutionWitnessFromSnakeJSON(
            payload.execution_witness as unknown as VerkleExecutionWitnessSnakeJSON,
          )
  }

  return executionPayload
}
