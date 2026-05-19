'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const cloudflare = require('../src/deploy/cloudflare')
const denoTarget = require('../src/deploy/deno')
const bun = require('../src/deploy/bun')
const node = require('../src/deploy/node')

// ── Cloudflare tests ────────────────────────────────────────────────────────

test('cloudflare: generator produces a valid Worker script containing the HTML', () => {
  const html = '<!DOCTYPE html><html><body>Hello Arc</body></html>'
  const files = cloudflare.generate({ html })
  const worker = files.find(f => f.path === 'worker.js')
  assert.ok(worker, 'worker.js should be in output')
  assert.ok(worker.content.includes('Hello Arc'), 'worker.js should embed the HTML')
  assert.ok(worker.content.includes('export default'), 'worker.js should have export default')
  assert.ok(worker.content.includes('async fetch(request'), 'worker.js should have fetch handler')
})

test('cloudflare: generator produces wrangler.toml with name field', () => {
  const files = cloudflare.generate({ html: '<html/>', projectName: 'my-app' })
  const toml = files.find(f => f.path === 'wrangler.toml')
  assert.ok(toml, 'wrangler.toml should be in output')
  assert.ok(toml.content.includes('name = "my-app"'), 'wrangler.toml should have name field')
})

test('cloudflare: uses arc-app as default project name', () => {
  const files = cloudflare.generate({ html: '<html/>' })
  const toml = files.find(f => f.path === 'wrangler.toml')
  assert.ok(toml.content.includes('name = "arc-app"'), 'should default to arc-app')
})

// ── Node tests ───────────────────────────────────────────────────────────────

test('node: generator produces a script with require(\'http\')', () => {
  const html = '<html>Node</html>'
  const files = node.generate({ html })
  const server = files.find(f => f.path === 'server.js')
  assert.ok(server, 'server.js should be in output')
  assert.ok(server.content.includes("require('http')"), 'should use require(\'http\')')
  assert.ok(server.content.includes('html>Node</html'), 'should embed the HTML')
})

// ── Bun tests ────────────────────────────────────────────────────────────────

test('bun: generator produces a script with Bun.serve', () => {
  const html = '<html>Bun</html>'
  const files = bun.generate({ html })
  const server = files.find(f => f.path === 'server.js')
  assert.ok(server, 'server.js should be in output')
  assert.ok(server.content.includes('Bun.serve('), 'should use Bun.serve')
  assert.ok(server.content.includes('html>Bun</html'), 'should embed the HTML')
})

// ── Deno tests ───────────────────────────────────────────────────────────────

test('deno: generator produces a script with serve', () => {
  const html = '<html>Deno</html>'
  const files = denoTarget.generate({ html })
  const server = files.find(f => f.path === 'server.ts')
  assert.ok(server, 'server.ts should be in output')
  assert.ok(server.content.includes('serve('), 'should use serve()')
  assert.ok(server.content.includes('html>Deno</html'), 'should embed the HTML')
})

// ── Graceful empty handling ──────────────────────────────────────────────────

test('all generators handle missing CSS/JS gracefully (empty strings)', () => {
  const html = '<html>minimal</html>'

  const cfFiles = cloudflare.generate({ html, css: '', js: '' })
  const cfWorker = cfFiles.find(f => f.path === 'worker.js')
  assert.ok(!cfWorker.content.includes('"/styles.css"'), 'cloudflare: no styles.css key when css is empty')
  assert.ok(!cfWorker.content.includes('"/app.js"'), 'cloudflare: no app.js key when js is empty')

  const denoFiles = denoTarget.generate({ html, css: '', js: '' })
  const denoServer = denoFiles.find(f => f.path === 'server.ts')
  assert.ok(!denoServer.content.includes('"/styles.css"'), 'deno: no styles.css key when css is empty')

  const bunFiles = bun.generate({ html, css: '', js: '' })
  const bunServer = bunFiles.find(f => f.path === 'server.js')
  assert.ok(!bunServer.content.includes('"/styles.css"'), 'bun: no styles.css key when css is empty')

  const nodeFiles = node.generate({ html, css: '', js: '' })
  const nodeServer = nodeFiles.find(f => f.path === 'server.js')
  assert.ok(!nodeServer.content.includes('"/styles.css"'), 'node: no styles.css key when css is empty')
})

// ── Asset routing tests ──────────────────────────────────────────────────────

test('cloudflare: generated Worker correctly serves / and /styles.css paths', () => {
  const html = '<html>root</html>'
  const css  = 'body { color: red }'
  const files = cloudflare.generate({ html, css })
  const worker = files.find(f => f.path === 'worker.js')
  assert.ok(worker.content.includes('"/"'), 'should have "/" key in ASSETS')
  assert.ok(worker.content.includes('"/styles.css"'), 'should have "/styles.css" key in ASSETS')
  assert.ok(worker.content.includes('html>root</html'), 'should embed root HTML')
  assert.ok(worker.content.includes('color: red'), 'should embed CSS')
})

// ── Content-type tests ───────────────────────────────────────────────────────

test('cloudflare: content-type helper returns correct types', () => {
  const { getContentType } = require('../src/deploy/cloudflare')
  assert.equal(getContentType('/index.html'), 'text/html; charset=utf-8')
  assert.equal(getContentType('/styles.css'), 'text/css')
  assert.equal(getContentType('/app.js'), 'application/javascript')
  assert.equal(getContentType('/data.json'), 'application/json')
  assert.equal(getContentType('/logo.svg'), 'image/svg+xml')
  assert.equal(getContentType('/img.png'), 'image/png')
  assert.equal(getContentType('/favicon.ico'), 'image/x-icon')
  assert.equal(getContentType('/file.bin'), 'application/octet-stream')
})

test('cloudflare: generated Worker script has correct content-type logic', () => {
  const files = cloudflare.generate({ html: '<html/>', css: 'body{}' })
  const worker = files.find(f => f.path === 'worker.js')
  assert.ok(worker.content.includes('text/css'), 'should reference text/css content type')
  assert.ok(worker.content.includes('text/html'), 'should reference text/html content type')
})
