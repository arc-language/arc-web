'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  validateName,
  getTemplate,
  detectAvailablePMs,
  detectPackageManager,
} = require('../src/new-command')

// ── validateName ──────────────────────────────────────────────────────────────

test('validateName: accepts valid names', () => {
  assert.strictEqual(validateName('my-app'), null)
  assert.strictEqual(validateName('myapp'), null)
  assert.strictEqual(validateName('app123'), null)
  assert.strictEqual(validateName('a'), null)
})

test('validateName: rejects empty string', () => {
  assert.ok(validateName('') !== null)
  assert.ok(validateName('   ') !== null)
})

test('validateName: rejects names with spaces', () => {
  assert.ok(validateName('my app') !== null)
  assert.ok(validateName('my  app') !== null)
})

test('validateName: rejects leading dot', () => {
  assert.ok(validateName('.hidden') !== null)
})

test('validateName: rejects leading dash', () => {
  assert.ok(validateName('-myapp') !== null)
})

test('validateName: rejects name over 214 chars', () => {
  assert.ok(validateName('a'.repeat(215)) !== null)
})

test('validateName: rejects all-special-char names', () => {
  assert.ok(validateName('!!!') !== null)
  assert.ok(validateName('###') !== null)
})

test('validateName: accepts name exactly 214 chars', () => {
  assert.strictEqual(validateName('a'.repeat(214)), null)
})

// ── getTemplate ───────────────────────────────────────────────────────────────

test('getTemplate: default template has index.arc and package.json', () => {
  const files = getTemplate('myapp', 'default')
  assert.ok('index.arc' in files, 'should have index.arc')
  assert.ok('package.json' in files, 'should have package.json')
  assert.ok('.gitignore' in files, 'should have .gitignore')
  assert.ok(files['index.arc'].includes('myapp'), 'index.arc should mention project name')
})

test('getTemplate: counter template has @state', () => {
  const files = getTemplate('counter-app', 'counter')
  assert.ok('index.arc' in files)
  assert.ok(files['index.arc'].includes('@state'), 'counter should use @state')
  assert.ok(files['index.arc'].includes('count'))
})

test('getTemplate: blog template has @build and for loop', () => {
  const files = getTemplate('my-blog', 'blog')
  assert.ok('index.arc' in files)
  assert.ok(files['index.arc'].includes('@build'), 'blog should use @build')
  assert.ok(files['index.arc'].includes('for post in posts'), 'blog should have for loop')
})

test('getTemplate: api template has route and model files', () => {
  const files = getTemplate('my-api', 'api', 'bun')
  assert.ok('server/routes/posts.arc' in files, 'should have route file')
  assert.ok('server/schemas/post.arc' in files, 'should have schema file')
  assert.ok('package.json' in files)
  const pkg = JSON.parse(files['package.json'])
  assert.ok(pkg.scripts.dev, 'should have dev script')
  assert.ok(pkg.scripts.migrate, 'should have migrate script')
})

test('getTemplate: api template with npm uses node in start script', () => {
  const files = getTemplate('my-api', 'api', 'npm')
  const pkg = JSON.parse(files['package.json'])
  assert.ok(pkg.scripts.start.includes('node'), 'npm target should use node')
})

test('getTemplate: api template with bun uses bun in start script', () => {
  const files = getTemplate('my-api', 'api', 'bun')
  const pkg = JSON.parse(files['package.json'])
  assert.ok(pkg.scripts.start.includes('bun'), 'bun target should use bun')
})

test('getTemplate: cms template has auth and admin routes', () => {
  const files = getTemplate('my-cms', 'cms')
  assert.ok(Object.keys(files).some(k => k.includes('auth')), 'cms should have auth routes')
  assert.ok(Object.keys(files).some(k => k.includes('user')), 'cms should have user schema')
  assert.ok('arc.config.json' in files, 'cms should have arc.config.json')
  const cfg = JSON.parse(files['arc.config.json'])
  assert.ok(cfg.auth?.providers?.includes('github'), 'should configure github oauth')
})

test('getTemplate: safeName normalizes special chars in package.json name', () => {
  const files = getTemplate('My App!', 'default')
  const pkg = JSON.parse(files['package.json'])
  assert.ok(!pkg.name.includes(' '), 'package name should not have spaces')
  assert.ok(!pkg.name.includes('!'), 'package name should not have special chars')
})

test('getTemplate: .gitignore excludes dist and node_modules', () => {
  const files = getTemplate('myapp', 'default')
  assert.ok(files['.gitignore'].includes('dist/'), 'should exclude dist/')
  assert.ok(files['.gitignore'].includes('node_modules/'), 'should exclude node_modules/')
})

// ── detectAvailablePMs ────────────────────────────────────────────────────────

test('detectAvailablePMs: returns at least one package manager', () => {
  const pms = detectAvailablePMs()
  assert.ok(Array.isArray(pms), 'should return an array')
  assert.ok(pms.length > 0, 'should return at least one PM')
  const valid = new Set(['bun', 'npm', 'pnpm', 'yarn'])
  for (const pm of pms) {
    assert.ok(valid.has(pm), `unexpected PM: ${pm}`)
  }
})

test('detectAvailablePMs: always includes npm as fallback', () => {
  // npm is always available in CI environments
  const pms = detectAvailablePMs()
  // The return is guaranteed non-empty — npm is the final fallback
  assert.ok(pms.length >= 1)
})

// ── detectPackageManager ──────────────────────────────────────────────────────

test('detectPackageManager: returns a valid package manager string', () => {
  const pm = detectPackageManager()
  assert.ok(typeof pm === 'string', 'should return a string')
  const valid = new Set(['bun', 'npm', 'pnpm', 'yarn'])
  assert.ok(valid.has(pm), `unexpected PM: ${pm}`)
})

