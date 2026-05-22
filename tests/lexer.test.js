'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { Lexer } = require('../src/lexer')
const { T } = require('../src/tokens')

// Helper: lex source and return token array (excluding EOF)
function lex(source) {
  const lexer = new Lexer(source)
  const tokens = lexer.tokenize()
  return tokens.filter(t => t.type !== T.EOF)
}

// Helper: return just token types
function types(source) {
  return lex(source).map(t => t.type)
}

// Helper: return just token values
function values(source) {
  return lex(source).map(t => t.value)
}

describe('Lexer - identifiers', () => {
  test('tokenizes a simple identifier', () => {
    const tokens = lex('hello')
    assert.equal(tokens.length, 1)
    assert.equal(tokens[0].type, T.IDENT)
    assert.equal(tokens[0].value, 'hello')
  })

  test('tokenizes an identifier with underscores and digits', () => {
    const tokens = lex('my_var_2')
    assert.equal(tokens[0].type, T.IDENT)
    assert.equal(tokens[0].value, 'my_var_2')
  })

  test('tokenizes multiple identifiers on one line', () => {
    const toks = lex('foo bar baz')
    assert.equal(toks.length, 3)
    assert.deepEqual(toks.map(t => t.value), ['foo', 'bar', 'baz'])
  })
})

describe('Lexer - keywords', () => {
  test('recognizes "page" keyword', () => {
    assert.equal(lex('page')[0].type, T.PAGE)
  })

  test('recognizes "widget" keyword', () => {
    assert.equal(lex('widget')[0].type, T.WIDGET)
  })

  test('recognizes "heading" as identifier (not a keyword)', () => {
    // "heading" is a structure element, not a keyword — lexer emits IDENT
    const t = lex('heading')[0]
    assert.equal(t.type, T.IDENT)
    assert.equal(t.value, 'heading')
  })

  test('recognizes "card" as identifier', () => {
    const t = lex('card')[0]
    assert.equal(t.type, T.IDENT)
    assert.equal(t.value, 'card')
  })

  test('recognizes "button" as identifier', () => {
    const t = lex('button')[0]
    assert.equal(t.type, T.IDENT)
    assert.equal(t.value, 'button')
  })

  test('recognizes "row" and "col" as identifiers', () => {
    const toks = lex('row col')
    assert.equal(toks[0].type, T.IDENT)
    assert.equal(toks[1].type, T.IDENT)
  })

  test('recognizes "let" and "const" keywords', () => {
    const toks = lex('let const')
    assert.equal(toks[0].type, T.LET)
    assert.equal(toks[1].type, T.CONST)
  })

  test('recognizes "fn" keyword', () => {
    assert.equal(lex('fn')[0].type, T.FN)
  })

  test('recognizes "if", "else", "unless" keywords', () => {
    const toks = lex('if else unless')
    assert.equal(toks[0].type, T.IF)
    assert.equal(toks[1].type, T.ELSE)
    assert.equal(toks[2].type, T.UNLESS)
  })

  test('recognizes "for" and "in" keywords', () => {
    const toks = lex('for in')
    assert.equal(toks[0].type, T.FOR)
    assert.equal(toks[1].type, T.IN)
  })

  test('recognizes "return" keyword', () => {
    assert.equal(lex('return')[0].type, T.RETURN)
  })

  test('recognizes "true" and "false" as BOOL', () => {
    const toks = lex('true false')
    assert.equal(toks[0].type, T.BOOL)
    assert.equal(toks[0].value, 'true')
    assert.equal(toks[1].type, T.BOOL)
    assert.equal(toks[1].value, 'false')
  })

  test('recognizes "none" keyword', () => {
    assert.equal(lex('none')[0].type, T.NONE)
  })

  test('recognizes "await" keyword', () => {
    assert.equal(lex('await')[0].type, T.AWAIT)
  })

  test('recognizes "import" and "from" keywords', () => {
    const toks = lex('import from')
    assert.equal(toks[0].type, T.IMPORT)
    assert.equal(toks[1].type, T.FROM)
  })
})

describe('Lexer - annotations (@-identifiers)', () => {
  test('tokenizes @state as AT_IDENT', () => {
    const t = lex('@state')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@state')
  })

  test('tokenizes @build as AT_IDENT', () => {
    const t = lex('@build')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@build')
  })

  test('tokenizes @live as AT_IDENT', () => {
    const t = lex('@live')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@live')
  })

  test('tokenizes @computed as AT_IDENT', () => {
    const t = lex('@computed')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@computed')
  })

  test('tokenizes @server as AT_IDENT', () => {
    const t = lex('@server')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@server')
  })

  test('tokenizes @worker as AT_IDENT', () => {
    const t = lex('@worker')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@worker')
  })

  test('tokenizes @realtime as AT_IDENT', () => {
    const t = lex('@realtime')[0]
    assert.equal(t.type, T.AT_IDENT)
    assert.equal(t.value, '@realtime')
  })
})

describe('Lexer - numbers', () => {
  test('tokenizes integer', () => {
    const t = lex('42')[0]
    assert.equal(t.type, T.NUMBER)
    assert.equal(t.value, 42)
  })

  test('tokenizes float', () => {
    const t = lex('3.14')[0]
    assert.equal(t.type, T.NUMBER)
    assert.equal(t.value, 3.14)
  })

  test('tokenizes zero', () => {
    const t = lex('0')[0]
    assert.equal(t.type, T.NUMBER)
    assert.equal(t.value, 0)
  })

  test('tokenizes number with underscores as separators', () => {
    const t = lex('1_000_000')[0]
    assert.equal(t.type, T.NUMBER)
    assert.equal(t.value, 1000000)
  })
})

describe('Lexer - strings', () => {
  test('tokenizes double-quoted string', () => {
    const toks = lex('"hello"')
    assert.equal(toks[0].type, T.STRING)
    assert.equal(toks[0].value, 'hello')
  })

  test('tokenizes single-quoted string', () => {
    const toks = lex("'world'")
    assert.equal(toks[0].type, T.STRING)
    assert.equal(toks[0].value, 'world')
  })

  test('tokenizes empty string', () => {
    const toks = lex('""')
    assert.equal(toks[0].type, T.STRING)
    assert.equal(toks[0].value, '')
  })

  test('tokenizes string with escape sequences', () => {
    const toks = lex('"hello\\nworld"')
    assert.equal(toks[0].type, T.STRING)
    assert.equal(toks[0].value, 'hello\nworld')
  })

  test('template literal with interpolation emits STRING, INTERP_START, expr, INTERP_END, STRING', () => {
    const toks = lex('"hello {name}"')
    const typList = toks.map(t => t.type)
    assert.ok(typList.includes(T.STRING))
    assert.ok(typList.includes(T.INTERP_START))
    assert.ok(typList.includes(T.INTERP_END))
    // First STRING is "hello "
    assert.equal(toks[0].type, T.STRING)
    assert.equal(toks[0].value, 'hello ')
    // INTERP_START
    assert.equal(toks[1].type, T.INTERP_START)
    // identifier inside interpolation
    assert.equal(toks[2].type, T.IDENT)
    assert.equal(toks[2].value, 'name')
    // INTERP_END
    assert.equal(toks[3].type, T.INTERP_END)
    // trailing empty string
    assert.equal(toks[4].type, T.STRING)
    assert.equal(toks[4].value, '')
  })

  test('template literal with expression interpolation', () => {
    const toks = lex('"Count: {count * 2}"')
    const typList = toks.map(t => t.type)
    assert.ok(typList.includes(T.INTERP_START))
    assert.ok(typList.includes(T.INTERP_END))
    // Find IDENT "count" between markers
    const interpStart = typList.indexOf(T.INTERP_START)
    assert.equal(toks[interpStart + 1].type, T.IDENT)
    assert.equal(toks[interpStart + 1].value, 'count')
  })
})

describe('Lexer - operators', () => {
  test('tokenizes arithmetic operators', () => {
    const toks = lex('+ - * /')
    assert.deepEqual(toks.map(t => t.type), [T.PLUS, T.MINUS, T.STAR, T.SLASH])
  })

  test('tokenizes == and !=', () => {
    const toks = lex('== !=')
    assert.equal(toks[0].type, T.EQEQ)
    assert.equal(toks[1].type, T.BANGEQ)
  })

  test('tokenizes comparison operators', () => {
    const toks = lex('< > <= >=')
    assert.deepEqual(toks.map(t => t.type), [T.LT, T.GT, T.LTEQ, T.GTEQ])
  })

  test('tokenizes && and ||', () => {
    const toks = lex('&& ||')
    assert.equal(toks[0].type, T.AMPAMP)
    assert.equal(toks[1].type, T.BARBAR)
  })

  test('tokenizes => (arrow)', () => {
    const t = lex('=>')[0]
    assert.equal(t.type, T.ARROW)
    assert.equal(t.value, '=>')
  })

  test('tokenizes -> (thin arrow)', () => {
    const t = lex('->')[0]
    assert.equal(t.type, T.THIN_ARROW)
    assert.equal(t.value, '->')
  })

  test('tokenizes |> (pipe)', () => {
    const t = lex('|>')[0]
    assert.equal(t.type, T.PIPE)
    assert.equal(t.value, '|>')
  })

  test('tokenizes = (assignment)', () => {
    const t = lex('=')[0]
    assert.equal(t.type, T.EQ)
  })

  test('tokenizes += -= *= /=', () => {
    const toks = lex('+= -= *= /=')
    assert.deepEqual(toks.map(t => t.type), [T.PLUS_EQ, T.MINUS_EQ, T.STAR_EQ, T.SLASH_EQ])
  })

  test('tokenizes ** (exponentiation)', () => {
    const t = lex('**')[0]
    assert.equal(t.type, T.STARSTAR)
  })
})

describe('Lexer - punctuation', () => {
  test('tokenizes parentheses, brackets, braces', () => {
    const toks = lex('( ) [ ] { }')
    assert.deepEqual(toks.map(t => t.type), [
      T.LPAREN, T.RPAREN, T.LBRACKET, T.RBRACKET, T.LBRACE, T.RBRACE
    ])
  })

  test('tokenizes dot, comma, colon, semicolon', () => {
    const toks = lex('. , : ;')
    assert.deepEqual(toks.map(t => t.type), [T.DOT, T.COMMA, T.COLON, T.SEMI])
  })
})

describe('Lexer - indentation (INDENT/DEDENT)', () => {
  test('emits INDENT on deeper indentation', () => {
    const src = 'page\n  heading'
    const toks = lex(src)
    const typList = toks.map(t => t.type)
    assert.ok(typList.includes(T.INDENT), 'should have INDENT token')
  })

  test('emits DEDENT when indentation decreases', () => {
    const src = 'page\n  heading\ntext'
    const toks = lex(src)
    const typList = toks.map(t => t.type)
    assert.ok(typList.includes(T.DEDENT), 'should have DEDENT token')
  })

  test('emits matching DEDENT for each INDENT level', () => {
    const src = 'a\n  b\n    c\nd'
    const toks = lex(src)
    const indents = toks.filter(t => t.type === T.INDENT).length
    const dedents = toks.filter(t => t.type === T.DEDENT).length
    assert.equal(indents, dedents, 'INDENT and DEDENT counts should match')
  })
})

describe('Lexer - on:event and bind: attribute syntax', () => {
  test('tokenizes "on" as an IDENT before colon', () => {
    // on:click tokenized as IDENT("on"), COLON, IDENT("click")
    const toks = lex('on:click')
    assert.equal(toks[0].type, T.IDENT)
    assert.equal(toks[0].value, 'on')
    assert.equal(toks[1].type, T.COLON)
    assert.equal(toks[2].type, T.IDENT)
    assert.equal(toks[2].value, 'click')
  })

  test('tokenizes "bind:value" as IDENT, COLON, IDENT', () => {
    const toks = lex('bind:value')
    assert.equal(toks[0].type, T.IDENT)
    assert.equal(toks[0].value, 'bind')
    assert.equal(toks[1].type, T.COLON)
    assert.equal(toks[2].type, T.IDENT)
    assert.equal(toks[2].value, 'value')
  })
})

describe('Lexer - comments', () => {
  test('skips single-line comments', () => {
    const toks = lex('// this is a comment\nhello')
    // Should only have NEWLINE (if any) and IDENT "hello"
    const nonNL = toks.filter(t => t.type !== T.NEWLINE)
    assert.equal(nonNL.length, 1)
    assert.equal(nonNL[0].value, 'hello')
  })

  test('inline comment after code is stripped', () => {
    const toks = lex('foo // a comment')
    const nonNL = toks.filter(t => t.type !== T.NEWLINE)
    assert.equal(nonNL.length, 1)
    assert.equal(nonNL[0].value, 'foo')
  })
})

describe('Lexer - line tracking', () => {
  test('tracks line numbers', () => {
    const toks = lex('foo\nbar')
    const foo = toks.find(t => t.value === 'foo')
    const bar = toks.find(t => t.value === 'bar')
    assert.equal(foo.line, 1)
    assert.equal(bar.line, 2)
  })
})

describe('Lexer - error cases', () => {
  test('unterminated string emits the partial string content up to EOF', () => {
    // The lexer does not throw on EOF-terminated strings — it emits what it has
    const toks = lex('"unterminated')
    assert.equal(toks.length, 1)
    assert.equal(toks[0].type, T.STRING)
    assert.equal(toks[0].value, 'unterminated')
  })

  test('throws on unexpected character', () => {
    assert.throws(() => lex('`'), /Unexpected character/)
  })

  test('throws on newline inside double-quoted string', () => {
    assert.throws(() => lex('"line1\nline2"'), /Unterminated string/)
  })

  test('throws on unterminated string interpolation in template', () => {
    // The interpolation has { but no }
    assert.throws(() => lex('text "hello {expr'), /string interpolation|Unterminated|Unexpected/)
  })

  test('lexer.match returns true and advances when char matches', () => {
    const { Lexer } = require('../src/lexer')
    const l = new Lexer('=x', 'test')
    // Position 0 is '=' — match('=') returns true and advances
    const pos0 = l.pos
    const r = l.match('=')
    assert.equal(r, true)
    assert.ok(l.pos > pos0)
  })

  test('handles interpolation with nested {} braces via depth tracking', () => {
    // String interpolation containing an object literal expression with {}
    const tokens = lex('text "hello {{a: 1}.a}"')
    // Should tokenize without error
    assert.ok(tokens.length > 5)
    // Should contain INTERP_START and INTERP_END
    const types = tokens.map(t => t.type)
    assert.ok(types.includes(T.INTERP_START))
    assert.ok(types.includes(T.INTERP_END))
  })

  test('Token.toString returns formatted string', () => {
    const { Token } = require('../src/tokens')
    const t = new Token('IDENT', 'foo', 1, 5)
    assert.equal(t.toString(), 'Token(IDENT, "foo", 1:5)')
  })

  test('lexer.match returns false when char does not match', () => {
    const { Lexer } = require('../src/lexer')
    const l = new Lexer('x', 'test')
    const r = l.match('=')
    assert.equal(r, false)
  })
})
