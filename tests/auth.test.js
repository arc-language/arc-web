'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')
const { Checker } = require('../src/checker')
const { BunServerEmitter } = require('../src/emitters/server-bun')

function parse(src) {
  const tokens = new Lexer(src).tokenize()
  return new Parser(tokens).parse()
}

// ── Stacked annotation parsing ────────────────────────────────────────────────

test('@auth: @route @auth parsed as RouteDecl with annotations', () => {
  const prog = parse(`
@route @auth get "/dashboard" -> Response
  json({ ok: true })
`)
  const route = prog.declarations.find(d => d.type === 'RouteDecl')
  assert.ok(route, 'RouteDecl created')
  assert.strictEqual(route.method, 'GET')
  assert.strictEqual(route.path, '/dashboard')
  assert.deepStrictEqual(route.annotations, ['@auth'])
})

test('@auth: annotations order does not matter', () => {
  const prog = parse(`
@route @auth post "/login" -> Response
  json({ ok: true })
`)
  const route = prog.declarations.find(d => d.type === 'RouteDecl')
  assert.ok(route.annotations?.includes('@auth'))
})

test('@auth: route without @auth has empty annotations', () => {
  const prog = parse(`
@route get "/public" -> Response
  json([])
`)
  const route = prog.declarations.find(d => d.type === 'RouteDecl')
  const hasAuth = route.annotations?.includes('@auth') ?? false
  assert.strictEqual(hasAuth, false)
})

test('@auth: multiple routes, only tagged ones have @auth', () => {
  const prog = parse(`
@route get "/public" -> Response
  json([])

@route @auth get "/private" -> Response
  json({ secret: true })
`)
  const routes = prog.declarations.filter(d => d.type === 'RouteDecl')
  assert.strictEqual(routes.length, 2)
  assert.strictEqual(routes[0].annotations?.includes('@auth') ?? false, false)
  assert.strictEqual(routes[1].annotations?.includes('@auth'), true)
})

// ── Checker: auth scope injection ─────────────────────────────────────────────

test('checker: auth/jwt/oauth in scope for all routes', () => {
  const prog = parse(`
@route get "/test" -> Response
  const s = auth.session(request)
  json({ ok: true })
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

test('checker: session in scope for @auth routes', () => {
  const prog = parse(`
@route @auth get "/me" -> Response
  json({ session: session })
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

// ── BunServerEmitter: auth preamble ──────────────────────────────────────────

test('BunServerEmitter: emits auth preamble when @auth route present', () => {
  const prog = parse(`
@route @auth get "/dashboard" -> Response
  json({ ok: true })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('SESSION_SECRET'), 'session secret emitted')
  assert.ok(out.includes('_hmacSign'), 'HMAC sign helper emitted')
  assert.ok(out.includes('_sessionDecode'), 'session decode emitted')
  assert.ok(out.includes('const auth ='), 'auth object emitted')
  assert.ok(out.includes('const jwt ='), 'jwt object emitted')
  assert.ok(out.includes('const oauth ='), 'oauth object emitted')
})

test('BunServerEmitter: no auth preamble when no @auth routes', () => {
  const prog = parse(`
@route get "/public" -> Response
  json([])
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(!out.includes('SESSION_SECRET'), 'no session secret for public routes')
  assert.ok(!out.includes('_hmacSign'), 'no HMAC helper for public routes')
})

test('BunServerEmitter: @auth route has session guard', () => {
  const prog = parse(`
@route @auth get "/me" -> Response
  json({ ok: true })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('auth.session(req)'), 'session check emitted')
  assert.ok(out.includes("return _json({ error: 'Unauthorized' }, 401)"), '401 response emitted')
  assert.ok(out.includes('[auth]'), 'auth label in comment')
})

test('BunServerEmitter: non-@auth route has no session guard', () => {
  const prog = parse(`
@route get "/public" -> Response
  json([])
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  const handler = out.slice(out.indexOf('async function _route_get'))
  assert.ok(!handler.includes('auth.session(req)'), 'no session check on public route')
})

test('BunServerEmitter: @auth injects session variable', () => {
  const prog = parse(`
@route @auth get "/dashboard" -> Response
  json({ user: session })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('const session = _sess'), 'session variable bound from _sess')
})

// ── Auth helpers: emitAuthPreamble ────────────────────────────────────────────

test('auth-helpers: emitAuthPreamble emits all helpers', () => {
  const { emitAuthPreamble } = require('../src/emitters/auth-helpers')
  const out = emitAuthPreamble()
  assert.ok(out.includes('_hmacSign'), 'HMAC sign emitted')
  assert.ok(out.includes('_hmacVerify'), 'HMAC verify emitted')
  assert.ok(out.includes('_sessionEncode'), 'session encode emitted')
  assert.ok(out.includes('_sessionDecode'), 'session decode emitted')
  assert.ok(out.includes('_parseCookies'), 'cookie parser emitted')
  assert.ok(out.includes('github:'), 'GitHub OAuth emitted')
  assert.ok(out.includes('google:'), 'Google OAuth emitted')
  assert.ok(out.includes('sign:'), 'JWT sign emitted')
  assert.ok(out.includes('verify:'), 'JWT verify emitted')
})

test('auth-helpers: cookieName option respected', () => {
  const { emitAuthPreamble } = require('../src/emitters/auth-helpers')
  const out = emitAuthPreamble({ cookieName: 'my_session' })
  assert.ok(out.includes("'my_session'"), 'custom cookie name used')
})
