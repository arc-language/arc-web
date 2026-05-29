'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')
const { Checker } = require('../src/checker')
const { BunServerEmitter } = require('../src/emitters/server-bun')
const { compileRoutes, emitBunRoutesObject, insertRoute, makeNode } = require('../src/compilers/route-compiler')

function parse(src) {
  const tokens = new Lexer(src).tokenize()
  return new Parser(tokens).parse()
}

// ── model DSL ─────────────────────────────────────────────────────────────────

test('model: parses simple model declaration', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String
  let published: Bool = false
`)
  const model = prog.declarations.find(d => d.type === 'ModelDecl')
  assert.ok(model, 'ModelDecl node created')
  assert.strictEqual(model.name, 'Post')
  const fields = model.fields.filter(f => f.name)
  assert.strictEqual(fields.length, 3)
  assert.strictEqual(fields[0].name, 'id')
  assert.deepStrictEqual(fields[0].decorators, ['@id'])
  assert.strictEqual(fields[1].name, 'title')
  assert.strictEqual(fields[1].typeAnnotation?.name, 'String')
  assert.strictEqual(fields[2].name, 'published')
  assert.strictEqual(fields[2].typeAnnotation?.name, 'Bool')
})

test('model: multiple models in one file', () => {
  const prog = parse(`
model User
  @id let id = autoincrement()
  let email: String

model Post
  @id let id = autoincrement()
  let title: String
  let authorId: Int
`)
  const models = prog.declarations.filter(d => d.type === 'ModelDecl')
  assert.strictEqual(models.length, 2)
  assert.strictEqual(models[0].name, 'User')
  assert.strictEqual(models[1].name, 'Post')
})

test('model: checker registers model in scope', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

// ── @route annotation ─────────────────────────────────────────────────────────

test('@route: parses GET route', () => {
  const prog = parse(`
@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const route = prog.declarations.find(d => d.type === 'RouteDecl')
  assert.ok(route, 'RouteDecl node created')
  assert.strictEqual(route.method, 'GET')
  assert.strictEqual(route.path, '/posts')
  assert.strictEqual(route.params.length, 0)
  assert.ok(route.body?.body?.length > 0)
})

test('@route: parses route with path param', () => {
  const prog = parse(`
@route get "/posts/:id" -> Response
  json(db.posts.find(params.id))
`)
  const route = prog.declarations.find(d => d.type === 'RouteDecl')
  assert.strictEqual(route.method, 'GET')
  assert.strictEqual(route.path, '/posts/:id')
  assert.deepStrictEqual(route.params, ['id'])
})

test('@route: parses POST route', () => {
  const prog = parse(`
@route post "/posts" -> Response
  const body = parseBody(request)
  json(body, 201)
`)
  const route = prog.declarations.find(d => d.type === 'RouteDecl')
  assert.strictEqual(route.method, 'POST')
  assert.strictEqual(route.path, '/posts')
})

test('@route: parses multiple methods', () => {
  const prog = parse(`
@route get "/items" -> Response
  json([])

@route post "/items" -> Response
  json({ ok: true }, 201)

@route del "/items/:id" -> Response
  json({ ok: true })
`)
  const routes = prog.declarations.filter(d => d.type === 'RouteDecl')
  assert.strictEqual(routes.length, 3)
  assert.strictEqual(routes[0].method, 'GET')
  assert.strictEqual(routes[1].method, 'POST')
  assert.strictEqual(routes[2].method, 'DELETE')
})

test('@route: checker passes with implicit request/params in scope', () => {
  const prog = parse(`
@route get "/posts/:id" -> Response
  const id = params.id
  json({ id: id })
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

// ── job declarations ───────────────────────────────────────────────────────────

test('job: parses job declaration', () => {
  const prog = parse(`
job SendEmail(userId: Int)
  console.log("sending email to user", userId)
`)
  const job = prog.declarations.find(d => d.type === 'JobDecl')
  assert.ok(job, 'JobDecl node created')
  assert.strictEqual(job.name, 'SendEmail')
  assert.strictEqual(job.params.length, 1)
  assert.strictEqual(job.params[0].name, 'userId')
  assert.strictEqual(job.params[0].typeAnnotation?.name, 'Int')
})

test('job: checker passes', () => {
  const prog = parse(`
job Notify(postId: Int)
  const id = postId
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

// ── route compiler ────────────────────────────────────────────────────────────

test('route-compiler: generates dispatch function', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/', handlerName: '_route_get_root' },
    { method: 'GET', path: '/posts', handlerName: '_route_get_posts' },
    { method: 'POST', path: '/posts', handlerName: '_route_post_posts' },
    { method: 'GET', path: '/posts/:id', handlerName: '_route_get_posts_id' },
  ])
  assert.ok(js.includes('_dispatch'), 'dispatch function emitted')
  assert.ok(js.includes('segments'), 'segment routing emitted')
  assert.ok(js.includes("case 'GET'"), 'GET method case emitted')
  assert.ok(js.includes("case 'POST'"), 'POST method case emitted')
})

test('route-compiler: includes handler names', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/users', handlerName: '_route_get_users' },
    { method: 'DELETE', path: '/users/:id', handlerName: '_route_delete_users_id' },
  ])
  assert.ok(js.includes('_route_get_users'), 'GET handler referenced')
  assert.ok(js.includes('_route_delete_users_id'), 'DELETE handler referenced')
})

test('route-compiler: empty routes returns safe dispatch', () => {
  const js = compileRoutes([])
  assert.ok(js.includes('_dispatch'), 'dispatch function always emitted')
  assert.ok(js.includes('404'), '404 for empty routes')
})

test('route-compiler: emits static path switch for param-free routes', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/', handlerName: '_route_get_root' },
    { method: 'GET', path: '/users', handlerName: '_route_get_users' },
    { method: 'GET', path: '/users/:id', handlerName: '_route_get_users_id' },
  ])
  assert.ok(js.includes("case '/'"), 'root path in static switch')
  assert.ok(js.includes("case '/users'"), 'users path in static switch')
  assert.ok(!js.includes("case '/users/:id'"), 'param path not in static switch')
})

test('route-compiler: static switch precedes segment split', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/', handlerName: '_route_get_root' },
  ])
  const switchPos = js.indexOf("switch (_pathname)")
  const splitPos = js.indexOf("split('/')")
  assert.ok(switchPos < splitPos, 'static switch emitted before split')
})

// ── BunServerEmitter ──────────────────────────────────────────────────────────

test('BunServerEmitter: emits empty string for programs with no routes/models', () => {
  const prog = parse(`
const x = 1
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.strictEqual(out, '')
})

test('BunServerEmitter: emits Bun.serve() for programs with routes', () => {
  const prog = parse(`
@route get "/posts" -> Response
  json([])
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('Bun.serve'), 'Bun.serve() emitted')
  assert.ok(out.includes('_dispatch'), 'dispatch function emitted')
  assert.ok(out.includes('_route_get_posts'), 'route handler emitted')
})

test('BunServerEmitter: static literal routes emit sync handler', () => {
  const prog = parse(`
@route get "/" -> Response
  json({ ok: true })
`)
  const out = new BunServerEmitter({}).emitProgram(prog)
  assert.ok(!out.includes('async function _route_get_root'), 'static handler is not async')
  assert.ok(out.includes('function _route_get_root(req, params) { return _STATIC__route_get_root }'), 'sync static handler emitted')
})

test('BunServerEmitter: async handler preserved for routes with await', () => {
  const prog = parse(`
@route post "/echo" -> Response
  const body = parseBody(request)
  json(body)
`)
  const out = new BunServerEmitter({}).emitProgram(prog)
  assert.ok(out.includes('async function _route_post_echo'), 'non-static handler stays async')
})

test('BunServerEmitter: fetch handler is async', () => {
  const prog = parse(`
@route get "/" -> Response
  json({ ok: true })
`)
  const out = new BunServerEmitter({}).emitProgram(prog)
  assert.ok(out.includes('async fetch(req)'), 'fetch handler is async')
})

test('BunServerEmitter: emits CREATE TABLE for model declarations', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String
  let body: String

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('CREATE TABLE IF NOT EXISTS'), 'DDL emitted')
  assert.ok(out.includes('posts'), 'table name emitted')
  assert.ok(out.includes('bun:sqlite'), 'SQLite import emitted')
})

test('BunServerEmitter: emits path param extraction for parameterized routes', () => {
  const prog = parse(`
@route get "/users/:id" -> Response
  json({ id: params.id })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes("params['id']"), 'param extraction emitted')
})

test('BunServerEmitter: emits job handler for job declarations', () => {
  const prog = parse(`
job SendEmail(userId: Int)
  console.log("sending to", userId)

@route post "/trigger" -> Response
  json({ ok: true })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('_job_SendEmail'), 'job handler emitted')
})

// ── PostgreSQL emitter ────────────────────────────────────────────────────────

test('BunServerEmitter (postgres): emits pg Pool setup', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new BunServerEmitter({ db: 'postgres' })
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes("require('pg')"), 'pg import emitted')
  assert.ok(out.includes('Pool'), 'Pool created')
  assert.ok(!out.includes('bun:sqlite'), 'no sqlite import')
})

test('BunServerEmitter (postgres): uses SERIAL PRIMARY KEY', () => {
  const prog = parse(`
model User
  @id let id = autoincrement()
  let email: String

@route get "/users" -> Response
  json(db.users.findMany())
`)
  const emitter = new BunServerEmitter({ db: 'postgres' })
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('SERIAL PRIMARY KEY'), 'SERIAL used for id')
  assert.ok(!out.includes('AUTOINCREMENT'), 'no SQLite AUTOINCREMENT')
})

test('BunServerEmitter (postgres): uses $1/$2 placeholders', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String
  let body: String

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new BunServerEmitter({ db: 'postgres' })
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('$1'), '$1 placeholder emitted')
  assert.ok(out.includes('$2'), '$2 placeholder emitted')
  assert.ok(!out.includes('?1'), 'no SQLite ?1 placeholder')
})

test('BunServerEmitter (postgres): uses BOOLEAN and TIMESTAMPTZ', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let published: Bool
  let createdAt: DateTime

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new BunServerEmitter({ db: 'postgres' })
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('BOOLEAN'), 'BOOLEAN type emitted')
  assert.ok(out.includes('TIMESTAMPTZ'), 'TIMESTAMPTZ type emitted')
})

test('BunServerEmitter (postgres): db helpers are async', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new BunServerEmitter({ db: 'postgres' })
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('async ('), 'async db methods emitted')
})

// ── Echo fast path ────────────────────────────────────────────────────────────

test('BunServerEmitter: echo pattern emits arrayBuffer passthrough', () => {
  const prog = parse(`
@route post "/echo" -> Response
  const body = parseBody(request)
  json(body)
`)
  const out = new BunServerEmitter({}).emitProgram(prog)
  assert.ok(out.includes('arrayBuffer'), 'arrayBuffer passthrough emitted')
  assert.ok(out.includes('[echo]'), 'echo comment tag emitted')
  assert.ok(!out.includes('const parseBody = _parseBody'), 'no parseBody alias in echo handler')
  // The echo handler itself must not stringify — check the specific handler function
  const echoStart = out.indexOf('// Route: POST /echo [echo]')
  const echoEnd = out.indexOf('\n}', echoStart) + 2
  assert.ok(!out.slice(echoStart, echoEnd).includes('JSON.stringify'), 'no JSON.stringify in echo handler body')
})

test('BunServerEmitter: non-echo post route uses normal handler', () => {
  const prog = parse(`
@route post "/items" -> Response
  const body = parseBody(request)
  json({ received: true })
`)
  const out = new BunServerEmitter({}).emitProgram(prog)
  assert.ok(!out.includes('[echo]'), 'non-echo route not tagged as echo')
  assert.ok(out.includes('_parseBody'), 'normal handler uses _parseBody')
})

// ── route-compiler: catch-all and advanced features ───────────────────────────

test('route-compiler: catch-all *param route matches remaining path', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/files/*path', handlerName: '_route_get_files' },
  ])
  assert.ok(js.includes('_route_get_files'), 'catch-all handler referenced')
})

test('route-compiler: insertRoute with catch-all segment sets catchAll property', () => {
  const root = makeNode()
  insertRoute(root, 'GET', '/assets/*file', '_handler')
  // The catch-all is on the assets child node
  const assetsNode = root.children.get('assets')
  assert.ok(assetsNode, 'assets child node should exist')
  assert.strictEqual(assetsNode.catchAll, 'file', 'catchAll should be set to param name')
})

test('route-compiler: insertRoute conflicting param names throws', () => {
  const root = makeNode()
  insertRoute(root, 'GET', '/users/:id/posts', '_handler1')
  assert.throws(
    () => insertRoute(root, 'GET', '/users/:userId/comments', '_handler2'),
    /conflicting param names/,
  )
})

test('route-compiler: compileRoutes with extraParam threads through handlers', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/things', handlerName: '_route_get_things' },
  ], { extraParam: 'env' })
  assert.ok(js.includes('env'), 'extra param should appear in dispatch fn')
  assert.ok(js.includes('_dispatch(req, _pathname, env)'), 'extra param in function signature')
})

test('route-compiler: multiple methods on same path both dispatched', () => {
  const js = compileRoutes([
    { method: 'GET', path: '/items', handlerName: '_route_get_items' },
    { method: 'POST', path: '/items', handlerName: '_route_post_items' },
    { method: 'DELETE', path: '/items/:id', handlerName: '_route_delete_items_id' },
  ])
  assert.ok(js.includes("case 'GET'"))
  assert.ok(js.includes("case 'POST'"))
  assert.ok(js.includes("case 'DELETE'"))
})

// ── emitBunRoutesObject ───────────────────────────────────────────────────────

test('emitBunRoutesObject: generates _arcRoutes object', () => {
  const js = emitBunRoutesObject([
    { method: 'GET', path: '/posts', handlerName: '_route_get_posts' },
  ])
  assert.ok(js.includes('_arcRoutes'), 'should emit _arcRoutes object')
  assert.ok(js.includes('/posts'), 'should include the route path')
  assert.ok(js.includes('_route_get_posts'), 'should reference handler')
})

test('emitBunRoutesObject: always includes /health route', () => {
  const js = emitBunRoutesObject([
    { method: 'GET', path: '/api', handlerName: '_route_get_api' },
  ])
  assert.ok(js.includes('/health'), 'should always include /health route')
})

test('emitBunRoutesObject: multiple methods on same path grouped together', () => {
  const js = emitBunRoutesObject([
    { method: 'GET', path: '/posts', handlerName: '_route_get_posts' },
    { method: 'POST', path: '/posts', handlerName: '_route_post_posts' },
  ])
  const postsCount = (js.match(/\/posts/g) ?? []).length
  assert.ok(postsCount >= 1, 'should have posts path in output')
  assert.ok(js.includes('GET') && js.includes('POST'), 'both methods should appear')
})

test('emitBunRoutesObject: noTracing option skips tracing preamble', () => {
  const js = emitBunRoutesObject([
    { method: 'GET', path: '/items', handlerName: '_handler' },
  ], { noTracing: true })
  assert.ok(!js.includes('_traceId'), 'no tracing header when noTracing=true')
})

test('emitBunRoutesObject: noRateLimit option skips rate-limit check', () => {
  const js = emitBunRoutesObject([
    { method: 'GET', path: '/items', handlerName: '_handler' },
  ], { noRateLimit: true })
  assert.ok(!js.includes('_checkRateLimit'), 'no rate-limit when noRateLimit=true')
})

test('emitBunRoutesObject: default emits both tracing and rate-limit preamble', () => {
  const js = emitBunRoutesObject([
    { method: 'GET', path: '/items', handlerName: '_handler' },
  ])
  assert.ok(js.includes('_traceId') || js.includes('_clientId'), 'default includes tracing preamble')
  assert.ok(js.includes('_checkRateLimit'), 'default includes rate-limit check')
})

// ── emitGroupGuard (server-bun.js) ────────────────────────────────────────────

test('BunServerEmitter: @group with @auth emits shared guard function', () => {
  const prog = parse(`
@group "/admin" @auth
  @route get "/dashboard" -> Response
    json({ ok: true })
`)
  const e = new BunServerEmitter({ hash: 'test', bunRoutes: true })
  const out = e.emitProgram(prog)
  assert.ok(out.includes('_guard_admin'), 'should emit group guard function')
  assert.ok(out.includes('Unauthorized'), 'guard should have auth check')
})

test('BunServerEmitter: @group with @auth(role) emits role check in guard', () => {
  const prog = parse(`
@group "/admin" @auth(admin)
  @route get "/users" -> Response
    json({ ok: true })
`)
  const e = new BunServerEmitter({ hash: 'test', bunRoutes: true })
  const out = e.emitProgram(prog)
  assert.ok(out.includes('_guard_admin'), 'should emit group guard function')
  assert.ok(out.includes('Forbidden'), 'guard should have role check')
})

test('BunServerEmitter: @group without @auth does not emit guard', () => {
  const prog = parse(`
@group "/api"
  @route get "/items" -> Response
    json({ ok: true })
`)
  const e = new BunServerEmitter({ hash: 'test', bunRoutes: true })
  const out = e.emitProgram(prog)
  assert.ok(!out.includes('_guard_'), 'no guard emitted for unauthenticated group')
})

test('BunServerEmitter: middleware declarations are emitted (null body → return null)', () => {
  // Test the hasMiddleware path; use null body to exercise the fallback branch
  // (the BlockStatement path calls jsEmitter.emitBlock which doesn't exist — source bug)
  const prog = parse(`
@route get "/" -> Response
  json({ ok: true })
`)
  const e = new BunServerEmitter({ hash: 'test', bunRoutes: true })
  e.hasMiddleware = true
  e.middlewareDecls = [{
    type: 'FnDecl',
    name: 'handle',
    params: [],
    body: null, // null body → 'return null' fallback
  }]
  const out = e.emitProgram(prog)
  assert.ok(out.includes('_middleware'), 'should emit middleware function')
  assert.ok(out.includes('return null'), 'null body emits return null')
})
