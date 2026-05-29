'use strict'

const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const { Lexer } = require('../lexer')
const { Parser } = require('../parser')
const N = require('../ast')

// Rust compiler binary — faster parsing for server-only .arc files
const _RUST_BIN = path.join(__dirname, '../../arc-compiler/target/release/arc-compiler')
const _rustAvailable = fs.existsSync(_RUST_BIN)

function parseArcFile(file, src, formatError) {
  // Try Rust compiler first (faster, handles all backend syntax)
  if (_rustAvailable) {
    try {
      const r = spawnSync(_RUST_BIN, [file], { encoding: 'utf8', timeout: 10000 })
      if (r.status === 0 && r.stdout) return JSON.parse(r.stdout)
    } catch (_) {
      // fall through to JS parser
    }
  }
  // JS parser fallback
  const lexer = new Lexer(src, file)
  let tokens
  try { tokens = lexer.tokenize() }
  catch (e) { if (formatError) formatError(e, src, file); else console.error(e.message); process.exit(1) }
  const parser = new Parser(tokens, file)
  let program
  try { program = parser.parse() }
  catch (e) { if (formatError) formatError(e, src, file); else console.error(e.message); process.exit(1) }
  return program
}
const { BunServerEmitter } = require('../emitters/server-bun')
const { CloudflareEmitter } = require('../emitters/server-cloudflare')
const { generateWranglerToml } = require('../compilers/wrangler-compiler')
const { findArcFiles } = require('../utils/fs')

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

function _routeType(route) {
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

async function buildServerOnce(projectDir, opts = {}, flags = {}, { formatError } = {}) {
  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')
  const _t0 = Date.now()

  const serverDir = fs.existsSync(path.join(absDir, 'server'))
    ? path.join(absDir, 'server')
    : absDir

  const arcFiles = findArcFiles(serverDir)
  if (arcFiles.length === 0) {
    console.error(`arc: no .arc files found in ${path.relative(process.cwd(), serverDir)}`)
    process.exit(1)
  }

  const allDeclarations = []
  for (const file of arcFiles) {
    let src
    try { src = await fs.promises.readFile(file, 'utf8') }
    catch (e) { console.error(`arc: cannot read ${file}: ${e.message}`); process.exit(1) }

    const program = parseArcFile(file, src, formatError)
    allDeclarations.push(...program.declarations)
  }

  const mergedProgram = N.Program([], allDeclarations, 0)
  const target = flags.target ?? 'bun'
  fs.mkdirSync(distDir, { recursive: true })

  if (target === 'cloudflare') {
    const emitter = new CloudflareEmitter({ hash: 'arc' })
    const { worker, schema } = emitter.emitProgram(mergedProgram)

    if (!worker.trim()) {
      console.error('arc: no route or schema declarations found in server/*.arc')
      process.exit(1)
    }

    const workerFile = path.join(distDir, 'worker.js')
    fs.writeFileSync(workerFile, worker)
    console.log(`arc: worker built → ${path.relative(process.cwd(), workerFile)} (${fmt(Buffer.byteLength(worker))})`)

    if (schema) {
      const schemaFile = path.join(distDir, 'schema.sql')
      fs.writeFileSync(schemaFile, schema)
      console.log(`arc: schema  written → ${path.relative(process.cwd(), schemaFile)}`)
    }

    const projectName = path.basename(absDir).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'arc-app'
    const wranglerPath = path.join(absDir, 'wrangler.toml')
    if (!fs.existsSync(wranglerPath)) {
      const toml = generateWranglerToml(mergedProgram, { name: projectName })
      fs.writeFileSync(wranglerPath, toml)
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
  const emitter = new BunServerEmitter({
    hash: 'arc',
    db: dbAdapter,
    noRateLimit: flags.noRateLimit ?? false,
    noTracing: flags.noTracing ?? false,
    bunRoutes: flags.bunRoutes ?? false,
    cors: flags.cors ?? null,
    profile: flags.profile ?? false,
  })
  const serverJs = emitter.emitProgram(mergedProgram)

  if (!serverJs.trim()) {
    console.error('arc: no route or schema declarations found in server/*.arc')
    process.exit(1)
  }

  const outFile = path.join(distDir, 'server.js')
  fs.writeFileSync(outFile, serverJs)

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
        const type = _routeType(r)
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
        debounceTimer = setTimeout(async () => {
          if (building) { rebuildRequested = true; return }
          do {
            building = true
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
            } finally {
              building = false
            }
          } while (rebuildRequested)
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
