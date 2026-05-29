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

// Derive SQL DEFAULT value from a field's initializer literal node
function _fieldDefaultSql(field, dialect) {
  const node = field.init
  if (!node || node.type !== 'Literal') return ''
  const v = node.value
  if (v === null || v === undefined) return ' DEFAULT NULL'
  if (typeof v === 'boolean') return dialect === 'postgres' ? ` DEFAULT ${v}` : ` DEFAULT ${v ? 1 : 0}`
  if (typeof v === 'number') return ` DEFAULT ${v}`
  if (typeof v === 'string') return ` DEFAULT '${v.replace(/'/g, "''")}'`
  return ''
}

// Build the desired column definitions from an Arc ModelDecl
function desiredColumns(schema, dialect = 'sqlite') {
  const idDef = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
  const nonIdFields = (schema.fields ?? []).filter(f => f.name && !f.decorators?.includes('@id'))
  const cols = [{ name: 'id', sql: idDef, isPk: true }]
  for (const f of nonIdFields) {
    const rawType = f.typeAnnotation?.name ?? ''
    const isOptional = f.typeAnnotation?.nullable === true || rawType.endsWith('?') || f.optional === true
    const sqlType = arcTypeToSql(rawType.replace(/\?$/, ''), dialect)
    const notNull = isOptional ? '' : ' NOT NULL'
    const unique = f.decorators?.includes('@unique') ? ' UNIQUE' : ''
    const defaultVal = _fieldDefaultSql(f, dialect)
    cols.push({ name: f.name, sql: `${sqlType}${notNull}${defaultVal}${unique}`, isPk: false })
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
    // Normalize to lowercase so lookups are case-insensitive regardless of how the table was created
    const tbl = row.table_name.toLowerCase()
    if (!result.has(tbl)) result.set(tbl, new Set())
    result.get(tbl).add(row.column_name)
  }
  return result
}

// Apply migration SQL to SQLite.
// NOTE: SQLite DDL (ALTER TABLE, CREATE TABLE) is NOT transactional in WAL mode - a ROLLBACK
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
    // db.transaction wraps DDL+DML in a proper savepoint; manual BEGIN/COMMIT
    // does not protect DDL in WAL mode - schema changes survive a ROLLBACK.
    db.transaction(() => {
      for (const stmt of statements) db.exec(stmt)
    })()
  } catch (e) {
    throw new Error(`arc db migrate: migration failed (SQLite DDL is not fully transactional — DB may be in partial state if multiple statements were run): ${e.message}`)
  } finally {
    db.close()
  }
}

// Apply migration SQL to PostgreSQL
async function applyMigrationPg(statements, connectionString) {
  const { Client } = require('pg')
  const client = new Client({ connectionString })
  let connected = false
  await client.connect()
  connected = true
  try {
    // Send all DDL in one round-trip inside a single transaction
    await client.query('BEGIN;\n' + statements.join(';\n') + ';\nCOMMIT')
  } catch (e) {
    if (connected) await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    if (connected) await client.end().catch(() => {})
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

// Drop all model tables from the database (used by arc db reset)
async function dropTables(schemas, opts = {}) {
  const dialect = opts.db ?? 'sqlite'
  const dbUrl = opts.url ?? (dialect === 'postgres' ? 'postgres://localhost/app' : 'app.db')
  const tableNames = schemas.map(s => tableName(s.name)).filter(t => _SAFE_IDENT.test(t))

  if (dialect === 'postgres') {
    const { Client } = require('pg')
    const client = new Client({ connectionString: dbUrl })
    await client.connect()
    try {
      // Drop all tables in one round-trip instead of N sequential queries
      await client.query(`DROP TABLE IF EXISTS ${tableNames.join(', ')} CASCADE`)
    } catch (e) {
      throw e
    } finally {
      await client.end().catch(() => {})
    }
    return { dropped: tableNames }
  }

  // SQLite: drop each table, or delete the file if it exists and all model tables are being cleared
  const fs = require('fs')
  try { await fs.promises.access(dbUrl) } catch { return { dropped: [] } }

  let Database
  try {
    ;({ Database } = require('bun:sqlite'))
  } catch {
    try { Database = require('better-sqlite3') }
    catch { throw new Error('arc db reset: install better-sqlite3 or run with bun') }
  }

  const db = new Database(dbUrl)
  try {
    // Check all existing tables - if only model tables + sqlite internals remain, we can drop safely
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name)
    const modelSet = new Set(tableNames)
    const toDrop = existing.filter(t => modelSet.has(t))
    db.transaction(() => {
      for (const tbl of toDrop) db.exec(`DROP TABLE IF EXISTS ${tbl}`)
    })()
    return { dropped: toDrop }
  } finally {
    db.close()
  }
}

module.exports = { migrate, generateModelMigration, desiredColumns, tableName, dropTables, arcTypeToSql }

