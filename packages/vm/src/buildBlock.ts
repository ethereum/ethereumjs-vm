import { Block } from '@ethereumjs/block'
import { ConsensusType } from '@ethereumjs/common'
import { RLP } from '@ethereumjs/rlp'
import { Trie } from '@ethereumjs/trie'
import { BlobEIP4844Transaction } from '@ethereumjs/tx'
import { Address, GWEI_TO_WEI, TypeOutput, Withdrawal, toBytes, toType } from '@ethereumjs/util'

import { Bloom } from './bloom/index.js'
import { calculateMinerReward, encodeReceipt, rewardAccount } from './runBlock.js'

import type { BuildBlockOpts, BuilderOpts, RunTxResult, SealBlockOpts } from './types.js'
import type { VM } from './vm.js'
import type { HeaderData } from '@ethereumjs/block'
import type { TypedTransaction } from '@ethereumjs/tx'

export enum BuildStatus {
  Reverted = 'reverted',
  Build = 'build',
  Pending = 'pending',
}

type BlockStatus =
  | { status: BuildStatus.Pending | BuildStatus.Reverted }
  | { status: BuildStatus.Build; block: Block }

export class BlockBuilder {
  /**
   * The cumulative gas used by the transactions added to the block.
   */
  gasUsed = BigInt(0)
  /**
   *  The cumulative data gas used by the blobs in a block
   */
  dataGasUsed = BigInt(0)
  /**
   * Value of the block, represented by the final transaction fees
   * acruing to the miner.
   */
  private _minerValue = BigInt(0)

  private readonly vm: VM
  private blockOpts: BuilderOpts
  private headerData: HeaderData
  private transactions: TypedTransaction[] = []
  private transactionResults: RunTxResult[] = []
  private withdrawals?: Withdrawal[]
  private checkpointed = false
  private blockStatus: BlockStatus = { status: BuildStatus.Pending }

  get transactionReceipts() {
    return this.transactionResults.map((result) => result.receipt)
  }

  get minerValue() {
    return this._minerValue
  }

  constructor(vm: VM, opts: BuildBlockOpts) {
    this.vm = vm
    this.blockOpts = { putBlockIntoBlockchain: true, ...opts.blockOpts, common: this.vm.common }

    this.headerData = {
      ...opts.headerData,
      parentHash: opts.parentBlock.hash(),
      number: opts.headerData?.number ?? opts.parentBlock.header.number + BigInt(1),
      gasLimit: opts.headerData?.gasLimit ?? opts.parentBlock.header.gasLimit,
    }
    this.withdrawals = opts.withdrawals?.map(Withdrawal.fromWithdrawalData)

    if (
      this.vm.common.isActivatedEIP(1559) === true &&
      typeof this.headerData.baseFeePerGas === 'undefined'
    ) {
      this.headerData.baseFeePerGas = opts.parentBlock.header.calcNextBaseFee()
    }

    if (
      this.vm.common.isActivatedEIP(4844) === true &&
      typeof this.headerData.excessDataGas === 'undefined'
    ) {
      this.headerData.excessDataGas = opts.parentBlock.header.calcNextExcessDataGas()
    }
  }

  /**
   * Throws if the block has already been built or reverted.
   */
  private checkStatus() {
    if (this.blockStatus.status === BuildStatus.Build) {
      throw new Error('Block has already been built')
    }
    if (this.blockStatus.status === BuildStatus.Reverted) {
      throw new Error('State has already been reverted')
    }
  }

  public getStatus(): BlockStatus {
    return this.blockStatus
  }

  /**
   * Calculates and returns the transactionsTrie for the block.
   */
  public async transactionsTrie() {
    return Block.genTransactionsTrieRoot(this.transactions)
  }

  /**
   * Calculates and returns the logs bloom for the block.
   */
  public logsBloom() {
    const bloom = new Bloom()
    for (const txResult of this.transactionResults) {
      // Combine blooms via bitwise OR
      bloom.or(txResult.bloom)
    }
    return bloom.bitvector
  }

  /**
   * Calculates and returns the receiptTrie for the block.
   */
  public async receiptTrie() {
    const receiptTrie = new Trie()
    for (const [i, txResult] of this.transactionResults.entries()) {
      const tx = this.transactions[i]
      const encodedReceipt = encodeReceipt(txResult.receipt, tx.type)
      await receiptTrie.put(RLP.encode(i), encodedReceipt)
    }
    return receiptTrie.root()
  }

  /**
   * Adds the block miner reward to the coinbase account.
   */
  private async rewardMiner() {
    const minerReward = this.vm.common.param('pow', 'minerReward')
    const reward = calculateMinerReward(minerReward, 0)
    const coinbase =
      this.headerData.coinbase !== undefined
        ? new Address(toBytes(this.headerData.coinbase))
        : Address.zero()
    await rewardAccount(this.vm.evm, coinbase, reward)
  }

  /**
   * Adds the withdrawal amount to the withdrawal address
   */
  private async processWithdrawals() {
    for (const withdrawal of this.withdrawals ?? []) {
      const { address, amount } = withdrawal
      // If there is no amount to add, skip touching the account
      // as per the implementation of other clients geth/nethermind
      // although this should never happen as no withdrawals with 0
      // amount should ever land up here.
      if (amount === 0n) continue
      // Withdrawal amount is represented in Gwei so needs to be
      // converted to wei
      await rewardAccount(this.vm.evm, address, amount * GWEI_TO_WEI)
    }
  }

  /**
   * Run and add a transaction to the block being built.
   * Please note that this modifies the state of the VM.
   * Throws if the transaction's gasLimit is greater than
   * the remaining gas in the block.
   */
  async addTransaction(
    tx: TypedTransaction,
    { skipHardForkValidation }: { skipHardForkValidation?: boolean } = {}
  ) {
    this.checkStatus()

    if (!this.checkpointed) {
      await this.vm.evm.journal.checkpoint()
      this.checkpointed = true
    }

    // According to the Yellow Paper, a transaction's gas limit
    // cannot be greater than the remaining gas in the block
    const blockGasLimit = toType(this.headerData.gasLimit, TypeOutput.BigInt)

    const dataGasLimit = this.vm.common.param('gasConfig', 'maxDataGasPerBlock')
    const dataGasPerBlob = this.vm.common.param('gasConfig', 'dataGasPerBlob')

    const blockGasRemaining = blockGasLimit - this.gasUsed
    if (tx.gasLimit > blockGasRemaining) {
      throw new Error('tx has a higher gas limit than the remaining gas in the block')
    }
    let dataGasUsed = undefined
    if (tx instanceof BlobEIP4844Transaction) {
      if (this.blockOpts.common?.isActivatedEIP(4844) !== true) {
        throw Error('eip4844 not activated yet for adding a blob transaction')
      }
      const blobTx = tx as BlobEIP4844Transaction

      // Guard against the case if a tx came into the pool without blobs i.e. network wrapper payload
      if (blobTx.blobs === undefined) {
        throw new Error('blobs missing for 4844 transaction')
      }

      if (this.dataGasUsed + BigInt(blobTx.numBlobs()) * dataGasPerBlob > dataGasLimit) {
        throw new Error('block data gas limit reached')
      }

      dataGasUsed = this.dataGasUsed
    }
    const header = {
      ...this.headerData,
      gasUsed: this.gasUsed,
      // correct excessDataGas should already part of headerData used above
      dataGasUsed,
    }

    const blockData = { header, transactions: this.transactions }
    const block = Block.fromBlockData(blockData, this.blockOpts)

    const result = await this.vm.runTx({ tx, block, skipHardForkValidation })

    // If tx is a blob transaction, remove blobs/kzg commitments before adding to block per EIP-4844
    if (tx instanceof BlobEIP4844Transaction) {
      const txData = tx as BlobEIP4844Transaction
      this.dataGasUsed += BigInt(txData.versionedHashes.length) * dataGasPerBlob
      tx = BlobEIP4844Transaction.minimalFromNetworkWrapper(txData, {
        common: this.blockOpts.common,
      })
    }
    this.transactions.push(tx)
    this.transactionResults.push(result)
    this.gasUsed += result.totalGasSpent
    this._minerValue += result.minerValue

    return result
  }

  /**
   * Reverts the checkpoint on the StateManager to reset the state from any transactions that have been run.
   */
  async revert() {
    if (this.checkpointed) {
      await this.vm.evm.journal.revert()
      this.checkpointed = false
    }
    this.blockStatus = { status: BuildStatus.Reverted }
  }

  /**
   * This method returns the finalized block.
   * It also:
   *  - Assigns the reward for miner (PoW)
   *  - Commits the checkpoint on the StateManager
   *  - Sets the tip of the VM's blockchain to this block
   * For PoW, optionally seals the block with params `nonce` and `mixHash`,
   * which is validated along with the block number and difficulty by ethash.
   * For PoA, please pass `blockOption.cliqueSigner` into the buildBlock constructor,
   * as the signer will be awarded the txs amount spent on gas as they are added.
   */
  async build(sealOpts?: SealBlockOpts) {
    this.checkStatus()
    const blockOpts = this.blockOpts
    const consensusType = this.vm.common.consensusType()

    if (consensusType === ConsensusType.ProofOfWork) {
      await this.rewardMiner()
    }
    await this.processWithdrawals()

    const stateRoot = await this.vm.stateManager.getStateRoot()
    const transactionsTrie = await this.transactionsTrie()
    const withdrawalsRoot = this.withdrawals
      ? await Block.genWithdrawalsTrieRoot(this.withdrawals)
      : undefined
    const receiptTrie = await this.receiptTrie()
    const logsBloom = this.logsBloom()
    const gasUsed = this.gasUsed
    const timestamp = this.headerData.timestamp ?? Math.round(Date.now() / 1000)

    let dataGasUsed = undefined
    if (this.vm.common.isActivatedEIP(4844) === true) {
      dataGasUsed = this.dataGasUsed
    }

    const headerData = {
      ...this.headerData,
      stateRoot,
      transactionsTrie,
      withdrawalsRoot,
      receiptTrie,
      logsBloom,
      gasUsed,
      timestamp,
      // correct excessDataGas should already be part of headerData used above
      dataGasUsed,
    }

    if (consensusType === ConsensusType.ProofOfWork) {
      headerData.nonce = sealOpts?.nonce ?? headerData.nonce
      headerData.mixHash = sealOpts?.mixHash ?? headerData.mixHash
    }

    const blockData = {
      header: headerData,
      transactions: this.transactions,
      withdrawals: this.withdrawals,
    }
    const block = Block.fromBlockData(blockData, blockOpts)

    if (this.blockOpts.putBlockIntoBlockchain === true) {
      await this.vm.blockchain.putBlock(block)
    }

    this.blockStatus = { status: BuildStatus.Build, block }
    if (this.checkpointed) {
      await this.vm.evm.journal.commit()
      this.checkpointed = false
    }

    return block
  }
}

export async function buildBlock(this: VM, opts: BuildBlockOpts): Promise<BlockBuilder> {
  // let opts override excessDataGas if there is some value passed there
  return new BlockBuilder(this, opts)
}
