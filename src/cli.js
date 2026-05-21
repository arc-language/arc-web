#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { Lexer } = require('./lexer')
const { Parser } = require('./parser')
const { BuildExecutor } = require('./build-exec')
const { Optimizer } = require('./optimizer')
const { HtmlEmitter } = require('./emitters/html')
const { CssEmitter } = require('./emitters/css')
const { JsEmitter } = require('./emitters/js')
const { ServerEmitter } = require('./emitters/server')
const { EdgeRenderer } = require('./edge/renderer')
const { RealtimeEmitter } = require('./realtime/client')
const { Checker } = require('./checker')
const { postProcess } = require('./post')
const { SourceMapBuilder } = require('./sourcemap')

// ── Import resolver ────────────────────────────────────────────────────────
// Reads imported .arc files, extracts their widget/fn/style declarations,
// and merges them into the importing program's declaration list.

async function resolveImports(program, projectDir, filename, visited, rootDir) {
  const topLevelRoot = rootDir ?? path.resolve(projectDir)
  const imports = program.declarations.filter(d => d.type === 'ImportDecl')
  if (imports.length === 0) return program

  const merged = program.declarations.filter(d => d.type !== 'ImportDecl')

  for (const imp of imports) {
    const src = imp.source
    if (!src || src.startsWith('arc/')) continue // stdlib — not a file

    const candidates = [
      path.resolve(projectDir, src),
      path.resolve(projectDir, src + '.arc'),
      path.resolve(projectDir, src.replace(/\.arc$/, '') + '.arc'),
    ]
    const importPath = candidates.find(p => fs.existsSync(p))
    if (!importPath) {
      console.warn(`arc: warning: import not found: ${src}`)
      continue
    }

    // Prevent directory traversal outside original project root (use topLevelRoot, not dirname)
    if (!path.resolve(importPath).startsWith(topLevelRoot + path.sep)) {
      console.warn(`arc: warning: import escapes project root, skipping: ${src}`)
      continue
    }

    if (visited.has(importPath)) continue
    visited.add(importPath)

    let importedSource
    try {
      importedSource = fs.readFileSync(importPath, 'utf8')
    } catch (e) {
      console.warn(`arc: warning: could not read import ${src}: ${e.message}`)
      continue
    }
    const lexer = new Lexer(importedSource, importPath)
    const tokens = lexer.tokenize()
    const parser = new Parser(tokens, importPath)
    let importedProgram
    try {
      importedProgram = parser.parse()
    } catch (e) {
      console.warn(`arc: warning: syntax error in import ${src}: ${e.message}`)
      continue
    }

    // Recursively resolve imports in the imported file (pass topLevelRoot to keep containment anchored)
    importedProgram = await resolveImports(
      importedProgram,
      path.dirname(importPath),
      importPath,
      visited,
      topLevelRoot
    )

    // Merge: bring in widget/fn/style declarations that match the import names
    const wantedNames = new Set([
      ...(imp.names ?? []).map(n => n.imported),
      ...(imp.defaultName ? [imp.defaultName] : []),
    ])

    for (const decl of importedProgram.declarations) {
      // Always include widgets and top-level fns that were imported by name
      if (decl.type === 'WidgetDecl' && (wantedNames.size === 0 || wantedNames.has(decl.name))) {
        merged.push(decl)
      } else if (decl.type === 'FnDecl' && wantedNames.has(decl.name)) {
        merged.push(decl)
      } else if (decl.type === 'StateDecl' && wantedNames.has(decl.name)) {
        merged.push(decl)
      }
    }
  }

  return { ...program, declarations: merged }
}

// ── Compiler ───────────────────────────────────────────────────────────────

async function compile(source, filename = '<input>', options = {}) {
  const hash = options.hash ?? hashString(filename).toString(36).slice(0, 4)
  const projectDir = options.projectDir ?? path.dirname(path.resolve(filename))

  // 1. Lex
  const lexer = new Lexer(source, filename)
  const tokens = lexer.tokenize()

  // 2. Parse
  const parser = new Parser(tokens, filename)
  let program = parser.parse()

  // 2b. Resolve imports — read imported .arc files and merge their declarations
  const initialVisited = new Set(filename !== '<input>' ? [path.resolve(filename)] : [])
  program = await resolveImports(program, projectDir, filename, initialVisited)

  // 3. Semantic check
  const checker = new Checker(filename)
  const { errors: checkErrors, warnings: checkWarnings } = checker.check(program)
  for (const w of checkWarnings) console.warn(`arc: warning: ${w}`)
  if (checkErrors.length > 0) {
    const msg = checkErrors.map(e => String(e)).join('\n')
    throw new SyntaxError(msg)
  }

  // 4. Execute @build expressions (compile-time data fetching)
  const buildExec = new BuildExecutor(projectDir)
  const buildContext = await buildExec.execute(program)
  if (buildExec.errors.length > 0) {
    buildExec.errors.forEach(e => console.warn(`arc: warning: ${e}`))
  }

  // 5. Optimize: unroll static loops, fold static conditions, inline @build values
  const optimizer = new Optimizer(buildContext)
  program = optimizer.optimizeProgram(program)

  // 6. HTML emit (also collects stateBindings + eventBindings)
  const htmlEmitter = new HtmlEmitter({ hash, buildContext })
  const html = htmlEmitter.emitProgram(program)

  // 7. CSS emit
  const cssEmitter = new CssEmitter({ hash })
  const css = cssEmitter.emitProgram(program)

  // 8. @server function compilation
  const serverEmitter = new ServerEmitter({ hash })
  const { edgeFunctions, clientStubs } = serverEmitter.emitProgram(program)

  // 9. JS emit (client-side: reactive bindings + @server client stubs + ADP mini-runtime)
  const jsEmitter = new JsEmitter({ hash, sourceMap: options.sourceMap ?? null })
  const jsReactive = jsEmitter.emitProgram(
    program,
    htmlEmitter.stateBindings,
    htmlEmitter.eventBindings
  )

  // 10. @realtime WebSocket client code
  const realtimeDecls = program.declarations.filter(d => d.type === 'RealtimeDecl')
  const realtimeEmitter = new RealtimeEmitter({ hash })
  const realtimeJs = realtimeEmitter.emitAll(realtimeDecls, htmlEmitter.stateBindings)

  // Compose final JS: ADP runtime + @server stubs + reactive + @realtime connections
  const js = composeClientJs(jsReactive, clientStubs, realtimeJs)

  // 11. @live edge renderer (if @live declarations present)
  const edgeRenderer = new EdgeRenderer({ hash })
  const liveEdgeFunction = edgeRenderer.emitProgram(
    program, html, css, js, htmlEmitter.stateBindings
  )

  return { html, css, js, edgeFunctions, liveEdgeFunction, program }
}

// Inline ADP mini-runtime for browser (encode + decode, ~600 bytes minified)
const ADP_MINI_RUNTIME = `
// ADP mini-runtime (auto-generated)
const _te=new TextEncoder();function _adpEncode(v){const b=[];function w(x){if(x===null||x===undefined){b.push(0);}else if(x===true){b.push(1);}else if(x===false){b.push(2);}else if(typeof x==='number'){if(Number.isInteger(x)&&x>=0&&x<=255){b.push(3,x);}else if(Number.isInteger(x)){b.push(4,(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);}else{b.push(5);const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,x,false);for(let i=0;i<8;i++)b.push(d.getUint8(i));}}else if(typeof x==='string'){b.push(6);const e=_te.encode(x);let l=e.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);e.forEach(c=>b.push(c));}else if(Array.isArray(x)){b.push(7);let l=x.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);x.forEach(w);}else if(typeof x==='object'){const ks=Object.keys(x);b.push(8);let l=ks.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);ks.forEach(k=>{const e=_te.encode(k);let kl=e.length;while(kl>127){b.push((kl&127)|128);kl>>>=7;}b.push(kl);e.forEach(c=>b.push(c));w(x[k]);});}}w(v);return new Uint8Array(b);}
function _adpDecode(buf){let p=0;function rv(){const t=buf[p++];if(t===0)return null;if(t===1)return true;if(t===2)return false;if(t===3)return buf[p++];if(t===4){const v=(buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3];p+=4;return v;}if(t===5){const d=new DataView(buf.buffer,buf.byteOffset+p,8);p+=8;return d.getFloat64(0,false);}if(t===6){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return new TextDecoder().decode(buf.subarray(p,p+=l));}if(t===7){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return Array.from({length:l},rv);}if(t===8){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}const o={};for(let i=0;i<l;i++){let kl=0,ks=0;while(true){const b=buf[p++];kl|=(b&127)<<ks;if(!(b&128))break;ks+=7;}const k=new TextDecoder().decode(buf.subarray(p,p+=kl));const v=rv();if(k!=='__proto__'&&k!=='constructor'&&k!=='prototype')o[k]=v;}return o;}throw new Error('ADP: unknown tag '+t);}return rv();}
`.trim()

function composeClientJs(reactive, stubs, realtime) {
  const parts = []
  if (stubs || realtime) parts.push(ADP_MINI_RUNTIME)
  if (stubs) parts.push(stubs)
  if (reactive) parts.push(reactive)
  if (realtime) parts.push(realtime)
  return parts.join('\n')
}

function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

// ── Error formatting ──────────────────────────────────────────────────────

const RED    = process.stderr.isTTY ? '\x1b[31m' : ''
const YELLOW = process.stderr.isTTY ? '\x1b[33m' : ''
const GREEN  = process.stdout.isTTY ? '\x1b[32m' : ''
const CYAN   = process.stderr.isTTY ? '\x1b[36m' : ''
const DIM    = process.stderr.isTTY ? '\x1b[2m'  : ''
const RESET  = process.stderr.isTTY ? '\x1b[0m'  : ''

function formatError(e, source, filename) {
  const msg = e.message ?? String(e)
  // Each line of the message may be a separate error (from checker)
  const lines = msg.split('\n').filter(Boolean)
  for (const line of lines) {
    console.error(`${RED}error${RESET}: ${line}`)
    // Try to extract line number from "file:line:col: message" format
    const m = line.match(/:(\d+)(?::(\d+))?:/)
    if (m && source) {
      showSourceContext(source, parseInt(m[1]), m[2] ? parseInt(m[2]) : undefined)
    }
  }
}

function showSourceContext(source, lineNum, col) {
  if (!lineNum || !source) return
  const lines = source.split('\n')
  const line = lines[lineNum - 1]
  if (!line) return
  const lineStr = String(lineNum).padStart(4)
  console.error(`${DIM}${lineStr} │${RESET} ${line}`)
  if (col && col > 0) {
    const spaces = ' '.repeat(4 + 3 + col - 1)
    console.error(`${CYAN}${spaces}^${RESET}`)
  }
}

// ── Build command ──────────────────────────────────────────────────────────

async function build(projectDir) {
  const absDir = path.resolve(projectDir)

  // Find .arc entry file
  let entryFile = path.join(absDir, 'index.arc')
  if (!fs.existsSync(entryFile)) {
    // Look for any .arc file
    let files
    try { files = fs.readdirSync(absDir).filter(f => f.endsWith('.arc')) }
    catch (e) { console.error(`arc: cannot read directory ${absDir}: ${e.message}`); process.exit(1) }
    if (files.length === 0) {
      console.error(`arc: no .arc files found in ${absDir}`)
      process.exit(1)
    }
    entryFile = path.join(absDir, files[0])
  }

  let source
  try { source = fs.readFileSync(entryFile, 'utf8') }
  catch (e) { console.error(`arc: cannot read ${path.relative(process.cwd(), entryFile)}: ${e.message}`); process.exit(1) }
  const filename = path.relative(process.cwd(), entryFile)

  const sourceMapBuilder = new SourceMapBuilder()

  let result
  try {
    result = await compile(source, filename, { projectDir: absDir, sourceMap: sourceMapBuilder })
  } catch (e) {
    formatError(e, source, filename)
    process.exit(1)
  }

  const distDir = path.join(absDir, 'dist')

  // Post-process: inline critical CSS, minify HTML, resource hints
  const withAssets = injectAssets(result.html, result.js)
  const { html: finalHtml, css: finalCss } = postProcess(withAssets, result.css)

  try {
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'index.html'), finalHtml)

    // Write CSS (still needed for non-inlined / cache reuse)
    fs.writeFileSync(path.join(distDir, 'styles.css'), finalCss)

    // Write JS (only if non-empty) + source map
    if (result.js.trim()) {
      const jsWithMapRef = result.js + '\n//# sourceMappingURL=app.js.map'
      fs.writeFileSync(path.join(distDir, 'app.js'), jsWithMapRef)

      const sourceBasename = path.basename(entryFile)
      const mapJson = sourceMapBuilder.generate('app.js', source)
      // Patch sources to point to the .arc file name
      mapJson.sources = [sourceBasename]
      fs.writeFileSync(path.join(distDir, 'app.js.map'), JSON.stringify(mapJson))
    }

    const fnDir = path.join(distDir, '_arc')

    // Write @server edge functions (if any @server fns)
    if (result.edgeFunctions?.trim()) {
      fs.mkdirSync(fnDir, { recursive: true })
      fs.writeFileSync(path.join(fnDir, 'functions.js'), result.edgeFunctions)
    }

    // Write @live edge renderer (if any @live declarations)
    if (result.liveEdgeFunction?.trim()) {
      fs.mkdirSync(fnDir, { recursive: true })
      fs.writeFileSync(path.join(fnDir, 'renderer.js'), result.liveEdgeFunction)
    }
  } catch (e) {
    console.error(`arc: error writing output files: ${e.message}`)
    process.exit(1)
  }

  // Stats
  const htmlSize = Buffer.byteLength(finalHtml)
  const cssSize = Buffer.byteLength(result.css)
  const jsSize = Buffer.byteLength(result.js)
  const edgeSize = result.edgeFunctions ? Buffer.byteLength(result.edgeFunctions) : 0
  const liveSize = result.liveEdgeFunction ? Buffer.byteLength(result.liveEdgeFunction) : 0

  console.log(`arc: built ${filename}`)
  console.log(`  HTML  ${fmt(htmlSize)}`)
  console.log(`  CSS   ${fmt(cssSize)}`)
  console.log(`  JS    ${jsSize === 0 ? '0 bytes (static)' : fmt(jsSize)}`)
  if (edgeSize > 0) console.log(`  Edge  ${fmt(edgeSize)} (@server functions)`)
  if (liveSize > 0) console.log(`  Live  ${fmt(liveSize)} (@live edge renderer)`)
  console.log(`  → ${path.relative(process.cwd(), distDir)}/`)
}

function injectAssets(html, js) {
  // Add <script> tag before </body> only if there's JS
  if (!js.trim()) return html
  return html.replace('</body>', '<script src="app.js" defer></script>\n</body>')
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} bytes`
  return `${(bytes / 1024).toFixed(1)} KB`
}

// ── Check command ──────────────────────────────────────────────────────────

async function check(files) {
  let errorCount = 0
  let warningCount = 0

  for (const file of files) {
    let source
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch (e) {
      console.error(`arc: error: could not read ${file}: ${e.message}`)
      errorCount++
      continue
    }
    try {
      // Lex + parse + check only — no emit
      const lexer = new Lexer(source, file)
      const tokens = lexer.tokenize()
      const parser = new Parser(tokens, file)
      const program = parser.parse()

      const checker = new Checker(file)
      const { errors, warnings } = checker.check(program)

      for (const w of warnings) {
        console.warn(`  ${YELLOW}warn${RESET}  ${w}`)
        warningCount++
      }

      if (errors.length === 0) {
        console.log(`  ${GREEN}✓${RESET}  ${file}`)
      } else {
        for (const e of errors) {
          console.error(`  ${RED}✗${RESET}  ${e}`)
          showSourceContext(source, e.line, e.col)
          errorCount++
        }
      }
    } catch (e) {
      console.error(`  ${RED}✗${RESET}  ${file}`)
      formatError(e, source, file)
      errorCount++
    }
  }

  if (errorCount > 0 || warningCount > 0) {
    const parts = []
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`)
    if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`)
    console.log(`\narc: ${parts.join(', ')}`)
  }
  if (errorCount > 0) process.exit(1)
}

// ── New command ────────────────────────────────────────────────────────────

function newProject(name, template = 'default') {
  const dir = path.resolve(name)

  if (fs.existsSync(dir)) {
    const existing = fs.readdirSync(dir)
    if (existing.length > 0) {
      console.error(`arc: "${name}" already exists and is not empty`)
      process.exit(1)
    }
  }

  fs.mkdirSync(dir, { recursive: true })

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const TEMPLATES = {
    default: {
      'index.arc': `page "${name}"
  heading "Welcome to ${name}"
  text "Edit index.arc to get started."

  design
    body
      font: system-ui, sans-serif
      m: 0
      p: 32px
    h1
      fg: #111827
      size: 2rem
`,
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          build: 'arc build .',
          dev: 'arc dev .',
          check: 'arc check index.arc',
        },
      }, null, 2) + '\n',
      '.gitignore': 'dist/\nnode_modules/\n',
    },

    counter: {
      'index.arc': `page "Counter"
  @state let count = 0

  col gap="24px" align="center"
    heading "Counter"
    text class="count" "{count}"
    row gap="12px"
      button on:click={ count -= 1 } "−"
      button on:click={ count += 1 } "+"
      button on:click={ count = 0 } "Reset"

  design
    body
      font: system-ui, sans-serif
      display: flex
      align-items: center
      justify-content: center
      min-h: 100vh
      m: 0
      bg: #f9fafb
    .count
      size: 4rem
      weight: 700
      fg: #111
      text-align: center
    button
      p: 10px 24px
      bg: #111
      fg: white
      border: none
      radius: 8px
      size: 1rem
      cursor: pointer
`,
      '.gitignore': 'dist/\nnode_modules/\n',
    },

    blog: {
      'index.arc': `page "My Blog"
  @build const posts = [
    { title: "Hello, Arc!", date: "2026-01-01", body: "My first Arc post." },
    { title: "Zero JS", date: "2026-01-15", body: "This page has no JavaScript." }
  ]

  col gap="32px"
    heading "My Blog"
    for post in posts
      card
        heading size=2 "{post.title}"
        text class="date" "{post.date}"
        text "{post.body}"

  design
    body
      font: system-ui, sans-serif
      max-w: 640px
      m: 0 auto
      p: 32px 16px
    .date
      fg: #6b7280
      size: 14px
`,
      '.gitignore': 'dist/\nnode_modules/\n',
    },
  }

  const files = TEMPLATES[template] ?? TEMPLATES.default
  if (!TEMPLATES[template] && template !== 'default') {
    console.error(`arc: unknown template "${template}". Available: ${Object.keys(TEMPLATES).join(', ')}`)
    process.exit(1)
  }

  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content)
  }

  const templateLabel = template !== 'default' ? ` (${template})` : ''
  console.log(`\n  ${GREEN}✓${RESET}  Created ${name}/${templateLabel}`)
  console.log('')
  for (const f of Object.keys(files)) {
    console.log(`     ${DIM}${f}${RESET}`)
  }
  console.log('')
  console.log('  Next steps:')
  console.log(`    ${CYAN}cd ${name}${RESET}`)
  console.log(`    ${CYAN}arc dev${RESET}`)
  console.log('')
}

// ── Dev server ────────────────────────────────────────────────────────────
// Serves dist/ over HTTP with:
//   - Automatic browser reload via Server-Sent Events
//   - Injects a tiny <script> into HTML to listen for reload events
//   - Rebuilds on .arc file changes

const http = require('http')
const RELOAD_SCRIPT = `<script>
(function(){
  const es = new EventSource('/_arc/reload');
  es.onmessage = () => location.reload();
  es.onerror = () => setTimeout(() => location.reload(), 500);
})()
</script>`

async function dev(projectDir) {
  await build(projectDir)

  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')
  const rawPort = parseInt(process.env.PORT ?? '3000')
  const port = (Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536) ? rawPort : 3000
  if (rawPort !== port) console.warn(`arc: invalid PORT value, using 3000`)

  // SSE clients waiting for reload signal
  const reloadClients = new Set()

  // HTTP server: serves dist/ and handles /_arc/reload SSE
  const server = http.createServer((req, res) => {
    if (req.url === '/_arc/reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      res.write('retry: 1000\n\n')
      reloadClients.add(res)
      req.on('close', () => reloadClients.delete(res))
      res.on('error', () => reloadClients.delete(res))
      return
    }

    let urlPath
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0])
    } catch {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html'

    const filePath = path.resolve(distDir, urlPath.replace(/^\//, ''))
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    const ext = path.extname(filePath)
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    }

    try {
      let content = fs.readFileSync(filePath)
      const mime = mimeTypes[ext] ?? 'application/octet-stream'

      // Inject reload script into HTML
      if (ext === '.html') {
        content = Buffer.from(
          content.toString().replace('</body>', `${RELOAD_SCRIPT}\n</body>`)
        )
      }

      res.writeHead(200, { 'Content-Type': mime })
      res.end(content)
    } catch (e) {
      // Only fall back to SPA index.html for missing files, not for read errors
      if (e.code !== 'ENOENT') {
        res.writeHead(500)
        res.end('Internal error')
        return
      }
      try {
        let html = fs.readFileSync(path.join(distDir, 'index.html')).toString()
        html = html.replace('</body>', `${RELOAD_SCRIPT}\n</body>`)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('Not found')
      }
    }
  })

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`arc: port ${port} already in use. Set PORT env var to use a different port.`)
    } else {
      console.error(`arc: server error: ${e.message}`)
    }
    process.exit(1)
  })
  server.listen(port, () => {
    console.log(`arc: dev server → http://localhost:${port}`)
  })

  const shutdown = () => {
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // File watcher with debounce to avoid multiple rebuilds per save
  console.log('arc: watching for changes...')
  let _rebuildTimer = null
  let _building = false
  let _pendingRebuild = false
  const watchHandler = (event, changedFile) => {
    if (!changedFile || !changedFile.endsWith('.arc')) return
    if (changedFile.includes('dist' + path.sep) || changedFile.includes('dist/')) return

    clearTimeout(_rebuildTimer)
    _rebuildTimer = setTimeout(async () => {
      if (_building) { _pendingRebuild = true; return }
      do {
        _building = true
        _pendingRebuild = false
        console.log(`arc: ${changedFile} changed, rebuilding...`)
        try {
          await build(projectDir)
          for (const client of [...reloadClients]) {
            try { client.write('data: reload\n\n') } catch { reloadClients.delete(client) }
          }
          console.log(`arc: reload → ${reloadClients.size} browser${reloadClients.size !== 1 ? 's' : ''}`)
        } catch (e) {
          try { formatError(e, null, changedFile) } catch (e2) { console.error(e2) }
        } finally {
          _building = false
        }
      } while (_pendingRebuild)
    }, 50)
  }
  try {
    const watcher = fs.watch(absDir, { recursive: true }, watchHandler)
    watcher.on('error', e => console.error(`arc: watcher error: ${e.message}`))
  } catch (e) {
    console.error(`arc: could not start file watcher: ${e.message}`)
    console.error('arc: automatic rebuilds disabled — run \'arc build\' manually after changes')
  }
}

// ── Deploy command ────────────────────────────────────────────────────────

const VALID_TARGETS = ['cloudflare', 'deno', 'bun', 'node']

async function deploy(projectDir, target) {
  if (!VALID_TARGETS.includes(target)) {
    console.error(`arc: unknown deploy target "${target}". Valid targets: ${VALID_TARGETS.join(', ')}`)
    process.exit(1)
  }

  // 1. Build first
  await build(projectDir)

  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')

  // 2. Read dist files
  const htmlPath = path.join(distDir, 'index.html')
  const cssPath  = path.join(distDir, 'styles.css')
  const jsPath   = path.join(distDir, 'app.js')
  const edgePath = path.join(distDir, '_arc', 'functions.js')

  const html          = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : ''
  const css           = fs.existsSync(cssPath)  ? fs.readFileSync(cssPath, 'utf8')  : ''
  const js            = fs.existsSync(jsPath)   ? fs.readFileSync(jsPath, 'utf8')   : ''
  const edgeFunctions = fs.existsSync(edgePath) ? fs.readFileSync(edgePath, 'utf8') : ''

  const projectName = path.basename(absDir).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'arc-app'

  // 3. Generate deployment artifacts (static dispatch — no dynamic require)
  const deployModules = {
    cloudflare: () => require('./deploy/cloudflare'),
    deno:       () => require('./deploy/deno'),
    bun:        () => require('./deploy/bun'),
    node:       () => require('./deploy/node'),
  }
  const deployer = deployModules[target]()
  const files = deployer.generate({ html, css, js, edgeFunctions, projectName })

  // 4. Write output files to project root
  for (const { path: filePath, content } of files) {
    const outPath = path.join(absDir, filePath)
    fs.writeFileSync(outPath, content)
    console.log(`arc: wrote ${path.relative(process.cwd(), outPath)}`)
  }

  // 5. Print next steps
  console.log(`\narc: deploy target → ${target}`)
  if (target === 'cloudflare') {
    console.log('  Next steps:')
    console.log('    npm install -g wrangler')
    console.log('    wrangler login')
    console.log('    wrangler deploy')
  } else if (target === 'deno') {
    console.log('  Next steps:')
    console.log('    deno run --allow-net server.ts')
    console.log('    # or deploy: deployctl deploy --project=<name> server.ts')
  } else if (target === 'bun') {
    console.log('  Next steps:')
    console.log('    bun run server.js')
  } else if (target === 'node') {
    console.log('  Next steps:')
    console.log('    node server.js')
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv

async function main() {
  switch (cmd) {
    case 'build':
      await build(args[0] ?? '.')
      break

    case 'check':
      if (args.length === 0) {
        const found = findArcFiles('.')
        await check(found)
      } else {
        await check(args)
      }
      break

    case 'new': {
      if (!args[0]) {
        console.error('arc new <name> [--template default|counter|blog]')
        process.exit(1)
      }
      const tmplIdx = args.indexOf('--template')
      const template = tmplIdx !== -1 ? args[tmplIdx + 1] : 'default'
      newProject(args[0], template)
      break
    }

    case 'dev':
      await dev(args[0] ?? '.')
      break

    case 'deploy': {
      const targetIdx = args.indexOf('--target')
      const target = targetIdx !== -1 ? args[targetIdx + 1] : 'cloudflare'
      const deployDir = args.find(a => !a.startsWith('--') && a !== args[targetIdx + 1]) ?? '.'
      await deploy(deployDir, target)
      break
    }

    case '--version':
    case '-v':
      console.log(require('../package.json').version)
      break

    default:
      console.log('arc — a new language for the web')
      console.log('')
      console.log('Usage:')
      console.log('  arc build [dir]     Compile to HTML/CSS/JS')
      console.log('  arc dev [dir]       Build and watch for changes')
      console.log('  arc check [files]   Type-check without emitting')
      console.log('  arc new <name>      Create a new Arc project (--template default|counter|blog)')
      console.log('  arc deploy [dir]    Deploy to hosting (--target cloudflare|deno|bun|node)')
      console.log('  arc --version       Print version')
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(`arc: fatal: ${e.message}`)
    if (process.env.ARC_DEBUG) console.error(e.stack)
    process.exit(1)
  })
}

function findArcFiles(dir) {
  const results = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch (e) { console.warn(`arc: warning: cannot read directory ${dir}: ${e.message}`); return results }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...findArcFiles(path.join(dir, entry.name)))
    } else if (entry.isFile() && entry.name.endsWith('.arc')) {
      results.push(path.join(dir, entry.name))
    }
  }
  return results
}

module.exports = { compile }
