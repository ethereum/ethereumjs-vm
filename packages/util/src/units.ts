import { BIGINT_0, BIGINT_1 } from './constants.js'

/** Easy conversion from Gwei to wei */
export const GWEI_TO_WEI = BigInt(1000000000)
export const WEI_TO_EITHER = BigInt(10 ** 18)
export const WIE_TO_GWEI = BigInt(10 ** 9)

export function formatBigDecimal(
  numerator: bigint,
  denominator: bigint,
  maxDecimalFactor: bigint,
): string {
  if (denominator === BIGINT_0) {
    denominator = BIGINT_1
  }

  const full = numerator / denominator
  const fraction = ((numerator - full * denominator) * maxDecimalFactor) / denominator

  // zeros to be added post decimal are number of zeros in maxDecimalFactor - number of digits in fraction
  const zerosPostDecimal = String(maxDecimalFactor).length - 1 - String(fraction).length
  return `${full}.${'0'.repeat(zerosPostDecimal)}${fraction}`
}

export class Units {
  static validateInput(amount: number | bigint): void {
    if (typeof amount === 'number' && !Number.isInteger(amount)) {
      throw new Error('Input must be an integer number')
    }
    if (BigInt(amount) < 0) {
      throw new Error('Input must be a positive number')
    }
  }

  static ether(amount: number | bigint): bigint {
    Units.validateInput(amount)
    return BigInt(amount) * WEI_TO_EITHER
  }

  static gwei(amount: number | bigint): bigint {
    Units.validateInput(amount)
    return BigInt(amount) * WIE_TO_GWEI
  }
}
