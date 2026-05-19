'use strict'
const { encode, encodeArray } = require('arc/adp/encoder')

// @server fn getUser
async function _handler_getUser(req) {
  try {
    // Parse ADP or JSON request body
    const _body = req.method === 'POST' ? await _parseBody(req) : {}
    const { id } = _body
    const _session = req._arc_session ?? {}  // injected by auth middleware
    const _result = await (async function() {
      return {"name":"Alex Chen","role":"admin"};
    })()
    const _encoded = Array.isArray(_result) ? encodeArray(_result) : encode(_result)
    return new Response(_encoded, {
      headers: { 'Content-Type': 'application/x-adp', 'Content-Length': String(_encoded.length) }
    })
  } catch (_e) {
    return new Response(JSON.stringify({ error: _e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}

// @server fn getStats
async function _handler_getStats(req) {
  try {
    // Parse ADP or JSON request body
    const _body = req.method === 'POST' ? await _parseBody(req) : {}
    const {  } = _body
    const _session = req._arc_session ?? {}  // injected by auth middleware
    const _result = await (async function() {
      return {"users":12483,"posts":3721,"revenue":94200};
    })()
    const _encoded = Array.isArray(_result) ? encodeArray(_result) : encode(_result)
    return new Response(_encoded, {
      headers: { 'Content-Type': 'application/x-adp', 'Content-Length': String(_encoded.length) }
    })
  } catch (_e) {
    return new Response(JSON.stringify({ error: _e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}

async function _parseBody(req) {
  const ct = req.headers.get?.('content-type') ?? req.headers['content-type'] ?? ''
  const buf = await req.arrayBuffer()
  if (ct.includes('application/x-adp')) {
    const { decode } = require('arc/adp/decoder')
    return decode(new Uint8Array(buf))
  }
  return JSON.parse(new TextDecoder().decode(buf) || '{}')
}

// Cloudflare Workers / WinterCG fetch handler
export default {
  async fetch(req) {
    const _path = new URL(req.url).pathname
  if (_path === '/_arc/fn/getUser') return _handler_getUser(req)
  if (_path === '/_arc/fn/getStats') return _handler_getStats(req)
    return new Response('Not Found', { status: 404 })
  }
}

// Node.js / Bun / Deno adapter
if (typeof module !== 'undefined') module.exports = { _handler_getUser, _handler_getStats }