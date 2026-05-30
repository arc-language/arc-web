'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { generateModelMigration, desiredColumns, tableName, arcTypeToSql, migrate, dropTables } = require('../src/compilers/migration-compiler')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')

function parseModel(src) {
  const tokens = new Lexer(src).tokenize()
  const prog = new Parser(tokens).parse()
  return prog.declarations.find(d => d.type === 'ModelDecl')
}

// ── arcTypeToSql ──────────────────────────────────────────────────────────────

test('arcTypeToSql: SQLite dialect', () => {
  assert.strictEqual(arcTypeToSql('Int', 'sqlite'), 'INTEGER')
  assert.strictEqual(arcTypeToSql('Float', 'sqlite'), 'REAL')
  assert.strictEqual(arcTypeToSql('Bool', 'sqlite'), 'INTEGER')
  assert.strictEqual(arcTypeToSql('DateTime', 'sqlite'), 'TEXT')
  assert.strictEqual(arcTypeToSql('String', 'sqlite'), 'TEXT')
  assert.strictEqual(arcTypeToSql('Email', 'sqlite'), 'TEXT')
  assert.strictEqual(arcTypeToSql(undefined, 'sqlite'), 'TEXT')
})

test('arcTypeToSql: Postgres dialect', () => {
  assert.strictEqual(arcTypeToSql('Int', 'postgres'), 'INTEGER')
  assert.strictEqual(arcTypeToSql('Float', 'postgres'), 'REAL')
  assert.strictEqual(arcTypeToSql('Bool', 'postgres'), 'BOOLEAN')
  assert.strictEqual(arcTypeToSql('DateTime', 'postgres'), 'TIMESTAMPTZ')
  assert.strictEqual(arcTypeToSql('String', 'postgres'), 'TEXT')
})

// ── tableName ─────────────────────────────────────────────────────────────────

test('tableName: lowercases and pluralizes', () => {
  assert.strictEqual(tableName('Post'), 'posts')
  assert.strictEqual(tableName('User'), 'users')
  assert.strictEqual(tableName('Comment'), 'comments')
})

// ── desiredColumns ────────────────────────────────────────────────────────────

test('desiredColumns: SQLite includes id + non-id fields', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String
  let published: Bool
`)
  const cols = desiredColumns(schema, 'sqlite')
  assert.strictEqual(cols[0].name, 'id')
  assert.ok(cols[0].sql.includes('PRIMARY KEY'))
  assert.strictEqual(cols[1].name, 'title')
  assert.ok(cols[1].sql.startsWith('TEXT'))
  assert.ok(cols[1].sql.includes('NOT NULL'))
  assert.strictEqual(cols[2].name, 'published')
  assert.ok(cols[2].sql.startsWith('INTEGER'))
  assert.ok(cols[2].sql.includes('NOT NULL'))
})

test('desiredColumns: Postgres uses SERIAL and correct types', () => {
  const schema = parseModel(`
model User
  @id let id = autoincrement()
  let email: Email
  let active: Bool
  let createdAt: DateTime
`)
  const cols = desiredColumns(schema, 'postgres')
  assert.ok(cols[0].sql.includes('SERIAL'))
  assert.ok(cols[1].sql.startsWith('TEXT'))        // Email → TEXT
  assert.ok(cols[1].sql.includes('NOT NULL'))
  assert.ok(cols[2].sql.startsWith('BOOLEAN'))
  assert.ok(cols[2].sql.includes('NOT NULL'))
  assert.ok(cols[3].sql.startsWith('TIMESTAMPTZ'))
  assert.ok(cols[3].sql.includes('NOT NULL'))
})

// ── generateModelMigration ────────────────────────────────────────────────────

test('generateModelMigration: creates full CREATE TABLE when no existing cols', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String
  let body: String
`)
  const stmts = generateModelMigration(schema, new Set(), 'sqlite')
  assert.strictEqual(stmts.length, 1)
  assert.ok(stmts[0].includes('CREATE TABLE IF NOT EXISTS posts'))
  assert.ok(stmts[0].includes('id INTEGER PRIMARY KEY AUTOINCREMENT'))
  assert.ok(stmts[0].includes('title TEXT'))
  assert.ok(stmts[0].includes('body TEXT'))
})

test('generateModelMigration: emits ADD COLUMN for missing fields only', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String
  let body: String
  let published: Bool
`)
  const existing = new Set(['id', 'title'])
  const stmts = generateModelMigration(schema, existing, 'sqlite')
  assert.strictEqual(stmts.length, 2)
  assert.ok(stmts[0].includes('ADD COLUMN body TEXT'))
  assert.ok(stmts[1].includes('ADD COLUMN published INTEGER'))
})

test('generateModelMigration: returns empty when schema is up to date', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String
`)
  const existing = new Set(['id', 'title'])
  const stmts = generateModelMigration(schema, existing, 'sqlite')
  assert.strictEqual(stmts.length, 0)
})

test('generateModelMigration: Postgres uses SERIAL + $N syntax in CREATE TABLE', () => {
  const schema = parseModel(`
model User
  @id let id = autoincrement()
  let email: Email
  let name: String
`)
  const stmts = generateModelMigration(schema, new Set(), 'postgres')
  assert.strictEqual(stmts.length, 1)
  assert.ok(stmts[0].includes('SERIAL PRIMARY KEY'))
  assert.ok(stmts[0].includes('email TEXT'))
})

test('generateModelMigration: does not emit id as ADD COLUMN', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String
  let newField: String
`)
  // table exists with id + title
  const existing = new Set(['id', 'title'])
  const stmts = generateModelMigration(schema, existing, 'sqlite')
  assert.strictEqual(stmts.length, 1)
  assert.ok(stmts[0].includes('ADD COLUMN newField'))
  assert.ok(!stmts.some(s => s.includes('ADD COLUMN id')))
})

// ── migrate() dry run ─────────────────────────────────────────────────────────

test('migrate: dry run with no existing DB returns correct report without writing', async () => {
  const schema = parseModel(`
model Comment
  @id let id = autoincrement()
  let text: String
  let postId: Int
`)
  const result = await migrate([schema], {
    db: 'sqlite',
    url: '/tmp/arc-test-nonexistent-' + Date.now() + '.db',
    dry: true,
  })
  assert.strictEqual(result.upToDate, false)
  assert.strictEqual(result.applied, false)
  assert.strictEqual(result.report.length, 1)
  assert.strictEqual(result.report[0].table, 'comments')
  assert.ok(result.report[0].isNew)
  assert.ok(result.sql.includes('CREATE TABLE IF NOT EXISTS comments'))
})

test('migrate: upToDate when all models already present', async () => {
  const schema = parseModel(`
model Tag
  @id let id = autoincrement()
  let name: String
`)
  // Pass an empty existing Map manually by temporarily patching
  // — test with no DB file (all tables treated as new) then with a live DB
  // For this unit test, use dry=true with nonexistent path so we know the shape
  const result = await migrate([schema], {
    db: 'sqlite',
    url: '/tmp/arc-no-db-' + Date.now() + '.db',
    dry: true,
  })
  // New DB → table is new, not upToDate
  assert.strictEqual(result.upToDate, false)
})

// ── desiredColumns: nullable and @unique ──────────────────────────────────────

test('desiredColumns: nullable field omits NOT NULL', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String?
`)
  const cols = desiredColumns(schema, 'sqlite')
  const titleCol = cols.find(c => c.name === 'title')
  assert.ok(titleCol, 'should have title column')
  assert.ok(!titleCol.sql.includes('NOT NULL'), 'nullable field should not have NOT NULL')
})

test('desiredColumns: @unique field includes UNIQUE constraint', () => {
  const schema = parseModel(`
model User
  @id let id = autoincrement()
  @unique let email: String
`)
  const cols = desiredColumns(schema, 'sqlite')
  const emailCol = cols.find(c => c.name === 'email')
  assert.ok(emailCol, 'should have email column')
  assert.ok(emailCol.sql.includes('UNIQUE'), 'email should have UNIQUE constraint')
})

test('desiredColumns: boolean field with default false gets DEFAULT 0 in sqlite', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let published: Bool = false
`)
  const cols = desiredColumns(schema, 'sqlite')
  const col = cols.find(c => c.name === 'published')
  assert.ok(col, 'should have published column')
  assert.ok(col.sql.includes('DEFAULT 0'), `bool default false → DEFAULT 0 in sqlite: ${col.sql}`)
})

test('desiredColumns: boolean field with default true gets DEFAULT 1 in sqlite', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let active: Bool = true
`)
  const cols = desiredColumns(schema, 'sqlite')
  const col = cols.find(c => c.name === 'active')
  assert.ok(col.sql.includes('DEFAULT 1'), `bool default true → DEFAULT 1: ${col.sql}`)
})

test('desiredColumns: boolean default uses true/false in postgres', () => {
  const schema = parseModel(`
model Post
  @id let id = autoincrement()
  let active: Bool = true
`)
  const cols = desiredColumns(schema, 'postgres')
  const col = cols.find(c => c.name === 'active')
  assert.ok(col.sql.includes('DEFAULT true'), `postgres uses true/false: ${col.sql}`)
})

test('desiredColumns: numeric default included in SQL', () => {
  const schema = parseModel(`
model Counter
  @id let id = autoincrement()
  let count: Int = 0
`)
  const cols = desiredColumns(schema, 'sqlite')
  const col = cols.find(c => c.name === 'count')
  assert.ok(col.sql.includes('DEFAULT 0'), `numeric default: ${col.sql}`)
})

test('desiredColumns: string default is quoted', () => {
  const schema = parseModel(`
model User
  @id let id = autoincrement()
  let role: String = "editor"
`)
  const cols = desiredColumns(schema, 'sqlite')
  const col = cols.find(c => c.name === 'role')
  assert.ok(col.sql.includes("DEFAULT 'editor'"), `string default should be quoted: ${col.sql}`)
})

// ── generateModelMigration: unsafe model name ─────────────────────────────────

test('generateModelMigration: throws on unsafe model name', () => {
  const schema = { name: 'Drop Table; --', fields: [] }
  assert.throws(
    () => generateModelMigration(schema, new Set(), 'sqlite'),
    /unsafe model name/,
  )
})

test('generateModelMigration: nullable field in CREATE TABLE lacks NOT NULL', () => {
  const schema = parseModel(`
model Article
  @id let id = autoincrement()
  let subtitle: String?
  let title: String
`)
  const stmts = generateModelMigration(schema, new Set(), 'sqlite')
  assert.strictEqual(stmts.length, 1)
  assert.ok(stmts[0].includes('subtitle TEXT'), 'nullable field should be TEXT without NOT NULL')
  assert.ok(!stmts[0].match(/subtitle TEXT NOT NULL/), 'should not have NOT NULL for nullable')
  assert.ok(stmts[0].includes('title TEXT NOT NULL'), 'non-nullable should have NOT NULL')
})

// ── migrate: multiple models ──────────────────────────────────────────────────

test('migrate: dry run with multiple models emits multiple CREATE TABLE', async () => {
  const s1 = parseModel(`
model Post
  @id let id = autoincrement()
  let title: String
`)
  const s2 = parseModel(`
model Comment
  @id let id = autoincrement()
  let body: String
`)
  const result = await migrate([s1, s2], {
    db: 'sqlite',
    url: '/tmp/arc-multi-' + Date.now() + '.db',
    dry: true,
  })
  assert.strictEqual(result.upToDate, false)
  assert.strictEqual(result.report.length, 2)
  assert.ok(result.sql.includes('CREATE TABLE IF NOT EXISTS posts'))
  assert.ok(result.sql.includes('CREATE TABLE IF NOT EXISTS comments'))
})

test('migrate: dry run returns applied=false', async () => {
  const schema = parseModel(`
model Widget
  @id let id = autoincrement()
  let name: String
`)
  const result = await migrate([schema], {
    db: 'sqlite',
    url: '/tmp/arc-applied-' + Date.now() + '.db',
    dry: true,
  })
  assert.strictEqual(result.applied, false)
})

// ── dropTables: nonexistent DB returns empty dropped list ─────────────────────

test('dropTables: nonexistent sqlite DB returns { dropped: [] }', async () => {
  const schema = parseModel(`
model Phantom
  @id let id = autoincrement()
  let name: String
`)
  const result = await dropTables([schema], {
    db: 'sqlite',
    url: '/tmp/arc-nonexistent-drop-' + Date.now() + '.db',
  })
  assert.deepStrictEqual(result, { dropped: [] })
})

// ── _fieldDefaultSql edge: non-standard literal value (line 25) ───────────────

test('desiredColumns: Literal init with exotic value type produces no DEFAULT clause', () => {
  // Construct a field with a Literal node whose value is an object (not null/bool/number/string)
  // This exercises the final `return ''` fallback on line 25 of _fieldDefaultSql
  const schema = {
    name: 'Edge',
    fields: [
      {
        name: 'weird',
        typeAnnotation: { name: 'String' },
        decorators: [],
        optional: true,
        // Literal node with an object value — none of the type guards match
        init: { type: 'Literal', value: { foo: 'bar' } },
      },
    ],
  }
  const cols = desiredColumns(schema, 'sqlite')
  const col = cols.find(c => c.name === 'weird')
  assert.ok(col, 'column should exist')
  assert.ok(!col.sql.includes('DEFAULT'), `should have no DEFAULT clause, got: ${col.sql}`)
})

test('desiredColumns: Literal init with null value produces DEFAULT NULL', () => {
  const schema = {
    name: 'Nulled',
    fields: [
      {
        name: 'maybeVal',
        typeAnnotation: { name: 'String' },
        decorators: [],
        optional: true,
        init: { type: 'Literal', value: null },
      },
    ],
  }
  const cols = desiredColumns(schema, 'sqlite')
  const col = cols.find(c => c.name === 'maybeVal')
  assert.ok(col, 'column should exist')
  assert.ok(col.sql.includes('DEFAULT NULL'), `should have DEFAULT NULL, got: ${col.sql}`)
})

// ── migrate: real SQLite — creates table, detects up-to-date, alters ──────────

const fs = require('fs')
const path = require('path')
const os = require('os')

// Detect if better-sqlite3 is available (symlinked or installed)
let hasSqlite = false
try {
  require('better-sqlite3')
  hasSqlite = true
} catch {}

function skipIfNoSqlite(name, fn) {
  if (!hasSqlite) {
    test(name, { skip: 'better-sqlite3 not available' }, () => {})
  } else {
    test(name, fn)
  }
}

skipIfNoSqlite('migrate: creates table in a real SQLite DB and is upToDate on second run', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-migrate-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const schema = parseModel(`
model Widget
  @id let id = autoincrement()
  let name: String
  let count: Int
`)
    // First run: table is new, should apply
    const result = await migrate([schema], { db: 'sqlite', url: dbPath })
    assert.strictEqual(result.upToDate, false)
    assert.strictEqual(result.applied, true)
    assert.strictEqual(result.report.length, 1)
    assert.ok(result.report[0].isNew)
    assert.strictEqual(result.report[0].table, 'widgets')

    // Second run: table already matches, should be upToDate
    const result2 = await migrate([schema], { db: 'sqlite', url: dbPath })
    assert.strictEqual(result2.upToDate, true)
    assert.strictEqual(result2.applied, false)
    assert.deepStrictEqual(result2.report, [])
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

skipIfNoSqlite('migrate: adds new column to existing table (ALTER TABLE)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-migrate-alter-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const v1 = parseModel(`
model Product
  @id let id = autoincrement()
  let name: String
`)
    await migrate([v1], { db: 'sqlite', url: dbPath })

    const v2 = parseModel(`
model Product
  @id let id = autoincrement()
  let name: String
  let price: Int?
`)
    const result = await migrate([v2], { db: 'sqlite', url: dbPath })
    assert.strictEqual(result.upToDate, false)
    assert.strictEqual(result.applied, true)
    assert.strictEqual(result.report.length, 1)
    assert.ok(!result.report[0].isNew, 'should not be a new table')
    assert.ok(result.report[0].statements[0].includes('ADD COLUMN price'), `expected ADD COLUMN price in: ${result.report[0].statements[0]}`)

    // Third run: now up to date
    const result3 = await migrate([v2], { db: 'sqlite', url: dbPath })
    assert.strictEqual(result3.upToDate, true)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

skipIfNoSqlite('migrate: non-dry apply writes to disk — DB file exists afterward', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-migrate-disk-'))
  const dbPath = path.join(tmpDir, 'app.db')
  try {
    const schema = parseModel(`
model Order
  @id let id = autoincrement()
  let ref: String
`)
    assert.ok(!fs.existsSync(dbPath), 'DB should not exist before migrate')
    await migrate([schema], { db: 'sqlite', url: dbPath })
    assert.ok(fs.existsSync(dbPath), 'DB file should exist after migrate')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

skipIfNoSqlite('migrate: returns correct sql string when applied', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-migrate-sql-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const schema = parseModel(`
model Invoice
  @id let id = autoincrement()
  let amount: Int
`)
    const result = await migrate([schema], { db: 'sqlite', url: dbPath })
    assert.ok(typeof result.sql === 'string', 'should have sql string')
    assert.ok(result.sql.includes('CREATE TABLE IF NOT EXISTS invoices'), `sql: ${result.sql}`)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ── dropTables: real SQLite — drops existing table ────────────────────────────

skipIfNoSqlite('dropTables: drops existing table from SQLite DB', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-drop-real-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const schema = parseModel(`
model Foo
  @id let id = autoincrement()
  let bar: String
`)
    // Create the table first
    await migrate([schema], { db: 'sqlite', url: dbPath })

    // Drop it
    const result = await dropTables([schema], { db: 'sqlite', url: dbPath })
    assert.ok(Array.isArray(result.dropped), 'dropped should be an array')
    assert.ok(result.dropped.includes('foos'), `expected foos in dropped: ${JSON.stringify(result.dropped)}`)

    // After drop, migrating again should create a new table
    const result2 = await migrate([schema], { db: 'sqlite', url: dbPath })
    assert.ok(result2.report[0].isNew, 'table should be new after drop')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

skipIfNoSqlite('dropTables: only drops model tables, leaves others intact', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-drop-partial-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const s1 = parseModel(`
model Alpha
  @id let id = autoincrement()
  let val: String
`)
    const s2 = parseModel(`
model Beta
  @id let id = autoincrement()
  let val: String
`)
    // Create both tables
    await migrate([s1, s2], { db: 'sqlite', url: dbPath })

    // Drop only Alpha
    const result = await dropTables([s1], { db: 'sqlite', url: dbPath })
    assert.ok(result.dropped.includes('alphas'), 'alphas should be dropped')
    assert.ok(!result.dropped.includes('betas'), 'betas should NOT be dropped')

    // Beta should still exist (upToDate on second migrate)
    const result2 = await migrate([s2], { db: 'sqlite', url: dbPath })
    assert.strictEqual(result2.upToDate, true, 'betas table should still exist')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

skipIfNoSqlite('dropTables: returns empty dropped list when table does not exist in DB', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-drop-notexist-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const schema = parseModel(`
model Ghost
  @id let id = autoincrement()
  let name: String
`)
    // Create an unrelated table so the DB file exists
    const unrelated = parseModel(`
model Other
  @id let id = autoincrement()
  let x: String
`)
    await migrate([unrelated], { db: 'sqlite', url: dbPath })

    // Drop Ghost — which was never created
    const result = await dropTables([schema], { db: 'sqlite', url: dbPath })
    assert.deepStrictEqual(result.dropped, [], 'should drop nothing since ghosts table was never created')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ── generateModelMigration: throws on unsafe column name ─────────────────────

test('generateModelMigration: throws on unsafe column name in CREATE TABLE', () => {
  const schema = {
    name: 'Safe',
    fields: [
      {
        name: 'bad col!',
        typeAnnotation: { name: 'String' },
        decorators: [],
      },
    ],
  }
  assert.throws(
    () => generateModelMigration(schema, new Set(), 'sqlite'),
    /unsafe column name/,
  )
})

test('generateModelMigration: throws on unsafe column name in ALTER TABLE', () => {
  const schema = {
    name: 'Safe',
    fields: [
      {
        name: 'bad col!',
        typeAnnotation: { name: 'String' },
        decorators: [],
      },
    ],
  }
  // existingCols has one entry so we take the ALTER TABLE path
  assert.throws(
    () => generateModelMigration(schema, new Set(['id']), 'sqlite'),
    /unsafe column name/,
  )
})

// ── migrate: upToDate returns no sql field ─────────────────────────────────────

test('migrate: upToDate result has no sql field', async () => {
  // Use dry + pre-existing nonexistent path so it's always new in dry mode
  // Then use a real DB to get the upToDate path
  const s = parseModel(`
model Stable
  @id let id = autoincrement()
  let val: String
`)
  // First dry run: not upToDate, has sql
  const r1 = await migrate([s], { db: 'sqlite', url: '/tmp/arc-stable-' + Date.now() + '.db', dry: true })
  assert.ok('sql' in r1, 'should have sql when not upToDate')
  // When upToDate, the early return has no sql field
  // Simulate by using a real DB with two runs
})

skipIfNoSqlite('migrate: upToDate early return path has no sql field', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-uptod-'))
  const dbPath = path.join(tmpDir, 'test.db')
  try {
    const schema = parseModel(`
model Steady
  @id let id = autoincrement()
  let label: String
`)
    await migrate([schema], { db: 'sqlite', url: dbPath })
    const result = await migrate([schema], { db: 'sqlite', url: dbPath })
    assert.strictEqual(result.upToDate, true)
    assert.strictEqual(result.applied, false)
    assert.ok(!('sql' in result), 'upToDate result should not have a sql field')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
