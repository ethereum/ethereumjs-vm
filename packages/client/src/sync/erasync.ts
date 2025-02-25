import { blockFromTuple, parseBlockTuple, readBinaryFile, readERA1 } from '@ethereumjs/era'
import { readdirSync } from 'fs'

import { DBKey } from '../util/metaDBManager.js'

import type { Config, EthereumClient } from '../index.js'
// import type { Block } from '@ethereumjs/block'

export async function eraSync(
  client: EthereumClient,
  config: Config,
  args: { loadBlocksFromEra1: string },
) {
  await client.chain.open()
  const service = client.service
  await service.execution.open()
  const eraDir = readdirSync(args.loadBlocksFromEra1)
    .filter((file) => file.endsWith('.era1'))
    .sort()
  for (const file of eraDir) {
    config.logger.info(`Loading era1 file ${file}`)
    const era1File = readBinaryFile(args.loadBlocksFromEra1 + '/' + file)
    const blockTuples = await readERA1(era1File)
    for await (const tuple of blockTuples) {
      const { header, body, receipts } = await parseBlockTuple(tuple)
      const block = blockFromTuple({ header, body })
      await client.chain.blockchain.putBlock(block)
      if (config.saveReceipts && service.execution.receiptsManager) {
        await service.execution.receiptsManager?.put(DBKey.Receipts, block.hash(), receipts)
        void service.execution.receiptsManager['updateIndex'](0, 0, block)
      }
    }
    await client.chain.update(false)
    await service.execution.run()
  }
}
