import { Block, createBlockFromRPC } from '@ethereumjs/block'
import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { createVM, runBlock as runBlockVM, VM } from '@ethereumjs/vm'
import Benchmark from 'benchmark'
import { readFileSync } from 'fs'
import { getBlockchain, getPreState, verifyResult } from './util.js'
import { Bench } from 'tinybench'

const BLOCK_FIXTURE = 'benchmarks/fixture/blocks-prestate.json'

const runBlock = async (vm: VM, block: Block, receipts: any) => {
  await runBlockVM(await vm.shallowCopy(), {
    block,
    generate: true,
    skipBlockValidation: true,
  })
  verifyResult(block, receipts)
}

export async function mainnetBlocks(numSamples?: number) {
  let data = JSON.parse(readFileSync(BLOCK_FIXTURE, 'utf8'))
  if (!Array.isArray(data)) data = [data]
  console.log(`Total number of blocks in data set: ${data.length}`)

  numSamples = numSamples ?? data.length
  console.log(`Number of blocks to sample: ${numSamples}`)
  data = data.slice(0, numSamples)

  const common = new Common({ chain: Mainnet, hardfork: Hardfork.MuirGlacier })

  const bench = new Bench({
    time: 10000,
  })

  for (const blockData of data) {
    const block = createBlockFromRPC(blockData.block, [], { common })
    const blockNumber = Number(block.header.number)
    const { receipts, preState, blockhashes } = blockData

    if ([9422909, 9422911, 9422912, 9422913, 9422914].includes(blockNumber)) {
      // Skip problematic blocks that in normal ci operation
      // sometimes exceeds the alert threshold by 2-2.5x, could use more
      // investigation to determine exactly why this is happening.
      // https://github.com/ethereumjs/ethereumjs-monorepo/pull/1546
      continue
    }

    const stateManager = await getPreState(preState, common)
    const blockchain = getBlockchain(blockhashes) as any
    const vm = await createVM({ stateManager, common, blockchain })

    bench.add('block ' + blockNumber.toString(), async () => {
      await runBlock(vm, block, receipts)
    })
  }

  await bench.warmup()
  await bench.run()

  return bench.table()
}
