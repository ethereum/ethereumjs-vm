import { keccak256 } from 'ethereum-cryptography/keccak.js'
import path from 'path'
import { fileURLToPath } from 'url'
import workerpool from 'workerpool'

// Additional fix:
// https://iamwebwiz.medium.com/how-to-fix-dirname-is-not-defined-in-es-module-scope-34d94a86694d
const __filename = fileURLToPath(import.meta.url) // get the resolved path to the file
const __dirname = path.dirname(__filename) // get the name of the directory

const pool = workerpool.pool()
const pool2 = workerpool.pool(__dirname + '/keccakWorker.js')

function add(a: number, b: number) {
  return a + b
}

function transferAB(i: ArrayBuffer) {
  console.log(i)
  console.log(new Uint8Array(i))
}

const main = async () => {
  console.time('t')
  for (let i = 0; i < 1000; i++) {
    if (i % 2 === 0) {
      const res = keccak256(new Uint8Array([1, 2, 3, 4, 5]))
      console.log(res)
    } else {
      // First simple test to see if things work at all
      /*await pool.exec(add, [1, 2]).then(function (result) {
        console.log(result) // outputs 7
      })*/
      // Does not work ("ReferenceError: assert is not defined"), likely because datatype not allowed
      /*await pool.exec(keccak256, [new Uint8Array([1, 2, 3, 4, 5])]).then(function (result) {
        console.log(result) // outputs 7
      })*/
      // Uint8Array does not work, so we need to transfer the underlying ArrayBuffer, see e.g.
      // https://advancedweb.hu/how-to-transfer-binary-data-efficiently-across-worker-threads-in-nodejs/
      // https://stackoverflow.com/questions/37228285/uint8array-to-arraybuffer
      /*await pool.exec(transferAB, [new Uint8Array([1, 2, 3, 4, 5]).buffer]).then(function (result) {
        console.log(result) // outputs 7
      })*/
      // For keccak we cannot import the keccak256 function into a dynamic worker function,
      // so now we need to switch to dedicated workers
      await pool2
        .exec('keccak256AB', [new Uint8Array([1, 2, 3, 4, 5]).buffer])
        .then(function (result) {
          console.log(new Uint8Array(result))
        })
    }
  }
  console.timeEnd('t')
  await pool.terminate()
}

void main()
