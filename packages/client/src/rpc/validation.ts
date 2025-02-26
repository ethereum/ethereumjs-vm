import { EthereumJSErrorWithoutCode } from '@ethereumjs/util'

import { INVALID_PARAMS } from './error-code.js'

import type { RPCMethod } from './types.js'

/**
 * middleware for parameters validation
 * @memberof module:rpc
 * @param method function to add middleware
 * @param requiredParamsCount required parameters count
 * @param validators array of validators
 * @param names Optional parameter names for error messages, length must be equal to requiredParamsCount
 */
export function middleware(
  method: any,
  requiredParamsCount: number,
  validators: any[] = [],
  names: string[] = [],
): RPCMethod {
  return function (params: any[] = []) {
    return new Promise((resolve, reject) => {
      if (params.length < requiredParamsCount) {
        const error = {
          code: INVALID_PARAMS,
          message: `missing value for required argument ${names[params.length] ?? params.length}`,
        }
        return reject(error)
      }
      for (let i = 0; i < validators.length; i++) {
        if (validators[i] !== undefined) {
          for (let j = 0; j < validators[i].length; j++) {
            // Only apply validators if params[i] is a required parameter or exists
            if (i < requiredParamsCount || params[i] !== undefined) {
              const error = validators[i][j](params, i)
              if (error !== undefined) {
                return reject(error)
              }
            }
          }
        }
      }

      resolve(method(params))
    })
  }
}

function bytes(bytes: number, params: any[], index: number) {
  if (typeof params[index] !== 'string') {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: argument must be a hex string`,
    }
  }

  if (params[index].substr(0, 2) !== '0x') {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: hex string without 0x prefix`,
    }
  }
  if (params[index].length > 2 && !/^[0-9a-fA-F]+$/.test(params[index].substr(2))) {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: argument must be a hex string`,
    }
  }
  if (params[index].substr(2).length > bytes * 2) {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: expected ${bytes} byte value`,
    }
  }
}

function uint(uint: number, params: any[], index: number) {
  if (uint % 8 !== 0) {
    // Sanity check
    throw EthereumJSErrorWithoutCode(`Uint should be a multiple of 8, got: ${uint}`)
  }
  if (typeof params[index] !== 'string') {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: argument must be a hex string`,
    }
  }

  if (params[index].substr(0, 2) !== '0x') {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: hex string without 0x prefix`,
    }
  }
  if (params[index].length > 2 && !/^[0-9a-fA-F]+$/.test(params[index].substr(2))) {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: argument must be a hex string`,
    }
  }
  if (params[index].substr(2).length > (uint / 8) * 2) {
    return {
      code: INVALID_PARAMS,
      message: `invalid argument ${index}: expected ${uint} bit value`,
    }
  }
}

/**
 * @memberof module:rpc
 */
export const validators = {
  /**
   * address validator to ensure has `0x` prefix and 20 bytes length
   * @param params parameters of method
   * @param index index of parameter
   */
  get address() {
    return (params: any[], index: number) => {
      if (typeof params[index] !== 'string') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument must be a hex string`,
        }
      }

      if (params[index].substr(0, 2) !== '0x') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: missing 0x prefix`,
        }
      }

      const address = params[index].substr(2)

      if (!/^[0-9a-fA-F]+$/.test(address) || address.length !== 40) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: invalid address`,
        }
      }
    }
  },

  /**
   * hex validator to ensure has `0x` prefix
   * @param params parameters of method
   * @param index index of parameter
   */
  get hex() {
    return (params: any[], index: number) => {
      if (typeof params[index] !== 'string') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument must be a hex string`,
        }
      }

      if (params[index].substr(0, 2) !== '0x') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: hex string without 0x prefix`,
        }
      }
    }
  },

  get bytes8() {
    return (params: any[], index: number) => bytes(8, params, index)
  },
  get bytes16() {
    return (params: any[], index: number) => bytes(16, params, index)
  },
  get bytes20() {
    return (params: any[], index: number) => bytes(20, params, index)
  },
  get bytes32() {
    return (params: any[], index: number) => bytes(32, params, index)
  },
  get variableBytes32() {
    return (params: any[], index: number) => bytes(32, params, index)
  },
  get bytes48() {
    return (params: any[], index: number) => bytes(48, params, index)
  },
  get bytes96() {
    return (params: any[], index: number) => bytes(96, params, index)
  },
  get bytes256() {
    return (params: any[], index: number) => bytes(256, params, index)
  },
  get uint64() {
    return (params: any[], index: number) => uint(64, params, index)
  },
  get uint256() {
    return (params: any[], index: number) => uint(256, params, index)
  },
  get blob() {
    // "each blob is FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT = 4096 * 32 = 131072"
    // See: https://github.com/ethereum/execution-apis/blob/b7c5d3420e00648f456744d121ffbd929862924d/src/engine/experimental/blob-extension.md
    return (params: any[], index: number) => bytes(131072, params, index)
  },

  /**
   * Validator to ensure a valid integer [0, Number.MAX_SAFE_INTEGER], represented as a `number`.
   * @returns A validator function with parameters:
   *   - @param params Parameters of the method.
   *   - @param index The index of the parameter.
   */
  get unsignedInteger() {
    return (params: any[], index: number) => {
      // This check guards against non-number types, decimal numbers,
      // numbers that are too large (or small) to be represented exactly,
      // NaN, null, and undefined.
      if (!Number.isSafeInteger(params[index])) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument must be an integer`,
        }
      }

      if (params[index] < 0) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument must be larger than 0`,
        }
      }
    }
  },

  /**
   * hex validator to validate block hash
   * @param params parameters of method
   * @param index index of parameter
   */
  get blockHash() {
    return (params: any[], index: number) => {
      if (typeof params[index] !== 'string') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument must be a hex string`,
        }
      }

      if (params[index].substr(0, 2) !== '0x') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: hex string without 0x prefix`,
        }
      }

      const blockHash = params[index].substring(2)

      if (!/^[0-9a-fA-F]+$/.test(blockHash) || blockHash.length !== 64) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: invalid block hash`,
        }
      }
    }
  },

  /**
   * validator to ensure valid block integer or hash, or string option ["latest", "earliest", "pending"]
   * @param params parameters of method
   * @param index index of parameter
   */
  get blockOption() {
    return (params: any[], index: number) => {
      if (typeof params[index] !== 'string') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument must be a string`,
        }
      }

      const blockOption = params[index]

      if (!['latest', 'finalized', 'safe', 'earliest', 'pending'].includes(blockOption)) {
        if (blockOption.substr(0, 2) === '0x') {
          const hash = this.blockHash([blockOption], 0)
          // todo: make integer validator?
          const integer = this.hex([blockOption], 0)
          // valid if undefined
          if (hash === undefined || integer === undefined) {
            // valid
            return
          }
        }
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: block option must be a valid 0x-prefixed block hash or hex integer, or "latest", "earliest" or "pending"`,
        }
      }
    }
  },

  /**
   * bool validator to check if type is boolean
   * @param params parameters of method
   * @param index index of parameter
   */
  get bool() {
    return (params: any[], index: number) => {
      if (typeof params[index] !== 'boolean') {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument is not boolean`,
        }
      }
    }
  },

  /**
   * bool validator to check if type is valid ipv4 address
   * @param params parameters of method
   * @param index index of parameter
   */
  get ipv4Address() {
    // regex from https://stackoverflow.com/questions/5284147/validating-ipv4-addresses-with-regexp
    const ipv4Regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/

    return (params: any[], index: number) => {
      if (!ipv4Regex.test(params[index])) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument is not ipv4 address`,
        }
      }
    }
  },

  /**
   * number validator to check if type is integer
   * @param params parameters of method
   * @param index index of parameter
   */
  get integer() {
    return (params: any[], index: number) => {
      if (!Number.isInteger(params[index])) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument is not an integer`,
        }
      }
    }
  },

  /**
   * validator to ensure required transaction fields are present, and checks for valid address and hex values.
   * @param requiredFields array of required fields
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get transaction() {
    return (requiredFields: string[] = []) => {
      return (params: any[], index: number) => {
        if (typeof params[index] !== 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument must be an object`,
          }
        }

        const tx = params[index]

        for (const field of requiredFields) {
          if (tx[field] === undefined) {
            return {
              code: INVALID_PARAMS,
              message: `invalid argument ${index}: required field ${field}`,
            }
          }
        }

        const validate = (field: any, validator: Function) => {
          if (field === undefined) return
          const v = validator([field], 0)
          if (v !== undefined) return v
        }

        // validate addresses
        for (const field of [tx.to, tx.from]) {
          const v = validate(field, this.address)
          if (v !== undefined) return v
        }

        // validate hex
        const hexFields = { gas: tx.gas, gasPrice: tx.gasPrice, value: tx.value, data: tx.data }
        for (const field of Object.entries(hexFields)) {
          const v = validate(field[1], this.hex)
          if (v !== undefined) {
            return {
              code: INVALID_PARAMS,
              message: `invalid argument ${field[0]}:${v.message.split(':')[1]}`,
            }
          }
        }
      }
    }
  },

  /**
   * validator to ensure required withdrawal fields are present, and checks for valid address and hex values
   * for the other quantity based fields
   * @param requiredFields array of required fields
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get withdrawal() {
    return (requiredFields: string[] = ['index', 'validatorIndex', 'address', 'amount']) => {
      return (params: any[], index: number) => {
        if (typeof params[index] !== 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument must be an object`,
          }
        }

        const wt = params[index]

        for (const field of requiredFields) {
          if (wt[field] === undefined) {
            return {
              code: INVALID_PARAMS,
              message: `invalid argument ${index}: required field ${field}`,
            }
          }
        }

        const validate = (field: any, validator: Function) => {
          if (field === undefined) return
          const v = validator([field], 0)
          if (v !== undefined) return v
        }

        // validate addresses
        for (const field of [wt.address]) {
          const v = validate(field, this.address)
          if (v !== undefined) return v
        }

        // validate hex
        for (const field of [wt.index, wt.validatorIndex, wt.amount]) {
          const v = validate(field, this.hex)
          if (v !== undefined) return v
        }
      }
    }
  },

  get depositRequest() {
    return (
      requiredFields: string[] = [
        'pubkey',
        'withdrawalCredentials',
        'amount',
        'signature',
        'index',
      ],
    ) => {
      return (params: any[], index: number) => {
        if (typeof params[index] !== 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument must be an object`,
          }
        }

        const clReq = params[index]

        for (const field of requiredFields) {
          if (clReq[field] === undefined) {
            return {
              code: INVALID_PARAMS,
              message: `invalid argument ${index}: required field ${field}`,
            }
          }
        }

        const validate = (field: any, validator: Function) => {
          if (field === undefined) return
          const v = validator([field], 0)
          if (v !== undefined) return v
        }

        // validate pubkey
        for (const field of [clReq.pubkey]) {
          const v = validate(field, this.bytes48)
          if (v !== undefined) return v
        }

        // validate withdrawalCredentials
        for (const field of [clReq.withdrawalCredentials]) {
          const v = validate(field, this.bytes32)
          if (v !== undefined) return v
        }

        // validate amount, index
        for (const field of [clReq.amount, clReq.index]) {
          const v = validate(field, this.bytes8)
          if (v !== undefined) return v
        }

        // validate signature
        for (const field of [clReq.signature]) {
          const v = validate(field, this.bytes96)
          if (v !== undefined) return v
        }
      }
    }
  },

  get withdrawalRequest() {
    return (requiredFields: string[] = ['sourceAddress', 'validatorPubkey', 'amount']) => {
      return (params: any[], index: number) => {
        if (typeof params[index] !== 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument must be an object`,
          }
        }

        const clReq = params[index]

        for (const field of requiredFields) {
          if (clReq[field] === undefined) {
            return {
              code: INVALID_PARAMS,
              message: `invalid argument ${index}: required field ${field}`,
            }
          }
        }

        const validate = (field: any, validator: Function) => {
          if (field === undefined) return
          const v = validator([field], 0)
          if (v !== undefined) return v
        }

        // validate sourceAddress
        for (const field of [clReq.sourceAddress]) {
          const v = validate(field, this.address)
          if (v !== undefined) return v
        }

        // validate validatorPubkey
        for (const field of [clReq.validatorPubkey]) {
          const v = validate(field, this.bytes48)
          if (v !== undefined) return v
        }

        // validate amount
        for (const field of [clReq.amount]) {
          const v = validate(field, this.bytes8)
          if (v !== undefined) return v
        }
      }
    }
  },

  get consolidationRequest() {
    return (requiredFields: string[] = ['sourceAddress', 'sourcePubkey', 'targetPubkey']) => {
      return (params: any[], index: number) => {
        if (typeof params[index] !== 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument must be an object`,
          }
        }

        const clReq = params[index]

        for (const field of requiredFields) {
          if (clReq[field] === undefined) {
            return {
              code: INVALID_PARAMS,
              message: `invalid argument ${index}: required field ${field}`,
            }
          }
        }

        const validate = (field: any, validator: Function) => {
          if (field === undefined) return
          const v = validator([field], 0)
          if (v !== undefined) return v
        }

        // validate sourceAddress
        for (const field of [clReq.sourceAddress]) {
          const v = validate(field, this.address)
          if (v !== undefined) return v
        }

        // validate validatorPubkey
        for (const field of [clReq.sourcePubkey]) {
          const v = validate(field, this.bytes48)
          if (v !== undefined) return v
        }

        // validate amount
        for (const field of [clReq.targetPubkey]) {
          const v = validate(field, this.bytes48)
          if (v !== undefined) return v
        }
      }
    }
  },

  /**
   * object validator to check if type is object with
   * required keys and expected validation of values
   * @param form object with keys and values of validators
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get object() {
    return (form: { [key: string]: Function }) => {
      return (params: any[], index: number) => {
        if (typeof params[index] !== 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument is not object`,
          }
        }
        for (const [key, validator] of Object.entries(form)) {
          const value = params[index][key]
          const result = validator([value], 0)
          if (result !== undefined) {
            // add key to message for context
            const originalMessage = result.message.split(':')
            const message = `invalid argument ${index} for key '${key}':${originalMessage[1]}`
            return { ...result, message }
          }
        }
      }
    }
  },

  /**
   * array validator to check if each element
   * of the array passes the passed-in validator
   * @param validator validator to check against the elements of the array
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get array() {
    return (validator: Function) => {
      return (params: any[], index: number) => {
        if (!Array.isArray(params[index])) {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument is not array`,
          }
        }
        for (const value of params[index]) {
          const result = validator([value], 0)
          if (result !== undefined) return result
        }
      }
    }
  },

  /**
   * Verification of rewardPercentile value
   *
   * description: Floating point value between 0 and 100.
   * type: number
   *
   */
  get rewardPercentile() {
    return (params: any[], i: number) => {
      const ratio = params[i]
      if (typeof ratio !== 'number') {
        return {
          code: INVALID_PARAMS,
          message: `entry at ${i} is not a number`,
        }
      }
      if (ratio < 0) {
        return {
          code: INVALID_PARAMS,
          message: `entry at ${i} is lower than 0`,
        }
      }
      if (ratio > 100) {
        return {
          code: INVALID_PARAMS,
          message: `entry at ${i} is higher than 100`,
        }
      }
      return ratio
    }
  },

  /**
   * Verification of rewardPercentiles array
   *
   *  description: A monotonically increasing list of percentile values. For each block in the requested range, the transactions will be sorted in ascending order by effective tip per gas and the corresponding effective tip for the percentile will be determined, accounting for gas consumed.
   *  type: array
   *    items: rewardPercentile value
   *
   */
  get rewardPercentiles() {
    return (params: any[], index: number) => {
      const field = params[index]
      if (!Array.isArray(field)) {
        return {
          code: INVALID_PARAMS,
          message: `invalid argument ${index}: argument is not array`,
        }
      }
      let low = -1
      for (let i = 0; i < field.length; i++) {
        const ratio = this.rewardPercentile(field, i)
        if (typeof ratio === 'object') {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: ${ratio.message}`,
          }
        }
        if (ratio <= low) {
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: array is not monotonically increasing`,
          }
        }
        low = ratio
      }
    }
  },

  /**
   * validator to ensure that contains one of the string values
   * @param values array of possible values
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get values() {
    return (values: string[]) => {
      return (params: any[], index: number) => {
        if (!values.includes(params[index])) {
          const valueOptions = '[' + values.map((v) => `"${v}"`).join(', ') + ']'
          return {
            code: INVALID_PARAMS,
            message: `invalid argument ${index}: argument is not one of ${valueOptions}`,
          }
        }
      }
    }
  },

  /**
   * Validator to allow validation of an optional value
   * @param validator validator to check against the value
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get optional() {
    return (validator: any) => {
      return (params: any, index: number) => {
        if (params[index] === undefined || params[index] === '' || params[index] === null) {
          return
        }
        return validator(params, index)
      }
    }
  },

  /**
   * Validator that passes if any of the specified validators pass
   * @param validator validator to check against the value
   * @returns validator function with params:
   *   - @param params parameters of method
   *   - @param index index of parameter
   */
  get either() {
    return (...validators: any) => {
      return (params: any, index: number) => {
        if (params[index] === undefined) {
          return
        }
        const results = validators.map((v: any) => v(params, index))
        const numPassed = results.filter((r: any) => r === undefined).length
        return numPassed > 0 ? undefined : results[0]
      }
    }
  },
}
