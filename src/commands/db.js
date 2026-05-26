'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { Lexer } = require('../lexer')
const { Parser } = require('../parser')
const { BunServerEmitter } = require('../emitters/server-bun')
const { JsEmitter } = require('../emitters/js')
const { migrate } = require('../compilers/migration-compiler')
const { GREEN, YELLOW, CYAN, DIM, RESET, formatError } = require('../utils/errors')
const { findArcFiles } = require('../utils/fs')

function _parseDbArgs(remaining) {
  const dbIdx = remaining.indexOf('--db')
  const urlIdx = remaining.indexOf('--url')
  const dialect = dbIdx !== -1 ? remaining[dbIdx + 1] : 'sqlite'
  const urlArg = urlIdx !== -1 ? remaining[urlIdx + 1] : null
  const dry = remaining.includes('--dry')
  const projectDir = remaining.find(a => !a.startsWith('--') && a !== dialect && a !== urlArg) ?? '.'
  return { dialect, urlArg, dry, projectDir }
}

function _resolveDbUrl(dialect, absDir, urlArg) {
  const defaultUrl = dialect === 'postgres'
    ? (process.env.DATABASE_URL ?? 'postgres://localhost/app')
    : (process.env.DATABASE_URL ?? path.join(absDir, 'app.db'))
  return urlArg ?? defaultUrl
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

  const urlExport = `process.env.DATABASE_URL = process.env.DATABASE_URL ?? ${JSON.stringify(opts.url ?? '')}`

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

  const bunCheck = spawnSync('bun', ['--version'], { stdio: 'pipe' })
  const runtime = bunCheck.status === 0 ? 'bun' : 'node'

  console.log(`arc db seed: running ${path.relative(process.cwd(), seedFile)} with ${runtime}...`)
  const result = spawnSync(runtime, [tmpFile], { stdio: 'inherit', env: process.env })

  try { fs.unlinkSync(tmpFile) } catch {}

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
    console.log('  seed    [dir] — run server/seed.arc (coming soon)')
    console.log('  studio        — open DB browser (coming soon)')
    return
  }

  if (sub === 'migrate') {
    const { dialect, urlArg, dry, projectDir } = _parseDbArgs(args.slice(1))
    const absDir = path.resolve(projectDir)
    const serverDir = fs.existsSync(path.join(absDir, 'server'))
      ? path.join(absDir, 'server')
      : absDir
    const arcFiles = findArcFiles(serverDir)

    if (arcFiles.length === 0) {
      console.error(`arc db migrate: no .arc files found in ${path.relative(process.cwd(), serverDir)}`)
      process.exit(1)
    }

    const schemas = []
    for (const file of arcFiles) {
      let src
      try { src = fs.readFileSync(file, 'utf8') }
      catch (e) { console.error(`arc db migrate: cannot read ${file}: ${e.message}`); process.exit(1) }
      try {
        const tokens = new Lexer(src, file).tokenize()
        const program = new Parser(tokens, file).parse()
        schemas.push(...program.declarations.filter(d => d.type === 'ModelDecl'))
      } catch (e) { formatError(e, src, file); process.exit(1) }
    }

    if (schemas.length === 0) {
      console.log('arc db migrate: no model declarations found — nothing to migrate')
      return
    }

    const url = _resolveDbUrl(dialect, absDir, urlArg)
    console.log(`arc db migrate: checking ${schemas.length} model(s) against ${dialect === 'postgres' ? url : path.relative(process.cwd(), url)}${dry ? ' (dry run)' : ''}`)

    let result
    try {
      result = await migrate(schemas, { db: dialect, url, dry })
    } catch (e) {
      console.error(`arc db migrate: ${e.message}`)
      process.exit(1)
    }

    if (result.upToDate) {
      console.log(`${GREEN}✓${RESET}  Database is up to date — no migrations needed`)
      return
    }

    for (const entry of result.report) {
      const action = entry.isNew ? `${GREEN}create${RESET}` : `${CYAN}alter${RESET}`
      console.log(`  ${action}  ${entry.table}`)
      for (const stmt of entry.statements) {
        console.log(`    ${DIM}${stmt}${RESET}`)
      }
    }

    if (dry) {
      console.log(`\n${YELLOW}dry run — no changes applied. Remove --dry to apply.${RESET}`)
    } else {
      console.log(`\n${GREEN}✓${RESET}  ${result.report.length} migration(s) applied`)
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
      console.error(`  Create ${path.relative(process.cwd(), seedFile)} with db.model.create({...}) calls`)
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
