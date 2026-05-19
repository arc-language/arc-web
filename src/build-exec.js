'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

// Evaluates @build expressions at compile time.
// Supports: literals, arrays, objects, fetch(), file reads, array methods.
// Safety: no eval(), no arbitrary code — constrained interpreter only.

// Explicit allowlist for object method dispatch — prevents calling dangerous prototype methods
const ALLOWED_OBJ_METHODS = new Set([
  'toString', 'valueOf', 'toJSON',
  'get', 'set', 'has', 'delete', 'clear',
  'keys', 'values', 'entries',
  'find', 'filter', 'map', 'forEach', 'reduce', 'some', 'every',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join',
  'sort', 'reverse', 'flat', 'flatMap', 'includes', 'indexOf', 'lastIndexOf',
  'trim', 'split', 'replace', 'toUpperCase', 'toLowerCase',
  'getPosts', 'getPost', 'getPages', 'getPage', 'getItems', 'getItem',
  'query', 'where', 'findOne', 'findAll', 'recent', 'limit', 'offset',
])

class BuildExecutor {
  constructor(projectDir = '.') {
    this.projectDir = projectDir
    this.context = {}    // name → resolved value
    this.errors = []
  }

  async execute(program) {
    for (const decl of program.declarations) {
      if (decl.type === 'BuildDecl') {
        try {
          const value = await this.evalExpr(decl.init, {})
          this.context[decl.name] = value
        } catch (e) {
          this.errors.push(`@build ${decl.name}: ${e.message}`)
          this.context[decl.name] = null
        }
      }
    }
    return this.context
  }

  // ── Expression evaluator ────────────────────────────────────────────────────

  async evalExpr(expr, locals = {}) {
    if (!expr) return undefined

    switch (expr.type) {
      case 'Literal':
        return expr.value

      case 'Identifier': {
        const name = expr.name
        if (name in locals) return locals[name]
        if (name in this.context) return this.context[name]
        throw new Error(`Undefined identifier: ${name}`)
      }

      case 'TemplateLiteral': {
        const parts = await Promise.all(expr.parts.map(p => this.evalExpr(p, locals)))
        return parts.join('')
      }

      case 'ArrayLiteral': {
        const elements = await Promise.all(
          (expr.elements ?? []).map(e => this.evalExpr(e, locals))
        )
        return elements
      }

      case 'ObjectLiteral': {
        const obj = {}
        for (const prop of (expr.properties ?? [])) {
          const val = await this.evalExpr(prop.value, locals)
          obj[prop.key] = val
        }
        return obj
      }

      case 'MemberExpr': {
        const obj = await this.evalExpr(expr.object, locals)
        if (obj === null || obj === undefined) return undefined
        const key = expr.computed
          ? await this.evalExpr(expr.property, locals)
          : expr.property.name ?? expr.property.value
        return obj[key]
      }

      case 'BinaryExpr': {
        const left = await this.evalExpr(expr.left, locals)
        const right = await this.evalExpr(expr.right, locals)
        return this.applyBinary(expr.op, left, right)
      }

      case 'UnaryExpr': {
        const val = await this.evalExpr(expr.operand, locals)
        if (expr.op === '!') return !val
        if (expr.op === '-') return -val
        return val
      }

      case 'CallExpr':
        return this.evalCall(expr, locals)

      case 'AwaitExpr':
        return this.evalExpr(expr.argument, locals)

      case 'NullCoalesce': {
        const lv = await this.evalExpr(expr.left, locals)
        return (lv === null || lv === undefined) ? this.evalExpr(expr.right, locals) : lv
      }

      case 'TernaryExpr': {
        const cond = await this.evalExpr(expr.condition, locals)
        return cond ? this.evalExpr(expr.consequent, locals) : this.evalExpr(expr.alternate, locals)
      }

      case 'PipelineExpr': {
        const left = await this.evalExpr(expr.left, locals)
        const fn = await this.evalExpr(expr.right, locals)
        if (typeof fn === 'function') return fn(left)
        throw new Error('Pipeline right side must be a function')
      }

      case 'ArrowFn':
        return this.makeArrowFn(expr, locals)

      default:
        throw new Error(`Cannot evaluate ${expr.type} at build time`)
    }
  }

  async evalCall(expr, locals) {
    const callee = expr.callee

    // fetch(url) — HTTP/HTTPS request
    if (callee.type === 'Identifier' && callee.name === 'fetch') {
      const url = await this.evalExpr(expr.args[0], locals)
      return this.doFetch(url)
    }

    // readFile(path) — local file read
    if (callee.type === 'Identifier' && callee.name === 'readFile') {
      const filePath = await this.evalExpr(expr.args[0], locals)
      return this.doReadFile(filePath)
    }

    // Array.from(iterable)
    if (callee.type === 'MemberExpr') {
      const obj = await this.evalExpr(callee.object, locals)
      const methodName = callee.property.name ?? callee.property.value

      if (Array.isArray(obj)) {
        const args = await Promise.all((expr.args ?? []).map(a => this.evalExpr(a, locals)))
        return this.callArrayMethod(obj, methodName, args, locals)
      }

      if (typeof obj === 'string') {
        const args = await Promise.all((expr.args ?? []).map(a => this.evalExpr(a, locals)))
        return this.callStringMethod(obj, methodName, args)
      }

      if (obj && typeof obj === 'object') {
        const args = await Promise.all((expr.args ?? []).map(a => this.evalExpr(a, locals)))
        if (!ALLOWED_OBJ_METHODS.has(methodName)) {
          throw new Error(`@build: object method '${methodName}' is not allowed at build time`)
        }
        if (typeof obj[methodName] === 'function') {
          return obj[methodName].call(obj, ...args)
        }
      }
    }

    // Direct function call (for arrow functions in context)
    const fn = await this.evalExpr(callee, locals)
    if (typeof fn === 'function') {
      const args = await Promise.all((expr.args ?? []).map(a => this.evalExpr(a, locals)))
      return fn(...args)
    }

    throw new Error(`Cannot call ${this.exprName(callee)} at build time`)
  }

  makeArrowFn(expr, outerLocals) {
    return async (...args) => {
      const paramLocals = { ...outerLocals }
      for (let i = 0; i < (expr.params ?? []).length; i++) {
        const p = expr.params[i]
        paramLocals[p.name ?? p] = args[i]
      }
      return this.evalExpr(expr.body, paramLocals)
    }
  }

  async callArrayMethod(arr, method, args, locals) {
    switch (method) {
      case 'map':     return Promise.all(arr.map(item => typeof args[0] === 'function' ? args[0](item) : item))
      case 'filter': {
        const results = []
        for (let i = 0; i < arr.length; i++) {
          if (typeof args[0] === 'function' ? await args[0](arr[i]) : true) results.push(arr[i])
        }
        return results
      }
      case 'find':    for (const item of arr) { if (typeof args[0] === 'function' && await args[0](item)) return item } return undefined
      case 'sort':    return [...arr].sort(args[0])
      case 'slice':   return arr.slice(...args)
      case 'concat':  return arr.concat(...args)
      case 'flat':    return arr.flat(args[0] ?? 1)
      case 'flatMap': return (await Promise.all(arr.map(item => typeof args[0] === 'function' ? args[0](item) : item))).flat()
      case 'reverse': return [...arr].reverse()
      case 'join':    return arr.join(args[0] ?? ',')
      case 'length':  return arr.length
      case 'includes': return arr.includes(args[0])
      case 'indexOf': return arr.indexOf(args[0])
      default: throw new Error(`Array.${method} not supported at build time`)
    }
  }

  callStringMethod(str, method, args) {
    switch (method) {
      case 'split':     return str.split(args[0])
      case 'trim':      return str.trim()
      case 'toLowerCase': return str.toLowerCase()
      case 'toUpperCase': return str.toUpperCase()
      case 'replace':   return str.replace(args[0], args[1])
      case 'includes':  return str.includes(args[0])
      case 'startsWith': return str.startsWith(args[0])
      case 'endsWith':  return str.endsWith(args[0])
      case 'slice':     return str.slice(...args)
      case 'substring': return str.substring(...args)
      default: throw new Error(`String.${method} not supported at build time`)
    }
  }

  applyBinary(op, l, r) {
    switch (op) {
      case '+':  return l + r
      case '-':  return l - r
      case '*':  return l * r
      case '/':  return l / r
      case '%':  return l % r
      case '**': return l ** r
      case '==': return l === r
      case '!=': return l !== r
      case '<':  return l < r
      case '>':  return l > r
      case '<=': return l <= r
      case '>=': return l >= r
      case '&&': return l && r
      case '||': return l || r
      default: throw new Error(`Operator ${op} not supported at build time`)
    }
  }

  // ── I/O helpers ─────────────────────────────────────────────────────────────

  doFetch(url) {
    // Validate URL to prevent SSRF
    let parsed
    try { parsed = new URL(url) } catch { throw new Error(`@build fetch: invalid URL: ${url}`) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`@build fetch: only http/https allowed, got ${parsed.protocol}`)
    }
    const hostname = parsed.hostname.toLowerCase()
    // Block IPv4 private/loopback/unspecified ranges
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
        hostname === '100.100.100.200' || // Alibaba Cloud instance metadata
        hostname.startsWith('169.254.') || hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      throw new Error(`@build fetch: internal addresses not allowed: ${hostname}`)
    }
    // Block IPv6 private/loopback/link-local/ULA/IPv4-mapped ranges
    // Note: URL.hostname strips brackets for IPv6, so checks must be bracket-free
    if (hostname === '::1' ||
        hostname.startsWith('fc') || hostname.startsWith('fd') ||
        hostname.startsWith('fe80') ||
        hostname.startsWith('::ffff:10.') || hostname.startsWith('::ffff:127.') ||
        hostname.startsWith('::ffff:192.168.') ||
        /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      throw new Error(`@build fetch: internal addresses not allowed: ${hostname}`)
    }

    return new Promise((resolve, reject) => {
      const protocol = parsed.protocol === 'https:' ? https : http
      const req = protocol.get(url, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          return reject(new Error(`@build fetch: HTTP ${res.statusCode} from ${url}`))
        }
        const chunks = []
        let totalBytes = 0
        let settled = false
        const MAX_BYTES = 10 * 1024 * 1024
        res.on('data', c => {
          totalBytes += c.length
          if (totalBytes > MAX_BYTES) {
            if (!settled) { settled = true; req.destroy(); res.destroy(); reject(new Error(`@build fetch: response too large (max 10MB): ${url}`)) }
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          if (settled) return
          settled = true
          const body = Buffer.concat(chunks).toString()
          const ct = res.headers['content-type'] ?? ''
          try {
            resolve(ct.includes('json') ? JSON.parse(body) : body)
          } catch {
            resolve(body)
          }
        })
      }).on('error', e => { if (!settled) { settled = true; reject(e) } })
      req.setTimeout(10000, () => {
        if (!settled) { settled = true; req.destroy(); reject(new Error(`@build fetch: timeout after 10s: ${url}`)) }
      })
    })
  }

  doReadFile(filePath) {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectDir, filePath)
    const resolved = path.resolve(abs)
    const projectRoot = path.resolve(this.projectDir)
    if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
      throw new Error(`@build readFile: path escapes project root: ${filePath}`)
    }
    let stat
    try { stat = fs.statSync(resolved) } catch (e) { throw new Error(`@build readFile: cannot read '${filePath}': ${e.code ?? e.message}`) }
    if (stat.size > 10 * 1024 * 1024) throw new Error(`@build readFile: file too large (max 10MB): ${filePath}`)
    let content
    try { content = fs.readFileSync(resolved, 'utf8') } catch (e) { throw new Error(`@build readFile: cannot read '${filePath}': ${e.code ?? e.message}`) }
    if (filePath.endsWith('.json')) {
      try { return JSON.parse(content) } catch { throw new Error(`@build readFile: invalid JSON in ${filePath}`) }
    }
    return content
  }

  exprName(expr) {
    if (expr.type === 'Identifier') return expr.name
    if (expr.type === 'MemberExpr') return `${this.exprName(expr.object)}.${this.exprName(expr.property)}`
    return expr.type
  }
}

module.exports = { BuildExecutor }
