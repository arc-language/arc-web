'use strict'

// Optimizer: runs after build-exec, before HTML emission.
// - Substitutes @build variable references with their values
// - Unrolls static for loops (collection is a known @build value)
// - Folds static if conditions
// - Inlines static interpolations

const N = require('./ast')

class Optimizer {
  constructor(buildContext = {}) {
    this.ctx = buildContext   // @build name → value
  }

  optimizeProgram(program) {
    const declarations = program.declarations.map(d => this.optimizeDecl(d))
    return { ...program, declarations }
  }

  optimizeDecl(decl) {
    if (decl.type === 'PageDecl') {
      return { ...decl, body: this.optimizeChildren(decl.body) }
    }
    if (decl.type === 'WidgetDecl') {
      return { ...decl, body: this.optimizeChildren(decl.body) }
    }
    return decl
  }

  optimizeChildren(children) {
    if (!children) return []
    return children.flatMap(c => this.optimizeNode(c))
  }

  optimizeNode(node) {
    if (!node) return []

    switch (node.type) {
      case 'Element':
        return [{ ...node, children: this.optimizeChildren(node.children) }]

      case 'ForNode':
        return this.optimizeFor(node)

      case 'IfNode':
        return this.optimizeIf(node)

      case 'UnlessNode':
        return this.optimizeUnless(node)

      case 'InterpolationNode':
        return [this.optimizeInterpolation(node)]

      case 'TemplateLiteral':
        return [this.optimizeTemplateLiteral(node)]

      default:
        return [node]
    }
  }

  // ── Static for-loop unrolling ─────────────────────────────────────────────

  optimizeFor(node) {
    const collection = this.resolveExpr(node.collection)
    if (!Array.isArray(collection)) {
      // Can't unroll - leave as reactive for
      return [{ ...node, body: this.optimizeChildren(node.body) }]
    }

    // Static unrolling: expand to N copies of the body with bindings substituted
    const result = []
    for (let i = 0; i < collection.length; i++) {
      const item = collection[i]
      const itemBindings = {
        [node.itemName]: item,
        ...(node.indexName ? { [node.indexName]: i } : {}),
      }
      const expanded = this.optimizeChildrenWithBindings(node.body, itemBindings)
      result.push(...expanded)
    }
    return result
  }

  optimizeChildrenWithBindings(children, bindings) {
    if (!children) return []
    return children.flatMap(c => this.optimizeNodeWithBindings(c, bindings))
  }

  optimizeNodeWithBindings(node, bindings) {
    if (!node) return []

    switch (node.type) {
      case 'Element': {
        // Substitute attr values
        const newAttrs = {}
        for (const [k, v] of Object.entries(node.attrs ?? {})) {
          newAttrs[k] = this.substituteExpr(v, bindings)
        }
        return [{
          ...node,
          attrs: newAttrs,
          children: this.optimizeChildrenWithBindings(node.children, bindings),
        }]
      }

      case 'InterpolationNode': {
        const resolved = this.resolveExprWithBindings(node.expr, bindings)
        if (resolved !== undefined) {
          return [N.TextNode(String(resolved), node.line)]
        }
        return [node]
      }

      case 'TemplateLiteral': {
        const parts = node.parts.map(p => {
          if (p.type === 'Literal') return p
          const val = this.resolveExprWithBindings(p, bindings)
          if (val !== undefined) return N.Literal(String(val), String(val), p.line)
          return p
        })
        // If all parts are now literals, collapse to TextNode
        if (parts.every(p => p.type === 'Literal')) {
          return [N.TextNode(parts.map(p => p.value).join(''), node.line)]
        }
        return [{ ...node, parts }]
      }

      case 'ForNode':
        return this.optimizeForWithBindings(node, bindings)

      case 'IfNode': {
        const condVal = this.resolveExprWithBindings(node.condition, bindings)
        if (condVal !== undefined) {
          return condVal
            ? this.optimizeChildrenWithBindings(node.consequent, bindings)
            : (node.alternate ? this.optimizeChildrenWithBindings(node.alternate, bindings) : [])
        }
        return [node]
      }

      default:
        return [node]
    }
  }

  optimizeForWithBindings(node, outerBindings) {
    const collection = this.resolveExprWithBindings(node.collection, outerBindings)
    if (!Array.isArray(collection)) return [node]

    const result = []
    for (let i = 0; i < collection.length; i++) {
      const item = collection[i]
      const combined = {
        ...outerBindings,
        [node.itemName]: item,
        ...(node.indexName ? { [node.indexName]: i } : {}),
      }
      result.push(...this.optimizeChildrenWithBindings(node.body, combined))
    }
    return result
  }

  // ── Static if folding ─────────────────────────────────────────────────────

  optimizeIf(node) {
    const val = this.resolveExpr(node.condition)
    if (val !== undefined) {
      if (val) return this.optimizeChildren(node.consequent)
      if (node.alternate) return this.optimizeChildren(node.alternate)
      return []
    }
    return [{
      ...node,
      consequent: this.optimizeChildren(node.consequent),
      alternate: node.alternate ? this.optimizeChildren(node.alternate) : null,
    }]
  }

  optimizeUnless(node) {
    const val = this.resolveExpr(node.condition)
    if (val !== undefined) {
      return val ? [] : this.optimizeChildren(node.consequent)
    }
    return [{ ...node, consequent: this.optimizeChildren(node.consequent) }]
  }

  // ── Static interpolation folding ─────────────────────────────────────────

  optimizeInterpolation(node) {
    const val = this.resolveExpr(node.expr)
    if (val !== undefined) {
      return N.TextNode(String(val), node.line)
    }
    return node
  }

  optimizeTemplateLiteral(node) {
    const parts = node.parts.map(p => {
      if (p.type === 'Literal') return p
      const val = this.resolveExpr(p)
      if (val !== undefined) return N.Literal(String(val), String(val), p.line)
      return p
    })
    if (parts.every(p => p.type === 'Literal')) {
      return N.TextNode(parts.map(p => p.value).join(''), node.line)
    }
    return { ...node, parts }
  }

  // ── Expression resolvers ──────────────────────────────────────────────────

  resolveExpr(expr) {
    return this.resolveExprWithBindings(expr, {})
  }

  resolveExprWithBindings(expr, bindings) {
    if (!expr) return undefined

    if (expr.type === 'Literal') return expr.value

    if (expr.type === 'Identifier') {
      if (expr.name in bindings) return bindings[expr.name]
      if (expr.name in this.ctx) return this.ctx[expr.name]
      return undefined
    }

    if (expr.type === 'MemberExpr' && !expr.computed) {
      const obj = this.resolveExprWithBindings(expr.object, bindings)
      if (obj !== undefined && obj !== null) {
        const key = expr.property.name ?? expr.property.value
        return obj[key]
      }
      return undefined
    }

    if (expr.type === 'MemberExpr' && expr.computed) {
      const obj = this.resolveExprWithBindings(expr.object, bindings)
      const key = this.resolveExprWithBindings(expr.property, bindings)
      if (obj !== undefined && key !== undefined) return obj[key]
      return undefined
    }

    if (expr.type === 'BinaryExpr') {
      const l = this.resolveExprWithBindings(expr.left, bindings)
      const r = this.resolveExprWithBindings(expr.right, bindings)
      if (l !== undefined && r !== undefined) {
        return this.applyOp(expr.op, l, r)
      }
      return undefined
    }

    if (expr.type === 'UnaryExpr') {
      const v = this.resolveExprWithBindings(expr.operand, bindings)
      if (v !== undefined) {
        if (expr.op === '!') return !v
        if (expr.op === '-') return -v
      }
      return undefined
    }

    if (expr.type === 'TemplateLiteral') {
      const parts = expr.parts.map(p => this.resolveExprWithBindings(p, bindings))
      if (parts.every(p => p !== undefined)) return parts.join('')
      return undefined
    }

    if (expr.type === 'NullCoalesce') {
      const l = this.resolveExprWithBindings(expr.left, bindings)
      if (l !== null && l !== undefined) return l
      return this.resolveExprWithBindings(expr.right, bindings)
    }

    return undefined
  }

  substituteExpr(expr, bindings) {
    if (!expr || typeof expr !== 'object') return expr
    const val = this.resolveExprWithBindings(expr, bindings)
    if (val === undefined) return expr
    // Only inline primitives. Objects/arrays wrapped in Literal would serialize
    // as `[object Object]` via String(val), corrupting downstream emitters that
    // read .raw. Leave them as the original expression.
    const t = typeof val
    if (t !== 'string' && t !== 'number' && t !== 'boolean' && val !== null) {
      return expr
    }
    return N.Literal(val, String(val), expr.line)
  }

  applyOp(op, l, r) {
    switch (op) {
      case '+':  return l + r
      case '-':  return l - r
      case '*':  return l * r
      case '/':  return l / r
      case '%':  return l % r
      case '==': return l === r
      case '!=': return l !== r
      case '<':  return l < r
      case '>':  return l > r
      case '<=': return l <= r
      case '>=': return l >= r
      default:   return undefined
    }
  }
}

module.exports = { Optimizer }
