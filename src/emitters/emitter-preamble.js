'use strict'

// Shared preamble content emitted by all server targets.
// Includes response helpers and body parser - identical across Bun and Cloudflare.

const SHARED_RESPONSE_HELPERS = `
// Pick only the listed keys from an object - used by db helpers to strip unexpected request fields
function _pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return {}
  const out = Object.create(null)
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  return out
}

// Pre-allocated header objects - reused across requests to avoid per-request allocation
// _CORS_ORIGIN is emitted by callers (null = no CORS, string = allowed origin)
const _HEADERS_JSON = _CORS_ORIGIN
  ? { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': _CORS_ORIGIN }
  : { 'Content-Type': 'application/json' }
const _HEADERS_HTML = _CORS_ORIGIN
  ? { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': _CORS_ORIGIN }
  : { 'Content-Type': 'text/html; charset=utf-8' }
const _HEADERS_TEXT = _CORS_ORIGIN
  ? { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': _CORS_ORIGIN }
  : { 'Content-Type': 'text/plain; charset=utf-8' }

// Response helpers
const _json = (data, status = 200, headers = null) =>
  new Response(JSON.stringify(data), {
    status,
    headers: headers ? { ..._HEADERS_JSON, ...headers } : _HEADERS_JSON
  })

const _html = (body, status = 200, headers = null) =>
  new Response(body, {
    status,
    headers: headers ? { ..._HEADERS_HTML, ...headers } : _HEADERS_HTML
  })

const _text = (body, status = 200, headers = null) =>
  new Response(body, {
    status,
    headers: headers ? { ..._HEADERS_TEXT, ...headers } : _HEADERS_TEXT
  })

const _redirect = (location, status = 302) =>
  new Response(null, { status, headers: { Location: location } })

// Body parser: JSON, multipart, or application/x-www-form-urlencoded
const _MAX_BODY_SIZE = 1024 * 1024 // 1 MB
async function _parseBody(req) {
  const ct = req.headers.get('content-type') ?? ''
  // JSON fast path first - most API routes send application/json
  if (ct.includes('application/json')) {
    const length = +(req.headers.get('content-length') ?? 0)
    if (length > _MAX_BODY_SIZE) throw Object.assign(new Error('Request body too large'), { status: 413 })
    // req.json() is a single native C++ call vs arrayBuffer→decode→parse (3 allocations)
    try { return await req.json() }
    catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }) }
  }
  if (ct.includes('multipart/form-data')) {
    // Reject chunked multipart (no Content-Length) - req.formData() has no built-in
    // size limit, so an attacker could stream an unbounded body to exhaust memory.
    if (!req.headers.get('content-length')) throw Object.assign(new Error('Chunked multipart not supported — send Content-Length'), { status: 413 })
    const length = +(req.headers.get('content-length') ?? 0)
    if (length > _MAX_BODY_SIZE) throw Object.assign(new Error('Request body too large'), { status: 413 })
    const fd = await req.formData()
    return Object.fromEntries(fd.entries())
  }
  // Fall back to arrayBuffer for urlencoded and unknown types
  const buf = await req.arrayBuffer()
  if (buf.byteLength > _MAX_BODY_SIZE) throw Object.assign(new Error('Request body too large'), { status: 413 })
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(buf)))
  return {}
}
`.trimStart()

module.exports = { SHARED_RESPONSE_HELPERS }
