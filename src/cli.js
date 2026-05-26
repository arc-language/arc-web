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
const { CloudflareEmitter } = require('./emitters/server-cloudflare')
const { generateWranglerToml } = require('./compilers/wrangler-compiler')
const { buildServer: _buildServerImpl } = require('./commands/build-server')
const { serve: _serveImpl, createFileWatcher } = require('./commands/serve')
const { dbCommand: _dbCommandImpl, runSeed: _runSeedImpl } = require('./commands/db')
const { emit: emitSiteMeta } = require('./emitters/site-meta')
const { emit: emitHeadersManifest } = require('./emitters/headers-manifest')
const { RED, GREEN, YELLOW, CYAN, DIM, RESET, formatError, showSourceContext } = require('./utils/errors')
const N = require('./ast')

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
    if (!src || src.startsWith('arc/')) continue // stdlib - not a file

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

    // Prevent directory traversal and symlink traversal outside original project root.
    // path.resolve() does NOT follow symlinks; fs.realpathSync() does — use it to
    // canonicalize before the boundary check so symlinks can't escape the project root.
    let realImportPath
    try { realImportPath = fs.realpathSync(importPath) } catch { realImportPath = importPath }
    const realTopLevelRoot = (() => { try { return fs.realpathSync(topLevelRoot) } catch { return topLevelRoot } })()
    if (!realImportPath.startsWith(realTopLevelRoot + path.sep) && realImportPath !== realTopLevelRoot) {
      console.warn(`arc: warning: import escapes project root, skipping: ${src}`)
      continue
    }

    if (visited.has(importPath)) continue
    visited.add(importPath)

    let importedSource
    try {
      importedSource = await fs.promises.readFile(importPath, 'utf8')
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

async function compile(source, filename = '<input>', options = {}) {
  const hash = options.hash ?? hashString(filename).toString(36).slice(0, 4)
  const projectDir = options.projectDir ?? path.dirname(path.resolve(filename))

  // 1. Lex
  const lexer = new Lexer(source, filename)
  const tokens = lexer.tokenize()

  // 2. Parse
  const parser = new Parser(tokens, filename)
  let program = parser.parse()

  // 2b. Resolve imports - read imported .arc files and merge their declarations
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

  // 5b. Image pipeline: collect <img src=...> refs, run sharp-based pre-pass.
  // Pipeline is a no-op when sharp is unavailable (returns null from emitPicture);
  // emitter then falls back to plain <img>.
  const imgRefs = collectImgRefs(program)
  let imgPipeline = null
  if (imgRefs.length > 0 && options.distDir) {
    // Per-page meta.imageFormats opt-out: default ['avif','webp','original'].
    // Find the first PageDecl with imageFormats meta (multi-page builds set this).
    const formats = _resolveImageFormats(program)
    imgPipeline = new ImagePipeline({
      srcDir: projectDir,
      outDir: options.distDir,
      ...(formats ? { formats } : {}),
    })
    await imgPipeline.processAll(imgRefs)
  }

  // 6. HTML emit (also collects stateBindings + eventBindings)
  const htmlEmitter = new HtmlEmitter({ hash, buildContext, imgPipeline })
  const html = htmlEmitter.emitProgram(program)

  // 7. CSS emit
  const cssEmitter = new CssEmitter({ hash })
  let css = cssEmitter.emitProgram(program)
  // Tree-shake unused base utility classes (sr-only, skip-link, row, col, etc.)
  // based on what's actually referenced in the emitted HTML.
  css = treeshakeBaseCss(css, html)

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
  // Single HTML scan to determine which utilities are referenced
  const usedClasses = new Set()
  const classReDQ = /class\s*=\s*"([^"]*)"/g
  const classReSQ = /class\s*=\s*'([^']*)'/g
  let m
  while ((m = classReDQ.exec(html))) {
    for (const cls of m[1].split(/\s+/)) if (cls) usedClasses.add(cls)
  }
  while ((m = classReSQ.exec(html))) {
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

  let result
  try {
    result = await compile(source, filename, { projectDir: absDir, distDir: path.join(absDir, 'dist'), sourceMap: sourceMapBuilder })
  } catch (e) {
    formatError(e, source, filename)
    process.exit(1)
  }

  const distDir = path.join(absDir, 'dist')

  // Post-process: inline critical CSS, minify HTML, resource hints
  const withAssets = injectAssets(result.html, result.js)
  const { html: finalHtml, css: finalCss, cssInlined } = postProcess(withAssets, result.css)

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
  const pageStyle = pageCssText.trim() ? `<style>${pageCssText.replace(/<\/style>/gi, '<\\/style>')}</style>` : ''
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
async function buildSite(projectDir) {
  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')

  let arcFiles
  try {
    arcFiles = fs.readdirSync(absDir).filter(f => f.endsWith('.arc'))
  } catch (e) {
    console.error(`arc: cannot read ${absDir}: ${e.message}`); process.exit(1)
  }
  if (arcFiles.length === 0) {
    console.error(`arc: no .arc files in ${absDir}`); process.exit(1)
  }
  if (arcFiles.length === 1) {
    // Single page: defer to regular build
    return build(projectDir)
  }

  // Compile each .arc into html + raw CSS (pre-post-process). We post-process
  // ourselves below so the inlined-CSS strategy can be replaced with the
  // shared-file strategy.
  fs.mkdirSync(distDir, { recursive: true })
  const compiled = await Promise.all(arcFiles.map(async f => {
    const source = await fs.promises.readFile(path.join(absDir, f), 'utf8')
    let result
    try {
      result = await compile(source, f, { projectDir: absDir, distDir })
    } catch (e) { formatError(e, source, f); return null }
    // Pull page-level meta (canonical, etc.) for sitemap emission
    const pageDecl = result.program?.declarations?.find(d => d.type === 'PageDecl')
    const metaResolved = {}
    if (pageDecl?.meta) {
      for (const [k, v] of Object.entries(pageDecl.meta)) {
        if (v?.type === 'Literal') metaResolved[k] = v.value
        else if (typeof v !== 'object') metaResolved[k] = v
      }
    }
    return {
      file: f,
      slug: path.basename(f, '.arc'),
      meta: metaResolved,
      html: result.html, css: result.css, js: result.js,
      edgeFunctions: result.edgeFunctions, liveEdgeFunction: result.liveEdgeFunction,
    }
  }))
  if (compiled.some(r => r === null)) process.exit(1)

  // Compute rule occurrences across all pages.
  // Rules used by ≥2 pages go into shared.css; rules unique to one page stay
  // inline. (Used by ALL N pages would be most cacheable, but ≥2 captures more
  // bytes; the shared file is content-hashed so cacheability isn't affected.)
  const rulesByPage = compiled.map(c => splitCssRules(c.css))
  const { pageOnlyRules, filename: sharedFilename, sharedCssMinified } = _extractSharedCss(rulesByPage, 2)

  if (sharedFilename) {
    fs.writeFileSync(path.join(distDir, sharedFilename), sharedCssMinified)
  }

  const pp = new PostProcessor()

  // Emit per-page HTML: replace the existing <link rel="stylesheet" href="styles.css">
  // (or any inlined <style>) with a link to the shared file plus inline page-specific rules.
  for (let i = 0; i < compiled.length; i++) {
    const c = compiled[i]
    const baseName = path.basename(c.file, '.arc')
    const pageCss = pp.minifyCss(pageOnlyRules[i].join('\n'))
    const withAssets = injectAssets(c.html, c.js)

    // Start from the raw emitted HTML (still has <link rel="stylesheet" href="styles.css">)
    // and patch it. We bypass postProcess.inlineCriticalCss to avoid full inlining.
    let html = _patchPageHtml(withAssets, sharedFilename, pageCss)
    // Apply HTML minification + resource hints from post-processor
    html = pp.addResourceHints(html)
    html = pp.minifyHtml(html)

    fs.writeFileSync(path.join(distDir, `${baseName}.html`), html)

    if (c.js?.trim()) {
      fs.writeFileSync(path.join(distDir, `${baseName}.js`), c.js)
    }
  }

  // Auto-emit sitemap.xml + robots.txt from collected page metadata.
  const { sitemap, robots, baseUrl } = emitSiteMeta(compiled.map(c => ({ slug: c.slug, meta: c.meta })))
  if (sitemap) fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap)
  if (robots) fs.writeFileSync(path.join(distDir, 'robots.txt'), robots)

  // Auto-emit _headers (Cloudflare Pages / Netlify compatible). When this is
  // emitted, the per-page CSP meta tag becomes redundant - strip it from HTML.
  const headersText = emitHeadersManifest({ sharedCssFilename: sharedFilename })
  fs.writeFileSync(path.join(distDir, '_headers'), headersText)

  // I2 post-pass: inject <link rel="prefetch"> for every same-site link target
  // + <meta name="view-transition" content="same-origin"> for instant SPA-feel
  // cross-page navigation. Also strip the now-redundant CSP meta tag.
  await _injectPrefetchTags(distDir, compiled)

  // Stats summary
  const htmlBytes = compiled.reduce((s, c, i) => {
    const p = path.join(distDir, path.basename(c.file, '.arc') + '.html')
    return s + (fs.existsSync(p) ? fs.statSync(p).size : 0)
  }, 0)
  const sharedBytes = sharedFilename ? fs.statSync(path.join(distDir, sharedFilename)).size : 0

  console.log(`arc: built site (${compiled.length} pages)`)
  console.log(`  HTML  ${fmt(htmlBytes)} total (${compiled.length} files)`)
  if (sharedFilename) console.log(`  CSS   ${fmt(sharedBytes)} shared (${sharedFilename})`)
  if (sitemap) console.log(`  SEO   sitemap.xml (${compiled.filter(c => c.meta.canonical).length} urls) + robots.txt`)
  console.log(`  → ${path.relative(process.cwd(), distDir)}/`)
}

function injectAssets(html, js) {
  // Add <script> tag before </body> only if there's JS
  if (!js.trim()) return html
  return html.replace(/<\/body>/i, '<script src="app.js" defer></script>\n</body>')
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

    api: {
      'server/schemas/post.arc': `model Post
  @id let id = autoincrement()
  let title: String
  let body: String
  let published: Bool = false
  let createdAt: DateTime = now()
`,
      'server/routes/posts.arc': `@route get "/posts" -> Response
  json(db.posts.findMany())

@route get "/posts/:id" -> Response
  const post = db.posts.find(params.id)
  match post
    None    -> json({ error: "not found" }, 404)
    Some(p) -> json(p)

@route post "/posts" -> Response
  const body = parseBody(request)
  const post = db.posts.create(body)
  NotifySubscribers(post.id)
  json(post, 201)

@route del "/posts/:id" -> Response
  db.posts.delete(params.id)
  json({ ok: true })

@route get "/health" -> Response
  json({ status: "ok" })
`,
      'server/jobs/notify.arc': `job NotifySubscribers(postId: Int)
  console.log("notifying subscribers for post", postId)
  email.send({ to: "subscribers@example.com", subject: "New post", text: "A new post was published" })
`,
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          dev: 'arc serve .',
          build: 'arc build-server .',
          migrate: 'arc db migrate .',
          start: 'bun dist/server.js',
        },
      }, null, 2) + '\n',
      'README.md': `# ${name}

A backend API built with [Arc](https://arc-lang.dev).

## Getting started

\`\`\`bash
arc db migrate   # create the database tables
arc serve .      # start the server on http://localhost:3000
\`\`\`

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /posts | List all posts |
| GET | /posts/:id | Get a post by id |
| POST | /posts | Create a post |
| DELETE | /posts/:id | Delete a post |
| GET | /health | Health check |
`,
      '.gitignore': 'dist/\nnode_modules/\napp.db\n',
    },
  }

  const files = TEMPLATES[template] ?? TEMPLATES.default
  if (!TEMPLATES[template] && template !== 'default') {
    console.error(`arc: unknown template "${template}". Available: ${Object.keys(TEMPLATES).join(', ')}`)
    process.exit(1)
  }

  for (const [file, content] of Object.entries(files)) {
    const outPath = path.join(dir, file)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, content)
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
//
// Protocol: HTTP only (not HTTPS). Dev server is localhost-only; CORS and cookie
// security headers are relaxed to avoid needing self-signed certs during development.
// Production targets (arc build --target bun/cloudflare) emit HTTPS-safe headers.

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
  const es = new EventSource('/_arc/reload');
  es.onmessage = () => location.reload();
  es.onerror = () => setTimeout(() => location.reload(), 500);
})()
</script>`

// H1 / H3: HTTP request handler for the dev server (module-scope helper)
function _createDevRequestHandler(distDir, reloadClients) {
  return function _handleDevRequest(req, res) {
    if (req.url === '/_arc/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ status: 'ok', mode: 'dev', uptime: process.uptime(), pid: process.pid, memory: process.memoryUsage().rss }))
      return
    }

    if (req.url === '/_arc/reload') {
      const origin = req.headers.origin ?? ''
      const acao = _LOCALHOST_RE.test(origin) ? origin : 'http://localhost'
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': acao,
      })
      res.write('retry: 1000\n\n')
      reloadClients.add(res)
      req.on('close', () => reloadClients.delete(res))
      res.on('error', () => reloadClients.delete(res))
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

    const filePath = path.resolve(distDir, urlPath.replace(/^\//, ''))
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    const ext = path.extname(filePath)

    try {
      let content = fs.readFileSync(filePath)
      const mime = _MIME_TYPES[ext] ?? 'application/octet-stream'

      // Inject reload script into HTML
      if (ext === '.html') {
        content = Buffer.from(
          content.toString().replace(/<\/body>/i, `${RELOAD_SCRIPT}\n</body>`)
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
      // Only fall back to SPA index.html for missing files, not for read errors
      if (e.code !== 'ENOENT') {
        res.writeHead(500)
        res.end('Internal error')
        return
      }
      try {
        if (_spaFallbackDistDir !== distDir || _spaFallbackHtml === null) {
          _spaFallbackHtml = fs.readFileSync(path.join(distDir, 'index.html')).toString()
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
function _startWatcher(absDir, onChange) {
  try {
    const watcher = fs.watch(absDir, { recursive: true }, (event, changedFile) => {
      if (changedFile) onChange(changedFile)
    })
    watcher.on('error', e => console.error(`arc: watcher error: ${e.message}`))
  } catch (e) {
    console.error(`arc: could not start file watcher: ${e.message}`)
    console.error('arc: automatic rebuilds disabled — run \'arc build\' manually after changes')
  }
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

  await build(projectDir)

  const absDir = path.resolve(projectDir)
  const distDir = path.join(absDir, 'dist')
  const rawPort = parseInt(process.env.PORT ?? '3000')
  const port = (Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536) ? rawPort : 3000
  if (rawPort !== port) console.warn(`arc: invalid PORT value, using 3000`)

  // SSE clients waiting for reload signal
  const reloadClients = new Set()

  // HTTP server: serves dist/ and handles /_arc/reload SSE
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
    console.log(`arc: dev server → http://localhost:${port}`)
  })

  const shutdown = () => {
    // End SSE clients first so they don't hold the socket open and block close().
    for (const client of [...reloadClients]) {
      try { client.end() } catch { /* intentionally ignored - client may already be closed */ }
    }
    reloadClients.clear()
    server.close(() => process.exit(0))
    // Hard fallback in case close() never resolves (stale connections, etc.)
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // File watcher with debounce to avoid multiple rebuilds per save
  console.log('arc: watching for changes...')
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
        do {
          building = true
          rebuildRequested = false
          console.log(`arc: ${changedFile} changed, rebuilding...`)
          const t0 = Date.now()
          try {
            _spaFallbackHtml = null  // invalidate SPA fallback cache before rebuild so in-flight requests read fresh files
            await build(projectDir)
            const dur = Date.now() - t0
            for (const client of [...reloadClients]) {
              try { client.write('data: reload\n\n') } catch { reloadClients.delete(client) }
            }
            console.log(`arc: rebuilt in ${dur}ms → reload sent to ${reloadClients.size} browser${reloadClients.size !== 1 ? 's' : ''}`)
          } catch (e) {
            // Read the source of the changed file so formatError can show context.
            // Best-effort - the actual error may come from an import; in that case
            // we lose the snippet but still get the error message.
            let src = null
            try { src = fs.readFileSync(path.join(absDir, changedFile), 'utf8') } catch {}
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
// buildServer delegates to src/commands/build-server.js — extracted to reduce cli.js size.
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
  const flagNames = ['--db', '--target']
  for (const flag of flagNames) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && args[idx + 1]) flags[flag.slice(2)] = args[idx + 1]
  }
  return flags
}

function isServerFlagValue(args, a) {
  for (const flag of ['--db', '--target']) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && args[idx + 1] === a) return true
  }
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
      if (!args[0]) {
        console.error('arc new <name> [--template default|counter|blog]')
        process.exit(1)
      }
      const tmplIdx = args.indexOf('--template')
      if (tmplIdx !== -1 && !args[tmplIdx + 1]) {
        console.error('arc: --template requires a value (default|counter|blog|api)')
        process.exit(1)
      }
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
      console.log('  arc new <name>           Create a new Arc project (--template default|counter|blog|api)')
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
