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
const { routeHandlerName, isValidRoute } = require('./route-utils')
const { SHARED_RESPONSE_HELPERS } = require('./emitter-preamble')
const { emitRouteBody, emitCatchBlock } = require('./route-body-emitter')
const { profilerPreamble, profilerDbWrapper } = require('../profiler/hooks')

const _SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

// Flatten RouteGroupDecl nodes into RouteDecl[], prepending prefix and
// tagging each route with a _groupGuardFn so a shared guard is used instead
// of inlining the auth check N times (~95% less emitted JS for auth logic).
function flattenGroups(declarations) {
  const routes = []
  for (const d of declarations) {
    if (d.type === 'RouteDecl' && isValidRoute(d)) {
      routes.push(d)
    } else if (d.type === 'RouteGroupDecl') {
      const slug = d.prefix.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'root'
      const hasGroupAuth = d.annotations?.some(a => a === '@auth' || a.startsWith('@auth('))
      const guardFn = hasGroupAuth ? `_guard_${slug}` : null
      for (const route of d.routes) {
        const path = d.prefix.replace(/\/$/, '') + route.path
        const params = (path.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g) ?? []).map(p => p.slice(1))
        routes.push({
          ...route,
          path,
          params,
          annotations: [...(d.annotations ?? []), ...(route.annotations ?? [])],
          _groupGuardFn: guardFn,
          _groupAnnotations: d.annotations,
        })
      }
    }
  }
  return routes
}

// Emit a shared auth guard function for a route group.
// Called once per group; each handler calls _guard_xxx(req) instead of
// inlining 12 lines of auth boilerplate per route.
function emitGroupGuard(prefix, annotations) {
  const authAnn = annotations?.find(a => a === '@auth' || a.startsWith('@auth('))
  if (!authAnn) return null
  const slug = prefix.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'root'
  const name = `_guard_${slug}`
  const roleMatch = authAnn.match(/^@auth\(([^)]+)\)$/)
  const roles = roleMatch ? roleMatch[1].split(',').map(r => r.trim()).filter(Boolean) : null
  const roleCheck = roles
    ? `\n  if (!${JSON.stringify(roles)}.includes(s.role)) { const _acc = req.headers.get('accept') ?? ''; return _acc.includes('application/json') ? _json({ error: 'Forbidden' }, 403) : Response.redirect('/admin/login', 302) }`
    : ''
  return `async function ${name}(req) {
  const s = await auth.session(req)
  if (!s) { const _acc = req.headers.get('accept') ?? ''; return _acc.includes('application/json') ? _json({ error: 'Unauthorized' }, 401) : Response.redirect('/admin/login', 302) }${roleCheck}
  return s
}`
}

class BunServerEmitter {
  constructor(options = {}) {
    this.options = options
    this.db = options.db ?? 'sqlite'
    this.noRateLimit = options.noRateLimit ?? false
    this.noTracing = options.noTracing ?? false
    this.bunRoutes = options.bunRoutes ?? false
    this.cors = options.cors ?? null
    this.profile = options.profile ?? false
    this.jsEmitter = new JsEmitter(options)
  }

  get isPg() { return this.db === 'postgres' }

  emitProgram(program) {
    const routes = flattenGroups(program.declarations)
    const schemas = program.declarations.filter(d => d.type === 'ModelDecl')
    const jobs = program.declarations.filter(d => d.type === 'JobDecl')
    const groups = program.declarations.filter(d => d.type === 'RouteGroupDecl')
    const hasAuth = routes.some(r => r.annotations?.find(a => a === '@auth' || a.startsWith('@auth(')))

    if (routes.length === 0 && schemas.length === 0) return ''

    const parts = []

    if (this.profile) parts.push(profilerPreamble())

    parts.push(this.emitPreamble(schemas))

    if (this.profile && !this.isPg) parts.push(profilerDbWrapper())
    if (hasAuth || this.hasMiddleware) parts.push(emitAuthPreamble(this.options.auth ?? {}))

    // Emit middleware function if server/middleware.arc was found
    if (this.hasMiddleware && this.middlewareDecls?.length > 0) {
      const handleFn = this.middlewareDecls.find(d => d.type === 'FnDecl' && d.name === 'handle')
      if (handleFn) {
        const body = handleFn.body?.type === 'BlockStatement'
          ? this.jsEmitter.emitBlock(handleFn.body.body)
          : (handleFn.body ? this.jsEmitter.emitExpr(handleFn.body) : 'return null')
        parts.push(`async function _middleware(req, pathname) {\n${body}\n}`)
      }
    }

    // Queue + email always emitted (tiny, zero deps)
    parts.push(emitQueuePreamble())
    parts.push(emitEmailPreamble())

    if (this.isPg && schemas.length > 0) {
      // PG: emit a single awaited startup block - prevents fire-and-forget race and
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

    // Emit one shared guard function per group (replaces N inline auth checks)
    const emittedGuards = new Set()
    for (const group of groups) {
      const guard = emitGroupGuard(group.prefix, group.annotations)
      if (guard) {
        const slug = group.prefix.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'root'
        if (!emittedGuards.has(slug)) {
          emittedGuards.add(slug)
          parts.push(guard)
        }
      }
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
        const staticConst = this._staticResponseConst(route)
        if (staticConst && !route.annotations?.find(a => a === '@auth' || a.startsWith('@auth('))) {
          staticHandlers.set(routeHandlerName(route), staticConst.constName)
        }
      }
      parts.push(emitBunRoutesObject(routeSpecs, { noRateLimit: this.noRateLimit, noTracing: this.noTracing, staticHandlers }))
    } else {
      parts.push(compileRoutes(routeSpecs))
    }

    parts.push(this.emitBunServe(routes, schemas, this.hasMiddleware))

    return parts.filter(Boolean).join('\n\n')
  }

  // ── Preamble ─────────────────────────────────────────────────────────────────

  emitPreamble(schemas) {
    const hasDb = schemas.length > 0
    const dbSetup = hasDb ? (this.isPg ? this._pgSetup() : this._sqliteSetup()) : ''

    const rateLimiter = this.noRateLimit ? '' : this._rateLimiterBlock()

    const corsDecl = `const _CORS_ORIGIN = ${this.cors ? JSON.stringify(this.cors) : 'null'}`
    const staticFallback = `
const _path = require('path')
const _fs = require('fs')
const _DIST_DIR = _path.dirname(require.main?.filename ?? __filename)
const _MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' }
const _UPLOAD_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' }
// SVG/PDF are user-uploaded content - force download to prevent script execution in browser origin
const _ATTACHMENT_EXTS = new Set(['.svg', '.pdf'])
// Pre-populate known static file paths at startup to avoid existsSync() on every request.
// Built lazily on first request so the process starts fast even with many dist files.
let _staticFiles = null
function _getStaticFiles() {
  if (_staticFiles) return _staticFiles
  _staticFiles = new Set()
  try {
    const _walkDir = (dir) => {
      for (const entry of _fs.readdirSync(dir, { withFileTypes: true })) {
        const full = _path.join(dir, entry.name)
        if (entry.isDirectory()) _walkDir(full)
        else _staticFiles.add(full)
      }
    }
    _walkDir(_DIST_DIR)
  } catch (_e) { /* dist may not exist yet - ENOENT is expected at first build */ }
  return _staticFiles
}
// Cached path -> required role table from server/admin-roles.json (arc-cms config).
// null = no config (fall back to session-only guard).
let _adminRoles = undefined
function _getAdminRoles() {
  if (_adminRoles !== undefined) return _adminRoles
  const _p = _path.join(process.cwd(), 'server', 'admin-roles.json')
  try {
    _adminRoles = JSON.parse(_fs.readFileSync(_p, 'utf8'))
  } catch { _adminRoles = null }
  return _adminRoles
}
function _requiredRole(pathname) {
  const cfg = _getAdminRoles()
  if (!cfg) return null
  if ((cfg.exempt ?? []).includes(pathname)) return 'exempt'
  for (const rule of (cfg.rules ?? [])) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + '/')) return rule.role
  }
  return cfg.default ?? 'viewer'
}
function _roleOk(have, need) {
  if (need === 'exempt' || need == null) return true
  const ranks = { viewer: 1, editor: 2, admin: 3 }
  return (ranks[have] ?? 0) >= (ranks[need] ?? 0)
}
async function _serveStatic(req, pathname) {
  // Serve user-uploaded media from public/uploads/ with safe headers (no auth — public assets).
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const _uf = _path.join(process.cwd(), 'public', pathname)
    if (_getStaticFiles().has(_uf)) {
      const _uext = _path.extname(_uf).toLowerCase()
      const _headers = { 'Content-Type': _UPLOAD_MIME[_uext] ?? 'application/octet-stream' }
      if (_ATTACHMENT_EXTS.has(_uext)) _headers['Content-Disposition'] = 'attachment'
      return new Response(Bun.file(_uf), { headers: _headers })
    }
    return new Response('Not found', { status: 404 })
  }
  // Dispatch @route handlers FIRST so routes with their own @auth(...) annotations
  // run with their own auth logic. Only unmatched paths (returns 404) fall through
  // to the static-page admin guard below.
  const _r = _dispatch(req, pathname)
  if (!(_r instanceof Response) || _r.status !== 404) return _r
  // Guard unmatched /admin/* paths (these resolve to static admin HTML pages).
  // Routes that exist as @route handlers are already past us by this point.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname !== '/admin/login') {
      const _sess = await auth.session(req)
      if (!_sess) return Response.redirect('/admin/login', 302)
      const _need = _requiredRole(pathname)
      if (!_roleOk(_sess.role, _need)) return Response.redirect('/admin/403', 302)
    }
  }
  // Try dist/path.html then dist/path/index.html
  const _sf = _getStaticFiles()
  for (const _try of [pathname.replace(/\\/$/, '') + '.html', pathname.replace(/\\/$/, '') + '/index.html']) {
    const _fp = _path.join(_DIST_DIR, _try)
    if (_sf.has(_fp)) {
      const _ext = _path.extname(_fp)
      return new Response(Bun.file(_fp), { headers: { 'Content-Type': _MIME[_ext] ?? 'text/plain' } })
    }
  }
  return _r
}`
    return `
// Generated by Arc compiler - do not edit
'use strict'
${dbSetup}
${corsDecl}
${SHARED_RESPONSE_HELPERS}
${staticFallback}
${rateLimiter}`.trim()
  }

  _rateLimiterBlock() {
    return `

// In-memory rate limiter - 60 POST requests per IP per minute (sliding window)
// Applies to all mutating requests. Resets hourly to prevent unbounded Map growth.
// Set TRUSTED_PROXY_IPS (comma-separated) to opt-in to X-Forwarded-For trust.
// Without it, X-Forwarded-For is ignored to prevent IP spoofing.
const _rlMap = new Map()
const _TRUSTED_PROXIES = process.env.TRUSTED_PROXY_IPS
  ? new Set(process.env.TRUSTED_PROXY_IPS.split(',').map(s => s.trim()).filter(Boolean))
  : null
// Sweep expired entries every minute so burst-then-silent IPs don't accumulate between hourly resets
setInterval(() => { const _n = Date.now(); for (const [_k, _v] of _rlMap) if (_n > _v.resetAt) _rlMap.delete(_k) }, 60000).unref()
function _checkRateLimit(req) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE' && req.method !== 'PATCH') return null
  const xff = req.headers.get('x-forwarded-for')
  // Use the rightmost non-trusted IP from XFF: the leftmost entry is client-controlled and
  // can be spoofed; the correct client IP when behind trusted proxies is the rightmost entry
  // that is NOT in the trusted proxy set.
  // Without trusted proxies configured, all client-supplied IP headers (x-forwarded-for,
  // x-real-ip) are spoofable - fall back to 'unknown' so the limiter applies globally.
  const ip = (_TRUSTED_PROXIES && xff)
    ? (xff.split(',').map(s => s.trim()).reverse().find(i => !_TRUSTED_PROXIES.has(i)) ?? xff.split(',')[0].trim())
    : 'unknown'
  const now = Date.now()
  const _windowMs = 60000
  let entry = _rlMap.get(ip)
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + _windowMs }
  entry.count++
  _rlMap.set(ip, entry)
  if (entry.count > 60) return _json({ error: 'Too many requests' }, 429, { 'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)) })
  return null
}`
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

  _isRequiredField(f) {
    return !(f.typeAnnotation?.nullable === true || (f.typeAnnotation?.name ?? '').endsWith('?') || f.optional === true || f.init != null)
  }

  emitModelHelpers(schema) {
    const name = schema.name
    if (!_SAFE_IDENT.test(name)) throw new Error(`Arc codegen: unsafe schema name: ${JSON.stringify(name)}`)
    if (this.isPg) throw new Error('Arc codegen: isPg schemas must use emitPgSchemaInit, not emitModelHelpers')
    return this._emitModelHelpersSqlite(schema)
  }

  _emitModelHelpersSqlite(schema) {
    const { tableName, fields, colList, colDefs } = this._schemaVars(schema, 'sqlite')
    const placeholders = fields.map((_, i) => `?${i + 1}`).join(', ')
    const updates = fields.map((f, i) => `"${f.name}" = ?${i + 1}`).join(', ')
    const selectCols = colList ? `id, ${colList}` : 'id'

    const fieldNames = JSON.stringify(fields.map(f => f.name))
    const requiredFieldNames = JSON.stringify(fields.filter(f => this._isRequiredField(f)).map(f => f.name))
    return `
// Schema: ${schema.name}
_db.run(\`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs})\`)

const _q_${tableName}_findMany = _db.query('SELECT ${selectCols} FROM ${tableName} LIMIT ?1 OFFSET ?2')
const _q_${tableName}_find = _db.query('SELECT ${selectCols} FROM ${tableName} WHERE id = ?1')
${colList ? `const _q_${tableName}_create = _db.query('INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) RETURNING *')` : ''}
${colList ? `const _q_${tableName}_update = _db.query('UPDATE ${tableName} SET ${updates} WHERE id = ?${fields.length + 1} RETURNING *')` : ''}
const _q_${tableName}_delete = _db.query('DELETE FROM ${tableName} WHERE id = ?1')
const _q_${tableName}_count = _db.query('SELECT COUNT(*) as count FROM ${tableName}')
const _${tableName}_fields = ${fieldNames}
const _${tableName}_required = ${requiredFieldNames}

Object.assign(globalThis.db ?? (globalThis.db = {}), {
  ${tableName}: {
    findMany: (opts = {}) => {
      const _w = opts?.where
      const _ob = opts?.orderBy ? Object.entries(opts.orderBy).map(([k, d]) => \`"\${k}" \${d === 'desc' ? 'DESC' : 'ASC'}\`).join(', ') : null
      const _order = _ob ? \` ORDER BY \${_ob}\` : ''
      if (!_w || !Object.keys(_w).length) return _db.query(\`SELECT ${selectCols} FROM ${tableName}\${_order} LIMIT ? OFFSET ?\`).all(Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0)
      const _fs = new Set(_${tableName}_fields)
      const _cl = Object.keys(_w).map(k => { if (!_fs.has(k)) throw new Error(\`${tableName}.findMany: unknown field: \${k}\`); return \`"\${k}" = ?\` })
      return _db.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_cl.join(' AND ')}\${_order} LIMIT ? OFFSET ?\`).all(...Object.values(_w), Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0)
    },
    findFirst: (opts = {}) => {
      const _w = opts?.where
      const _ob = opts?.orderBy ? Object.entries(opts.orderBy).map(([k, d]) => \`"\${k}" \${d === 'desc' ? 'DESC' : 'ASC'}\`).join(', ') : null
      const _order = _ob ? \` ORDER BY \${_ob}\` : ''
      if (!_w || !Object.keys(_w).length) return _db.query(\`SELECT ${selectCols} FROM ${tableName}\${_order} LIMIT 1\`).get() ?? null
      const _fs = new Set(_${tableName}_fields)
      const _cl = Object.keys(_w).map(k => { if (!_fs.has(k)) throw new Error(\`${tableName}.findFirst: unknown field: \${k}\`); return \`"\${k}" = ?\` })
      return _db.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_cl.join(' AND ')}\${_order} LIMIT 1\`).get(...Object.values(_w)) ?? null
    },
    findUnique: (opts = {}) => {
      const _w = opts?.where; if (!_w) throw new Error('${tableName}.findUnique: where is required')
      const _fs = new Set(_${tableName}_fields)
      const _cl = Object.keys(_w).map(k => { if (!_fs.has(k)) throw new Error(\`${tableName}.findUnique: unknown field: \${k}\`); return \`"\${k}" = ?\` })
      const _rs = _db.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_cl.join(' AND ')} LIMIT 2\`).all(...Object.values(_w))
      if (_rs.length > 1) throw Object.assign(new Error('${tableName}.findUnique: multiple rows'), { status: 400 })
      return _rs[0] ?? null
    },
    find: (id) => _q_${tableName}_find.get(id) ?? null,
    ${colList ? `create: (data) => { const _d = _pick(data, _${tableName}_fields); const _miss = _${tableName}_required.filter(k => _d[k] == null); if (_miss.length) throw Object.assign(new Error('${tableName}.create: missing required fields: ' + _miss.join(', ')), { status: 422 }); return _q_${tableName}_create.get(${fields.map(f => `_d.${f.name}`).join(', ')}) },` : ''}
    ${colList ? `update: (id, data) => { const _d = _pick(data, _${tableName}_fields); return _q_${tableName}_update.get(${fields.map(f => `_d.${f.name}`).join(', ')}, id) },` : ''}
    delete: (id) => (_q_${tableName}_delete.run(id), true),
    count: () => _q_${tableName}_count.get()?.count ?? 0,
  }
})`.trim()
  }

  // Emit a single awaited async startup block for all PG schemas.
  // Keeps CREATE TABLE in sequence (no concurrent-IIFE race) and assembles globalThis.db once.
  emitPgSchemaInit(schemas) {
    const tableInits = schemas.map(schema => {
      const { tableName, colDefs } = this._schemaVars(schema, 'postgres')
      return `  await _db.run(\`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs})\`)`
    }).join('\n')

    const dbEntries = schemas.map(schema => {
      const { tableName, fields, colList } = this._schemaVars(schema, 'postgres')
      const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')
      const updates = fields.map((f, i) => `${f.name} = $${i + 1}`).join(', ')
      const selectCols = colList ? `id, ${colList}` : 'id'
      const fieldNames = JSON.stringify(fields.map(f => f.name))
      const requiredFieldNames = JSON.stringify(fields.filter(f => this._isRequiredField(f)).map(f => f.name))
      return `  ${tableName}: (() => { const _flds = ${fieldNames}; const _req = ${requiredFieldNames}; return {
    findMany: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT ${selectCols} FROM ${tableName} LIMIT $1 OFFSET $2', [Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0]).then(r => r.rows)
      const _fs = new Set(_flds); const _ks = Object.keys(_w)
      const _cl = _ks.map((k, i) => { if (!_fs.has(k)) throw new Error(\`${tableName}.findMany: unknown field: \${k}\`); return \`"\${k}" = $\${i+1}\` })
      return _pool.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_cl.join(' AND ')} LIMIT $\${_ks.length+1} OFFSET $\${_ks.length+2}\`, [...Object.values(_w), Math.min(opts?.limit ?? 20, 100), opts?.offset ?? 0]).then(r => r.rows)
    },
    findFirst: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT ${selectCols} FROM ${tableName} LIMIT 1 OFFSET 0').then(r => r.rows[0] ?? null)
      const _fs = new Set(_flds); const _ks = Object.keys(_w)
      const _cl = _ks.map((k, i) => { if (!_fs.has(k)) throw new Error(\`${tableName}.findFirst: unknown field: \${k}\`); return \`"\${k}" = $\${i+1}\` })
      return _pool.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_cl.join(' AND ')} LIMIT 1\`, Object.values(_w)).then(r => r.rows[0] ?? null)
    },
    findUnique: async (opts = {}) => {
      const _w = opts?.where; if (!_w) throw new Error('${tableName}.findUnique: where is required')
      const _fs = new Set(_flds); const _ks = Object.keys(_w)
      const _cl = _ks.map((k, i) => { if (!_fs.has(k)) throw new Error(\`${tableName}.findUnique: unknown field: \${k}\`); return \`\${k} = $\${i+1}\` })
      const _rs = await _pool.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_cl.join(' AND ')} LIMIT 2\`, Object.values(_w)).then(r => r.rows)
      if (_rs.length > 1) throw Object.assign(new Error('${tableName}.findUnique: multiple rows'), { status: 400 })
      return _rs[0] ?? null
    },
    find: async (id) => _pool.query('SELECT ${selectCols} FROM ${tableName} WHERE id = $1', [id]).then(r => r.rows[0] ?? null),
    ${colList ? `create: async (data) => { const _d = _pick(data, _flds); const _miss = _req.filter(k => _d[k] == null); if (_miss.length) throw Object.assign(new Error('${tableName}.create: missing required fields: ' + _miss.join(', ')), { status: 422 }); return _pool.query('INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) RETURNING *', [${fields.map(f => `_d.${f.name}`).join(', ')}]).then(r => r.rows[0]) },` : ''}
    ${colList ? `update: async (id, data) => { const _d = _pick(data, _flds); return _pool.query('UPDATE ${tableName} SET ${updates} WHERE id = $${fields.length + 1} RETURNING *', [${fields.map(f => `_d.${f.name}`).join(', ')}, id]).then(r => r.rows[0]) },` : ''}
    delete: async (id) => { await _pool.query('DELETE FROM ${tableName} WHERE id = $1', [id]); return true },
    count: async () => _pool.query('SELECT COUNT(*) as count FROM ${tableName}').then(r => +r.rows[0].count),
  }})(),`
    }).join('\n')

    return `
// Schema init - promise-based startup; awaited in Bun.serve fetch handler before first dispatch
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
    const tableName = schema.name.toLowerCase() + 's'
    const fields = (schema.fields ?? []).filter(f => f.name && !f.decorators?.includes('@id'))
    for (const f of fields) {
      if (!_SAFE_IDENT.test(f.name)) throw new Error(`Arc codegen: unsafe field name: ${JSON.stringify(f.name)}`)
    }
    // Quote all column names to handle SQL reserved words (e.g. "order", "group", "type")
    const q = n => `"${n}"`
    const colList = fields.map(f => q(f.name)).join(', ')
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
        return `${q(f.name)} ${sqlType}${notNull}${defaultVal}${unique}`
      })
    ].join(', ')
    return { tableName, fields, colList, colDefs }
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
  // Uses a targeted structural walk (known child-bearing keys) rather than
  // Object.values() to avoid allocating value arrays for every node.
  _collectRefs(nodes) {
    const refs = new Set()
    function walk(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { for (const n of node) walk(n); return }
      if (node.type === 'Identifier') { refs.add(node.name); return }
      walk(node.body)
      walk(node.left); walk(node.right)
      walk(node.test); walk(node.consequent); walk(node.alternate)
      walk(node.callee); walk(node.arguments)
      walk(node.object); walk(node.property)
      walk(node.elements); walk(node.properties)
      walk(node.value); walk(node.init)
      walk(node.expression); walk(node.declarations)
      walk(node.argument); walk(node.params)
    }
    for (const n of nodes) walk(n)
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
      const evaluated = {}
      for (const prop of (node.properties ?? [])) {
        evaluated[String(prop.key)] = this._evalLiteral(prop.value)
      }
      return evaluated
    }
    throw new Error(`Cannot statically evaluate node type: ${node.type}`)
  }

  // Detects the echo pattern: exactly 2 statements -
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

    // Item 11: RBAC - parse optional role from @auth(role)
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
    // If route belongs to a group, use the shared guard function (1 line vs 12 inline)
    const authGuard = this._emitAuthGuard(route, requiresAuth ? authAnnotation : null)

    // Item 5: only emit aliases that are actually referenced in the route body
    const refs = this._collectRefs(route.body?.body ?? [])
    const aliasBlock = this._emitAliasBlock(route, refs)

    return `
// Route: ${route.method} ${route.path}${requiresAuth ? ` [auth${authRole ? `:${authRole}` : ''}]` : ''}
async function ${name}(req, params) {
  ${traceDecl}try {
    ${pathParams ? pathParams + '\n    ' : ''}${authGuard ? authGuard + '\n    ' : ''}${aliasBlock}${body}
  ${emitCatchBlock(traceLog)}
}`.trim()
  }

  // ── Private helpers for emitRouteHandler() ────────────────────────────────────

  _emitAuthGuard(route, authAnnotation) {
    if (route._groupGuardFn) {
      return `const session = await ${route._groupGuardFn}(req); if (session instanceof Response) return session`
    }
    if (!authAnnotation) return ''
    let authRole = null
    const roleMatch = authAnnotation.match(/^@auth\(([^)]+)\)$/)
    if (roleMatch) authRole = roleMatch[1].trim()
    let authGuard = `const _sess = await auth.session(req); if (!_sess) { const _acc = req.headers.get('accept') ?? ''; return _acc.includes('application/json') ? _json({ error: 'Unauthorized' }, 401) : Response.redirect('/admin/login', 302); }\n    const session = _sess;`
    if (authRole) {
      const roles = authRole.split(',').map(r => r.trim()).filter(Boolean)
      authGuard += `\n    if (!${JSON.stringify(roles)}.includes(session.role)) { const _acc = req.headers.get('accept') ?? ''; return _acc.includes('application/json') ? _json({ error: 'Forbidden' }, 403) : Response.redirect('/admin/login', 302); }`
    }
    return authGuard
  }

  _emitAliasBlock(route, refs) {
    const aliases = []
    if (refs.has('json')) aliases.push('const json = _json')
    if (refs.has('html')) aliases.push('const html = _html')
    if (refs.has('text')) aliases.push('const text = _text')
    if (refs.has('redirect')) aliases.push('const redirect = _redirect')
    if (refs.has('parseBody')) aliases.push('const parseBody = _parseBody')
    if (refs.has('request')) aliases.push('const request = req')
    return aliases.length > 0 ? aliases.join('\n    ') + '\n    ' : ''
  }

  // ── Bun.serve() entry ─────────────────────────────────────────────────────────

  _emitHealthBody(hasDb, isPg) {
    if (!hasDb) {
      return `return _json({ status: 'ok', uptime: process.uptime(), queue: typeof Queue !== 'undefined' ? 'configured' : 'n/a', version: process.env.npm_package_version ?? 'unknown', ts: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store, no-cache' })`
    }
    const dbProbe = isPg
      ? `let _dbOk=false;try{await Promise.race([_pool.query('SELECT 1'),new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),2000))]);_dbOk=true}catch(_dbProbeErr){console.error(JSON.stringify({ts:new Date().toISOString(),level:'warn',event:'health_db_probe_failed',msg:_dbProbeErr?.message??String(_dbProbeErr)}))}`
      : `let _dbOk=false;try{_db.query('SELECT 1').get();_dbOk=true}catch(_dbProbeErr){console.error(JSON.stringify({ts:new Date().toISOString(),level:'warn',event:'health_db_probe_failed',msg:_dbProbeErr?.message??String(_dbProbeErr)}))}`
    return `${dbProbe}\n    return _json({ status: _dbOk ? 'ok' : 'degraded', db: _dbOk ? 'up' : 'down', uptime: process.uptime(), version: process.env.npm_package_version ?? 'unknown', ts: new Date().toISOString() }, _dbOk ? 200 : 503, { 'Cache-Control': 'no-store, no-cache' })`
  }

  _emitTraceSetup(noTracing) {
    if (noTracing) return ''
    return `
    const _clientId = req.headers.get('x-request-id') ?? ''
    req._traceId = _TRACE_ID_RE.test(_clientId) ? _clientId : crypto.randomUUID().slice(0, 8)`
  }

  _emitCorsHandler(cors) {
    if (!cors) return ''
    const corsOriginLiteral = JSON.stringify(cors)
    return `
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': ${corsOriginLiteral}, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } })
    }`
  }

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

  _buildRouteTable(routes) {
    const rows = routes.map(r => ({
      method: (r.method ?? 'GET').toUpperCase(),
      path: r.path ?? '/',
      type: this._routeTypeLabel(r),
    }))
    rows.push({ method: 'GET', path: '/health', type: 'built-in' })
    const maxPath = Math.max(...rows.map(r => r.path.length), 6)
    return rows.map(r => `  ${r.method.padEnd(6)}  ${r.path.padEnd(maxPath)}  ${r.type}`).join('\\n')
  }

  _buildBannerFn(routeTableStr, dbDisplayLabel, dbLabel) {
    return `
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
  }

  emitBunServe(routes, schemas, hasMiddleware = false) {
    const port = '+(process.env.PORT ?? 3000)'
    const hasAuth = routes.some(r => r.annotations?.find(a => a === '@auth' || a.startsWith('@auth(')))
    const hasDb = schemas && schemas.length > 0
    const healthBody = this._emitHealthBody(hasDb, this.isPg)
    const dbLabel = this.isPg ? 'postgres' : (hasDb ? 'sqlite' : 'none')
    const dbDisplayLabel = this.isPg ? 'PostgreSQL' : (hasDb ? 'SQLite (local)' : null)

    const routeTableStr = this._buildRouteTable(routes)
    const bannerFn = this._buildBannerFn(routeTableStr, dbDisplayLabel, dbLabel)
    const traceSetup = this._emitTraceSetup(this.noTracing)

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

    // Item 9: CORS preflight response (lean server only - bun-routes handles it per-route)
    const corsOptionsHandler = this._emitCorsHandler(this.cors)

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

    const profilerRouteCheck = this.profile
      ? `\n    if (_pathname.startsWith('/_arc/profiler')) return _arc_p_handle(req, _pathname)`
      : ''

    const dispatchCall = this.profile
      ? `const _arc_p_t0 = performance.now()
    const _arc_p_store = { queries: [], ts: Date.now() }
    const _arc_p_resp = await _arc_p_als.run(_arc_p_store, async () => _dispatch(req, _pathname))
    const _arc_p_total = +(performance.now() - _arc_p_t0).toFixed(3)
    const _arc_p_rqh = _arc_p_redact(Object.fromEntries(req.headers))
    const _arc_p_rsh = _arc_p_redact(Object.fromEntries(_arc_p_resp.headers))
    let _arc_p_mem = 0; try { _arc_p_mem = process.memoryUsage().rss } catch {}
    queueMicrotask(() => _arc_p_push({
      id: (_arc_p_store.ts % 2176782336).toString(36),
      ts: _arc_p_store.ts,
      method: req.method,
      path: _pathname,
      route: _pathname,
      status: _arc_p_resp.status ?? 200,
      total_ms: _arc_p_total,
      queries: _arc_p_store.queries,
      mem: _arc_p_mem,
      reqHeaders: _arc_p_rqh,
      resHeaders: _arc_p_rsh
    }))
    return _arc_p_resp`
      : `return await _serveStatic(req, _pathname)`

    const fetchKeyword = 'async fetch'

    return `
${traceHoist}

${bannerFn}

${envBlock}// Start Bun server
const _server = Bun.serve({
  port: ${port},
  ${fetchKeyword}(req) {
    ${traceSetup.trim() ? traceSetup.trim() + '\n    ' : ''}// Fast pathname extraction — avoids full URL parse (new URL() overhead)
    const _u = req.url
    const _s = _u.indexOf('/', 8)
    const _q = _u.indexOf('?', _s > -1 ? _s : 8)
    const _pathname = _u.slice(_s > -1 ? _s : _u.length, _q > -1 ? _q : undefined) || '/'
    ${hasMiddleware ? 'const _mwRes = await _middleware(req, _pathname); if (_mwRes) return _mwRes\n    ' : ''}if (_pathname === '/health') {
      try {
    ${healthBody}
      } catch (_he) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'health_check_error', msg: _he?.message ?? String(_he) })); return _json({ status: 'error' }, 503, { 'Cache-Control': 'no-store, no-cache' }) }
    }${profilerRouteCheck}
    ${corsOptionsHandler.trim() ? corsOptionsHandler.trim() + '\n    ' : ''}${pgGuard.trim()}
    ${rlCheck.trim()}
    ${dispatchCall}
  }
})
_printBanner(_server.port)
${this.profile ? `console.log('  \\x1b[36marc: profiler\\x1b[0m  \\x1b[2mhttp://localhost:' + _server.port + '/_arc/profiler\\x1b[0m')
console.warn('  \\x1b[33marc: --profile is for development only — disable in production\\x1b[0m')` : ''}
`.trim()
  }
}

module.exports = { BunServerEmitter }
