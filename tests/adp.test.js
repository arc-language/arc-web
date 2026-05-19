'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { encode, decode: adpDecode, TAG, Encoder, encodeArray } = require('../adp/encoder')
const { decode, Decoder } = require('../adp/decoder')

// Helper: round-trip encode then decode
function roundTrip(value) {
  return decode(encode(value))
}

// Helper: get raw bytes as array
function bytes(value) {
  return Array.from(encode(value))
}

describe('ADP Protocol', () => {

  describe('TAG constants', () => {
    test('NULL tag is 0x00', () => {
      assert.equal(TAG.NULL, 0x00)
    })

    test('TRUE tag is 0x01', () => {
      assert.equal(TAG.TRUE, 0x01)
    })

    test('FALSE tag is 0x02', () => {
      assert.equal(TAG.FALSE, 0x02)
    })

    test('UINT8 tag is 0x03', () => {
      assert.equal(TAG.UINT8, 0x03)
    })

    test('INT32 tag is 0x04', () => {
      assert.equal(TAG.INT32, 0x04)
    })

    test('FLOAT64 tag is 0x05', () => {
      assert.equal(TAG.FLOAT64, 0x05)
    })

    test('STRING tag is 0x06', () => {
      assert.equal(TAG.STRING, 0x06)
    })

    test('ARRAY tag is 0x07', () => {
      assert.equal(TAG.ARRAY, 0x07)
    })

    test('OBJECT tag is 0x08', () => {
      assert.equal(TAG.OBJECT, 0x08)
    })
  })

  describe('primitive encoding byte layout', () => {
    test('encode(null) produces [0x00]', () => {
      assert.deepEqual(bytes(null), [0x00])
    })

    test('encode(undefined) produces [0x00]', () => {
      assert.deepEqual(bytes(undefined), [0x00])
    })

    test('encode(true) produces [0x01]', () => {
      assert.deepEqual(bytes(true), [0x01])
    })

    test('encode(false) produces [0x02]', () => {
      assert.deepEqual(bytes(false), [0x02])
    })

    test('encode(42) produces [0x03, 42] (UINT8 for small positive int)', () => {
      assert.deepEqual(bytes(42), [0x03, 42])
    })

    test('encode(0) produces [0x03, 0]', () => {
      assert.deepEqual(bytes(0), [0x03, 0])
    })

    test('encode(255) produces [0x03, 255] (max UINT8)', () => {
      assert.deepEqual(bytes(255), [0x03, 255])
    })

    test('encode(-1) uses INT32 tag (0x04)', () => {
      const b = bytes(-1)
      assert.equal(b[0], 0x04, `Expected INT32 tag (0x04) for -1, got 0x${b[0].toString(16)}`)
    })

    test('encode(256) uses INT32 tag since it exceeds UINT8 range', () => {
      const b = bytes(256)
      assert.equal(b[0], 0x04, `Expected INT32 tag (0x04) for 256, got 0x${b[0].toString(16)}`)
    })

    test('encode("hi") starts with STRING tag 0x06', () => {
      const b = bytes('hi')
      assert.equal(b[0], 0x06)
    })

    test('encode("hi") encodes length as varint then bytes', () => {
      const b = bytes('hi')
      // [0x06, 0x02, 0x68, 0x69]
      // tag=6, len=2, 'h'=0x68, 'i'=0x69
      assert.equal(b[0], 0x06)  // STRING tag
      assert.equal(b[1], 0x02)  // length = 2
      assert.equal(b[2], 0x68)  // 'h'
      assert.equal(b[3], 0x69)  // 'i'
    })

    test('encode("") produces STRING tag + zero length', () => {
      const b = bytes('')
      assert.equal(b[0], 0x06)
      assert.equal(b[1], 0x00)
      assert.equal(b.length, 2)
    })
  })

  describe('round-trip correctness', () => {
    test('null round-trips', () => {
      assert.equal(roundTrip(null), null)
    })

    test('true round-trips', () => {
      assert.equal(roundTrip(true), true)
    })

    test('false round-trips', () => {
      assert.equal(roundTrip(false), false)
    })

    test('0 round-trips', () => {
      assert.equal(roundTrip(0), 0)
    })

    test('255 round-trips (max UINT8)', () => {
      assert.equal(roundTrip(255), 255)
    })

    test('-1 round-trips (INT32)', () => {
      assert.equal(roundTrip(-1), -1)
    })

    test('large negative integer round-trips', () => {
      assert.equal(roundTrip(-100000), -100000)
    })

    test('3.14 round-trips (FLOAT64)', () => {
      assert.ok(Math.abs(roundTrip(3.14) - 3.14) < 1e-10)
    })

    test('"hello" string round-trips', () => {
      assert.equal(roundTrip('hello'), 'hello')
    })

    test('unicode string round-trips', () => {
      assert.equal(roundTrip('héllo wörld'), 'héllo wörld')
    })

    test('empty string round-trips', () => {
      assert.equal(roundTrip(''), '')
    })

    test('empty array round-trips', () => {
      assert.deepEqual(roundTrip([]), [])
    })

    test('array of numbers round-trips', () => {
      assert.deepEqual(roundTrip([1, 2, 3]), [1, 2, 3])
    })

    test('array of strings round-trips', () => {
      assert.deepEqual(roundTrip(['a', 'b', 'c']), ['a', 'b', 'c'])
    })

    test('empty object round-trips', () => {
      assert.deepEqual(roundTrip({}), {})
    })

    test('flat object round-trips', () => {
      const obj = { name: 'Alice', age: 30, active: true }
      assert.deepEqual(roundTrip(obj), obj)
    })

    test('nested object round-trips', () => {
      const obj = { user: { name: 'Bob', scores: [10, 20, 30] }, count: 3 }
      assert.deepEqual(roundTrip(obj), obj)
    })

    test('mixed-type array round-trips', () => {
      const arr = [null, true, 42, 'hi', { x: 1 }]
      assert.deepEqual(roundTrip(arr), arr)
    })
  })

  describe('Date encoding', () => {
    test('Date round-trips preserving timestamp', () => {
      const d = new Date('2026-01-15T12:00:00.000Z')
      const decoded = roundTrip(d)
      assert.ok(decoded instanceof Date)
      assert.equal(decoded.getTime(), d.getTime())
    })

    test('Date uses DATE tag (0x09)', () => {
      const b = bytes(new Date(0))
      assert.equal(b[0], 0x09)
    })

    test('epoch date (timestamp 0) round-trips', () => {
      const d = new Date(0)
      const decoded = roundTrip(d)
      assert.equal(decoded.getTime(), 0)
    })
  })

  describe('size efficiency vs JSON', () => {
    test('ADP is smaller than JSON for a typical object', () => {
      const obj = {
        id: 1,
        name: 'Alice',
        active: true,
        score: 42,
        tags: ['admin', 'user']
      }
      const adpSize = encode(obj).length
      const jsonSize = Buffer.byteLength(JSON.stringify(obj), 'utf8')
      assert.ok(adpSize < jsonSize,
        `Expected ADP (${adpSize} bytes) < JSON (${jsonSize} bytes)`)
    })

    test('ADP encodes true as 1 byte vs JSON "true" (4 bytes)', () => {
      assert.equal(encode(true).length, 1)
      assert.ok(Buffer.byteLength(JSON.stringify(true), 'utf8') > 1)
    })

    test('ADP encodes null as 1 byte vs JSON "null" (4 bytes)', () => {
      assert.equal(encode(null).length, 1)
      assert.ok(Buffer.byteLength(JSON.stringify(null), 'utf8') > 1)
    })

    test('ADP encodes small integer as 2 bytes vs JSON digit string', () => {
      assert.equal(encode(42).length, 2)
    })
  })

  describe('encodeArray helper', () => {
    test('encodeArray produces ARRAY tag at start', () => {
      const buf = encodeArray([1, 2, 3])
      assert.equal(buf[0], TAG.ARRAY)
    })

    test('encodeArray result round-trips via decode', () => {
      const original = [10, 20, 30]
      const decoded = decode(encodeArray(original))
      assert.deepEqual(decoded, original)
    })

    test('encodeArray of objects round-trips', () => {
      const items = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
      const decoded = decode(encodeArray(items))
      assert.deepEqual(decoded, items)
    })
  })

  describe('Decoder class', () => {
    test('Decoder accepts Buffer input', () => {
      const buf = encode(42)
      const dec = new Decoder(buf)
      assert.equal(dec.decode(), 42)
    })

    test('Decoder accepts Uint8Array input', () => {
      const buf = new Uint8Array(encode(true))
      const dec = new Decoder(buf)
      assert.equal(dec.decode(), true)
    })

    test('Decoder throws on unknown tag', () => {
      const buf = Buffer.from([0xFF])
      const dec = new Decoder(buf)
      assert.throws(() => dec.decode(), /ADP: unknown tag/)
    })
  })

})
