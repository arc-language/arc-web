'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { ServerEmitter } = require('../src/emitters/server.js')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')

function parse(src) {
  const tokens = new Lexer(src).tokenize()
  return new Parser(tokens).parse()
}

function emitServer(src) {
  const prog = parse(src)
  const emitter = new ServerEmitter({ hash: 'test' })
  return emitter.emitProgram(prog)
}

// ── emitProgram: no @server fns ───────────────────────────────────────────────

test('ServerEmitter: emitProgram with no @server fns returns empty strings', () => {
  const result = emitServer(`
page "Hello"
  heading "Hi"
`)
  assert.strictEqual(result.edgeFunctions, '')
  assert.strictEqual(result.clientStubs, '')
  assert.deepStrictEqual(result.handlerNames, [])
})

// ── emitProgram: with @server fn ─────────────────────────────────────────────

test('ServerEmitter: emitProgram returns edgeFunctions and clientStubs', () => {
  const result = emitServer(`
@server fn getData() {
  return 42
}
`)
  assert.ok(result.edgeFunctions.length > 0, 'should have edge functions')
  assert.ok(result.clientStubs.length > 0, 'should have client stubs')
  assert.deepStrictEqual(result.handlerNames, ['_handler_getData'])
})

test('ServerEmitter: edge function includes ADP encode/decode runtime', () => {
  const result = emitServer(`
@server fn getUser() {
  return { name: "Alice" }
}
`)
  assert.ok(result.edgeFunctions.includes('_adpEncode'), 'should include ADP encoder')
  assert.ok(result.edgeFunctions.includes('_adpDecode'), 'should include ADP decoder')
})

test('ServerEmitter: edge function wraps handler in async function', () => {
  const result = emitServer(`
@server fn fetchData() {
  return []
}
`)
  assert.ok(result.edgeFunctions.includes('async function _handler_fetchData'), 'should have async handler')
})

test('ServerEmitter: edge function includes error handling', () => {
  const result = emitServer(`
@server fn compute() {
  return 1
}
`)
  assert.ok(result.edgeFunctions.includes('catch (_e)'), 'should catch errors')
  assert.ok(result.edgeFunctions.includes('status: 500'), 'should return 500 on error')
})

test('ServerEmitter: edge function includes WinterCG export', () => {
  const result = emitServer(`
@server fn ping() {
  return "pong"
}
`)
  assert.ok(result.edgeFunctions.includes('export default'), 'should have WinterCG export')
  assert.ok(result.edgeFunctions.includes('async fetch(req)'), 'fetch handler exported')
})

// ── @server fn with params ────────────────────────────────────────────────────

test('ServerEmitter: fn with params extracts from request body safely', () => {
  const result = emitServer(`
@server fn greet(name) {
  return name
}
`)
  assert.ok(result.edgeFunctions.includes('Object.prototype.hasOwnProperty'), 'should use safe property access')
  assert.ok(result.edgeFunctions.includes("'name'"), 'should extract name param')
})

test('ServerEmitter: fn with multiple params extracts all safely', () => {
  const result = emitServer(`
@server fn add(a, b) {
  return a
}
`)
  assert.ok(result.edgeFunctions.includes("'a'"), 'should extract a param')
  assert.ok(result.edgeFunctions.includes("'b'"), 'should extract b param')
})

// ── client stubs ──────────────────────────────────────────────────────────────

test('ServerEmitter: client stub is an async function', () => {
  const result = emitServer(`
@server fn loadPosts() {
  return []
}
`)
  assert.ok(result.clientStubs.includes('async function loadPosts'), 'stub should be async')
})

test('ServerEmitter: client stub POSTs to /_arc/fn/<name>', () => {
  const result = emitServer(`
@server fn getData() {
  return {}
}
`)
  assert.ok(result.clientStubs.includes("/_arc/fn/getData"), 'should post to correct endpoint')
  assert.ok(result.clientStubs.includes("method: 'POST'"), 'should use POST method')
})

test('ServerEmitter: client stub with params passes args as object', () => {
  const result = emitServer(`
@server fn search(query, limit) {
  return []
}
`)
  assert.ok(result.clientStubs.includes('query'), 'should include query param in stub')
  assert.ok(result.clientStubs.includes('limit'), 'should include limit param in stub')
  assert.ok(result.clientStubs.includes('{query,limit}'), 'should pass args as object')
})

test('ServerEmitter: client stub with no params passes null', () => {
  const result = emitServer(`
@server fn ping() {
  return "pong"
}
`)
  assert.ok(result.clientStubs.includes('_adpEncode(null)'), 'no params → encodes null')
})

test('ServerEmitter: client stub includes AbortController timeout', () => {
  const result = emitServer(`
@server fn longOperation() {
  return true
}
`)
  assert.ok(result.clientStubs.includes('AbortController'), 'should have abort controller')
  assert.ok(result.clientStubs.includes('30000'), 'should have 30s timeout')
})

// ── edge router ───────────────────────────────────────────────────────────────

test('ServerEmitter: edge router dispatches by pathname', () => {
  const result = emitServer(`
@server fn getUser() { return {} }
@server fn getPosts() { return [] }
`)
  assert.ok(result.edgeFunctions.includes("'/_arc/fn/getUser'"), 'should route getUser')
  assert.ok(result.edgeFunctions.includes("'/_arc/fn/getPosts'"), 'should route getPosts')
  assert.ok(result.edgeFunctions.includes('404'), 'should return 404 for unknown paths')
})

// ── unsafe fn name ────────────────────────────────────────────────────────────

test('ServerEmitter: throws on unsafe @server fn name (has space)', () => {
  const emitter = new ServerEmitter({})
  const fn = { name: 'bad name', params: [], body: { type: 'BlockStatement', body: [] } }
  assert.throws(() => emitter.emitEdgeHandler(fn), /unsafe @server fn name/)
})

test('ServerEmitter: throws on unsafe @server fn name (starts with digit)', () => {
  const emitter = new ServerEmitter({})
  const fn = { name: '1badFunc', params: [], body: { type: 'BlockStatement', body: [] } }
  assert.throws(() => emitter.emitEdgeHandler(fn), /unsafe @server fn name/)
})

test('ServerEmitter: throws on unsafe @server fn param name (has hyphen)', () => {
  const emitter = new ServerEmitter({})
  const fn = {
    name: 'safeFunc',
    params: [{ name: 'bad-param' }],
    body: { type: 'BlockStatement', body: [] },
  }
  assert.throws(() => emitter.emitEdgeHandler(fn), /unsafe @server param name/)
})
