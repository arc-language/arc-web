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
const { ImagePipeline, collectImgRefs } = require('./img-pipeline')
const { RealtimeEmitter } = require('./realtime/client')
const { Checker } = require('./checker')
const { postProcess, PostProcessor } = require('./post')
const { SourceMapBuilder } = require('./sourcemap')
const { buildServer: _buildServerImpl } = require('./commands/build-server')
const { serve: _serveImpl, createFileWatcher } = require('./commands/serve')
const { dbCommand: _dbCommandImpl } = require('./commands/db')
const { scaffold: _scaffoldImpl, scaffoldAll: _scaffoldAllImpl, scaffoldBlock: _scaffoldBlockImpl, scaffoldBlockInit: _scaffoldBlockInitImpl } = require('./commands/scaffold')
const { cmsInit: _cmsInitImpl } = require('./commands/cms')
const { newProject, detectPackageManager, runWizard } = require('./new-command')
const { emit: emitSiteMeta } = require('./emitters/site-meta')
const { emit: emitHeadersManifest } = require('./emitters/headers-manifest')
const { RED, GREEN, YELLOW, CYAN, DIM, RESET, formatError, showSourceContext } = require('./utils/errors')
const { findArcFiles } = require('./utils/fs')
const N = require('./ast')

// Stdout-specific colors (build output goes to stdout, errors to stderr)
const _TTY = process.stdout.isTTY && !process.env.NO_COLOR
const _OCYAN  = _TTY ? '\x1b[36m' : ''
const _OGREEN = _TTY ? '\x1b[32m' : ''
const _ODIM   = _TTY ? '\x1b[2m'  : ''
const _ORST   = _TTY ? '\x1b[0m'  : ''

// ── Import resolver ────────────────────────────────────────────────────────
// Reads imported .arc files, extracts their widget/fn/style declarations,
// and merges them into the importing program's declaration list.

// visited: Map<importPath, importedProgram> - caches parsed+resolved programs.
// Prevents re-parsing and infinite recursion, but still processes named exports on repeat imports.
async function resolveImports(program, projectDir, filename, visited, rootDir, depsOut) {
  const topLevelRoot = rootDir ?? path.resolve(projectDir)
  const imports = program.declarations.filter(d => d.type === 'ImportDecl')
  if (imports.length === 0) return program

  const merged = program.declarations.filter(d => d.type !== 'ImportDecl')

  for (const imp of imports) {
    const src = imp.source
    if (!src || src.startsWith('arc/')) continue // stdlib - not a file

    const fileDir = path.dirname(path.resolve(projectDir, filename))
    const candidates = [
      path.resolve(projectDir, src),
      path.resolve(projectDir, src + '.arc'),
      path.resolve(projectDir, src.replace(/\.arc$/, '') + '.arc'),
      path.resolve(fileDir, src),
      path.resolve(fileDir, src + '.arc'),
    ]
    const importPath = candidates.find(p => fs.existsSync(p))
    if (!importPath) {
      console.warn(`arc: warning: import not found: ${src}`)
      continue
    }

    // Prevent directory traversal and symlink traversal outside original project root.
    // path.resolve() does NOT follow symlinks; fs.realpathSync() does - use it to
    // canonicalize before the boundary check so symlinks can't escape the project root.
    let realImportPath
    try { realImportPath = fs.realpathSync(importPath) } catch { realImportPath = importPath }
    const realTopLevelRoot = (() => { try { return fs.realpathSync(topLevelRoot) } catch { return topLevelRoot } })()
    if (!realImportPath.startsWith(realTopLevelRoot + path.sep) && realImportPath !== realTopLevelRoot) {
      console.warn(`arc: warning: import escapes project root, skipping: ${src}`)
      continue
    }

    // Use cached program if already parsed; null means currently resolving (circular).
    let importedProgram
    if (visited.has(importPath)) {
      importedProgram = visited.get(importPath)
      if (!importedProgram) continue  // circular import in progress — skip
    } else {
      // Mark as in-progress (null) before recursing to catch circular imports
      visited.set(importPath, null)
      depsOut?.add(importPath)

      let importedSource
      try {
        importedSource = await fs.promises.readFile(importPath, 'utf8')
      } catch (e) {
        console.warn(`arc: warning: could not read import ${src}: ${e.message}`)
        visited.delete(importPath)
        continue
      }
      const lexer = new Lexer(importedSource, importPath)
      const tokens = lexer.tokenize()
      const parser = new Parser(tokens, importPath)
      try {
        importedProgram = parser.parse()
      } catch (e) {
        console.warn(`arc: warning: syntax error in import ${src}: ${e.message}`)
        visited.delete(importPath)
        continue
      }

      // Recursively resolve imports in the imported file (pass topLevelRoot to keep containment anchored)
      importedProgram = await resolveImports(
        importedProgram,
        path.dirname(importPath),
        importPath,
        visited,
        topLevelRoot,
        depsOut
      )
      // Cache the resolved program for subsequent imports of the same file
      visited.set(importPath, importedProgram)
    }

    // Merge: bring in widget/fn/style declarations that match the import names
    const wantedNames = new Set([
      ...(imp.names ?? []).map(n => n.imported),
      ...(imp.defaultName ? [imp.defaultName] : []),
    ])

    // When importing a widget, also bring in supporting FnDecl/StateDecl from the same file.
    // Widget libraries define helpers alongside their widgets; importing a widget implicitly
    // requires those helpers (e.g. the fireworks engine that the Fireworks widget depends on).
    const importingWidget = importedProgram.declarations.some(d =>
      d.type === 'WidgetDecl' && (wantedNames.size === 0 || wantedNames.has(d.name))
    )

    for (const decl of importedProgram.declarations) {
      // Always include widgets and top-level fns that were imported by name
      if (decl.type === 'WidgetDecl' && (wantedNames.size === 0 || wantedNames.has(decl.name))) {
        // Deduplicate: skip if same-named widget already merged (e.g. same file imported twice)
        if (!merged.some(d => d.type === 'WidgetDecl' && d.name === decl.name)) {
          merged.push(decl)
        }
      } else if (decl.type === 'FnDecl' && (wantedNames.has(decl.name) || importingWidget)) {
        if (!merged.some(d => d.type === 'FnDecl' && d.name === decl.name)) {
          merged.push(decl)
        }
      } else if (decl.type === 'StateDecl' && (wantedNames.has(decl.name) || importingWidget)) {
        if (!merged.some(d => d.type === 'StateDecl' && d.name === decl.name)) {
          merged.push(decl)
        }
      } else if (decl.type === 'DesignBlock') {
        // Always merge design blocks (they define CSS tokens/globals, no name to match)
        merged.push(decl)
      }
    }
  }

  return { ...program, declarations: merged }
}

// ── Compiler ───────────────────────────────────────────────────────────────

// H5: Traverse the program AST to find the first @image/imageFormats declaration
// and build the image formats list. Returns the formats array or undefined.
function _resolveImageFormats(program) {
  for (const d of program.declarations ?? []) {
    if (d.type === 'PageDecl' && d.meta?.imageFormats) {
      const v = d.meta.imageFormats
      // Static array literal expected
      if (v?.type === 'ArrayLiteral' || Array.isArray(v?.elements)) {
        return (v.elements ?? v).map(e => e?.value ?? e).filter(Boolean)
      }
    }
  }
  return undefined
}

function _collectCssImports(program) {
  const pkgs = []
  function walk(nodes) {
    if (!Array.isArray(nodes)) return
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue
      if (n.type === 'CssImport') { pkgs.push(n.pkg); continue }
      if (n.body) walk(Array.isArray(n.body) ? n.body : [n.body])
      if (n.children) walk(n.children)
      if (n.declarations) walk(n.declarations)
    }
  }
  walk(program.declarations)
  return pkgs
}

function _resolveCssFile(cssPath, visited = new Set()) {
  if (visited.has(cssPath)) return ''
  visited.add(cssPath)
  let src
  try { src = fs.readFileSync(cssPath, 'utf8') } catch { return '' }
  const dir = path.dirname(cssPath)
  // Resolve @import "..." or @import './...' statements inline
  return src.replace(/@import\s+["']([^"']+)["'];?/g, (_, imp) => {
    if (imp.startsWith('http://') || imp.startsWith('https://')) return ''
    const resolved = path.resolve(dir, imp)
    return _resolveCssFile(resolved, visited)
  })
}

function _resolveCssPackages(pkgs, rootDir) {
  const parts = []
  for (const pkg of pkgs) {
    // Walk up from rootDir to find node_modules containing the package
    let dir = rootDir
    let cssPath = null
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'node_modules', pkg)
      if (fs.existsSync(candidate)) {
        // Resolve main CSS file via package.json style/main fields or index.css
        let entry = null
        try {
          const pkgJson = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'))
          entry = pkgJson.style ?? pkgJson.main ?? null
          if (entry && !entry.endsWith('.css')) entry = null
        } catch {}
        if (!entry) entry = 'index.css'
        cssPath = path.join(candidate, entry)
        break
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    if (!cssPath || !fs.existsSync(cssPath)) {
      console.warn(`arc: warning: @css "${pkg}" — package not found in node_modules`)
      continue
    }
    const resolved = _resolveCssFile(cssPath)
    if (resolved) parts.push(resolved)
  }
  return parts.length > 0 ? parts.join('\n') : null
}

async function compile(source, filename = '<input>', options = {}) {
  const hash = options.hash ?? hashString(filename).toString(36).slice(0, 4)
  const projectDir = options.projectDir ?? path.dirname(path.resolve(filename))
  const { depsOut } = options

  // 1. Lex
  const lexer = new Lexer(source, filename)
  const tokens = lexer.tokenize()

  // 2. Parse
  const parser = new Parser(tokens, filename)
  let program = parser.parse()

  // 2b. Resolve imports - read imported .arc files and merge their declarations
  const initialVisited = new Map(filename !== '<input>' ? [[path.resolve(filename), null]] : [])
  program = await resolveImports(program, projectDir, filename, initialVisited, options.rootDir, depsOut)

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

  // 5b. Image pipeline: collect <img src=...> refs, run sharp-based pre-pass.
  // Pipeline is a no-op when sharp is unavailable (returns null from emitPicture);
  // emitter then falls back to plain <img>.
  const imgRefs = collectImgRefs(program)
  let imgPipeline = null
  if (imgRefs.length > 0 && options.distDir) {
    const formats = _resolveImageFormats(program)
    if (options.sharedImgPipeline) {
      // Multi-page build: reuse the shared pipeline so concurrent pages don't race on the same image
      imgPipeline = options.sharedImgPipeline
    } else {
      imgPipeline = new ImagePipeline({
        srcDir: projectDir,
        outDir: options.distDir,
        ...(formats ? { formats } : {}),
      })
    }
    await imgPipeline.processAll(imgRefs)
  }

  // 6. HTML emit (also collects stateBindings + eventBindings)
  const htmlEmitter = new HtmlEmitter({ hash, buildContext, imgPipeline, allowRaw: true })
  const html = htmlEmitter.emitProgram(program)

  // 7. CSS emit
  const cssEmitter = new CssEmitter({ hash })
  let css = cssEmitter.emitProgram(program)
  // Tree-shake unused base utility classes (sr-only, skip-link, row, col, etc.)
  // based on what's actually referenced in the emitted HTML.
  css = treeshakeBaseCss(css, html)

  // 7b. @css package imports - resolve npm CSS from node_modules and bundle inline
  const cssImports = _collectCssImports(program)
  if (cssImports.length > 0) {
    const rootDir = options.rootDir ?? options.projectDir ?? path.dirname(path.resolve(filename))
    const bundled = _resolveCssPackages(cssImports, rootDir)
    if (bundled) css = bundled + '\n' + css
  }

  // 8. @server function compilation
  const serverEmitter = new ServerEmitter({ hash })
  const { edgeFunctions, clientStubs, handlerNames } = serverEmitter.emitProgram(program)

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

  return { html, css, js, edgeFunctions, liveEdgeFunction, handlerNames, program }
}

// Inline ADP mini-runtime for browser (encode + decode, ~600 bytes minified)
const ADP_MINI_RUNTIME = `
// ADP mini-runtime (auto-generated)
const _te=new TextEncoder();function _adpEncode(v){const b=[];function w(x){if(x===null||x===undefined){b.push(0);}else if(x===true){b.push(1);}else if(x===false){b.push(2);}else if(typeof x==='number'){if(Number.isInteger(x)&&x>=0&&x<=255){b.push(3,x);}else if(Number.isInteger(x)){b.push(4,(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);}else{b.push(5);const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,x,false);for(let i=0;i<8;i++)b.push(d.getUint8(i));}}else if(typeof x==='string'){b.push(6);const e=_te.encode(x);let l=e.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);e.forEach(c=>b.push(c));}else if(Array.isArray(x)){b.push(7);let l=x.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);x.forEach(w);}else if(typeof x==='object'){const ks=Object.keys(x);b.push(8);let l=ks.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);ks.forEach(k=>{const e=_te.encode(k);let kl=e.length;while(kl>127){b.push((kl&127)|128);kl>>>=7;}b.push(kl);e.forEach(c=>b.push(c));w(x[k]);});}}w(v);return new Uint8Array(b);}
function _adpDecode(buf){let p=0;function rv(){const t=buf[p++];if(t===0)return null;if(t===1)return true;if(t===2)return false;if(t===3)return buf[p++];if(t===4){const v=(buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3];p+=4;return v;}if(t===5){const d=new DataView(buf.buffer,buf.byteOffset+p,8);p+=8;return d.getFloat64(0,false);}if(t===6){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return new TextDecoder().decode(buf.subarray(p,p+=l));}if(t===7){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return Array.from({length:l},rv);}if(t===8){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}const o={};for(let i=0;i<l;i++){let kl=0,ks=0;while(true){const b=buf[p++];kl|=(b&127)<<ks;if(!(b&128))break;ks+=7;}const k=new TextDecoder().decode(buf.subarray(p,p+=kl));const v=rv();if(k!=='__proto__'&&k!=='constructor'&&k!=='prototype')o[k]=v;}return o;}throw new Error('ADP: unknown tag '+t);}return rv();}
`.trim()

// Strip base utility CSS rules whose class names never appear in the emitted HTML.
// Safe: utilities are simple single-class selectors; if the class isn't referenced,
// the rule cannot match anything.
function treeshakeBaseCss(css, html) {
  const utilities = [
    'arc-row', 'arc-col', 'arc-center', 'arc-spacer', 'arc-wrap',
    'arc-sr-only', 'arc-skip-link', 'arc-card',
  ]
  // Single HTML scan to determine which utilities are referenced (both quote styles in one pass)
  const usedClasses = new Set()
  const classRe = /class\s*=\s*["']([^"']*)["']/g
  let m
  while ((m = classRe.exec(html))) {
    for (const cls of m[1].split(/\s+/)) if (cls) usedClasses.add(cls)
  }
  // Remove rules for each unused utility (preserves original per-class removal logic)
  for (const cls of utilities) {
    if (usedClasses.has(cls)) continue
    const re = new RegExp(`^\\s*\\.${cls}(:[a-z-]+)?\\s*\\{[^}]*\\}\\s*\\n?`, 'gm')
    css = css.replace(re, '')
  }
  return css
}

function composeClientJs(reactive, stubs, realtime) {
  // Tree-shake: if the reactive/realtime code never actually invokes any
  // @server stub function, the stubs + ADP runtime are dead weight. This
  // happens when @server fns are only used by @live (resolved at edge render
  // time, never called from client JS).
  let stubsToShip = stubs
  let adpNeeded = !!realtime
  if (stubs) {
    // Each stub starts with `async function NAME(` - collect names.
    const names = [...stubs.matchAll(/async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1])
    const nameRes = names.map(n => new RegExp(`\\b${n}\\s*\\(`))
    const used = nameRes.some(re => re.test(reactive) || re.test(realtime || ''))
    if (!used) stubsToShip = ''
    else adpNeeded = true
  }

  const parts = []
  if (adpNeeded) parts.push(ADP_MINI_RUNTIME)
  if (stubsToShip) parts.push(stubsToShip)
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

// Walk up from dir to find the nearest ancestor containing package.json (project root)
function _findProjectRoot(dir) {
  let d = path.resolve(dir)
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d
    const parent = path.dirname(d)
    if (parent === d) break
    d = parent
  }
  return path.resolve(dir)
}

// ── Build command ──────────────────────────────────────────────────────────

async function build(projectDir) {
  const absDir = path.resolve(projectDir)

  // Find .arc entry file
  let entryFile = path.join(absDir, 'index.arc')
  if (!fs.existsSync(entryFile)) {
    // Look for any .arc file
    let files
    try { files = (await fs.promises.readdir(absDir)).filter(f => f.endsWith('.arc')) }
    catch (e) { console.error(`arc: cannot read directory ${absDir}: ${e.message}`); process.exit(1) }
    if (files.length === 0) {
      console.error(`arc: no .arc files found in ${absDir}`)
      process.exit(1)
    }
    entryFile = path.join(absDir, files[0])
  }

  let source
  try { source = await fs.promises.readFile(entryFile, 'utf8') }
  catch (e) { console.error(`arc: cannot read ${path.relative(process.cwd(), entryFile)}: ${e.message}`); process.exit(1) }
  const filename = path.relative(process.cwd(), entryFile)

  const sourceMapBuilder = new SourceMapBuilder()
  const _t0 = Date.now()

  const rootDir = _findProjectRoot(absDir)
  let result
  try {
    result = await compile(source, filename, { projectDir: absDir, rootDir, distDir: path.join(absDir, 'dist'), sourceMap: sourceMapBuilder })
  } catch (e) {
    formatError(e, source, filename)
    process.exit(1)
  }

  const distDir = path.join(absDir, 'dist')

  // Post-process: inline critical CSS, minify HTML, resource hints
  const withAssets = injectAssets(result.html, result.js)
  let finalHtml, finalCss, cssInlined
  try {
    ;({ html: finalHtml, css: finalCss, cssInlined } = postProcess(withAssets, result.css, { criticalCssThreshold: 14 * 1024 }))
  } catch (e) {
    console.error(`arc: post-processing failed for ${filename}: ${e.message}`)
    process.exit(1)
  }

  try {
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'index.html'), finalHtml)

    // Write CSS only when it isn't fully inlined into the HTML. When inlined,
    // no <link> remains and the separate file would be dead weight on disk.
    if (!cssInlined && finalCss && finalCss.trim()) {
      fs.writeFileSync(path.join(distDir, 'styles.css'), finalCss)
    }

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
  const cssSize = finalCss ? Buffer.byteLength(finalCss) : 0
  const jsSize = Buffer.byteLength(result.js)
  const edgeSize = result.edgeFunctions ? Buffer.byteLength(result.edgeFunctions) : 0
  const liveSize = result.liveEdgeFunction ? Buffer.byteLength(result.liveEdgeFunction) : 0

  const _elapsed = Date.now() - _t0
  if (_TTY) {
    const _rel = path.relative(process.cwd(), distDir) || 'dist'
    console.log(`\n  ${_OCYAN}⚡ arc${_ORST}  →  ${_rel}/\n`)
    console.log(`  ${_ODIM}HTML${_ORST}    ${fmt(htmlSize)}`)
    console.log(`  ${_ODIM}CSS ${_ORST}    ${fmt(cssSize)}`)
    console.log(`  ${_ODIM}JS  ${_ORST}    ${jsSize === 0 ? `${_ODIM}0 B  (static)${_ORST}` : fmt(jsSize)}`)
    if (edgeSize > 0) console.log(`  ${_ODIM}Edge${_ORST}    ${fmt(edgeSize)}  ${_ODIM}(@server)${_ORST}`)
    if (liveSize > 0) console.log(`  ${_ODIM}Live${_ORST}    ${fmt(liveSize)}  ${_ODIM}(@live)${_ORST}`)
    console.log(`\n  ${_OGREEN}✓${_ORST}  built in ${_ODIM}${_elapsed}ms${_ORST}\n`)
  } else {
    console.log(`arc: built ${filename}`)
    console.log(`  HTML  ${fmt(htmlSize)}`)
    console.log(`  CSS   ${fmt(cssSize)}`)
    console.log(`  JS    ${jsSize === 0 ? '0 bytes (static)' : fmt(jsSize)}`)
    if (edgeSize > 0) console.log(`  Edge  ${fmt(edgeSize)} (@server functions)`)
    if (liveSize > 0) console.log(`  Live  ${fmt(liveSize)} (@live edge renderer)`)
    console.log(`  → ${path.relative(process.cwd(), distDir)}/`)
  }
}

// Split a (minified or not) CSS string into top-level rules - selectors and
// @-rules counted as single units. Bracket-counting handles nesting correctly.
function splitCssRules(css) {
  const rules = []
  let depth = 0, start = 0, inString = null
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (inString) { if (c === inString && css[i - 1] !== '\\') inString = null; continue }
    if (c === '"' || c === "'") { inString = c; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const r = css.slice(start, i + 1).trim()
        if (r) rules.push(r)
        start = i + 1
      }
    }
  }
  // Any trailing content that wasn't terminated by a brace (rare, possibly invalid)
  const tail = css.slice(start).trim()
  if (tail) rules.push(tail)
  return rules
}

// H2: Extract shared CSS rules that appear on >= threshold pages.
// Returns { sharedRules, filename } where filename may be null if no shared CSS.
function _extractSharedCss(rulesByPage, threshold) {
  const ruleOccurrences = new Map()  // rule string → Set of page indices
  rulesByPage.forEach((rules, pageIdx) => {
    for (const r of rules) {
      if (!ruleOccurrences.has(r)) ruleOccurrences.set(r, new Set())
      ruleOccurrences.get(r).add(pageIdx)
    }
  })

  const sharedRules = []
  const pageOnlyRules = rulesByPage.map(() => [])
  for (const [rule, pages] of ruleOccurrences) {
    if (pages.size >= threshold) sharedRules.push(rule)
    else for (const i of pages) pageOnlyRules[i].push(rule)
  }

  const pp = new PostProcessor()
  const sharedCssMinified = pp.minifyCss(sharedRules.join('\n'))
  const sharedSha = hashString(sharedCssMinified).toString(16).slice(0, 8)
  const filename = sharedCssMinified ? `shared.${sharedSha}.css` : null

  return { sharedRules, pageOnlyRules, filename, sharedCssMinified }
}

// H2: Patch a single page's HTML string to reference sharedFilename via <link>
// and inline pageCssText as a <style> block. Returns the patched HTML.
function _patchPageHtml(htmlContent, sharedFilename, pageCssText) {
  const linkTag = sharedFilename ? `<link rel="stylesheet" href="${sharedFilename}">` : ''
  const pageStyle = pageCssText.trim() ? `<style data-arc-css>${pageCssText.replace(/<\/style>/gi, '<\\/style>')}</style>` : ''
  return htmlContent.replace(
    '<link rel="stylesheet" href="styles.css">',
    linkTag + pageStyle
  )
}

// H2: Inject <link rel="prefetch"> tags + view-transition meta between pages.
// Reads/writes files in distDir. compiled is the array of { slug, meta } objects.
async function _injectPrefetchTags(distDir, compiled) {
  const allSlugs = new Set(compiled.map(c => c.slug + '.html'))
  await Promise.all(compiled.map(async c => {
    const p = path.join(distDir, c.slug + '.html')
    let html
    try { html = await fs.promises.readFile(p, 'utf8') } catch { return }
    html = html.replace(_CSP_META_RE, '')

    // Find all <a href> targets pointing to another page in this site.
    const linkedHrefs = new Set()
    _A_HREF_RE.lastIndex = 0
    let m
    while ((m = _A_HREF_RE.exec(html))) {
      const href = m[1].split('#')[0].split('?')[0]
      if (allSlugs.has(href) && href !== c.slug + '.html') {
        linkedHrefs.add(href)
      }
    }

    // Build injection payload
    const prefetchTags = [...linkedHrefs]
      .map(h => `<link rel="prefetch" href="${h.replace(/"/g, '&quot;')}">`)
      .join('')
    const viewTransition = c.meta?.viewTransitions === false
      ? ''
      : '<meta name="view-transition" content="same-origin">'
    const inject = viewTransition + prefetchTags
    if (inject) {
      html = html.replace('</head>', inject + '</head>')
    }
    await fs.promises.writeFile(p, html)
  }))
}

// Multi-page site build: compiles every .arc in the directory, then extracts
// CSS rules used by ALL pages into a single content-hashed shared.<sha>.css.
// Each page's HTML references the shared file via <link> + inlines any
// page-specific rules. Result: browser caches the shared CSS once across all
// routes; per-page HTML is dramatically smaller.
// Quick scan: is this .arc source a page (has a `page` declaration)?
// Partials/imports declare widget/fn/design but never `page`.
function _isPageFile(source) {
  return /(?:^|\n)\s*page\s+["']/.test(source.slice(0, 2000))
}

async function buildSite(projectDir) {
  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')

  // Discover all .arc files recursively (skips node_modules, dist, dotfiles)
  const allArcFiles = findArcFiles(absDir)
  if (allArcFiles.length === 0) {
    console.error(`arc: no .arc files in ${absDir}`); process.exit(1)
  }

  // Read and filter to page files only - partials (widget/design/fn declarations) are skipped
  const pageFiles = (await Promise.all(
    allArcFiles.map(async absPath => {
      let src
      try { src = await fs.promises.readFile(absPath, 'utf8') } catch { return null }
      return _isPageFile(src) ? { absPath, src } : null
    })
  )).filter(Boolean)

  if (pageFiles.length === 0) {
    console.error(`arc: no page declarations found in ${absDir}`); process.exit(1)
  }
  if (pageFiles.length === 1) {
    return build(path.dirname(pageFiles[0].absPath))
  }

  fs.mkdirSync(distDir, { recursive: true })
  const sharedImgPipeline = new ImagePipeline({ srcDir: absDir, outDir: distDir })
  const rootDir = _findProjectRoot(absDir)

  const compiled = await Promise.all(pageFiles.map(async ({ absPath, src }) => {
    // slug preserves directory structure: "index", "packages/index", "docs/quickstart"
    const relPath = path.relative(absDir, absPath)
    const slug = relPath.replace(/\.arc$/, '').replace(/\\/g, '/')
    const relFilename = relPath.replace(/\\/g, '/')
    let result
    try {
      result = await compile(src, relFilename, { projectDir: absDir, rootDir, distDir, sharedImgPipeline })
    } catch (e) { formatError(e, src, relFilename); return null }
    const pageDecl = result.program?.declarations?.find(d => d.type === 'PageDecl')
    const metaResolved = {}
    if (pageDecl?.meta) {
      for (const [k, v] of Object.entries(pageDecl.meta)) {
        if (v?.type === 'Literal') metaResolved[k] = v.value
        else if (typeof v !== 'object') metaResolved[k] = v
      }
    }
    return {
      file: relFilename, slug, meta: metaResolved,
      html: result.html, css: result.css, js: result.js,
      edgeFunctions: result.edgeFunctions, liveEdgeFunction: result.liveEdgeFunction,
    }
  }))

  const failed = pageFiles.filter((_, i) => compiled[i] === null)
  if (failed.length > 0) {
    console.error(`arc: ${failed.length} of ${pageFiles.length} file${failed.length > 1 ? 's' : ''} failed to compile:`)
    for (const { absPath } of failed) console.error(`  ✗  ${path.relative(absDir, absPath)}`)
    process.exit(1)
  }

  const pp = new PostProcessor()

  for (let i = 0; i < compiled.length; i++) {
    const c = compiled[i]
    const outPath = path.join(distDir, c.slug + '.html')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })

    const fullCss = pp.minifyCss(c.css)
    // JS sits beside its HTML: dist/packages/index.js for dist/packages/index.html
    const jsBasename = path.basename(c.slug) + '.js'
    const withAssets = injectAssets(c.html, c.js, jsBasename)

    let html = _patchPageHtml(withAssets, null, fullCss)
    html = pp.addResourceHints(html)
    html = pp.minifyHtml(html)

    fs.writeFileSync(outPath, html)
    if (c.js?.trim()) {
      fs.writeFileSync(path.join(path.dirname(outPath), jsBasename), c.js)
    }
  }

  let sitemap, robots
  try {
    ;({ sitemap, robots } = emitSiteMeta(compiled.map(c => ({ slug: c.slug, meta: c.meta }))))
  } catch (e) {
    console.warn(`arc: warning: sitemap/robots generation failed: ${e.message}`)
  }
  if (sitemap) fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap)
  if (robots) fs.writeFileSync(path.join(distDir, 'robots.txt'), robots)

  const headersText = emitHeadersManifest({ sharedCssFilename: null })
  fs.writeFileSync(path.join(distDir, '_headers'), headersText)

  // Copy public/ directory to dist/ (static assets like CSS, fonts, images)
  const publicDir = path.join(absDir, 'public')
  if (fs.existsSync(publicDir)) {
    const _copyDir = (src, dest) => {
      fs.mkdirSync(dest, { recursive: true })
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name), d = path.join(dest, entry.name)
        if (entry.isDirectory()) _copyDir(s, d)
        else fs.copyFileSync(s, d)
      }
    }
    _copyDir(publicDir, distDir)
  }

  try {
    await _injectPrefetchTags(distDir, compiled)
  } catch (e) {
    console.warn(`arc: warning: prefetch/view-transition injection failed: ${e.message}`)
  }

  const htmlBytes = compiled.reduce((s, c) => {
    const p = path.join(distDir, c.slug + '.html')
    return s + (fs.existsSync(p) ? fs.statSync(p).size : 0)
  }, 0)
  console.log(`arc: built site (${compiled.length} pages)`)
  console.log(`  HTML  ${fmt(htmlBytes)} total (${compiled.length} files)`)
  if (sitemap) console.log(`  SEO   sitemap.xml (${compiled.filter(c => c.meta.canonical).length} urls) + robots.txt`)
  console.log(`  → ${path.relative(process.cwd(), distDir)}/`)
}

function injectAssets(html, js, jsFilename = 'app.js') {
  // Add <script> tag before </body> only if there's JS
  if (!js.trim()) return html
  return html.replace(/<\/body>/i, `<script src="${jsFilename}" defer></script>\n</body>`)
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
      // Lex + parse + check only - no emit
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

// ── Dev server ────────────────────────────────────────────────────────────
// Serves dist/ over HTTP with:
//   - Automatic browser reload via Server-Sent Events
//   - Injects a tiny <script> into HTML to listen for reload events
//   - Rebuilds on .arc file changes
//
// Protocol: HTTP only (not HTTPS). Dev server is localhost-only; CORS and cookie
// security headers are relaxed to avoid needing self-signed certs during development.
// Production targets (arc build --target bun/cloudflare) emit HTTPS-safe headers.
//
// SSE endpoints:
//   GET /_arc/reload?page=<pathname>
//     Registers client for page-targeted reload events. The client script
//     passes location.pathname so only affected pages get reloaded.
//     Events:
//       message (data: "reload")  - full page reload required (HTML/JS changed)
//       css     (data: <cssText>) - CSS-only change, hot-swapped into <style data-arc-css>
//
//   GET /_arc/health
//     Returns JSON: { status: "ok", pages: <n>, clients: <n> }
//     Used to verify the dev server is running before opening the browser.
//
// SPA fallback:
//   Unknown paths that don't match a dist/ file fall back to dist/index.html
//   when the built site contains exactly one page (SPA mode). The fallback HTML
//   has the reload script injected the same as regular pages.
//
// Rebuild concurrency:
//   The watcher fires _rebuildAffected(changedPath) on every .arc file change.
//   A do-while loop drains rapid successive changes: if a new change arrives
//   while a rebuild is running, the loop immediately starts another rebuild
//   after the current one finishes (never queuing more than one pending rebuild).

const http = require('http')
const _LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/
const _MIME_TYPES = {
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
const _CSP_META_RE = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i
const _A_HREF_RE = /<a\s+[^>]*href="([^"]+)"/gi
let _spaFallbackHtml = null
let _spaFallbackDistDir = null
const RELOAD_SCRIPT = `<script>
(function(){
  const _p = location.pathname.replace(/\\/+$/, '') || '/';
  const es = new EventSource('/_arc/reload?page=' + encodeURIComponent(_p));
  es.onmessage = () => location.reload();
  es.addEventListener('css', e => {
    const s = document.querySelector('style[data-arc-css]');
    if (s) { s.textContent = e.data; return; }
    location.reload();
  });
  es.onerror = () => setTimeout(() => location.reload(), 500);
})()
</script>`

// H1 / H3: HTTP request handler for the dev server (module-scope helper)
function _createDevRequestHandler(distDir, reloadClients) {
  return async function _handleDevRequest(req, res) {
    if (req.url === '/_arc/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ status: 'ok', mode: 'dev', uptime: process.uptime(), pid: process.pid, memory: process.memoryUsage().rss }))
      return
    }

    if (req.url?.startsWith('/_arc/reload')) {
      const origin = req.headers.origin ?? ''
      const acao = _LOCALHOST_RE.test(origin) ? origin : 'http://localhost'
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': acao,
      })
      res.write('retry: 1000\n\n')
      let page = '/'
      try { page = new URL(req.url, 'http://x').searchParams.get('page') || '/' } catch {}
      if (!reloadClients.has(page)) reloadClients.set(page, new Set())
      const _clients = reloadClients.get(page)
      _clients.add(res)
      const _cleanup = () => { _clients.delete(res); if (_clients.size === 0) reloadClients.delete(page) }
      req.on('close', _cleanup)
      res.on('error', _cleanup)
      return
    }

    let urlPath
    try {
      urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    } catch {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }
    if (urlPath.includes('\0')) {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }
    // Defense in depth: reject any path-segment-traversal sequence in the decoded URL.
    // path.resolve + startsWith(distDir) below catches escaping, but symlink games could
    // still let `..` land inside distDir. Explicit rejection is simpler to reason about.
    if (urlPath.includes('/../') || urlPath.startsWith('../') || urlPath.endsWith('/..') || urlPath === '..') {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html'

    let filePath = path.resolve(distDir, urlPath.replace(/^\//, ''))
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    // Clean-URL routing for multi-page sites (no extension in URL):
    //   /packages/arc-animations → dist/packages/arc-animations.html  (non-index page)
    //   /packages               → dist/packages/index.html            (directory index)
    if (!path.extname(filePath)) {
      const htmlCandidate  = filePath + '.html'
      const indexCandidate = path.join(filePath, 'index.html')
      if (htmlCandidate.startsWith(distDir + path.sep) && fs.existsSync(htmlCandidate)) {
        filePath = htmlCandidate
      } else if (indexCandidate.startsWith(distDir + path.sep) && fs.existsSync(indexCandidate)) {
        filePath = indexCandidate
      }
    }

    const ext = path.extname(filePath)

    try {
      let content = await fs.promises.readFile(filePath)
      const mime = _MIME_TYPES[ext] ?? 'application/octet-stream'

      // Inject reload script into HTML; strip CSP meta so inline script is allowed in dev
      if (ext === '.html') {
        content = Buffer.from(
          content.toString()
            .replace(_CSP_META_RE, '')
            .replace(/<\/body>/i, `${RELOAD_SCRIPT}\n</body>`)
        )
      }

      res.writeHead(200, {
        'Content-Type': mime,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      })
      res.end(content)
    } catch (e) {
      // Only fall back to SPA index.html for missing files, not for other read errors
      if (e.code !== 'ENOENT' && e.code !== 'EISDIR') {
        const msg = `${e.code ?? 'ERROR'}: ${e.message}`
        console.error(`arc: dev: ${req.method} ${req.url} — ${msg}`)
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html><head><title>500 — arc dev</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 16px;color:#111}
h1{font-size:1.5rem;color:#c00}code{background:#f3f3f3;padding:2px 6px;border-radius:4px;font-size:13px}
pre{background:#f3f3f3;padding:16px;border-radius:8px;overflow:auto;font-size:13px}</style></head>
<body><h1>500 — Server Error</h1>
<p><code>${msg.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</code></p>
<p>File: <code>${filePath.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</code></p>
<p>Check the terminal for details, then run <code>arc build-site .</code> to rebuild.</p>
</body></html>`)
        return
      }
      try {
        if (_spaFallbackDistDir !== distDir || _spaFallbackHtml === null) {
          _spaFallbackHtml = (await fs.promises.readFile(path.join(distDir, 'index.html'))).toString()
          _spaFallbackDistDir = distDir
        }
        const html = _spaFallbackHtml.replace(/<\/body>/i, `${RELOAD_SCRIPT}\n</body>`)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        })
        res.end(html)
      } catch (fallbackErr) {
        console.error(`arc: dev: SPA fallback failed: ${fallbackErr.message}`)
        res.writeHead(404)
        res.end('Not found')
      }
    }
  }
}

// H1: Watcher setup for the dev server (module-scope helper)
// Watches absDir recursively for .arc changes and calls onChange(filePath).
// Uses per-directory fs.watch instances because fs.watch({ recursive: true })
// is unreliable on Linux (inotify requires each dir to be watched explicitly).
function _startWatcher(absDir, onChange) {
  const watchers = []

  function watchDir(dir) {
    try {
      const w = fs.watch(dir, (event, filename) => {
        if (!filename) return
        const full = path.join(dir, filename)
        const rel = path.relative(absDir, full)
        onChange(rel)
      })
      w.on('error', () => {}) // ignore errors on individual dirs
      watchers.push(w)
    } catch {} // intentionally ignored - inaccessible directory; skip silently
  }

  function scanAndWatch(dir) {
    watchDir(dir)
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'dist' && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          scanAndWatch(path.join(dir, entry.name))
        }
      }
    } catch {} // intentionally ignored - inaccessible directory; skip silently
  }

  try {
    scanAndWatch(absDir)
  } catch (e) {
    console.error(`arc: could not start file watcher: ${e.message}`)
    console.error('arc: automatic rebuilds disabled — run \'arc build\' manually after changes')
  }

  return { close: () => watchers.forEach(w => { try { w.close() } catch {} }) }
}

async function dev(projectDir) {
  // Long-running process - log unhandled errors instead of letting Node kill us
  // mid-rebuild. Build/check/deploy are one-shot and don't need these.
  process.on('unhandledRejection', e => {
    console.error(`arc: dev: unhandled rejection: ${e?.stack ?? e?.message ?? e}`)
  })
  process.on('uncaughtException', e => {
    console.error(`arc: dev: uncaught exception: ${e?.stack ?? e?.message ?? e}`)
  })

  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')

  const isMultiPage = findArcFiles(absDir).filter(f => {
    try { return _isPageFile(fs.readFileSync(f, 'utf8')) } catch { return false }
  }).length > 1
  const _rebuild = () => isMultiPage ? buildSite(projectDir) : build(projectDir)

  // ── HMR state ─────────────────────────────────────────────────────────────
  // _depMap:   absFilePath → Set<slug>  - which pages import a given file
  // _slugFile: slug → absSourcePath    - reverse lookup for partial rebuilds
  // _prevHtml: slug → last finalHtml   - used to detect CSS-only vs structural change
  const _depMap   = new Map()
  const _slugFile = new Map()
  const _prevHtml = new Map()

  // Scan import deps for one page file and populate _depMap + _slugFile.
  // Lightweight: lex/parse/resolveImports only, no emit.
  async function _scanPageDeps(absPath) {
    const relPath = path.relative(absDir, absPath)
    const slug = relPath.replace(/\.arc$/, '').replace(/\\/g, '/')
    _slugFile.set(slug, absPath)
    try {
      const src = fs.readFileSync(absPath, 'utf8')
      const lexer = new Lexer(src, absPath)
      const tokens = lexer.tokenize()
      const parser = new Parser(tokens, absPath)
      const program = parser.parse()
      const depsOut = new Set()
      await resolveImports(program, absDir, relPath, new Map([[absPath, null]]), absDir, depsOut)
      for (const dep of depsOut) {
        if (!_depMap.has(dep)) _depMap.set(dep, new Set())
        _depMap.get(dep).add(slug)
      }
    } catch { /* ignore scan errors — full rebuild is the fallback */ }
  }

  // Populate _depMap, _slugFile, _prevHtml from the just-written dist files.
  async function _initHmrState() {
    _depMap.clear(); _slugFile.clear(); _prevHtml.clear()
    const pageFiles = findArcFiles(absDir).filter(f => {
      try { return _isPageFile(fs.readFileSync(f, 'utf8')) } catch { return false }
    })
    await Promise.all(pageFiles.map(f => _scanPageDeps(f)))
    for (const [slug] of _slugFile) {
      const outPath = path.join(distDir, slug + '.html')
      try { _prevHtml.set(slug, fs.readFileSync(outPath, 'utf8')) } catch {}
    }
  }

  // SSE helpers - operate on the reloadClients Map
  function _broadcastReload(pagePath) {
    if (pagePath) {
      const clients = reloadClients.get(pagePath)
      if (!clients) return
      for (const r of clients) { try { r.write('data: reload\n\n') } catch { clients.delete(r) } }
    } else {
      for (const [page, clients] of reloadClients) {
        for (const r of clients) { try { r.write('data: reload\n\n') } catch { clients.delete(r) } }
        if (clients.size === 0) reloadClients.delete(page)
      }
    }
  }
  function _broadcastCss(pagePath, css) {
    const clients = reloadClients.get(pagePath)
    if (!clients) return
    for (const r of clients) { try { r.write(`event: css\ndata: ${css}\n\n`) } catch { clients.delete(r) } }
  }
  function _totalClients() {
    return [...reloadClients.values()].reduce((s, c) => s + c.size, 0)
  }

  // Compile and write a subset of pages without running a full buildSite().
  // Used for partial rebuilds when only some pages are affected by a change.
  async function _devRebuildPages(slugs) {
    const rootDir = _findProjectRoot(absDir)
    const sharedImgPipeline = new ImagePipeline({ srcDir: absDir, outDir: distDir })
    const pp = new PostProcessor()

    for (const slug of slugs) {
      const absPath = _slugFile.get(slug)
      if (!absPath) continue
      let src; try { src = await fs.promises.readFile(absPath, 'utf8') } catch { continue }
      const relPath = path.relative(absDir, absPath)
      const relFilename = relPath.replace(/\\/g, '/')
      const depsOut = new Set()
      let result
      try {
        result = await compile(src, relFilename, { projectDir: absDir, rootDir, distDir, sharedImgPipeline, depsOut })
      } catch (e) {
        formatError(e, src, relFilename)
        continue
      }
      const fullCss = pp.minifyCss(result.css)
      const jsBasename = path.basename(slug) + '.js'
      const withAssets = injectAssets(result.html, result.js, jsBasename)
      let html = _patchPageHtml(withAssets, null, fullCss)
      html = pp.addResourceHints(html)
      html = pp.minifyHtml(html)
      // Strip CSP meta - _injectPrefetchTags removes it from buildSite dist files,
      // so _prevHtml loaded via _initHmrState won't have it. Keep both paths consistent.
      html = html.replace(_CSP_META_RE, '')

      const outPath = path.join(distDir, slug + '.html')
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, html)
      if (result.js?.trim()) fs.writeFileSync(path.join(path.dirname(outPath), jsBasename), result.js)

      // Update dep map for this slug only
      for (const slugSet of _depMap.values()) slugSet.delete(slug)
      for (const dep of depsOut) {
        if (!_depMap.has(dep)) _depMap.set(dep, new Set())
        _depMap.get(dep).add(slug)
      }

      const pagePath = slug === 'index' ? '/' : slug.endsWith('/index') ? '/' + slug.slice(0, -6) : '/' + slug
      const oldHtml = _prevHtml.get(slug) ?? ''
      _prevHtml.set(slug, html)
      // Strip dynamic/non-visual content before structural comparison:
      // - <style data-arc-css> content (CSS changes handled separately)
      // - <link rel="prefetch"> tags (added by buildSite but not _devRebuildPages)
      // - <meta name="view-transition"> (same)
      // - CSP meta (stripped above, but normalize() is a safety net for _prevHtml loaded externally)
      const normalize = h => h
        .replace(_CSP_META_RE, '')
        .replace(/(<style data-arc-css>)[\s\S]*?(<\/style>)/g, '$1$2')
        .replace(/<link rel="prefetch"[^>]*>/g, '')
        .replace(/<meta name="view-transition"[^>]*>/g, '')
      const getInlineCss = h => (h.match(/<style data-arc-css>([\s\S]*?)<\/style>/) ?? [])[1] ?? ''
      if (oldHtml && normalize(html) === normalize(oldHtml) && getInlineCss(html) !== getInlineCss(oldHtml)) {
        _broadcastCss(pagePath, getInlineCss(html))
      } else if (normalize(html) !== normalize(oldHtml)) {
        _broadcastReload(pagePath)
      }
    }
  }

  // Initial build + HMR state init
  await _rebuild()
  await _initHmrState()

  const rawPort = parseInt(process.env.PORT ?? '3000')
  const port = (Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536) ? rawPort : 3000
  if (rawPort !== port) console.warn(`arc: invalid PORT value, using 3000`)

  // SSE clients - Map<pagePath, Set<res>> for per-page targeting
  const reloadClients = new Map()

  const server = http.createServer(_createDevRequestHandler(distDir, reloadClients))

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`arc: port ${port} already in use. Set PORT env var to use a different port.`)
    } else {
      console.error(`arc: server error: ${e.message}`)
    }
    process.exit(1)
  })
  server.listen(port, () => {
    if (_TTY) {
      console.log(`\n  ${_OCYAN}⚡ arc dev${_ORST}\n`)
      console.log(`  ○  http://localhost:${port}`)
      console.log(`     ${_ODIM}watching · ${path.relative(process.cwd(), absDir) || '.'}${_ORST}\n`)
    } else {
      console.log(`arc: dev server → http://localhost:${port}`)
    }
  })

  const shutdown = () => {
    for (const clients of reloadClients.values()) {
      for (const client of clients) { try { client.end() } catch {} }
    }
    reloadClients.clear()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  if (!_TTY) console.log('arc: watching for changes...')
  let rebuildTimer = null
  let building = false
  let rebuildRequested = false

  _startWatcher(absDir, (changedFile) => {
    if (!changedFile || !changedFile.endsWith('.arc')) return
    if (changedFile.includes('dist' + path.sep) || changedFile.includes('dist/')) return

    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(async () => {
      if (building) { rebuildRequested = true; return }
      try {
        building = true
        do {
          rebuildRequested = false
          if (_TTY) {
            console.log(`  ${_OCYAN}↺${_ORST}  ${_ODIM}${changedFile} changed${_ORST}`)
          } else {
            console.log(`arc: ${changedFile} changed, rebuilding...`)
          }
          const t0 = Date.now()
          try {
            // Determine which pages are affected by the changed file
            const changedAbsPath = path.resolve(absDir, changedFile)
            const affected = new Set()
            if (isMultiPage && _slugFile.size > 0) {
              for (const [slug, absPath] of _slugFile) {
                if (absPath === changedAbsPath) affected.add(slug)
              }
              for (const slug of (_depMap.get(changedAbsPath) ?? [])) affected.add(slug)
            }

            if (isMultiPage && affected.size > 0) {
              // Partial rebuild - only recompile affected pages
              await _devRebuildPages(affected)
              const dur = Date.now() - t0
              const n = _totalClients()
              if (_TTY) {
                console.log(`  ${_OGREEN}✓${_ORST}  rebuilt ${affected.size} page${affected.size !== 1 ? 's' : ''} in ${_ODIM}${dur}ms${_ORST} · ${n} browser${n !== 1 ? 's' : ''} notified`)
              } else {
                console.log(`arc: rebuilt ${affected.size} page${affected.size !== 1 ? 's' : ''} in ${dur}ms → ${n} browser${n !== 1 ? 's' : ''} notified`)
              }
            } else {
              // Full rebuild (single-page, or unknown file, or multi-page first run)
              _spaFallbackHtml = null
              await _rebuild()
              await _initHmrState()
              // Notify all clients after full rebuild
              const dur = Date.now() - t0
              const n = _totalClients()
              _broadcastReload(null)
              if (_TTY) {
                console.log(`  ${_OGREEN}✓${_ORST}  rebuilt in ${_ODIM}${dur}ms${_ORST} · ${n} browser${n !== 1 ? 's' : ''} notified`)
              } else {
                console.log(`arc: rebuilt in ${dur}ms → reload sent to ${n} browser${n !== 1 ? 's' : ''}`)
              }
            }
          } catch (e) {
            let src = null
            try { src = fs.readFileSync(path.join(absDir, changedFile), 'utf8') } catch {} // intentionally ignored - src stays null; formatError handles null src gracefully
            try { formatError(e, src, changedFile) } catch (e2) { console.error(e2) }
          }
        } while (rebuildRequested)
      } finally {
        building = false
      }
    }, 50)
  })
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

  // 3. Generate deployment artifacts (static dispatch - no dynamic require)
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

// ── Backend build (arc serve / arc build --target bun) ────────────────────

// Parse a list of .arc files, merge all RouteDecl / SchemaDecl / JobDecl nodes
// into one synthetic program, then emit a Bun server.js.
// buildServer delegates to src/commands/build-server.js - extracted to reduce cli.js size.
// See that module for the full implementation.
async function buildServer(projectDir, opts = {}, flags = {}) {
  return _buildServerImpl(projectDir, opts, flags, { formatError })
}

// arc serve [dir] - build server.js then run it, with hot reload on .arc changes.
// Extracted to src/commands/serve.js; buildServer is injected to avoid circular deps.
async function serve(projectDir, flags = {}) {
  return _serveImpl(projectDir, flags, buildServer)
}

// H7: Extract db access info from a single AST node chain.
// Returns { table, method } if the node is a db.model.method access, or null.
function _extractDbAccess(node) {
  const call = node.type === 'CallExpr' ? node : null
  const callee = call?.callee ?? node
  if (callee.type === 'MemberExpr' &&
      callee.object?.type === 'MemberExpr' &&
      callee.object?.object?.name === 'db') {
    return {
      table: callee.object.property?.name ?? callee.object.property,
      method: callee.property?.name ?? callee.property,
    }
  }
  return null
}

// H7: Walk AST nodes to extract db.model.method and job calls from a body.
// Returns { reads, writes } arrays.
function collectDbCalls(nodes) {
  const reads = new Set(), writes = new Set()
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'MemberExpr' || node.type === 'CallExpr') {
      // Detect db.posts.findMany() / db.posts.create() / db.posts.find()
      const access = _extractDbAccess(node)
      if (access) {
        const { table, method } = access
        if (/find|findMany|count/.test(method)) reads.add(`${table}.${method}`)
        if (/create|update|delete/.test(method)) writes.add(`${table}.${method}`)
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object' && v.type) walk(v)
    }
  }
  for (const n of nodes) walk(n)
  return { reads: [...reads], writes: [...writes] }
}

// H7: Walk AST nodes to collect job call names present in jobNames set.
// Returns array of called job names.
function collectJobCalls(nodes, jobNames) {
  const called = new Set()
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpr' && node.callee?.type === 'Identifier' && jobNames.has(node.callee.name)) {
      called.add(node.callee.name)
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object' && v.type) walk(v)
    }
  }
  for (const n of nodes) walk(n)
  return [...called]
}

// arc explain [file|dir] - show compile-time analysis of routes, models, and jobs
async function explain(fileOrDir) {
  const absPath = path.resolve(fileOrDir)
  const isDir = fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()

  const allDecls = []
  const label = path.relative(process.cwd(), absPath)

  if (isDir) {
    const serverDir = fs.existsSync(path.join(absPath, 'server'))
      ? path.join(absPath, 'server') : absPath
    for (const file of findArcFiles(serverDir)) {
      try {
        const src = fs.readFileSync(file, 'utf8')
        const prog = new Parser(new Lexer(src, file).tokenize(), file).parse()
        allDecls.push(...prog.declarations)
      } catch (e) { console.warn(`arc explain: skipping ${file}: ${e.message}`) }
    }
  } else {
    let src
    try { src = fs.readFileSync(absPath, 'utf8') }
    catch (e) { console.error(`arc: cannot read ${fileOrDir}: ${e.message}`); process.exit(1) }
    const lexer = new Lexer(src, absPath)
    const tokens = lexer.tokenize()
    const parser = new Parser(tokens, absPath)
    let program
    try { program = parser.parse() }
    catch (e) { formatError(e, src, absPath); process.exit(1) }
    allDecls.push(...program.declarations)
  }

  const routes = allDecls.filter(d => d.type === 'RouteDecl')
  const schemas = allDecls.filter(d => d.type === 'ModelDecl')
  const jobs = allDecls.filter(d => d.type === 'JobDecl')

  const allJobNames = new Set(jobs.map(j => j.name))

  console.log(`\n${CYAN}arc explain${RESET} ${label}\n`)

  if (schemas.length > 0) {
    console.log(`${DIM}── Models ───────────────────────────────────────────${RESET}`)
    for (const s of schemas) {
      const fields = (s.fields ?? []).filter(f => f.name)
      console.log(`\n${GREEN}model ${s.name}${RESET}  (${fields.length} fields)`)
      for (const f of fields) {
        const typeLabel = f.typeAnnotation?.name ?? 'Any'
        const decorators = f.decorators?.length ? `${DIM}${f.decorators.join(' ')} ${RESET}` : ''
        const hasDefault = f.init ? `${DIM} = …${RESET}` : ''
        console.log(`  ${decorators}${f.name}: ${typeLabel}${hasDefault}`)
      }
    }
    console.log('')
  }

  if (routes.length > 0) {
    console.log(`${DIM}── Routes ───────────────────────────────────────────${RESET}`)
    for (const r of routes) {
      const bodyNodes = r.body?.body ?? []
      const { reads, writes } = collectDbCalls(bodyNodes)
      const calledJobs = collectJobCalls(bodyNodes, allJobNames)
      const authTag = r.annotations?.includes('@auth') ? ` ${DIM}[auth]${RESET}` : ''
      const paramList = r.params?.length ? ` { ${r.params.map(p => `${p}: String`).join(', ')} }` : ''

      console.log(`\n${GREEN}${r.method}${RESET} ${r.path}${paramList}${authTag}`)
      if (reads.length)     console.log(`  ${DIM}reads:${RESET}  ${reads.join(', ')}`)
      if (writes.length)    console.log(`  ${DIM}writes:${RESET} ${writes.join(', ')}`)
      if (calledJobs.length) console.log(`  ${DIM}queues:${RESET} ${calledJobs.join(', ')}`)
      if (!reads.length && !writes.length && !calledJobs.length) {
        console.log(`  ${DIM}no DB or job calls${RESET}`)
      }
    }
    console.log('')
  }

  if (jobs.length > 0) {
    console.log(`${DIM}── Jobs ─────────────────────────────────────────────${RESET}`)
    for (const j of jobs) {
      const paramStr = (j.params ?? []).map(p => `${p.name}: ${p.typeAnnotation?.name ?? 'Any'}`).join(', ')
      const bodyNodes = j.body?.body ?? []
      const { reads, writes } = collectDbCalls(bodyNodes)
      console.log(`\n${GREEN}job ${j.name}${RESET}(${paramStr})`)
      if (reads.length)  console.log(`  ${DIM}reads:${RESET}  ${reads.join(', ')}`)
      if (writes.length) console.log(`  ${DIM}writes:${RESET} ${writes.join(', ')}`)
    }
    console.log('')
  }

  if (routes.length === 0 && schemas.length === 0 && jobs.length === 0) {
    console.log(`${YELLOW}No backend declarations (model, route, job) found in this file.${RESET}`)
    console.log('Use model, @route, or job keywords.')
  }
}

// arc generate <type> <name> - scaffold files
function generate(type, name) {
  if (!type || !name) {
    console.error('arc generate <model|handler> <name>')
    process.exit(1)
  }

  const absDir = path.resolve('.')
  const serverDir = path.join(absDir, 'server')

  if (type === 'model') {
    const schemasDir = path.join(serverDir, 'schemas')
    fs.mkdirSync(schemasDir, { recursive: true })
    const outFile = path.join(schemasDir, `${name.toLowerCase()}.arc`)
    if (fs.existsSync(outFile)) {
      console.error(`arc: ${path.relative(process.cwd(), outFile)} already exists`)
      process.exit(1)
    }
    const scaffold = `model ${name}
  @id let id = autoincrement()
  let createdAt: DateTime = now()
  # TODO: add fields here
  # let title: String
  # let body: String
`
    fs.writeFileSync(outFile, scaffold)
    console.log(`${GREEN}created${RESET} ${path.relative(process.cwd(), outFile)}`)

  } else if (type === 'handler') {
    const routesDir = path.join(serverDir, 'routes')
    fs.mkdirSync(routesDir, { recursive: true })
    const outFile = path.join(routesDir, `${name.toLowerCase()}.arc`)
    if (fs.existsSync(outFile)) {
      console.error(`arc: ${path.relative(process.cwd(), outFile)} already exists`)
      process.exit(1)
    }
    const scaffold = `@route get "/${name.toLowerCase()}" -> Response
  json(db.${name.toLowerCase()}s.findMany())

@route get "/${name.toLowerCase()}/:id" -> Response
  const item = db.${name.toLowerCase()}s.find(params.id)
  match item
    None -> json({ error: "not found" }, 404)
    Some(x) -> json(x)

@route post "/${name.toLowerCase()}" -> Response
  const body = parseBody(request)
  const item = db.${name.toLowerCase()}s.create(body)
  json(item, 201)

@route del "/${name.toLowerCase()}/:id" -> Response
  db.${name.toLowerCase()}s.delete(params.id)
  json({ ok: true })
`
    fs.writeFileSync(outFile, scaffold)
    console.log(`${GREEN}created${RESET} ${path.relative(process.cwd(), outFile)}`)

  } else if (type === 'job') {
    const jobsDir = path.join(serverDir, 'jobs')
    fs.mkdirSync(jobsDir, { recursive: true })
    const outFile = path.join(jobsDir, `${name.toLowerCase()}.arc`)
    if (fs.existsSync(outFile)) {
      console.error(`arc: ${path.relative(process.cwd(), outFile)} already exists`)
      process.exit(1)
    }
    const scaffold = `job ${name}(id: Int)
  # TODO: implement job body
  console.log("running ${name}", id)
  # email.send({ to: "user@example.com", subject: "Hello", text: "Your job ran" })
`
    fs.writeFileSync(outFile, scaffold)
    console.log(`${GREEN}created${RESET} ${path.relative(process.cwd(), outFile)}`)

  } else {
    console.error(`arc generate: unknown type "${type}". Valid: model, handler, job`)
    process.exit(1)
  }
}

// ── arc db ─────────────────────────────────────────────────────────────────
// Extracted to src/commands/db.js; delegated here for backward compat.

async function dbCommand(args) {
  return _dbCommandImpl(args)
}

// ── Flag helpers ───────────────────────────────────────────────────────────

function parseServerFlags(args) {
  const flags = {}
  const valueFlags = ['--db', '--target', '--port']
  for (const flag of valueFlags) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && args[idx + 1]) flags[flag.slice(2)] = args[idx + 1]
  }
  // Boolean flags
  if (args.includes('--no-rate-limit')) flags.noRateLimit = true
  if (args.includes('--no-tracing')) flags.noTracing = true
  if (args.includes('--bun-routes')) flags.bunRoutes = true
  if (args.includes('--watch')) flags.watch = true
  if (args.includes('--profile')) flags.profile = true
  // --cors [origin] - optional value, defaults to '*'
  const corsIdx = args.indexOf('--cors')
  if (corsIdx !== -1) {
    const next = args[corsIdx + 1]
    flags.cors = (next && !next.startsWith('--')) ? next : '*'
  }
  return flags
}

function isServerFlagValue(args, a) {
  for (const flag of ['--db', '--target', '--port']) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && args[idx + 1] === a) return true
  }
  // --cors with explicit origin value
  const corsIdx = args.indexOf('--cors')
  if (corsIdx !== -1 && args[corsIdx + 1] === a && !a.startsWith('--')) return true
  return false
}

// ── Entry point ────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv

async function main() {
  switch (cmd) {
    case 'build':
      await build(args[0] ?? '.')
      break

    case 'build-site':
      await buildSite(args[0] ?? '.')
      break

    case 'check': {
      let filesToCheck
      if (args.length === 0) {
        filesToCheck = findArcFiles('.')
      } else {
        // Expand any directory arguments to their .arc files
        filesToCheck = args.flatMap(a => {
          const abs = path.resolve(a)
          if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return findArcFiles(abs)
          return [a]
        })
      }
      await check(filesToCheck)
      break
    }

    case 'new': {
      const tmplIdx = args.indexOf('--template')
      const pmIdx = args.indexOf('--pm')
      if (tmplIdx !== -1 && !args[tmplIdx + 1]) {
        console.error('arc: --template requires a value (default|counter|blog|api|cms)')
        process.exit(1)
      }
      const template = tmplIdx !== -1 ? args[tmplIdx + 1] : undefined
      const pm = pmIdx !== -1 ? args[pmIdx + 1] : undefined
      const flagValues = new Set()
      if (tmplIdx !== -1 && args[tmplIdx + 1]) flagValues.add(args[tmplIdx + 1])
      if (pmIdx !== -1 && args[pmIdx + 1]) flagValues.add(args[pmIdx + 1])
      const name = args.find(a => !a.startsWith('--') && !flagValues.has(a))
      const install = args.includes('--install') ? true : args.includes('--no-install') ? false : undefined

      if (name && template) {
        await newProject(name, template, { pm: pm ?? detectPackageManager(), install: install ?? false })
      } else if (process.stdin.isTTY) {
        await runWizard({ name, template, pm, install })
      } else {
        console.error('arc new <name> [--template default|counter|blog|api|cms]')
        process.exit(1)
      }
      break
    }

    case 'dev':
      await dev(args[0] ?? '.')
      break

    case 'deploy': {
      const targetIdx = args.indexOf('--target')
      const target = targetIdx !== -1 ? args[targetIdx + 1] : 'cloudflare'
      // When --target is absent, targetIdx === -1 and args[targetIdx+1] === args[0],
      // which would wrongly exclude the first positional arg. Guard with the targetIdx check.
      const deployDir = args.find(
        a => !a.startsWith('--') && (targetIdx === -1 || a !== args[targetIdx + 1])
      ) ?? '.'
      await deploy(deployDir, target)
      break
    }

    case 'serve': {
      const serveFlags = parseServerFlags(args)
      const serveDir = args.find(a => !a.startsWith('--') && !isServerFlagValue(args, a)) ?? '.'
      await serve(serveDir, serveFlags)
      break
    }

    case 'build-server': {
      const bsFlags = parseServerFlags(args)
      const bsDir = args.find(a => !a.startsWith('--') && !isServerFlagValue(args, a)) ?? '.'
      await buildServer(bsDir, {}, bsFlags)
      break
    }

    case 'explain':
      if (!args[0]) { console.error('arc explain <file>'); process.exit(1) }
      await explain(args[0])
      break

    case 'scaffold': {
      const all = args.includes('--all')
      const force = args.includes('--force')
      const positional = args.filter(a => !a.startsWith('--') && !a.startsWith('--fields'))
      // Handle --fields "..." option
      const fieldsIdx = args.findIndex(a => a === '--fields' || a.startsWith('--fields='))
      let fieldsVal
      if (fieldsIdx !== -1) {
        fieldsVal = args[fieldsIdx].includes('=') ? args[fieldsIdx].split('=').slice(1).join('=') : args[fieldsIdx + 1]
      }

      if (positional[0] === 'block') {
        const init = args.includes('--init')
        if (init) {
          const dir = positional[1] ?? '.'
          await _scaffoldBlockInitImpl(dir)
        } else {
          if (!positional[1]) {
            console.error('arc scaffold block <Type> [dir] [--fields "name:Type ..."]')
            console.error('arc scaffold block --init [dir]   initialize block infrastructure')
            process.exit(1)
          }
          const blockType = positional[1]
          const dir = positional[2] ?? '.'
          await _scaffoldBlockImpl(blockType, dir, { force, fields: fieldsVal })
        }
      } else if (all) {
        const dir = positional[0] ?? '.'
        await _scaffoldAllImpl(dir, { force })
      } else {
        if (!positional[0]) {
          console.error('arc scaffold <ModelName> [dir] [--force]')
          console.error('arc scaffold --all [dir]          scaffold every model in dir')
          console.error('arc scaffold block --init [dir]   initialize block system')
          console.error('arc scaffold block <Type> [dir]   add a block type')
          process.exit(1)
        }
        const modelName = positional[0]
        const dir = positional[1] ?? '.'
        await _scaffoldImpl(modelName, dir, { force })
      }
      break
    }

    case 'cms': {
      const sub = args[0]
      const positional = args.slice(1).filter(a => !a.startsWith('--'))
      if (sub === 'init') {
        const dir = positional[0] ?? '.'
        await _cmsInitImpl(dir, {})
      } else {
        console.error('arc cms init [dir]   Scaffold admin panel + CMS into project')
        process.exit(1)
      }
      break
    }

    case 'generate':
    case 'g':
      generate(args[0], args[1])
      break

    case 'db':
      await dbCommand(args)
      break

    case '--version':
    case '-v':
      console.log(require('../package.json').version)
      break

    default:
      console.log('arc — a new language for the web')
      console.log('')
      console.log('Usage:')
      console.log('  arc build [dir]          Compile frontend to HTML/CSS/JS')
      console.log('  arc build-site [dir]     Build all pages with shared CSS + sitemap + _headers')
      console.log('  arc serve [dir]          Build + start backend server (Bun)')
      console.log('  arc build-server [dir]   Build server.js without starting it')
      console.log('  arc dev [dir]            Build frontend and watch for changes')
      console.log('  arc check [files]        Type-check without emitting')
      console.log('  arc explain <file>       Show compile-time analysis of routes/schemas/jobs')
      console.log('  arc generate <type> <name>  Scaffold: model, handler')
      console.log('  arc scaffold <Model> [dir]  Generate admin routes + pages for a model (--all, --force)')
      console.log('  arc cms init [dir]       Scaffold full admin panel + CMS (arc-ui based)')
      console.log('  arc new <name>           Create a new Arc project (--template default|counter|blog|api|cms)')
      console.log('  arc deploy [dir]         Deploy to hosting (--target cloudflare|deno|bun|node)')
      console.log('  arc db <cmd>             Database: migrate, seed, studio')
      console.log('  arc --version            Print version')
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(`arc: fatal: ${e.message}`)
    if (process.env.ARC_DEBUG) {
      console.error(e.stack)
    } else if (!(e instanceof SyntaxError)) {
      console.error('arc: set ARC_DEBUG=1 for a full stack trace')
    }
    process.exit(1)
  })
}


// Public API: just `compile`. Internals are namespaced under `_internal` to
// signal they are not a stability contract - they exist only so tests can
// exercise them directly.
module.exports = {
  compile,
  _internal: {
    resolveImports,
    composeClientJs,
    hashString,
    injectAssets,
    fmt,
    findArcFiles,
    newProject,
    check,
    build,
    buildServer,
    serve,
    explain,
    generate,
    deploy,
    scaffold: _scaffoldImpl,
    scaffoldAll: _scaffoldAllImpl,
    formatError,
    showSourceContext,
    // Extracted helpers
    _createDevRequestHandler,
    _startWatcher,
    _extractSharedCss,
    _patchPageHtml,
    _injectPrefetchTags,
    _resolveImageFormats,
    _extractDbAccess,
    collectDbCalls,
    collectJobCalls,
  },
}
