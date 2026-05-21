'use strict'

// @live edge renderer.
// Generates a WinterCG-compatible edge function that:
//   1. Runs @server functions at request time (on the edge)
//   2. Fills all @live variable spans in the HTML template with real data
//   3. Streams complete, personalized HTML to the browser in ONE request
//
// Result: browser gets pre-rendered HTML — no flash, no loading state,
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
      `// Arc @live edge renderer — auto-generated`,
      `// One request → edge resolves data → full HTML → browser`,
      ``,
      `const BASE_HTML = ${JSON.stringify(baseHtml)}`,
      `const BASE_CSS = ${JSON.stringify(baseCss)}`,
      `const CLIENT_JS = ${JSON.stringify(clientJs?.trim() ? clientJs : null)}`,
      ``,
    ]

    // Emit @server fn implementations (called at request time on edge)
    if (serverFns.length > 0) {
      parts.push(`// @server functions — run at request time on the edge`)
      for (const fn of serverFns) {
        parts.push(this.emitServerFnImpl(fn))
      }
    }

    // Emit data resolver
    parts.push(this.emitLiveResolver(liveDecls))

    // Emit HTML template filler (replaces reactive spans with real data)
    parts.push(this.emitHtmlFiller(liveBindings))

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
      `    console.error('[arc] @live data error:', e)
    return { __arc_render_error__: true }`,
      `  }`,
      `}`,
      ``,
    ].join('\n')
  }

  emitHtmlFiller(liveBindings) {
    // Collect top-level @live variable names referenced in bindings
    // stateBindings format: { id, expr: string }
    const liveVarsUsed = new Set()
    const bindingExprs = liveBindings.map(b => {
      const exprStr = b.expr
      // Strip leading @ for AtProperty expressions before extracting the var name
      const raw = exprStr.replace(/^@/, '')
      const m = raw.match(/^([a-z_][a-z0-9_]*)\b/i)
      if (m) liveVarsUsed.add(m[1])
      return { id: b.id, exprStr }
    })

    const destructure = [...liveVarsUsed].join(', ')

    // Build a map of span id → replacement value, then do a single-pass regex replace
    // instead of O(N) replaceAll calls over the full HTML string
    const mapEntries = bindingExprs.map(({ id, exprStr }) =>
      `  _m['${id}'] = _esc(String(${exprStr} ?? ''))`
    ).join('\n')

    const spanIds = bindingExprs.map(({ id }) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const regexSrc = spanIds.length > 0
      ? `'<span id="(?:' + ${JSON.stringify(spanIds)} + ')" aria-live="polite"></\\\\/span>'`
      : `'(?!)'`

    return [
      `function _esc(s) {`,
      `  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')`,
      `}`,
      ``,
      `function _fillHtml(data) {`,
      `  const { ${[...liveVarsUsed].filter(v => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v)).map(v => `${v} = undefined`).join(', ')} } = data`,
      `  const _m = Object.create(null)`,
      mapEntries,
      `  const _re = new RegExp(${regexSrc}, 'g')`,
      `  let html = BASE_HTML.replace(_re, m => {`,
      `    const id = m.match(/id="([^"]+)"/)?.[1]`,
      `    return id && id in _m ? _m[id] : m`,
      `  })`,
      `  html = html.replace('<link rel="stylesheet" href="styles.css">', \`<style>\${BASE_CSS.replace(/<\\/style>/gi, '<\\/style>')}</style>\`)`,
      `  if (CLIENT_JS) html = html.replace('<script src="app.js"></script>', \`<script>\${CLIENT_JS.replace(/<\\/script>/gi, '<\\/script>')}</script>\`)`,
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
      `        },`,
      `      })`,
      `    } catch (e) {`,
      `      console.error('[arc] edge render error:', e)`,
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
