'use strict'

// @live edge renderer.
// Generates a WinterCG-compatible edge function that:
//   1. Runs @server functions at request time (on the edge)
//   2. Fills all @live variable spans in the HTML template with real data
//   3. Streams complete, personalized HTML to the browser in ONE request
//
// Result: browser gets pre-rendered HTML: no flash, no loading state,
// no separate data fetch. One round trip total.

const { JsEmitter } = require('../emitters/js')

class EdgeRenderer {
  constructor(options = {}) {
    this.hash = options.hash ?? 'arc'
    this.jsEmitter = new JsEmitter(options)
  }

  // Emit a complete WinterCG Worker module for this program.
  // stateBindings: [{ elementId, expression }] from HtmlEmitter
  emitProgram(program, baseHtml, baseCss, clientJs, stateBindings = []) {
    const liveDecls = program.declarations.filter(d => d.type === 'LiveDecl')
    const serverFns = program.declarations.filter(d => d.type === 'ServerFn')

    if (liveDecls.length === 0) return null

    const liveVarNames = new Set(liveDecls.map(d => d.name))

    // Find state bindings that reference @live variables
    // stateBindings format: { id, expr: string, line }
    const liveVarRegexes = [...liveVarNames].map(v => new RegExp(`\\b${v}\\b`))
    const liveBindings = stateBindings.filter(b => {
      const exprStr = b.expr ?? ''
      return liveVarRegexes.some(re => re.test(exprStr))
    })

    const parts = [
      `'use strict'`,
      `// Arc @live edge renderer: auto-generated`,
      `// One request → edge resolves data → full HTML → browser`,
      ``,
      `const BASE_HTML = ${JSON.stringify(baseHtml)}`,
      `const BASE_CSS = ${JSON.stringify(baseCss)}`,
      `const CLIENT_JS = ${JSON.stringify(clientJs?.trim() ? clientJs : null)}`,
      ``,
    ]

    // Emit @server fn implementations (called at request time on edge)
    if (serverFns.length > 0) {
      parts.push(`// @server functions: run at request time on the edge`)
      for (const fn of serverFns) {
        parts.push(this.emitServerFnImpl(fn))
      }
    }

    // Emit data resolver
    parts.push(this.emitLiveResolver(liveDecls))

    // Emit HTML template filler (replaces reactive spans with real data)
    parts.push(this.emitHtmlFiller(liveBindings, liveVarNames))

    // Emit WinterCG fetch handler
    parts.push(this.emitFetchHandler())

    return parts.join('\n')
  }

  emitServerFnImpl(fn) {
    const params = (fn.params ?? []).map(p => p.name ?? p).join(', ')
    const body = this.jsEmitter.emitBody(fn.body?.body ?? fn.body)
    return [
      `async function ${fn.name}(${params}) {`,
      `  ${body}`,
      `}`,
      ``,
    ].join('\n')
  }

  emitLiveResolver(liveDecls) {
    const assignments = liveDecls.map(d => {
      const call = this.jsEmitter.emitExpr(d.init)
      return `  const ${d.name} = await (${call})`
    }).join('\n')

    return [
      `async function _resolveData(request) {`,
      `  const _session = request._arc_session ?? {}`,
      `  try {`,
      assignments,
      `    return { ${liveDecls.map(d => d.name).join(', ')} }`,
      `  } catch (e) {`,
      `    console.error('[arc] @live data error:', e instanceof Error ? e.message : String(e))
    return { __arc_render_error__: true }`,
      `  }`,
      `}`,
      ``,
    ].join('\n')
  }

  emitHtmlFiller(liveBindings, liveVarNames) {
    // Use the authoritative liveVarNames set from the compiler (all @live decl names)
    // rather than trying to extract variable names by regex from expression strings,
    // which fails for compound expressions like (user===null||user===undefined)
    const liveVarsUsed = liveVarNames ?? new Set()
    const bindingExprs = liveBindings.map(b => ({ id: b.id, exprStr: b.expr }))

    // Build a map of span id → replacement value, then do a single-pass regex replace
    // instead of O(N) replaceAll calls over the full HTML string
    // exprStr comes from stateBindings: escape backticks/backslashes so it can't
    // break the surrounding template literal in the generated edge function.
    const mapEntries = bindingExprs.map(({ id, exprStr }) => {
      const safeExpr = exprStr.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
      // Wrap in try/catch: if a dotted path like user.name throws when user is null,
      // render empty string rather than crashing the edge function
      return `  try { _m['${id}'] = _esc(String(${safeExpr} ?? '')) } catch { _m['${id}'] = '' }`
    }).join('\n')

    const spanIds = bindingExprs.map(({ id }) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

    const cssInline = `  html = html.replace('<link rel="stylesheet" href="styles.css">', \`<style>\${BASE_CSS.replace(/<\\/style>/gi, '<\\/style>')}</style>\`)`
    const jsInline = `  if (CLIENT_JS) html = html.replace('<script src="app.js"></script>', \`<script>\${CLIENT_JS.replace(/<\\/script>/gi, '<\\/script>')}</script>\`)`

    const escFn = [
      `function _esc(s) {`,
      `  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')`,
      `}`,
      ``,
    ].join('\n')

    // Short-circuit: no @live bindings → skip regex entirely
    if (bindingExprs.length === 0) {
      return [
        escFn,
        `function _fillHtml(_data) {`,
        `  let html = BASE_HTML`,
        cssInline,
        jsInline,
        `  return html`,
        `}`,
        ``,
      ].join('\n')
    }

    return [
      escFn,
      `const _SPAN_RE = new RegExp('<span id="(' + ${JSON.stringify(spanIds)} + ')" data-arc-live><\\/span>', 'g')`,
      ``,
      `function _fillHtml(data) {`,
      `  const { ${[...liveVarsUsed].filter(v => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v) && v !== '__proto__' && v !== 'constructor' && v !== 'prototype').map(v => `${v} = undefined`).join(', ')} } = data`,
      `  const _m = Object.create(null)`,
      mapEntries,
      `  let html = BASE_HTML.replace(_SPAN_RE, (_m0, id) => {`,
      `    return id in _m ? _m[id] : _m0`,
      `  })`,
      cssInline,
      jsInline,
      `  return html`,
      `}`,
      ``,
    ].join('\n')
  }

  emitFetchHandler() {
    return [
      `// WinterCG fetch handler (Cloudflare Workers / Deno Deploy / Bun)`,
      `export default {`,
      `  async fetch(request, env, ctx) {`,
      `    try {`,
      `      const data = await _resolveData(request)`,
      `      if (data.__arc_render_error__) {`,
      `        return new Response('Internal Server Error', { status: 500 })`,
      `      }`,
      `      const html = _fillHtml(data)`,
      `      return new Response(html, {`,
      `        headers: {`,
      `          'Content-Type': 'text/html; charset=utf-8',`,
      `          'Cache-Control': 'private, no-cache',`,
      `          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'",`,
      `          'X-Content-Type-Options': 'nosniff',`,
      `          'X-Frame-Options': 'SAMEORIGIN',`,
      `          'Referrer-Policy': 'strict-origin-when-cross-origin',`,
      `          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',`,
      `        },`,
      `      })`,
      `    } catch (e) {`,
      `      console.error('[arc] edge render error:', e instanceof Error ? e.message : String(e))`,
      `      return new Response('Internal Server Error', { status: 500 })`,
      `    }`,
      `  }`,
      `}`,
      ``,
      `// Node.js / Bun / Deno adapter`,
      `if (typeof module !== 'undefined') module.exports = { _resolveData, _fillHtml }`,
    ].join('\n')
  }
}

module.exports = { EdgeRenderer }
