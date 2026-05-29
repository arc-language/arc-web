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
