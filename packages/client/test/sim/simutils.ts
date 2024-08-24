import { executionPayloadFromBeaconPayload } from '@ethereumjs/block'
import { createBlockchain } from '@ethereumjs/blockchain'
import { createBlob4844Tx, createFeeMarket1559Tx } from '@ethereumjs/tx'
import {
  BIGINT_1,
  blobsToCommitments,
  blobsToProofs,
  bytesToHex,
  bytesToUtf8,
  commitmentsToVersionedHashes,
  createAddressFromPrivateKey,
  getBlobs,
  randomBytes,
} from '@ethereumjs/util'
import * as fs from 'fs/promises'
import { loadKZG } from 'kzg-wasm'
import { Level } from 'level'
import { execSync, spawn } from 'node:child_process'
import * as net from 'node:net'
import qs from 'qs'

import { EthereumClient } from '../../src/client.js'
import { Config } from '../../src/config.js'
import { LevelDB } from '../../src/execution/level.js'
import { RPCManager } from '../../src/rpc/index.js'
import { Event } from '../../src/types.js'

import type { Common } from '@ethereumjs/common'
import type { TransactionType, TxData, TxOptions } from '@ethereumjs/tx'
import type { PrefixedHexString } from '@ethereumjs/util'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import type { Client } from 'jayson/promise'

const kzg = await loadKZG()

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// This function switches between the native web implementation and a nodejs implementation
export async function getEventSource(): Promise<typeof EventSource> {
  if (globalThis.EventSource !== undefined) {
    return EventSource
  } else {
    return (await import('eventsource')).default as unknown as typeof EventSource
  }
}

/**
 * Ethereum Beacon API requires the query with format:
 * - arrayFormat: repeat `topic=topic1&topic=topic2`
 */
export function stringifyQuery(query: unknown): string {
  return qs.stringify(query, { arrayFormat: 'repeat' })
}

export async function waitForELOnline(client: Client): Promise<string> {
  for (let i = 0; i < 15; i++) {
    try {
      console.log('Waiting for EL online...')
      const res = await client.request('web3_clientVersion', [])
      return res.result as string
    } catch {
      await sleep(4000)
    }
  }
  throw Error('EL not online in 60 seconds')
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', function (err) {
      if ((err as unknown as { code: string }).code === 'EADDRINUSE') {
        resolve(true)
      } else {
        reject(err)
      }
    })

    server.once('listening', function () {
      // close the server if listening doesn't fail
      server.close(() => {
        resolve(false)
      })
    })

    server.listen(port)
  })
}

export async function waitForELOffline(): Promise<void> {
  const port = 30303

  for (let i = 0; i < 15; i++) {
    console.log('Waiting for EL offline...')
    const isInUse = await isPortInUse(port)
    if (!isInUse) {
      return
    }
    await sleep(4000)
  }
  throw Error('EL not offline in 120 seconds')
}

export async function waitForELStart(client: Client): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const res = await client.request('eth_getBlockByNumber', ['latest', false])
    if (Number(res.result.number) > 0) {
      return
    } else {
      process.stdout.write('*')
      await sleep(12000)
    }
  }
  throw Error('EL not started in 60 seconds')
}

export async function validateBlockHashesInclusionInBeacon(
  beaconUrl: string,
  from: number,
  to: number,
  blockHashes: string[],
) {
  const executionHashes: string[] = []
  for (let i = from; i <= to; i++) {
    const res = await (await fetch(`${beaconUrl}/eth/v2/beacon/blocks/${i}`)).json()
    // it could be possible that executionPayload is not provided if the block
    // is not bellatrix+
    const executionHash = res.data.message.body.execution_payload?.block_hash
    if (executionHash !== undefined) {
      executionHashes.push(executionHash)
    }
  }
  const inclusionCheck = blockHashes.reduce((acc, blockHash) => {
    return acc && executionHashes.includes(blockHash)
  }, true)
  if (!inclusionCheck) {
    throw Error('Failed inclusion check')
  }
}

type RunOpts = {
  filterKeywords: string[]
  filterOutWords: string[]
  externalRun?: string
  withPeer?: string
}

export function runNetwork(
  network: string,
  client: Client,
  { filterKeywords, filterOutWords, withPeer }: RunOpts,
): () => Promise<void> {
  const runProc = spawn('test/sim/single-run.sh', [], {
    env: {
      ...process.env,
      NETWORK: network,
      // If instructed to run a multipeer with a peer2
      MULTIPEER: withPeer === 'peer2' ? 'peer1' : undefined,
    },
  })
  const runProcPrefix = withPeer !== undefined ? 'peer1' : ''
  let lastPrintedDot = false
  runProc.stdout.on('data', (chunk) => {
    const str = bytesToUtf8(chunk)
    const filterStr = filterKeywords.reduce((acc, next) => acc || str.includes(next), false)
    const filterOutStr = filterOutWords.reduce((acc, next) => acc || str.includes(next), false)
    if (filterStr && !filterOutStr) {
      if (lastPrintedDot) {
        console.log('')
        lastPrintedDot = false
      }
      process.stdout.write(`data:${runProcPrefix}: ${runProc.pid}: ${str}`) // str already contains a new line. console.log adds a new line
    } else {
      if (str.includes('Synchronized') === true) {
        process.stdout.write('.')
        lastPrintedDot = true
      } else if (str.includes('Synced') === true && str.includes('skipped') === false) {
        process.stdout.write('`')
      }
    }
  })
  runProc.stderr.on('data', (chunk) => {
    const str = bytesToUtf8(chunk)
    const filterStr = filterKeywords.reduce((acc, next) => acc || str.includes(next), false)
    const filterOutStr = filterOutWords.reduce((acc, next) => acc || str.includes(next), false)
    if (filterStr && !filterOutStr) {
      process.stderr.write(`stderr:${runProcPrefix}: ${runProc.pid}: ${str}`) // str already contains a new line. console.log adds a new line
    }
  })

  runProc.on('exit', (code) => {
    console.log('network exited', { code })
  })
  console.log({ pid: runProc.pid })

  let peerRunProc: ChildProcessWithoutNullStreams | undefined = undefined
  if (withPeer !== undefined) {
    peerRunProc = spawn('test/sim/single-run.sh', [], {
      env: {
        ...process.env,
        NETWORK: network,
        MULTIPEER: withPeer,
      },
    })
    console.log({ peerRunProc: peerRunProc.pid })

    let lastPrintedDot = false
    peerRunProc.stdout.on('data', (chunk) => {
      const str = bytesToUtf8(chunk)
      const filterStr = filterKeywords.reduce((acc, next) => acc || str.includes(next), false)
      const filterOutStr = filterOutWords.reduce((acc, next) => acc || str.includes(next), false)
      if (filterStr && !filterOutStr) {
        if (lastPrintedDot) {
          console.log('')
          lastPrintedDot = false
        }
        process.stdout.write(`${withPeer}:el<>cl: ${runProc.pid}: ${str}`) // str already contains a new line. console.log adds a new line
      } else {
        if (str.includes('Synchronized') === true) {
          process.stdout.write('.')
          lastPrintedDot = true
        }
      }
    })
    peerRunProc.stderr.on('data', (chunk) => {
      const str = bytesToUtf8(chunk)
      const filterOutStr = filterOutWords.reduce((acc, next) => acc || str.includes(next), false)
      if (!filterOutStr) {
        process.stderr.write(`${withPeer}:el<>cl: ${runProc.pid}: ${str}`) // str already contains a new line. console.log adds a new line
      }
    })

    peerRunProc.on('exit', (code) => {
      console.log('network exited', { code })
    })
  }

  const teardownCallBack = async () => {
    console.log('teardownCallBack', { pid: runProc.pid })
    if (runProc.killed) {
      throw Error('network is killed before end of test')
    }
    console.log('Killing network process', runProc.pid)
    execSync(`pkill -15 -P ${runProc.pid}`) // cspell:disable-line pkill
    if (peerRunProc !== undefined) {
      console.log('Killing peer network process', peerRunProc.pid)
      execSync(`pkill -15 -P ${peerRunProc.pid}`) // cspell:disable-line pkill
    }
    // Wait for the P2P to be offline
    await waitForELOffline()
    console.log('network successfully killed!')
  }
  return teardownCallBack
}

export async function startNetwork(
  network: string,
  client: Client,
  opts: RunOpts,
): Promise<{ teardownCallBack: () => Promise<void>; result: string }> {
  let teardownCallBack
  if (opts.externalRun === undefined) {
    teardownCallBack = runNetwork(network, client, opts)
  } else {
    teardownCallBack = async (): Promise<void> => {}
  }
  const result = await waitForELOnline(client)
  return { teardownCallBack, result }
}

export async function runTxHelper(
  opts: { client: Client; common: Common; sender: string; pkey: Uint8Array },
  data: PrefixedHexString | '',
  to?: PrefixedHexString,
  value?: bigint,
) {
  const { client, common, sender, pkey } = opts
  const nonce = BigInt((await client.request('eth_getTransactionCount', [sender, 'latest'])).result)

  const block = await client.request('eth_getBlockByNumber', ['latest', false])
  const baseFeePerGas = BigInt(block.result.baseFeePerGas) * 100n
  const maxPriorityFeePerGas = 100000000n
  const tx = createFeeMarket1559Tx(
    {
      data,
      gasLimit: 1000000,
      maxFeePerGas: baseFeePerGas + maxPriorityFeePerGas,
      maxPriorityFeePerGas,
      nonce,
      to,
      value,
    },
    { common },
  ).sign(pkey)

  const res = await client.request('eth_sendRawTransaction', [bytesToHex(tx.serialize())], 2.0)
  let mined = false
  let receipt
  console.log(`tx: ${res.result}`)
  let tries = 0
  while (!mined && tries < 50) {
    tries++
    receipt = await client.request('eth_getTransactionReceipt', [res.result])
    if (receipt.result !== null) {
      mined = true
    } else {
      process.stdout.write('-')
      await sleep(12000)
    }
  }
  return receipt.result
}

export const runBlobTx = async (
  client: Client,
  blobSize: number,
  pkey: Uint8Array,
  to?: PrefixedHexString,
  value?: bigint,
  opts?: TxOptions,
) => {
  const blobs = getBlobs(bytesToHex(randomBytes(blobSize)))
  const commitments = blobsToCommitments(kzg, blobs)
  const proofs = blobsToProofs(kzg, blobs, commitments)
  const hashes = commitmentsToVersionedHashes(commitments)

  const sender = createAddressFromPrivateKey(pkey)
  const txData: TxData[TransactionType.BlobEIP4844] = {
    to,
    data: '0x',
    chainId: '0x1',
    blobs,
    kzgCommitments: commitments,
    kzgProofs: proofs,
    blobVersionedHashes: hashes,
    maxFeePerBlobGas: undefined,
    maxPriorityFeePerGas: undefined,
    maxFeePerGas: undefined,
    nonce: undefined,
    gasLimit: undefined,
    value,
  }

  txData.maxFeePerGas = '0xff'
  txData.maxPriorityFeePerGas = BIGINT_1
  txData.maxFeePerBlobGas = BigInt(1000)
  txData.gasLimit = BigInt(1000000)
  const nonce = await client.request('eth_getTransactionCount', [sender.toString(), 'latest'], 2.0)
  txData.nonce = BigInt(nonce.result)
  const blobTx = createBlob4844Tx(txData, opts).sign(pkey)

  const serializedWrapper = blobTx.serializeNetworkWrapper()

  const res = await client.request('eth_sendRawTransaction', [bytesToHex(serializedWrapper)], 2.0)

  console.log(`tx: ${res.result}`)
  let tries = 0
  let mined = false
  let receipt
  while (!mined && tries < 50) {
    tries++
    receipt = await client.request('eth_getTransactionReceipt', [res.result])
    if (receipt.result !== null) {
      mined = true
    } else {
      process.stdout.write('-')
      await sleep(12000)
    }
  }
  return { tx: blobTx, receipt: receipt.result }
}

export const createBlobTxs = async (
  numTxs: number,
  pkey: Uint8Array,
  startNonce: number = 0,
  txMeta: {
    to?: PrefixedHexString
    value?: bigint
    chainId?: number
    maxFeePerBlobGas: bigint
    maxPriorityFeePerGas: bigint
    maxFeePerGas: bigint
    gasLimit: bigint
    blobSize: number
  },
  opts?: TxOptions,
) => {
  const txHashes: string[] = []
  const blobSize = txMeta.blobSize ?? 2 ** 17 - 1

  const blobs = getBlobs(bytesToHex(randomBytes(blobSize)))
  const commitments = blobsToCommitments(kzg, blobs)
  const proofs = blobsToProofs(kzg, blobs, commitments)
  const hashes = commitmentsToVersionedHashes(commitments)
  const txns = []

  for (let x = startNonce; x <= startNonce + numTxs; x++) {
    const sender = createAddressFromPrivateKey(pkey)
    const txData = {
      from: sender.toString(),
      ...txMeta,
      blobs,
      kzgCommitments: commitments,
      kzgProofs: proofs,
      blobVersionedHashes: hashes,
      nonce: BigInt(x),
      gas: undefined,
    }

    const blobTx = createBlob4844Tx(txData, opts).sign(pkey)

    const serializedWrapper = blobTx.serializeNetworkWrapper()
    await fs.appendFile('./blobs.txt', bytesToHex(serializedWrapper) + '\n')
    txns.push(bytesToHex(serializedWrapper))
    txHashes.push(bytesToHex(blobTx.hash()))
  }
  return txns
}

export const runBlobTxsFromFile = async (client: Client, path: string) => {
  const file = await fs.readFile(path, 'utf-8')
  const txns = file.split('\n').filter((txn) => txn.length > 0)
  const txnHashes = []
  for (const txn of txns) {
    const res = await client.request('eth_sendRawTransaction', [txn], 2.0)
    txnHashes.push(res.result)
  }
  return txnHashes
}

export async function createInlineClient(
  config: any,
  common: any,
  customGenesisState: any,
  datadir: any = Config.DATADIR_DEFAULT,
) {
  config.events.setMaxListeners(50)
  const chainDB = new Level<string | Uint8Array, string | Uint8Array>(
    `${datadir}/${common.chainName()}/chainDB`,
  )
  const stateDB = new Level<string | Uint8Array, string | Uint8Array>(
    `${datadir}/${common.chainName()}/stateDB`,
  )
  const metaDB = new Level<string | Uint8Array, string | Uint8Array>(
    `${datadir}/${common.chainName()}/metaDB`,
  )

  const blockchain = await createBlockchain({
    db: new LevelDB(chainDB),
    genesisState: customGenesisState,
    common: config.chainCommon,
    hardforkByHeadBlockNumber: true,
    validateBlocks: true,
    validateConsensus: false,
  })
  config.chainCommon.setForkHashes(blockchain.genesisBlock.hash())
  const inlineClient = await EthereumClient.create({
    config,
    blockchain,
    chainDB,
    stateDB,
    metaDB,
    genesisState: customGenesisState,
  })
  await inlineClient.open()
  await inlineClient.start()
  return inlineClient
}

export async function setupEngineUpdateRelay(client: EthereumClient, peerBeaconUrl: string) {
  // track head
  const topics = ['head']
  const EventSource = await getEventSource()
  const query = stringifyQuery({ topics })
  console.log({ query })
  const eventSource = new EventSource(`${peerBeaconUrl}/eth/v1/events?${query}`)
  const manager = new RPCManager(client, client.config)
  const engineMethods = manager.getMethods(true)

  // possible values: STARTED, PAUSED, ERRORED, SYNCING, VALID
  let syncState = 'PAUSED'
  let pollInterval: any | null = null
  let waitForStates = ['VALID']
  let errorMessage = ''
  const updateState = (newState: string) => {
    if (syncState !== 'PAUSED') {
      syncState = newState
    }
  }

  const playUpdate = async (payload: any, finalizedBlockHash: string, version: string) => {
    if (version !== 'capella') {
      throw Error('only capella replay supported yet')
    }
    const fcUState = {
      headBlockHash: payload.blockHash,
      safeBlockHash: finalizedBlockHash,
      finalizedBlockHash,
    }
    console.log('playUpdate', fcUState)

    try {
      const newPayloadRes = await engineMethods['engine_newPayloadV2']([payload])
      if (
        newPayloadRes.status === undefined ||
        !['SYNCING', 'VALID', 'ACCEPTED'].includes(newPayloadRes.status)
      ) {
        throw Error(
          `newPayload error: status${newPayloadRes.status} validationError=${newPayloadRes.validationError} error=${newPayloadRes.error}`,
        )
      }

      const fcuRes = await engineMethods['engine_forkchoiceUpdatedV2']([fcUState])
      if (
        fcuRes.payloadStatus === undefined ||
        !['SYNCING', 'VALID', 'ACCEPTED'].includes(newPayloadRes.status)
      ) {
        throw Error(`fcU error: error:${fcuRes.error} message=${fcuRes.message}`)
      } else {
        updateState(fcuRes.payloadStatus.status)
      }
    } catch (e) {
      console.log('playUpdate error', e)
      updateState('ERRORED')
    }
  }

  // ignoring the actual event, just using it as trigger to feed
  eventSource.addEventListener(topics[0], async (_event: MessageEvent) => {
    if (syncState === 'PAUSED' || syncState === 'CLOSED') return
    try {
      // just fetch finalized updated, it has all relevant hashes for fcU
      const beaconFinalized = await (
        await fetch(`${peerBeaconUrl}/eth/v1/beacon/light_client/finality_update`)
      ).json()
      if (beaconFinalized.error !== undefined) {
        if (beaconFinalized.message?.includes('No finality update available') === true) {
          // waiting for finality
          return
        } else {
          throw Error(beaconFinalized.message ?? 'finality update fetch error')
        }
      }

      const beaconHead = await (await fetch(`${peerBeaconUrl}/eth/v2/beacon/blocks/head`)).json()

      const payload = executionPayloadFromBeaconPayload(
        beaconHead.data.message.body.execution_payload,
      )
      const finalizedBlockHash = beaconFinalized.data.finalized_header.execution.block_hash

      await playUpdate(payload, finalizedBlockHash, beaconHead.version)
    } catch (e) {
      console.log('update fetch error', e)
      updateState('ERRORED')
      errorMessage = (e as Error).message
    }
  })

  const cleanUpPoll = () => {
    if (pollInterval !== null) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }

  const start = (opts: { waitForStates?: string[] } = {}) => {
    waitForStates = opts.waitForStates ?? ['VALID']
    if (pollInterval !== null) {
      throw Error('Already waiting on sync')
    }
    if (syncState === 'PAUSED') syncState = 'STARTED'

    return new Promise((resolve, reject) => {
      const resolveOnSynced = () => {
        if (waitForStates.includes(syncState)) {
          console.log('resolving sync', { syncState })
          cleanUpPoll()
          client.config.events.removeListener(Event.CHAIN_UPDATED, resolveOnSynced)
          resolve({ syncState })
        } else if (syncState === 'INVALID' || syncState === 'CLOSED') {
          console.log('rejecting sync', { syncState })
          cleanUpPoll()
          client.config.events.removeListener(Event.CHAIN_UPDATED, resolveOnSynced)
          reject(Error(errorMessage ?? `exiting syncState check syncState=${syncState}`))
        }
      }

      pollInterval = setInterval(resolveOnSynced, 6000)
      client.config.events.on(Event.CHAIN_UPDATED, resolveOnSynced)
    })
  }
  const pause = () => {
    syncState = 'PAUSED'
  }

  const close = () => {
    syncState = 'CLOSED'
  }

  return {
    syncState,
    playUpdate,
    eventSource,
    start,
    pause,
    close,
  }
}

// To minimize noise on the spec run, selective filtering is applied to let the important events
// of the testnet log to show up in the spec log
export const filterKeywords = [
  'warn',
  'error',
  'npm run client:start',
  'docker run',
  'lodestar dev',
  'kill',
  'ejs',
  'lode',
  'pid',
  'Synced - slot: 0 -',
  'TxPool started',
  'number=0',
]
export const filterOutWords = ['duties', 'Low peer count', 'MaxListenersExceededWarning']
