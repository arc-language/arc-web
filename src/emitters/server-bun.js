'use strict'

// Bun server emitter.
// Input:  Arc program with RouteDecl + ModelDecl + JobDecl nodes
// Output: A complete dist/server.js that runs with `bun dist/server.js`
//
// options.db: 'sqlite' (default) | 'postgres'
//
// Performance strategy:
//   - Routes compiled to a radix-trie decision tree at build time (zero regex at request time)
//   - SQL queries generated as constant strings (no query-builder overhead at runtime)
//   - Typed JSON serialization per response shape (no generic JSON.stringify overhead)
//   - Bun.serve() used directly (20% faster than fetch-handler style)

const { JsEmitter } = require('./js')
const { compileRoutes, emitBunRoutesObject } = require('../compilers/route-compiler')
const { emitAuthPreamble } = require('./auth-helpers')
const { emitQueuePreamble, emitEmailPreamble, emitJobEnqueueWrapper } = require('./queue-helpers')
const { arcTypeToSql: _arcTypeToSql } = require('../compilers/sql-types')
const { routeHandlerName } = require('./route-utils')
const { SHARED_RESPONSE_HELPERS } = require('./emitter-preamble')
const { emitRouteBody } = require('./route-body-emitter')

const _SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

class BunServerEmitter {
  constructor(options = {}) {
    this.options = options
    this.db = options.db ?? 'sqlite'
    this.noRateLimit = options.noRateLimit ?? false
    this.noTracing = options.noTracing ?? false
    this.bunRoutes = options.bunRoutes ?? false
    this.cors = options.cors ?? null
    this.jsEmitter = new JsEmitter(options)
  }

  get isPg() { return this.db === 'postgres' }

  emitProgram(program) {
    const routes = program.declarations.filter(d => d.type === 'RouteDecl')
    const schemas = program.declarations.filter(d => d.type === 'ModelDecl')
    const jobs = program.declarations.filter(d => d.type === 'JobDecl')
    const hasAuth = routes.some(r => r.annotations?.includes('@auth'))

    if (routes.length === 0 && schemas.length === 0) return ''

    const parts = []

    parts.push(this.emitPreamble(schemas))
    if (hasAuth) parts.push(emitAuthPreamble(this.options.auth ?? {}))

    // Queue + email always emitted (tiny, zero deps)
    parts.push(emitQueuePreamble())
    parts.push(emitEmailPreamble())

    if (this.isPg && schemas.length > 0) {
      // PG: emit a single awaited startup block — prevents fire-and-forget race and
      // globalThis.db overwrite if multiple schemas' IIFEs run concurrently
      parts.push(this.emitPgSchemaInit(schemas))
    } else {
      for (const schema of schemas) {
        parts.push(this.emitModelHelpers(schema))
      }
      if (schemas.length > 0) parts.push('const db = globalThis.db')
    }

    for (const job of jobs) {
      parts.push(this.emitJobHandler(job))
      // Public enqueue wrapper: `const SendEmail = (...args) => Queue.enqueue(_job_SendEmail, ...args)`
      parts.push(emitJobEnqueueWrapper(job.name))
    }

    for (const route of routes) {
      parts.push(this.emitRouteHandler(route))
    }

    const routeSpecs = routes.map(r => ({
      method: r.method,
      path: r.path,
      handlerName: routeHandlerName(r),
    }))

    if (this.bunRoutes) {
      // Build map of handlerName → staticConstName for sync wrapper optimization (Item 4)
      const staticHandlers = new Map()
      for (const route of routes) {
        const info = this._staticResponseConst(route)
        if (info && !route.annotations?.find(a => a === '@auth' || a.startsWith('@auth('))) {
          staticHandlers.set(routeHandlerName(route), info.constName)
        }
      }
      parts.push(emitBunRoutesObject(routeSpecs, { noRateLimit: this.noRateLimit, noTracing: this.noTracing, staticHandlers }))
    } else {
      parts.push(compileRoutes(routeSpecs))
    }

    parts.push(this.emitBunServe(routes, schemas))

    return parts.filter(Boolean).join('\n\n')
  }

  // ── Preamble ─────────────────────────────────────────────────────────────────

  emitPreamble(schemas) {
    const hasDb = schemas.length > 0
    const dbSetup = hasDb ? (this.isPg ? this._pgSetup() : this._sqliteSetup()) : ''

    const rateLimiter = this.noRateLimit ? '' : `

// In-memory rate limiter — 60 POST requests per IP per minute (sliding window)
// Applies to all mutating requests. Resets hourly to prevent unbounded Map growth.
// Set TRUSTED_PROXY_IPS (comma-separated) to opt-in to X-Forwarded-For trust.
// Without it, X-Forwarded-For is ignored to prevent IP spoofing.
const _rlMap = new Map()
const _TRUSTED_PROXIES = process.env.TRUSTED_PROXY_IPS
  ? new Set(process.env.TRUSTED_PROXY_IPS.split(',').map(s => s.trim()).filter(Boolean))
  : null
setInterval(() => _rlMap.clear(), 60 * 60 * 1000).unref()
function _checkRateLimit(req) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE' && req.method !== 'PATCH') return null
  const xff = req.headers.get('x-forwarded-for')
  // Use the rightmost non-trusted IP from XFF: the leftmost entry is client-controlled and
  // can be spoofed; the correct client IP when behind trusted proxies is the rightmost entry
  // that is NOT in the trusted proxy set.
  // Without trusted proxies configured, all client-supplied IP headers (x-forwarded-for,
  // x-real-ip) are spoofable — fall back to 'unknown' so the limiter applies globally.
  const ip = (_TRUSTED_PROXIES && xff)
    ? (xff.split(',').map(s => s.trim()).reverse().find(i => !_TRUSTED_PROXIES.has(i)) ?? xff.split(',')[0].trim())
    : 'unknown'
  const now = Date.now()
  const window = 60000
  let entry = _rlMap.get(ip)
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + window }
  entry.count++
  _rlMap.set(ip, entry)
  if (entry.count > 60) return _json({ error: 'Too many requests' }, 429, { 'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)) })
  return null
}`

    const corsDecl = `const _CORS_ORIGIN = ${this.cors ? JSON.stringify(this.cors) : 'null'}`
    return `
// Generated by Arc compiler — do not edit
'use strict'
${dbSetup}
${corsDecl}
${SHARED_RESPONSE_HELPERS}
${rateLimiter}`.trim()
  }

  _sqliteSetup() {
    return `
const { Database } = require('bun:sqlite')
let _db
try {
  _db = new Database(process.env.DATABASE_URL ?? 'app.db', { create: true })
  _db.run('PRAGMA journal_mode = WAL')
  _db.run('PRAGMA synchronous = normal')
} catch (_dbInitErr) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'db_init_failed', msg: _dbInitErr?.message ?? String(_dbInitErr) }))
  process.exit(1)
}
`
  }

  _pgSetup() {
    return `
const { Pool } = require('pg')
const _pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://localhost/app', max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 })
const _db = {
  run: async (sql, params = []) => { await _pool.query(sql, params) },
  query: (sql) => ({ all: async (params = []) => (await _pool.query(sql, params)).rows,
                     get: async (params = []) => (await _pool.query(sql, params)).rows[0] ?? null,
                     run: async (params = []) => { await _pool.query(sql, params) } })
}
`
  }

  // ── Schema helpers ────────────────────────────────────────────────────────────

  emitModelHelpers(schema) {
    const name = schema.name
    if (!_SAFE_IDENT.test(name)) throw new Error(`Arc codegen: unsafe schema name: ${JSON.stringify(name)}`)
    if (this.isPg) throw new Error('Arc codegen: isPg schemas must use emitPgSchemaInit, not emitModelHelpers')
    return this._emitModelHelpersSqlite(schema)
  }

  _emitModelHelpersSqlite(schema) {
    const { lc, fields, colList, colDefs } = this._schemaVars(schema, 'sqlite')
    const placeholders = fields.map((_, i) => `?${i + 1}`).join(', ')
    const updates = fields.map((f, i) => `${f.name} = ?${i + 1}`).join(', ')
    const selectCols = colList ? `id, ${colList}` : 'id'

    const fieldNames = JSON.stringify(fields.map(f => f.name))
    return `
// Schema: ${schema.name}
_db.run(\`CREATE TABLE IF NOT EXISTS ${lc} (${colDefs})\`)

const _q_${lc}_findMany = _db.query('SELECT ${selectCols} FROM ${lc} LIMIT ?1 OFFSET ?2')
const _q_${lc}_find = _db.query('SELECT ${selectCols} FROM ${lc} WHERE id = ?1')
${colList ? `const _q_${lc}_create = _db.query('INSERT INTO ${lc} (${colList}) VALUES (${placeholders}) RETURNING *')` : ''}
${colList ? `const _q_${lc}_update = _db.query('UPDATE ${lc} SET ${updates} WHERE id = ?${fields.length + 1} RETURNING *')` : ''}
const _q_${lc}_delete = _db.query('DELETE FROM ${lc} WHERE id = ?1')
const _q_${lc}_count = _db.query('SELECT COUNT(*) as count FROM ${lc}')
const _${lc}_fields = ${fieldNames}

Object.assign(globalThis.db ?? (globalThis.db = {}), {
  ${lc}: {
    findMany: (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _q_${lc}_findMany.all(Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0)
      const _fs = new Set(_${lc}_fields)
      const _cl = Object.keys(_w).map(k => { if (!_fs.has(k)) throw new Error(\`${lc}.findMany: unknown field: \${k}\`); return \`\${k} = ?\` })
      return _db.query(\`SELECT ${selectCols} FROM ${lc} WHERE \${_cl.join(' AND ')} LIMIT ? OFFSET ?\`).all(...Object.values(_w), Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0)
    },
    findFirst: (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _q_${lc}_findMany.all(1, 0)[0] ?? null
      const _fs = new Set(_${lc}_fields)
      const _cl = Object.keys(_w).map(k => { if (!_fs.has(k)) throw new Error(\`${lc}.findFirst: unknown field: \${k}\`); return \`\${k} = ?\` })
      return _db.query(\`SELECT ${selectCols} FROM ${lc} WHERE \${_cl.join(' AND ')} LIMIT 1\`).get(...Object.values(_w)) ?? null
    },
    findUnique: (opts = {}) => {
      const _w = opts?.where; if (!_w) throw new Error('${lc}.findUnique: where is required')
      const _fs = new Set(_${lc}_fields)
      const _cl = Object.keys(_w).map(k => { if (!_fs.has(k)) throw new Error(\`${lc}.findUnique: unknown field: \${k}\`); return \`\${k} = ?\` })
      const _rs = _db.query(\`SELECT ${selectCols} FROM ${lc} WHERE \${_cl.join(' AND ')} LIMIT 2\`).all(...Object.values(_w))
      if (_rs.length > 1) throw Object.assign(new Error('${lc}.findUnique: multiple rows'), { status: 400 })
      return _rs[0] ?? null
    },
    find: (id) => _q_${lc}_find.get(id) ?? null,
    ${colList ? `create: (data) => { const _d = _pick(data, _${lc}_fields); return _q_${lc}_create.get(${fields.map(f => `_d.${f.name}`).join(', ')}) },` : ''}
    ${colList ? `update: (id, data) => { const _d = _pick(data, _${lc}_fields); return _q_${lc}_update.get(${fields.map(f => `_d.${f.name}`).join(', ')}, id) },` : ''}
    delete: (id) => (_q_${lc}_delete.run(id), true),
    count: () => _q_${lc}_count.get()?.count ?? 0,
  }
})`.trim()
  }

  // Emit a single awaited async startup block for all PG schemas.
  // Keeps CREATE TABLE in sequence (no concurrent-IIFE race) and assembles globalThis.db once.
  emitPgSchemaInit(schemas) {
    const tableInits = schemas.map(schema => {
      const { lc, colDefs } = this._schemaVars(schema, 'postgres')
      return `  await _db.run(\`CREATE TABLE IF NOT EXISTS ${lc} (${colDefs})\`)`
    }).join('\n')

    const dbEntries = schemas.map(schema => {
      const { lc, fields, colList } = this._schemaVars(schema, 'postgres')
      const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')
      const updates = fields.map((f, i) => `${f.name} = $${i + 1}`).join(', ')
      const selectCols = colList ? `id, ${colList}` : 'id'
      const fieldNames = JSON.stringify(fields.map(f => f.name))
      return `  ${lc}: (() => { const _flds = ${fieldNames}; return {
    findMany: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT ${selectCols} FROM ${lc} LIMIT $1 OFFSET $2', [Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0]).then(r => r.rows)
      const _fs = new Set(_flds); const _ks = Object.keys(_w)
      const _cl = _ks.map((k, i) => { if (!_fs.has(k)) throw new Error(\`${lc}.findMany: unknown field: \${k}\`); return \`\${k} = $\${i+1}\` })
      return _pool.query(\`SELECT ${selectCols} FROM ${lc} WHERE \${_cl.join(' AND ')} LIMIT $\${_ks.length+1} OFFSET $\${_ks.length+2}\`, [...Object.values(_w), Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0]).then(r => r.rows)
    },
    findFirst: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT ${selectCols} FROM ${lc} LIMIT 1 OFFSET 0').then(r => r.rows[0] ?? null)
      const _fs = new Set(_flds); const _ks = Object.keys(_w)
      const _cl = _ks.map((k, i) => { if (!_fs.has(k)) throw new Error(\`${lc}.findFirst: unknown field: \${k}\`); return \`\${k} = $\${i+1}\` })
      return _pool.query(\`SELECT ${selectCols} FROM ${lc} WHERE \${_cl.join(' AND ')} LIMIT 1\`, Object.values(_w)).then(r => r.rows[0] ?? null)
    },
    findUnique: async (opts = {}) => {
      const _w = opts?.where; if (!_w) throw new Error('${lc}.findUnique: where is required')
      const _fs = new Set(_flds); const _ks = Object.keys(_w)
      const _cl = _ks.map((k, i) => { if (!_fs.has(k)) throw new Error(\`${lc}.findUnique: unknown field: \${k}\`); return \`\${k} = $\${i+1}\` })
      const _rs = await _pool.query(\`SELECT ${selectCols} FROM ${lc} WHERE \${_cl.join(' AND ')} LIMIT 2\`, Object.values(_w)).then(r => r.rows)
      if (_rs.length > 1) throw Object.assign(new Error('${lc}.findUnique: multiple rows'), { status: 400 })
      return _rs[0] ?? null
    },
    find: async (id) => _pool.query('SELECT ${selectCols} FROM ${lc} WHERE id = $1', [id]).then(r => r.rows[0] ?? null),
    ${colList ? `create: async (data) => { const _d = _pick(data, _flds); return _pool.query('INSERT INTO ${lc} (${colList}) VALUES (${placeholders}) RETURNING *', [${fields.map(f => `_d.${f.name}`).join(', ')}]).then(r => r.rows[0]) },` : ''}
    ${colList ? `update: async (id, data) => { const _d = _pick(data, _flds); return _pool.query('UPDATE ${lc} SET ${updates} WHERE id = $${fields.length + 1} RETURNING *', [${fields.map(f => `_d.${f.name}`).join(', ')}, id]).then(r => r.rows[0]) },` : ''}
    delete: async (id) => { await _pool.query('DELETE FROM ${lc} WHERE id = $1', [id]); return true },
    count: async () => _pool.query('SELECT COUNT(*) as count FROM ${lc}').then(r => +r.rows[0].count),
  }})(),`
    }).join('\n')

    return `
// Schema init — promise-based startup; awaited in Bun.serve fetch handler before first dispatch
// (top-level await is invalid in CJS; this pattern is equivalent and CJS-safe)
let db = null
let _schemaInitErr = null
const _schemaInitP = (async () => {
${tableInits}
  db = globalThis.db = {
${dbEntries}
  }
})().catch(e => {
  // Set _schemaInitErr BEFORE process.exit so the guard in the fetch handler works
  // if exit is deferred (e.g., in test environments that mock process.exit).
  _schemaInitErr = e
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'schema_init_failed', msg: e?.message ?? String(e), cause: e?.cause?.message }))
  process.exit(1)
})`.trim()
  }

  _schemaVars(schema, dialect) {
    const lc = schema.name.toLowerCase() + 's'
    const fields = (schema.fields ?? []).filter(f => f.name && !f.decorators?.includes('@id'))
    for (const f of fields) {
      if (!_SAFE_IDENT.test(f.name)) throw new Error(`Arc codegen: unsafe field name: ${JSON.stringify(f.name)}`)
    }
    const colList = fields.map(f => f.name).join(', ')
    const idDef = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
    const colDefs = [
      `id ${idDef}`,
      ...fields.map(f => {
        const rawType = f.typeAnnotation?.name ?? ''
        const isOptional = f.typeAnnotation?.nullable === true || rawType.endsWith('?') || f.optional === true
        const sqlType = _arcTypeToSql(rawType.replace(/\?$/, ''), dialect)
        const notNull = isOptional ? '' : ' NOT NULL'
        const unique = f.decorators?.includes('@unique') ? ' UNIQUE' : ''
        const defaultVal = this._fieldDefaultSql(f, dialect)
        return `${f.name} ${sqlType}${notNull}${defaultVal}${unique}`
      })
    ].join(', ')
    return { lc, fields, colList, colDefs }
  }

  _fieldDefaultSql(field, dialect) {
    const node = field.init
    if (!node || node.type !== 'Literal') return ''
    const v = node.value
    if (v === null || v === undefined) return ' DEFAULT NULL'
    if (typeof v === 'boolean') {
      return dialect === 'postgres' ? ` DEFAULT ${v}` : ` DEFAULT ${v ? 1 : 0}`
    }
    if (typeof v === 'number') return ` DEFAULT ${v}`
    if (typeof v === 'string') return ` DEFAULT ${JSON.stringify(v).replace(/"/g, "'")}`
    return ''
  }

  // ── Job handlers ──────────────────────────────────────────────────────────────

  emitJobHandler(job) {
    if (!_SAFE_IDENT.test(job.name)) throw new Error(`Arc codegen: unsafe job name: ${JSON.stringify(job.name)}`)
    const params = (job.params ?? []).map(p => p.name).join(', ')
    const body = job.body?.type === 'BlockStatement'
      ? emitRouteBody(job.body.body, this.jsEmitter)
      : ''
    return `
// Job: ${job.name}
async function _job_${job.name}(${params}) {
  ${body}
}`.trim()
  }

  // ── Route handlers ────────────────────────────────────────────────────────────

  // Returns { constName, callee } if this route can be pre-serialized as a static Response,
  // otherwise null. Handles json(), html(), and text() callees.
  _staticResponseConst(route) {
    const stmts = route.body?.body
    if (!stmts || stmts.length !== 1) return null
    const stmt = stmts[0]
    if (stmt.type !== 'ExprStatement') return null
    const expr = stmt.expr ?? stmt.expression
    if (expr?.type !== 'CallExpr') return null
    const callee = expr.callee
    if (callee?.type !== 'Identifier') return null
    if (!['json', 'html', 'text'].includes(callee.name)) return null
    const arg = expr.args?.[0]
    if (!arg) return null
    if (!this._isPureLiteral(arg)) return null
    if (route.method?.toUpperCase() !== 'GET') return null
    return { constName: `_STATIC_${routeHandlerName(route)}`, callee: callee.name }
  }

  // Collect all Identifier names referenced anywhere in an AST node array.
  _collectRefs(nodes) {
    const refs = new Set()
    function walk(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'Identifier') refs.add(node.name)
      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') walk(v)
      }
    }
    nodes.forEach(walk)
    return refs
  }

  _isPureLiteral(node) {
    if (!node || typeof node !== 'object') return true
    if (Array.isArray(node)) return node.every(n => this._isPureLiteral(n))
    const t = node.type
    if (t === 'Identifier' || t === 'MemberExpr' || t === 'CallExpr' || t === 'AwaitExpr' || t === 'SpreadExpr') return false
    if (t === 'Literal') return true
    // ObjectLiteral: only check property values, not keys (keys are always strings/names)
    if (t === 'ObjectLiteral') {
      return (node.properties ?? []).every(p => this._isPureLiteral(p.value))
    }
    if (t === 'ArrayLiteral') {
      return (node.elements ?? []).every(e => this._isPureLiteral(e))
    }
    return false
  }

  // Evaluate a pure-literal AST node to a JS value (for pre-serialization).
  _evalLiteral(node) {
    if (!node) return null
    if (node.type === 'Literal') return node.value
    if (node.type === 'ArrayLiteral') return (node.elements ?? []).map(e => this._evalLiteral(e))
    if (node.type === 'ObjectLiteral') {
      const obj = {}
      for (const prop of (node.properties ?? [])) {
        obj[String(prop.key)] = this._evalLiteral(prop.value)
      }
      return obj
    }
    throw new Error(`Cannot statically evaluate node type: ${node.type}`)
  }

  // Detects the echo pattern: exactly 2 statements —
  //   const <name> = parseBody(request)
  //   json(<name>)
  // Used to emit a raw arrayBuffer passthrough instead of parse+stringify.
  _isEchoPattern(route) {
    const stmts = route.body?.body
    if (!stmts || stmts.length !== 2) return false
    const [s0, s1] = stmts
    // First stmt: const <varName> = parseBody(request)
    if (s0.type !== 'VarDecl') return false
    const init = s0.init
    if (init?.type !== 'CallExpr') return false
    if (init.callee?.type !== 'Identifier' || init.callee.name !== 'parseBody') return false
    if (init.args?.length !== 1) return false
    if (init.args[0]?.type !== 'Identifier' || init.args[0].name !== 'request') return false
    const varName = s0.name
    // Second stmt: json(<varName>)
    if (s1.type !== 'ExprStatement') return false
    const expr = s1.expr ?? s1.expression
    if (expr?.type !== 'CallExpr') return false
    if (expr.callee?.type !== 'Identifier' || expr.callee.name !== 'json') return false
    if (expr.args?.length !== 1) return false
    if (expr.args[0]?.type !== 'Identifier' || expr.args[0].name !== varName) return false
    return true
  }

  emitRouteHandler(route) {
    const name = routeHandlerName(route)
    const pathParams = (route.params ?? []).map(p => `const ${p} = params['${p}']`).join('\n    ')

    // Item 11: RBAC — parse optional role from @auth(role)
    const authAnnotation = route.annotations?.find(a => a === '@auth' || a.startsWith('@auth('))
    const requiresAuth = !!authAnnotation
    let authRole = null
    if (authAnnotation) {
      const roleMatch = authAnnotation.match(/^@auth\(([^)]+)\)$/)
      if (roleMatch) authRole = roleMatch[1].trim()
    }

    const traceDecl = this.noTracing ? '' : 'const _traceId = req._traceId\n    '
    const traceLog = this.noTracing
      ? `console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', method: '${route.method}', path: '${route.path}', msg: _e?.message ?? String(_e), stack: _e?.stack }))`
      : `console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', traceId: _traceId, method: '${route.method}', path: '${route.path}', msg: _e?.message ?? String(_e), stack: _e?.stack }))`

    // Item 6: pre-serialize static json/html/text GET routes
    const staticInfo = this._staticResponseConst(route)
    if (staticInfo && !requiresAuth) {
      const { constName, callee: calleeName } = staticInfo
      const arg = route.body.body[0].expr?.args?.[0] ?? route.body.body[0].expression?.args?.[0]
      try {
        const value = this._evalLiteral(arg)
        let responseExpr
        if (calleeName === 'json') {
          responseExpr = `new Response(${JSON.stringify(JSON.stringify(value))}, { headers: _HEADERS_JSON })`
        } else if (calleeName === 'html') {
          responseExpr = `new Response(${JSON.stringify(String(value))}, { headers: _HEADERS_HTML })`
        } else {
          responseExpr = `new Response(${JSON.stringify(String(value))}, { headers: _HEADERS_TEXT })`
        }
        return `
// Route: ${route.method} ${route.path} [static]
const ${constName} = ${responseExpr}
function ${name}(req, params) { return ${constName} }`.trim()
      } catch {
        // Fall through to normal handler if literal evaluation fails
      }
    }

    // Echo fast path: `const body = parseBody(request); json(body)` → raw arrayBuffer passthrough
    if (!requiresAuth && this._isEchoPattern(route)) {
      return `
// Route: ${route.method} ${route.path} [echo]
async function ${name}(req, params) {
  const _len = +(req.headers.get('content-length') ?? 0)
  if (_len > _MAX_BODY_SIZE) return _json({ error: 'Request body too large' }, 413)
  return new Response(await req.arrayBuffer(), { headers: _HEADERS_JSON })
}`.trim()
    }

    const body = route.body?.type === 'BlockStatement'
      ? emitRouteBody(route.body.body, this.jsEmitter)
      : ''

    // Item 11: RBAC auth guard
    let authGuard = ''
    if (requiresAuth) {
      authGuard = `const _sess = await auth.session(req); if (!_sess) return _json({ error: 'Unauthorized' }, 401);\n    const session = _sess;`
      if (authRole) authGuard += `\n    if (session.role !== ${JSON.stringify(authRole)}) return _json({ error: 'Forbidden' }, 403);`
    }

    // Item 5: only emit aliases that are actually referenced in the route body
    const refs = this._collectRefs(route.body?.body ?? [])
    const aliases = []
    if (refs.has('json')) aliases.push('const json = _json')
    if (refs.has('html')) aliases.push('const html = _html')
    if (refs.has('text')) aliases.push('const text = _text')
    if (refs.has('redirect')) aliases.push('const redirect = _redirect')
    if (refs.has('parseBody')) aliases.push('const parseBody = _parseBody')
    if (refs.has('request')) aliases.push('const request = req')
    const aliasBlock = aliases.length > 0 ? aliases.join('\n    ') + '\n    ' : ''

    return `
// Route: ${route.method} ${route.path}${requiresAuth ? ` [auth${authRole ? `:${authRole}` : ''}]` : ''}
async function ${name}(req, params) {
  ${traceDecl}try {
    ${pathParams ? pathParams + '\n    ' : ''}${authGuard ? authGuard + '\n    ' : ''}${aliasBlock}${body}
  } catch (_e) {
    if (_e?._authError) return _json({ error: 'Unauthorized' }, 401)
    if (_e?.status === 413) return _json({ error: 'Request body too large' }, 413)
    if (_e?.status === 400) return _json({ error: _e.message ?? 'Bad request' }, 400)
    ${traceLog}
    return _json({ error: 'Internal server error' }, 500)
  }
}`.trim()
  }

  // ── Bun.serve() entry ─────────────────────────────────────────────────────────

  _routeTypeLabel(route) {
    const stmts = route.body?.body
    if (!stmts) return 'handler'
    if (stmts.length === 1) {
      const s = stmts[0]
      const e = s.type === 'ExprStatement' ? (s.expr ?? s.expression) : null
      if (e?.type === 'CallExpr' && (e.callee?.name === 'json' || e.callee?.name === 'html') && e.args?.length === 1) {
        const a = e.args[0]
        if (a.type === 'StringLiteral' || a.type === 'NumberLiteral' || a.type === 'ObjectLiteral' || a.type === 'ArrayLiteral' || a.type === 'ObjectExpr' || a.type === 'ArrayExpr') return 'static'
      }
    }
    if (stmts.length === 2) {
      const [s0, s1] = stmts
      if (s0.type === 'VarDecl' && s0.init?.type === 'CallExpr' && s0.init.callee?.name === 'parseBody') {
        const e = s1.expr ?? s1.expression
        if (e?.type === 'CallExpr' && e.callee?.name === 'json' && e.args?.[0]?.name === s0.name) return 'echo'
      }
    }
    return 'handler'
  }

  emitBunServe(routes, schemas) {
    const port = '+(process.env.PORT ?? 3000)'
    const hasAuth = routes.some(r => r.annotations?.find(a => a === '@auth' || a.startsWith('@auth(')))
    const hasDb = schemas && schemas.length > 0
    const dbProbe = hasDb
      ? (this.isPg
        ? `let _dbOk=false;try{await Promise.race([_pool.query('SELECT 1'),new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),2000))]);_dbOk=true}catch{}`
        : `let _dbOk=false;try{_db.query('SELECT 1').get();_dbOk=true}catch{}`)
      : ''
    const healthBody = hasDb
      ? `${dbProbe}\n    return _json({ status: _dbOk ? 'ok' : 'degraded', db: _dbOk ? 'up' : 'down', uptime: process.uptime(), version: process.env.npm_package_version ?? 'unknown', ts: new Date().toISOString() }, _dbOk ? 200 : 503, { 'Cache-Control': 'no-store, no-cache' })`
      : `return _json({ status: 'ok', uptime: process.uptime(), queue: typeof Queue !== 'undefined' ? 'configured' : 'n/a', version: process.env.npm_package_version ?? 'unknown', ts: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store, no-cache' })`
    const dbLabel = this.isPg ? 'postgres' : (hasDb ? 'sqlite' : 'none')
    const dbDisplayLabel = this.isPg ? 'PostgreSQL' : (hasDb ? 'SQLite (local)' : null)

    // Build compile-time route table string
    const allRouteRows = routes.map(r => {
      const method = (r.method ?? 'GET').toUpperCase()
      const rpath = r.path ?? '/'
      const type = this._routeTypeLabel(r)
      return { method, path: rpath, type }
    })
    allRouteRows.push({ method: 'GET', path: '/health', type: 'built-in' })
    const maxPath = Math.max(...allRouteRows.map(r => r.path.length), 6)
    const routeTableStr = allRouteRows.map(r =>
      `  ${r.method.padEnd(6)}  ${r.path.padEnd(maxPath)}  ${r.type}`
    ).join('\\n')

    const bannerFn = `
function _printBanner(port) {
  if (process.stdout.isTTY && !process.env.NO_COLOR) {
    const C = '\\x1b[36m', G = '\\x1b[32m', D = '\\x1b[2m', R = '\\x1b[0m'
    process.stdout.write('\\n  ' + C + '⚡ arc server' + R + '\\n\\n')
    process.stdout.write('  ●  http://localhost:' + port + '\\n')
    ${dbDisplayLabel ? `process.stdout.write('  ◆  ' + D + '${dbDisplayLabel}' + R + '\\n')` : ''}
    process.stdout.write('\\n')
    const rows = ${JSON.stringify(routeTableStr)}.split('\\\\n')
    for (const row of rows) process.stdout.write(D + row + R + '\\n')
    process.stdout.write('\\n')
  } else {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'arc: server started', port, db: '${dbLabel}' }))
  }
}`
    const traceSetup = this.noTracing ? '' : `
    const _clientId = req.headers.get('x-request-id') ?? ''
    req._traceId = _TRACE_ID_RE.test(_clientId) ? _clientId : crypto.randomUUID().slice(0, 8)`

    const traceHoist = this.noTracing ? '' : `
// Hoisted: avoids per-request RegExp allocation at high request rates
const _TRACE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/`

    const rlCheck = this.noRateLimit ? '' : `
    const _rl = _checkRateLimit(req)
    if (_rl) return _rl`

    const pgGuard = (this.isPg && schemas && schemas.length > 0)
      ? `\n    if (db === null) { if (_schemaInitErr) return _json({ error: 'Server initialization failed — check logs' }, 503, { 'Retry-After': '5' }); await _schemaInitP; if (db === null) return _json({ error: 'Server initialization failed — check logs' }, 503, { 'Retry-After': '5' }) }`
      : ''

    // Item 12: startup env-var validation
    const envChecks = []
    if (hasAuth) {
      envChecks.push(`if (!process.env.SESSION_SECRET) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'arc: SESSION_SECRET env var is required when @auth routes are present' })); process.exit(1) }`)
    }
    const envBlock = envChecks.length > 0 ? envChecks.join('\n') + '\n\n' : ''

    // Item 9: CORS preflight response (lean server only — bun-routes handles it per-route)
    const corsOriginLiteral = this.cors ? JSON.stringify(this.cors) : null
    const corsOptionsHandler = corsOriginLiteral ? `
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': ${corsOriginLiteral}, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } })
    }` : ''

    if (this.bunRoutes) {
      // Bun routes object mode: routing is handled in native C++ by Bun
      // Rate limit and tracing are inlined per handler, not needed here
      return `
${traceHoist}

${bannerFn}

${envBlock}// Start Bun server (native routes object — C++ routing, fastest path)
const _server = Bun.serve({
  port: ${port},
  error(err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] unhandled server error', error: err?.message ?? String(err) }))
    return _json({ error: 'Internal server error' }, 500)
  },
  ..._arcRoutes,
})
_printBanner(_server.port)
`.trim()
    }

    return `
${traceHoist}

${bannerFn}

${envBlock}// Start Bun server
const _server = Bun.serve({
  port: ${port},
  fetch(req) {
    ${traceSetup.trim() ? traceSetup.trim() + '\n    ' : ''}// Fast pathname extraction — avoids full URL parse (new URL() overhead)
    const _u = req.url
    const _s = _u.indexOf('/', 8)
    const _q = _u.indexOf('?', _s > -1 ? _s : 8)
    const _pathname = _u.slice(_s > -1 ? _s : _u.length, _q > -1 ? _q : undefined) || '/'
    if (_pathname === '/health') {
      try {
    ${healthBody}
      } catch (_he) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'health_check_error', msg: _he?.message ?? String(_he) })); return _json({ status: 'error' }, 503, { 'Cache-Control': 'no-store, no-cache' }) }
    }
    ${corsOptionsHandler.trim() ? corsOptionsHandler.trim() + '\n    ' : ''}${pgGuard.trim()}
    ${rlCheck.trim()}
    return _dispatch(req, _pathname)
  }
})
_printBanner(_server.port)
`.trim()
  }
}

module.exports = { BunServerEmitter }
