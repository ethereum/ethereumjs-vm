import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'

type EVMPerformanceLogEntry = {
  calls: number
  time: number
  gasUsed: number
  staticGas?: number
  dynamicGasUsed?: number
}

export type EVMPerformanceLogOutput = {
  calls: number // Amount this opcode/precompile was called
  totalTime: number // Amount of seconds taken for this opcode/precompile (rounded to 3 digits)
  avgTimePerCall: number // Avg time per call of this opcode/precompile (rounded to 3 digits)
  gasUsed: number // Total amount of gas used by this opcode/precompile
  millionGasPerSecond: number // How much million gas is executed per second (rounded to 3 digits)
  blocksPerSlot: number // How many blocks is executed per beacon chain slot (rounded to 3 digits)
  tag: string // opcode/precompile tag
  staticGasUsed?: number // total static gas units spent
  dynamicGasUsed?: number // total dynamic gas units spent
  staticGas?: number // static gas of the opcode
}

type EVMPerformanceLogs = {
  [tag: string]: EVMPerformanceLogEntry
}

const blockGasLimit = 30_000_000 // Block gas limit
const slotTime = 12 // Time in seconds per slot

// Normalize constant to check if execution time is above one block per slot (>=1) or not (<1)
const bpsNormalizer = blockGasLimit / slotTime

export class Timer {
  private startTime: number
  private runTime = 0
  tag: string

  constructor(tag: string) {
    this.tag = tag
    this.startTime = performance.now()
  }

  pause() {
    this.runTime = this.runTime + performance.now() - this.startTime
  }

  unpause() {
    this.startTime = performance.now()
  }

  time() {
    return (performance.now() - this.startTime + this.runTime) / 1000
  }
}

export class EVMPerformanceLogger {
  private opcodes!: EVMPerformanceLogs
  private precompiles!: EVMPerformanceLogs

  private currentTimer?: Timer

  constructor() {
    this.clear()
  }

  clear() {
    this.opcodes = {}
    this.precompiles = {}
  }

  getLogs() {
    // Return nicely formatted logs
    function getLogsFor(obj: EVMPerformanceLogs) {
      const output: EVMPerformanceLogOutput[] = []
      for (const key in obj) {
        const field = obj[key]
        const gasPerSecond = field.gasUsed / field.time
        const entry: EVMPerformanceLogOutput = {
          calls: field.calls,
          totalTime: Math.round(field.time * 1e6) / 1e3,
          avgTimePerCall: Math.round((field.time / field.calls) * 1e6) / 1e3,
          gasUsed: field.gasUsed,
          millionGasPerSecond: Math.round(gasPerSecond / 1e3) / 1e3,
          blocksPerSlot: Math.round((gasPerSecond / bpsNormalizer) * 1e3) / 1e3,
          tag: key,
        }
        if (field.dynamicGasUsed !== undefined) {
          // This is an opcode entry
          entry.staticGas = field.staticGas
          entry.staticGasUsed = field.staticGas! * field.calls
          entry.dynamicGasUsed = field.dynamicGasUsed
        }
        output.push(entry)
      }

      output.sort((a, b) => {
        return b.millionGasPerSecond - a.millionGasPerSecond
      })

      return output
    }

    return {
      opcodes: getLogsFor(this.opcodes),
      precompiles: getLogsFor(this.precompiles),
    }
  }

  hasTimer() {
    return this.currentTimer !== undefined
  }

  // Start a new timer
  // Only one timer can be timing at the same time
  startTimer(tag: string) {
    if (this.currentTimer !== undefined) {
      throw EthereumJSErrorWithoutCode('Cannot have two timers running at the same time')
    }

    this.currentTimer = new Timer(tag)
    return this.currentTimer
  }

  // Pauses current timer and returns that timer
  pauseTimer() {
    const timer = this.currentTimer
    if (timer === undefined) {
      throw EthereumJSErrorWithoutCode('No timer to pause')
    }
    timer.pause()
    this.currentTimer = undefined
    return timer
  }

  // Unpauses current timer and returns that timer
  unpauseTimer(timer: Timer) {
    if (this.currentTimer !== undefined) {
      throw EthereumJSErrorWithoutCode('Cannot unpause timer: another timer is already running')
    }
    timer.unpause()
    this.currentTimer = timer
  }

  // Stops a timer from running
  stopTimer(
    timer: Timer,
    gasUsed: number,
    targetTimer: 'precompiles' | 'opcodes' = 'opcodes',
    staticGas?: number,
    dynamicGas?: number,
  ) {
    if (this.currentTimer === undefined || this.currentTimer !== timer) {
      throw EthereumJSErrorWithoutCode('Cannot stop timer: another timer is already running')
    }
    const time = timer.time()
    const tag = timer.tag
    this.currentTimer = undefined

    // Update the fields
    const target = this[targetTimer]
    if (target[tag] === undefined) {
      target[tag] = {
        calls: 0,
        time: 0,
        gasUsed: 0,
      }
    }
    const obj = target[tag]

    obj.calls++
    obj.time += time
    obj.gasUsed += gasUsed

    if (targetTimer === 'opcodes') {
      obj.staticGas = staticGas
      obj.dynamicGasUsed = (obj.dynamicGasUsed ?? 0) + dynamicGas!
    }
  }
}
