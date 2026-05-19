'use strict'

// @server function compiler.
// Input:  ServerFn AST nodes from the program
// Output: { edgeFunctions: string, clientStubs: string }
//
// Each @server fn becomes:
//   1. An edge handler at /_arc/fn/<name> (runs server-side)
//   2. A typed client stub (runs browser-side, fetches the endpoint via ADP)

const { JsEmitter } = require('./js')

class ServerEmitter {
  constructor(options = {}) {
    this.options = options
    this.componentHash = options.hash ?? 'arc'
    this.jsEmitter = new JsEmitter(options)
  }

  emitProgram(program) {
    const serverFns = program.declarations.filter(d => d.type === 'ServerFn')
    if (serverFns.length === 0) return { edgeFunctions: '', clientStubs: '' }

    const edgeFunctions = this.emitEdgeFunctions(serverFns)
    const clientStubs = this.emitClientStubs(serverFns)

    return { edgeFunctions, clientStubs }
  }

  // ── Edge functions ─────────────────────────────────────────────────────────
  // Generated file: dist/_arc/fn/<name>.js
  // Compatible with Cloudflare Workers, Deno Deploy, Bun, Node.js (via adapters)

  emitEdgeFunctions(serverFns) {
    const parts = [
      `'use strict'`,
      `const { encode, encodeArray } = require('arc/adp/encoder')`,
      ``,
    ]

    for (const fn of serverFns) {
      parts.push(this.emitEdgeHandler(fn))
    }

    // Router: dispatch by function name in path
    parts.push(this.emitEdgeRouter(serverFns))

    return parts.join('\n')
  }

  emitEdgeHandler(fn) {
    const params = (fn.params ?? []).map(p => p.name ?? p).join(', ')
    const body = this.jsEmitter.emitBody(fn.body?.body ?? fn.body)

    return [
      `// @server fn ${fn.name}`,
      `async function _handler_${fn.name}(req) {`,
      `  try {`,
      `    // Parse ADP or JSON request body`,
      `    const _body = req.method === 'POST' ? await _parseBody(req) : {}`,
      `    const { ${params} } = _body`,
      `    const _session = req._arc_session ?? {}  // injected by auth middleware`,
      `    const _result = await (async function() {`,
      `      ${body}`,
      `    })()`,
      `    const _encoded = Array.isArray(_result) ? encodeArray(_result) : encode(_result)`,
      `    return new Response(_encoded, {`,
      `      headers: { 'Content-Type': 'application/x-adp', 'Content-Length': String(_encoded.length) }`,
      `    })`,
      `  } catch (_e) {`,
      `    return new Response(JSON.stringify({ error: _e.message }), {`,
      `      status: 500, headers: { 'Content-Type': 'application/json' }`,
      `    })`,
      `  }`,
      `}`,
      ``,
    ].join('\n')
  }

  emitEdgeRouter(serverFns) {
    const cases = serverFns.map(fn =>
      `  if (_path === '/_arc/fn/${fn.name}') return _handler_${fn.name}(req)`
    ).join('\n')

    return [
      `async function _parseBody(req) {`,
      `  const ct = req.headers.get?.('content-type') ?? req.headers['content-type'] ?? ''`,
      `  const cl = parseInt(req.headers.get?.('content-length') ?? req.headers['content-length'] ?? '0')`,
      `  if (cl > 1048576) throw new Error('Request body too large (max 1MB)')`,
      `  const buf = await req.arrayBuffer()`,
      `  if (buf.byteLength > 1048576) throw new Error('Request body too large (max 1MB)')`,
      `  if (ct.includes('application/x-adp')) {`,
      `    const { decode } = require('arc/adp/decoder')`,
      `    return decode(new Uint8Array(buf))`,
      `  }`,
      `  return JSON.parse(new TextDecoder().decode(buf) || '{}')`,
      `}`,
      ``,
      `// Cloudflare Workers / WinterCG fetch handler`,
      `export default {`,
      `  async fetch(req) {`,
      `    const _path = new URL(req.url).pathname`,
      `${cases}`,
      `    return new Response('Not Found', { status: 404 })`,
      `  }`,
      `}`,
      ``,
      `// Node.js / Bun / Deno adapter`,
      `if (typeof module !== 'undefined') module.exports = { ${serverFns.map(f => `_handler_${f.name}`).join(', ')} }`,
    ].join('\n')
  }

  // ── Client stubs ────────────────────────────────────────────────────────────
  // Injected into the browser JS bundle.
  // Each stub is a typed async function that calls the edge endpoint via ADP.

  emitClientStubs(serverFns) {
    const parts = []

    for (const fn of serverFns) {
      parts.push(this.emitClientStub(fn))
    }

    return parts.join('\n')
  }

  emitClientStub(fn) {
    const params = (fn.params ?? []).map(p => {
      const name = p.name ?? p
      const def = p.defaultValue ? `=${this.jsEmitter.emitExpr(p.defaultValue)}` : ''
      return `${name}${def}`
    }).join(', ')

    const argNames = (fn.params ?? []).map(p => p.name ?? p)
    const argObj = argNames.length > 0
      ? `{${argNames.join(',')}}`
      : 'null'

    return [
      `async function ${fn.name}(${params}) {`,
      `  const _res = await fetch('/_arc/fn/${fn.name}', {`,
      `    method: 'POST',`,
      `    headers: {'Content-Type': 'application/x-adp'},`,
      `    body: _adpEncode(${argObj})`,
      `  })`,
      `  if (!_res.ok) throw new Error(await _res.text())`,
      `  const _buf = await _res.arrayBuffer()`,
      `  return _adpDecode(new Uint8Array(_buf))`,
      `}`,
    ].join('\n')
  }
}

module.exports = { ServerEmitter }
