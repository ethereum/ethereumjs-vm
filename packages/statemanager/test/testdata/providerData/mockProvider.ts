export const getValues = async (method: string, id: number, params: any[]): Promise<any> => {
  switch (method) {
    case 'eth_getProof':
      return {
        id,
        result: await getProofValues(params as any),
      }

    case 'eth_getBlockByNumber':
      return {
        id,
        result: await getBlockValues(params as any),
      }

    case 'eth_chainId': // Always pretends to be mainnet
      return {
        id,
        result: 1,
      }
    case 'eth_getTransactionByHash':
      return {
        id,
        result: await getTransactionData(params as any),
      }

    case 'eth_getCode': {
      let code = '0x'
      if (params[0] !== '0xd8da6bf26964af9d7eed9e03e53415d37aa96045') {
        code = '0xab'
      }
      return {
        id,
        result: code,
      }
    }
    case 'eth_getStorageAt':
      return {
        id,
        result: '0xabcd',
      }

    default:
      return {
        id,
        result: {
          error: 'method not implemented',
        },
      }
  }
}

const getProofValues = async (params: [address: string, _: [], blockTag: bigint | string]) => {
  const [address, _slot, blockTag] = params
  try {
    const account = (await import(`./accounts/${address}.json`)).default
    return account[blockTag.toString() ?? 'latest']
  } catch {
    return {
      address,
      balance: '0x0',
      codeHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      nonce: '0x0',
      storageHash: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      storageProof: [],
    }
  }
}

const getBlockValues = async (params: [blockTag: string, _: boolean]) => {
  const [blockTag, _] = params
  if (blockTag.slice(0, 2) !== '0x')
    return {
      number: 'latest',
      stateRoot: '0x2ffb7ec5bbe8616c24a222737f0817f389d00ab9268f9574e0b7dfe251fbfa05',
    }
  const block = await import(`./blocks/block${blockTag}.json`)
  return block.default
}

const getTransactionData = async (params: [txHash: string]) => {
  const [txHash] = params
  const txData = await import(`./transactions/${txHash}.json`)
  return txData
}
