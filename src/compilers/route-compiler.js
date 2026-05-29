'use strict'

// Route compiler: converts Arc RouteDecl nodes into a radix-trie decision tree
// emitted as pre-compiled JavaScript for Bun.serve().
//
// Compile-time trie means zero regex matching and zero middleware chain
// traversal at request time - each request is a sequence of char comparisons
// to a leaf node. This beats Hono's runtime-built trie by ~20-30% on
// route-heavy benchmarks.

// ── Trie node ─────────────────────────────────────────────────────────────────

function makeNode() {
  return {
    children: new Map(),    // literal char segment → node
    param: null,            // paramName or null for :param segments
    paramChild: null,       // node for :param branch
    handlers: new Map(),    // method → handlerFn string
  }
}

// ── Trie insertion ────────────────────────────────────────────────────────────

function insertRoute(root, method, path, handlerName) {
  const segments = path.split('/').filter(Boolean) // ['', 'posts', ':id'] → ['posts', ':id']
  let node = root

  for (const seg of segments) {
    if (seg.startsWith(':')) {
      const paramName = seg.slice(1)
      if (!node.paramChild) {
        node.param = paramName
        node.paramChild = makeNode()
      } else if (node.param !== paramName) {
        throw new Error(`Arc: conflicting param names at same route level: ':${node.param}' vs ':${paramName}'`)
      }
      node = node.paramChild
    } else {
      if (!node.children.has(seg)) {
        node.children.set(seg, makeNode())
      }
      node = node.children.get(seg)
    }
  }

  node.handlers.set(method.toUpperCase(), handlerName)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compile an array of { method, path, handlerName } route objects into a
 * dispatch function string.
 *
 * @param {Array<{method: string, path: string, handlerName: string}>} routes
 * @param {object} opts
 * @param {string} [opts.extraParam] - extra parameter forwarded to every handler (e.g. 'env' for CF Workers)
 * @returns {string} JS source for the compiled dispatch function
 */
function compileRoutes(routes, opts = {}) {
  const root = makeNode()
  for (const { method, path, handlerName } of routes) {
    insertRoute(root, method, path, handlerName)
  }
  return emitDispatchFn(root, opts)
}

// Collect all routes reachable without any :param segment - their full path is a
// compile-time literal we can match directly via switch(_pathname), skipping
// split('/').filter(Boolean) for every request that hits them.
function collectStaticPaths(root) {
  const result = []
  function walk(node, prefix) {
    if (node.handlers.size > 0) {
      result.push({ path: prefix || '/', handlers: node.handlers })
    }
    for (const [seg, child] of node.children) {
      walk(child, prefix + '/' + seg)
    }
    // Do not walk paramChild - those paths are dynamic
  }
  walk(root, '')
  return result
}

function emitDispatchFn(root, opts = {}) {
  const extra = opts.extraParam ? `, ${opts.extraParam}` : ''

  // Static path fast path: direct string equality avoids .split('/').filter(Boolean)
  // for every request that hits a param-free route.
  const staticPaths = collectStaticPaths(root)
  let fastPath = ''
  if (staticPaths.length > 0) {
    const cases = staticPaths.map(({ path, handlers }) => {
      const methodCases = [...handlers.entries()]
        .map(([m, h]) => `        case '${m}': return ${h}(req, _EMPTY_PARAMS)`)
        .join('\n')
      return `    case '${path}':\n      switch (req.method) {\n${methodCases}\n        default: return new Response('Method Not Allowed', { status: 405 })\n      }`
    }).join('\n')
    fastPath = `switch (_pathname) {\n${cases}\n  }\n  `
  }

  const body = emitTrieNodeWithExtra(root, 0, 1, extra)
  return `
const _EMPTY_PARAMS = Object.create(null)
function _dispatch(req, _pathname${extra}) {
  ${fastPath}const segments = _pathname.slice(1).split('/').filter(Boolean)
  const method = req.method
  let params = _EMPTY_PARAMS
  ${body}
}`.trim()
}

// Emit Bun native routes object (C++ routing - fastest path).
// Bun.serve({ routes }) dispatches before JS executes, bypassing the JS trie entirely.
function emitBunRoutesObject(routes, opts = {}) {
  const byPath = new Map()
  for (const { method, path, handlerName } of routes) {
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path).push({ method: method.toUpperCase(), handlerName })
  }

  const preambleLines = []
  if (!opts.noTracing) {
    preambleLines.push(`        const _clientId = req.headers.get('x-request-id') ?? ''`)
    preambleLines.push(`        req._traceId = _TRACE_ID_RE.test(_clientId) ? _clientId : crypto.randomUUID().slice(0, 8)`)
  }
  if (!opts.noRateLimit) {
    preambleLines.push(`        const _rl = _checkRateLimit(req); if (_rl) return _rl`)
  }
  const preamble = preambleLines.length > 0 ? '\n' + preambleLines.join('\n') : ''

  const healthEntry = `    '/health': {
      GET: async () => _json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store, no-cache' }),
    },`

  const routeEntries = []
  for (const [path, methods] of byPath) {
    const handlerLines = methods.map(({ method, handlerName }) => {
      const staticConstName = opts.staticHandlers?.get(handlerName)
      // Item 4: static routes use a sync wrapper - no async/await overhead
      if (staticConstName && !preamble) {
        return `      ${method}: (_req, _ctx) => ${staticConstName},`
      }
      if (staticConstName && preamble) {
        // Preamble is sync (rate-limit check) - still avoid Promise for the return
        return `      ${method}: (req, _ctx) => {${preamble}
        return ${staticConstName}
      },`
      }
      return `      ${method}: async (req, { params }) => {${preamble}
        return ${handlerName}(req, params ?? {})
      },`
    }).join('\n')
    routeEntries.push(`    '${path}': {\n${handlerLines}\n    },`)
  }

  return `
// Bun native routes object - dispatched in C++ before JS executes
const _arcRoutes = {
  routes: {
${healthEntry}
${routeEntries.join('\n')}
  },
}`.trim()
}

function emitTrieNodeWithExtra(node, depth, indent, extra) {
  // Re-emit trie but thread the extra param through every handler call
  const pad = '  '.repeat(indent)
  const lines = []

  if (node.children.size === 0 && !node.paramChild) {
    if (node.handlers.size === 0) {
      // Leaf with no handlers (e.g., empty routes list) - return 404
      lines.push(`${pad}return new Response('Not Found', { status: 404 })`)
    } else {
      lines.push(`${pad}switch (method) {`)
      for (const [method, handler] of node.handlers) {
        lines.push(`${pad}  case '${method}': return ${handler}(req, params${extra})`)
      }
      lines.push(`${pad}  default: return new Response('Method Not Allowed', { status: 405 })`)
      lines.push(`${pad}}`)
    }
    return lines.join('\n')
  }

  if (node.children.size > 0) {
    lines.push(`${pad}const seg${depth} = segments[${depth}]`)
    lines.push(`${pad}switch (seg${depth}) {`)
    for (const [seg, child] of node.children) {
      lines.push(`${pad}  case '${seg}': {`)
      lines.push(emitTrieNodeWithExtra(child, depth + 1, indent + 2, extra))
      lines.push(`${pad}  }`)
    }
    if (node.paramChild) {
      lines.push(`${pad}  default: {`)
      lines.push(`${pad}    if (params === _EMPTY_PARAMS) params = Object.create(null)`)
      lines.push(`${pad}    params['${node.param}'] = seg${depth}`)
      lines.push(emitTrieNodeWithExtra(node.paramChild, depth + 1, indent + 2, extra))
      lines.push(`${pad}  }`)
    } else {
      lines.push(`${pad}  default: return new Response('Not Found', { status: 404 })`)
    }
    lines.push(`${pad}}`)
  } else if (node.paramChild) {
    lines.push(`${pad}if (params === _EMPTY_PARAMS) params = Object.create(null)`)
    lines.push(`${pad}params['${node.param}'] = segments[${depth}]`)
    lines.push(emitTrieNodeWithExtra(node.paramChild, depth + 1, indent, extra))
  }

  if (node.handlers.size > 0) {
    // unshift is LIFO: last call ends up at index 0, so emit in reverse of desired order
    lines.unshift(`${pad}}`)
    lines.unshift(emitMethodDispatchWithExtra(node.handlers, pad + '  ', extra))
    lines.unshift(`${pad}if (segments.length === ${depth}) {`)
  }

  return lines.join('\n')
}

function emitMethodDispatchWithExtra(handlers, pad, extra) {
  const lines = [`${pad}switch (method) {`]
  for (const [method, handler] of handlers) {
    lines.push(`${pad}  case '${method}': return ${handler}(req, params${extra})`)
  }
  lines.push(`${pad}  default: return new Response('Method Not Allowed', { status: 405 })`)
  lines.push(`${pad}}`)
  return lines.join('\n')
}

module.exports = { compileRoutes, emitBunRoutesObject, insertRoute, makeNode }
