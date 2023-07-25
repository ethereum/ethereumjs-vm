import { spawn } from 'child_process'
import { Client } from 'jayson/promise'
import { assert, describe, it } from 'vitest'

describe('[CLI]', () => {
  // engine rpc tests
  it('should start engine rpc and provide endpoint', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpcEngine', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          assert.ok(message.includes('engine'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start engine rpc and provide endpoint with auth disabled', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpcEngine', '--rpcEngineAuth=false', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          assert.ok(message.includes('engine'), 'read from HTTP RPC')
          assert.ok(message.includes('rpcEngineAuth=false'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start engine rpc on custom port', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpcEngine', '--rpcEnginePort=8552', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          assert.ok(message.includes('8552'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start engine rpc on custom address', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpcEngine', '--rpcEngineAddr="0.0.0.0"', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          assert.ok(message.includes('0.0.0.0'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  // websocket tests
  it('should start WS RPC and return valid responses', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpc', '--ws', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('ws://')) {
          // if ws endpoint startup message detected, call ws endpoint with RPC method
          const client = Client.websocket({ url: 'ws://localhost:8545' })
          ;(client as any).ws.on('open', async function () {
            const res = await client.request('web3_clientVersion', [], 2.0)
            assert.ok(res.result.includes('EthereumJS'), 'read from WS RPC')
            child.kill()
            resolve(undefined)
          })
          if (message.toLowerCase().includes('error')) {
            child.kill()
            assert.fail(`client encountered error: ${message}`)
          }
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start WS RPC on custom port', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpc', '--ws', '--wsPort=8546', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('ws://')) {
          // if ws endpoint startup message detected, call ws endpoint with RPC method
          const client = Client.websocket({ url: 'ws://localhost:8546' })
          ;(client as any).ws.on('open', async function () {
            const res = await client.request('web3_clientVersion', [], 2.0)
            assert.ok(res.result.includes('EthereumJS'), 'read from WS RPC')
            child.kill()
            resolve(undefined)
          })
          if (message.toLowerCase().includes('error')) {
            child.kill()
            assert.fail(`client encountered error: ${message}`)
          }
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start WS RPC on custom address', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpc', '--ws', '--wsPort=8546', '--wsAddr="0.0.0.0"', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('ws://')) {
          console.log(message)
          // if ws endpoint startup message detected, call ws endpoint with RPC method
          const client = Client.websocket({ url: 'ws://0.0.0.0:8546' })
          ;(client as any).ws.on('open', async function () {
            const res = await client.request('web3_clientVersion', [], 2.0)
            assert.ok(res.result.includes('EthereumJS'), 'read from WS RPC')
            child.kill()
            resolve(undefined)
          })
          if (message.toLowerCase().includes('error')) {
            child.kill()
            assert.fail(`client encountered error: ${message}`)
          }
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  // client rpc tests
  it('should start HTTP RPC and return valid responses', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpc', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          const client = Client.http({ port: 8545 })
          const res = await client.request('web3_clientVersion', [], 2.0)
          assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start HTTP RPC on custom port', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpc', '--rpcPort=8546', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          const client = Client.http({ port: 8546 })
          const res = await client.request('web3_clientVersion', [], 2.0)
          assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('should start HTTP RPC on custom address', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const cliArgs = ['--rpc', '--rpcAddr="0.0.0.0"', '--dev=poa']
    const child = spawn(process.execPath, [file, ...cliArgs])

    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
        if (message.includes('http://')) {
          // if http endpoint startup message detected, call http endpoint with RPC method
          const client = Client.http({ port: 8545, localAddress: '0.0.0.0' })
          const res = await client.request('web3_clientVersion', [], 2.0)
          assert.ok(res.result.includes('EthereumJS'), 'read from HTTP RPC')
          child.kill()
          resolve(undefined)
        }
        if (message.toLowerCase().includes('error')) {
          child.kill(9)
          assert.fail(`client encountered error: ${message}`)
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 10000)

  it('HTTP/WS RPCs should not start when cli args omitted', async () => {
    const file = require.resolve('../../dist/bin/cli.js')
    const child = spawn(process.execPath, [file, ...['--dev=poa']])
    return new Promise((resolve) => {
      child.stdout.on('data', async (data) => {
        const message: string = data.toString()
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
        if (message.includes('ERROR')) {
          assert.fail('client encountered error starting')
        }
      })

      child.stderr.on('data', (data) => {
        const message: string = data.toString()
        assert.fail(`stderr: ${message}`)
      })

      child.on('close', (code) => {
        if (typeof code === 'number' && code > 0) {
          assert.fail(`child process exited with code ${code}`)
        }
      })
    })
  }, 20000)
})
