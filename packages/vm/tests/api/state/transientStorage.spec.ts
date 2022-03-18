import tape from 'tape'
import { Address } from 'ethereumjs-util'
import { TransientStorage } from '../../../src/state'

tape('Transient Storage', (tester) => {
  const it = tester.test
  it('should set and get storage', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x99)

    transientStorage.put(address, key, value)
    const got = transientStorage.get(address, key)
    t.deepEqual(value, got)
    t.end()
  })

  it('should return bytes32(0) if there is no key set', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x11)

    // No address set
    const got = transientStorage.get(address, key)
    t.deepEqual(Buffer.alloc(32, 0x00), got)

    // Address set, no key set
    transientStorage.put(address, key, value)
    const got2 = transientStorage.get(address, Buffer.alloc(32, 0x22))
    t.deepEqual(Buffer.alloc(32, 0x00), got2)
    t.end()
  })

  it('should revert', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x99)

    transientStorage.put(address, key, value)

    transientStorage.checkpoint()

    const value2 = Buffer.alloc(32, 0x22)
    transientStorage.put(address, key, value2)
    const got = transientStorage.get(address, key)
    t.deepEqual(got, value2)

    transientStorage.revert()

    const got2 = transientStorage.get(address, key)
    t.deepEqual(got2, value)
    t.end()
  })

  it('should commit', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x99)

    transientStorage.put(address, key, value)

    transientStorage.checkpoint()
    transientStorage.commit()

    const got = transientStorage.get(address, key)
    t.deepEqual(got, value)
    t.end()
  })

  it('should copy', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x99)

    transientStorage.put(address, key, value)

    const transientStorage2 = transientStorage.copy()
    transientStorage2.put(address, key, Buffer.alloc(32, 0x11))

    const got = transientStorage.get(address, key)
    const got2 = transientStorage2.get(address, key)

    t.notEqual(got.toString('hex'), got2.toString('hex'))
    t.end()
  })

  it('should fail to commit without checkpoint', (t) => {
    const transientStorage = new TransientStorage()

    t.throws(() => {
      transientStorage.commit()
    }, /trying to commit when not checkpointed/)

    t.end()
  })

  it('should fail to revert with empty changesets', (t) => {
    const transientStorage = new TransientStorage()
    transientStorage._changesets = []

    t.throws(() => {
      transientStorage.revert()
    }, /cannot revert without a changeset/)

    t.end()
  })

  it('should fail to add storage with empty changesets', (t) => {
    const transientStorage = new TransientStorage()
    transientStorage._changesets = []

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x99)

    t.throws(() => {
      transientStorage.put(address, key, value)
    }, /no changeset initialized/)

    t.end()
  })

  it('should fail with wrong size key/value', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')

    t.throws(() => {
      transientStorage.put(address, Buffer.alloc(10), Buffer.alloc(1))
    }, /Transient storage key must be 32 bytes long/)

    t.throws(() => {
      transientStorage.put(address, Buffer.alloc(32), Buffer.alloc(100))
    }, /Transient storage value cannot be longer than 32 bytes/)

    t.end()
  })

  it('should clear', (t) => {
    const transientStorage = new TransientStorage()

    const address = Address.fromString('0xff00000000000000000000000000000000000002')
    const key = Buffer.alloc(32, 0xff)
    const value = Buffer.alloc(32, 0x99)

    transientStorage.put(address, key, value)

    transientStorage.clear()

    const got = transientStorage.get(address, key)
    t.deepEqual(got, Buffer.alloc(32, 0x00))
    t.end()
  })
})
