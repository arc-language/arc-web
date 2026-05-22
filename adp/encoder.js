'use strict'

// ADP — Arc Data Protocol: binary encoding replacing JSON
// Type tags: 0x00=null, 0x01=true, 0x02=false, 0x03=uint8, 0x04=int32,
//            0x05=float64, 0x06=string, 0x07=array, 0x08=object,
//            0x09=date(epoch ms as int64), 0x0A=enum(uint8 index)

const TAG = {
  NULL:    0x00,
  TRUE:    0x01,
  FALSE:   0x02,
  UINT8:   0x03,
  INT32:   0x04,
  FLOAT64: 0x05,
  STRING:  0x06,
  ARRAY:   0x07,
  OBJECT:  0x08,
  DATE:    0x09,
  ENUM:    0x0A,
}

// Pre-allocated single-byte Buffers for all 256 values — avoids per-tag allocation
const _B = Array.from({length: 256}, (_, i) => Buffer.from([i]))
// Module-level scratch for varint encoding (max 5 bytes for 32-bit, 10 for 64-bit)
const _VARINT_SCRATCH = Buffer.allocUnsafe(10)

class Encoder {
  constructor() {
    this.buf = []
  }

  encode(value) {
    this.buf = []
    this.writeValue(value)
    return Buffer.concat(this.buf)
  }

  writeValue(val) {
    if (val === null || val === undefined) {
      this.buf.push(_B[TAG.NULL])
      return
    }

    if (val === true)  { this.buf.push(_B[TAG.TRUE]);  return }
    if (val === false) { this.buf.push(_B[TAG.FALSE]); return }

    if (val instanceof Date) {
      this.buf.push(_B[TAG.DATE])
      this.writeInt64(val.getTime())
      return
    }

    if (Array.isArray(val)) {
      this.buf.push(_B[TAG.ARRAY])
      this.writeVarInt(val.length)
      for (const item of val) this.writeValue(item)
      return
    }

    if (typeof val === 'number') {
      if (Number.isInteger(val) && val >= 0 && val <= 255) {
        this.buf.push(_B[TAG.UINT8], _B[val])
      } else if (Number.isInteger(val) && val >= -2147483648 && val <= 2147483647) {
        this.buf.push(_B[TAG.INT32])
        this.writeInt32(val)
      } else {
        this.buf.push(_B[TAG.FLOAT64])
        this.writeFloat64(val)
      }
      return
    }

    if (typeof val === 'string') {
      this.buf.push(_B[TAG.STRING])
      this.writeString(val)
      return
    }

    if (typeof val === 'object') {
      const keys = Object.keys(val).filter(k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
      this.buf.push(_B[TAG.OBJECT])
      this.writeVarInt(keys.length)
      for (const key of keys) {
        this.writeString(key)
        this.writeValue(val[key])
      }
      return
    }

    // Fallback: stringify
    this.buf.push(_B[TAG.STRING])
    this.writeString(String(val))
  }

  writeString(str) {
    const bytes = Buffer.from(str, 'utf8')
    this.writeVarInt(bytes.length)
    this.buf.push(bytes)
  }

  writeVarInt(n) {
    if (n < 128) {
      this.buf.push(_B[n])
      return
    }
    let len = 0
    while (n > 127) {
      _VARINT_SCRATCH[len++] = (n & 0x7f) | 0x80
      n >>>= 7
    }
    _VARINT_SCRATCH[len++] = n
    this.buf.push(Buffer.from(_VARINT_SCRATCH.subarray(0, len)))
  }

  writeInt32(n) {
    const b = Buffer.allocUnsafe(4)
    b[0] = (n >>> 24) & 0xff
    b[1] = (n >>> 16) & 0xff
    b[2] = (n >>> 8) & 0xff
    b[3] = n & 0xff
    this.buf.push(b)
  }

  writeFloat64(n) {
    const b = Buffer.allocUnsafe(8)
    b.writeDoubleBE(n, 0)
    this.buf.push(b)
  }

  writeInt64(n) {
    // Write as two int32 (high, low) for simplicity
    const hi = Math.floor(n / 0x100000000)
    const lo = n >>> 0
    this.writeInt32(hi)
    this.writeInt32(lo)
  }
}

// Encode with schema for maximum compression
// Schema: { fieldOrder: ['id','name',...], enums: { role: ['admin','user'] } }
class SchemaEncoder extends Encoder {
  constructor(schema = {}) {
    super()
    this.schema = schema
  }

  encodeWithSchema(value, typeName) {
    const typeSchema = this.schema[typeName]
    if (!typeSchema || typeof value !== 'object' || Array.isArray(value)) {
      return this.encode(value)
    }

    this.buf = []
    this.writeObjectWithSchema(value, typeSchema)
    return Buffer.concat(this.buf)
  }

  writeObjectWithSchema(obj, schema) {
    const fields = schema.fields ?? Object.keys(obj)
    this.buf.push(_B[TAG.OBJECT])
    this.writeVarInt(fields.length)
    for (const field of fields) {
      this.writeString(field)
      const val = obj[field]
      const fieldSchema = schema.fieldTypes?.[field]
      if (fieldSchema?.enum) {
        const idx = fieldSchema.enum.indexOf(val)
        this.buf.push(_B[TAG.ENUM], _B[idx >= 0 ? idx : 0])
      } else {
        this.writeValue(val)
      }
    }
  }
}

function encode(value) {
  return new Encoder().encode(value)
}

function encodeArray(items) {
  const enc = new Encoder()
  enc.buf.push(_B[TAG.ARRAY])
  enc.writeVarInt(items.length)
  for (const item of items) enc.writeValue(item)
  return Buffer.concat(enc.buf)
}

// Express/Bun/Deno middleware helper: send ADP response
function sendAdp(res, data) {
  const buf = Array.isArray(data) ? encodeArray(data) : encode(data)
  if (res.setHeader) {
    res.setHeader('Content-Type', 'application/x-adp')
    res.setHeader('Content-Length', buf.length)
    res.end(buf)
  } else if (typeof res === 'function') {
    res(new Response(buf, { headers: { 'Content-Type': 'application/x-adp' } }))
  }
  return buf
}

module.exports = { Encoder, SchemaEncoder, encode, encodeArray, sendAdp, TAG }
