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
const fs = require('fs')
const path = require('path')

// Detect if arc-jobs is installed in the project's node_modules.
// Keyed by cwd so watch-mode / multi-project usage gets correct results per project.
const _arcJobsCacheByDir = new Map()
function _isArcJobsInstalled() {
  const cwd = process.cwd()
  if (_arcJobsCacheByDir.has(cwd)) return _arcJobsCacheByDir.get(cwd)
  let result = false
  try { result = fs.existsSync(path.join(cwd, 'node_modules', 'arc-jobs', 'src', 'index.js')) } catch (_) {}
  _arcJobsCacheByDir.set(cwd, result)
  return result
}

// Detect if arc-storage is installed — checks both scoped (@arc-lang/arc-storage) and legacy name.
// Keyed by cwd so watch-mode / multi-project usage gets correct results per project.
const _arcStorageCacheByDir = new Map()
function _isArcStorageInstalled() {
  const cwd = process.cwd()
  if (_arcStorageCacheByDir.has(cwd)) return _arcStorageCacheByDir.get(cwd)
  let result = false
  try {
    const roots = [cwd, path.join(cwd, '..')]
    for (const r of roots) {
      if (fs.existsSync(path.join(r, 'node_modules', '@arc-lang', 'arc-storage', 'src', 'index.js'))) { result = true; break }
      if (fs.existsSync(path.join(r, 'node_modules', 'arc-storage', 'src', 'index.js'))) { result = true; break }
    }
  } catch (_) {}
  _arcStorageCacheByDir.set(cwd, result)
  return result
}

// Render a JS object literal where ${ENV_VAR} string values become process.env lookups.
function _emitStorageOpts(opts) {
  const entries = Object.entries(opts).map(([k, v]) => {
    if (typeof v === 'string') {
      const m = v.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/)
      if (m) return `${JSON.stringify(k)}: process.env[${JSON.stringify(m[1])}]`
    }
    return `${JSON.stringify(k)}: ${JSON.stringify(v)}`
  })
  return `{ ${entries.join(', ')} }`
}

// Emit import + instantiation block for arc-storage based on arc.config.storage.
// Mirrors emitArcJobsImport — config-driven adapter wiring.
function emitArcStorageImport(storage) {
  // Normalize: if no config, default to a single FileAdapter named "default".
  const cfg = (storage && Object.keys(storage).length > 0)
    ? storage
    : { default: { backend: 'file', root: 'public/uploads', urlPrefix: '/uploads' } }

  const backends = new Set(Object.values(cfg).map(s => s.backend ?? 'file'))
  const imports = ['createStorage']
  if (backends.has('file')) imports.push('FileAdapter')
  if (backends.has('s3'))   imports.push('S3Adapter')

  const inits = Object.entries(cfg).map(([name, raw]) => {
    const backend = raw.backend ?? 'file'
    const { backend: _b, ...restRaw } = raw; const opts = { name, ...restRaw }
    const optsExpr = _emitStorageOpts(opts)
    const adapter = backend === 's3' ? 'S3Adapter' : 'FileAdapter'
    return `  ${JSON.stringify(name)}: createStorage(new ${adapter}(${optsExpr}))`
  }).join(',\n')

  return `
// ── arc-storage ──────────────────────────────────────────────────────────────
import { ${imports.join(', ')} } from '@arc-lang/arc-storage'
const _storages = {
${inits}
}
const Storage = _storages.default
const storage = _storages`.trim()
}

// Compute the static-serve dispatch table at build time.
// For each storage with a urlPrefix, emit a check: if pathname starts with that prefix,
// strip it and call _storages[name].serve(key, req).
function _storageServeBlock(storage) {
  const cfg = (storage && Object.keys(storage).length > 0)
    ? storage
    : { default: { backend: 'file', urlPrefix: '/uploads' } }
  // Sort by urlPrefix length desc so longer (more specific) prefixes win.
  const entries = Object.entries(cfg)
    .map(([name, raw]) => ({ name, prefix: (raw.urlPrefix ?? '/uploads').replace(/\/$/, '') }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  return entries.map(({ name, prefix }) => {
    const p = JSON.stringify(prefix + '/')
    // \\\\  = literal backslash at runtime — blocks Windows-style path segments
    return `if (req.method === 'GET' && pathname.startsWith(${p})) { const _sk = decodeURIComponent(pathname.slice(${prefix.length + 1})); if (!_sk || _sk.includes('..') || _sk.startsWith('/') || _sk.includes('\\0') || _sk.includes('\\\\')) return new Response('Not found', { status: 404 }); return await _storages[${JSON.stringify(name)}].serve(_sk, req) }`
  }).join('\n  ')
}

// Emit import block for arc-jobs adapters based on arc.config.queues
function emitArcJobsImport(queues = {}) {
  const backends = new Set(Object.values(queues).map(q => q.backend ?? 'memory'))
  if (backends.size === 0) backends.add('memory')

  const imports = ['createQueue']
  if (backends.has('sqlite')) imports.push('SqliteAdapter')
  if (backends.has('redis')) imports.push('RedisAdapter')
  if (backends.has('memory') || backends.size === 0) imports.push('MemoryAdapter')

  const queueNames = Object.keys(queues).length > 0 ? queues : { default: { backend: 'memory' } }
  const queueInits = Object.entries(queueNames).map(([name, cfg]) => {
    const backend = cfg.backend ?? 'memory'
    if (backend === 'sqlite') {
      return `  ${name}: createQueue(new SqliteAdapter({ name: ${JSON.stringify(name)}, db: globalThis.db }))`
    } else if (backend === 'redis') {
      const url = cfg.url ?? '${REDIS_URL}'
      let resolvedUrl
      if (url.startsWith('${') && url.endsWith('}')) {
        const envName = url.slice(2, -1)
        resolvedUrl = /^[A-Z_][A-Z0-9_]*$/.test(envName) ? `process.env.${envName}` : 'process.env.REDIS_URL'
      } else {
        resolvedUrl = JSON.stringify(url)
      }
      return `  ${name}: createQueue(new RedisAdapter({ name: ${JSON.stringify(name)}, url: ${resolvedUrl} }))`
    }
    return `  ${name}: createQueue(new MemoryAdapter({ name: ${JSON.stringify(name)} }))`
  }).join(',\n')

  return `
// ── arc-jobs ──────────────────────────────────────────────────────────────────
import { ${imports.join(', ')} } from 'arc-jobs'

const _queues = {
${queueInits}
}

// Backwards-compatible Queue alias (uses default queue)
const Queue = {
  enqueue: (fn, ...args) => _queues.default.enqueue(fn?.name ?? String(fn), args),
  size: () => _queues.default.size(),
  dead: () => _queues.default.dead(),
  replayDead: () => _queues.default.replayDead(),
  drain: (ms) => _queues.default.drain(ms),
  status: (id) => _queues.default.status(id),
}`.trim()
}

// Emit job registry to wire handlers into arc-jobs queues
function emitJobRegistry(jobs, queues = {}) {
  const lines = jobs.map(job => {
    const queueName = job.queueName ?? 'default'
    const opts = {
      timeoutMs: job.timeoutMs,
      maxRetries: job.maxRetries,
      backoffMs: job.backoffMs,
      priority: job.priority !== 'normal' ? job.priority : undefined,
      hasProgress: job.hasProgress || undefined,
      thenJob: job.thenJob || undefined,
      schedule: job.schedule || undefined,
    }
    const optsStr = JSON.stringify(Object.fromEntries(Object.entries(opts).filter(([, v]) => v != null)))
    return `_queues[${JSON.stringify(queueName)}]?.register(${JSON.stringify(job.name)}, _job_${job.name}, ${optsStr})`
  })

  const startLines = [...new Set(jobs.map(j => j.queueName ?? 'default'))]
    .map(qn => `_queues[${JSON.stringify(qn)}]?.start()`)

  return `
// ── Job registry ──────────────────────────────────────────────────────────────
${lines.join('\n')}

// Start queue processors
${startLines.join('\n')}`.trim()
}

// Emit scheduler block for @schedule jobs
function emitSchedulerBlock(scheduledJobs, queues = {}) {
  const schedules = scheduledJobs.map(job => {
    return `{ expr: ${JSON.stringify(job.schedule)}, jobName: ${JSON.stringify(job.name)}, queueName: ${JSON.stringify(job.queueName ?? 'default')} }`
  }).join(',\n  ')

  return `
// ── Scheduler ────────────────────────────────────────────────────────────────
import { startScheduler } from 'arc-jobs'
const _arcScheduler = startScheduler([
  ${schedules}
], _queues)`.trim()
}
const { arcTypeToSql: _arcTypeToSql } = require('../compilers/sql-types')
const { routeHandlerName, isValidRoute, routeTypeLabel } = require('./route-utils')
const { SHARED_RESPONSE_HELPERS } = require('./emitter-preamble')
const { emitRouteBody, emitCatchBlock } = require('./route-body-emitter')
const { profilerPreamble, profilerDbWrapper } = require('../profiler/hooks')

const _SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

// Flatten RouteGroupDecl nodes into RouteDecl[], prepending prefix and
// tagging each route with a _groupGuardFn so a shared guard is used instead
// of inlining the auth check N times (~95% less emitted JS for auth logic).
// Flattens RouteGroupDecl into individual RouteDecls with prefixed paths.
// Route-level params are recomputed from the final path string; original params discarded.
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
    ? `\n  if (!${JSON.stringify(roles)}.includes(s.role)) { const _acc = req.headers.get('accept') ?? ''; return _acc.includes('application/json') ? _json({ error: 'Forbidden' }, 403) : Response.redirect('/admin/403', 302) }`
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
    this.storage = options.storage ?? null
    this.searchConfig = options.searchConfig ?? {}
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

    // Queue + email: use arc-jobs if installed, otherwise fall back to inline queue
    const arcJobsInstalled = _isArcJobsInstalled()
    const queues = this.options.queues ?? {}
    if (arcJobsInstalled && jobs.length > 0) {
      parts.push(emitArcJobsImport(queues))
    } else {
      parts.push(emitQueuePreamble())
    }

    // Storage adapters — emit when arc-storage is installed in the project.
    // Defaults to one FileAdapter with the legacy /uploads paths if no config block is present.
    if (_isArcStorageInstalled()) {
      parts.push(emitArcStorageImport(this.storage))
    }
    parts.push(emitEmailPreamble())

    if (this.isPg && schemas.length > 0) {
      // PG: emit a single awaited startup block - prevents fire-and-forget race and
      // globalThis.db overwrite if multiple schemas' IIFEs run concurrently
      parts.push(this.emitPgSchemaInit(schemas))
    } else {
      for (const schema of schemas) {
        parts.push(this.emitModelHelpers(schema))
      }
      if (schemas.length > 0) {
        parts.push('const db = globalThis.db')
        // Expose db.transaction for atomic multi-row operations (SQLite only)
        parts.push(`if (typeof _db?.transaction === 'function') globalThis.db.transaction = (fn) => { _db.transaction(fn)(); };`)
        // Expose raw SQL helpers for FTS5 and advanced queries (SQLite only)
        // db.run returns { changes, lastId } so callers avoid a SELECT after INSERT
        parts.push(`if (typeof _db?.query === 'function') { globalThis.db.exec = (sql, p = []) => _db.query(sql).all(...p); globalThis.db.run = (sql, p = []) => { const _r = _db.run(sql, ...p); return { changes: _r.changes, lastId: _r.lastInsertRowid } }; }`)
      }
    }

    if (this.options.versioningEnabled) {
      parts.push(this._emitVersioningWrapper(this.options.versioningConfig ?? {}))
    }

    for (const job of jobs) {
      parts.push(this.emitJobHandler(job))
      // Pass full job object when arc-jobs is installed (enables @queue, @priority, @unique etc.)
      // Fall back to legacy string form (backwards-compatible inline queue) otherwise
      parts.push(emitJobEnqueueWrapper(arcJobsInstalled ? job : job.name))
    }

    // Job registry + arc-jobs wiring (only when arc-jobs is installed)
    if (arcJobsInstalled && jobs.length > 0) {
      parts.push(emitJobRegistry(jobs, queues))
    }

    // Scheduler (only when @schedule jobs exist)
    const scheduledJobs = jobs.filter(j => j.schedule)
    if (scheduledJobs.length > 0) {
      parts.push(emitSchedulerBlock(scheduledJobs, queues))
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

    // Storage-served prefix dispatch — generated when arc-storage is installed.
    // For each configured storage, check pathname prefix and delegate to _storages[name].serve().
    const _storageServeDispatch = _isArcStorageInstalled()
      ? _storageServeBlock(this.storage)
      : ''
    const staticFallback = `
const _path = require('path')
const _fs = require('fs')
// Bun exposes the Web Crypto API on globalThis.crypto but not Node.js crypto methods.
// Assign them so user code can call crypto.scryptSync / crypto.randomBytes directly.
;(function(){ const _nc = require('node:crypto'); if (!crypto.scryptSync) crypto.scryptSync = _nc.scryptSync.bind(_nc); if (!crypto.randomBytes) crypto.randomBytes = _nc.randomBytes.bind(_nc); })()
const _DIST_DIR = _path.dirname(require.main?.filename ?? __filename)
const _MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' }
const _UPLOAD_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' }
// SVG/PDF are user-uploaded content - force download to prevent script execution in browser origin
const _ATTACHMENT_EXTS = new Set(['.svg', '.pdf'])
// Pre-populate known static file paths at startup to avoid existsSync() on every request.
// Called eagerly after server.listen() so the set is ready before the first request.
let _staticFiles = null
let _dynamicRoutes = null
let _rendererPaths = null
function _getStaticFiles() {
  if (_staticFiles) return _staticFiles
  _staticFiles = new Set()
  _rendererPaths = new Set()
  _dynamicRoutes = []
  try {
    const _walkDir = (dir) => {
      for (const entry of _fs.readdirSync(dir, { withFileTypes: true })) {
        const full = _path.join(dir, entry.name)
        if (entry.isDirectory()) _walkDir(full)
        else {
          _staticFiles.add(full)
          if (entry.name === 'renderer.js' && _path.basename(dir) === '_arc') _rendererPaths.add(full)
        }
      }
    }
    _walkDir(_DIST_DIR)
    // Build dynamic-route list from files whose path contains [param] or [[...rest]] segments.
    // Patterns match URL paths to dist files: /admin/pages/3 → dist/admin/pages/[id].html
    const _BRACKET_RE = /\\[[^\\]]+\\]/
    const _CATCHALL_RE = /\\[\\[\\.\\.\\.([^\\]]+)\\]\\]/g
    const _PARAM_RE = /\\[([^\\]]+)\\]/g
    const _RE_ESCAPE = /[.+^\${}()|]/g
    for (const fp of _staticFiles) {
      const rel = '/' + _path.relative(_DIST_DIR, fp).split(_path.sep).join('/')
      if (!_BRACKET_RE.test(rel)) continue
      const variants = []
      if (rel.endsWith('/index.html')) variants.push(rel.slice(0, -'/index.html'.length) || '/')
      if (rel.endsWith('.html')) variants.push(rel.slice(0, -'.html'.length))
      variants.push(rel)
      for (const variant of variants) {
        let numIdParams = 0
        const pat = variant
          .replace(_RE_ESCAPE, '\\\\$&')
          .replace(_CATCHALL_RE, '(.+)')
          .replace(_PARAM_RE, (_, name) => {
            if (name === 'id') { numIdParams++; return '(\\\\d+)' }
            return '([^/]+)'
          })
        // Sort key: more numeric [id] segments first (higher specificity than [slug]/[name]),
        // then fewer brackets first (more literal segments = more specific).
        _dynamicRoutes.push({
          regex: new RegExp('^' + pat + '$'),
          file: fp,
          specificity: -numIdParams * 10 + variant.split('[').length
        })
      }
    }
    _dynamicRoutes.sort((a, b) => a.specificity - b.specificity)
  } catch (_e) { /* dist may not exist yet - ENOENT is expected at first build */ }
  return _staticFiles
}
function _matchDynamicRoute(pathname) {
  if (!_dynamicRoutes) return null
  for (const r of _dynamicRoutes) {
    if (r.regex.test(pathname)) return r.file
  }
  return null
}
// Cache of dist/**/_arc/functions.js paths for @live page @server function dispatch.
let _arcFnFiles = null
function _getArcFnFiles() {
  if (_arcFnFiles) return _arcFnFiles
  _arcFnFiles = []
  function _walkFn(dir) {
    try {
      for (const e of _fs.readdirSync(dir, { withFileTypes: true })) {
        const f = _path.join(dir, e.name)
        if (e.isDirectory()) _walkFn(f)
        else if (e.name === 'functions.js' && _path.basename(dir) === '_arc') _arcFnFiles.push(f)
      }
    } catch {}
  }
  _walkFn(_DIST_DIR)
  return _arcFnFiles
}
// O(1) handler map: built once on first /_arc/fn/ request. Returns a Promise so
// concurrent callers all await the same build rather than each getting an empty Map.
// Lazily imports /_arc/functions.js handler modules on first request and caches the result.
// On catastrophic failure (import error), permanently resolves to empty Map — avoids
// retry storms. Process restart required to recover, which is the right recovery path.
let _arcHandlerCache = null
function _getHandlerCache() {
  if (_arcHandlerCache) return _arcHandlerCache
  _arcHandlerCache = (async () => {
    const _m = new Map()
    for (const _fnPath of _getArcFnFiles()) {
      try {
        const _fmod = await import(_fnPath)
        for (const [_k, _v] of Object.entries(_fmod)) {
          if (_k.startsWith('_handler_') && typeof _v === 'function') {
            _m.set(_k.slice('_handler_'.length), _v)
          }
        }
      } catch (e) { console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'fn_module_load_failed', file: _fnPath, msg: e?.message ?? String(e) })) }
    }
    return _m
  })().catch(e => { _arcHandlerCache = Promise.resolve(new Map()); console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'handler_cache_build_failed', msg: e?.message ?? String(e) })); return new Map() })
  return _arcHandlerCache
}
// Cached path -> required role table from server/admin-roles.json (arc-cms config).
// null = no config (fall back to session-only guard).
let _adminRoles = undefined
function _getAdminRoles() {
  if (_adminRoles !== undefined) return _adminRoles
  const _p = _path.join(process.cwd(), 'server', 'admin-roles.json')
  try {
    _adminRoles = JSON.parse(_fs.readFileSync(_p, 'utf8'))
  } catch (_rErr) {
    if (_rErr?.code !== 'ENOENT') console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'admin_roles_load_failed', msg: _rErr?.message ?? String(_rErr) }))
    _adminRoles = null
  }
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
  if (!Object.prototype.hasOwnProperty.call(ranks, have)) return false
  return ranks[have] >= (ranks[need] ?? 0)
}
async function _serveStatic(req, pathname) {
  ${_storageServeDispatch}
  // Serve user-uploaded media from public/uploads/ with safe headers (no auth — public assets).
  // Legacy path — only reached when arc-storage isn't installed.
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const _uploadsRoot = _path.join(process.cwd(), 'public', 'uploads')
    const _uf = _path.join(process.cwd(), 'public', pathname)
    if (!_uf.startsWith(_uploadsRoot + _path.sep) && _uf !== _uploadsRoot) {
      return new Response('Not found', { status: 404 })
    }
    try {
      const _uStat = await _fs.promises.stat(_uf)
      if (_uStat.isFile()) {
        const _uext = _path.extname(_uf).toLowerCase()
        const _headers = { 'Content-Type': _UPLOAD_MIME[_uext] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }
        if (_ATTACHMENT_EXTS.has(_uext)) _headers['Content-Disposition'] = 'attachment'
        return new Response(Bun.file(_uf), { headers: _headers })
      }
    } catch {}
    return new Response('Not found', { status: 404 })
  }
  // Dispatch @route handlers FIRST so routes with their own @auth(...) annotations
  // run with their own auth logic. Only unmatched paths (returns 404) fall through
  // to the static-page admin guard below.
  let _r
  try { _r = await _dispatch(req, pathname) } catch (_de) {
    if (_de instanceof Response) return _de
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] dispatch error', path: pathname, error: _de?.message ?? String(_de), name: _de?.name, stack: (_de?.stack ?? '').split('\\n').slice(0, 6) }))
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  // Fall through to static files on 404 (unknown route) or on 405 for GET requests
  // (route exists but only handles non-GET methods — static HTML page should be served instead).
  if (!(_r instanceof Response) || (_r.status !== 404 && !(_r.status === 405 && req.method === 'GET'))) return _r
  // arc-cms public page renderer: /p/:slug → server/cms/page-renderer.js if present.
  // Opt-in: only fires if the project ships the module (cms init copies it).
  // If renderCmsPage returns null the module signalled "skip me" (e.g. editor session
  // detected) — fall through to the Arc SSR renderer so the edit bar is injected.
  if (req.method === 'GET' && pathname.startsWith('/p/')) {
    const _slug = pathname.slice(3)
    if (/^[a-z0-9][a-z0-9-]*$/i.test(_slug)) {
      try {
        const _pr = require(_path.join(process.cwd(), 'server', 'cms', 'page-renderer.js'))
        if (_pr && _pr.renderCmsPage) {
          const _prRes = await _pr.renderCmsPage(req, _db, _slug)
          if (_prRes) return _prRes
          // null → module requested fall-through (editor session bypass)
        }
      } catch (_e) {
        if (_e?.code !== 'MODULE_NOT_FOUND') console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'cms_page_renderer_error', slug: _slug, msg: _e?.message ?? String(_e), name: _e?.name }))
      }
    }
  }
  // Handle /_arc/fn/* POSTs from @live page @server functions (reactive state updates).
  // Must run BEFORE the admin guard so /_arc/fn/ paths aren't rejected as non-/admin/*.
  if (req.method === 'POST' && pathname.startsWith('/_arc/fn/')) {
    const _fnName = pathname.slice('/_arc/fn/'.length)
    if (_ARC_FN_NAME_RE.test(_fnName)) {
      try {
        req._arc_session = await auth.session(req) ?? {}
        const _hCache = await _getHandlerCache()
        const _matchedHandler = _hCache.get(_fnName)
        if (_matchedHandler) { const _fnRes = await _matchedHandler(req); return _fnRes instanceof Response ? _fnRes : new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      } catch (_fnErr) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] fn handler error', fn: pathname, method: req.method, error: _fnErr?.message ?? String(_fnErr), name: _fnErr?.name, stack: (_fnErr?.stack ?? '').split('\\n').slice(0, 6) }))
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }
  }
  // Guard unmatched /admin/* paths (these resolve to static admin HTML pages).
  // Routes that exist as @route handlers are already past us by this point.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname !== '/admin/login') {
      let _sess
      try { _sess = await auth.session(req) } catch (_sessErr) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'admin_session_error', path: pathname, msg: _sessErr?.message ?? String(_sessErr), name: _sessErr?.name, stack: (_sessErr?.stack ?? '').split('\\n').slice(0, 6) }))
        return Response.redirect('/admin/login', 302)
      }
      if (!_sess) return Response.redirect('/admin/login', 302)
      const _need = _requiredRole(pathname)
      if (!_roleOk(_sess.role, _need) && pathname !== '/admin/403') return Response.redirect('/admin/403', 302)
    }
    // For GET requests, check if there's a @live renderer.js for this path.
    // renderer.js does SSR: runs @server fn with real db → full pre-rendered HTML.
    // Built by "arc build-site" into dist/<pathname>/_arc/renderer.js.
    // For dynamic routes (/admin/blocks/code/123), fall back to the template dir
    // (dist/admin/blocks/code/_arc/renderer.js from blocks/code/[id].arc).
    if (req.method === 'GET') {
      const _clean = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
      let _rendererPath = _path.join(_DIST_DIR, _clean, '_arc', 'renderer.js')
      if (!_rendererPaths?.has(_rendererPath)) {
        const _dynFile = _matchDynamicRoute(_clean)
        if (_dynFile) _rendererPath = _path.join(_dynFile.replace(/\.html$/, ''), '_arc', 'renderer.js')
      }
      if (_rendererPaths?.has(_rendererPath)) {
        try {
          const _rmod = await import(_rendererPath)
          const _resolveData = _rmod._resolveData ?? _rmod.default?._resolveData
          const _fillHtml = _rmod._fillHtml ?? _rmod.default?._fillHtml
          if (_resolveData && _fillHtml) {
            req._arc_session = req._arc_session ?? (await auth.session(req) ?? {})
            const _ldata = await _resolveData(req)
            if (_ldata && _ldata.__arc_render_error__) {
              return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Something went wrong – Arc</title></head><body style="font-family:system-ui;padding:2rem"><a href="#main-content" style="position:absolute;left:-9999px;top:auto;overflow:hidden;clip:rect(0,0,0,0)">Skip to main content</a><main id="main-content" style="max-width:40rem;margin:4rem auto"><h1 style="text-align:center">Something went wrong</h1><p>Please try refreshing the page, or <a href="/admin">return to the admin panel</a>.</p></main></body></html>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store' } })
            }
            let _html = _fillHtml(_ldata)
            _html = _html.replace(/<meta\\s+http-equiv=["']Content-Security-Policy["'][^>]*\\/?>/gi, '')
            return new Response(_html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; font-src 'self' https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com data:; img-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'" } })
          }
        } catch (_rendErr) {
          console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] admin renderer error', path: pathname, method: req.method, error: _rendErr?.message ?? String(_rendErr), name: _rendErr?.name, stack: (_rendErr?.stack ?? '').split('\\n').slice(0, 6) }))
          // fall through to static file serving
        }
      }
    }
  }
  // For GET requests on non-admin pages, check if there's a @live renderer.js
  if (req.method === 'GET') {
    const _clean2 = pathname.replace(/\\/$/, '') || '/index'
    let _rPath2 = _path.join(_DIST_DIR, _clean2, '_arc', 'renderer.js')
    if (!_rendererPaths?.has(_rPath2)) {
      const _df2 = _matchDynamicRoute(_clean2)
      if (_df2) _rPath2 = _path.join(_df2.replace(/\.html$/, ''), '_arc', 'renderer.js')
    }
    if (_rendererPaths?.has(_rPath2)) {
      try {
        const _rm2 = await import(_rPath2)
        const _rd2 = _rm2._resolveData ?? _rm2.default?._resolveData
        const _fh2 = _rm2._fillHtml ?? _rm2.default?._fillHtml
        if (_rd2 && _fh2) {
          req._arc_session = req._arc_session ?? (await auth.session(req) ?? {})
          const _ld2 = await _rd2(req)
          if (_ld2 && _ld2.__arc_render_error__) {
            return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Something went wrong – Arc</title></head><body style="font-family:system-ui;padding:2rem"><a href="#main-content" style="position:absolute;left:-9999px;top:auto;overflow:hidden;clip:rect(0,0,0,0)">Skip to main content</a><main id="main-content" style="max-width:40rem;margin:4rem auto"><h1 style="text-align:center">Something went wrong</h1><p>Please try refreshing the page, or <a href="/admin">return to the admin panel</a>.</p></main></body></html>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store' } })
          }
          let _html2 = _fh2(_ld2)
          _html2 = _html2.replace(/<meta\\s+http-equiv=["']Content-Security-Policy["'][^>]*\\/?>/gi, '')
          return new Response(_html2, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; font-src 'self' https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com data:; img-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'" } })
        }
      } catch (_re2) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] page renderer error', path: pathname, error: _re2?.message ?? String(_re2), name: _re2?.name, stack: (_re2?.stack ?? '').split('\\n').slice(0, 6) }))
        // fall through to static file serving
      }
    }
  }
  // Try dist/path (literal), then dist/path.html, then dist/path/index.html
  const _sf = _getStaticFiles()
  const _clean = pathname.replace(/\\/$/, '')
  for (const _try of [_clean, _clean + '.html', _clean + '/index.html']) {
    const _fp = _path.join(_DIST_DIR, _try)
    if (!_fp.startsWith(_DIST_DIR + _path.sep) && _fp !== _DIST_DIR) continue
    if (_sf.has(_fp)) {
      const _ext = _path.extname(_fp)
      const _isAdminPath = _clean === '/admin' || _clean.startsWith('/admin/')
      const _cc = _isAdminPath ? 'no-store, no-cache, must-revalidate, private' : (_ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
      const _hdrs = { 'Content-Type': _MIME[_ext] ?? 'text/plain', 'Cache-Control': _cc }
      if (_isAdminPath) { _hdrs['Pragma'] = 'no-cache'; _hdrs['Expires'] = '0'; _hdrs['X-Robots-Tag'] = 'noindex, nofollow' }
      return new Response(Bun.file(_fp), { headers: _hdrs })
    }
  }
  // Dynamic-route fallback: try files like dist/admin/pages/[id].html for /admin/pages/3
  const _dynFp = _matchDynamicRoute(_clean)
  if (_dynFp) {
    const _ext = _path.extname(_dynFp)
    const _isAdminDyn = _clean === '/admin' || _clean.startsWith('/admin/')
    const _cc2 = _isAdminDyn ? 'no-store, no-cache, must-revalidate, private' : (_ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
    const _hdrs2 = { 'Content-Type': _MIME[_ext] ?? 'text/plain', 'Cache-Control': _cc2 }
    if (_isAdminDyn) { _hdrs2['Pragma'] = 'no-cache'; _hdrs2['Expires'] = '0'; _hdrs2['X-Robots-Tag'] = 'noindex, nofollow' }
    return new Response(Bun.file(_dynFp), { headers: _hdrs2 })
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

// In-memory rate limiter - 60 POST requests per IP per minute (fixed window)
// Applies to all mutating requests. Resets hourly to prevent unbounded Map growth.
// Set TRUSTED_PROXY_IPS (comma-separated) to opt-in to X-Forwarded-For trust.
// Without it, X-Forwarded-For is ignored to prevent IP spoofing.
const _rlMap = new Map()
const _TRUSTED_PROXIES = process.env.TRUSTED_PROXY_IPS
  ? new Set(process.env.TRUSTED_PROXY_IPS.split(',').map(s => s.trim()).filter(Boolean))
  : null
// Sweep expired entries every minute so burst-then-silent IPs don't accumulate between hourly resets
setInterval(() => { const _n = Date.now(); for (const [_k, _v] of _rlMap) if (_n > _v.resetAt) _rlMap.delete(_k) }, 60000).unref()
function _checkRateLimit(req, _bunServer) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE' && req.method !== 'PATCH') return null
  const xff = req.headers.get('x-forwarded-for')
  // Only trust X-Forwarded-For if the *connecting* IP itself is a known trusted proxy.
  // Otherwise an attacker can inject arbitrary IPs into XFF to spoof their rate-limit bucket.
  const _connIp = _bunServer?.requestIP?.(req)?.address ?? null
  const _connIsTrusted = _TRUSTED_PROXIES && _connIp && _TRUSTED_PROXIES.has(_connIp)
  const ip = (_connIsTrusted && xff)
    ? (xff.split(',').map(s => s.trim()).reverse().find(i => !_TRUSTED_PROXIES.has(i)) ?? xff.split(',')[0].trim())
    : (_connIp ?? 'unknown')
  const now = Date.now()
  const _windowMs = 60000
  let entry = _rlMap.get(ip)
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + _windowMs }
  entry.count++
  _rlMap.set(ip, entry)
  if (entry.count > 60) { console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'rate_limit_exceeded', ip })); return _json({ error: 'Too many requests' }, 429, { 'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)) }) }
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

  _emitVersioningWrapper(cfg = {}) {
    const maxV = Math.min(Number(cfg.maxVersionsPerRecord ?? 100), 10000)
    const exclude = JSON.stringify(['_arc_versions', ...((cfg.excludeModels ?? []))])
    return `
// ── arc-versioning ────────────────────────────────────────────────────────────
// Create _arc_versions table + indexes (idempotent)
;(() => {
  _db.run(\`CREATE TABLE IF NOT EXISTS _arc_versions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    modelName TEXT    NOT NULL,
    recordId  TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    data      TEXT,
    userId    TEXT,
    createdAt TEXT    NOT NULL DEFAULT (datetime('now'))
  )\`)
  _db.run('CREATE INDEX IF NOT EXISTS _arc_versions_record ON _arc_versions (modelName, recordId, id DESC)')
  _db.run('CREATE INDEX IF NOT EXISTS _arc_versions_recent ON _arc_versions (createdAt DESC)')
  _db.run('CREATE INDEX IF NOT EXISTS _arc_versions_user   ON _arc_versions (userId, createdAt DESC)')
  // Register _arc_versions db helpers
  Object.assign(globalThis.db ?? (globalThis.db = {}), {
    _arc_versions: {
      findMany: (opts = {}) => {
        const _w = opts.where, _ob = opts.orderBy, _lim = Math.min(opts.limit ?? 20, 10000), _off = opts.offset ?? 0
        const _arcVersionsCols = new Set(['id', 'modelName', 'recordId', 'action', 'data', 'userId', 'createdAt'])
        const _order = _ob ? ' ORDER BY ' + Object.entries(_ob).filter(([k]) => _arcVersionsCols.has(k)).map(([k, d]) => '"' + k + '" ' + (d === 'desc' ? 'DESC' : 'ASC')).join(', ') : ' ORDER BY id DESC'
        if (!_w || !Object.keys(_w).length) return _db.query('SELECT * FROM _arc_versions' + _order + ' LIMIT ? OFFSET ?').all(_lim, _off)
        const _keys = Object.keys(_w), _vals = Object.values(_w)
        const _wsql = _keys.map((k, i) => '"' + k + '" = ?' + (i + 1)).join(' AND ')
        return _db.query('SELECT * FROM _arc_versions WHERE ' + _wsql + _order + ' LIMIT ? OFFSET ?').all(..._vals, _lim, _off)
      },
      find: (id) => _db.query('SELECT * FROM _arc_versions WHERE id = ?1').get(id) ?? null,
      create: (data) => {
        const { modelName, recordId, action, data: d, userId } = data
        return _db.query('INSERT INTO _arc_versions (modelName, recordId, action, data, userId) VALUES (?1,?2,?3,?4,?5) RETURNING *').get(modelName, String(recordId ?? ''), action, d ?? null, userId ?? null)
      },
      count: (opts = {}) => {
        const _w = opts.where
        if (!_w || !Object.keys(_w).length) return _db.query('SELECT COUNT(*) as count FROM _arc_versions').get()?.count ?? 0
        const _keys = Object.keys(_w), _vals = Object.values(_w)
        const _wsql = _keys.map((k, i) => '"' + k + '" = ?' + (i + 1)).join(' AND ')
        return _db.query('SELECT COUNT(*) as count FROM _arc_versions WHERE ' + _wsql).get(..._vals)?.count ?? 0
      },
      delete: (id) => (_db.run('DELETE FROM _arc_versions WHERE id = ?', [id]), true),
    }
  })
  // Wrap all model mutations to auto-snapshot
  const _skip = new Set(${exclude})
  const _maxV = ${maxV}
  const _trim = (modelName, recordId) => {
    Promise.resolve().then(() => {
      try {
        const _rows = _db.query('SELECT id FROM _arc_versions WHERE modelName = ?1 AND recordId = ?2 ORDER BY id DESC LIMIT -1 OFFSET ' + _maxV).all(modelName, recordId)
        if (_rows.length) _db.run('DELETE FROM _arc_versions WHERE id IN (' + _rows.map(r => parseInt(r.id, 10)).filter(n => Number.isFinite(n)).join(',') + ')')
      } catch (_trimErr) { console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'versioning_trim_failed', msg: _trimErr?.message ?? String(_trimErr) })) }
    })
  }
  const _snap = (modelName, recordId, action, data) => {
    try {
      globalThis.db._arc_versions.create({ modelName, recordId: String(recordId ?? ''), action, data: JSON.stringify(data), userId: null })
      _trim(modelName, String(recordId ?? ''))
    } catch (e) { console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'versioning_snapshot_failed', msg: e?.message ?? String(e) })) }
  }
  for (const _m of Object.keys(globalThis.db ?? {})) {
    if (_skip.has(_m)) continue
    const _o = globalThis.db[_m]
    if (typeof _o?.create !== 'function') continue
    globalThis.db[_m] = Object.assign(Object.create(null), _o, {
      create(data) {
        const r = _o.create(data)
        _snap(_m, r?.id, 'create', r)
        return r
      },
      update(idOrOpts, data) {
        const r = _o.update(idOrOpts, data)
        const rid = typeof idOrOpts === 'object' && idOrOpts !== null ? (idOrOpts?.where?.id ?? idOrOpts) : idOrOpts
        _snap(_m, rid, 'update', r)
        return r
      },
      delete(id) {
        let before = null
        try { before = _o.find(id) } catch {}
        const r = _o.delete(id)
        _snap(_m, id, 'delete', before)
        return r
      }
    })
  }
})()
const db = globalThis.db`.trim()
  }

  // --- arc-search: @searchable decorator helpers ---

  // Expand a URL template like '/posts/{slug}' into a JS expression using resultVar
  _expandSearchUrlTemplate(template, resultVar) {
    const parts = template.split(/\{(\w+)\}/)
    if (parts.length === 1) return JSON.stringify(template)
    return parts.map((p, i) => i % 2 === 0 ? JSON.stringify(p) : `String(${resultVar}?.[${JSON.stringify(p)}] ?? '')`).join(' + ')
  }

  // Generate the FTS5 upsert block injected after create/update
  _emitSearchUpsert(tableName, titleField, bodyFields, urlExpr) {
    const bodyExpr = bodyFields.length > 0
      ? bodyFields.map(f => `String(_sResult?.[${JSON.stringify(f)}] ?? '')`).join(" + ' ' + ")
      : "''"
    return `
      if (_sResult) {
        const _sTitle = String(_sResult?.[${JSON.stringify(titleField)}] ?? ''), _sBody = ${bodyExpr}, _sUrl = ${urlExpr}
        const _sPrev = _db.query('SELECT id, title, body FROM arc_search_docs WHERE type=? AND ref=?').get(${JSON.stringify(tableName)}, String(_sResult.id ?? ''))
        if (_sPrev) {
          _db.run("INSERT INTO arc_search_fts(arc_search_fts,rowid,title,body) VALUES('delete',?,?,?)", _sPrev.id, _sPrev.title, _sPrev.body)
          _db.run('UPDATE arc_search_docs SET title=?,body=?,url=? WHERE id=?', _sTitle, _sBody, _sUrl, _sPrev.id)
          _db.run('INSERT INTO arc_search_fts(rowid,title,body) VALUES(?,?,?)', _sPrev.id, _sTitle, _sBody)
        } else {
          _db.run('INSERT INTO arc_search_docs(type,ref,title,body,url,meta) VALUES(?,?,?,?,?,?)', ${JSON.stringify(tableName)}, String(_sResult.id ?? ''), _sTitle, _sBody, _sUrl, '{}')
          const _sNewId = _db.query('SELECT last_insert_rowid() as id').get().id
          _db.run('INSERT INTO arc_search_fts(rowid,title,body) VALUES(?,?,?)', _sNewId, _sTitle, _sBody)
        }
      }`
  }

  // Generate the FTS5 delete block injected before record deletion
  _emitSearchDelete(tableName) {
    return `
      const _sDel = _db.query('SELECT id, title, body FROM arc_search_docs WHERE type=? AND ref=?').get(${JSON.stringify(tableName)}, String(id ?? ''))
      if (_sDel) {
        _db.run("INSERT INTO arc_search_fts(arc_search_fts,rowid,title,body) VALUES('delete',?,?,?)", _sDel.id, _sDel.title, _sDel.body)
        _db.run('DELETE FROM arc_search_docs WHERE id=?', _sDel.id)
      }`
  }

  _emitModelHelpersSqlite(schema) {
    const { tableName, fields, colList, colDefs } = this._schemaVars(schema, 'sqlite')
    const placeholders = fields.map((_, i) => `?${i + 1}`).join(', ')
    const updates = fields.map((f, i) => `"${f.name}" = ?${i + 1}`).join(', ')
    const selectCols = colList ? `id, ${colList}` : 'id'

    const fieldNames = JSON.stringify(fields.map(f => f.name))
    const requiredFieldNames = JSON.stringify(fields.filter(f => this._isRequiredField(f)).map(f => f.name))

    // --- @searchable decorator support ---
    const allFields = schema.fields ?? []
    const searchableFields = allFields.filter(f => f.name && f.decorators?.includes('@searchable'))
    const hasSearch = searchableFields.length > 0
    const searchTitleField = searchableFields[0]?.name ?? 'id'
    const searchBodyFields = searchableFields.slice(1).map(f => f.name)
    const searchUrlTemplate = this.searchConfig?.models?.[schema.name]?.url
      ?? this.searchConfig?.models?.[tableName]?.url
      ?? '#'
    const tokenizer = this.searchConfig?.tokenizer === 'trigram' ? 'trigram' : 'unicode61 remove_diacritics 1'
    const searchUrlExpr = this._expandSearchUrlTemplate(searchUrlTemplate, '_sResult')
    const searchUpsertBlock = hasSearch ? this._emitSearchUpsert(tableName, searchTitleField, searchBodyFields, searchUrlExpr) : ''
    const searchDeleteBlock = hasSearch ? this._emitSearchDelete(tableName) : ''

    const searchInit = hasSearch ? `
// arc-search: FTS5 index tables for ${schema.name}
_db.run("CREATE TABLE IF NOT EXISTS arc_search_docs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', UNIQUE(type, ref))")
_db.run("CREATE VIRTUAL TABLE IF NOT EXISTS arc_search_fts USING fts5(title, body, content=arc_search_docs, content_rowid=id, tokenize='${tokenizer}')")
if (typeof globalThis !== 'undefined') globalThis._arcSearchReady = true
` : ''

    const createMethod = colList ? `create: (data) => {
      const _d = _pick(data, _${tableName}_fields)
      const _miss = _${tableName}_required.filter(k => _d[k] == null)
      if (_miss.length) throw Object.assign(new Error('${tableName}.create: missing required fields: ' + _miss.join(', ')), { status: 422 })
      const _sResult = _q_${tableName}_create.get(${fields.map(f => this._isNowDefault(f) ? `(_d.${f.name} ?? new Date().toISOString())` : `_d.${f.name}`).join(', ')})
      ${searchUpsertBlock}
      return _sResult
    },` : ''

    const updateMethod = colList ? `update: (idOrOpts, data) => {
      let _id = idOrOpts, _dd = data
      if (idOrOpts !== null && typeof idOrOpts === 'object' && idOrOpts.where) { _id = idOrOpts.where.id; _dd = idOrOpts.data ?? {} }
      const _d = _pick(_dd ?? {}, _${tableName}_fields)
      const _ks = Object.keys(_d)
      if (!_ks.length) return null
      const _sets = _ks.map((k, i) => '"' + k + '" = ?' + (i + 1)).join(', ')
      const _sResult = _db.query('UPDATE ${tableName} SET ' + _sets + ' WHERE id = ?' + (_ks.length + 1) + ' RETURNING *').get(..._ks.map(k => _d[k]), _id) ?? null
      ${searchUpsertBlock}
      return _sResult
    },` : ''

    const deleteMethod = hasSearch
      ? `delete: (id) => { ${searchDeleteBlock}
      return (_q_${tableName}_delete.run(id), true) },`
      : `delete: (id) => (_q_${tableName}_delete.run(id), true),`

    return `
// Schema: ${schema.name}
_db.run(\`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs})\`)
${searchInit}
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
      const _allowedCols = new Set([..._${tableName}_fields, 'id'])
      const _ob = opts?.orderBy ? Object.entries(opts.orderBy).filter(([k]) => _allowedCols.has(k)).map(([k, d]) => \`"\${k}" \${d === 'desc' ? 'DESC' : 'ASC'}\`).join(', ') : null
      const _order = _ob ? \` ORDER BY \${_ob}\` : ''
      const _lim = Math.min(opts?.limit ?? 20, 100000), _off = opts?.offset ?? 0
      if (!_w || !Object.keys(_w).length) return _db.query(\`SELECT ${selectCols} FROM ${tableName}\${_order} LIMIT ? OFFSET ?\`).all(_lim, _off)
      const { sql: _wsql, vals: _wv } = _arcWhere(_${tableName}_fields, _w)
      if (_wsql === '0=1') return []
      return _db.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_wsql}\${_order} LIMIT ? OFFSET ?\`).all(..._wv, _lim, _off)
    },
    findFirst: (opts = {}) => {
      const _w = opts?.where
      const _allowedCols2 = new Set([..._${tableName}_fields, 'id'])
      const _ob = opts?.orderBy ? Object.entries(opts.orderBy).filter(([k]) => _allowedCols2.has(k)).map(([k, d]) => \`"\${k}" \${d === 'desc' ? 'DESC' : 'ASC'}\`).join(', ') : null
      const _order = _ob ? \` ORDER BY \${_ob}\` : ''
      if (!_w || !Object.keys(_w).length) return _db.query(\`SELECT ${selectCols} FROM ${tableName}\${_order} LIMIT 1\`).get() ?? null
      const { sql: _wsql, vals: _wv } = _arcWhere(_${tableName}_fields, _w)
      if (_wsql === '0=1') return null
      return _db.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_wsql}\${_order} LIMIT 1\`).get(..._wv) ?? null
    },
    findUnique: (opts = {}) => {
      const _w = opts?.where; if (!_w) throw new Error('${tableName}.findUnique: where is required')
      const { sql: _wsql, vals: _wv } = _arcWhere(_${tableName}_fields, _w)
      if (_wsql === '0=1') return null
      const _rs = _db.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_wsql} LIMIT 2\`).all(..._wv)
      if (_rs.length > 1) throw Object.assign(new Error('${tableName}.findUnique: multiple rows'), { status: 400 })
      return _rs[0] ?? null
    },
    find: (id) => _q_${tableName}_find.get(id) ?? null,
    ${createMethod}
    ${updateMethod}
    ${deleteMethod}
    deleteMany: (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) throw new Error('${tableName}.deleteMany: where is required to prevent full-table deletion')
      const { sql: _wsql, vals: _wv } = _arcWhere(_${tableName}_fields, _w)
      if (_wsql === '0=1') return 0
      return _db.query(\`DELETE FROM ${tableName} WHERE \${_wsql}\`).run(..._wv).changes
    },
    count: (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _q_${tableName}_count.get()?.count ?? 0
      const { sql: _wsql, vals: _wv } = _arcWhere(_${tableName}_fields, _w)
      if (_wsql === '0=1') return 0
      return _db.query(\`SELECT COUNT(*) as count FROM ${tableName} WHERE \${_wsql}\`).get(..._wv)?.count ?? 0
    },
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
      const _lim = Math.min(opts?.limit ?? 20, 100000), _off = opts?.offset ?? 0
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT ${selectCols} FROM ${tableName} LIMIT $1 OFFSET $2', [_lim, _off]).then(r => r.rows)
      const { sql: _wsql, vals: _wv } = _arcWherePg(_flds, _w, 1)
      if (_wsql === '0=1') return []
      return _pool.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_wsql} LIMIT $\${_wv.length+1} OFFSET $\${_wv.length+2}\`, [..._wv, _lim, _off]).then(r => r.rows)
    },
    findFirst: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT ${selectCols} FROM ${tableName} LIMIT 1 OFFSET 0').then(r => r.rows[0] ?? null)
      const { sql: _wsql, vals: _wv } = _arcWherePg(_flds, _w, 1)
      if (_wsql === '0=1') return null
      return _pool.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_wsql} LIMIT 1\`, _wv).then(r => r.rows[0] ?? null)
    },
    findUnique: async (opts = {}) => {
      const _w = opts?.where; if (!_w) throw new Error('${tableName}.findUnique: where is required')
      const { sql: _wsql, vals: _wv } = _arcWherePg(_flds, _w, 1)
      if (_wsql === '0=1') return null
      const _rs = (await _pool.query(\`SELECT ${selectCols} FROM ${tableName} WHERE \${_wsql} LIMIT 2\`, _wv)).rows
      if (_rs.length > 1) throw Object.assign(new Error('${tableName}.findUnique: multiple rows'), { status: 400 })
      return _rs[0] ?? null
    },
    find: async (id) => _pool.query('SELECT ${selectCols} FROM ${tableName} WHERE id = $1', [id]).then(r => r.rows[0] ?? null),
    ${colList ? `create: async (data) => { const _d = _pick(data, _flds); const _miss = _req.filter(k => _d[k] == null); if (_miss.length) throw Object.assign(new Error('${tableName}.create: missing required fields: ' + _miss.join(', ')), { status: 422 }); return _pool.query('INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) RETURNING *', [${fields.map(f => this._isNowDefault(f) ? `(_d.${f.name} ?? new Date().toISOString())` : `_d.${f.name}`).join(', ')}]).then(r => r.rows[0]) },` : ''}
    ${colList ? `update: async (id, data) => { const _d = _pick(data, _flds); const _ks = Object.keys(_d); if (!_ks.length) return null; const _sets = _ks.map((k, i) => '"' + k + '" = $' + (i + 1)).join(', '); return _pool.query('UPDATE ${tableName} SET ' + _sets + ' WHERE id = $' + (_ks.length + 1) + ' RETURNING *', [..._ks.map(k => _d[k]), id]).then(r => r.rows[0]) },` : ''}
    delete: async (id) => { await _pool.query('DELETE FROM ${tableName} WHERE id = $1', [id]); return true },
    deleteMany: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) throw new Error('${tableName}.deleteMany: where is required to prevent full-table deletion')
      const { sql: _wsql, vals: _wv } = _arcWherePg(_flds, _w, 1)
      if (_wsql === '0=1') return 0
      return _pool.query(\`DELETE FROM ${tableName} WHERE \${_wsql}\`, _wv).then(r => r.rowCount ?? 0)
    },
    count: async (opts = {}) => {
      const _w = opts?.where
      if (!_w || !Object.keys(_w).length) return _pool.query('SELECT COUNT(*) as count FROM ${tableName}').then(r => +r.rows[0].count)
      const { sql: _wsql, vals: _wv } = _arcWherePg(_flds, _w, 1)
      if (_wsql === '0=1') return 0
      return _pool.query(\`SELECT COUNT(*) as count FROM ${tableName} WHERE \${_wsql}\`, _wv).then(r => +r.rows[0].count)
    },
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

  _isNowDefault(field) {
    const n = field.init
    return n?.type === 'CallExpr' && n.callee?.name === 'now' && (n.args?.length ?? 0) === 0
  }

  _fieldDefaultSql(field, dialect) {
    const node = field.init
    if (!node) return ''
    if (node.type === 'CallExpr' && node.callee?.name === 'now' && (node.args?.length ?? 0) === 0) {
      return dialect === 'postgres' ? ' DEFAULT NOW()' : ' DEFAULT CURRENT_TIMESTAMP'
    }
    if (node.type !== 'Literal') return ''
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

    const meta = []
    if (job.schedule) meta.push(`@schedule ${job.schedule}`)
    if (job.priority !== 'normal') meta.push(`@priority ${job.priority}`)
    if (job.unique) meta.push(`@unique`)

    // @progress: inject `job` context with progress() method
    const progressInject = job.hasProgress
      ? `const job = { progress: async (pct, meta = {}) => { if (typeof _currentJobId !== 'undefined') { await _queues?.${job.queueName ?? 'default'}?.updateProgress(_currentJobId, pct, meta) } } }`
      : ''

    // @then: auto-enqueue target job on success (emitted after body)
    const thenChain = job.thenJob && _SAFE_IDENT.test(job.thenJob)
      ? `await ${job.thenJob}(...[${params}])`
      : ''

    return `
// Job: ${job.name}${meta.length ? ' ' + meta.join(' ') : ''}
async function _job_${job.name}(${params}) {
  ${progressInject ? progressInject + '\n  ' : ''}${body}${thenChain ? '\n  ' + thenChain : ''}
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
      walk(node.callee); walk(node.args); walk(node.arguments)
      walk(node.object); walk(node.property)
      walk(node.elements); walk(node.properties)
      walk(node.value); walk(node.init)
      walk(node.expression); walk(node.expr); walk(node.declarations)
      walk(node.argument); walk(node.params)
      walk(node.subject); walk(node.arms); walk(node.pattern)
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
      ? `console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', method: '${route.method}', path: '${route.path}', msg: _e?.message ?? String(_e), name: _e?.name, stack: (_e?.stack ?? '').split('\\\\n').slice(0, 8) }))`
      : `console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', traceId: _traceId, method: '${route.method}', path: '${route.path}', msg: _e?.message ?? String(_e), name: _e?.name, stack: (_e?.stack ?? '').split('\\\\n').slice(0, 8) }))`

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
  try {
    const _len = +(req.headers.get('content-length') ?? 0)
    if (_len > _MAX_BODY_SIZE) return _json({ error: 'Request body too large' }, 413)
    return new Response(await req.arrayBuffer(), { headers: _HEADERS_JSON })
  } catch (_e) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', method: '${route.method}', path: '${route.path}', msg: _e?.message ?? String(_e) }))
    return _json({ error: 'Internal server error' }, 500)
  }
}`.trim()
    }

    let body
    try {
      body = route.body?.type === 'BlockStatement'
        ? emitRouteBody(route.body.body, this.jsEmitter)
        : ''
    } catch (_e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'emitter_crash', method: route.method, path: route.path, msg: _e?.message ?? String(_e) }))
      throw _e
    }

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
      authGuard += `\n    if (!${JSON.stringify(roles)}.includes(session.role)) { const _acc = req.headers.get('accept') ?? ''; return _acc.includes('application/json') ? _json({ error: 'Forbidden' }, 403) : Response.redirect('/admin/403', 302); }`
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
      ? `let _dbOk=false;try{await Promise.race([_pool.query('SELECT 1'),new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),2000))]);_dbOk=true}catch(_dbProbeErr){console.warn(JSON.stringify({ts:new Date().toISOString(),level:'warn',event:'health_db_probe_failed',msg:_dbProbeErr?.message??String(_dbProbeErr)}))}`
      : `let _dbOk=false;try{_db.query('SELECT 1').get();_dbOk=true}catch(_dbProbeErr){console.warn(JSON.stringify({ts:new Date().toISOString(),level:'warn',event:'health_db_probe_failed',msg:_dbProbeErr?.message??String(_dbProbeErr)}))}`
    return `${dbProbe}\n    return _json({ status: _dbOk ? 'ok' : 'degraded', db: _dbOk ? 'up' : 'down', queue: typeof Queue !== 'undefined' ? 'configured' : 'n/a', uptime: process.uptime(), version: process.env.npm_package_version ?? 'unknown', ts: new Date().toISOString() }, _dbOk ? 200 : 503, { 'Cache-Control': 'no-store, no-cache' })`
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

  _buildRouteTable(routes) {
    const rows = routes.map(r => ({
      method: (r.method ?? 'GET').toUpperCase(),
      path: r.path ?? '/',
      type: routeTypeLabel(r),
    }))
    rows.push({ method: 'GET', path: '/_arc/health', type: 'built-in' })
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
const _TRACE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const _ARC_FN_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/`

    const rlCheck = this.noRateLimit ? '' : `
    const _rl = _checkRateLimit(req, _bunServer)
    if (_rl) return _rl`

    const pgGuard = (this.isPg && schemas && schemas.length > 0)
      ? `\n    if (db === null) { if (_schemaInitErr) return _json({ error: 'Server initialization failed — check logs' }, 503, { 'Retry-After': '5' }); await _schemaInitP; if (_schemaInitErr || db === null) return _json({ error: 'Server initialization failed — check logs' }, 503, { 'Retry-After': '5' }) }`
      : ''

    // Item 12: startup env-var validation
    const envChecks = []
    if (hasAuth) {
      envChecks.push(`if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'arc: SESSION_SECRET env var is required in production when @auth routes are present' })); process.exit(1) }`)
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
  // fetch() handles paths not matched by the native routes object:
  // static files, admin renderer, /_arc/fn/ edge functions.
  async fetch(req, _bunServer) {
    const _u = req.url
    const _s = _u.indexOf('/', 8)
    const _q = _u.indexOf('?', _s > -1 ? _s : 8)
    let _pathname = _u.slice(_s > -1 ? _s : _u.length, _q > -1 ? _q : undefined) || '/'
    if (_pathname.includes('%')) { try { _pathname = decodeURIComponent(_pathname) } catch { return new Response('Bad Request', { status: 400 }) } }
    if (_pathname !== '/' && (_pathname.includes('..') || _pathname.includes('./'))) { try { _pathname = new URL('http://x' + _pathname).pathname } catch { return new Response('Bad Request', { status: 400 }) } }
    try { return await _serveStatic(req, _pathname) } catch (_fe) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'bun_routes_fallback_error', path: _pathname, msg: _fe?.message ?? String(_fe) }))
      return _json({ error: 'Internal server error' }, 500)
    }
  },
  ..._arcRoutes,
})
_printBanner(_server.port)
_getStaticFiles()
async function _shutdown(signal) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_shutdown_started', signal }))
  const _t = setTimeout(() => { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'server_shutdown_timeout', signal })); process.exit(0) }, 5000)
  try { await _server.stop(true) } catch {}
  clearTimeout(_t)
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_shutdown_complete', signal }))
  process.exit(0)
}
process.on('SIGTERM', () => _shutdown('SIGTERM').catch(() => process.exit(1)))
process.on('SIGINT', () => _shutdown('SIGINT').catch(() => process.exit(1)))
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
  ${fetchKeyword}(req, _bunServer) {
    ${traceSetup.trim() ? traceSetup.trim() + '\n    ' : ''}// Fast pathname extraction — avoids full URL parse (new URL() overhead)
    const _u = req.url
    const _s = _u.indexOf('/', 8)
    const _q = _u.indexOf('?', _s > -1 ? _s : 8)
    let _pathname = _u.slice(_s > -1 ? _s : _u.length, _q > -1 ? _q : undefined) || '/'
    if (_pathname.includes('%')) { try { _pathname = decodeURIComponent(_pathname) } catch { return new Response('Bad Request', { status: 400 }) } }
    if (_pathname !== '/' && (_pathname.includes('..') || _pathname.includes('./'))) { try { _pathname = new URL('http://x' + _pathname).pathname } catch { return new Response('Bad Request', { status: 400 }) } }
    try {
    if (_pathname === '/_arc/health') {
      try {
    ${healthBody}
      } catch (_he) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'health_check_error', msg: _he?.message ?? String(_he) })); return _json({ status: 'error' }, 503, { 'Cache-Control': 'no-store, no-cache' }) }
    }${profilerRouteCheck}
    ${hasMiddleware ? 'const _mwRes = await _middleware(req, _pathname); if (_mwRes) return _mwRes\n    ' : ''}${corsOptionsHandler.trim() ? corsOptionsHandler.trim() + '\n    ' : ''}${pgGuard.trim()}
    ${rlCheck.trim()}
    ${dispatchCall}
    } catch (_ue) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'unhandled_request_error', method: req.method, path: _pathname, msg: _ue?.message ?? String(_ue) })); return _json({ error: 'Internal server error' }, 500) }
  }
})
_printBanner(_server.port)
_getStaticFiles()
async function _shutdown(signal) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_shutdown_started', signal }))
  const _t = setTimeout(() => { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'server_shutdown_timeout', signal })); process.exit(0) }, 5000)
  try { await _server.stop(true) } catch {}
  clearTimeout(_t)
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_shutdown_complete', signal }))
  process.exit(0)
}
process.on('SIGTERM', () => _shutdown('SIGTERM').catch(() => process.exit(1)))
process.on('SIGINT', () => _shutdown('SIGINT').catch(() => process.exit(1)))
${this.profile ? `if (process.stdout.isTTY) {
  console.log('  \\x1b[36marc: profiler\\x1b[0m  \\x1b[2mhttp://localhost:' + _server.port + '/_arc/profiler\\x1b[0m')
  console.warn('  \\x1b[33marc: --profile is for development only — disable in production\\x1b[0m')
} else {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'profiler_active', msg: 'arc: --profile is for development only — disable in production' }))
}` : ''}
`.trim()
  }
}

module.exports = { BunServerEmitter }
