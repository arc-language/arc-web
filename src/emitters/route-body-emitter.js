'use strict'

// Shared route body emission helpers used by Bun and Cloudflare server emitters.
//
// In route/job bodies: response calls (json/redirect/html/text) need `return`,
// async helpers (parseBody, auth.*, oauth.*, jwt.*) need `await`.

const _SAFE_VAR_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

// Calls that always return a Response and should be prefixed with `return`
const _RETURN_FUNS = new Set(['json', 'redirect', 'html', 'text', 'auth.clear'])
// Calls that return a Response and are async - prefix with `return await`
const _RETURN_AWAIT_FUNS = new Set(['auth.set'])
// Async call RHS in VarDecl - prefix with `await`
// IMPORTANT: keep in sync with emitter-preamble.js SHARED_RESPONSE_HELPERS, auth-helpers.js, and queue-helpers.js.
// Any new async helper emitted into generated server code must also be added here.
const _AWAIT_FUNS = new Set([
  'parseBody',
  'auth.session', 'auth.require',
  'oauth.github.callback', 'oauth.google.callback',
  'jwt.sign', 'jwt.verify',
  'email.send',
])

// db.MODEL.METHOD calls that are async in the Postgres target (SQLite is sync).
// These are recognized by the 3-part path pattern rather than a static name set
// because the MODEL segment is user-defined (e.g. db.posts.findMany).
const _DB_ASYNC_METHODS = new Set([
  'findMany', 'findOne', 'find', 'findById', 'findFirst', 'findUnique',
  'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany',
  'upsert', 'count', 'exists', 'aggregate',
])

function _isDbCall(callPath) {
  // Avoid split() allocation - check db. prefix, then find the method after the second dot.
  const first = callPath.indexOf('.')
  if (first === -1 || callPath.slice(0, first) !== 'db') return false
  const second = callPath.indexOf('.', first + 1)
  if (second === -1 || callPath.indexOf('.', second + 1) !== -1) return false
  return _DB_ASYNC_METHODS.has(callPath.slice(second + 1))
}

function _calleePath(callee, depth = 0) {
  if (!callee || depth > 10) return ''
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpr') {
    const obj = _calleePath(callee.object, depth + 1)
    const prop = callee.property?.name ?? callee.property?.value ?? ''
    return obj ? `${obj}.${prop}` : prop
  }
  return ''
}

function emitRouteBody(stmts, jsEmitter) {
  if (!stmts) return ''
  if (!Array.isArray(stmts)) stmts = [stmts]
  return stmts.map(s => emitRouteStmt(s, jsEmitter)).filter(Boolean).join('\n')
}

function emitRouteStmt(stmt, jsEmitter) {
  if (!stmt) return ''

  if (stmt.type === 'ExprStatement') {
    const expr = stmt.expr ?? stmt.expression
    if (expr?.type === 'CallExpr') {
      const name = _calleePath(expr.callee)
      if (_RETURN_FUNS.has(name))
        return `return ${jsEmitter.emitExpr(expr)};`
      if (_RETURN_AWAIT_FUNS.has(name))
        return `return await ${jsEmitter.emitExpr(expr)};`
      if (_AWAIT_FUNS.has(name) || _isDbCall(name))
        return `await ${jsEmitter.emitExpr(expr)};`
    }
    return `${jsEmitter.emitExpr(expr ?? stmt)};`
  }

  if (stmt.type === 'VarDecl') {
    const kind = stmt.kind === 'let' ? 'let' : 'const'
    if (!_SAFE_VAR_IDENT.test(stmt.name)) throw new Error(`Arc: invalid identifier ${JSON.stringify(stmt.name)} in route body`)
    if (stmt.init?.type === 'CallExpr') {
      const name = _calleePath(stmt.init.callee)
      if (_AWAIT_FUNS.has(name) || _isDbCall(name))
        return `${kind} ${stmt.name} = await ${jsEmitter.emitExpr(stmt.init)};`
    }
    return `${kind} ${stmt.name} = ${jsEmitter.emitExpr(stmt.init)};`
  }

  if (stmt.type === 'MatchStatement') {
    return emitRouteMatch(stmt, jsEmitter)
  }

  if (stmt.type === 'BlockStatement') {
    return `{${emitRouteBody(stmt.body, jsEmitter)}}`
  }

  if (stmt.type === 'IfStatement') {
    const cond = jsEmitter.emitExpr(stmt.condition)
    const cons = emitRouteBody(stmt.consequent?.body ?? stmt.consequent, jsEmitter)
    const alt = stmt.alternate
      ? `else{${emitRouteBody(stmt.alternate?.body ?? stmt.alternate, jsEmitter)}}`
      : ''
    return `if(${cond}){${cons}}${alt}`
  }

  // ReturnStatement, ForStatement, WhileStatement etc. fall through to general emitter
  return jsEmitter.emitStmt(stmt)
}

function emitRouteArmBody(body, jsEmitter) {
  if (!body) return ''
  if (body.type === 'BlockStatement') return emitRouteBody(body.body, jsEmitter)
  if (Array.isArray(body)) return emitRouteBody(body, jsEmitter)
  if (body.type === 'ExprStatement') return emitRouteArmBody(body.expr ?? body.expression, jsEmitter)
  // Single expression arm: treat as a statement
  if (body.type === 'CallExpr') {
    const name = _calleePath(body.callee)
    if (_RETURN_FUNS.has(name))
      return `return ${jsEmitter.emitExpr(body)};`
    if (_RETURN_AWAIT_FUNS.has(name))
      return `return await ${jsEmitter.emitExpr(body)};`
    if (_AWAIT_FUNS.has(name) || _isDbCall(name))
      return `await ${jsEmitter.emitExpr(body)};`
  }
  return `${jsEmitter.emitExpr(body)};`
}

function emitRouteMatch(stmt, jsEmitter) {
  const id = (jsEmitter._matchCounter = (jsEmitter._matchCounter ?? 0) + 1)
  const subj = `_ms${id}`
  const cond = jsEmitter.emitExpr(stmt.subject)

  // Move wildcard/identifier catch-all arms to the end so they don't orphan
  // subsequent `else if` clauses. Parser should enforce this, but guard here too.
  const wildcardCount = (stmt.arms ?? []).filter(a => !a.pattern || a.pattern.type === 'Wildcard' || a.pattern.type === 'Identifier').length
  if (wildcardCount > 1) console.warn(`[arc] match statement has ${wildcardCount} wildcard/catch-all arms — only the first will be reachable`)
  const sorted = [...(stmt.arms ?? [])].sort((a, b) => {
    const aIsWild = !a.pattern || a.pattern.type === 'Wildcard' || a.pattern.type === 'Identifier'
    const bIsWild = !b.pattern || b.pattern.type === 'Wildcard' || b.pattern.type === 'Identifier'
    if (aIsWild === bIsWild) return 0
    return aIsWild ? 1 : -1
  })

  const arms = sorted.map((arm, i) => {
    const body = emitRouteArmBody(arm.body, jsEmitter)
    const pfx = i === 0 ? 'if' : 'else if'

    if (!arm.pattern || arm.pattern.type === 'Wildcard') {
      return i === 0 ? `{ ${body} }` : `else { ${body} }`
    }
    if (arm.pattern.type === 'Identifier') {
      const bind = arm.pattern.name
      return i === 0 ? `{ const ${bind} = ${subj}; ${body} }` : `else { const ${bind} = ${subj}; ${body} }`
    }
    if (arm.pattern.type === 'VariantPattern') {
      const test = jsEmitter.emitPattern(arm.pattern, subj)
      const bind = arm.pattern.name ? `const ${arm.pattern.name} = ${subj}; ` : ''
      return `${pfx}(${test}) { ${bind}${body} }`
    }
    const test = jsEmitter.emitPattern(arm.pattern, subj)
    return `${pfx}(${test}) { ${body} }`
  })

  return `const ${subj} = ${cond};\n${arms.join('\n')}`
}

// Shared catch block emitted inside every route handler.
// `traceLog` is the full console.error(...) statement string — callers
// build it with the appropriate traceId/method/path interpolations.
function emitCatchBlock(traceLog) {
  return `} catch (_e) {
    if (_e?._authError) return _json({ error: 'Unauthorized' }, 401)
    if (_e?.status === 413) return _json({ error: 'Request body too large' }, 413)
    if (_e?.status === 422) return _json({ error: _e.message ?? 'Unprocessable entity' }, 422)
    if (_e?.status === 400) return _json({ error: _e.message ?? 'Bad request' }, 400)
    ${traceLog}
    if (process.env.ARC_DEBUG === '1' && process.env.NODE_ENV === 'development') {
      return _json({ error: 'Internal server error', message: _e?.message ?? String(_e), name: _e?.name, stack: (_e?.stack ?? '').split('\\n').slice(0, 8) }, 500)
    }
    return _json({ error: 'Internal server error' }, 500)
  }`
}

module.exports = {
  _RETURN_FUNS,
  _RETURN_AWAIT_FUNS,
  _AWAIT_FUNS,
  emitRouteBody,
  emitRouteStmt,
  emitRouteArmBody,
  emitRouteMatch,
  emitCatchBlock,
}
