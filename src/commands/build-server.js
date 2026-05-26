'use strict'

const path = require('path')
const fs = require('fs')
const { Lexer } = require('../lexer')
const { Parser } = require('../parser')
const N = require('../ast')
const { BunServerEmitter } = require('../emitters/server-bun')
const { CloudflareEmitter } = require('../emitters/server-cloudflare')
const { generateWranglerToml } = require('../compilers/wrangler-compiler')
const { findArcFiles } = require('../utils/fs')

function fmt(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

async function buildServer(projectDir, opts = {}, flags = {}, { formatError } = {}) {
  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')

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

    const lexer = new Lexer(src, file)
    let tokens
    try { tokens = lexer.tokenize() }
    catch (e) { if (formatError) formatError(e, src, file); else console.error(e.message); process.exit(1) }

    const parser = new Parser(tokens, file)
    let program
    try { program = parser.parse() }
    catch (e) { if (formatError) formatError(e, src, file); else console.error(e.message); process.exit(1) }

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
  const emitter = new BunServerEmitter({ hash: 'arc', db: dbAdapter })
  const serverJs = emitter.emitProgram(mergedProgram)

  if (!serverJs.trim()) {
    console.error('arc: no route or schema declarations found in server/*.arc')
    process.exit(1)
  }

  const outFile = path.join(distDir, 'server.js')
  fs.writeFileSync(outFile, serverJs)

  const size = Buffer.byteLength(serverJs)
  console.log(`arc: server built → ${path.relative(process.cwd(), outFile)} (${fmt(size)})`)

  return outFile
}

module.exports = { buildServer, findArcFiles }
