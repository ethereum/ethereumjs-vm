import { assert, describe, it } from 'vitest'

import { DEFAULT_ERROR_CODE, EthereumJSError, EthereumJSErrorWithoutCode } from '../src/errors.js'

const TEST_ERROR_CODE = 'TEST_ERROR_CODE'
const TEST_MSG = 'test error message'

describe('EthereumJSError', () => {
  it('should create an error with a code', () => {
    const error = new EthereumJSError({ code: TEST_ERROR_CODE }, TEST_MSG)
    assert.equal(error.type.code, TEST_ERROR_CODE)
    assert.equal(error.message, TEST_MSG)
    const object = error.toObject()
    assert.equal(object.type.code, TEST_ERROR_CODE)
    assert.equal(object.message, TEST_MSG)
  })

  it('should create an error using the ethereumjs error without code', () => {
    const error = EthereumJSErrorWithoutCode(TEST_MSG)
    assert.equal(error.type.code, DEFAULT_ERROR_CODE)
    assert.equal(error.message, TEST_MSG)
    const object = error.toObject()
    assert.equal(object.type.code, DEFAULT_ERROR_CODE)
    assert.equal(object.message, TEST_MSG)
  })
})
