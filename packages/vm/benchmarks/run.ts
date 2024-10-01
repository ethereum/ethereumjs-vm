import { bytecode } from './bytecode.js'
import * as yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import Benchmark from 'benchmark'
import { BenchmarksType } from './util.js'
import { mainnetBlocks } from './mainnetBlocks.js'

// Add an import and a BENCHMARKS entry to list a new benchmark
const BENCHMARKS: BenchmarksType = {
  mainnetBlocks: {
    function: mainnetBlocks,
  },
  bytecode: {
    function: bytecode,
  },
}

async function main() {
  // Argument parsing
  const args = yargs
    .default(hideBin(process.argv))
    .command('benchmarks <benchmarks>', 'Run benchmarks', (yargs) => {
      yargs.positional('benchmarks', {
        describe: `Name(s) of benchmarks to run: BENCHMARK_NAME[:NUM_SAMPLES][,BENCHMARK_NAME[:NUM_SAMPLES]]. Benchmarks available: ${Object.keys(
          BENCHMARKS
        ).join(', ')}`,
        type: 'string',
        required: true,
      })
    })
    .option('bytecode', {
      alias: 'b',
      describe: 'Bytecode to run',
      type: 'string',
    })
    .option('preState', {
      alias: 'p',
      describe: 'File containing prestate to load',
      type: 'string',
    })
    .option('csv', {
      alias: 'c',
      describe: 'Output results as CSV',
      type: 'boolean',
      default: false,
    })
    .help()
    .parse()

  const benchmarksStr = (args as any).benchmarks
  const bytecode = (args as any).bytecode
  const preState = (args as any).preState
  const csv = (args as any).csv

  if (!benchmarksStr) {
    console.log('No benchmarks to run, exiting...')
    return
  }

  // Benchmark execution
  const benchmarks = benchmarksStr.split(',')
  for (const benchmark of benchmarks) {
    const [name, numSamples] = benchmark.split(':')

    if (name in BENCHMARKS) {
      if (!csv) {
        console.log(`Running '${name}':`)
        console.log(`  Number of samples: ${numSamples}`)
        console.log(`  Bytecode: ${bytecode}`)
        console.log(`  Prestate: ${preState}`)
      }
      const results = await BENCHMARKS[name].function(Number(numSamples), bytecode, preState)
      if (csv) {
        console.log(Object.keys(results[0]!).join())
        for (const result of results) {
          console.log(Object.values(result!).join())
        }
      } else {
        console.table(results)
      }
    } else {
      console.log(`Benchmark with name ${name} doesn't exist, skipping...`)
    }
  }

  if (!csv) {
    console.log('Benchmark run finished.')
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e: Error) => {
    throw e
  })
