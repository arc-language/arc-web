'use strict'

// Migration compiler: diffs Arc ModelDecl AST nodes against live DB schema,
// generates migration SQL, and optionally applies it.
//
// Supports SQLite (via bun:sqlite / better-sqlite3) and PostgreSQL (via pg).

const _SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
const { arcTypeToSql } = require('./sql-types')

// Derive table name from model name (Post → posts, User → users)
function tableName(modelName) {
  return modelName.toLowerCase() + 's'
}

// Build the desired column definitions from an Arc ModelDecl
function desiredColumns(schema, dialect = 'sqlite') {
  const idDef = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
  const nonIdFields = (schema.fields ?? []).filter(f => f.name && !f.decorators?.includes('@id'))
  const cols = [{ name: 'id', sql: idDef, isPk: true }]
  for (const f of nonIdFields) {
    cols.push({ name: f.name, sql: arcTypeToSql(f.typeAnnotation?.name, dialect), isPk: false })
  }
  return cols
}

// Generate migration SQL statements for one model
// existingCols: Set<string> of column names already in the table (empty set = table doesn't exist)
function generateModelMigration(schema, existingCols, dialect = 'sqlite') {
  if (!_SAFE_IDENT.test(schema.name)) throw new Error(`Arc migration: unsafe model name: ${JSON.stringify(schema.name)}`)
  const tbl = tableName(schema.name)
  const desired = desiredColumns(schema, dialect)
  const statements = []

  if (existingCols.size === 0) {
    // Table doesn't exist - CREATE TABLE
    const colDefs = desired.map(c => {
      if (!_SAFE_IDENT.test(c.name)) throw new Error(`Arc migration: unsafe column name: ${JSON.stringify(c.name)}`)
      return `${c.name} ${c.sql}`
    }).join(', ')
    statements.push(`CREATE TABLE IF NOT EXISTS ${tbl} (${colDefs});`)
  } else {
    // Table exists - ADD missing columns (SQLite and PG both support ALTER TABLE ADD COLUMN)
    for (const col of desired) {
      if (col.isPk) continue // never ADD the primary key
      if (!_SAFE_IDENT.test(col.name)) throw new Error(`Arc migration: unsafe column name: ${JSON.stringify(col.name)}`)
      if (!existingCols.has(col.name)) {
        statements.push(`ALTER TABLE ${tbl} ADD COLUMN ${col.name} ${col.sql};`)
      }
    }
    // Note: dropping columns is intentionally omitted - destructive ops require explicit arc db drop
  }

  return statements
}

// Inspect existing SQLite DB via bun:sqlite/better-sqlite3
async function getExistingColumnsSqlite(dbPath) {
  const fs = require('fs')
  // DB file doesn't exist yet - all tables are new
  try { await fs.promises.access(dbPath) } catch { return new Map() }

  let Database
  try {
    ;({ Database } = require('bun:sqlite'))
  } catch {
    try {
      Database = require('better-sqlite3')
    } catch {
      throw new Error('arc db migrate: install better-sqlite3 or run with bun')
    }
  }

  const db = new Database(dbPath)
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    const result = new Map()
    for (const tbl of tables) {
      if (!_SAFE_IDENT.test(tbl)) continue
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all()
      result.set(tbl, new Set(cols.map(c => c.name).filter(n => _SAFE_IDENT.test(n))))
    }
    return result
  } finally {
    db.close()
  }
}

// Inspect existing PostgreSQL DB via pg
async function getExistingColumnsPg(connectionString, tableNames = []) {
  const { Client } = require('pg')
  const client = new Client({ connectionString })
  await client.connect()
  const filter = tableNames.length > 0
    ? `AND table_name = ANY($1)`
    : ''
  const params = tableNames.length > 0 ? [tableNames] : []
  let rows
  try {
    ;({ rows } = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ${filter}
    `, params))
  } finally {
    await client.end()
  }

  const result = new Map()
  for (const row of rows) {
    if (!result.has(row.table_name)) result.set(row.table_name, new Set())
    result.get(row.table_name).add(row.column_name)
  }
  return result
}

// Apply migration SQL to SQLite.
// NOTE: SQLite DDL (ALTER TABLE, CREATE TABLE) is NOT transactional in WAL mode — a ROLLBACK
// after a DDL statement will NOT undo schema changes. This transaction provides atomicity only
// for DML statements and guards the migration log. For DDL safety, migrations should be
// additive-only (no DROP COLUMN, no rename) until SQLite 3.45+ strict-mode is confirmed.
async function applyMigrationSqlite(statements, dbPath) {
  let Database
  try {
    ;({ Database } = require('bun:sqlite'))
  } catch {
    try {
      Database = require('better-sqlite3')
    } catch {
      throw new Error('arc db migrate: install better-sqlite3 or run with bun to apply migrations')
    }
  }
  const db = new Database(dbPath)
  try {
    db.exec('BEGIN')
    for (const stmt of statements) {
      db.exec(stmt)
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch (rbErr) { console.warn('[arc:migrate] rollback attempted after error:', rbErr.message) }
    throw e
  } finally {
    db.close()
  }
}

// Apply migration SQL to PostgreSQL
async function applyMigrationPg(statements, connectionString) {
  const { Client } = require('pg')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('BEGIN')
    for (const stmt of statements) {
      await client.query(stmt)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    await client.end()
  }
}

// Main entry: compute + optionally apply all migrations
async function migrate(schemas, opts = {}) {
  const dialect = opts.db ?? 'sqlite'
  const dry = opts.dry ?? false
  const dbUrl = opts.url ?? (dialect === 'postgres' ? 'postgres://localhost/app' : 'app.db')

  // Get existing schema from live DB
  let existingTables
  if (dialect === 'postgres') {
    existingTables = await getExistingColumnsPg(dbUrl, schemas.map(s => s.name.toLowerCase() + 's'))
  } else {
    existingTables = await getExistingColumnsSqlite(dbUrl)
  }

  const allStatements = []
  const report = []

  for (const schema of schemas) {
    const tbl = tableName(schema.name)
    const existingCols = existingTables.get(tbl) ?? new Set()
    const stmts = generateModelMigration(schema, existingCols, dialect)

    if (stmts.length > 0) {
      allStatements.push(...stmts)
      report.push({ model: schema.name, table: tbl, statements: stmts, isNew: existingCols.size === 0 })
    }
  }

  if (allStatements.length === 0) {
    return { applied: false, upToDate: true, report: [] }
  }

  if (!dry) {
    if (dialect === 'postgres') {
      await applyMigrationPg(allStatements, dbUrl)
    } else {
      await applyMigrationSqlite(allStatements, dbUrl)
    }
  }

  return { applied: !dry, upToDate: false, report, sql: allStatements.join('\n') }
}

module.exports = { migrate, generateModelMigration, desiredColumns, tableName, arcTypeToSql }

