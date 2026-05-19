'use strict'

const { T, STRUCTURE_ELEMENTS } = require('./tokens')
const N = require('./ast')

class Parser {
  constructor(tokens, filename = '<input>') {
    this.tokens = tokens  // keep all tokens, handle newlines in context
    this.pos = 0
    this.filename = filename
    this.hoistedDecls = []  // @state/@computed/@build found inside templates
    this._peekCache = new Map()  // (pos << 4 | offset) → token, avoids O(n) scan per call
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  peek(offset = 0) {
    const key = `${this.pos}:${offset}`
    const cached = this._peekCache.get(key)
    if (cached !== undefined) return cached

    let i = this.pos
    let count = 0
    while (i < this.tokens.length) {
      const t = this.tokens[i]
      if (t.type === T.NEWLINE || t.type === T.INDENT || t.type === T.DEDENT) {
        i++
        continue
      }
      if (count === offset) {
        this._peekCache.set(key, t)
        return t
      }
      count++
      i++
    }
    const eof = this.tokens[this.tokens.length - 1]
    this._peekCache.set(key, eof)
    return eof
  }

  peekRaw(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  current() {
    return this.tokens[this.pos]
  }

  advance() {
    const t = this.tokens[this.pos]
    if (this.pos < this.tokens.length - 1) this.pos++
    this._peekCache.clear()
    return t
  }

  // Advance past any newlines/indents/dedents
  skipWhitespace() {
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      if (t.type === T.NEWLINE || t.type === T.INDENT || t.type === T.DEDENT) {
        this.pos++
      } else break
    }
  }

  consumeNewlines() {
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === T.NEWLINE) {
      this.pos++
    }
  }

  check(type) {
    return this.peek().type === type
  }

  checkRaw(type) {
    return this.current().type === type
  }

  match(...types) {
    const p = this.peek()
    if (types.includes(p.type)) {
      // advance to that token
      while (this.tokens[this.pos].type !== p.type || this.tokens[this.pos] !== p) {
        this.pos++
      }
      this.pos++
      this._peekCache.clear()
      return p
    }
    return null
  }

  eat(type, msg) {
    this.skipWhitespace()
    const t = this.tokens[this.pos]
    if (t.type !== type) {
      this.error(msg ?? `Expected ${type}, got ${t.type} (${JSON.stringify(t.value)})`, t)
    }
    this.pos++
    this._peekCache.clear()
    return t
  }

  eatIf(type) {
    this.skipWhitespace()
    if (this.tokens[this.pos]?.type === type) {
      this._peekCache.clear()
      return this.tokens[this.pos++]
    }
    return null
  }

  // Advance skipping whitespace, return the token
  next() {
    this.skipWhitespace()
    return this.tokens[this.pos++]
  }

  peekType(offset = 0) {
    return this.peek(offset).type
  }

  error(msg, token) {
    const t = token ?? this.tokens[this.pos]
    throw new SyntaxError(`${this.filename}:${t?.line}:${t?.col}: ${msg}`)
  }

  // ── Top-level parsing ──────────────────────────────────────────────────────

  parse() {
    const declarations = []

    while (true) {
      this.skipWhitespace()
      if (this.tokens[this.pos]?.type === T.EOF) break

      const posBefore = this.pos
      const decl = this.parseTopLevel()
      if (decl) declarations.push(decl)

      // If pos didn't advance, force-skip to prevent infinite loop
      if (this.pos === posBefore) {
        this.pos++
      }
    }

    return N.Program([], [...this.hoistedDecls, ...declarations], 1)
  }

  parseTopLevel() {
    this.skipWhitespace()
    const t = this.tokens[this.pos]
    if (!t || t.type === T.EOF) return null

    // @annotations
    if (t.type === T.AT_IDENT) {
      return this.parseAnnotatedDecl()
    }

    // import
    if (t.type === T.IMPORT) return this.parseImport()

    // export
    if (t.type === T.EXPORT) return this.parseExport()

    // widget / page
    if (t.type === T.WIDGET) return this.parseWidget()
    if (t.type === T.PAGE) return this.parsePage()

    // design block at top level
    if (t.type === T.DESIGN) return this.parseDesign()

    // const / let / fn / class
    if (t.type === T.CONST || t.type === T.LET) return this.parseVarDecl()
    if (t.type === T.FN) return this.parseFnDecl()
    if (t.type === T.CLASS) return this.parseClassDecl()

    // Expression statement
    return this.parseExprStatement()
  }

  // ── Imports ────────────────────────────────────────────────────────────────

  parseImport() {
    const tok = this.eat(T.IMPORT)
    let defaultName = null
    const names = []

    if (this.peekType() === T.IDENT) {
      defaultName = this.eat(T.IDENT).value
      if (this.peekType() === T.COMMA) {
        this.eat(T.COMMA)
      }
    }

    if (this.peekType() === T.LBRACE) {
      this.eat(T.LBRACE)
      while (this.peekType() !== T.RBRACE && this.peekType() !== T.EOF) {
        const imported = this.eat(T.IDENT).value
        let local = imported
        if (this.peekType() === T.IDENT && this.tokens[this.pos].value === 'as') {
          this.next()
          local = this.eat(T.IDENT).value
        }
        names.push({ imported, local })
        this.eatIf(T.COMMA)
      }
      this.eat(T.RBRACE)
    }

    this.eat(T.FROM)
    const source = this.eat(T.STRING).value

    return N.ImportDecl(names, defaultName, source, tok.line)
  }

  parseExport() {
    const tok = this.eat(T.EXPORT)
    const decl = this.parseTopLevel()
    return N.ExportDecl(decl, tok.line)
  }

  // ── Reactive annotations ───────────────────────────────────────────────────

  parseAnnotatedDecl() {
    const tok = this.tokens[this.pos]
    const annotation = tok.value  // e.g. '@state', '@build', '@computed'

    this.pos++ // consume @annotation

    switch (annotation) {
      case '@state':    return this.parseStateDecl(tok.line)
      case '@computed': return this.parseComputedDecl(tok.line)
      case '@build':    return this.parseBuildDecl(tok.line)
      case '@live':     return this.parseLiveDecl(tok.line)
      case '@realtime': return this.parseRealtimeDecl(tok.line)
      case '@server':   return this.parseServerFn(tok.line)
      case '@worker':   return this.parseWorkerFn(tok.line)
      case '@param':    return this.parseParamDecl(tok.line)
      default:
        // Could be a class getter/static marker — pass through
        this.error(`Unknown annotation: ${annotation}`, tok)
    }
  }

  parseStateDecl(line) {
    const kind = this.peekType() === T.CONST ? 'const' : 'let'
    this.next() // consume const/let
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    let init = null
    if (this.eatIf(T.EQ)) {
      init = this.parseExpr()
    }
    return N.StateDecl(name, typeAnnotation, init, line)
  }

  parseComputedDecl(line) {
    const kind = this.peekType() === T.CONST ? 'const' : 'let'
    this.next()
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    this.eat(T.EQ)
    const init = this.parseExpr()
    return N.ComputedDecl(name, typeAnnotation, init, line)
  }

  parseBuildDecl(line) {
    const kind = this.peekType() === T.CONST ? 'const' : 'let'
    this.next()
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    this.eat(T.EQ)
    const init = this.parseExpr()
    return N.BuildDecl(name, typeAnnotation, init, line)
  }

  parseLiveDecl(line) {
    this.next() // consume const/let
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    this.eat(T.EQ)
    const init = this.parseExpr()
    return N.LiveDecl(name, typeAnnotation, init, line)
  }

  parseRealtimeDecl(line) {
    this.next() // consume let
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    this.eat(T.EQ)
    // channel("name") or channel("name/{param}")
    const channel = this.parseExpr()
    return N.RealtimeDecl(name, typeAnnotation, channel, line)
  }

  parseServerFn(line) {
    const fn = this.parseFnOrIndentedFn()
    return N.ServerFn(fn.name, fn.params, fn.returnType, fn.body, line)
  }

  parseWorkerFn(line) {
    const fn = this.parseFnOrIndentedFn()
    return N.WorkerFn(fn.name, fn.params, fn.returnType, fn.body, line)
  }

  // Parse `fn name(params) -> ReturnType\n  body` (indented) or `fn name(params) { body }`
  parseFnOrIndentedFn() {
    const tok = this.eat(T.FN)
    let isAsync = false
    if (this.tokens[this.pos]?.type === T.ASYNC) { isAsync = true; this.pos++ }
    const name = this.eat(T.IDENT).value
    const params = this.parseParams()
    const returnType = this.eatIf(T.THIN_ARROW) ? this.parseTypeAnnotationNoObject() : null

    let body
    this.consumeNewlines()
    if (this.tokens[this.pos]?.type === T.INDENT) {
      // Indentation-based body
      this.pos++ // consume INDENT
      const stmts = []
      while (true) {
        this.consumeNewlines()
        if (this.tokens[this.pos]?.type === T.DEDENT || this.tokens[this.pos]?.type === T.EOF) {
          if (this.tokens[this.pos]?.type === T.DEDENT) this.pos++
          break
        }
        const stmt = this.parseStatement()
        if (stmt) stmts.push(stmt)
      }
      body = N.BlockStatement(stmts, tok.line)
    } else if (this.eatIf(T.ARROW)) {
      body = this.parseExpr()
    } else {
      body = this.parseBlock()
    }

    return N.FnDecl(name, params, returnType, body, isAsync, tok.line)
  }

  // Parse type annotation stopping before { (to avoid consuming object types as blocks)
  parseTypeAnnotationNoObject() {
    if (this.peekType() === T.LBRACE) {
      // Object type: { key: Type, ... } — parse inline
      return this.parseTypeAnnotation()
    }
    return this.parseTypeAnnotation()
  }

  parseParamDecl(line) {
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    return N.VarDecl('const', name, typeAnnotation, null, line)
  }

  // ── Widget / Page ──────────────────────────────────────────────────────────

  parseWidget() {
    const tok = this.eat(T.WIDGET)
    const name = this.eat(T.IDENT).value
    const params = this.peekType() === T.LPAREN ? this.parseParams() : []

    const body = this.parseTemplateBlock()
    // design can be inside the body block OR after it (both syntaxes supported)
    let design = null
    const designIdx = body.findIndex(n => n?.type === 'DesignBlock')
    if (designIdx >= 0) {
      design = body[designIdx]
      body.splice(designIdx, 1)
    } else if (this.peekType() === T.DESIGN) {
      design = this.parseDesign()
    }

    return N.WidgetDecl(name, params, body, design, tok.line)
  }

  parsePage() {
    const tok = this.eat(T.PAGE)
    let title = null
    if (this.peekType() === T.STRING) {
      title = N.Literal(this.next().value, null, tok.line)
    }
    const meta = {}
    // Parse key=value meta attributes (only if IDENT is followed by EQ on same line)
    while (this.peekType() === T.IDENT && this.peekType(1) === T.EQ) {
      const key = this.next().value
      this.eat(T.EQ)
      meta[key] = this.parseExpr()
    }

    const body = this.parseTemplateBlock()
    let design = null
    const designIdx = body.findIndex(n => n?.type === 'DesignBlock')
    if (designIdx >= 0) {
      design = body[designIdx]
      body.splice(designIdx, 1)
    } else if (this.peekType() === T.DESIGN) {
      design = this.parseDesign()
    }

    return N.PageDecl(title, meta, body, design, tok.line)
  }

  // ── Template parsing ───────────────────────────────────────────────────────

  parseTemplateBlock() {
    const children = []
    // Skip newlines but NOT indent tokens — we need to find the INDENT
    this.consumeNewlines()
    if (this.tokens[this.pos]?.type !== T.INDENT) {
      return children
    }
    this.pos++ // consume INDENT

    while (true) {
      this.consumeNewlines()
      if (this.tokens[this.pos]?.type === T.DEDENT || this.tokens[this.pos]?.type === T.EOF) {
        if (this.tokens[this.pos]?.type === T.DEDENT) this.pos++
        break
      }
      const node = this.parseTemplateNode()
      if (node) children.push(node)
    }

    return children
  }

  parseTemplateNode() {
    const t = this.tokens[this.pos]
    if (!t || t.type === T.EOF || t.type === T.DEDENT) return null

    // Control flow in templates
    if (t.type === T.IF) return this.parseTemplateIf()
    if (t.type === T.UNLESS) return this.parseTemplateUnless()
    if (t.type === T.FOR) return this.parseTemplateFor()
    if (t.type === T.MATCH) return this.parseTemplateMatch()

    // Raw HTML passthrough
    if (t.type === T.RAW) return this.parseRawNode()

    // @state/@computed/@build inside template — hoist to program declarations
    if (t.type === T.AT_IDENT) {
      const annotation = t.value
      if (['@state', '@computed', '@build', '@live', '@realtime', '@server', '@worker'].includes(annotation)) {
        const decl = this.parseAnnotatedDecl()
        if (decl) this.hoistedDecls.push(decl)
        return null
      }
      this.pos++
      return null
    }

    // Element: identifier possibly followed by .class or #id
    if (t.type === T.IDENT || STRUCTURE_ELEMENTS.has(t.value)) {
      return this.parseElement()
    }

    // Class shorthand: .card { ... }
    if (t.type === T.DOT) {
      return this.parseDotElement()
    }

    // ID shorthand: #sidebar { ... }
    if (t.type === T.HASH) {
      return this.parseHashElement()
    }

    // Design block inside template body
    if (t.type === T.DESIGN) {
      return this.parseDesign()
    }

    // String literal content
    if (t.type === T.STRING) {
      // If followed by INTERP_START, parse as template literal with interpolations
      if (this.tokens[this.pos + 1]?.type === T.INTERP_START) {
        return this.parseTemplateLiteralContent(t.line)
      }
      this.pos++
      this.consumeNewlines()
      return N.TextNode(t.value, t.line)
    }

    // Interpolation: {expr}
    if (t.type === T.LBRACE) {
      return this.parseTemplateInterpolation()
    }

    // Skip unknown tokens gracefully
    this.pos++
    return null
  }

  parseElement() {
    const tok = this.tokens[this.pos]
    let tag = tok.value
    this.pos++

    const classes = []
    let id = null

    // Parse .class and #id suffixes
    while (this.tokens[this.pos]?.type === T.DOT || this.tokens[this.pos]?.type === T.HASH) {
      if (this.tokens[this.pos].type === T.DOT) {
        this.pos++
        if (this.tokens[this.pos]?.type === T.IDENT) {
          classes.push(this.tokens[this.pos++].value)
        }
      } else {
        this.pos++
        if (this.tokens[this.pos]?.type === T.IDENT) {
          id = this.tokens[this.pos++].value
        }
      }
    }

    const attrs = this.parseElementAttrs()
    const inlineContent = this.parseInlineContent()
    this.consumeNewlines()
    const children = this.tokens[this.pos]?.type === T.INDENT ? this.parseTemplateBlock() : []

    if (inlineContent && children.length === 0) {
      return N.Element(tag, classes, id, attrs, [inlineContent], tok.line)
    }
    return N.Element(tag, classes, id, attrs, inlineContent ? [inlineContent, ...children] : children, tok.line)
  }

  parseDotElement() {
    this.pos++ // consume .
    const tok = this.tokens[this.pos]
    const classes = [this.eat(T.IDENT).value]

    // More classes
    while (this.tokens[this.pos]?.type === T.DOT) {
      this.pos++
      if (this.tokens[this.pos]?.type === T.IDENT) classes.push(this.tokens[this.pos++].value)
    }

    const attrs = this.parseElementAttrs()
    const inlineContent = this.parseInlineContent()
    this.consumeNewlines()
    const children = this.tokens[this.pos]?.type === T.INDENT ? this.parseTemplateBlock() : []

    return N.Element('div', classes, null, attrs, inlineContent ? [inlineContent, ...children] : children, tok.line)
  }

  parseHashElement() {
    this.pos++ // consume #
    const tok = this.tokens[this.pos]
    const id = this.eat(T.IDENT).value
    const attrs = this.parseElementAttrs()
    const inlineContent = this.parseInlineContent()
    this.consumeNewlines()
    const children = this.tokens[this.pos]?.type === T.INDENT ? this.parseTemplateBlock() : []
    return N.Element('div', [], id, attrs, inlineContent ? [inlineContent, ...children] : children, tok.line)
  }

  parseElementAttrs() {
    const attrs = {}
    // Parse space-separated key=value or key or bind:value or on:event
    while (true) {
      const t = this.tokens[this.pos]
      if (!t || t.type === T.NEWLINE || t.type === T.INDENT || t.type === T.DEDENT ||
          t.type === T.STRING || t.type === T.LBRACE || t.type === T.EOF) break

      // on:event, bind:value, dialog:open etc.
      if (t.type === T.IDENT) {
        const next = this.tokens[this.pos + 1]
        if (next?.type === T.COLON) {
          const prefix = t.value
          this.pos += 2
          const suffix = this.tokens[this.pos]?.type === T.IDENT ? this.tokens[this.pos++].value : ''
          const attrName = `${prefix}:${suffix}`

          if (this.tokens[this.pos]?.type === T.EQ) {
            this.pos++
            if (this.tokens[this.pos]?.type === T.LBRACE) {
              this.pos++
              attrs[attrName] = this.parseExprUntilBrace()
              this.eatIf(T.RBRACE)
            } else {
              attrs[attrName] = this.parseExpr()
            }
          } else {
            attrs[attrName] = true
          }
          continue
        }

        // Regular attribute: key=value or key="..." or bare key
        if (next?.type === T.EQ) {
          const key = t.value
          this.pos += 2
          attrs[key] = this.parseExpr()
          continue
        }

        // Bare boolean attribute (like required, disabled, lazy)
        if (/^[a-z]/.test(t.value)) {
          // Check it looks like an attribute (not a child element)
          const afterNext = this.tokens[this.pos + 1]
          if (!afterNext || afterNext.type === T.NEWLINE || afterNext.type === T.INDENT ||
              afterNext.type === T.IDENT || afterNext.type === T.EQ || afterNext.type === T.COLON) {
            // Looks like an attribute
            if (afterNext?.type !== T.INDENT && afterNext?.type !== T.NEWLINE) {
              // Only consume as attr if followed by another attr or nothing
              // (not if followed by a child element — handled above)
            }
          }
        }
        break
      }
      break
    }
    return attrs
  }

  parseInlineContent() {
    const t = this.tokens[this.pos]
    if (!t) return null

    // String that may contain interpolations: STRING (INTERP_START expr INTERP_END STRING)*
    if (t.type === T.STRING) {
      // Look ahead: if followed by INTERP_START, collect as TemplateLiteral
      if (this.tokens[this.pos + 1]?.type === T.INTERP_START) {
        return this.parseTemplateLiteralContent(t.line)
      }
      this.pos++
      this.consumeNewlines()
      return N.TextNode(t.value, t.line)
    }

    // Bare interpolation {expr}
    if (t.type === T.LBRACE) {
      return this.parseTemplateInterpolation()
    }

    return null
  }

  parseTemplateLiteralContent(line) {
    const parts = []
    while (true) {
      const t = this.tokens[this.pos]
      if (!t || t.type === T.NEWLINE || t.type === T.INDENT || t.type === T.DEDENT || t.type === T.EOF) break

      if (t.type === T.STRING) {
        if (t.value) parts.push(N.Literal(t.value, t.value, t.line))
        this.pos++
        continue
      }

      if (t.type === T.INTERP_START) {
        this.pos++ // consume {
        const expr = this.parseExpr()
        if (this.tokens[this.pos]?.type === T.INTERP_END) this.pos++ // consume }
        parts.push(expr)
        continue
      }

      break
    }
    this.consumeNewlines()
    if (parts.length === 1 && parts[0].type === 'Literal') {
      return N.TextNode(parts[0].value, line)
    }
    return N.TemplateLiteral(parts, line)
  }

  parseTemplateInterpolation() {
    const tok = this.tokens[this.pos]
    this.pos++ // consume {
    const expr = this.parseExprUntilBrace()
    this.eatIf(T.RBRACE)
    this.consumeNewlines()
    return N.InterpolationNode(expr, tok.line)
  }

  parseExprUntilBrace() {
    // Parse an expression stopping at an unmatched }
    // We save position and try to parse, backing off if needed
    return this.parseExpr()
  }

  parseTemplateIf() {
    const tok = this.eat(T.IF)
    const condition = this.parseExpr()
    const consequent = this.parseTemplateBlock()

    let alternate = null
    this.consumeNewlines()
    if (this.tokens[this.pos]?.type === T.ELSE) {
      this.pos++
      if (this.tokens[this.pos]?.type === T.IF) {
        alternate = [this.parseTemplateIf()]
      } else {
        alternate = this.parseTemplateBlock()
      }
    }

    return N.IfNode(condition, consequent, alternate, tok.line)
  }

  parseTemplateUnless() {
    const tok = this.eat(T.UNLESS)
    const condition = this.parseExpr()
    const consequent = this.parseTemplateBlock()
    return N.UnlessNode(condition, consequent, tok.line)
  }

  parseTemplateFor() {
    const tok = this.eat(T.FOR)
    let indexName = null
    let itemName = this.eat(T.IDENT).value

    if (this.tokens[this.pos]?.type === T.COMMA) {
      this.pos++
      indexName = itemName
      itemName = this.eat(T.IDENT).value
    }

    this.eat(T.IN)
    const collection = this.parseExpr()
    const body = this.parseTemplateBlock()

    return N.ForNode(indexName, itemName, collection, body, tok.line)
  }

  parseTemplateMatch() {
    const tok = this.eat(T.MATCH)
    const subject = this.parseExpr()
    const arms = []

    this.skipWhitespace()
    if (this.tokens[this.pos]?.type === T.INDENT) {
      this.pos++
      while (this.tokens[this.pos]?.type !== T.DEDENT && this.tokens[this.pos]?.type !== T.EOF) {
        this.consumeNewlines()
        if (this.tokens[this.pos]?.type === T.DEDENT) break
        const pattern = this.parseMatchPattern()
        this.eat(T.ARROW)
        const body = this.parseTemplateNode()
        arms.push({ pattern, body })
        this.consumeNewlines()
      }
      this.eatIf(T.DEDENT)
    }

    return N.MatchTemplateNode(subject, arms, tok.line)
  }

  parseRawNode() {
    const tok = this.eat(T.RAW)
    const html = this.eat(T.STRING).value
    this.consumeNewlines()
    return N.RawNode(html, tok.line)
  }

  // ── Design parsing ─────────────────────────────────────────────────────────

  parseDesign() {
    const tok = this.eat(T.DESIGN)

    this.consumeNewlines()
    if (this.tokens[this.pos]?.type !== T.INDENT) return N.DesignBlock([], tok.line)
    this.pos++

    // Top-level design block: collect props and nested rules for the root component selector.
    // Syntax:
    //   p: 16px          ← direct prop on component root
    //   &:hover { ... }  ← nested pseudo-class rule
    //   @mobile { ... }  ← media query condition
    const rootProps = []
    const nestedRules = []

    while (this.tokens[this.pos]?.type !== T.DEDENT && this.tokens[this.pos]?.type !== T.EOF) {
      this.consumeNewlines()
      if (this.tokens[this.pos]?.type === T.DEDENT) break

      const pt = this.tokens[this.pos]
      if (!pt) break

      // @condition (@mobile, @dark, @container)
      if (pt.type === T.AT_IDENT) {
        const cond = this.parseStyleCondition()
        if (cond) nestedRules.push(cond)
        continue
      }

      // &:pseudo nested rule
      if (pt.type === T.AMP) {
        const rule = this.parseStyleRule()
        if (rule) nestedRules.push(rule)
        continue
      }

      // DOT prefix — class selector (.count, .field-error)
      if (pt.type === T.DOT) {
        const rule = this.parseStyleRule()
        if (rule) nestedRules.push(rule)
        continue
      }

      // IDENT: either a direct property (prop: value) or a selector block (body { ... })
      if (pt.type === T.IDENT) {
        const next = this.tokens[this.pos + 1]
        if (next?.type === T.COLON) {
          let name = this.tokens[this.pos++].value
          // Handle hyphenated property names at root level too
          while (this.tokens[this.pos]?.type === T.MINUS && this.tokens[this.pos + 1]?.type === T.IDENT) {
            this.pos++
            name += '-' + this.tokens[this.pos++].value
          }
          this.pos++ // consume colon
          const value = this.parseStyleValue()
          rootProps.push(N.StyleProp(name, value, pt.line))
          this.consumeNewlines()
          continue
        }
        // Look past NEWLINEs to find INDENT (selector with block)
        let lookIdx = this.pos + 1
        while (this.tokens[lookIdx]?.type === T.NEWLINE) lookIdx++
        if (this.tokens[lookIdx]?.type === T.INDENT) {
          const rule = this.parseStyleRule()
          if (rule) nestedRules.push(rule)
          continue
        }
      }

      this.pos++ // skip unknown
    }
    this.eatIf(T.DEDENT)

    // Wrap root props in an implicit '&' (component root) StyleRule
    const rules = []
    if (rootProps.length > 0) {
      rules.push(N.StyleRule('&', rootProps, [], tok.line))
    }
    rules.push(...nestedRules)

    return N.DesignBlock(rules, tok.line)
  }

  parseStyleRule() {
    const t = this.tokens[this.pos]
    if (!t) return null

    // Responsive/dark conditions
    if (t.type === T.AT_IDENT) {
      return this.parseStyleCondition()
    }

    // Pseudo / nesting: &:hover
    let selector = ''
    if (t.type === T.AMP) {
      this.pos++
      selector = '&'
    }

    // Build selector string
    while (this.tokens[this.pos]) {
      const cur = this.tokens[this.pos]
      if (cur.type === T.IDENT) { selector += cur.value; this.pos++ }
      else if (cur.type === T.DOT) { selector += '.'; this.pos++ }
      else if (cur.type === T.HASH) { selector += '#'; this.pos++ }
      else if (cur.type === T.COLON) { selector += ':'; this.pos++ }
      else if (cur.type === T.GT) { selector += '>'; this.pos++ }
      else if (cur.type === T.PLUS) { selector += '+'; this.pos++ }
      else if (cur.type === T.STAR) { selector += '*'; this.pos++ }
      else if (cur.type === T.MINUS) { selector += '-'; this.pos++ }
      else if (cur.type === T.COMMA) { selector += ', '; this.pos++ }
      else break
    }

    if (!selector.trim()) { this.pos++; return null }

    const props = []
    const children = []

    this.consumeNewlines()
    if (this.tokens[this.pos]?.type !== T.INDENT) {
      return N.StyleRule(selector, props, children, t.line)
    }
    this.pos++

    while (this.tokens[this.pos]?.type !== T.DEDENT && this.tokens[this.pos]?.type !== T.EOF) {
      this.consumeNewlines()
      if (this.tokens[this.pos]?.type === T.DEDENT || this.tokens[this.pos]?.type === T.EOF) break

      const pt = this.tokens[this.pos]
      if (!pt) break

      // Nested rule or condition
      if (pt.type === T.AT_IDENT) {
        children.push(this.parseStyleCondition())
        continue
      }
      if (pt.type === T.AMP) {
        children.push(this.parseStyleRule())
        continue
      }
      if (pt.type === T.DOT) {
        children.push(this.parseStyleRule())
        continue
      }
      // Nested selector with block (look past NEWLINEs to find INDENT)
      if (pt.type === T.IDENT) {
        let lookIdx = this.pos + 1
        while (this.tokens[lookIdx]?.type === T.NEWLINE) lookIdx++
        if (this.tokens[lookIdx]?.type === T.INDENT && this.tokens[this.pos + 1]?.type !== T.COLON) {
          children.push(this.parseStyleRule())
          continue
        }
      }

      // Property: name: value (name may be hyphenated: align-items, min-height, etc.)
      // Special case: hover/focus/active/disabled followed by { ... } → pseudo-class rule
      if (pt.type === T.IDENT) {
        const PSEUDO_SHORTHANDS = { hover: ':hover', focus: ':focus-visible', active: ':active', disabled: ':disabled', checked: ':checked', placeholder: '::placeholder' }
        let propName = this.tokens[this.pos++].value
        // Consume hyphens in property names (align-items, min-height, background-color, etc.)
        while (this.tokens[this.pos]?.type === T.MINUS && this.tokens[this.pos + 1]?.type === T.IDENT) {
          this.pos++
          propName += '-' + this.tokens[this.pos++].value
        }
        if (this.tokens[this.pos]?.type === T.COLON) {
          this.pos++
          // hover: { ... } / focus: { ... } → nested pseudo-class rule
          if (PSEUDO_SHORTHANDS[propName] && this.tokens[this.pos]?.type === T.LBRACE) {
            this.pos++ // consume {
            const pseudoProps = []
            while (this.tokens[this.pos]?.type !== T.RBRACE && this.tokens[this.pos]?.type !== T.EOF) {
              this.consumeNewlines()
              if (this.tokens[this.pos]?.type === T.RBRACE) break
              const ppt = this.tokens[this.pos]
              if (ppt?.type === T.IDENT) {
                let pName = this.tokens[this.pos++].value
                while (this.tokens[this.pos]?.type === T.MINUS && this.tokens[this.pos + 1]?.type === T.IDENT) {
                  this.pos++; pName += '-' + this.tokens[this.pos++].value
                }
                if (this.tokens[this.pos]?.type === T.COLON) {
                  this.pos++
                  pseudoProps.push(N.StyleProp(pName, this.parseStyleValue(), ppt.line))
                }
              } else this.pos++
            }
            this.eatIf(T.RBRACE)
            children.push(N.StyleRule(PSEUDO_SHORTHANDS[propName], pseudoProps, [], pt.line))
          } else {
            const value = this.parseStyleValue()
            props.push(N.StyleProp(propName, value, pt.line))
          }
        }
        this.consumeNewlines()
        continue
      }

      this.pos++
    }
    this.eatIf(T.DEDENT)

    return N.StyleRule(selector, props, children, t.line)
  }

  parseStyleCondition() {
    const tok = this.tokens[this.pos++]
    const annotation = tok.value // @mobile, @dark, @container, etc.

    let query = null
    if (this.tokens[this.pos]?.type === T.LT || this.tokens[this.pos]?.type === T.GT) {
      // @container < 480px
      const op = this.tokens[this.pos++].value
      const size = this.tokens[this.pos++].value + (this.tokens[this.pos]?.value ?? '')
      this.pos++
      query = `${op} ${size}`
    }

    const rules = []
    this.consumeNewlines()

    // Inline: @mobile { p: 8px }
    if (this.tokens[this.pos]?.type === T.LBRACE) {
      this.pos++
      while (this.tokens[this.pos]?.type !== T.RBRACE) {
        const pt = this.tokens[this.pos]
        if (!pt || pt.type === T.EOF) break
        if (pt.type === T.IDENT) {
          const name = this.tokens[this.pos++].value
          if (this.tokens[this.pos]?.type === T.COLON) {
            this.pos++
            const value = this.parseStyleValue()
            rules.push(N.StyleProp(name, value, pt.line))
          }
        } else this.pos++
      }
      this.eatIf(T.RBRACE)
    } else if (this.tokens[this.pos]?.type === T.INDENT) {
      this.pos++
      while (this.tokens[this.pos]?.type !== T.DEDENT && this.tokens[this.pos]?.type !== T.EOF) {
        this.consumeNewlines()
        if (this.tokens[this.pos]?.type === T.DEDENT || this.tokens[this.pos]?.type === T.EOF) break
        const before = this.pos
        const rule = this.parseStyleRule()
        if (rule) rules.push(rule)
        if (this.pos === before) this.pos++ // safety: always advance
      }
      this.eatIf(T.DEDENT)
    }

    return N.StyleCondition(annotation.slice(1), query, rules, tok.line)
  }

  parseStyleValue() {
    // Collect tokens until newline, joining CSS unit suffixes and hyphens without spaces
    const parts = []
    while (this.tokens[this.pos]) {
      const t = this.tokens[this.pos]
      if (t.type === T.NEWLINE || t.type === T.INDENT || t.type === T.DEDENT ||
          t.type === T.RBRACE || t.type === T.EOF) break

      // HASH token: join with following hex value/ident as a color (#111, #f9fafb)
      if (t.type === T.HASH) {
        this.pos++
        const nextTok = this.tokens[this.pos]
        if (nextTok && nextTok.type !== T.NEWLINE && nextTok.type !== T.DEDENT && nextTok.type !== T.EOF) {
          parts.push('#' + String(nextTok.value ?? ''))
          this.pos++
        } else {
          parts.push('#')
        }
        continue
      }

      // MINUS token: join directly to surrounding tokens (CSS hyphenated names: system-ui, sans-serif)
      if (t.type === T.MINUS) {
        this.pos++
        if (parts.length > 0) {
          const next = this.tokens[this.pos]
          if (next && next.type === T.IDENT) {
            parts[parts.length - 1] = parts[parts.length - 1] + '-' + next.value
            this.pos++
          } else {
            parts[parts.length - 1] = parts[parts.length - 1] + '-'
          }
        } else {
          parts.push('-')
        }
        continue
      }

      // COMMA: attach directly to previous token (font lists, multi-value properties)
      if (t.type === T.COMMA) {
        if (parts.length > 0) parts[parts.length - 1] += ','
        else parts.push(',')
        this.pos++
        continue
      }

      const prev = parts[parts.length - 1]
      const val = String(t.value ?? t.type)
      // Attach unit suffix (px, em, rem, %, vh, vw, etc.) directly to preceding number
      const isUnit = /^(px|em|rem|%|vh|vw|vmin|vmax|svh|dvh|ch|ex|fr|deg|rad|ms|s)$/.test(val)
      const prevIsNum = prev !== undefined && /^\d/.test(prev)
      if (isUnit && prevIsNum) {
        parts[parts.length - 1] = prev + val
      } else {
        parts.push(val)
      }
      this.pos++
    }
    this.consumeNewlines()
    return parts.join(' ').trim()
  }

  // ── Script / Logic parsing ─────────────────────────────────────────────────

  parseVarDecl() {
    const tok = this.tokens[this.pos]
    const kind = tok.value // 'const' or 'let'
    this.pos++

    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    let init = null
    if (this.eatIf(T.EQ)) {
      init = this.parseExpr()
    }
    this.consumeNewlines()
    return N.VarDecl(kind, name, typeAnnotation, init, tok.line)
  }

  parseFnDecl() {
    const tok = this.eat(T.FN)
    let isAsync = false
    if (this.tokens[this.pos]?.type === T.ASYNC) {
      isAsync = true; this.pos++
    }
    // Allow any identifier-like token as function name (including keywords like get, set, delete)
    const nameTok = this.tokens[this.pos++]
    const name = nameTok?.value ?? ''
    const params = this.parseParams()
    const returnType = this.eatIf(T.THIN_ARROW) ? this.parseTypeAnnotation() : null

    let body
    if (this.eatIf(T.ARROW)) {
      // Expression body: fn add(a, b) => a + b
      body = this.parseExpr()
    } else {
      body = this.parseBlock()
    }

    this.consumeNewlines()
    return N.FnDecl(name, params, returnType, body, isAsync, tok.line)
  }

  parseParams() {
    this.eat(T.LPAREN)
    const params = []
    while (this.peekType() !== T.RPAREN && this.peekType() !== T.EOF) {
      params.push(this.parseParam())
      this.eatIf(T.COMMA)
    }
    this.eat(T.RPAREN)
    return params
  }

  parseParam() {
    const tok = this.tokens[this.pos]
    const isRest = this.eatIf(T.SPREAD) !== null
    const name = this.eat(T.IDENT).value
    const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
    const defaultValue = this.eatIf(T.EQ) ? this.parseExpr() : null
    return N.Param(name, typeAnnotation, defaultValue, isRest, tok.line)
  }

  parseBlock() {
    const tok = this.eat(T.LBRACE)
    const body = []
    while (this.peekType() !== T.RBRACE && this.peekType() !== T.EOF) {
      const stmt = this.parseStatement()
      if (stmt) body.push(stmt)
    }
    this.eat(T.RBRACE)
    return N.BlockStatement(body, tok.line)
  }

  parseClassDecl() {
    const tok = this.eat(T.CLASS)
    const name = this.eat(T.IDENT).value
    const fields = []
    const methods = []

    this.eat(T.LBRACE)
    while (this.peekType() !== T.RBRACE && this.peekType() !== T.EOF) {
      this.skipWhitespace()
      const t = this.tokens[this.pos]
      if (!t || t.type === T.RBRACE) break

      const isStatic = t.type === T.STATIC ? (this.pos++, true) : false

      // @field = value
      if (this.tokens[this.pos]?.type === T.AT_IDENT) {
        const fieldTok = this.tokens[this.pos++]
        const fieldName = fieldTok.value.slice(1) // remove @
        const typeAnnotation = this.eatIf(T.COLON) ? this.parseTypeAnnotation() : null
        const init = this.eatIf(T.EQ) ? this.parseExpr() : null
        this.consumeNewlines()
        fields.push(N.ClassField(fieldName, typeAnnotation, init, isStatic, fieldTok.line))
        continue
      }

      // @get prop() => expr  (getter)
      if (this.tokens[this.pos]?.type === T.AT_IDENT && this.tokens[this.pos].value === '@get') {
        this.pos++
        const methodName = this.eat(T.IDENT).value
        const params = this.parseParams()
        const returnType = this.eatIf(T.THIN_ARROW) ? this.parseTypeAnnotation() : null
        const body = this.eatIf(T.ARROW) ? this.parseExpr() : this.parseBlock()
        this.consumeNewlines()
        methods.push(N.ClassMethod(methodName, params, returnType, body, isStatic, true, t.line))
        continue
      }

      // fn method() { ... }
      if (this.tokens[this.pos]?.type === T.FN) {
        const fn = this.parseFnDecl()
        methods.push(N.ClassMethod(fn.name, fn.params, fn.returnType, fn.body, isStatic, false, fn.line))
        continue
      }

      this.pos++
    }
    this.eat(T.RBRACE)
    this.consumeNewlines()
    return N.ClassDecl(name, fields, methods, tok.line)
  }

  parseStatement() {
    this.skipWhitespace()
    const t = this.tokens[this.pos]
    if (!t || t.type === T.EOF || t.type === T.RBRACE) return null

    if (t.type === T.CONST || t.type === T.LET) return this.parseVarDecl()
    if (t.type === T.FN) return this.parseFnDecl()
    if (t.type === T.CLASS) return this.parseClassDecl()
    if (t.type === T.RETURN) {
      const tok = this.next()
      const value = this.peekType() !== T.RBRACE && this.peekType() !== T.NEWLINE
        ? this.parseExpr() : null
      this.consumeNewlines()
      return N.ReturnStatement(value, tok.line)
    }
    if (t.type === T.IF) return this.parseIfStatement()
    if (t.type === T.UNLESS) return this.parseUnlessStatement()
    if (t.type === T.WHILE) return this.parseWhileStatement()
    if (t.type === T.UNTIL) return this.parseUntilStatement()
    if (t.type === T.LOOP) return this.parseLoopStatement()
    if (t.type === T.FOR) return this.parseForStatement()
    if (t.type === T.BREAK) { this.next(); this.consumeNewlines(); return N.BreakStatement(t.line) }
    if (t.type === T.CONTINUE) { this.next(); this.consumeNewlines(); return N.ContinueStatement(t.line) }
    if (t.type === T.THROW) {
      const tok = this.next()
      const arg = this.parseExpr()
      this.consumeNewlines()
      return N.ExprStatement(N.ThrowExpr(arg, tok.line), tok.line)
    }
    if (t.type === T.TRY) return this.parseTryCatch()
    if (t.type === T.MATCH) return this.parseMatchStatement()
    if (t.type === T.AT_IDENT) return this.parseAnnotatedDecl()

    return this.parseExprStatement()
  }

  parseExprStatement() {
    const tok = this.tokens[this.pos]
    const expr = this.parseExpr()
    this.consumeNewlines()
    return N.ExprStatement(expr, tok?.line)
  }

  parseIfStatement() {
    const tok = this.eat(T.IF)
    const condition = this.parseExpr()
    const consequent = this.parseBlock()
    let alternate = null
    if (this.eatIf(T.ELSE)) {
      alternate = this.tokens[this.pos]?.type === T.IF ? this.parseIfStatement() : this.parseBlock()
    }
    this.consumeNewlines()
    return N.IfStatement(condition, consequent, alternate, tok.line)
  }

  parseUnlessStatement() {
    const tok = this.eat(T.UNLESS)
    const condition = this.parseExpr()
    const body = this.parseBlock()
    this.consumeNewlines()
    return N.UnlessStatement(condition, body, tok.line)
  }

  parseWhileStatement() {
    const tok = this.eat(T.WHILE)
    const condition = this.parseExpr()
    const body = this.parseBlock()
    this.consumeNewlines()
    return N.WhileStatement(condition, body, tok.line)
  }

  parseUntilStatement() {
    const tok = this.eat(T.UNTIL)
    const condition = this.parseExpr()
    const body = this.parseBlock()
    this.consumeNewlines()
    return N.UntilStatement(condition, body, tok.line)
  }

  parseLoopStatement() {
    const tok = this.eat(T.LOOP)
    const body = this.parseBlock()
    this.consumeNewlines()
    return N.LoopStatement(body, tok.line)
  }

  parseForStatement() {
    const tok = this.eat(T.FOR)
    let indexName = null
    let itemName = this.eat(T.IDENT).value

    if (this.eatIf(T.COMMA)) {
      indexName = itemName
      itemName = this.eat(T.IDENT).value
    }

    this.eat(T.IN)
    const collection = this.parseExpr()
    const body = this.parseBlock()
    this.consumeNewlines()
    return N.ForStatement(indexName, itemName, collection, body, tok.line)
  }

  parseTryCatch() {
    const tok = this.eat(T.TRY)
    const tryBody = this.parseBlock()
    let catchParam = null
    let catchBody = null
    if (this.eatIf(T.CATCH)) {
      catchParam = this.eat(T.IDENT).value
      catchBody = this.parseBlock()
    }
    this.consumeNewlines()
    return N.TryCatch(tryBody, catchParam, catchBody, tok.line)
  }

  parseMatchStatement() {
    const tok = this.eat(T.MATCH)
    const subject = this.parseExpr()
    const arms = this.parseMatchArms()
    this.consumeNewlines()
    return N.MatchStatement(subject, arms, tok.line)
  }

  parseMatchArms() {
    const arms = []
    this.eat(T.LBRACE)
    while (this.peekType() !== T.RBRACE && this.peekType() !== T.EOF) {
      this.skipWhitespace()
      if (this.tokens[this.pos]?.type === T.RBRACE) break
      const pattern = this.parseMatchPattern()
      this.eat(T.ARROW)
      const body = this.parseExpr()
      this.eatIf(T.COMMA)
      this.consumeNewlines()
      arms.push(N.MatchArm(pattern, body, pattern?.line))
    }
    this.eat(T.RBRACE)
    return arms
  }

  parseMatchPattern() {
    const t = this.tokens[this.pos]
    // Wildcard _
    if (t.type === T.IDENT && t.value === '_') { this.pos++; return { type: 'Wildcard', line: t.line } }
    // none literal
    if (t.type === T.NONE) { this.pos++; return N.Literal(undefined, 'none', t.line) }
    // is type check: x is Type
    if (t.type === T.IDENT && this.tokens[this.pos + 1]?.type === T.IS) {
      const name = this.tokens[this.pos++].value
      this.pos++ // is
      const typeName = this.eat(T.IDENT).value
      return { type: 'IsPattern', name, typeName, line: t.line }
    }
    // Object destructure pattern { key: val }
    if (t.type === T.LBRACE) {
      this.pos++
      const pairs = []
      while (this.tokens[this.pos]?.type !== T.RBRACE) {
        const key = this.eat(T.IDENT).value
        const val = this.eatIf(T.COLON) ? this.eat(T.IDENT).value : key
        pairs.push({ key, val })
        this.eatIf(T.COMMA)
      }
      this.eat(T.RBRACE)
      return { type: 'ObjectPattern', pairs, line: t.line }
    }
    // Ok(val) / Err(val)
    if ((t.type === T.OK || t.type === T.ERR) && this.tokens[this.pos + 1]?.type === T.LPAREN) {
      const kind = t.value; this.pos++
      this.eat(T.LPAREN)
      const name = this.eat(T.IDENT).value
      this.eat(T.RPAREN)
      return { type: 'ResultPattern', kind, name, line: t.line }
    }
    return this.parseExpr()
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  parseExpr() {
    return this.parseAssignment()
  }

  parseAssignment() {
    const left = this.parsePipeline()
    const t = this.tokens[this.pos]
    if (t && [T.EQ, T.PLUS_EQ, T.MINUS_EQ, T.STAR_EQ, T.SLASH_EQ].includes(t.type)) {
      this.pos++
      const right = this.parseAssignment()
      return N.AssignExpr(t.value, left, right, t.line)
    }
    return left
  }

  parsePipeline() {
    let left = this.parseTernary()
    while (this.tokens[this.pos]?.type === T.PIPE) {
      const tok = this.tokens[this.pos++]
      const right = this.parseTernary()
      left = N.PipelineExpr(left, right, tok.line)
    }
    return left
  }

  parseTernary() {
    const cond = this.parseOr()
    if (this.tokens[this.pos]?.type === T.QUESTION) {
      const tok = this.tokens[this.pos++]
      const cons = this.parseOr()
      this.eat(T.COLON)
      const alt = this.parseTernary()
      return N.TernaryExpr(cond, cons, alt, tok.line)
    }
    return cond
  }

  parseOr() {
    let left = this.parseAnd()
    while (this.tokens[this.pos]?.type === T.BARBAR) {
      const tok = this.tokens[this.pos++]
      left = N.LogicalExpr('||', left, this.parseAnd(), tok.line)
    }
    return left
  }

  parseAnd() {
    let left = this.parseNullCoalesce()
    while (this.tokens[this.pos]?.type === T.AMPAMP) {
      const tok = this.tokens[this.pos++]
      left = N.LogicalExpr('&&', left, this.parseNullCoalesce(), tok.line)
    }
    return left
  }

  parseNullCoalesce() {
    let left = this.parseEquality()
    while (this.tokens[this.pos]?.type === T.QQ) {
      const tok = this.tokens[this.pos++]
      left = N.NullCoalesce(left, this.parseEquality(), tok.line)
    }
    return left
  }

  parseEquality() {
    let left = this.parseComparison()
    while ([T.EQEQ, T.BANGEQ, T.IS].includes(this.tokens[this.pos]?.type)) {
      const tok = this.tokens[this.pos++]
      if (tok.type === T.IS) {
        const typeOrValue = this.parseUnary()
        left = N.IsExpr(left, typeOrValue, tok.line)
      } else {
        left = N.BinaryExpr(tok.value, left, this.parseComparison(), tok.line)
      }
    }
    return left
  }

  parseComparison() {
    let left = this.parseAddSub()
    while ([T.LT, T.GT, T.LTEQ, T.GTEQ].includes(this.tokens[this.pos]?.type)) {
      const tok = this.tokens[this.pos++]
      left = N.BinaryExpr(tok.value, left, this.parseAddSub(), tok.line)
    }
    return left
  }

  parseAddSub() {
    let left = this.parseMulDiv()
    while ([T.PLUS, T.MINUS].includes(this.tokens[this.pos]?.type)) {
      const tok = this.tokens[this.pos++]
      left = N.BinaryExpr(tok.value, left, this.parseMulDiv(), tok.line)
    }
    return left
  }

  parseMulDiv() {
    let left = this.parseUnary()
    while ([T.STAR, T.SLASH, T.PERCENT, T.STARSTAR].includes(this.tokens[this.pos]?.type)) {
      const tok = this.tokens[this.pos++]
      left = N.BinaryExpr(tok.value, left, this.parseUnary(), tok.line)
    }
    return left
  }

  parseUnary() {
    const t = this.tokens[this.pos]
    if (t?.type === T.BANG) { this.pos++; return N.UnaryExpr('!', this.parseUnary(), t.line) }
    if (t?.type === T.MINUS) { this.pos++; return N.UnaryExpr('-', this.parseUnary(), t.line) }
    if (t?.type === T.AWAIT) { this.pos++; return N.AwaitExpr(this.parseUnary(), t.line) }
    if (t?.type === T.YIELD) { this.pos++; return N.YieldExpr(this.parseUnary(), t.line) }
    if (t?.type === T.TRY) { this.pos++; return N.TryExpr(this.parseUnary(), t.line) }
    return this.parsePostfix()
  }

  parsePostfix() {
    let expr = this.parsePrimary()
    while (true) {
      const t = this.tokens[this.pos]
      if (!t) break
      if (t.type === T.DOT) {
        this.pos++
        // Allow keyword tokens as property names: obj.get(), obj.delete(), etc.
        const propTok = this.tokens[this.pos++]
        const prop = propTok?.value ?? ''
        expr = N.MemberExpr(expr, N.Identifier(prop, t.line), false, t.line)
      } else if (t.type === T.QQDOT) {
        this.pos++
        const propTok = this.tokens[this.pos++]
        const prop = propTok?.value ?? ''
        expr = N.OptionalChain(expr, N.Identifier(prop, t.line), t.line)
      } else if (t.type === T.LBRACKET) {
        this.pos++
        const index = this.parseExpr()
        this.eat(T.RBRACKET)
        expr = N.MemberExpr(expr, index, true, t.line)
      } else if (t.type === T.LPAREN) {
        const args = this.parseCallArgs()
        expr = N.CallExpr(expr, args, t.line)
      } else break
    }
    return expr
  }

  parseCallArgs() {
    this.eat(T.LPAREN)
    const args = []
    while (this.peekType() !== T.RPAREN && this.peekType() !== T.EOF) {
      if (this.tokens[this.pos]?.type === T.SPREAD) {
        const tok = this.tokens[this.pos++]
        args.push(N.SpreadElement(this.parseExpr(), tok.line))
      } else {
        args.push(this.parseExpr())
      }
      this.eatIf(T.COMMA)
    }
    this.eat(T.RPAREN)
    return args
  }

  parsePrimary() {
    this.skipWhitespace()
    const t = this.tokens[this.pos]
    if (!t) return N.Literal(undefined, 'none', 0)

    // Literals
    if (t.type === T.NUMBER) { this.pos++; return N.Literal(t.value, String(t.value), t.line) }
    if (t.type === T.BOOL) { this.pos++; return N.Literal(t.value === 'true', t.value, t.line) }
    if (t.type === T.NONE) { this.pos++; return N.Literal(undefined, 'none', t.line) }
    if (t.type === T.STRING) {
      this.pos++
      return N.Literal(t.value, JSON.stringify(t.value), t.line)
    }

    // @property reference
    if (t.type === T.AT_IDENT) {
      this.pos++
      return N.AtProperty(t.value.slice(1), t.line)
    }

    // Identifier
    if (t.type === T.IDENT) {
      this.pos++
      return N.Identifier(t.value, t.line)
    }

    // Ok(...) / Err(...)
    if (t.type === T.OK) { this.pos++; this.eat(T.LPAREN); const v = this.parseExpr(); this.eat(T.RPAREN); return N.ResultOk(v, t.line) }
    if (t.type === T.ERR) { this.pos++; this.eat(T.LPAREN); const v = this.parseExpr(); this.eat(T.RPAREN); return N.ResultErr(v, t.line) }

    // Arrow function: x => expr or (a, b) => expr
    if (t.type === T.IDENT && this.tokens[this.pos + 1]?.type === T.ARROW) {
      this.pos++
      this.eat(T.ARROW)
      const body = this.parseExpr()
      return N.ArrowFn([N.Param(t.value, null, null, false, t.line)], body, false, t.line)
    }

    // Parenthesized expr or arrow fn params
    if (t.type === T.LPAREN) {
      this.pos++
      if (this.peekType() === T.RPAREN) {
        this.eat(T.RPAREN)
        this.eat(T.ARROW)
        const body = this.parseExpr()
        return N.ArrowFn([], body, false, t.line)
      }
      const expr = this.parseExpr()
      if (this.eatIf(T.RPAREN)) {
        if (this.tokens[this.pos]?.type === T.ARROW) {
          this.pos++
          const body = this.parseExpr()
          const params = expr.type === 'Identifier'
            ? [N.Param(expr.name, null, null, false, expr.line)]
            : [expr]
          return N.ArrowFn(params, body, false, t.line)
        }
        return expr
      }
      // Multiple params
      const params = [N.Param(expr.name ?? '__p', null, null, false, expr.line)]
      while (this.eatIf(T.COMMA)) {
        const rest = this.eatIf(T.SPREAD)
        const name = this.eat(T.IDENT).value
        params.push(N.Param(name, null, null, !!rest, t.line))
      }
      this.eat(T.RPAREN)
      this.eat(T.ARROW)
      const body = this.parseExpr()
      return N.ArrowFn(params, body, false, t.line)
    }

    // Array literal
    if (t.type === T.LBRACKET) {
      this.pos++
      const elements = []
      while (this.peekType() !== T.RBRACKET && this.peekType() !== T.EOF) {
        if (this.tokens[this.pos]?.type === T.SPREAD) {
          const st = this.tokens[this.pos++]
          elements.push(N.SpreadElement(this.parseExpr(), st.line))
        } else {
          elements.push(this.parseExpr())
        }
        this.eatIf(T.COMMA)
      }
      this.eat(T.RBRACKET)
      return N.ArrayLiteral(elements, t.line)
    }

    // Object literal
    if (t.type === T.LBRACE) {
      this.pos++
      const props = []
      while (this.peekType() !== T.RBRACE && this.peekType() !== T.EOF) {
        if (this.tokens[this.pos]?.type === T.SPREAD) {
          const st = this.tokens[this.pos++]
          props.push(N.SpreadElement(this.parseExpr(), st.line))
        } else {
          // Key can be: IDENT, STRING (for "Content-Type"), or any keyword used as key
          const keyTok = this.tokens[this.pos]
          let key
          if (keyTok?.type === T.STRING) {
            key = keyTok.value
            this.pos++
          } else if (keyTok?.type === T.LBRACKET) {
            // Computed key: [expr]
            this.pos++
            const keyExpr = this.parseExpr()
            this.eat(T.RBRACKET)
            const val = this.eatIf(T.COLON) ? this.parseExpr() : null
            props.push(N.ObjectProp(null, val, false, t.line, keyExpr))
            this.eatIf(T.COMMA)
            this.consumeNewlines()
            continue
          } else {
            // Allow any keyword as property key (get, set, delete, etc.)
            key = this.tokens[this.pos]?.value
            this.pos++
          }
          if (this.eatIf(T.COLON)) {
            const val = this.parseExpr()
            props.push(N.ObjectProp(key, val, false, t.line))
          } else if (this.peekType() === T.LPAREN) {
            // Method shorthand: key(...) { ... }
            const params = this.parseParams()
            const body = this.parseBlock()
            props.push(N.ObjectProp(key, N.ArrowFn(params, body, false, t.line), false, t.line))
          } else {
            props.push(N.ObjectProp(key, N.Identifier(key, t.line), true, t.line))
          }
        }
        this.eatIf(T.COMMA)
        this.consumeNewlines()
      }
      this.eat(T.RBRACE)
      return N.ObjectLiteral(props, t.line)
    }

    // fn (anonymous)
    if (t.type === T.FN) {
      this.pos++
      // Support single-param without parens: fn x => expr
      let params
      if (this.peekType() === T.IDENT && this.tokens[this.pos + 1]?.type === T.ARROW) {
        const pTok = this.tokens[this.pos++]
        params = [N.Param(pTok.value, null, null, pTok.line)]
      } else {
        params = this.parseParams()
      }
      if (this.eatIf(T.ARROW)) {
        return N.ArrowFn(params, this.parseExpr(), false, t.line)
      }
      return N.ArrowFn(params, this.parseBlock(), false, t.line)
    }

    // match expression
    if (t.type === T.MATCH) {
      this.pos++
      const subject = this.parseExpr()
      const arms = this.parseMatchArms()
      return N.MatchExpr(subject, arms, t.line)
    }

    // new ClassName(...)
    if (t.type === T.NEW) {
      this.pos++
      const callee = N.Identifier(this.eat(T.IDENT).value, t.line)
      const args = this.peekType() === T.LPAREN ? this.parseCallArgs() : []
      return N.CallExpr(N.MemberExpr(null, callee, false, t.line), args, t.line)
    }

    // Range expression: 0..10 handled in postfix of number literals
    // (already covered by DOTDOT in postfix)

    // Skip unknown
    this.pos++
    return N.Literal(undefined, 'none', t.line)
  }

  // ── Type annotations ───────────────────────────────────────────────────────

  parseTypeAnnotation() {
    const t = this.tokens[this.pos]
    if (!t) return null

    // Object type literal: { key: Type, ... }
    if (t.type === T.LBRACE) {
      this.pos++ // consume {
      const fields = {}
      while (this.peekType() !== T.RBRACE && this.peekType() !== T.EOF) {
        const key = this.tokens[this.pos++].value
        this.eatIf(T.COLON)
        fields[key] = this.parseTypeAnnotation()
        this.eatIf(T.COMMA)
      }
      this.eatIf(T.RBRACE)
      return N.ObjectType(fields, t.line)
    }

    // Allow 'none' keyword as a type name
    if (t.type === T.NONE) {
      this.pos++
      return N.TypeAnnotation('none', [], false, t.line)
    }

    if (t.type !== T.IDENT) return null

    const name = this.tokens[this.pos++].value
    let args = []
    let nullable = false

    if (this.tokens[this.pos]?.type === T.LT) {
      this.pos++
      args.push(this.parseTypeAnnotation())
      while (this.eatIf(T.COMMA)) args.push(this.parseTypeAnnotation())
      this.eatIf(T.GT)
    }

    if (this.tokens[this.pos]?.type === T.LBRACKET && this.tokens[this.pos + 1]?.type === T.RBRACKET) {
      this.pos += 2
      return N.ArrayType(N.TypeAnnotation(name, args, false, t.line), t.line)
    }

    if (this.tokens[this.pos]?.type === T.QUESTION) {
      this.pos++
      nullable = true
    }

    // Union types: "admin" | "user"
    if (this.tokens[this.pos]?.type === T.BAR) {
      const members = [N.TypeAnnotation(name, args, nullable, t.line)]
      while (this.eatIf(T.BAR)) {
        const next = this.tokens[this.pos++]
        members.push(N.TypeAnnotation(next.value, [], false, next.line))
      }
      return N.UnionType(members, t.line)
    }

    return N.TypeAnnotation(name, args, nullable, t.line)
  }
}

module.exports = { Parser }
