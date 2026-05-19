'use strict'
// ADP decoder — also ships as browser bundle < 1KB gzipped
// Same file works in Node.js and browser (via bundler or <script type=module>)

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

class Decoder {
  constructor(buf) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    this.pos = 0
  }

  decode() {
    return this.readValue()
  }

  readValue() {
    const tag = this.buf[this.pos++]

    switch (tag) {
      case TAG.NULL:    return null
      case TAG.TRUE:    return true
      case TAG.FALSE:   return false

      case TAG.UINT8:
        return this.buf[this.pos++]

      case TAG.INT32: {
        const v = (this.buf[this.pos] << 24) | (this.buf[this.pos+1] << 16) |
                  (this.buf[this.pos+2] << 8) | this.buf[this.pos+3]
        this.pos += 4
        return v
      }

      case TAG.FLOAT64: {
        const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8)
        this.pos += 8
        return dv.getFloat64(0, false) // big-endian
      }

      case TAG.STRING:
        return this.readString()

      case TAG.ARRAY: {
        const len = this.readVarInt()
        if (len > 100000) throw new Error(`ADP decode: array length too large: ${len}`)
        const arr = new Array(len)
        for (let i = 0; i < len; i++) arr[i] = this.readValue()
        return arr
      }

      case TAG.OBJECT: {
        const count = this.readVarInt()
        if (count > 10000) throw new Error(`ADP decode: object key count too large: ${count}`)
        const obj = {}
        for (let i = 0; i < count; i++) {
          const key = this.readString()
          obj[key] = this.readValue()
        }
        return obj
      }

      case TAG.DATE: {
        const hi = (this.buf[this.pos] << 24) | (this.buf[this.pos+1] << 16) |
                   (this.buf[this.pos+2] << 8) | this.buf[this.pos+3]
        const lo = ((this.buf[this.pos+4] << 24) | (this.buf[this.pos+5] << 16) |
                    (this.buf[this.pos+6] << 8) | this.buf[this.pos+7]) >>> 0
        this.pos += 8
        return new Date(hi * 0x100000000 + lo)
      }

      case TAG.ENUM:
        return this.buf[this.pos++]  // returns index; caller maps to string with schema

      default:
        throw new Error(`ADP: unknown tag 0x${tag.toString(16)} at pos ${this.pos - 1}`)
    }
  }

  readString() {
    const len = this.readVarInt()
    const bytes = this.buf.subarray(this.pos, this.pos + len)
    this.pos += len
    // Works in Node.js and browser
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(bytes)
    }
    return Buffer.from(bytes).toString('utf8')
  }

  readVarInt() {
    let result = 0
    let shift = 0
    while (true) {
      if (this.pos >= this.buf.length) throw new Error('ADP decode: unexpected end of buffer in varint')
      const byte = this.buf[this.pos++]
      result |= (byte & 0x7f) << shift
      if (!(byte & 0x80)) break
      shift += 7
      if (shift > 35) throw new Error('ADP decode: varint overflow')
    }
    return result >>> 0
  }
}

function decode(buf) {
  return new Decoder(buf).decode()
}

// Fetch ADP from a URL (browser + Node.js)
async function fetchAdp(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Accept': 'application/x-adp', ...(options.headers ?? {}) }
  })
  if (!res.ok) throw new Error(`ADP fetch ${url}: ${res.status}`)
  const buf = await res.arrayBuffer()
  return decode(new Uint8Array(buf))
}

// Schema-aware decode: maps enum indices back to string values
function decodeWithSchema(buf, typeName, schemas) {
  const raw = decode(buf)
  const schema = schemas?.[typeName]
  if (!schema || typeof raw !== 'object') return raw
  return applySchema(raw, schema, schemas)
}

function applySchema(obj, schema, schemas) {
  if (Array.isArray(obj)) return obj.map(item => applySchema(item, schema, schemas))
  const result = {}
  const fields = schema.fields ?? Object.keys(obj)
  for (const field of fields) {
    const val = obj[field]
    const fieldSchema = schema.fieldTypes?.[field]
    if (fieldSchema?.enum && typeof val === 'number') {
      result[field] = fieldSchema.enum[val] ?? val
    } else if (fieldSchema?.type && schemas?.[fieldSchema.type]) {
      result[field] = applySchema(val, schemas[fieldSchema.type], schemas)
    } else {
      result[field] = val
    }
  }
  return result
}

// Export for both CommonJS and ESM
if (typeof module !== 'undefined') {
  module.exports = { Decoder, decode, fetchAdp, decodeWithSchema, TAG }
}
if (typeof globalThis !== 'undefined') {
  globalThis.ADP = { decode, fetchAdp }
}
