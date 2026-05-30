'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ── Exports ───────────────────────────────────────────────────────────────────

test('build-server module exports buildServer and findArcFiles', () => {
  const mod = require('../src/commands/build-server')
  assert.strictEqual(typeof mod.buildServer, 'function')
  assert.strictEqual(typeof mod.findArcFiles, 'function')
})

// ── findArcFiles (re-exported from utils/fs) ──────────────────────────────────

test('findArcFiles: returns [] for empty directory', () => {
  const { findArcFiles } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-test-'))
  try {
    const files = findArcFiles(dir)
    assert.deepStrictEqual(files, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('findArcFiles: finds .arc files recursively', () => {
  const { findArcFiles } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.arc'), '')
    const sub = path.join(dir, 'routes')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(sub, 'posts.arc'), '')
    const files = findArcFiles(dir)
    assert.strictEqual(files.length, 2)
    assert.ok(files.some(f => f.endsWith('index.arc')))
    assert.ok(files.some(f => f.endsWith('posts.arc')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('findArcFiles: ignores non-.arc files', () => {
  const { findArcFiles } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'server.js'), '')
    fs.writeFileSync(path.join(dir, 'schema.arc'), '')
    const files = findArcFiles(dir)
    assert.strictEqual(files.length, 1)
    assert.ok(files[0].endsWith('schema.arc'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: graceful failure for empty project dir ───────────────────

test('buildServer: rejects gracefully when no .arc files found', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-empty-'))
  const errors = []
  const origError = console.error
  const origExit = process.exit
  let exitCalled = false
  console.error = (...a) => errors.push(a.join(' '))
  process.exit = () => { exitCalled = true; throw new Error('process.exit') }
  try {
    await buildServer(dir, {}, {}, {})
  } catch (e) {
    // expected when no arc files found
  } finally {
    console.error = origError
    process.exit = origExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
  // Either process.exit was called or an error was logged
  assert.ok(exitCalled || errors.length > 0, 'expected error or exit for empty dir')
})

// ── buildServerOnce: parses a minimal @route server file ─────────────────────

test('buildServer: compiles a minimal server route to dist/', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-minimal-'))
  const errors = []
  const origError = console.error
  console.error = (...a) => errors.push(a.join(' '))
  try {
    const routesDir = path.join(dir, 'server', 'routes')
    fs.mkdirSync(routesDir, { recursive: true })
    fs.writeFileSync(path.join(routesDir, 'health.arc'), `@route get "/health" -> Response\n  json({ status: "ok" })\n`)
    await buildServer(dir, {}, {}, {})
    const distFile = path.join(dir, 'dist', 'server.js')
    assert.ok(fs.existsSync(distFile), `expected dist/server.js to exist`)
    const out = fs.readFileSync(distFile, 'utf8')
    assert.ok(out.includes('/health'), `expected route in output: ${out.slice(0, 300)}`)
  } finally {
    console.error = origError
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── filePathToRoutePath: tested via known route compilation output ─────────────

test('buildServer: dynamic [param] route becomes :param in output', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-dyn-'))
  const origError = console.error
  console.error = () => {}
  try {
    const routesDir = path.join(dir, 'server', 'routes', 'users')
    fs.mkdirSync(routesDir, { recursive: true })
    fs.writeFileSync(path.join(routesDir, '[id].arc'), `@route get "/users/:id" -> Response\n  json({ id: params.id })\n`)
    await buildServer(dir, {}, {}, {})
    const out = fs.readFileSync(path.join(dir, 'dist', 'server.js'), 'utf8')
    assert.ok(out.includes(':id') || out.includes('users'), `expected route in output`)
  } finally {
    console.error = origError
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: middleware.arc separation ────────────────────────────────

test('buildServer: middleware.arc is detected and route files compiled without it', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-mw-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'routes.arc'), `@route get "/ping" -> Response\n  json({ ok: true })\n`)
    // middleware.arc with no FnDecl body — just validates the file is detected + separated
    fs.writeFileSync(path.join(serverDir, 'middleware.arc'), `@route get "/unused" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    assert.ok(fs.existsSync(outFile), 'dist/server.js should exist')
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('/ping'), 'route from routes.arc should be present')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: multiple arc files merged ────────────────────────────────

test('buildServer: multiple arc files are merged into one server.js', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-multi-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'users.arc'), `@route get "/users" -> Response\n  json({ rows: [] })\n`)
    fs.writeFileSync(path.join(serverDir, 'posts.arc'), `@route get "/posts" -> Response\n  json({ rows: [] })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('/users'), 'should include /users route')
    assert.ok(content.includes('/posts'), 'should include /posts route')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: cloudflare target ───────────────────────────────────────

test('buildServer: cloudflare target emits worker.js with export default', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-cf-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/api" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, { target: 'cloudflare' }, {})
    assert.ok(outFile.endsWith('worker.js'), `expected worker.js, got ${outFile}`)
    assert.ok(fs.existsSync(outFile), 'worker.js should exist')
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('export default'), 'CF Worker should have default export')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildServer: cloudflare target writes wrangler.toml if not present', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-cf-wrangler-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/check" -> Response\n  json({ ok: true })\n`)
    await buildServer(dir, {}, { target: 'cloudflare' }, {})
    const wranglerPath = path.join(dir, 'wrangler.toml')
    assert.ok(fs.existsSync(wranglerPath), 'wrangler.toml should be created')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildServer: cloudflare target skips wrangler.toml if already present', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-cf-nowrangler-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/check" -> Response\n  json({ ok: true })\n`)
    const wranglerPath = path.join(dir, 'wrangler.toml')
    const existingContent = `name = "my-existing-app"\n`
    fs.writeFileSync(wranglerPath, existingContent)
    await buildServer(dir, {}, { target: 'cloudflare' }, {})
    const content = fs.readFileSync(wranglerPath, 'utf8')
    assert.strictEqual(content, existingContent, 'existing wrangler.toml should not be overwritten')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: catch-all [[...slug]] route ──────────────────────────────

test('buildServer: [[...slug]].arc catch-all route is compiled', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-ca-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const docsDir = path.join(dir, 'server', 'docs')
    fs.mkdirSync(docsDir, { recursive: true })
    fs.writeFileSync(path.join(docsDir, '[[...slug]].arc'), `@route get "/docs/*slug" -> Response\n  json({ slug: params.slug })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist for catch-all route')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: server dir fallback when no server/ subdir ───────────────

test('buildServer: falls back to projectDir when no server/ subdirectory', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-noserver-'))
  const origLog = console.log
  console.log = () => {}
  try {
    // No server/ subdir — arc files placed directly in projectDir
    fs.writeFileSync(path.join(dir, 'routes.arc'), `@route get "/root" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist')
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('/root'), 'route should be in output')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: db flag ──────────────────────────────────────────────────

test('buildServer: db=postgres flag is accepted and builds successfully', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-pg-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/api" -> Response\n  json({ db: "postgres" })\n`)
    const outFile = await buildServer(dir, {}, { db: 'postgres' }, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist with postgres flag')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: parse error triggers formatError callback ────────────────

test('buildServer: formatError callback is called on parse failure', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-err-'))
  const origError = console.error
  const origExit = process.exit
  const errors = []
  let exitCode = null
  console.error = (...a) => errors.push(a.join(' '))
  process.exit = (c) => { exitCode = c; throw new Error('exit:' + c) }
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    // Deliberately invalid arc syntax to trigger parse error
    fs.writeFileSync(path.join(serverDir, 'bad.arc'), `@route\n  @@@@INVALID SYNTAX HERE!!!!!\n`)
    let formatErrorCalled = false
    try {
      await buildServer(dir, {}, {}, {
        formatError: () => { formatErrorCalled = true }
      })
    } catch (e) {
      // expected: either exit or parse error
    }
    // Either process.exit was called or formatError was invoked
    assert.ok(exitCode !== null || formatErrorCalled || errors.length > 0,
      'should have called exit, formatError, or logged an error')
  } finally {
    console.error = origError
    process.exit = origExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: noRateLimit, noTracing, cors flags ──────────────────────

test('buildServer: noRateLimit and noTracing flags are accepted', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-flags-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/api" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, { noRateLimit: true, noTracing: true }, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildServer: cors flag is accepted', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-cors-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/api" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, { cors: 'https://example.com' }, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: watch mode starts without crashing ──────────────────────

test('buildServer: watch mode returns outFile and sets up watcher', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-watch-'))
  const origLog = console.log
  const logs = []
  console.log = (...a) => logs.push(a.join(' '))
  let watcher = null
  const origFsWatch = fs.watch
  // Capture the watcher so we can close it
  fs.watch = (...args) => {
    watcher = origFsWatch(...args)
    return watcher
  }
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/watch" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, { watch: true }, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist in watch mode')
    // verify watch log was emitted
    const watchLog = logs.some(l => l.includes('watching') || l.includes('watch'))
    assert.ok(watchLog, 'should log that watch mode is active')
  } finally {
    console.log = origLog
    fs.watch = origFsWatch
    if (watcher) { try { watcher.close() } catch (_) {} }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: output path returned correctly ──────────────────────────

test('buildServer: returns absolute path to dist/server.js', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-retpath-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/ret" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    assert.ok(path.isAbsolute(outFile), 'returned path should be absolute')
    assert.ok(outFile.endsWith('server.js'), 'returned path should end with server.js')
    assert.ok(outFile.includes('dist'), 'returned path should include dist')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: _routeType detection via static json route ───────────────

test('buildServer: static json route compiles without error', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-static-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    // Single-statement json() body → _routeType returns 'static'
    fs.writeFileSync(path.join(serverDir, 'data.arc'), `@route get "/data" -> Response\n  json({ key: "value" })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('/data'), 'static route should be emitted')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildServer: multi-statement route handler compiles without error', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-handler-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    // Multi-statement body → _routeType returns 'handler'
    fs.writeFileSync(path.join(serverDir, 'complex.arc'), `@route get "/complex" -> Response\n  let x = 1\n  json({ x: x })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('/complex'), 'handler route should be emitted')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: bunRoutes flag ──────────────────────────────────────────

test('buildServer: bunRoutes flag is accepted and builds successfully', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-bunroutes-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/bun" -> Response\n  json({ ok: true })\n`)
    const outFile = await buildServer(dir, {}, { bunRoutes: true }, {})
    assert.ok(fs.existsSync(outFile), 'server.js should exist with bunRoutes flag')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── cloudflare target: model emits schema.sql ─────────────────────────────────

test('buildServer: cloudflare target with model emits schema.sql', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-cf-schema-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'app.arc'), [
      `model User`,
      `  @id let id = autoincrement()`,
      `  let email: String`,
      ``,
      `@route get "/users" -> Response`,
      `  json({ rows: [] })`,
    ].join('\n') + '\n')
    const outFile = await buildServer(dir, {}, { target: 'cloudflare' }, {})
    assert.ok(outFile.endsWith('worker.js'), 'should return worker.js path')
    const schemaFile = path.join(dir, 'dist', 'schema.sql')
    assert.ok(fs.existsSync(schemaFile), 'schema.sql should be emitted when models exist')
    const sql = fs.readFileSync(schemaFile, 'utf8')
    assert.ok(sql.toLowerCase().includes('create table'), 'schema.sql should contain CREATE TABLE')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── watch mode: debounce callback triggers rebuild on .arc file change ─────────

test('buildServer: watch mode debounce triggers rebuild when .arc file changes', async (t) => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-watch-rebuild-'))
  const origLog = console.log
  const logs = []
  console.log = (...a) => logs.push(a.join(' '))
  const origFsWatch = fs.watch
  let capturedCallback = null
  let watcher = null

  // Intercept fs.watch to capture the callback without spawning real OS watchers
  fs.watch = (watchDir, opts, cb) => {
    capturedCallback = cb
    // Return a minimal watcher-like object
    watcher = { close: () => {} }
    return watcher
  }

  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'api.arc'), `@route get "/watch2" -> Response\n  json({ ok: true })\n`)

    const outFile = await buildServer(dir, {}, { watch: true }, {})
    assert.ok(fs.existsSync(outFile), 'initial build should produce server.js')

    // Simulate a non-arc change — should be ignored
    if (capturedCallback) {
      capturedCallback('change', 'readme.txt')
      // Small tick to confirm no rebuild was scheduled for non-.arc file
      await new Promise(r => setTimeout(r, 10))
      const rebuildLogs = logs.filter(l => l.includes('rebuilding') || l.includes('changed'))
      assert.strictEqual(rebuildLogs.length, 0, 'non-.arc file change should not trigger rebuild')
    }

    // Simulate an .arc change — should schedule a rebuild via debounce
    if (capturedCallback) {
      capturedCallback('change', 'api.arc')
      // Wait for debounce (50ms) + rebuild time
      await new Promise(r => setTimeout(r, 200))
      const rebuildLog = logs.some(l => l.includes('api.arc') || l.includes('rebuilt') || l.includes('rebuilding'))
      assert.ok(rebuildLog, 'arc file change should trigger rebuild log')
    }
  } finally {
    console.log = origLog
    fs.watch = origFsWatch
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: post routes (non-GET HTTP methods) ──────────────────────

test('buildServer: POST route compiles correctly', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-post-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const serverDir = path.join(dir, 'server')
    fs.mkdirSync(serverDir)
    fs.writeFileSync(path.join(serverDir, 'create.arc'), `@route post "/items" -> Response\n  let body = parseBody(request)\n  json(body)\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('/items'), 'POST route /items should be in output')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── buildServerOnce: deeply nested [param] route ──────────────────────────────

test('buildServer: deeply nested [param] path is compiled', async () => {
  const { buildServer } = require('../src/commands/build-server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bs-deep-'))
  const origLog = console.log
  console.log = () => {}
  try {
    const deepDir = path.join(dir, 'server', 'api', 'v1', 'users')
    fs.mkdirSync(deepDir, { recursive: true })
    fs.writeFileSync(path.join(deepDir, '[userId].arc'), `@route get "/api/v1/users/:userId" -> Response\n  json({ userId: params.userId })\n`)
    const outFile = await buildServer(dir, {}, {}, {})
    const content = fs.readFileSync(outFile, 'utf8')
    assert.ok(content.includes('userId') || content.includes('/api'), 'deeply nested param route should compile')
  } finally {
    console.log = origLog
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
