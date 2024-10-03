import { getGenesis } from '@ethereumjs/genesis'
import { spawn } from 'child_process'
import * as fs from 'fs'
import { Client } from 'jayson/promise'
import { assert, describe, it } from 'vitest'

import { wait } from '../integration/util.js'

import type { ChildProcessWithoutNullStreams } from 'child_process'

export function clientRunHelper(
  cliArgs: string[],
  onData: (message: string, child: ChildProcessWithoutNullStreams, resolve: Function) => void,
  shouldError = false,
) {
  const file = require.resolve('../../bin/cli.ts')
  const child = spawn('tsx', [file, ...cliArgs])
  return new Promise((resolve) => {
    child.stdout.on('data', async (data) => {
      const message: string = data.toString()
      if (!shouldError) onData(message, child, resolve)
    })
    child.stderr.on('data', (data) => {
      const message: string = data.toString()
      if (shouldError) onData(message, child, resolve)
      else assert.fail(`stderr: ${message}`)
    })
  })
}

describe('[CLI]', () => {
  // chain network tests
  it('should successfully start client with a custom network and network id', async () => {
    const cliArgs = ['--network=sepolia', '--chainId=11155111']
    const onData = (message: string, child: ChildProcessWithoutNullStreams, resolve: Function) => {
      if (message.includes('Initializing Ethereumjs client')) {
        assert.ok(
          message.includes('network=sepolia chainId=11155111'),
          'client is using custom inputs for network and network ID',
        )
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should successfully start client with non-lower case network name', async () => {
    const cliArgs = ['--network=Kaustinen6']
    const onData = (message: string, child: ChildProcessWithoutNullStreams, resolve: Function) => {
      if (message.includes('Initializing Ethereumjs client')) {
        assert.ok(
          message.includes('network=kaustinen6'),
          'client is using custom inputs for network and network ID',
        )
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 5000)
  it('should successfully start client with custom inputs for PoA network', async () => {
    const cliArgs = [
      '--rpc',
      '--rpcPort=8569',
      '--rpcAddr=0.0.0.0',
      '--dev=poa',
      '--port=30306',
      '--minerCoinbase="0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"',
      '--saveReceipts=false',
      '--execution=false',
    ]
    let count = 2 // only kill process after both checks have completed
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('http://')) {
        // if http endpoint startup message detected, call http endpoint with RPC method
        await wait(600)
        const client = Client.http({
          port: 8569,
          host: '0.0.0.0',
        })
        const res = await client.request('eth_coinbase', [], 2.0)
        assert.ok(
          res.result === '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
          'correct coinbase address set',
        )
        count -= 1
      }
      if (message.includes('Client started successfully')) {
        assert.ok(message, 'Client started successfully with custom inputs for PoA network')
        count -= 1
      }
      if (count === 0) {
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 10000)
  it('should throw error if "dev" option is passed in without a value', async () => {
    const cliArgs = ['--dev']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Invalid values')) {
        assert.ok(
          true,
          'client correctly throws error when "dev" option is passed in without a value',
        )
      }
      child.kill()
      resolve(undefined)
    }
    await clientRunHelper(cliArgs, onData, true)
  }, 5000)
  it('should throw error if the same port is assigned to multiple RPC servers', async () => {
    const cliArgs = ['--ws', '--rpc', '--rpcPort=8546']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('cannot reuse')) {
        assert.ok(true, 'cannot reuse ports between HTTP and WS RPCs')
      }
      child.kill()
      resolve(undefined)
    }
    await clientRunHelper(cliArgs, onData, true)
  }, 30000)
  // engine rpc tests
  it('should start engine rpc and provide endpoint', async () => {
    const cliArgs = ['--rpcEngine', '--port=30310', '--dev=poa', '--rpcEnginePort=7777']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('http://')) {
        // if http endpoint startup message detected, call http endpoint with RPC method
        assert.ok(message.includes('engine'), 'engine rpc started')
        try {
          await wait(600)
          const client = Client.http({ port: 7777 })
          await client.request('engine_exchangeCapabilities', [], 2.0)
        } catch (e) {
          if (!(e instanceof Error)) {
            e = new Error(e)
          }
          assert(
            e.message.includes('Unauthorized: Error: Missing auth header'),
            'authentication failure shows that auth is defaulting to active',
          )
        }
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start engine rpc and provide endpoint with auth disabled', async () => {
    const cliArgs = [
      '--rpcEngine',
      '--rpcEngineAuth=false',
      '--port=30305',
      '--rpcEnginePort=8553',
      '--dev=poa',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('http://')) {
        assert.ok(message.includes('engine'), 'engine rpc started')
        assert.ok(
          message.includes('rpcEngineAuth=false'),
          'auth is disabled according to client logs',
        )
        await wait(600)
        const client = Client.http({ port: 8553 })
        const res = await client.request('engine_exchangeCapabilities', [], 2.0)
        assert.ok(res.result.length > 0, 'engine api is responsive without need for auth header')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start engine rpc on custom port', async () => {
    const customPort = '8552'
    const cliArgs = [
      '--rpcEngine',
      '--rpcEnginePort=' + customPort,
      '--port=30307',
      '--rpcEngineAuth=false',
      '--dev=poa',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('http://')) {
        assert.ok(message.includes('engine'), 'engine rpc started')
        assert.ok(message.includes(customPort), 'custom port is being used')
        assert.ok(
          message.includes('rpcEngineAuth=false'),
          'auth is disabled according to client logs',
        )
        await wait(600)
        const client = Client.http({ port: Number(customPort) })
        const res = await client.request('engine_exchangeCapabilities', [], 2.0)
        assert.ok(res.result.length > 0, 'engine api is responsive without need for auth header')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start engine rpc on custom address', async () => {
    const customPort = '8661'
    const cliArgs = [
      '--port=30316',
      '--rpcEngine',
      '--rpcEngineAddr="0.0.0.0"',
      '--rpcEngineAuth=false',
      '--rpcEnginePort=' + customPort,
      '--dev=poa',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('http://')) {
        assert.ok(message.includes('engine'), 'engine rpc started')
        assert.ok(message.includes('0.0.0.0'), 'custom address is being used')
        assert.ok(
          message.includes('rpcEngineAuth=false'),
          'auth is disabled according to client logs',
        )
        await wait(600)
        const client = Client.http({ hostname: '0.0.0.0', port: Number(customPort) })
        const res = await client.request('engine_exchangeCapabilities', [], 2.0)
        assert.ok(res.result.length > 0, 'engine api is responsive on custom address')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start engine websocket on custom address and port', async () => {
    const customPort = '8662'
    const cliArgs = [
      '--ws',
      '--port=30308',
      '--rpcEngine',
      `--wsEnginePort=${customPort}`,
      '--wsEngineAddr="0.0.0.0"',
      '--rpcEngineAuth=false',
      '--dev=poa',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('ws://') && message.includes('engine')) {
        assert.ok(
          message.includes('0.0.0.0:' + customPort),
          'client logs show correct custom address and port being used',
        )
        assert.ok(message.includes('engine'), 'engine ws started')
        await wait(600)
        const client = Client.websocket({ url: 'ws://0.0.0.0:' + customPort })
        ;(client as any).ws.on('open', async function () {
          const res = await client.request('engine_exchangeCapabilities', [], 2.0)
          assert.ok(res.result.length > 0, 'read from WS RPC on custom address and port')
          child.kill()
          resolve(undefined)
        })
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // websocket tests
  it('should start WS RPC on custom port and custom address', async () => {
    const customPort = '8512'
    const cliArgs = [
      '--rpc',
      '--ws',
      '--port=30322',
      '--wsPort=' + customPort,
      '--wsAddr="0.0.0.0"',
      '--dev=poa',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('ws://')) {
        // if ws endpoint startup message detected, call ws endpoint with RPC method
        await wait(600)
        const client = Client.websocket({ url: 'ws://0.0.0.0:' + customPort })
        ;(client as any).ws.on('open', async function () {
          const res = await client.request('web3_clientVersion', [], 2.0)
          assert.ok(res.result.includes('EthereumJS'), 'read from WS RPC')
          child.kill()
          resolve(undefined)
        })
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // client rpc tests
  it('should start HTTP RPC on custom port and address', async () => {
    const customPort = '8562'
    const cliArgs = [
      '--rpc',
      '--rpcPort=' + customPort,
      '--dev=poa',
      `--rpcAddr="0.0.0.0"`,
      '--port=19657',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('http://')) {
        // if http endpoint startup message detected, call http endpoint with RPC method
        await wait(600)
        const client = Client.http({
          port: Number(customPort),
          host: '0.0.0.0',
        })
        const res = await client.request('web3_clientVersion', [], 2.0)
        assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')

        const clientNoConnection = Client.http({
          port: 8563,
        })
        try {
          await clientNoConnection.request('web3_clientVersion', [], 2.0)
          assert.fail('should have thrown on invalid client address')
        } catch (e) {
          if (!(e instanceof Error)) {
            e = new Error(e)
          }
          assert.ok(e !== undefined, 'failed to connect to RPC on invalid address')
          child.kill()
          resolve(undefined)
        }
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('HTTP/WS RPCs should not start when cli args omitted', async () => {
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('address=http://')) {
        child.kill()
        assert.fail('http endpoint should not be enabled')
      }
      if (message.includes('address=ws://')) {
        child.kill()
        assert.fail('ws endpoint should not be enabled')
      }
      if (message.includes('Miner: Assembling block')) {
        assert.ok('miner started and no rpc endpoints started')
        resolve(undefined)
      }
    }
    await clientRunHelper(['--dev=poa', '--port=39681'], onData)
  }, 30000)
  // logging and documentation tests
  it('should log out available RPC methods', async () => {
    const cliArgs = ['--rpc', '--helpRPC=true', '--dev=poa', '--port=39672', '--rpcPort=9999']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('JSON-RPC: Supported Methods')) {
        assert.ok(message, 'logged out supported RPC methods')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start client with custom options for logging', async () => {
    const cliArgs = [
      '--rpc',
      '--rpcDebug=false',
      '--rpcPort=8888',
      '--executeBlocks="5"',
      '--debugCode=false',
      '--logFile=false',
      '--logRotate=false',
      '--logMaxFiles=0',
      '--logLevelFile="debug"',
      '--logLevel="debug"',
      '--dev=poa',
      '--port=39671',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('DEBUG')) {
        assert.ok(message, 'debug logging is enabled')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // caching tests
  it('should start client with custom input for account cache size', async () => {
    const cliArgs = ['--accountCache=2000', '--port=30314', '--rpc=false']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('account cache')) {
        assert.ok(message.includes('2000'), 'account cache option works')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start client with custom input for storage cache size', async () => {
    const cliArgs = ['--storageCache=2000', '--port=30315', '--dev=poa']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('storage cache')) {
        assert.ok(message.includes('2000'), 'storage cache option works')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start client with custom input for code cache size', async () => {
    const cliArgs = ['--codeCache=2000', '--port=30313', '--dev=poa']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,

      resolve: Function,
    ) => {
      if (message.includes('code cache')) {
        assert.ok(message.includes('2000'), 'code cache option works')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start client with custom input for trie cache size', async () => {
    const cliArgs = ['--trieCache=2000', '--port=30312', '--dev=poa']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('trie cache')) {
        assert.ok(message.includes('2000'), 'trie cache option works')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start client with file path for bootnodes option', async () => {
    const cliArgs = ['--bootnodes=./test/testdata/bootnode.txt']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Reading bootnodes')) {
        assert.ok(message.includes('num=2'), 'passing bootnode.txt URL for bootnodes option works')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // test experimental feature options
  it('should start client when passed options for experimental features', async () => {
    const cliArgs = ['--mine=true', '--snap=true', '--dev=poa', '--port=30393']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Client started successfully')) {
        assert.ok(
          message.includes('Client started successfully'),
          'Clients started with experimental feature options',
        )
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // client execution limits tests
  it('should start client when passed options for client execution limits', async () => {
    const cliArgs = [
      '--port=30372',
      '--numBlocksPerIteration=2',
      '--txLookupLimit=2',
      '--maxPerRequest=2',
      '--maxFetcherJobs=2',
      '--minPeers=2',
      '--maxPeers=2',
      '--startBlock=0',
      '--dev=poa',
      '--rpc=false',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Client started successfully')) {
        assert.ok(
          message.includes('Client started successfully'),
          'Clients starts with client execution limits',
        )
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // Network protocol tests
  it('should start client with custom network parameters', async () => {
    const cliArgs = [
      '--rpc',
      '--port=65000',
      '--extIP=0.0.0.0',
      '--rpcCors=https://foo.example',
      '--dnsAddr=8.8.8.8',
      '--dev=poa',
      '--rpcPort=8573',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Server listener up transport=rlpx')) {
        const [ip, port] = message
          .split('@')
          .at(-1)
          ?.split(':')
          .map((e) => e.trim()) as string[]
        assert.ok(ip === '0.0.0.0', 'custom input for address is being used')
        assert.ok(port === '65000', 'custom input for port is being used')
      }
      if (message.includes('Client started successfully')) {
        await wait(600)
        const client = Client.http({ port: 8573 })
        const res = await client.request('web3_clientVersion', [], 2.0)
        assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  it('should start client with custom DNS network parameters', async () => {
    const cliArgs = [
      '--rpc',
      '--rpcPort=8593',
      '--port=30304',
      '--dev=poa',
      '--bootnodes=enode://abc@127.0.0.1:30303',
      '--multiaddrs=enode://abc@127.0.0.1:30303',
      '--discDns=false',
      '--discV4=false',
      '--dnsNetworks=enrtree://AM5FCQLWIZX2QFPNJAP7VUERCCRNGRHWZG3YYHIUV7BVDQ5FDPRT2@nodes.example.org',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Client started successfully')) {
        assert.ok(
          message.includes('Client started successfully'),
          'Clients starts with custom network options',
        )
        await wait(600)
        const client = Client.http({ port: 8593 })
        const res = await client.request('web3_clientVersion', [], 2.0)
        assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // Client sync options tests
  it('should start client with custom sync parameters', async () => {
    const cliArgs = [
      '--rpc',
      '--rpcPort=8548',
      '--port=30301',
      '--dev=poa',
      '--isSingleNode=true',
      '--sync="none"',
      '--lightServe=true',
      '--mergeForkIdPostMerge=false',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Serving light peer requests')) {
        assert.ok(
          message.includes('Serving light peer requests'),
          'client respects custom light-mode option',
        )
      }
      if (message.includes('Starting FullEthereumService')) {
        assert.ok(message.includes('with no syncing'), 'client respects custom sync mode option')
      }
      if (message.includes('Client started successfully')) {
        assert.ok(
          message.includes('Client started successfully'),
          'Client starts with custom sync options',
        )
        await wait(600)
        const client = Client.http({ port: 8548 })
        const res = await client.request('web3_clientVersion', [], 2.0)
        assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
        child.kill()
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)
  // Client file and directory path options tests
  it('should start client with custom file path parameters', async () => {
    const customGenesisJSON = JSON.stringify(getGenesis(11155111))
    const customChainJSON = `{
      "name": "customChain",
      "chainId": 11155111,
      "defaultHardfork": "shanghai",
      "consensus": {
        "type": "pow",
        "algorithm": "ethash",
        "ethash": {}
      },
      "comment": "PoW test network to replace Ropsten",
      "url": "https://github.com/ethereum/go-ethereum/pull/23730",
      "genesis": {
        "timestamp": "0x6159af19",
        "gasLimit": 30000000,
        "difficulty": 131072,
        "nonce": "0x0000000000000000",
        "extraData": "0x5365706f6c69612c20417468656e732c204174746963612c2047726565636521"
      },
      "hardforks": [
        {
          "name": "chainstart",
          "block": 0,
          "forkHash": "0xfe3366e7"
        },
        {
          "name": "homestead",
          "block": 0,
          "forkHash": "0xfe3366e7"
        }
      ],
      "bootstrapNodes": [
        {
          "ip": "18.168.182.86",
          "port": 30303,
          "id": "9246d00bc8fd1742e5ad2428b80fc4dc45d786283e05ef6edbd9002cbc335d40998444732fbe921cb88e1d2c73d1b1de53bae6a2237996e9bfe14f871baf7066",
          "location": "",
          "comment": "geth"
        }
      ],
      "dnsNetworks": [
        "enrtree://AKA3AM6LPBYEUDMVNU3BSVQJ5AD45Y7YPOHJLEF6W26QOE4VTUDPE@all.sepolia.ethdisco.net"
      ]
    }`
    const dir = fs.mkdtempSync('test')
    fs.open(`${dir}/customChain.json`, 'w', (err, fd) => {
      if (err !== null) throw err
      fs.write(fd, customChainJSON, (writeErr) => {
        if (writeErr !== null) {
          assert.fail(`Error writing the file: ${writeErr.message}`)
        } else {
          assert.ok(true, 'File created and data written successfully!')
        }

        fs.close(fd, (closeErr) => {
          if (closeErr) {
            assert.fail(`Error closing the file:, ${closeErr.message}`)
          }
        })
      })
    })
    fs.open(`${dir}/customGenesis.json`, 'w', (err, fd) => {
      if (err !== null) throw err
      fs.write(fd, customGenesisJSON, (writeErr) => {
        if (writeErr !== null) {
          assert.fail(`Error writing the file: ${writeErr.message}`)
        } else {
          assert.ok(true, 'File created and data written successfully!')
        }

        fs.close(fd, (closeErr) => {
          if (closeErr) {
            assert.fail(`Error closing the file:, ${closeErr.message}`)
          }
        })
      })
    })
    const cliArgs = [
      '--rpc',
      '--rpcPort=8549',
      '--port=30302',
      `--dataDir="${dir}"`,
      `--customChain="${dir}/customChain.json"`,
      `--customGenesisState="${dir}/customGenesis.json"`,
      '--gethGenesis=""',
      '--trustedSetup=""',
      '--jwtSecret=""',
    ]
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Reading custom genesis state')) {
        assert.ok(
          message.includes('Reading custom genesis state'),
          'client respects custom genesis state file option',
        )
      }
      if (message.includes('Data directory')) {
        assert.ok(message.includes(dir), 'client respects custom data directory option')
      }
      if (message.includes('Initializing Ethereumjs client')) {
        assert.ok(
          message.includes('network=customChain'),
          'Client respects custom chain parameters JSON file option',
        )
      }
      if (message.includes('Client started successfully')) {
        await wait(600)
        const client = Client.http({ port: 8549 })
        const res = await client.request('web3_clientVersion', [], 2.0)
        assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
        child.kill()
        fs.rmSync(dir, { recursive: true, force: true })
        resolve(undefined)
      }
    }
    await clientRunHelper(cliArgs, onData)
  }, 30000)

  it('should not start client with unknown parameters', async () => {
    const cliArgs = ['--datadir=fake/path']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Unknown argument: datadir')) {
        assert.ok(true, 'correctly errors on unknown arguments')
      }
      child.kill()
      resolve(undefined)
    }
    await clientRunHelper(cliArgs, onData, true)
  }, 5000)
  it('should not start client with conflicting parameters', async () => {
    const cliArgs = ['--chainId', '--gethGenesis']
    const onData = async (
      message: string,
      child: ChildProcessWithoutNullStreams,
      resolve: Function,
    ) => {
      if (message.includes('Arguments chainId and gethGenesis are mutually exclusive')) {
        assert.ok(true, 'correctly errors on conflicting arguments')
      }
      child.kill()
      resolve(undefined)
    }
    await clientRunHelper(cliArgs, onData, true)
  }, 5000)
}, 180000)
