'use strict'

const { T, KEYWORDS, Token } = require('./tokens')

// String escape sequences: hoisted to avoid per-character object allocation
const _STR_ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '{': '{' }

// Hoisted character-class tests for hot lexer loops
const _RE_DIGIT_UNDERSCORE = /[0-9_]/
const _RE_DIGIT = /[0-9]/
const _RE_IDENT_START = /[a-zA-Z_$]/
const _RE_IDENT_CONT = /[a-zA-Z0-9_$]/
const _RE_AT_CONT = /[a-zA-Z0-9_]/
const _RE_HEX_DIGIT = /[0-9a-fA-F_]/


class Lexer {
  constructor(source, filename = '<input>') {
    this.source = source
    this.filename = filename
    this.pos = 0
    this.line = 1
    this.col = 1
    this.tokens = []
    // Indentation stack for template mode
    this.indentStack = [0]
    this.pendingDedents = 0
  }

  error(msg) {
    throw new SyntaxError(`${this.filename}:${this.line}:${this.col}: ${msg}`)
  }

  peek(offset = 0) {
    return this.source[this.pos + offset]
  }

  advance() {
    const ch = this.source[this.pos++]
    if (ch === '\n') { this.line++; this.col = 1 }
    else this.col++
    return ch
  }

  match(expected) {
    if (this.source[this.pos] === expected) {
      this.advance()
      return true
    }
    return false
  }

  emit(type, value, line, col) {
    this.tokens.push(new Token(type, value, line ?? this.line, col ?? this.col))
  }

  // Skip whitespace but NOT newlines (newlines are significant in template mode)
  skipInlineWhitespace() {
    while (this.pos < this.source.length && (this.source[this.pos] === ' ' || this.source[this.pos] === '\t')) {
      this.advance()
    }
  }

  skipLineComment() {
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance()
    }
  }

  // Measure indentation of the current line
  measureIndent() {
    let indent = 0
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === ' ') { indent++; this.advance() }
      else if (ch === '\t') { indent += 2; this.advance() }
      else break
    }
    return indent
  }

  tokenizeString(quote) {
    const line = this.line
    const col = this.col - 1
    const chars = []

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]

      if (ch === '\\') {
        this.advance()
        const esc = this.advance()
        chars.push(_STR_ESCAPES[esc] ?? esc)
        continue
      }

      if (quote === '"' && ch === '{') {
        // Start interpolation
        this.emit(T.STRING, chars.join(''), line, col)
        chars.length = 0
        this.advance() // consume {
        this.emit(T.INTERP_START, '{', this.line, this.col)
        // Tokenize the expression until matching }
        this.tokenizeInterpolation()
        this.emit(T.INTERP_END, '}', this.line, this.col)
        continue
      }

      if (ch === quote) {
        this.advance()
        break
      }

      if (ch === '\n' && quote !== '`') {
        this.error('Unterminated string literal')
      }

      chars.push(ch)
      this.advance()
    }

    this.emit(T.STRING, chars.join(''), line, col)
  }

  tokenizeInterpolation() {
    // Tokenize until we hit the matching } (depth tracking)
    let depth = 0
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === '{') { depth++; this.tokenizeOne(); continue }
      if (ch === '}') {
        if (depth === 0) { this.advance(); return }
        depth--
        this.tokenizeOne()
        continue
      }
      this.tokenizeOne()
    }
    this.error('Unterminated string interpolation')
  }

  tokenizeNumber() {
    const start = this.pos - 1
    // Hex literal: 0x...
    if (this.source[start] === '0' && (this.source[this.pos] === 'x' || this.source[this.pos] === 'X')) {
      this.advance() // consume x
      while (this.pos < this.source.length && _RE_HEX_DIGIT.test(this.source[this.pos])) this.advance()
      const raw = this.source.slice(start, this.pos).replace(/_/g, '')
      this.emit(T.NUMBER, parseInt(raw, 16))
      this.tokens[this.tokens.length - 1].raw = raw
      return
    }
    while (this.pos < this.source.length && _RE_DIGIT_UNDERSCORE.test(this.source[this.pos])) {
      this.advance()
    }
    if (this.source[this.pos] === '.' && _RE_DIGIT.test(this.source[this.pos + 1])) {
      this.advance()
      while (this.pos < this.source.length && _RE_DIGIT_UNDERSCORE.test(this.source[this.pos])) {
        this.advance()
      }
    }
    const raw = this.source.slice(start, this.pos).replace(/_/g, '')
    this.emit(T.NUMBER, parseFloat(raw))
    this.tokens[this.tokens.length - 1].raw = raw
  }

  tokenizeIdent(first) {
    const start = this.pos - 1  // first char already consumed
    while (this.pos < this.source.length && _RE_IDENT_CONT.test(this.source[this.pos])) {
      this.advance()
    }
    const value = this.source.slice(start, this.pos)
    const kwType = KEYWORDS.get(value)
    if (kwType) {
      this.emit(kwType, value)
    } else {
      this.emit(T.IDENT, value)
    }
  }

  tokenizeAtSign() {
    // @ can start: @state, @build, @computed, @server, @worker, @get, @ident
    const start = this.pos - 1  // @ already consumed
    while (this.pos < this.source.length && _RE_AT_CONT.test(this.source[this.pos])) {
      this.advance()
    }
    this.emit(T.AT_IDENT, this.source.slice(start, this.pos))
  }

  // Tokenize one token at the current position
  tokenizeOne() {
    this.skipInlineWhitespace()
    if (this.pos >= this.source.length) {
      this.emit(T.EOF, null)
      return false
    }

    const ch = this.advance()
    const line = this.line
    const col = this.col - 1

    // Newline: significant in template mode
    if (ch === '\n') {
      this.emit(T.NEWLINE, '\n', line, col)
      return true
    }

    // Comments
    if (ch === '/' && this.peek() === '/') {
      this.skipLineComment()
      return true
    }

    // Strings
    if (ch === '"' || ch === "'") {
      this.tokenizeString(ch)
      return true
    }

    // Numbers
    if (_RE_DIGIT.test(ch)) {
      this.tokenizeNumber()
      return true
    }

    // Identifiers and keywords
    if (_RE_IDENT_START.test(ch)) {
      this.tokenizeIdent(ch)
      return true
    }

    // @ sign (annotations and instance properties)
    if (ch === '@') {
      this.tokenizeAtSign()
      return true
    }

    // Multi-char operators
    switch (ch) {
      case '.':
        if (this.peek() === '.' && this.peek(1) === '.') { this.advance(); this.advance(); this.emit(T.SPREAD, '...'); break }
        if (this.peek() === '.' && this.peek(1) === '=') { this.advance(); this.advance(); this.emit(T.DOTDOTEQ, '..='); break }
        if (this.peek() === '.') { this.advance(); this.emit(T.DOTDOT, '..'); break }
        this.emit(T.DOT, '.')
        break
      case '=':
        if (this.peek() === '=') { this.advance(); this.emit(T.EQEQ, '=='); break }
        if (this.peek() === '>') { this.advance(); this.emit(T.ARROW, '=>'); break }
        this.emit(T.EQ, '=')
        break
      case '!':
        if (this.peek() === '=') { this.advance(); this.emit(T.BANGEQ, '!='); break }
        this.emit(T.BANG, '!')
        break
      case '<':
        if (this.peek() === '<') { this.advance(); if (this.peek() === '=') { this.advance(); this.emit(T.LSHIFT_EQ, '<<='); } else { this.emit(T.LSHIFT, '<<'); } break }
        if (this.peek() === '=') { this.advance(); this.emit(T.LTEQ, '<='); break }
        this.emit(T.LT, '<')
        break
      case '>':
        if (this.peek() === '>') { this.advance(); if (this.peek() === '=') { this.advance(); this.emit(T.RSHIFT_EQ, '>>='); } else { this.emit(T.RSHIFT, '>>'); } break }
        if (this.peek() === '=') { this.advance(); this.emit(T.GTEQ, '>='); break }
        this.emit(T.GT, '>')
        break
      case '^':
        if (this.peek() === '=') { this.advance(); this.emit(T.CARET_EQ, '^='); break }
        this.emit(T.CARET, '^')
        break
      case '&':
        if (this.peek() === '&') { this.advance(); this.emit(T.AMPAMP, '&&'); break }
        this.emit(T.AMP, '&')
        break
      case '|':
        if (this.peek() === '>') { this.advance(); this.emit(T.PIPE, '|>'); break }
        if (this.peek() === '|') { this.advance(); this.emit(T.BARBAR, '||'); break }
        this.emit(T.BAR, '|')
        break
      case '?':
        if (this.peek() === '.') { this.advance(); this.emit(T.QQDOT, '?.'); break }
        if (this.peek() === '?') { this.advance(); this.emit(T.QQ, '??'); break }
        this.emit(T.QUESTION, '?')
        break
      case '+':
        if (this.peek() === '=') { this.advance(); this.emit(T.PLUS_EQ, '+='); break }
        this.emit(T.PLUS, '+')
        break
      case '-':
        if (this.peek() === '=') { this.advance(); this.emit(T.MINUS_EQ, '-='); break }
        if (this.peek() === '>') { this.advance(); this.emit(T.THIN_ARROW, '->'); break }
        this.emit(T.MINUS, '-')
        break
      case '*':
        if (this.peek() === '*') { this.advance(); this.emit(T.STARSTAR, '**'); break }
        if (this.peek() === '=') { this.advance(); this.emit(T.STAR_EQ, '*='); break }
        this.emit(T.STAR, '*')
        break
      case '/':
        if (this.peek() === '=') { this.advance(); this.emit(T.SLASH_EQ, '/='); break }
        this.emit(T.SLASH, '/')
        break
      case '%': this.emit(T.PERCENT, '%'); break
      case '(': this.emit(T.LPAREN, '('); break
      case ')': this.emit(T.RPAREN, ')'); break
      case '{': this.emit(T.LBRACE, '{'); break
      case '}': this.emit(T.RBRACE, '}'); break
      case '[': this.emit(T.LBRACKET, '['); break
      case ']': this.emit(T.RBRACKET, ']'); break
      case ',': this.emit(T.COMMA, ','); break
      case ':': this.emit(T.COLON, ':'); break
      case ';': this.emit(T.SEMI, ';'); break
      case '#': this.emit(T.HASH, '#'); break
      default:
        this.error(`Unexpected character: ${JSON.stringify(ch)}`)
    }
    return true
  }

  tokenize() {
    while (this.pos < this.source.length) {
      // Handle blank lines and indentation at line start
      if (this.col === 1) {
        // Skip blank lines
        if (this.source[this.pos] === '\n') {
          this.advance()
          continue
        }
        // Skip comment-only lines
        if (this.source[this.pos] === '/' && this.source[this.pos + 1] === '/') {
          this.skipLineComment()
          continue
        }
        // Measure and emit INDENT/DEDENT tokens
        const indent = this.measureIndent()
        const current = this.indentStack[this.indentStack.length - 1]
        if (indent > current) {
          this.indentStack.push(indent)
          this.emit(T.INDENT, indent)
        } else if (indent < current) {
          while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > indent) {
            this.indentStack.pop()
            this.emit(T.DEDENT, indent)
          }
        }
      }

      this.tokenizeOne()
    }

    // Close any remaining open indents
    while (this.indentStack.length > 1) {
      this.indentStack.pop()
      this.emit(T.DEDENT, 0)
    }

    this.emit(T.EOF, null)
    return this.tokens
  }
}

module.exports = { Lexer }
