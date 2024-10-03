import { assert, describe, it } from 'vitest'

import { getLogger } from '../src/logging.js'

describe('[Logging]', () => {
  const logger = getLogger({ logLevel: 'info', logFile: 'ethereumjs.log', logLevelFile: 'info' })
  const format = logger.transports.find((t: any) => t.name === 'console')!.format!

  it('should have correct transports', () => {
    assert.ok(
      logger.transports.find((t: any) => t.name === 'console') !== undefined,
      'should have stdout transport',
    )
    assert.ok(
      logger.transports.find((t: any) => t.name === 'file') !== undefined,
      'should have file transport',
    )
  })

  it('should log error stacks properly', () => {
    try {
      throw new Error('an error')
    } catch (e) {
      if (!(e instanceof Error)) {
        e = new Error(e)
      }
      e.level = 'error'
      assert.ok(
        /an error\n {4}at/.test((format.transform(e) as any).message),
        'log message should contain stack trace (1)',
      )
      assert.ok(
        /an error\n {4}at/.test((format.transform({ level: 'error', message: e }) as any).message),
        'log message should contain stack trace (2)',
      )
    }
  })

  it('should colorize key=value pairs', () => {
    if (process.env.GITHUB_ACTION !== undefined) {
      assert.ok(true, 'no color functionality in ci')
      return
    }
    const { message } = format.transform({
      level: 'info',
      message: 'test key=value',
    }) as any
    assert.equal(
      message,
      'test \x1B[38;2;0;128;0mkey\x1B[39m=value ', // cspell:disable-line
      'key=value pairs should be colorized',
    )
  })
})
