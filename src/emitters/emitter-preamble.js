'use strict'

// Shared preamble content emitted by all server targets.
// Includes response helpers and body parser — identical across Bun and Cloudflare.

const SHARED_RESPONSE_HELPERS = `
// Pick only the listed keys from an object — used by db helpers to strip unexpected request fields
function _pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return {}
  const out = Object.create(null)
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  return out
}

// Response helpers
const _json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })

const _html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

const _text = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

const _redirect = (location, status = 302) =>
  new Response(null, { status, headers: { Location: location } })

// Body parser: JSON or application/x-www-form-urlencoded
const _MAX_BODY_SIZE = 1024 * 1024 // 1 MB
const _td = new TextDecoder()
async function _parseBody(req) {
  const length = +(req.headers.get('content-length') ?? 0)
  if (length > _MAX_BODY_SIZE) throw Object.assign(new Error('Request body too large'), { status: 413 })
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('multipart/form-data')) {
    // Note: Content-Length check already applied above (line 35). Chunked multipart
    // (no Content-Length) bypasses both checks — req.formData() has no built-in size
    // limit. A full fix requires a streaming multipart parser (out of scope here).
    const fd = await req.formData()
    return Object.fromEntries(fd.entries())
  }
  // Read actual bytes to enforce limit for chunked requests (no Content-Length)
  const buf = await req.arrayBuffer()
  if (buf.byteLength > _MAX_BODY_SIZE) throw Object.assign(new Error('Request body too large'), { status: 413 })
  const text = _td.decode(buf)
  if (ct.includes('application/json')) {
    try { return JSON.parse(text) } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }) }
  }
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text))
  return {}
}
`.trimStart()

module.exports = { SHARED_RESPONSE_HELPERS }
