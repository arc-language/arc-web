'use strict'

const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const { Lexer } = require('../lexer')
const { Parser } = require('../parser')
const N = require('../ast')

// Rust compiler binary - faster parsing for server-only .arc files
const _RUST_BIN = path.join(__dirname, '../../arc-compiler/target/release/arc-compiler')
const _rustAvailable = fs.existsSync(_RUST_BIN)

async function parseArcFile(file, src, formatError) {
  // Try Rust compiler first (faster, handles all backend syntax)
  if (_rustAvailable) {
    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile(_RUST_BIN, [file], { encoding: 'utf8', timeout: 10000 }, (err, stdout, stderr) => {
          if (err) {
            if (stderr && process.env.ARC_DEBUG) console.debug(`[arc] Rust parser failed, falling back to JS: ${stderr.trim()}`)
            reject(err)
          } else {
            if (stderr) console.warn(`arc: warning: rust compiler stderr: ${stderr.trim()}`)
            resolve(stdout)
          }
        })
      })
      if (stdout) {
        const ast = JSON.parse(stdout)
        // Structured parser errors collected by the Rust parser (formerly silent
        // eprintln + dummy token that poisoned the AST and crashed the emitter).
        //
        // Migration: opt-in strict mode now (`ARC_STRICT_PARSER=1`) so projects can
        // adopt incrementally. Default stays lenient for one release so we don't
        // break every existing codebase that has accidental whitespace/keyword bugs.
        // Next minor flips the default to strict; `ARC_ALLOW_PARSE_WARNINGS=1` becomes
        // the opt-out at that point.
        if (Array.isArray(ast.errors) && ast.errors.length > 0) {
          if (process.env.ARC_STRICT_PARSER === '1') {
            const lines = ast.errors.map(e =>
              `  ${file}:${e.line}:${e.col} — expected ${e.expected}, got ${e.got}`
            ).join('\n')
            const err = new Error(
              `arc: parser refused to emit a corrupted AST for ${file}:\n${lines}\n` +
              `Fix the syntax above, or unset ARC_STRICT_PARSER to keep the old lenient behaviour.`
            )
            err._arcStrictParser = true
            throw err
          }
          // Lenient default: surface as warnings so users see them, but keep building.
          for (const e of ast.errors) {
            console.warn(`arc: warning: ${file}:${e.line}:${e.col} — expected ${e.expected}, got ${e.got}`)
          }
        }
        // Rust compiler bug: @auth(role) annotations cause method:"(" in RouteDecl.
        // Fall through to JS parser if any route has a non-alpha method.
        const hasBrokenRoute = ast.declarations?.some(
          d => d.type === 'RouteDecl' && d.method && !/^[a-zA-Z]+$/.test(d.method)
        )
        // Rust compiler bug: @group directive produces flat RouteDecl without the prefix path.
        // Detect by checking if source has @group but Rust produced no RouteGroupDecl.
        const hasBrokenGroup = src.includes('@group') && !ast.declarations?.some(d => d.type === 'RouteGroupDecl')
        if (!hasBrokenRoute && !hasBrokenGroup) return ast
      }
    } catch (e) {
      // Strict-parser errors bypass the JS parser fallback — they're a contract
      // violation by the source, not a Rust parser limitation. Re-throw so the
      // user sees the clean error message instead of a JS parser stack trace.
      if (e && e._arcStrictParser) throw e
      // fall through to JS parser
    }
  }
  // JS parser fallback
  const lexer = new Lexer(src, file)
  let tokens
  try { tokens = lexer.tokenize() }
  catch (e) {
    if (formatError) formatError(e, src, file); else console.error(e.message)
    throw Object.assign(new Error(`arc: parse error in ${file}`), { _formatted: true })
  }
  const parser = new Parser(tokens, file)
  let program
  try { program = parser.parse() }
  catch (e) {
    if (formatError) formatError(e, src, file); else console.error(e.message)
    throw Object.assign(new Error(`arc: parse error in ${file}`), { _formatted: true })
  }
  return program
}
const { BunServerEmitter } = require('../emitters/server-bun')
const { CloudflareEmitter } = require('../emitters/server-cloudflare')
const { routeTypeLabel } = require('../emitters/route-utils')
const { generateWranglerToml } = require('../compilers/wrangler-compiler')
const { findArcFiles } = require('../utils/fs')

// Transform a file path with [param] segments into a route path.
// e.g. "users/[id].arc" → "/users/:id"
//      "media/[[...path]].arc" → "/media/*path"
// Returns null if no dynamic segments are found (plain file).
function filePathToRoutePath(filePath, serverDir) {
  const rel = path.relative(serverDir, filePath).replace(/\.arc$/, '')
  const segments = rel.split(path.sep)
  let hasDynamic = false
  const routeSegments = segments.map(seg => {
    // Catch-all [[...param]]
    const catchAll = seg.match(/^\[\[\.\.\.([a-zA-Z_][a-zA-Z0-9_]*)\]\]$/)
    if (catchAll) { hasDynamic = true; return `*${catchAll[1]}` }
    // Dynamic [param]
    const dynamic = seg.match(/^\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/)
    if (dynamic) { hasDynamic = true; return `:${dynamic[1]}` }
    return seg
  })
  return hasDynamic ? '/' + routeSegments.join('/') : null
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

const _C = process.stdout.isTTY && !process.env.NO_COLOR
const _SCYAN  = _C ? '\x1b[36m' : ''
const _SGREEN = _C ? '\x1b[32m' : ''
const _SDIM   = _C ? '\x1b[2m'  : ''
const _SRST   = _C ? '\x1b[0m'  : ''

async function buildServerOnce(projectDir, opts = {}, flags = {}, { formatError } = {}) {
  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')
  const _t0 = Date.now()

  const serverDir = fs.existsSync(path.join(absDir, 'server'))
    ? path.join(absDir, 'server')
    : absDir

  const absServerDir = path.resolve(serverDir)
  const arcFiles = findArcFiles(serverDir).filter(f => {
    const abs = path.resolve(f)
    if (!abs.startsWith(absServerDir + path.sep)) {
      console.warn(`arc: warning: skipping file outside server directory: ${f}`)
      return false
    }
    return true
  })
  if (arcFiles.length === 0) {
    throw new Error(`arc: no .arc files found in ${path.relative(process.cwd(), serverDir)}`)
  }

  // Detect middleware.arc - compiled separately, emitted as _middleware(req, pathname)
  const middlewareFile = arcFiles.find(f => path.basename(f) === 'middleware.arc')
  const routeFiles = arcFiles.filter(f => path.basename(f) !== 'middleware.arc')

  let middlewareDecls = []

  // Parse package routes (from arc.config.json `packages`, resolved by cli.js `buildServer`).
  // Each package server dir is paired with its own serverDir root for dynamic path resolution.
  const pkgServerDirs = opts.pkgServerDirs || []
  const pkgRouteFileInfos = pkgServerDirs.flatMap(dir =>
    findArcFiles(dir).filter(f => path.basename(f) !== 'middleware.arc').map(file => ({ file, serverDir: dir }))
  )
  const pkgDeclResults = await Promise.all(pkgRouteFileInfos.map(async ({ file, serverDir: pkgServerDir }) => {
    try {
      const src = await fs.promises.readFile(file, 'utf8')
      const program = await parseArcFile(file, src, formatError)
      const dynamicPath = filePathToRoutePath(file, pkgServerDir)
      if (dynamicPath) {
        for (const d of program.declarations) {
          if (d.type === 'RouteDecl' && !d._fileRoutePath) d._fileRoutePath = dynamicPath
        }
      }
      return program.declarations
    } catch (e) {
      console.error(`arc: failed to load package routes from ${file}: ${e.message}`)
      return []
    }
  }))
  const pkgDeclarations = pkgDeclResults.flat()
  if (pkgRouteFileInfos.length > 0 && pkgDeclarations.length === 0 && pkgDeclResults.some(r => r.length === 0)) {
    console.warn('arc: warning — all package route files failed to load; check errors above')
  }

  // Parse project routes.
  const projectDeclResults = await Promise.all(routeFiles.map(async (file) => {
    let src
    try { src = await fs.promises.readFile(file, 'utf8') }
    catch (e) { throw new Error(`arc: cannot read ${file}: ${e.message}`) }

    const program = await parseArcFile(file, src, formatError)

    // Attach route path derived from [param] filename segments to RouteGroupDecl/RouteDecl
    // so dynamic filenames like users/[id].arc get their path context.
    const dynamicPath = filePathToRoutePath(file, serverDir)
    if (dynamicPath) {
      for (const d of program.declarations) {
        if (d.type === 'RouteDecl' && !d._fileRoutePath) d._fileRoutePath = dynamicPath
      }
    }

    return program.declarations
  }))
  const projectDeclarations = projectDeclResults.flat()

  // Deduplicate: project routes/models shadow package routes/models by method+path or model name.
  function routeKey(d) {
    if (d.type !== 'RouteDecl') return null
    return `${(d.method || 'GET').toUpperCase()} ${d.path || d._fileRoutePath || '/'}`
  }
  const projectRouteKeys = new Set(projectDeclarations.map(routeKey).filter(Boolean))
  const projectModelNames = new Set(
    projectDeclarations.filter(d => d.type === 'ModelDecl').map(d => d.name).filter(Boolean)
  )
  const filteredPkgDecls = pkgDeclarations.filter(d => {
    const key = routeKey(d)
    if (key) return !projectRouteKeys.has(key)
    if (d.type === 'ModelDecl') return !projectModelNames.has(d.name)
    return true
  })

  const allDeclarations = [...filteredPkgDecls, ...projectDeclarations]

  if (middlewareFile) {
    let src
    try { src = await fs.promises.readFile(middlewareFile, 'utf8') }
    catch (e) { throw new Error(`arc: cannot read ${middlewareFile}: ${e.message}`) }
    const program = await parseArcFile(middlewareFile, src, formatError)
    middlewareDecls = program.declarations
  }

  const mergedProgram = N.Program([], allDeclarations, 0)
  const target = flags.target ?? 'bun'
  try { fs.mkdirSync(distDir, { recursive: true }) }
  catch (e) { throw new Error(`arc: cannot create dist directory: ${e.message}`) }

  if (target === 'cloudflare') {
    const emitter = new CloudflareEmitter({ hash: 'arc' })
    const { worker, schema } = emitter.emitProgram(mergedProgram)

    if (!worker.trim()) {
      throw new Error('arc: no route or schema declarations found in server/*.arc')
    }

    const workerFile = path.join(distDir, 'worker.js')
    await fs.promises.writeFile(workerFile, worker)
    console.log(`arc: worker built → ${path.relative(process.cwd(), workerFile)} (${fmt(Buffer.byteLength(worker))})`)

    if (schema) {
      const schemaFile = path.join(distDir, 'schema.sql')
      await fs.promises.writeFile(schemaFile, schema)
      console.log(`arc: schema  written → ${path.relative(process.cwd(), schemaFile)}`)
    }

    const projectName = path.basename(absDir).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'arc-app'
    const wranglerPath = path.join(absDir, 'wrangler.toml')
    if (!fs.existsSync(wranglerPath)) {
      const toml = generateWranglerToml(mergedProgram, { name: projectName })
      await fs.promises.writeFile(wranglerPath, toml)
      console.log(`arc: wrangler.toml written → ${path.relative(process.cwd(), wranglerPath)}`)
    }

    console.log(`\narc: next steps:`)
    console.log(`  wrangler d1 create ${projectName}-db`)
    console.log(`  # update database_id in wrangler.toml`)
    console.log(`  wrangler d1 execute ${projectName}-db --file=dist/schema.sql`)
    console.log(`  wrangler deploy`)
    return workerFile
  }

  const dbAdapter = flags.db ?? 'sqlite'
  // Load arc.config.json once for build-time configuration (storage backends, etc.)
  let arcCfg = {}
  try { arcCfg = JSON.parse(fs.readFileSync(path.join(absDir, 'arc.config.json'), 'utf8')) } catch { /* missing or invalid — use defaults */ }
  const emitter = new BunServerEmitter({
    hash: 'arc',
    db: dbAdapter,
    noRateLimit: flags.noRateLimit ?? false,
    noTracing: flags.noTracing ?? false,
    bunRoutes: flags.bunRoutes ?? false,
    cors: flags.cors ?? null,
    profile: flags.profile ?? false,
    storage: arcCfg.storage,
    versioningEnabled: opts.versioningEnabled ?? false,
    versioningConfig: opts.versioningConfig ?? {},
    searchConfig: arcCfg.search ?? {},
  })
  emitter.hasMiddleware = !!middlewareFile
  emitter.middlewareDecls = middlewareDecls
  const serverJs = emitter.emitProgram(mergedProgram)

  if (!serverJs.trim()) {
    throw new Error('arc: no route or schema declarations found in server/*.arc')
  }

  const outFile = path.join(distDir, 'server.js')
  await fs.promises.writeFile(outFile, serverJs)

  // Copy .env from project root to dist/ so the bun server (which runs from dist/)
  // can load SESSION_SECRET and other env vars via bun's automatic .env loading.
  const envSrc = path.join(absDir, '.env')
  const envDst = path.join(distDir, '.env')
  try {
    if (fs.existsSync(envSrc)) await fs.promises.copyFile(envSrc, envDst)
  } catch { /* non-fatal — server falls back to .arc-dev-secret */ }

  const size = Buffer.byteLength(serverJs)
  const _elapsed = Date.now() - _t0
  const routes = mergedProgram.declarations.filter(d => d.type === 'RouteDecl')

  if (_C) {
    const relOut = path.relative(process.cwd(), outFile)
    console.log(`\n  ${_SCYAN}⚡ arc server${_SRST}  →  ${relOut}  ${fmt(size)}\n`)
    if (routes.length > 0) {
      const maxPath = Math.max(...routes.map(r => (r.path ?? '/').length), 6)
      for (const r of routes) {
        const method = (r.method ?? 'GET').toUpperCase().padEnd(6)
        const rpath = (r.path ?? '/').padEnd(maxPath)
        const type = routeTypeLabel(r)
        console.log(`  ${_SDIM}${method}${_SRST}  ${rpath}  ${_SDIM}${type}${_SRST}`)
      }
      console.log(`  ${_SDIM}GET     /health${''.padEnd(maxPath - 7)}  built-in${_SRST}`)
      console.log()
    }
    console.log(`  ${_SGREEN}✓${_SRST}  built in ${_SDIM}${_elapsed}ms${_SRST}\n`)
  } else {
    console.log(`arc: server built → ${path.relative(process.cwd(), outFile)} (${fmt(size)})`)
  }

  return outFile
}

async function buildServer(projectDir, opts = {}, flags = {}, hooks = {}) {
  const outFile = await buildServerOnce(projectDir, opts, flags, hooks)

  if (!flags.watch) return outFile

  // --watch mode: rebuild on any .arc change in server/
  const absDir = path.resolve(projectDir)
  const serverDir = fs.existsSync(path.join(absDir, 'server'))
    ? path.join(absDir, 'server')
    : absDir

  let debounceTimer = null
  let building = false
  let rebuildRequested = false

  function watchDir(dir) {
    if (!fs.existsSync(dir)) return
    try {
      fs.watch(dir, { recursive: true }, (_, filename) => {
        if (!filename?.endsWith('.arc')) return
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          ;(async () => {
            if (building) { rebuildRequested = true; return }
            building = true
            try {
              do {
                rebuildRequested = false
                if (_C) {
                  console.log(`  ${_SCYAN}↺${_SRST}  ${_SDIM}${filename} changed${_SRST}`)
                } else {
                  console.log(`arc: ${filename} changed, rebuilding...`)
                }
                const t0 = Date.now()
                try {
                  await buildServerOnce(projectDir, opts, flags, hooks)
                  if (_C) {
                    console.log(`  ${_SGREEN}✓${_SRST}  rebuilt in ${_SDIM}${Date.now() - t0}ms${_SRST}`)
                  } else {
                    console.log(`arc: rebuilt in ${Date.now() - t0}ms`)
                  }
                } catch (e) {
                  console.error(`arc: rebuild failed: ${e?.message ?? String(e)}`)
                }
              } while (rebuildRequested)
            } finally {
              building = false
            }
          })().catch(e => {
            building = false
            console.error(`arc: watch handler fatal: ${e?.message ?? String(e)}`)
          })
        }, 50)
      })
    } catch {
      // fs.watch not available (some platforms); silently skip
    }
  }

  watchDir(serverDir)
  if (_C) {
    console.log(`  ${_SDIM}watching ${path.relative(process.cwd(), serverDir)}/**/*.arc${_SRST}`)
  } else {
    console.log(`arc: watching ${path.relative(process.cwd(), serverDir)}/**/*.arc`)
  }
  return outFile
}

module.exports = { buildServer, findArcFiles }
