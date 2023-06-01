import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils'
import { encryptKeystoreJsonSync, Wallet as ethersWallet } from 'ethers'
import * as tape from 'tape'

import { Wallet } from '../src'
import { Thirdparty } from '../src/thirdparty'

const zip = require('lodash.zip')

const n = 262144
const r = 8
const p = 1

const fixturePrivateKey = 'efca4cdd31923b50f4214af5d2ae10e7ac45a5019e9431cc195482d707485378'
const fixturePrivateKeyStr = '0x' + fixturePrivateKey
const fixturePrivateKeyBuffer = hexToBytes(fixturePrivateKey)

const fixturePublicKey =
  '5d4392f450262b276652c1fc037606abac500f3160830ce9df53aa70d95ce7cfb8b06010b2f3691c78c65c21eb4cf3dfdbfc0745d89b664ee10435bb3a0f906c'
const fixturePublicKeyStr = '0x' + fixturePublicKey
const fixturePublicKeyBuffer = hexToBytes(fixturePublicKey)

const fixtureWallet = Wallet.fromPrivateKey(fixturePrivateKeyBuffer)
const fixtureEthersWallet = new ethersWallet(fixtureWallet.getPrivateKeyString())

const isRunningInKarma = (): boolean => {
  return typeof (global as any).window !== 'undefined' && (global as any).window.__karma__
}

tape('.getPrivateKey()', (t) => {
  t.equal(bytesToHex(fixtureWallet.getPrivateKey()), fixturePrivateKey)

  t.throws(
    () => {
      Wallet.fromPrivateKey(hexToBytes('001122'))
    },
    (err: any) => err.message.includes('Private key does not satisfy the curve requirements')
  )

  t.end()
})

tape('.getPrivateKeyString()', (t) => {
  t.deepEqual(fixtureWallet.getPrivateKeyString(), fixturePrivateKeyStr)
  t.end()
})

tape('.getPublicKey()', (t) => {
  t.deepEqual(bytesToHex(fixtureWallet.getPublicKey()), fixturePublicKey)
  t.end()
})

tape('.getPublicKeyString()', (t) => {
  t.deepEqual(fixtureWallet.getPublicKeyString(), fixturePublicKeyStr)
  t.end()
})

tape('.getAddress()', (t) => {
  t.deepEqual(bytesToHex(fixtureWallet.getAddress()), 'b14ab53e38da1c172f877dbc6d65e4a1b0474c3c')
  t.end()
})

tape('.getAddressString()', (t) => {
  t.deepEqual(fixtureWallet.getAddressString(), '0xb14ab53e38da1c172f877dbc6d65e4a1b0474c3c')
  t.end()
})

tape('.getChecksumAddressString()', (t) => {
  t.deepEqual(
    fixtureWallet.getChecksumAddressString(),
    '0xB14Ab53E38DA1C172f877DBC6d65e4a1B0474C3c'
  )
  t.end()
})

tape('.verifyPublicKey()', (t) => {
  t.deepEqual(fixtureWallet.verifyPublicKey(fixturePublicKeyBuffer), true),
    'should return true if publicKey, privateKey pair is valid'

  t.deepEqual(
    fixtureWallet.verifyPublicKey(new Uint8Array(64)),
    false,
    'should return false if publicKey, privateKey pair is invalid'
  )
  t.end()
})

tape('public key only wallet', (t) => {
  const pubKey = hexToBytes(fixturePublicKey)

  t.deepEqual(
    bytesToHex(Wallet.fromPublicKey(pubKey).getPublicKey()),
    fixturePublicKey,
    '.fromPublicKey() should work'
  )

  t.throws(
    function () {
      Wallet.fromPublicKey(
        hexToBytes('030639797f6cc72aea0f3d309730844a9e67d9f1866e55845c5f7e0ab48402973d')
      )
    },
    (err: any) => err.message.includes('Invalid public key'),
    '.fromPublicKey() should not accept compressed keys in strict mode'
  )

  const tmp = hexToBytes('030639797f6cc72aea0f3d309730844a9e67d9f1866e55845c5f7e0ab48402973d')
  t.deepEqual(
    bytesToHex(Wallet.fromPublicKey(tmp, true).getPublicKey()),
    '0639797f6cc72aea0f3d309730844a9e67d9f1866e55845c5f7e0ab48402973defa5cb69df462bcc6d73c31e1c663c225650e80ef14a507b203f2a12aea55bc1',
    '.fromPublicKey() should accept compressed keys in non-strict mode'
  )

  t.deepEqual(
    bytesToHex(Wallet.fromPublicKey(pubKey).getAddress()),
    'b14ab53e38da1c172f877dbc6d65e4a1b0474c3c',
    '.getAddress() should work'
  )

  t.throws(
    function () {
      Wallet.fromPublicKey(pubKey).getPrivateKey()
    },
    (err: any) => err.message.includes('This is a public key only wallet'),
    '.getPrivateKey() should fail'
  )

  // t.test('.toV3() should fail', function () {
  //   assert.throws(function () {
  //     Wallet.fromPublicKey(pubKey).toV3()
  //   }, /^Error: This is a public key only wallet$/)
  // })

  t.end()
})

tape('.fromExtendedPrivateKey()', (t) => {
  const xprv =
    'xprv9s21ZrQH143K4KqQx9Zrf1eN8EaPQVFxM2Ast8mdHn7GKiDWzNEyNdduJhWXToy8MpkGcKjxeFWd8oBSvsz4PCYamxR7TX49pSpp3bmHVAY'
  t.deepEqual(
    Wallet.fromExtendedPrivateKey(xprv).getAddressString(),
    '0xb800bf5435f67c7ee7d83c3a863269969a57c57c'
  )
  t.end()
})

tape('.fromExtendedPublicKey()', (t) => {
  const xpub =
    'xpub661MyMwAqRbcGout4B6s29b6gGQsowyoiF6UgXBEr7eFCWYfXuZDvRxP9zEh1Kwq3TLqDQMbkbaRpSnoC28oWvjLeshoQz1StZ9YHM1EpcJ'
  t.deepEqual(
    Wallet.fromExtendedPublicKey(xpub).getAddressString(),
    '0xb800bf5435f67c7ee7d83c3a863269969a57c57c'
  )
  t.end()
})

tape('.generate()', (t) => {
  t.equal(Wallet.generate().getPrivateKey().length, 32, 'should generate an account')
  const max = BigInt('0x088f924eeceeda7fe92e1f5b0fffffffffffffff')
  const wallet = Wallet.generate(true)
  t.equal(
    wallet.getPrivateKey().length,
    32,
    'should generate an account compatible with ICAP Direct'
  )
  const addr = bytesToHex(wallet.getAddress())
  t.equal(BigInt('0x' + addr) <= max, true)
  t.end()
})

tape('.generateVanityAddress()', (t) => {
  let wallet = Wallet.generateVanityAddress(/^000/)
  t.deepEqual(wallet.getPrivateKey().length, 32)
  t.deepEqual(wallet.getAddress()[0], 0)
  t.deepEqual(
    wallet.getAddress()[1] >>> 4,
    0,
    'should generate an account with 000 prefix (object)'
  )

  wallet = Wallet.generateVanityAddress('^000')
  t.deepEqual(wallet.getPrivateKey().length, 32)
  t.deepEqual(wallet.getAddress()[0], 0)
  t.deepEqual(
    wallet.getAddress()[1] >>> 4,
    0,
    'should generate an account with 000 prefix (string)'
  )
  t.end()
})

tape('.getV3Filename()', (t) => {
  t.deepEqual(
    fixtureWallet.getV3Filename(1457917509265),
    'UTC--2016-03-14T01-05-09.265Z--b14ab53e38da1c172f877dbc6d65e4a1b0474c3c'
  )
  t.end()
})

const pw = 'testtest'
const salt = 'dc9e4a98886738bd8aae134a1f89aaa5a502c3fbd10e336136d4d5fe47448ad6'
const iv = 'cecacd85e9cb89788b5aab2f93361233'
const uuid = '7e59dc028d42d09db29aa8a0f862cc81'

const strKdfOptions = { iv, salt, uuid }
const buffKdfOptions = {
  salt: hexToBytes(salt),
  iv: hexToBytes(iv),
  uuid: hexToBytes(uuid),
}

// generate all possible combinations of salt, iv, uuid properties, e.g.
// {salt: [string], iv: [buffer], uuid: [string]}
// the number of objects is naturally a radix for selecting one of the
// input values for a given property; example, three objects and two keys:
// [{a: 0, b: 0},
//  {a: 1, b: 1},
//  {a: 2, b: 2}]
type Perm = Array<{
  salt: string | Uint8Array
  iv: string | Uint8Array
  uuid: string | Uint8Array
}>
const makePermutations = (...objs: Array<object>): Perm => {
  const permus = []
  const keys = Array.from(
    objs.reduce((acc: any, curr: object) => {
      Object.keys(curr).forEach((key) => {
        acc.add(key)
      })
      return acc
    }, new Set())
  )
  const radix = objs.length
  const numPermus = radix ** keys.length
  for (let permuIdx = 0; permuIdx < numPermus; permuIdx++) {
    const selectors = permuIdx
      .toString(radix)
      .padStart(keys.length, '0')
      .split('')
      .map((v) => parseInt(v, 10))
    const obj: any = {}
    zip(selectors, keys).forEach(([sel, k]: [number, string]) => {
      if ((objs as any)[sel].hasOwnProperty(k) === true) {
        obj[k] = (objs as any)[sel][k]
      }
    })
    permus.push(obj)
  }
  return permus
}

const makeEthersOptions = (opts: object) => {
  const obj: any = {}
  Object.entries(opts).forEach(([key, val]: [string, string | Uint8Array]) => {
    obj[key] = typeof val === 'string' ? '0x' + val : val
  })
  return obj
}

let permutations = makePermutations(strKdfOptions, buffKdfOptions)

if (isRunningInKarma()) {
  // These tests take a long time in the browser due to
  // the amount of permutations so we will shorten them.
  permutations = permutations.slice(1)
}

tape('.toV3(): should work with PBKDF2', async (t) => {
  const w =
    '{"version":3,"id":"7e59dc02-8d42-409d-b29a-a8a0f862cc81","address":"b14ab53e38da1c172f877dbc6d65e4a1b0474c3c","crypto":{"ciphertext":"01ee7f1a3c8d187ea244c92eea9e332ab0bb2b4c902d89bdd71f80dc384da1be","cipherparams":{"iv":"cecacd85e9cb89788b5aab2f93361233"},"cipher":"aes-128-ctr","kdf":"pbkdf2","kdfparams":{"dklen":32,"salt":"dc9e4a98886738bd8aae134a1f89aaa5a502c3fbd10e336136d4d5fe47448ad6","c":262144,"prf":"hmac-sha256"},"mac":"0c02cd0badfebd5e783e0cf41448f84086a96365fc3456716c33641a86ebc7cc"}}'

  for (const perm of permutations) {
    const encFixtureWallet = await fixtureWallet.toV3String(pw, {
      kdf: 'pbkdf2',
      c: n,
      uuid: perm.uuid,
      salt: perm.salt,
      iv: perm.iv,
    })

    t.deepEqual(JSON.parse(w), JSON.parse(encFixtureWallet))
    // ethers doesn't support encrypting with PBKDF2
  }
})

tape('.toV3(): should work with Scrypt', async (t) => {
  const wStaticJSON =
    '{"version":3,"id":"7e59dc02-8d42-409d-b29a-a8a0f862cc81","address":"b14ab53e38da1c172f877dbc6d65e4a1b0474c3c","crypto":{"ciphertext":"c52682025b1e5d5c06b816791921dbf439afe7a053abb9fac19f38a57499652c","cipherparams":{"iv":"cecacd85e9cb89788b5aab2f93361233"},"cipher":"aes-128-ctr","kdf":"scrypt","kdfparams":{"dklen":32,"salt":"dc9e4a98886738bd8aae134a1f89aaa5a502c3fbd10e336136d4d5fe47448ad6","n":262144,"r":8,"p":1},"mac":"27b98c8676dc6619d077453b38db645a4c7c17a3e686ee5adaf53c11ac1b890e"}}'
  const wStatic = JSON.parse(wStaticJSON)
  const wRandom = Wallet.generate()
  const wEthers = new ethersWallet(wRandom.getPrivateKeyString())
  for (const perm of permutations) {
    t.test(`vector ${JSON.stringify(perm)}`, async (st) => {
      const { salt, iv, uuid } = perm
      const ethersOpts = makeEthersOptions({ salt, iv, uuid })

      const encFixtureWallet = await fixtureWallet.toV3String(pw, {
        kdf: 'scrypt',
        uuid,
        salt,
        iv,
        n,
        r,
        p,
      })

      const encFixtureEthersWallet = (
        await encryptKeystoreJsonSync(fixtureEthersWallet, pw, {
          scrypt: { N: n, r, p },
          salt: ethersOpts.salt,
          iv: ethersOpts.iv,
          uuid: ethersOpts.uuid,
        })
      ).toLowerCase()

      const encRandomWallet = await wRandom.toV3String(pw, {
        kdf: 'scrypt',
        uuid,
        salt,
        iv,
        n,
        r,
        p,
      })

      const encEthersWallet = (
        await encryptKeystoreJsonSync(wEthers, pw, {
          scrypt: { N: n, r, p },
          salt: ethersOpts.salt,
          iv: ethersOpts.iv,
          uuid: ethersOpts.uuid,
        })
      ).toLowerCase()

      st.deepEqual(wStatic, JSON.parse(encFixtureWallet))
      st.deepEqual(wStatic, JSON.parse(encFixtureEthersWallet))
      st.deepEqual(JSON.parse(encRandomWallet), JSON.parse(encEthersWallet))
    })
  }
  t.end()
})

tape('.toV3(): without providing options', async (t) => {
  const wallet = await fixtureWallet.toV3('testtest')
  t.deepEqual(wallet['version'], 3, 'should work without providing options')

  try {
    await fixtureWallet.toV3('testtest', { kdf: 'superkey' })
  } catch (err: any) {
    t.ok(err.message.includes('Unsupported kdf'), 'should fail for unsupported kdf')
  }
})
tape('should fail for bad salt', async (t) => {
  const pw = 'test'
  const errStr = 'Invalid salt, string must be empty or a non-zero even number of hex characters'

  try {
    await fixtureWallet.toV3(pw, { salt: 'f' })
  } catch (err: any) {
    t.ok(err.message.includes(errStr))
  }

  try {
    await fixtureWallet.toV3(pw, { salt: 'fff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStr))
  }
  try {
    await fixtureWallet.toV3(pw, { salt: 'xfff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStr))
  }
  try {
    await fixtureWallet.toV3(pw, { salt: 'fffx' })
  } catch (err: any) {
    t.ok(err.message.includes(errStr))
  }
  try {
    await fixtureWallet.toV3(pw, { salt: 'fffxff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStr))
  }

  try {
    await fixtureWallet.toV3(pw, { salt: {} as never as undefined })
  } catch (err: any) {
    t.ok(
      err.message.includes(
        'Invalid salt, must be a string (empty or a non-zero even number of hex characters) or buffer'
      )
    )
  }
})

tape('.toV3() : should work with empty salt', async (t) => {
  const pw = 'test'
  let salt: any = ''
  let w = await fixtureWallet.toV3(pw, { salt, kdf: 'pbkdf2' })

  t.equal(salt, w.crypto.kdfparams.salt)
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w, pw)).getPrivateKeyString())

  salt = '0x'
  w = await fixtureWallet.toV3(pw, { salt, kdf: 'pbkdf2' })

  t.equal('', w.crypto.kdfparams.salt)
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w, pw)).getPrivateKeyString())

  salt = hexToBytes('')
  w = await fixtureWallet.toV3(pw, { salt, kdf: 'pbkdf2' })

  t.equal('', w.crypto.kdfparams.salt)
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w, pw)).getPrivateKeyString())

  salt = ''
  let iv = 'ffffffffffffffffffffffffffffffff'
  let uuid = 'ffffffffffffffffffffffffffffffff'
  let wStr = await fixtureWallet.toV3String(pw, {
    salt,
    iv,
    uuid,
    kdf: 'scrypt',
    n,
    r,
    p,
  })
  let wEthersStr = await new ethersWallet(fixtureWallet.getPrivateKeyString()).encrypt(pw)

  t.deepEqual(salt, JSON.parse(wStr).crypto.kdfparams.salt)
  t.deepEqual(JSON.parse(wStr), JSON.parse(wEthersStr.toLowerCase()))
  t.equal(
    fixtureWallet.getPrivateKeyString(),
    (await Wallet.fromV3(JSON.parse(wStr), pw)).getPrivateKeyString()
  )
  t.equal(
    fixtureWallet.getPrivateKeyString(),
    (await ethersWallet.fromEncryptedJson(wEthersStr, pw)).privateKey
  )

  salt = '0x'
  iv = '0x' + iv
  uuid = '0x' + uuid
  wStr = await fixtureWallet.toV3String(pw, {
    salt,
    iv,
    uuid,
    kdf: 'scrypt',
    n,
    r,
    p,
  })
  wEthersStr = await new ethersWallet(fixtureWallet.getPrivateKeyString()).encrypt(pw)

  t.equal('', JSON.parse(wStr).crypto.kdfparams.salt)
  t.deepEqual(JSON.parse(wStr), JSON.parse(wEthersStr.toLowerCase()))
  t.equal(
    fixtureWallet.getPrivateKeyString(),
    (await Wallet.fromV3(JSON.parse(wStr), pw)).getPrivateKeyString()
  )
  t.equal(
    fixtureWallet.getPrivateKeyString(),
    (await ethersWallet.fromEncryptedJson(wEthersStr, pw)).privateKey
  )

  salt = hexToBytes('')
  wStr = await fixtureWallet.toV3String(pw, {
    salt,
    iv,
    uuid,
    kdf: 'scrypt',
    n,
    r,
    p,
  })
  wEthersStr = await new ethersWallet(fixtureWallet.getPrivateKeyString()).encrypt(pw)

  t.equal('', JSON.parse(wStr).crypto.kdfparams.salt)
  t.deepEqual(JSON.parse(wStr), JSON.parse(wEthersStr.toLowerCase()))
  t.equal(
    fixtureWallet.getPrivateKeyString(),
    (await Wallet.fromV3(JSON.parse(wStr), pw)).getPrivateKeyString()
  )
  t.equal(
    fixtureWallet.getPrivateKeyString(),
    (await ethersWallet.fromEncryptedJson(wEthersStr, pw)).privateKey
  )
})

tape('.toV3(): should fail for bad iv', async (t) => {
  const pw = 'test'
  const errStrLength = 'Invalid iv, string must be 32 hex characters'
  const errBuffLength = 'Invalid iv, Uint8Array must be 16 bytes'

  try {
    await fixtureWallet.toV3(pw, { iv: '' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }

  try {
    await fixtureWallet.toV3(pw, { iv: 'ff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: 'ffffffffffffffffffffffffffffffffff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: 'xfffffffffffffffffffffffffffffff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: 'fffffffffffffffffffffffffffffffx' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: 'fffffffffffffffxffffffffffffffff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: hexToBytes('') })
  } catch (err: any) {
    t.ok(err.message.includes(errBuffLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: hexToBytes('ff') })
  } catch (err: any) {
    t.ok(err.message.includes(errBuffLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: hexToBytes('ffffffffffffffffffffffffffffffffff') })
  } catch (err: any) {
    t.ok(err.message.includes(errBuffLength))
  }
  try {
    await fixtureWallet.toV3(pw, { iv: {} as never as any })
  } catch (err: any) {
    t.ok(
      err.message.includes('Invalid iv, must be a string (32 hex characters) or buffer (16 bytes)')
    )
  }
})
tape('.toV3(): should fail for bad uuid', async (t) => {
  const pw = 'test'
  const errStrLength = 'Invalid uuid, string must be 32 hex characters'
  const errBuffLength = 'Invalid uuid, Uint8Array must be 16 bytes'

  try {
    await fixtureWallet.toV3(pw, { uuid: '' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: 'ff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: 'ffffffffffffffffffffffffffffffffff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: 'xfffffffffffffffffffffffffffffff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: 'fffffffffffffffffffffffffffffffx' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: 'fffffffffffffffxffffffffffffffff' })
  } catch (err: any) {
    t.ok(err.message.includes(errStrLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: hexToBytes('') })
  } catch (err: any) {
    t.ok(err.message.includes(errBuffLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: hexToBytes('ff') })
  } catch (err: any) {
    t.ok(err.message.includes(errBuffLength))
  }
  try {
    await fixtureWallet.toV3(pw, {
      uuid: hexToBytes('ffffffffffffffffffffffffffffffffff'),
    })
  } catch (err: any) {
    t.ok(err.message.includes(errBuffLength))
  }
  try {
    await fixtureWallet.toV3(pw, { uuid: {} as never as any })
  } catch (err: any) {
    t.ok(
      err.message.includes(
        'Invalid uuid, must be a string (32 hex characters) or buffer (16 bytes)'
      )
    )
  }
})
tape('should strip leading "0x" from salt, iv, uuid', async (t) => {
  const pw = 'test'
  const salt =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const iv = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const uuid = 'cccccccccccccccccccccccccccccccc'
  let w = await fixtureWallet.toV3(pw, {
    salt: '0x' + salt,
    iv: '0X' + iv,
    uuid: '0x' + uuid,
    kdf: 'pbkdf2',
  })
  let w2 = await fixtureWallet.toV3(pw, {
    salt: '0x' + salt,
    iv: '0X' + iv,
    uuid,
    kdf: 'pbkdf2',
  })

  t.equal(salt, w.crypto.kdfparams.salt)
  t.equal(iv, w.crypto.cipherparams.iv)
  t.equal(w.id, w2.id)
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w, pw)).getPrivateKeyString())
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w2, pw)).getPrivateKeyString())

  w = await fixtureWallet.toV3(pw, {
    salt: '0x' + salt,
    iv: '0X' + iv,
    uuid: '0x' + uuid,
    kdf: 'scrypt',
  })
  w2 = await fixtureWallet.toV3(pw, {
    salt: '0x' + salt,
    iv: '0X' + iv,
    uuid,
    kdf: 'scrypt',
  })

  t.equal(salt, w.crypto.kdfparams.salt)
  t.equal(iv, w.crypto.cipherparams.iv)
  t.equal(w.id, w2.id)
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w, pw)).getPrivateKeyString())
  t.equal(fixtureWallet.getPrivateKeyString(), (await Wallet.fromV3(w2, pw)).getPrivateKeyString())
})

/*
tape('.fromV1()',  (t) => {
  t.test('should work', function () {
    const sample = '{"Address":"d4584b5f6229b7be90727b0fc8c6b91bb427821f","Crypto":{"CipherText":"07533e172414bfa50e99dba4a0ce603f654ebfa1ff46277c3e0c577fdc87f6bb4e4fe16c5a94ce6ce14cfa069821ef9b","IV":"16d67ba0ce5a339ff2f07951253e6ba8","KeyHeader":{"Kdf":"scrypt","KdfParams":{"DkLen":32,"N":262144,"P":1,"R":8,"SaltLen":32},"Version":"1"},"MAC":"8ccded24da2e99a11d48cda146f9cc8213eb423e2ea0d8427f41c3be414424dd","Salt":"06870e5e6a24e183a5c807bd1c43afd86d573f7db303ff4853d135cd0fd3fe91"},"Id":"0498f19a-59db-4d54-ac95-33901b4f1870","Version":"1"}'
    const wallet = Wallet.fromV1(sample, 'foo')
    t.deepEqual(wallet.getAddressString(), '0xd4584b5f6229b7be90727b0fc8c6b91bb427821f')
  })
})
*/

tape('.fromV3()', async (t) => {
  t.test('should work with PBKDF2', async (st) => {
    const w =
      '{"crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"6087dab2f9fdbbfaddc31a909735c1e6"},"ciphertext":"5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46","kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"},"mac":"517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"},"id":"3198bc9c-6672-5ab3-d995-4942343ae5b6","version":3}'
    let wEthersCompat = JSON.parse(w)
    // see: https://github.com/ethers-io/ethers.js/issues/582
    wEthersCompat.address = '0x008aeeda4d805471df9b2a5b0f38a0c3bcba786b'
    wEthersCompat = JSON.stringify(wEthersCompat)
    const pw = 'testpassword'
    const wallet = await Wallet.fromV3(w, pw)
    const wRandom = await Wallet.generate().toV3String(pw, { kdf: 'pbkdf2' })
    const walletRandom = await Wallet.fromV3(wRandom, pw)

    st.deepEqual(wallet.getAddressString(), '0x008aeeda4d805471df9b2a5b0f38a0c3bcba786b')
    st.deepEqual(
      wallet.getAddressString(),
      (await ethersWallet.fromEncryptedJson(wEthersCompat, pw)).address.toLowerCase()
    )
    st.deepEqual(
      walletRandom.getAddressString(),
      (await ethersWallet.fromEncryptedJson(wRandom, pw)).address.toLowerCase()
    )
  })
  //@ts-ignore
  t.skip('should work with Scrypt', async (st) => {
    const sample =
      '{"address":"2f91eb73a6cd5620d7abb50889f24eea7a6a4feb","crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"a2bc4f71e8445d64ceebd1247079fbd8"},"ciphertext":"6b9ab7954c9066fa1e54e04e2c527c7d78a77611d5f84fede1bd61ab13c51e3e","kdf":"scrypt","kdfparams":{"dklen":32,"n":262144,"r":1,"p":8,"salt":"caf551e2b7ec12d93007e528093697a4c68e8a50e663b2a929754a8085d9ede4"},"mac":"506cace9c5c32544d39558025cb3bf23ed94ba2626e5338c82e50726917e1a15"},"id":"1b3cad9b-fa7b-4817-9022-d5e598eb5fe3","version":3}'
    const pw = 'testtest'
    const wallet = await Wallet.fromV3(sample, pw)
    const sampleRandom = await Wallet.generate().toV3String(pw)
    const walletRandom = await Wallet.fromV3(sampleRandom, pw)

    st.deepEqual(wallet.getAddressString(), '0x2f91eb73a6cd5620d7abb50889f24eea7a6a4feb')
    st.deepEqual(
      wallet.getAddressString(),
      (await ethersWallet.fromEncryptedJson(sample, pw)).address.toLowerCase()
    )
    st.deepEqual(
      walletRandom.getAddressString(),
      (await ethersWallet.fromEncryptedJson(sampleRandom, pw)).address.toLowerCase()
    )
  }) //@ts-ignore
  t.skip("should work with 'unencrypted' wallets", async (st) => {
    const w =
      '{"address":"a9886ac7489ecbcbd79268a79ef00d940e5fe1f2","crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"c542cf883299b5b0a29155091054028d"},"ciphertext":"0a83c77235840cffcfcc5afe5908f2d7f89d7d54c4a796dfe2f193e90413ee9d","kdf":"scrypt","kdfparams":{"dklen":32,"n":262144,"r":1,"p":8,"salt":"699f7bf5f6985068dfaaff9db3b06aea8fe3dd3140b3addb4e60620ee97a0316"},"mac":"613fed2605240a2ff08b8d93ccc48c5b3d5023b7088189515d70df41d65f44de"},"id":"0edf817a-ee0e-4e25-8314-1f9e88a60811","version":3}'
    const wallet = await Wallet.fromV3(w, '')
    st.deepEqual(wallet.getAddressString(), '0xa9886ac7489ecbcbd79268a79ef00d940e5fe1f2')
  })
  t.test('should fail with invalid password', async (st) => {
    const w =
      '{"crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"6087dab2f9fdbbfaddc31a909735c1e6"},"ciphertext":"5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46","kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"},"mac":"517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"},"id":"3198bc9c-6672-5ab3-d995-4942343ae5b6","version":3}'
    try {
      await Wallet.fromV3(w, 'wrongtestpassword')
    } catch (err: any) {
      st.ok(err.message.includes('Key derivation failed - possibly wrong passphrase'))
    }
  })
  t.test('should work with (broken) mixed-case input files', async (st) => {
    const w =
      '{"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"6087dab2f9fdbbfaddc31a909735c1e6"},"ciphertext":"5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46","kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"},"mac":"517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"},"id":"3198bc9c-6672-5ab3-d995-4942343ae5b6","version":3}'

    const wallet = await Wallet.fromV3(w, 'testpassword', true)
    st.deepEqual(wallet.getAddressString(), '0x008aeeda4d805471df9b2a5b0f38a0c3bcba786b')
  })
  t.test("shouldn't work with (broken) mixed-case input files in strict mode", async (st) => {
    const w =
      '{"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"6087dab2f9fdbbfaddc31a909735c1e6"},"ciphertext":"5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46","kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"},"mac":"517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"},"id":"3198bc9c-6672-5ab3-d995-4942343ae5b6","version":3}'

    try {
      await Wallet.fromV3(w, 'testpassword')
    } catch (err: any) {
      // TODO: Determine if specific error message should be checked (different between NodeJS and browser)
      st.pass('threw error for broken input in strict mode')
    }
  })
  t.test('should fail for wrong version', async (st) => {
    const w = '{"version":2}'
    try {
      await Wallet.fromV3(w, 'testpassword')
    } catch (err: any) {
      st.ok(err.message.includes('Not a V3 wallet'))
    }
  })
  t.test('should fail for wrong kdf', async (st) => {
    const w = '{"crypto":{"kdf":"superkey"},"version":3}'
    try {
      await Wallet.fromV3(w, 'testpassword')
    } catch (err: any) {
      st.ok(err.message.includes('Unsupported key derivation scheme'))
    }
  })
  t.test('should fail for wrong prf in pbkdf2', async (st) => {
    const w = '{"crypto":{"kdf":"pbkdf2","kdfparams":{"prf":"invalid"}},"version":3}'
    try {
      await Wallet.fromV3(w, 'testpassword')
    } catch (err: any) {
      st.ok(err.message.includes('Unsupported parameters to PBKDF2'))
    }
  })
})

tape('.fromEthSale()', (t) => {
  // Generated using https://github.com/ethereum/pyethsaletool/ [4afd19ad60cee8d09b645555180bc3a7c8a25b67]
  t.test('should work with short password (8 characters)', async function () {
    const json =
      '{"encseed": "81ffdfaf2736310ce87df268b53169783e8420b98f3405fb9364b96ac0feebfb62f4cf31e0d25f1ded61f083514dd98c3ce1a14a24d7618fd513b6d97044725c7d2e08a7d9c2061f2c8a05af01f06755c252f04cab20fee2a4778130440a9344", "ethaddr": "22f8c5dd4a0a9d59d580667868df2da9592ab292", "email": "hello@ethereum.org", "btcaddr": "1DHW32MFwHxU2nk2SLAQq55eqFotT9jWcq"}'
    const wallet = await Wallet.fromEthSale(json, 'testtest')
    t.deepEqual(wallet.getAddressString(), '0x22f8c5dd4a0a9d59d580667868df2da9592ab292')
  })
  t.test('should work with long password (19 characters)', async function () {
    const json =
      '{"encseed": "0c7e462bd67c6840ed2fa291090b2f46511b798d34492e146d6de148abbccba45d8fcfc06bea2e5b9d6c5d17b51a9a046c1054a032f24d96a56614a14dcd02e3539685d7f09b93180067160f3a9db648ccca610fc2f983fc65bf973304cbf5b6", "ethaddr": "c90b232231c83b462723f473b35cb8b1db868108", "email": "thisisalongpassword@test.com", "btcaddr": "1Cy2fN2ov5BrMkzgrzE34YadCH2yLMNkTE"}'
    const wallet = await Wallet.fromEthSale(json, 'thisisalongpassword')
    t.deepEqual(wallet.getAddressString(), '0xc90b232231c83b462723f473b35cb8b1db868108')
  })
  // From https://github.com/ryepdx/pyethrecover/blob/master/test_wallets/ico.json
  t.test("should work with pyethrecover's wallet", async function () {
    const json =
      '{"encseed": "8b4001bf61a10760d8e0876fb791e4ebeb85962f565c71697c789c23d1ade4d1285d80b2383ae5fc419ecf5319317cd94200b65df0cc50d659cbbc4365fc08e8", "ethaddr": "83b6371ba6bd9a47f82a7c4920835ef4be08f47b", "bkp": "9f566775e56486f69413c59f7ef923bc", "btcaddr": "1Nzg5v6uRCAa6Fk3CUU5qahWxEDZdZ1pBm"}'
    const wallet = await Wallet.fromEthSale(json, 'password123')
    t.deepEqual(wallet.getAddressString(), '0x83b6371ba6bd9a47f82a7c4920835ef4be08f47b')
  })
})

tape('.fromEtherWallet()', (t) => {
  // t.test('should work with unencrypted input', function () {
  //   const etherWalletUnencrypted = '{"address":"0x9d6abd11d36cc20d4836c25967f1d9efe6b1a27c","encrypted":true,"locked":false,"hash":"b7a6621e8b125a17234d3e5c35522696a84134d98d07eab2479d020a8613c4bd","private":"a2c6222146ca2269086351fda9f8d2dfc8a50331e8a05f0f400c13653a521862","public":"2ed129b50b1a4dbbc53346bf711df6893265ad0c700fd11431b0bc3a66bd383a87b10ad835804a6cbe092e0375a0cc3524acf06b1ec7bb978bf25d2d6c35d120"}'
  //   const wallet = Thirdparty.fromEtherWallet(etherWalletUnencrypted)
  //   t.deepEqual(wallet.getAddressString(), '0x9d6abd11d36cc20d4836c25967f1d9efe6b1a27c')
  // })
  t.test('should work with encrypted input', async function () {
    const etherWalletEncrypted =
      '{"address":"0x9d6abd11d36cc20d4836c25967f1d9efe6b1a27c","encrypted":true,"locked":true,"hash":"b7a6621e8b125a17234d3e5c35522696a84134d98d07eab2479d020a8613c4bd","private":"U2FsdGVkX1/hGPYlTZYGhzdwvtkoZfkeII4Ga4pSd/Ak373ORnwZE4nf/FFZZFcDTSH1X1+AmewadrW7dqvwr76QMYQVlihpPaFV307hWgKckkG0Mf/X4gJIQQbDPiKdcff9","public":"U2FsdGVkX1/awUDAekZQbEiXx2ct4ugXwgBllY0Hz+IwYkHiEhhxH+obu7AF7PCU2Vq5c0lpCzBUSvk2EvFyt46bw1OYIijw0iOr7fWMJEkz3bfN5mt9pYJIiPzN0gxM8u4mrmqLPUG2SkoZhWz4NOlqRUHZq7Ep6aWKz7KlEpzP9IrvDYwGubci4h+9wsspqtY1BdUJUN59EaWZSuOw1g=="}'
    const wallet = await Thirdparty.fromEtherWallet(etherWalletEncrypted, 'testtest')
    t.deepEqual(wallet.getAddressString(), '0x9d6abd11d36cc20d4836c25967f1d9efe6b1a27c')
  })
})

tape('.fromEtherCamp()', (t) => {
  const wallet = Thirdparty.fromEtherCamp('ethercamp123')
  t.equal(
    wallet.getAddressString(),
    '0x182b6ca390224c455f11b6337d74119305014ed4',
    'should work with seed text'
  )
  t.end()
})

tape('.fromQuorumWallet()', (t) => {
  const wallet = Thirdparty.fromQuorumWallet('testtesttest', 'ethereumjs-wallet')
  t.equal(wallet.getAddressString(), '0x1b86ccc22e8f137f204a41a23033541242a48815')
  t.end()
})

tape('raw new Wallet() init', (t) => {
  t.throws(
    function () {
      new Wallet(fixturePrivateKeyBuffer, fixturePublicKeyBuffer)
    },
    (err: any) =>
      err.message.includes('Cannot supply both a private and a public key to the constructor'),
    'should fail when both priv and pub key provided'
  )
  t.end()
})
