import { BIGINT_0, BIGINT_1 } from './constants.js'
import { EthereumJSErrorWithoutCode } from './errors.js'

/** Conversion constants to wei */
export const GWEI_TO_WEI = BigInt(10 ** 9) // Multiplier to convert from Gwei to Wei
export const ETHER_TO_WEI = BigInt(10 ** 18) // Multiplier to convert from Ether to Wei

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
      throw EthereumJSErrorWithoutCode('Input must be an integer number')
    }
    if (BigInt(amount) < 0) {
      throw EthereumJSErrorWithoutCode('Input must be a positive number')
    }
  }

  /**
   * Convert a number or bigint input of ether to wei
   *
   * @param {number | bigint} amount amount of units of ether to convert to wei
   * @returns {bigint} amount of units in wei
   */
  static ether(amount: number | bigint): bigint {
    Units.validateInput(amount)
    return BigInt(amount) * ETHER_TO_WEI
  }

  /**
   * Convert a number or bigint input of gwei to wei
   *
   * @param amount amount of units of gwei to convert to wei
   * @returns {bigint} amount of units in wei
   */
  static gwei(amount: number | bigint): bigint {
    Units.validateInput(amount)
    return BigInt(amount) * GWEI_TO_WEI
  }
}
