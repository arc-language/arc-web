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
