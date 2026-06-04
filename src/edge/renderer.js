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
  // urlPattern: the page's URL slug e.g. "/admin/blocks/code/[id]" — used to extract @param values
  emitProgram(program, baseHtml, baseCss, clientJs, stateBindings = [], urlPattern = null) {
    this.serverFns = []
    const liveDecls = program.declarations.filter(d => d.type === 'LiveDecl')
    const serverFns = program.declarations.filter(d => d.type === 'ServerFn')
    this.serverFns = serverFns
    const stateDecls = program.declarations.filter(d => d.type === 'StateDecl')
    // @param declarations: VarDecl nodes with null init — their values come from URL segments
    const paramDecls = program.declarations.filter(d => d.type === 'VarDecl' && d.init === null)

    if (liveDecls.length === 0) return null

    const liveVarNames = new Set(liveDecls.map(d => d.name))

    // Find state bindings that reference @live variables
    // stateBindings format: { id, expr: string, line }
    const _liveVarList = [...liveVarNames].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const liveVarsCombinedRe = _liveVarList.length > 0 ? new RegExp(`\\b(${_liveVarList.join('|')})\\b`) : null
    const liveBindings = liveVarsCombinedRe ? stateBindings.filter(b => liveVarsCombinedRe.test(b.expr ?? '')) : []

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
      // session is passed as a per-request argument to avoid module-level mutable state
      // (module-level state leaks between concurrent requests in CF Workers / Deno Deploy)
      parts.push(`// @server functions: run at request time on the edge`)
      for (const fn of serverFns) {
        parts.push(this.emitServerFnImpl(fn))
      }
    }

    // Emit data resolver (with @state defaults + @param URL extraction)
    parts.push(this.emitLiveResolver(liveDecls, stateDecls, paramDecls, urlPattern, serverFns))

    // Emit HTML template filler (replaces reactive spans with real data)
    parts.push(this.emitHtmlFiller(liveBindings, liveVarNames))

    // Emit WinterCG fetch handler
    parts.push(this.emitFetchHandler())

    return parts.join('\n')
  }

  emitServerFnImpl(fn) {
    const params = (fn.params ?? []).map(p => p.name ?? p).join(', ')
    const body = this.jsEmitter.emitBody(fn.body?.body ?? fn.body)
    // session is injected per-request via _makeServerFns(session) below
    return [
      `function _impl_${fn.name}(session) { return async function ${fn.name}(${params}) {`,
      `  ${body}`,
      `}; }`,
      ``,
    ].join('\n')
  }

  emitLiveResolver(liveDecls, stateDecls = [], paramDecls = [], urlPattern = null, serverFns = null) {
    // Resolve all @live decls in parallel - they're independent by construction
    // (each one calls a server/fetch fn; the resolver is the *only* place to
    // parallelize, since user code can't `await Promise.all` declaratively).
    const calls = liveDecls.map(d => `(${this.jsEmitter.emitExpr(d.init)})`).join(', ')

    // Build regex to detect which @state inits reference @live variable names
    const liveVarNames = new Set(liveDecls.map(d => d.name))
    const _liveVarList = [...liveVarNames].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const liveVarRe = _liveVarList.length > 0 ? new RegExp(`\\b(${_liveVarList.join('|')})\\b`) : null

    // @param extraction: map URL segments (e.g. /admin/blocks/[id]) to const declarations
    const urlParamLines = []
    if (urlPattern && paramDecls.length > 0) {
      const segments = urlPattern.split('/')
      for (const p of paramDecls) {
        const idx = segments.indexOf(`[${p.name}]`)
        if (idx >= 0) urlParamLines.push(`  const ${p.name} = _urlParts[${idx}] ?? ''`)
      }
    }

    // Split state declarations into:
    // - preStateDecls: don't reference @live vars → emit BEFORE resolution (used as query params)
    // - postStateDecls: reference @live vars → emit AFTER resolution to avoid ReferenceError
    const preStateDecls = []
    const postStateDecls = []
    for (const d of stateDecls) {
      if (!d.name || d.init === undefined) continue
      const exprStr = this.jsEmitter.emitExpr(d.init)
      if (liveVarRe && liveVarRe.test(exprStr)) {
        postStateDecls.push({ d, exprStr })
      } else {
        preStateDecls.push(d)
      }
    }

    const preStateDefaults = preStateDecls
      .map(d => `  const ${d.name} = ${this.jsEmitter.emitExpr(d.init)}`)

    const nameList = liveDecls.map(d => d.name)
    const nameArray = JSON.stringify(nameList)
    const urlParseLines = urlParamLines.length > 0
      ? [`  const _urlParts = new URL(request.url).pathname.split('/')`, ...urlParamLines]
      : []

    // After live data resolves, destructure @live vars so post-live state inits can reference them.
    // Wrap each in try/catch: accessing e.g. data.page.title throws when data.page is null.
    const postStateLines = postStateDecls.length > 0 ? [
      `  const { ${[...liveVarNames].map(v => `${v} = undefined`).join(', ')} } = _data`,
      ...postStateDecls.map(({ d, exprStr }) =>
        `  const ${d.name} = (() => { try { return (${exprStr}) } catch { return undefined } })()`
      ),
    ] : []

    const _sfns = serverFns ?? this.serverFns ?? []
    const serverFnBindings = _sfns.length > 0
      ? _sfns.map(fn => `  const ${fn.name} = _impl_${fn.name}(session)`).join('\n')
      : ''

    return [
      `async function _resolveData(request) {`,
      `  const session = request._arc_session ?? {}`,
      ...(serverFnBindings ? [serverFnBindings] : []),
      ...urlParseLines,
      ...preStateDefaults,
      `  const _results = await Promise.allSettled([${calls}])`,
      `  const _names = ${nameArray}`,
      `  const _data = {}`,
      `  let _anyError = false`,
      `  for (let _i = 0; _i < _names.length; _i++) {`,
      `    if (_results[_i].status === 'fulfilled') { _data[_names[_i]] = _results[_i].value }`,
      `    else { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] @live failed', name: _names[_i], error: _results[_i].reason instanceof Error ? _results[_i].reason.message : String(_results[_i].reason) })); _data[_names[_i]] = undefined; _anyError = true }`,
      `  }`,
      `  if (_anyError && Object.values(_data).every(v => v === undefined)) return { __arc_render_error__: true }`,
      ...postStateLines,
      `  return _data`,
      `}`,
      ``,
    ].join('\n')
  }

  emitHtmlFiller(liveBindings, liveVarNames) {
    // Use the authoritative liveVarNames set from the compiler (all @live decl names)
    // rather than trying to extract variable names by regex from expression strings,
    // which fails for compound expressions like (user===null||user===undefined)
    const liveVarsUsed = liveVarNames ?? new Set()

    // Split bindings by kind: text spans vs if-show/if-hide conditionals vs list for-loops
    const textBindings = liveBindings.filter(b => !b.kind || b.kind === 'text')
    const ifShowBindings = liveBindings.filter(b => b.kind === 'if-show')
    const ifHideBindings = liveBindings.filter(b => b.kind === 'if-hide')
    const listBindings = liveBindings.filter(b => b.kind === 'list')
    const bindingExprs = textBindings.map(b => ({ id: b.id, exprStr: b.expr }))

    // Build a map of span id → replacement value, then do a single-pass regex replace
    // instead of O(N) replaceAll calls over the full HTML string
    const mapEntries = bindingExprs.map(({ id, exprStr }) => {
      // Wrap in try/catch: if a dotted path like user.name throws when user is null,
      // render empty string rather than crashing the edge function
      return `  try { _m['${id}'] = _esc(String(${exprStr} ?? '')) } catch { _m['${id}'] = '' }`
    }).join('\n')

    // For if-show: condition true → remove hidden; false → keep hidden
    // For if-hide: condition true → add hidden; false → remove hidden
    const ifShowEntries = ifShowBindings.map(({ id, expr }) => {
      return `  try { if (${expr}) html = html.replaceAll('<div id="${id}" hidden>', '<div id="${id}">'); } catch {}`
    }).join('\n')
    const ifHideEntries = ifHideBindings.map(({ id, expr }) => {
      return `  try { if (${expr}) html = html.replaceAll('<div id="${id}">', '<div id="${id}" hidden>'); } catch {}`
    }).join('\n')

    // For list bindings: replace <div id="_X"></div> with rendered items
    const listEntries = listBindings.map(({ id, expr, bodyTemplate, itemName, indexName }) => {
      if (!bodyTemplate) return ''
      const iname = itemName ?? 'item'
      const idxname = indexName ?? 'i'
      return `  try { const _list_${id} = ${expr}; if (Array.isArray(_list_${id})) { html = html.replace('<div id="${id}"></div>', '<div id="${id}">' + _list_${id}.map(function(${iname}, ${idxname}) { return \`${bodyTemplate}\`; }).join('') + '</div>'); } } catch {}`
    }).join('\n')

    const spanIds = bindingExprs.map(({ id }) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

    const cssInline = `  html = html.replace('<link rel="stylesheet" href="styles.css">', \`<style>\${BASE_CSS.replace(/<\\/style>/gi, '<\\/style>')}</style>\`)`
    // BASE_HTML is captured before injectAssets adds the <script> tag, so we
    // inject CLIENT_JS by prepending to </body> rather than replacing a tag
    // that doesn't exist in the snapshotted HTML.
    // Inject all @live variables as globals before CLIENT_JS so hydration code
    // can reference them without a separate fetch round-trip.
    const liveVarInits = [...liveVarsUsed]
      .filter(v => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v) && v !== '__proto__' && v !== 'constructor' && v !== 'prototype')
      .map(v => `var ${v}=_arc_live[${JSON.stringify(v)}]`)
      .join(';')
    const jsInline = [
      `  if (CLIENT_JS) {`,
      `    const _dj = JSON.stringify(_liveData ?? {}).replace(/<\\/script>/gi, '<\\\\/script>')`,
      `    html = html.replace('</body>', \`<script>var _arc_live=\${_dj};${liveVarInits};</script><script>\${CLIENT_JS.replace(/<\\/script>/gi, '<\\/script>')}</script></body>\`)`,
      `  }`,
    ].join('\n')

    const escFn = [
      `function _esc(s) {`,
      `  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c])`,
      `}`,
      ``,
    ].join('\n')

    // Short-circuit: no @live bindings → skip regex entirely
    if (liveBindings.length === 0) {
      return [
        escFn,
        `function _fillHtml(_data) {`,
        `  let html = BASE_HTML`,
        cssInline,
        jsInline.replace('_liveData', '_data'),
        `  return html`,
        `}`,
        ``,
      ].join('\n')
    }

    const liveVarsDecl = [...liveVarsUsed]
      .filter(v => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v) && v !== '__proto__' && v !== 'constructor' && v !== 'prototype')
      .map(v => `${v} = undefined`).join(', ')

    const spanRePart = spanIds
      ? [`const _SPAN_RE = new RegExp('<span id="(' + ${JSON.stringify(spanIds)} + ')" data-arc-live><\\/span>', 'g')`, ``]
      : []

    const spanReplacePart = spanIds
      ? [`  let html = BASE_HTML.replace(_SPAN_RE, (_m0, id) => { return id in _m ? _m[id] : _m0 })`]
      : [`  let html = BASE_HTML`]

    return [
      escFn,
      ...spanRePart,
      `function _fillHtml(_liveData) {`,
      `  if (!_liveData || typeof _liveData !== 'object' || Array.isArray(_liveData)) _liveData = {}`,
      `  const { ${liveVarsDecl} } = _liveData`,
      `  const _m = Object.create(null)`,
      mapEntries,
      ...spanReplacePart,
      ifShowEntries,
      ifHideEntries,
      listEntries,
      cssInline,
      jsInline,
      `  return html`,
      `}`,
      ``,
    ].join('\n')
  }

  emitFetchHandler() {
    return [
      `// Streaming HTML: flush <head> immediately, then await @live data, then flush body.`,
      `// On any network with >0 latency to the data source, the browser starts parsing`,
      `// the head (CSS, fonts, preconnects) before the data round-trip completes.`,
      `function _splitHeadBody(html) {`,
      `  const i = html.indexOf('</head>')`,
      `  if (i === -1) return { head: '', rest: html }`,
      `  const end = i + '</head>'.length`,
      `  let head = html.slice(0, end)`,
      `  head = head.replace('<link rel="stylesheet" href="styles.css">', \`<style>\${BASE_CSS.replace(/<\\/style>/gi, '<\\/style>')}</style>\`)`,
      `  return { head, rest: html.slice(end) }`,
      `}`,
      ``,
      `const _RESPONSE_HEADERS = {`,
      `  'Content-Type': 'text/html; charset=utf-8',`,
      `  'Cache-Control': 'private, no-cache',`,
      `  // 'unsafe-inline' is required: _fillHtml injects CLIENT_JS and _arc_live data as inline <script> tags
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'",`,
      `  'X-Content-Type-Options': 'nosniff',`,
      `  'X-Frame-Options': 'SAMEORIGIN',`,
      `  'Referrer-Policy': 'strict-origin-when-cross-origin',`,
      `  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',`,
      `  // Note: Transfer-Encoding is managed by the runtime (invalid in HTTP/2; omit it)`,
      `}`,
      ``,
      `// Hoist encoder + head split to module scope — allocated once, not per request`,
      `const _enc = new TextEncoder()`,
      `const _BASE_HEAD_SPLIT = _splitHeadBody(BASE_HTML)`,
      ``,
      `// WinterCG fetch handler (Cloudflare Workers / Deno Deploy / Bun)`,
      `export default {`,
      `  async fetch(request, env, ctx) {`,
      `    const _clientId = request.headers.get('x-request-id') ?? ''`,
      `    const _traceId = /^[a-zA-Z0-9_-]{1,64}$/.test(_clientId) ? _clientId : crypto.randomUUID().slice(0, 8)`,
      `    try {`,
      `      const { head, rest } = _BASE_HEAD_SPLIT`,
      `      const stream = new ReadableStream({`,
      `        async start(controller) {`,
      `          // Flush head immediately — browser starts parsing CSS / fonts now`,
      `          controller.enqueue(_enc.encode(head))`,
      `          try {`,
      `            const data = await _resolveData(request)`,
      `            if (data && data.__arc_render_error__) {`,
      `              controller.enqueue(_enc.encode('<body><main id="main-content" style="font-family:system-ui;padding:2rem;text-align:center"><div role="alert"><h1>Something went wrong</h1><p>Please try refreshing the page.</p></div></main></body></html>'))`,
      `              controller.close(); return`,
      `            }`,
      `            // Fill spans + inline JS, then emit body remainder.`,
      `            // _fillHtml and _splitHeadBody are inside the try/catch so any error`,
      `            // (e.g. RangeError in string ops) is caught and an error page is streamed.`,
      `            const filled = _fillHtml(data)`,
      `            const filledRest = filled.slice(_BASE_HEAD_SPLIT.head.length)`,
      `            controller.enqueue(_enc.encode(filledRest))`,
      `            controller.close()`,
      `          } catch (e) {`,
      `            console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', traceId: _traceId, msg: '[arc] edge render error', error: e instanceof Error ? e.message : String(e) }))`,
      `            controller.enqueue(_enc.encode('<body><main id="main-content" style="font-family:system-ui;padding:2rem;text-align:center"><div role="alert"><h1>Something went wrong</h1><p>Please try refreshing the page.</p></div></main></body></html>'))`,
      `            controller.close()`,
      `          }`,
      `        },`,
      `      })`,
      `      return new Response(stream, { headers: _RESPONSE_HEADERS })`,
      `    } catch (e) {`,
      `      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: '[arc] edge render error', error: e instanceof Error ? e.message : String(e) }))`,
      `      return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error</title></head><body style="font-family:system-ui;padding:2rem;text-align:center"><main id="main-content"><div role="alert"><h1>Something went wrong</h1><p>Please try refreshing the page.</p></div></main></body></html>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })`,
      `    }`,
      `  }`,
      `}`,
      ``,
      `// Node.js / Bun / Deno adapter (non-streaming fallback for direct require())`,
      `if (typeof module !== 'undefined') module.exports = { _resolveData, _fillHtml, _splitHeadBody }`,
      `export { _resolveData, _fillHtml, _splitHeadBody }`,
    ].join('\n')
  }
}

module.exports = { EdgeRenderer }
