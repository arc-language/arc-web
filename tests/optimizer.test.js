'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')
const { Optimizer } = require('../src/optimizer')
const N = require('../src/ast')

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(source) {
  const lexer = new Lexer(source)
  const tokens = lexer.tokenize()
  const parser = new Parser(tokens)
  return parser.parse()
}

function optimize(source, buildContext = {}) {
  const program = parse(source)
  const opt = new Optimizer(buildContext)
  return opt.optimizeProgram(program)
}

// Flatten all nodes recursively into an array for inspection
function flattenNodes(children) {
  const result = []
  for (const child of (children ?? [])) {
    result.push(child)
    if (child.children) result.push(...flattenNodes(child.children))
    if (child.body) result.push(...flattenNodes(child.body))
    if (child.consequent) result.push(...flattenNodes(child.consequent))
    if (child.alternate) result.push(...flattenNodes(child.alternate))
  }
  return result
}

function pageBody(program) {
  return program.declarations[0].body
}

// ── optimizeProgram() structure ───────────────────────────────────────────────

describe('Optimizer.optimizeProgram()', () => {
  test('returns a program with the same structure', () => {
    const prog = optimize('page "Hello"\n  text "hi"')
    assert.equal(prog.type, 'Program')
    assert.ok(Array.isArray(prog.declarations))
    assert.equal(prog.declarations[0].type, 'PageDecl')
  })

  test('passes through BuildDecl nodes unchanged', () => {
    const source = 'page "X"\n  text "hi"'
    const program = parse(source)
    // Manually inject a BuildDecl into declarations
    program.declarations.unshift(N.BuildDecl('env', null, N.Literal('prod', 'prod', 0), 0))
    const opt = new Optimizer({ env: 'prod' })
    const result = opt.optimizeProgram(program)
    assert.equal(result.declarations[0].type, 'BuildDecl')
    assert.equal(result.declarations[1].type, 'PageDecl')
  })

  test('passes through WidgetDecl', () => {
    const source = 'widget Btn\n  button "click"'
    const prog = optimize(source)
    assert.equal(prog.declarations[0].type, 'WidgetDecl')
  })
})

// ── Static for-loop unrolling ─────────────────────────────────────────────────

describe('Optimizer - static for-loop unrolling', () => {
  test('for loop over @build array gets unrolled into N copies of body', () => {
    // Build the AST manually: for each item in a 3-element array, emit a div
    const forNode = N.ForNode(null, 'item', N.Identifier('items', 0), [
      N.Element('div', [], null, {}, [], 0),
    ], 0)
    const program = N.Program([], [
      N.PageDecl(null, [], [forNode], null, 0),
    ], 0)
    const opt = new Optimizer({ items: ['a', 'b', 'c'] })
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    // After unrolling, 3 items → 3 Element nodes, no ForNode
    assert.ok(!body.some(n => n.type === 'ForNode'), 'ForNode should be gone')
    assert.equal(body.length, 3)
    assert.ok(body.every(n => n.type === 'Element' && n.tag === 'div'))
  })

  test('unrolled loop substitutes bound variable with text', () => {
    // ForNode whose body contains an InterpolationNode referencing the loop var
    const forNode = N.ForNode(null, 'item', N.Identifier('colors', 0), [
      N.InterpolationNode(N.Identifier('item', 0), 0),
    ], 0)
    const program = N.Program([], [
      N.PageDecl(null, [], [forNode], null, 0),
    ], 0)
    const opt = new Optimizer({ colors: ['red', 'green'] })
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    // Each unrolled item should be a TextNode with the concrete value
    assert.equal(body.length, 2)
    assert.equal(body[0].type, 'TextNode')
    assert.equal(body[0].value, 'red')
    assert.equal(body[1].type, 'TextNode')
    assert.equal(body[1].value, 'green')
  })

  test('for loop over unknown (dynamic) collection is left as ForNode', () => {
    const forNode = N.ForNode(null, 'item', N.Identifier('dynamicList', 0), [
      N.Element('div', [], null, {}, [], 0),
    ], 0)
    const program = N.Program([], [
      N.PageDecl(null, [], [forNode], null, 0),
    ], 0)
    const opt = new Optimizer({}) // no build context for dynamicList
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body[0].type, 'ForNode')
  })

  test('unrolled loop with 0 items produces empty body', () => {
    const forNode = N.ForNode(null, 'item', N.Identifier('emptyArr', 0), [
      N.Element('div', [], null, {}, [], 0),
    ], 0)
    const program = N.Program([], [
      N.PageDecl(null, [], [forNode], null, 0),
    ], 0)
    const opt = new Optimizer({ emptyArr: [] })
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body.length, 0)
  })
})

// ── Static if folding ─────────────────────────────────────────────────────────

describe('Optimizer - static if folding', () => {
  test('truthy @build condition keeps consequent and drops alternate', () => {
    const source = `page "Test"
  if isProd
    text "production"
  else
    text "development"`
    const prog = optimize(source, { isProd: true })
    const body = pageBody(prog)
    // Should have only the consequent content
    const nodes = flattenNodes(body)
    const textNodes = nodes.filter(n => n.type === 'TextNode')
    assert.ok(textNodes.some(n => n.value === 'production'), 'should have production text')
    assert.ok(!textNodes.some(n => n.value === 'development'), 'should not have development text')
    assert.ok(!body.some(n => n.type === 'IfNode'), 'IfNode should be removed')
  })

  test('falsy @build condition keeps alternate and drops consequent', () => {
    const source = `page "Test"
  if isDebug
    text "debug mode"
  else
    text "normal mode"`
    const prog = optimize(source, { isDebug: false })
    const body = pageBody(prog)
    const nodes = flattenNodes(body)
    const textNodes = nodes.filter(n => n.type === 'TextNode')
    assert.ok(!textNodes.some(n => n.value === 'debug mode'), 'should not have debug text')
    assert.ok(textNodes.some(n => n.value === 'normal mode'), 'should have normal mode text')
    assert.ok(!body.some(n => n.type === 'IfNode'), 'IfNode should be removed')
  })

  test('falsy condition with no alternate produces empty body', () => {
    const source = `page "Test"
  if showBanner
    text "banner"`
    const prog = optimize(source, { showBanner: false })
    const body = pageBody(prog)
    assert.equal(body.length, 0)
  })

  test('unknown condition is left as IfNode', () => {
    const source = `page "Test"
  if runtimeFlag
    text "shown"`
    const prog = optimize(source, {}) // no build context
    const body = pageBody(prog)
    assert.equal(body[0].type, 'IfNode')
  })
})

// ── Interpolation folding ─────────────────────────────────────────────────────

describe('Optimizer - interpolation folding', () => {
  test('interpolation with @build value gets folded to a TextNode', () => {
    // Build a program with an InterpolationNode referencing a build variable
    const program = N.Program([], [
      N.PageDecl(null, [], [
        N.InterpolationNode(N.Identifier('version', 0), 0),
      ], null, 0),
    ], 0)
    const opt = new Optimizer({ version: '1.2.3' })
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body[0].type, 'TextNode')
    assert.equal(body[0].value, '1.2.3')
  })

  test('interpolation with unknown variable stays as InterpolationNode', () => {
    const program = N.Program([], [
      N.PageDecl(null, [], [
        N.InterpolationNode(N.Identifier('count', 0), 0),
      ], null, 0),
    ], 0)
    const opt = new Optimizer({}) // count is not a build var
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body[0].type, 'InterpolationNode')
  })

  test('TemplateLiteral with all @build parts gets folded to TextNode', () => {
    const program = N.Program([], [
      N.PageDecl(null, [], [
        N.TemplateLiteral([
          N.Literal('Hello, ', 'Hello, ', 0),
          N.Identifier('username', 0),
          N.Literal('!', '!', 0),
        ], 0),
      ], null, 0),
    ], 0)
    const opt = new Optimizer({ username: 'Alice' })
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body[0].type, 'TextNode')
    assert.equal(body[0].value, 'Hello, Alice!')
  })

  test('TemplateLiteral with unknown part stays as TemplateLiteral', () => {
    const program = N.Program([], [
      N.PageDecl(null, [], [
        N.TemplateLiteral([
          N.Literal('Hi ', 'Hi ', 0),
          N.Identifier('dynamicName', 0),
        ], 0),
      ], null, 0),
    ], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body[0].type, 'TemplateLiteral')
  })
})

// ── Unknown / dynamic nodes pass through ─────────────────────────────────────

describe('Optimizer - passthrough of unknown/dynamic nodes', () => {
  test('Element nodes are passed through with children optimized', () => {
    const source = 'page "Test"\n  div\n    text "inner"'
    const prog = optimize(source)
    const body = pageBody(prog)
    assert.equal(body[0].type, 'Element')
    assert.equal(body[0].tag, 'div')
  })

  test('TextNode is passed through unchanged', () => {
    const program = N.Program([], [
      N.PageDecl(null, [], [
        N.TextNode('static text', 0),
      ], null, 0),
    ], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.equal(body[0].type, 'TextNode')
    assert.equal(body[0].value, 'static text')
  })

  test('arbitrary unknown node type is passed through unchanged', () => {
    const customNode = { type: 'MyCustomNode', data: 'anything', line: 0 }
    const program = N.Program([], [
      N.PageDecl(null, [], [customNode], null, 0),
    ], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeProgram(program)
    const body = result.declarations[0].body
    assert.deepEqual(body[0], customNode)
  })
})

// ── Optimizer resolveExpr ─────────────────────────────────────────────────────

describe('Optimizer - resolveExpr', () => {
  test('resolves Literal directly', () => {
    const opt = new Optimizer({})
    assert.equal(opt.resolveExpr(N.Literal(42, '42', 0)), 42)
  })

  test('resolves Identifier from build context', () => {
    const opt = new Optimizer({ x: 'found' })
    assert.equal(opt.resolveExpr(N.Identifier('x', 0)), 'found')
  })

  test('returns undefined for unknown Identifier', () => {
    const opt = new Optimizer({})
    assert.equal(opt.resolveExpr(N.Identifier('unknown', 0)), undefined)
  })

  test('resolves BinaryExpr when both sides are known', () => {
    const opt = new Optimizer({ a: 10, b: 5 })
    const expr = N.BinaryExpr('+', N.Identifier('a', 0), N.Identifier('b', 0), 0)
    assert.equal(opt.resolveExpr(expr), 15)
  })

  test('resolves non-computed MemberExpr', () => {
    const opt = new Optimizer({ config: { env: 'prod' } })
    const expr = N.MemberExpr(N.Identifier('config', 0), N.Identifier('env', 0), false, 0)
    assert.equal(opt.resolveExpr(expr), 'prod')
  })

  test('resolves NullCoalesce - left defined', () => {
    const opt = new Optimizer({ val: 'ok' })
    const expr = N.NullCoalesce(N.Identifier('val', 0), N.Literal('default', 'default', 0), 0)
    assert.equal(opt.resolveExpr(expr), 'ok')
  })

  test('resolves NullCoalesce - left undefined, returns right', () => {
    const opt = new Optimizer({})
    const expr = N.NullCoalesce(N.Identifier('missing', 0), N.Literal('fallback', 'fallback', 0), 0)
    assert.equal(opt.resolveExpr(expr), 'fallback')
  })
})
