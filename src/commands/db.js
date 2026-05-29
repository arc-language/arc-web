'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { Lexer } = require('../lexer')
const { Parser } = require('../parser')
const { BunServerEmitter } = require('../emitters/server-bun')
const { JsEmitter } = require('../emitters/js')
const { migrate, dropTables } = require('../compilers/migration-compiler')
const { formatError } = require('../utils/errors')

// Stdout-keyed TTY colors (consistent with arc build/dev/build-server)
const _C = process.stdout.isTTY && !process.env.NO_COLOR
const _CYAN   = _C ? '\x1b[36m' : ''
const _GREEN  = _C ? '\x1b[32m' : ''
const _YELLOW = _C ? '\x1b[33m' : ''
const _DIM    = _C ? '\x1b[2m'  : ''
const _RST    = _C ? '\x1b[0m'  : ''
const { findArcFiles } = require('../utils/fs')

function _parseDbArgs(remaining) {
  const dbIdx = remaining.indexOf('--db')
  const urlIdx = remaining.indexOf('--url')
  const dialect = dbIdx !== -1 ? remaining[dbIdx + 1] : 'sqlite'
  const urlArg = urlIdx !== -1 ? remaining[urlIdx + 1] : null
  const dry = remaining.includes('--dry')
  const noSeed = remaining.includes('--no-seed')
  const projectDir = remaining.find(a => !a.startsWith('--') && a !== dialect && a !== urlArg) ?? '.'
  return { dialect, urlArg, dry, noSeed, projectDir }
}

function _resolveDbUrl(dialect, absDir, urlArg) {
  const defaultUrl = dialect === 'postgres'
    ? (process.env.DATABASE_URL ?? 'postgres://localhost/app')
    : (process.env.DATABASE_URL ?? path.join(absDir, 'app.db'))
  return urlArg ?? defaultUrl
}

// Parse all .arc files in the server dir and extract ModelDecl nodes
function _loadSchemas(absDir, cmd) {
  const serverDir = fs.existsSync(path.join(absDir, 'server'))
    ? path.join(absDir, 'server')
    : absDir
  const arcFiles = findArcFiles(serverDir)
  if (arcFiles.length === 0) {
    console.error(`arc db ${cmd}: no .arc files found in ${path.relative(process.cwd(), serverDir)}`)
    process.exit(1)
  }
  const schemas = []
  for (const file of arcFiles) {
    let src
    try { src = fs.readFileSync(file, 'utf8') }
    catch (e) { console.error(`arc db ${cmd}: cannot read ${file}: ${e.message}`); process.exit(1) }
    try {
      const tokens = new Lexer(src, file).tokenize()
      const program = new Parser(tokens, file).parse()
      schemas.push(...program.declarations.filter(d => d.type === 'ModelDecl'))
    } catch (e) { formatError(e, src, file); process.exit(1) }
  }
  if (schemas.length === 0) {
    console.log(`arc db ${cmd}: no model declarations found — nothing to do`)
    return { schemas: null, serverDir }
  }
  return { schemas, serverDir }
}

// Summarize the columns affected by a migration report entry
function _reportCols(entry) {
  if (entry.isNew) {
    // Extract column names from CREATE TABLE statement
    const m = entry.statements[0]?.match(/\((.+)\)/)
    if (!m) return ''
    const cols = m[1].split(',').map(c => c.trim().split(/\s+/)[0])
    return `(${cols.join(', ')})`
  }
  // ALTER TABLE - show "+ colname" for each added column
  const added = entry.statements.map(s => {
    const m = s.match(/ADD COLUMN (\w+)/)
    return m ? `+${m[1]}` : null
  }).filter(Boolean)
  return `(${added.join(', ')})`
}

async function runSeed(seedFile, projectDir, opts = {}) {
  let src
  try { src = fs.readFileSync(seedFile, 'utf8') }
  catch (e) { console.error(`arc db seed: cannot read ${seedFile}: ${e.message}`); process.exit(1) }
  let tokens, program
  try {
    tokens = new Lexer(src, seedFile).tokenize()
    program = new Parser(tokens, seedFile).parse()
  } catch (e) { formatError(e, src, seedFile); process.exit(1) }

  const absDir = path.resolve(projectDir)
  const serverDir = fs.existsSync(path.join(absDir, 'server')) ? path.join(absDir, 'server') : absDir
  const arcFiles = findArcFiles(serverDir).filter(f => f !== seedFile)
  const schemas = []
  for (const file of arcFiles) {
    try {
      const fileSrc = fs.readFileSync(file, 'utf8')
      const prog = new Parser(new Lexer(fileSrc, file).tokenize(), file).parse()
      schemas.push(...prog.declarations.filter(d => d.type === 'ModelDecl'))
    } catch (e) { console.warn(`arc db seed: could not parse ${file}: ${e.message}`) }
  }

  const emitter = new BunServerEmitter({ hash: 'arc', db: opts.db ?? 'sqlite' })
  const dbPreamble = emitter.emitPreamble(schemas)
  const dbHelpers = schemas.map(s => emitter.emitModelHelpers(s)).join('\n\n')

  const jsEmitter = new JsEmitter({ hash: 'arc' })
  const seedBody = jsEmitter.emitBody(program.declarations)

  const urlExport = opts.url ? `process.env.DATABASE_URL = process.env.DATABASE_URL ?? ${JSON.stringify(opts.url)}` : ''

  const seedScript = `
'use strict'
${urlExport}
${dbPreamble}
${dbHelpers}
async function main() {
  ${seedBody}
  console.log('[arc:seed] done')
}
main().catch(e => { console.error('[arc:seed] failed:', e.message); process.exit(1) })
`.trim()

  const tmpFile = path.join(absDir, 'dist', '_seed.js')
  try {
    fs.mkdirSync(path.join(absDir, 'dist'), { recursive: true })
    fs.writeFileSync(tmpFile, seedScript, { mode: 0o600 })
  } catch (e) {
    console.error(`arc db seed: cannot write temp file: ${e.message}`)
    process.exit(1)
  }

  // Register exit cleanup before spawning so the temp file is removed even on SIGKILL
  const cleanupTmp = () => { try { fs.unlinkSync(tmpFile) } catch {} }
  process.on('exit', cleanupTmp)

  const bunCheck = spawnSync('bun', ['--version'], { stdio: 'pipe' })
  const runtime = bunCheck.status === 0 ? 'bun' : 'node'

  console.log(`arc db seed: running ${path.relative(process.cwd(), seedFile)} with ${runtime}...`)
  const result = spawnSync(runtime, [tmpFile], { stdio: 'inherit', env: process.env })

  cleanupTmp()
  process.off('exit', cleanupTmp)

  if (result.status !== 0) {
    console.error('arc db seed: seed script exited with error')
    process.exit(result.status ?? 1)
  }
}

async function dbCommand(args) {
  const sub = args[0]

  if (!sub || sub === 'help') {
    console.log('arc db <subcommand>')
    console.log('  migrate [dir] [--db sqlite|postgres] [--url <url>] [--dry]')
    console.log('                — diff models against live DB, apply missing columns/tables')
    console.log('  status  [dir] [--db sqlite|postgres] [--url <url>]')
    console.log('                — show per-model migration status without applying changes')
    console.log('  reset   [dir] [--db sqlite|postgres] [--url <url>] [--no-seed]')
    console.log('                — drop all model tables, re-migrate, and run seed.arc if present')
    console.log('  seed    [dir] [--db sqlite|postgres] [--url <url>]')
    console.log('                — run server/seed.arc')
    console.log('  studio        — open DB browser (coming in 0.3)')
    return
  }

  if (sub === 'migrate') {
    const { dialect, urlArg, dry, projectDir } = _parseDbArgs(args.slice(1))
    const absDir = path.resolve(projectDir)
    const { schemas, serverDir } = _loadSchemas(absDir, 'migrate')
    if (!schemas) return

    const url = _resolveDbUrl(dialect, absDir, urlArg)
    const urlDisplay = dialect === 'postgres' ? url : path.relative(process.cwd(), url)
    const _t0 = Date.now()

    let result
    try {
      result = await migrate(schemas, { db: dialect, url, dry })
    } catch (e) {
      console.error(`arc db migrate: ${e.message}`)
      process.exit(1)
    }

    if (result.upToDate) {
      if (_C) {
        console.log(`\n  ${_CYAN}⚡ arc db${_RST}  →  ${urlDisplay}\n`)
        console.log(`  ${_GREEN}✓${_RST}  all models up to date\n`)
      } else {
        console.log(`arc db migrate: ✓ database is up to date — no migrations needed`)
      }
      return
    }

    if (_C) {
      console.log(`\n  ${_CYAN}⚡ arc db${_RST}  →  ${urlDisplay}\n`)
      for (const entry of result.report) {
        const action = entry.isNew ? `${_GREEN}CREATE${_RST}` : `${_CYAN}ALTER ${_RST}`
        const cols = _reportCols(entry)
        console.log(`  ${action}  ${entry.table.padEnd(12)}  ${_DIM}${cols}${_RST}`)
      }
      const elapsed = Date.now() - _t0
      if (dry) {
        console.log(`\n  ${_YELLOW}dry run${_RST}  ${_DIM}no changes applied — remove --dry to apply${_RST}\n`)
      } else {
        console.log(`\n  ${_GREEN}✓${_RST}  ${result.report.length} migration${result.report.length !== 1 ? 's' : ''} applied in ${_DIM}${elapsed}ms${_RST}\n`)
      }
    } else {
      for (const entry of result.report) {
        const action = entry.isNew ? 'create' : 'alter'
        console.log(`  ${action}  ${entry.table}`)
        for (const stmt of entry.statements) console.log(`    ${stmt}`)
      }
      if (dry) {
        console.log('\ndry run — no changes applied. Remove --dry to apply.')
      } else {
        console.log(`\narc db migrate: ${result.report.length} migration(s) applied`)
      }
    }
    return
  }

  if (sub === 'status') {
    const { dialect, urlArg, projectDir } = _parseDbArgs(args.slice(1))
    const absDir = path.resolve(projectDir)
    const { schemas } = _loadSchemas(absDir, 'status')
    if (!schemas) return

    const url = _resolveDbUrl(dialect, absDir, urlArg)
    const urlDisplay = dialect === 'postgres' ? url : path.relative(process.cwd(), url)

    let result
    try {
      result = await migrate(schemas, { db: dialect, url, dry: true })
    } catch (e) {
      console.error(`arc db status: ${e.message}`)
      process.exit(1)
    }

    // Build a pending map keyed by table name for quick lookup
    const pendingMap = new Map(result.report.map(e => [e.table, e]))

    if (_C) {
      console.log(`\n  ${_CYAN}⚡ arc db status${_RST}  →  ${urlDisplay}\n`)
      const maxName = Math.max(...schemas.map(s => s.name.toLowerCase() + 's').map(n => n.length), 6)
      for (const schema of schemas) {
        const tbl = schema.name.toLowerCase() + 's'
        const pending = pendingMap.get(tbl)
        if (pending) {
          const cols = _reportCols(pending)
          console.log(`  ${tbl.padEnd(maxName)}  ${_YELLOW}△${_RST}  pending  ${_DIM}${cols}${_RST}`)
        } else {
          console.log(`  ${tbl.padEnd(maxName)}  ${_GREEN}✓${_RST}  up to date`)
        }
      }
      console.log()
    } else {
      for (const schema of schemas) {
        const tbl = schema.name.toLowerCase() + 's'
        const pending = pendingMap.get(tbl)
        console.log(`  ${tbl}  ${pending ? 'pending' : 'up to date'}`)
      }
    }
    return
  }

  if (sub === 'reset') {
    const { dialect, urlArg, noSeed, projectDir } = _parseDbArgs(args.slice(1))
    const absDir = path.resolve(projectDir)
    const { schemas, serverDir } = _loadSchemas(absDir, 'reset')
    if (!schemas) return

    const url = _resolveDbUrl(dialect, absDir, urlArg)
    const urlDisplay = dialect === 'postgres' ? url : path.relative(process.cwd(), url)
    const tableNames = schemas.map(s => s.name.toLowerCase() + 's')
    const _t0 = Date.now()

    if (_C) {
      console.log(`\n  ${_CYAN}↺${_RST}  dropping ${tableNames.length} table${tableNames.length !== 1 ? 's' : ''}  ${_DIM}(${tableNames.join(', ')})${_RST}`)
    } else {
      console.log(`arc db reset: dropping tables: ${tableNames.join(', ')}`)
    }

    try {
      await dropTables(schemas, { db: dialect, url })
    } catch (e) {
      console.error(`arc db reset: drop failed: ${e.message}`)
      process.exit(1)
    }

    if (_C) {
      console.log(`  ${_CYAN}⚡${_RST}  re-migrating...\n`)
    } else {
      console.log('arc db reset: re-migrating...')
    }

    let result
    try {
      result = await migrate(schemas, { db: dialect, url })
    } catch (e) {
      console.error(`arc db reset: migrate failed: ${e.message}`)
      process.exit(1)
    }

    if (_C) {
      for (const entry of result.report) {
        const cols = _reportCols(entry)
        console.log(`  ${_GREEN}CREATE${_RST}  ${entry.table.padEnd(12)}  ${_DIM}${cols}${_RST}`)
      }
      const elapsed = Date.now() - _t0
      console.log(`\n  ${_GREEN}✓${_RST}  reset complete — ${result.report.length} table${result.report.length !== 1 ? 's' : ''} created in ${_DIM}${elapsed}ms${_RST}`)
    } else {
      for (const entry of result.report) console.log(`  create  ${entry.table}`)
      console.log(`arc db reset: ${result.report.length} table(s) created`)
    }

    const seedFile = path.join(serverDir, 'seed.arc')
    if (!noSeed && fs.existsSync(seedFile)) {
      if (_C) {
        console.log(`  ${_DIM}running seed...${_RST}`)
      }
      await runSeed(seedFile, absDir, { db: dialect, url })
      if (_C) console.log(`  ${_GREEN}✓${_RST}  seed complete\n`)
    } else {
      if (_C) console.log()
    }
    return
  }

  if (sub === 'seed') {
    const { dialect, urlArg, projectDir } = _parseDbArgs(args.slice(1))
    const absDir = path.resolve(projectDir)
    const serverDir = fs.existsSync(path.join(absDir, 'server')) ? path.join(absDir, 'server') : absDir
    const seedFile = path.join(serverDir, 'seed.arc')

    if (!fs.existsSync(seedFile)) {
      console.error(`arc db seed: no seed file found at ${path.relative(process.cwd(), seedFile)}`)
      console.error(`  Create ${path.relative(process.cwd(), seedFile)} with db.<model>.create({...}) calls`)
      process.exit(1)
    }

    await runSeed(seedFile, absDir, { db: dialect, url: _resolveDbUrl(dialect, absDir, urlArg) })
    return
  }

  if (sub === 'studio') {
    console.log('arc db studio: coming in 0.3')
    return
  }

  console.error(`arc db: unknown subcommand "${sub}". Try: migrate, seed, studio`)
  process.exit(1)
}

module.exports = { dbCommand, runSeed }
