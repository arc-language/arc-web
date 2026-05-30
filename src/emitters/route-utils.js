'use strict'

function routeHandlerName(route) {
  const slug = route.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'root'
  const method = route.method.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'unknown'
  return `_route_${method}_${slug}`
}

function isValidRoute(route) {
  return route.method && /^[a-zA-Z]+$/.test(route.method) && route.path !== ''
}

function routeTypeLabel(route) {
  const stmts = route.body?.body
  if (!stmts) return 'handler'
  if (stmts.length === 1) {
    const s = stmts[0]
    const e = s.type === 'ExprStatement' ? (s.expr ?? s.expression) : null
    if (e?.type === 'CallExpr' && (e.callee?.name === 'json' || e.callee?.name === 'html') && e.args?.length === 1) {
      const a = e.args[0]
      if (a.type === 'StringLiteral' || a.type === 'NumberLiteral' || a.type === 'ObjectLiteral' || a.type === 'ArrayLiteral' || a.type === 'ObjectExpr' || a.type === 'ArrayExpr') return 'static'
    }
  }
  if (stmts.length === 2) {
    const [s0, s1] = stmts
    if (s0.type === 'VarDecl' && s0.init?.type === 'CallExpr' && s0.init.callee?.name === 'parseBody') {
      const e = s1.expr ?? s1.expression
      if (e?.type === 'CallExpr' && e.callee?.name === 'json' && e.args?.[0]?.name === s0.name) return 'echo'
    }
  }
  return 'handler'
}

module.exports = { routeHandlerName, isValidRoute, routeTypeLabel }
