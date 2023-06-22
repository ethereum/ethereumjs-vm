import { Interface, defaultAbiCoder as AbiCoder } from '@ethersproject/abi'
import { AccessListEIP2930TxData, FeeMarketEIP1559TxData, TxData } from '@ethereumjs/tx'

type TransactionsData = TxData | AccessListEIP2930TxData | FeeMarketEIP1559TxData

export const encodeFunction = (
  method: string,
  params?: {
    types: any[]
    values: unknown[]
  }
): string => {
  const parameters = params?.types ?? []
  const methodWithParameters = `function ${method}(${parameters.join(',')})`
  const signatureHash = new Interface([methodWithParameters]).getSighash(method)
  const encodedArgs = AbiCoder.encode(parameters, params?.values ?? [])

  return signatureHash + encodedArgs.slice(2)
}

export const encodeDeployment = (
  bytecode: string,
  params?: {
    types: any[]
    values: unknown[]
  }
) => {
  const deploymentData = '0x' + bytecode
  if (params) {
    const argumentsEncoded = AbiCoder.encode(params.types, params.values)
    return deploymentData + argumentsEncoded.slice(2)
  }
  return deploymentData
}

export const buildTransaction = (data: Partial<TransactionsData>): TransactionsData => {
  const defaultData: Partial<TransactionsData> = {
    nonce: BigInt(0),
    gasLimit: 2_000_000, // We assume that 2M is enough,
    gasPrice: 1,
    value: 0,
    data: '0x',
  }

  return {
    ...defaultData,
    ...data,
  }
}
