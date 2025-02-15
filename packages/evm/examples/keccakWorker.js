import { keccak256 } from 'ethereum-cryptography/keccak.js'
import workerpool from 'workerpool'

function keccak256AB(i) {
  const res = keccak256(new Uint8Array(i))
  return res.buffer
}

workerpool.worker({
  keccak256AB,
})
