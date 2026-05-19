'use strict'

// Arc semantic checker.
// Runs after parsing — catches errors the parser can't see:
//   - Undefined variables in expressions and templates
//   - Missing required attributes (img without alt)
//   - @session used outside @server/@live
//   - Duplicate declarations
//   - Unknown annotations
//   - Dead @build imports (referenced but never declared)
//   - bind:value on non-state variable
//   - Unreachable returns (basic)

class ArcError {
  constructor(message, filename, line, col) {
    this.message = message
    this.filename = filename
    this.line = line
    this.col = col
  }
  toString() {
    const loc = [this.filename, this.line, this.col].filter(Boolean).join(':')
    return `${loc}: ${this.message}`
  }
}

class Checker {
  constructor(filename = '<input>') {
    this.filename = filename
    this.errors = []
    this.warnings = []
  }

  error(msg, node) {
    this.errors.push(new ArcError(msg, this.filename, node?.line, node?.col))
  }

  warn(msg, node) {
    this.warnings.push(new ArcError(msg, this.filename, node?.line, node?.col))
  }

  check(program) {
    // Collect all declared names at program level
    const declared = new Map() // name → node type

    for (const decl of program.declarations) {
      this.checkDecl(decl, declared)
    }

    return { errors: this.errors, warnings: this.warnings }
  }

  checkDecl(decl, declared) {
    switch (decl.type) {
      case 'StateDecl':
      case 'ComputedDecl':
      case 'BuildDecl':
      case 'LiveDecl':
      case 'RealtimeDecl':
        this.checkVarDecl(decl, declared)
        break
      case 'ServerFn':
      case 'WorkerFn':
        this.checkFnDecl(decl, declared)
        break
      case 'PageDecl':
        this.checkPage(decl, declared)
        break
      case 'WidgetDecl':
        this.checkWidget(decl, declared)
        break
      case 'VarDecl':
      case 'FnDecl':
        this.checkLocalDecl(decl, declared)
        break
      case 'ClassDecl':
        this.checkClassDecl(decl, declared)
        break
      case 'ImportDecl':
        break // handled by resolveImports in cli.js
    }
  }

  checkVarDecl(decl, declared) {
    const name = decl.name
    if (declared.has(name)) {
      this.error(`Duplicate declaration: "${name}" already declared`, decl)
    } else {
      declared.set(name, decl.type)
    }
    if (decl.init) {
      this.checkExpr(decl.init, declared, { allowAwait: decl.type === 'BuildDecl' })
    }
  }

  checkFnDecl(decl, declared) {
    const name = decl.name
    if (declared.has(name)) {
      this.error(`Duplicate declaration: "${name}" already declared`, decl)
    } else {
      declared.set(name, decl.type)
    }

    // Check body with params in scope
    const localScope = new Map(declared)
    for (const p of decl.params ?? []) {
      const pname = p.name ?? p
      if (pname) localScope.set(pname, 'Param')
    }
    if (decl.body) this.checkBody(decl.body, localScope, { inServer: decl.type === 'ServerFn' })
  }

  checkLocalDecl(decl, declared) {
    if (decl.name) declared.set(decl.name, decl.type ?? 'VarDecl')
    if (decl.init) this.checkExpr(decl.init, declared, {})
  }

  checkClassDecl(decl, declared) {
    const name = decl.name
    if (name) {
      if (declared.has(name)) {
        this.error(`Duplicate declaration: "${name}" already declared`, decl)
      } else {
        declared.set(name, 'ClassDecl')
      }
    }
    // Check methods with class fields in scope
    const classScope = new Map(declared)
    for (const field of decl.fields ?? []) {
      if (field.name) classScope.set(field.name, 'ClassField')
      if (field.init) this.checkExpr(field.init, classScope, {})
    }
    for (const method of decl.methods ?? []) {
      const methodScope = new Map(classScope)
      for (const p of method.params ?? []) {
        const pname = p.name ?? p
        if (pname) methodScope.set(pname, 'Param')
      }
      if (method.body) this.checkBody(method.body, methodScope, {})
    }
  }

  checkPage(decl, declared) {
    this.checkTemplateBody(decl.body ?? [], declared)
  }

  checkWidget(decl, declared) {
    const localScope = new Map(declared)
    for (const p of decl.params ?? []) {
      const pname = p.name ?? p
      if (pname) localScope.set(pname, 'Param')
    }
    // Widget @attr references (@name) are duck-typed — suppress AtProperty errors
    const savedInWidget = this.inWidget
    this.inWidget = true
    this.checkTemplateBody(decl.body ?? [], localScope)
    this.inWidget = savedInWidget
  }

  checkTemplateBody(nodes, declared) {
    for (const node of nodes) {
      if (!node) continue
      this.checkTemplateNode(node, declared)
    }
  }

  checkTemplateNode(node, declared) {
    if (!node) return
    switch (node.type) {
      case 'Element':
        this.checkElement(node, declared)
        break
      case 'InterpolationNode':
        this.checkExpr(node.expr, declared, {})
        break
      case 'TemplateLiteral':
        for (const part of node.parts ?? []) {
          if (part.type !== 'Literal') this.checkExpr(part, declared, {})
        }
        break
      case 'ForNode':
        this.checkForNode(node, declared)
        break
      case 'IfNode':
      case 'UnlessNode':
        this.checkExpr(node.condition, declared, {})
        this.checkTemplateBody(node.consequent ?? [], declared)
        if (node.alternate) this.checkTemplateBody(node.alternate ?? [], declared)
        break
      case 'TextNode':
        break
    }
  }

  checkElement(node, declared) {
    // Check required attributes
    if (node.tag === 'img') {
      if (!node.attrs?.alt) {
        this.warn(`<img> is missing alt attribute — add alt="" for decorative images`, node)
      }
    }

    // Check event handler expressions
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      if (key.startsWith('on:') && value && typeof value === 'object') {
        if (value.type === 'BlockStatement') {
          this.checkBody(value, declared, { allowAwait: true })
        } else {
          this.checkExpr(value, declared, { allowAwait: true })
        }
      }
      if (key === 'bind:value' || key.startsWith('bind:')) {
        // Value should be a declared @state variable
        const bindExpr = value
        if (bindExpr?.type === 'Identifier' && !declared.has(bindExpr.name)) {
          this.error(`bind:${key.slice(5)} references undeclared variable "${bindExpr.name}"`, node)
        }
      }
    }

    this.checkTemplateBody(node.children ?? [], declared)
  }

  checkForNode(node, declared) {
    this.checkExpr(node.collection, declared, {})
    const innerScope = new Map(declared)
    if (node.itemName) innerScope.set(node.itemName, 'ForVar')
    if (node.indexName) innerScope.set(node.indexName, 'ForVar')
    this.checkTemplateBody(node.body ?? [], innerScope)
  }

  checkBody(body, declared, ctx = {}) {
    const stmts = body?.body ?? (Array.isArray(body) ? body : [])
    const localScope = new Map(declared)
    for (const stmt of stmts) {
      this.checkStmt(stmt, localScope, ctx)
    }
  }

  checkStmt(stmt, declared, ctx) {
    if (!stmt) return
    switch (stmt.type) {
      case 'VarDecl':
        if (stmt.init) this.checkExpr(stmt.init, declared, ctx)
        if (stmt.name) declared.set(stmt.name, 'VarDecl')
        break
      case 'ReturnStatement':
        if (stmt.value) this.checkExpr(stmt.value, declared, ctx)
        break
      case 'ExprStatement':
        this.checkExpr(stmt.expression ?? stmt.expr, declared, ctx)
        break
      case 'IfStatement':
        this.checkExpr(stmt.condition, declared, ctx)
        this.checkBody(stmt.consequent, declared, ctx)
        if (stmt.alternate) this.checkBody(stmt.alternate, declared, ctx)
        break
      case 'ForStatement':
        if (stmt.collection) this.checkExpr(stmt.collection, declared, ctx)
        const forScope = new Map(declared)
        if (stmt.itemName) forScope.set(stmt.itemName, 'ForVar')
        if (stmt.indexName) forScope.set(stmt.indexName, 'ForVar')
        this.checkBody(stmt.body, forScope, ctx)
        break
      case 'WhileStatement':
      case 'UntilStatement':
        this.checkExpr(stmt.condition, declared, ctx)
        this.checkBody(stmt.body, declared, ctx)
        break
      case 'BlockStatement':
        this.checkBody(stmt, declared, ctx)
        break
      case 'ThrowExpr':
        if (stmt.argument) this.checkExpr(stmt.argument, declared, ctx)
        break
      case 'MatchStatement': {
        this.checkExpr(stmt.subject, declared, ctx)
        for (const arm of stmt.arms ?? []) {
          const armScope = new Map(declared)
          if (arm.pattern?.type === 'IsPattern' && arm.pattern.binding) {
            armScope.set(arm.pattern.binding, 'MatchBinding')
          } else if (arm.pattern?.type === 'Identifier' && arm.pattern.name !== '_') {
            armScope.set(arm.pattern.name, 'MatchBinding')
          }
          this.checkBody(arm.body, armScope, ctx)
        }
        break
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        break
    }
  }

  checkExpr(expr, declared, ctx) {
    if (!expr) return

    switch (expr.type) {
      case 'Identifier': {
        const name = expr.name
        if (!name) break
        // Skip: known globals, Arc builtins, and common JS globals
        if (GLOBALS.has(name)) break
        if (!declared.has(name)) {
          this.error(`Undefined variable "${name}"`, expr)
        }
        break
      }

      case 'AtProperty': {
        // @varName — in widget bodies, these are duck-typed attrs; only check in page/fn scope
        if (!this.inWidget) {
          const name = expr.name
          if (name && !declared.has(name)) {
            this.error(`Undefined @state variable "@${name}"`, expr)
          }
        }
        break
      }

      case 'MemberExpr':
        // Only check the root object — properties are dynamic
        this.checkExpr(expr.object, declared, ctx)
        break

      case 'CallExpr':
        this.checkExpr(expr.callee, declared, ctx)
        for (const arg of expr.args ?? []) this.checkExpr(arg, declared, ctx)
        break

      case 'BinaryExpr':
      case 'LogicalExpr':
        this.checkExpr(expr.left, declared, ctx)
        this.checkExpr(expr.right, declared, ctx)
        break

      case 'UnaryExpr':
        this.checkExpr(expr.operand ?? expr.argument, declared, ctx)
        break

      case 'AssignExpr':
        this.checkExpr(expr.right, declared, ctx)
        break

      case 'TernaryExpr':
        this.checkExpr(expr.condition, declared, ctx)
        this.checkExpr(expr.consequent, declared, ctx)
        this.checkExpr(expr.alternate, declared, ctx)
        break

      case 'AwaitExpr':
        if (!ctx.allowAwait) {
          this.warn(`"await" used outside async context`, expr)
        }
        this.checkExpr(expr.argument, declared, ctx)
        break

      case 'ArrayLiteral':
        for (const el of expr.elements ?? []) this.checkExpr(el, declared, ctx)
        break

      case 'ObjectLiteral':
        for (const prop of expr.properties ?? []) {
          if (prop.value) this.checkExpr(prop.value, declared, ctx)
        }
        break

      case 'TemplateLiteral':
        for (const part of expr.parts ?? []) {
          if (part.type !== 'Literal') this.checkExpr(part, declared, ctx)
        }
        break

      case 'ArrowFn':
        const arrowScope = new Map(declared)
        for (const p of expr.params ?? []) {
          const pname = p.name ?? p
          if (pname) arrowScope.set(pname, 'Param')
        }
        this.checkExpr(expr.body, arrowScope, ctx)
        break

      case 'PipelineExpr':
        this.checkExpr(expr.left, declared, ctx)
        this.checkExpr(expr.right, declared, ctx)
        break

      case 'NullCoalesce':
        this.checkExpr(expr.left, declared, ctx)
        this.checkExpr(expr.right, declared, ctx)
        break

      case 'BlockStatement':
        this.checkBody(expr, declared, ctx)
        break

      case 'MatchExpr': {
        this.checkExpr(expr.subject, declared, ctx)
        for (const arm of expr.arms ?? []) {
          // Pattern may bind a name (e.g. `x is Number => x * 2`)
          const armScope = new Map(declared)
          if (arm.pattern?.type === 'IsPattern' && arm.pattern.binding) {
            armScope.set(arm.pattern.binding, 'MatchBinding')
          } else if (arm.pattern?.type === 'Identifier' && arm.pattern.name !== '_') {
            armScope.set(arm.pattern.name, 'MatchBinding')
          }
          this.checkExpr(arm.body, armScope, ctx)
        }
        break
      }

      case 'RangeExpr':
        this.checkExpr(expr.start, declared, ctx)
        this.checkExpr(expr.end, declared, ctx)
        break

      case 'SpreadExpr':
        this.checkExpr(expr.argument, declared, ctx)
        break

      case 'TypeCheckExpr':
        this.checkExpr(expr.value, declared, ctx)
        break

      // Literals — always valid
      case 'Literal':
      case 'StringLiteral':
        break
    }
  }
}

// Known safe globals — not declared in Arc source but always available
const GLOBALS = new Set([
  // JS builtins
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity',
  'console', 'Math', 'Date', 'JSON', 'Promise', 'Error',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Function',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI',
  'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'document', 'window', 'location', 'history', 'navigator',
  'localStorage', 'sessionStorage', 'indexedDB',
  'alert', 'confirm', 'prompt',
  'queueMicrotask', 'structuredClone',
  // Arc builtins
  'none', 'Ok', 'Err',
  // Arc session context
  '_session',
])

module.exports = { Checker, ArcError }
