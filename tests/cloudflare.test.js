'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')
const { CloudflareEmitter } = require('../src/emitters/server-cloudflare')
const { compileRoutes } = require('../src/compilers/route-compiler')
const { generateWranglerToml } = require('../src/compilers/wrangler-compiler')

function parse(src) {
  const tokens = new Lexer(src).tokenize()
  return new Parser(tokens).parse()
}

// ── route-compiler: extraParam ────────────────────────────────────────────────

test('route-compiler: no extraParam passes (req, params)', () => {
  const js = compileRoutes([{ method: 'GET', path: '/posts', handlerName: '_route_get_posts' }])
  assert.ok(js.includes('_route_get_posts(req, params)'), 'no extra param by default')
  assert.ok(js.includes('function _dispatch(req, _pathname)'), 'dispatch has 2 params')
})

test('route-compiler: extraParam=env passes (req, params, env)', () => {
  const js = compileRoutes(
    [{ method: 'GET', path: '/posts', handlerName: '_route_get_posts' }],
    { extraParam: 'env' }
  )
  assert.ok(js.includes('_route_get_posts(req, params, env)'), 'env forwarded to handler')
  assert.ok(js.includes('function _dispatch(req, _pathname, env)'), 'dispatch has env param')
})

// ── CloudflareEmitter ─────────────────────────────────────────────────────────

test('CloudflareEmitter: returns empty worker for no routes/models', () => {
  const prog = parse(`const x = 1`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.strictEqual(worker, '')
})

test('CloudflareEmitter: emits export default with fetch handler', () => {
  const prog = parse(`
@route get "/posts" -> Response
  json([])
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('export default'), 'CF export default emitted')
  assert.ok(worker.includes('async fetch(req, env, ctx)'), 'CF fetch handler emitted')
  assert.ok(worker.includes('_dispatch(req, url.pathname, env)'), 'env forwarded to dispatch')
})

test('CloudflareEmitter: uses D1 bindings for model queries', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('env.DB'), 'D1 binding used')
  assert.ok(worker.includes('_makeDb'), 'db factory emitted')
  assert.ok(worker.includes('.prepare('), 'D1 prepare API used')
  assert.ok(worker.includes('.bind('), 'D1 bind API used')
  assert.ok(!worker.includes('bun:sqlite'), 'no bun:sqlite import')
  assert.ok(!worker.includes('Bun.serve'), 'no Bun.serve')
})

test('CloudflareEmitter: route handlers accept env param', () => {
  const prog = parse(`
@route get "/test" -> Response
  json({ ok: true })
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('async function _route_get_test(req, params, env)'), 'env param in handler')
})

test('CloudflareEmitter: emits D1 db helper factory with correct SQL', () => {
  const prog = parse(`
model User
  @id let id = autoincrement()
  let email: String
  let name: String

@route get "/users" -> Response
  json(db.users.findMany())
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('SELECT id, email, name FROM users'), 'findMany SQL emitted')
  assert.ok(worker.includes('INSERT INTO users'), 'create SQL emitted')
  assert.ok(worker.includes('UPDATE users'), 'update SQL emitted')
  assert.ok(worker.includes('DELETE FROM users'), 'delete SQL emitted')
})

test('CloudflareEmitter: emits schema.sql for D1 migrations', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String
  let published: Bool

@route get "/posts" -> Response
  json(db.posts.findMany())
`)
  const emitter = new CloudflareEmitter()
  const { schema } = emitter.emitProgram(prog)
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS posts'), 'CREATE TABLE emitted')
  assert.ok(schema.includes('INTEGER PRIMARY KEY AUTOINCREMENT'), 'id column emitted')
  assert.ok(schema.includes('title TEXT'), 'title column emitted')
  assert.ok(schema.includes('published INTEGER'), 'published column emitted')
})

test('CloudflareEmitter: emits CF queue handler for jobs', () => {
  const prog = parse(`
job SendEmail(userId: Int)
  console.log("sending to", userId)

@route post "/trigger" -> Response
  SendEmail(1)
  json({ ok: true })
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('async queue(batch, env, ctx)'), 'CF queue handler emitted')
  assert.ok(worker.includes('_jobRegistry'), 'job registry emitted')
  assert.ok(worker.includes("'SendEmail': _job_SendEmail"), 'job in registry')
  assert.ok(worker.includes('msg.ack()'), 'message acknowledgement emitted')
})

test('CloudflareEmitter: job handlers get env param for D1 access', () => {
  const prog = parse(`
job ProcessData(id: Int)
  console.log(id)

@route get "/" -> Response
  json([])
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('async function _job_ProcessData(id, env)'), 'job handler has env param')
})

test('CloudflareEmitter: CF Queue.enqueue sends via env.QUEUE', () => {
  const prog = parse(`
@route post "/trigger" -> Response
  json({ ok: true })
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('env.QUEUE'), 'CF queue send used')
})

test('CloudflareEmitter: @auth routes have session guard', () => {
  const prog = parse(`
@route @auth get "/me" -> Response
  json({ session: session })
`)
  const emitter = new CloudflareEmitter()
  const { worker } = emitter.emitProgram(prog)
  assert.ok(worker.includes('auth.session(req)'), 'auth check emitted')
  assert.ok(worker.includes("return _json({ error: 'Unauthorized' }, 401)"), '401 response emitted')
})

// ── wrangler-compiler ─────────────────────────────────────────────────────────

test('wrangler-compiler: emits basic structure', () => {
  const prog = parse(`
@route get "/test" -> Response
  json([])
`)
  const toml = generateWranglerToml(prog, { name: 'my-app' })
  assert.ok(toml.includes('name = "my-app"'), 'name emitted')
  assert.ok(toml.includes('main = "dist/worker.js"'), 'main emitted')
  assert.ok(toml.includes('compatibility_date'), 'compat date emitted')
})

test('wrangler-compiler: emits D1 binding for models', () => {
  const prog = parse(`
model Post
  @id let id = autoincrement()
  let title: String

@route get "/posts" -> Response
  json([])
`)
  const toml = generateWranglerToml(prog, { name: 'blog' })
  assert.ok(toml.includes('[[d1_databases]]'), 'D1 binding emitted')
  assert.ok(toml.includes('binding = "DB"'), 'DB binding name emitted')
  assert.ok(toml.includes('"blog-db"'), 'database name uses project name')
})

test('wrangler-compiler: emits queue bindings for jobs', () => {
  const prog = parse(`
job SendEmail(userId: Int)
  console.log(userId)

@route get "/" -> Response
  json([])
`)
  const toml = generateWranglerToml(prog, { name: 'app' })
  assert.ok(toml.includes('[[queues.producers]]'), 'queue producer emitted')
  assert.ok(toml.includes('[[queues.consumers]]'), 'queue consumer emitted')
  assert.ok(toml.includes('binding = "QUEUE"'), 'QUEUE binding emitted')
})

test('wrangler-compiler: no queue bindings when no jobs', () => {
  const prog = parse(`
@route get "/" -> Response
  json([])
`)
  const toml = generateWranglerToml(prog, { name: 'app' })
  assert.ok(!toml.includes('queues'), 'no queue bindings for jobless app')
})

test('wrangler-compiler: no D1 bindings when no models', () => {
  const prog = parse(`
@route get "/" -> Response
  json({ ok: true })
`)
  const toml = generateWranglerToml(prog, { name: 'app' })
  assert.ok(!toml.includes('d1_databases'), 'no D1 bindings for modelless app')
})
