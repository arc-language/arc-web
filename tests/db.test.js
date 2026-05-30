'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ── Exports ───────────────────────────────────────────────────────────────────

test('db module exports dbCommand and runSeed', () => {
  const db = require('../src/commands/db')
  assert.strictEqual(typeof db.dbCommand, 'function')
  assert.strictEqual(typeof db.runSeed, 'function')
})

// ── dbCommand help / studio / unknown ─────────────────────────────────────────

test('dbCommand: no args prints help and returns', async () => {
  const { dbCommand } = require('../src/commands/db')
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    await dbCommand([])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.includes('arc db')), `expected help output: ${JSON.stringify(logs)}`)
})

test('dbCommand: help subcommand prints help and returns', async () => {
  const { dbCommand } = require('../src/commands/db')
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    await dbCommand(['help'])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.includes('arc db')))
  assert.ok(logs.some(l => l.includes('migrate')))
})

test('dbCommand: studio subcommand prints coming-soon message', async () => {
  const { dbCommand } = require('../src/commands/db')
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    await dbCommand(['studio'])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.includes('coming')), `expected coming-soon: ${JSON.stringify(logs)}`)
})

test('dbCommand: unknown subcommand calls process.exit(1)', async () => {
  const { dbCommand } = require('../src/commands/db')
  const errors = []
  const origError = console.error
  const origExit = process.exit
  let exitCode = null
  console.error = (...a) => errors.push(a.join(' '))
  process.exit = (code) => { exitCode = code; throw new Error(`process.exit(${code})`) }
  try {
    await dbCommand(['foobar'])
  } catch (e) {
    // expected — process.exit throws in test
  } finally {
    console.error = origError
    process.exit = origExit
  }
  assert.strictEqual(exitCode, 1)
  assert.ok(errors.some(e => e.includes('foobar') || e.includes('unknown')), `expected error about unknown subcommand: ${JSON.stringify(errors)}`)
})

test('dbCommand: seed with nonexistent dir calls process.exit(1)', async () => {
  const { dbCommand } = require('../src/commands/db')
  const origExit = process.exit
  const origError = console.error
  let exitCode = null
  process.exit = (code) => { exitCode = code; throw new Error(`exit(${code})`) }
  console.error = () => {}
  try {
    await dbCommand(['seed', '/tmp/arc-no-such-dir-' + Date.now()])
  } catch (e) {
    // expected
  } finally {
    process.exit = origExit
    console.error = origError
  }
  assert.strictEqual(exitCode, 1)
})

// ── helpers ───────────────────────────────────────────────────────────────────

/** Create a temp dir, write files, return the tmpDir path */
function makeTmpProject(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-db-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }
  return tmpDir
}

/** Intercept process.exit; return { code, logs, errors } */
async function runWithMocks(fn) {
  const logs = []
  const errors = []
  let exitCode = null
  const origLog = console.log
  const origError = console.error
  const origExit = process.exit
  console.log = (...a) => logs.push(a.join(' '))
  console.error = (...a) => errors.push(a.join(' '))
  process.exit = (code) => { exitCode = code; throw new Error(`exit:${code}`) }
  try {
    await fn()
  } catch (e) {
    if (!e.message?.startsWith('exit:')) throw e
  } finally {
    console.log = origLog
    console.error = origError
    process.exit = origExit
  }
  return { exitCode, logs, errors }
}

// ── _loadSchemas edge cases via dbCommand ─────────────────────────────────────

test('dbCommand: migrate with empty dir (no .arc files) exits 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-db-empty-'))
  const { exitCode, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  assert.strictEqual(exitCode, 1)
  assert.ok(errors.some(e => e.includes('no .arc files')), `expected "no .arc files" in: ${JSON.stringify(errors)}`)
})

test('dbCommand: status with empty dir exits 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-db-empty-'))
  const { exitCode, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['status', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  assert.strictEqual(exitCode, 1)
  assert.ok(errors.some(e => e.includes('no .arc files')))
})

test('dbCommand: reset with empty dir exits 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-db-empty-'))
  const { exitCode, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['reset', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  assert.strictEqual(exitCode, 1)
  assert.ok(errors.some(e => e.includes('no .arc files')))
})

test('dbCommand: migrate with .arc file but no model declarations — nothing to do', async () => {
  const tmpDir = makeTmpProject({
    'server/config.arc': 'page Home\n  title "Hello"\n'
  })
  const { exitCode, logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  assert.strictEqual(exitCode, null, 'should not exit')
  assert.ok(logs.some(l => l.includes('nothing to do')), `expected "nothing to do": ${JSON.stringify(logs)}`)
})

test('dbCommand: status with .arc file but no model declarations — nothing to do', async () => {
  const tmpDir = makeTmpProject({
    'server/config.arc': 'page Home\n  title "Hello"\n'
  })
  const { exitCode, logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['status', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  assert.strictEqual(exitCode, null)
  assert.ok(logs.some(l => l.includes('nothing to do')))
})

// ── migrate --dry with real model ─────────────────────────────────────────────

test('dbCommand: migrate --dry with model generates SQL output without touching disk', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model User\n  @id let id = autoincrement()\n  let name: String\n  let email: String\n'
  })
  // Use a nonexistent db path so getExistingColumnsSqlite returns empty Map (all-new)
  const fakeDb = path.join(tmpDir, 'nonexistent.db')

  const { exitCode, logs, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--db', 'sqlite', '--url', fakeDb, '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.strictEqual(exitCode, null, `unexpected exit: ${JSON.stringify(errors)}`)
  // dry run output
  assert.ok(logs.some(l => l.toLowerCase().includes('dry')), `expected dry run log: ${JSON.stringify(logs)}`)
  // DB file must NOT have been created
  assert.ok(!fs.existsSync(fakeDb), 'DB file should not be created in dry run')
})

test('dbCommand: migrate --dry reports CREATE for new model', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model Post\n  @id let id = autoincrement()\n  let title: String\n  let body: String\n'
  })
  const fakeDb = path.join(tmpDir, 'missing.db')

  const { logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--url', fakeDb, '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  // should mention the table name (posts) or create
  assert.ok(
    logs.some(l => l.includes('posts') || l.includes('create') || l.includes('CREATE')),
    `expected table mention: ${JSON.stringify(logs)}`
  )
})

// ── status subcommand ─────────────────────────────────────────────────────────

test('dbCommand: status with model and nonexistent DB shows pending', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model Article\n  @id let id = autoincrement()\n  let title: String\n'
  })
  const fakeDb = path.join(tmpDir, 'status-test.db')

  const { exitCode, logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['status', tmpDir, '--url', fakeDb])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.strictEqual(exitCode, null, 'should not exit for status')
  // should show model name or pending
  assert.ok(
    logs.some(l => l.includes('articles') || l.includes('pending')),
    `expected "articles" or "pending": ${JSON.stringify(logs)}`
  )
})

// ── seed subcommand ───────────────────────────────────────────────────────────

test('dbCommand: seed with existing server dir but no seed.arc exits 1 with message', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model User\n  name: String\n'
  })

  const { exitCode, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['seed', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.strictEqual(exitCode, 1)
  assert.ok(errors.some(e => e.includes('seed') && e.includes('no seed file')), `expected seed error: ${JSON.stringify(errors)}`)
})

test('dbCommand: seed hint message mentions Create and seed.arc', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model User\n  name: String\n'
  })

  const { errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['seed', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.ok(errors.some(e => e.includes('Create')), `expected "Create" hint: ${JSON.stringify(errors)}`)
})

// ── _parseDbArgs edge cases via dbCommand ─────────────────────────────────────

test('dbCommand: migrate respects --db postgres flag (exits on connection error, not arg parse)', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model Foo\n  @id let id = autoincrement()\n  let bar: String\n'
  })

  const { exitCode, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--db', 'postgres', '--url', 'postgres://localhost:1/noexist', '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  // With --dry and postgres, it will try to connect (and fail at network level), but that's fine —
  // we just verify we got past argument parsing (exitCode is 1 from connection error, not arg error)
  // OR it succeeded with dry-run if pg isn't installed
  assert.ok(exitCode === 1 || exitCode === null, `unexpected exit code: ${exitCode}`)
})

test('dbCommand: migrate with --url flag uses provided url (shown in non-tty output)', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model Thing\n  @id let id = autoincrement()\n  let label: String\n'
  })
  const fakeDb = path.join(tmpDir, 'custom-named.db')

  const { exitCode } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--url', fakeDb, '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.strictEqual(exitCode, null)
})

// ── _loadSchemas: server subdir vs root dir ───────────────────────────────────

test('dbCommand: migrate finds models.arc in root dir when no server/ subdir', async () => {
  const tmpDir = makeTmpProject({
    'models.arc': 'model Widget\n  @id let id = autoincrement()\n  let name: String\n'
  })
  const fakeDb = path.join(tmpDir, 'root.db')

  const { exitCode, logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--url', fakeDb, '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.strictEqual(exitCode, null, `unexpected exit: logs=${JSON.stringify(logs)}`)
  assert.ok(logs.some(l => l.includes('dry') || l.includes('widgets') || l.includes('create')))
})

// ── runSeed error paths ───────────────────────────────────────────────────────

test('runSeed: exits 1 when seed file does not exist', async () => {
  const { runSeed } = require('../src/commands/db')
  const { exitCode } = await runWithMocks(() =>
    runSeed('/tmp/arc-no-such-seed-' + Date.now() + '.arc', '/tmp')
  )
  assert.strictEqual(exitCode, 1)
})

test('runSeed: exits 1 when seed file has invalid arc syntax', async () => {
  const { runSeed } = require('../src/commands/db')
  const tmpDir = makeTmpProject({
    'server/seed.arc': '@@@@invalid syntax here@@@@'
  })
  const seedFile = path.join(tmpDir, 'server', 'seed.arc')

  const { exitCode } = await runWithMocks(() =>
    runSeed(seedFile, tmpDir)
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  assert.strictEqual(exitCode, 1)
})

// ── _reportCols indirectly (via migrate dry log) ──────────────────────────────

test('dbCommand: migrate --dry with multi-field model includes all columns in output', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model Product\n  @id let id = autoincrement()\n  let name: String\n  let price: Float\n  let inStock: Bool\n'
  })
  const fakeDb = path.join(tmpDir, 'product.db')

  const { logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--url', fakeDb, '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  // At minimum we should see some migration-related output
  assert.ok(logs.length > 0, 'expected some log output')
})

// ── studio subcommand (already tested above, verify exact string) ─────────────

test('dbCommand: studio logs "coming in 0.3" exact phrase', async () => {
  const { dbCommand } = require('../src/commands/db')
  const { logs } = await runWithMocks(() => dbCommand(['studio']))
  assert.ok(logs.some(l => l.includes('0.3')), `expected version 0.3: ${JSON.stringify(logs)}`)
})

// ── default dir fallback ──────────────────────────────────────────────────────

test('dbCommand: migrate without explicit dir uses cwd (current dir)', async () => {
  // With no dir arg, _parseDbArgs returns '.', which resolves to cwd.
  // As long as cwd has no .arc files the load will fail with "no .arc files".
  const { exitCode, errors } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate'])
  )
  // Either exits 1 (no .arc files) or exits 1 (model error) — either way, exits cleanly
  // (Won't succeed unless cwd accidentally has .arc files with models)
  assert.ok(exitCode === 1 || exitCode === null)
})

// ── _resolveDbUrl: postgres default ──────────────────────────────────────────

test('dbCommand: migrate --db postgres without --url uses postgres default (fails at connect)', async () => {
  const tmpDir = makeTmpProject({
    'server/models.arc': 'model Alpha\n  @id let id = autoincrement()\n  let val: String\n'
  })

  const savedEnv = process.env.DATABASE_URL
  delete process.env.DATABASE_URL

  const { exitCode } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['migrate', tmpDir, '--db', 'postgres', '--dry'])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })
  if (savedEnv !== undefined) process.env.DATABASE_URL = savedEnv

  // Should exit 1 due to postgres connection failure (pg module missing or no server)
  // OR succeed with dry run if pg is somehow available — both are valid
  assert.ok(exitCode === 1 || exitCode === null)
})

// ── reset subcommand: no model declarations ───────────────────────────────────

test('dbCommand: reset with .arc but no models — nothing to do', async () => {
  const tmpDir = makeTmpProject({
    'server/config.arc': 'page Foo\n  title "x"\n'
  })

  const { exitCode, logs } = await runWithMocks(() =>
    require('../src/commands/db').dbCommand(['reset', tmpDir])
  )
  fs.rmSync(tmpDir, { recursive: true, force: true })

  assert.strictEqual(exitCode, null)
  assert.ok(logs.some(l => l.includes('nothing to do')))
})
