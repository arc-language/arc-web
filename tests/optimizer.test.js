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

  test('resolves computed MemberExpr with bindings', () => {
    const opt = new Optimizer({ arr: ['a', 'b', 'c'] })
    const expr = N.MemberExpr(N.Identifier('arr', 0), N.Literal(1, '1', 0), true, 0)
    assert.equal(opt.resolveExpr(expr), 'b')
  })

  test('resolves UnaryExpr ! (logical NOT)', () => {
    const opt = new Optimizer({ flag: true })
    const expr = N.UnaryExpr('!', N.Identifier('flag', 0), 0)
    assert.equal(opt.resolveExpr(expr), false)
  })

  test('resolves UnaryExpr - (numeric negation)', () => {
    const opt = new Optimizer({ n: 5 })
    const expr = N.UnaryExpr('-', N.Identifier('n', 0), 0)
    assert.equal(opt.resolveExpr(expr), -5)
  })

  test('resolves TemplateLiteral with mixed literal and dynamic parts', () => {
    const opt = new Optimizer({ name: 'World' })
    const tpl = N.TemplateLiteral([
      N.Literal('Hello ', '"Hello "', 0),
      N.Identifier('name', 0),
      N.Literal('!', '"!"', 0),
    ], 0)
    assert.equal(opt.resolveExpr(tpl), 'Hello World!')
  })
})

describe('Optimizer - for loop with index var unrolling', () => {
  test('for with index name binds both item and index in body', () => {
    const { Optimizer } = require('../src/optimizer')
    const forNode = N.ForNode('i', 'item', N.Identifier('items', 0), [
      N.InterpolationNode(N.Identifier('i', 0), 0),
      N.InterpolationNode(N.Identifier('item', 0), 0),
    ], 0)
    const opt = new Optimizer({ items: ['a', 'b'] })
    const result = opt.optimizeForWithBindings(forNode, {})
    // Should produce 4 nodes (2 items × 2 interpolations each), all TextNodes
    assert.equal(result.length, 4)
    assert.equal(result[0].type, 'TextNode')
    assert.equal(result[0].value, '0')  // index
    assert.equal(result[1].value, 'a')  // item
    assert.equal(result[2].value, '1')
    assert.equal(result[3].value, 'b')
  })

  test('for loop over non-array collection returns unchanged ForNode', () => {
    const { Optimizer } = require('../src/optimizer')
    const forNode = N.ForNode(null, 'item', N.Literal(42, '42', 0), [], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeForWithBindings(forNode, {})
    assert.equal(result.length, 1)
    assert.equal(result[0].type, 'ForNode')
  })
})

describe('Optimizer - substituteExpr', () => {
  test('substituteExpr returns a Literal when expr resolves', () => {
    const { Optimizer } = require('../src/optimizer')
    const opt = new Optimizer({ x: 42 })
    const result = opt.substituteExpr(N.Identifier('x', 0), { x: 42 })
    assert.equal(result.type, 'Literal')
    assert.equal(result.value, 42)
  })

  test('substituteExpr returns the original expr when it cannot be resolved', () => {
    const { Optimizer } = require('../src/optimizer')
    const opt = new Optimizer({})
    const id = N.Identifier('unknown', 0)
    const result = opt.substituteExpr(id, {})
    assert.equal(result.type, 'Identifier')
    assert.equal(result.name, 'unknown')
  })

  test('substituteExpr passes primitives through unchanged', () => {
    const { Optimizer } = require('../src/optimizer')
    const opt = new Optimizer({})
    assert.equal(opt.substituteExpr('hello', {}), 'hello')
    assert.equal(opt.substituteExpr(42, {}), 42)
    assert.equal(opt.substituteExpr(null, {}), null)
  })
})

describe('Optimizer - applyOp arithmetic', () => {
  test('applyOp covers all arithmetic operators', () => {
    const { Optimizer } = require('../src/optimizer')
    const opt = new Optimizer({})
    assert.equal(opt.applyOp('+', 1, 2), 3)
    assert.equal(opt.applyOp('-', 5, 2), 3)
    assert.equal(opt.applyOp('*', 3, 4), 12)
    assert.equal(opt.applyOp('/', 10, 2), 5)
    assert.equal(opt.applyOp('%', 10, 3), 1)
  })

  test('applyOp returns undefined for unknown operator', () => {
    const { Optimizer } = require('../src/optimizer')
    const opt = new Optimizer({})
    assert.equal(opt.applyOp('^^', 1, 2), undefined)
  })
})

describe('Optimizer - Element attr substitution via bindings', () => {
  test('Element with attrs gets attrs substituted from bindings', () => {
    const { Optimizer } = require('../src/optimizer')
    // Element with attrs that reference a bound variable
    const elem = N.Element('div', [], null,
      { 'data-id': N.Identifier('idVal', 0) },
      [], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(elem, { idVal: 'abc' })
    assert.equal(result.length, 1)
    assert.equal(result[0].attrs['data-id'].type, 'Literal')
    assert.equal(result[0].attrs['data-id'].value, 'abc')
  })

  test('Optimizer.optimizeUnless with unknown condition leaves UnlessNode', () => {
    const { Optimizer } = require('../src/optimizer')
    const node = N.UnlessNode(N.Identifier('unknown', 0), [N.TextNode('x', 0)], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeUnless(node)
    assert.equal(result[0].type, 'UnlessNode')
  })

  test('Optimizer with nested ForNode via bindings dispatches recursively', () => {
    const { Optimizer } = require('../src/optimizer')
    // Outer for unrolls items; inner for inside body uses the unrolled binding
    const innerFor = N.ForNode(null, 'sub', N.Identifier('item', 0), [
      N.InterpolationNode(N.Identifier('sub', 0), 0)
    ], 0)
    const outerFor = N.ForNode(null, 'item', N.Identifier('items', 0), [innerFor], 0)
    const opt = new Optimizer({ items: [[1, 2], [3]] })
    const result = opt.optimizeForWithBindings(outerFor, {})
    // After full unrolling: 2+1 = 3 TextNodes
    assert.equal(result.length, 3)
  })

  test('Optimizer.optimizeForWithBindings with non-array static collection', () => {
    const { Optimizer } = require('../src/optimizer')
    const forNode = N.ForNode(null, 'item', N.Identifier('notArr', 0), [], 0)
    const opt = new Optimizer({ notArr: 'string-not-array' })
    const result = opt.optimizeForWithBindings(forNode, {})
    // Non-array → returns [original node]
    assert.equal(result.length, 1)
  })
})

describe('Optimizer - InterpolationNode substitution inside Element', () => {
  test('Element with InterpolationNode child gets folded by optimizer when value is known', () => {
    const { Optimizer } = require('../src/optimizer')
    const elem = N.Element('span', [], null, {}, [
      N.InterpolationNode(N.Identifier('name', 0), 0)
    ], 0)
    const opt = new Optimizer({ name: 'Alice' })
    const result = opt.optimizeNodeWithBindings(elem, { name: 'Alice' })
    assert.equal(result.length, 1)
    assert.equal(result[0].children[0].type, 'TextNode')
    assert.equal(result[0].children[0].value, 'Alice')
  })

  test('TemplateLiteral with all known parts collapses to TextNode', () => {
    const { Optimizer } = require('../src/optimizer')
    const tpl = N.TemplateLiteral([
      N.Literal('Hello ', '"Hello "', 0),
      N.Identifier('name', 0),
      N.Literal('!', '"!"', 0),
    ], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(tpl, { name: 'World' })
    assert.equal(result.length, 1)
    assert.equal(result[0].type, 'TextNode')
    assert.equal(result[0].value, 'Hello World!')
  })

  test('TemplateLiteral with some unknown parts stays as TemplateLiteral', () => {
    const { Optimizer } = require('../src/optimizer')
    const tpl = N.TemplateLiteral([
      N.Literal('Hi ', '"Hi "', 0),
      N.Identifier('unknown', 0),
    ], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(tpl, {})
    assert.equal(result[0].type, 'TemplateLiteral')
  })

  test('InterpolationNode with unknown expression stays as InterpolationNode', () => {
    const { Optimizer } = require('../src/optimizer')
    const node = N.InterpolationNode(N.Identifier('unknown', 0), 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(node, {})
    assert.equal(result[0].type, 'InterpolationNode')
  })

  test('IfNode with truthy bound condition keeps consequent', () => {
    const { Optimizer } = require('../src/optimizer')
    const ifn = N.IfNode(N.Identifier('flag', 0),
      [N.TextNode('yes', 0)], [N.TextNode('no', 0)], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(ifn, { flag: true })
    assert.equal(result[0].value, 'yes')
  })

  test('IfNode with falsy bound condition emits alternate', () => {
    const { Optimizer } = require('../src/optimizer')
    const ifn = N.IfNode(N.Identifier('flag', 0),
      [N.TextNode('yes', 0)], [N.TextNode('no', 0)], 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(ifn, { flag: false })
    assert.equal(result[0].value, 'no')
  })

  test('IfNode with unknown condition stays as IfNode', () => {
    const { Optimizer } = require('../src/optimizer')
    const ifn = N.IfNode(N.Identifier('unknown', 0),
      [N.TextNode('yes', 0)], null, 0)
    const opt = new Optimizer({})
    const result = opt.optimizeNodeWithBindings(ifn, {})
    assert.equal(result[0].type, 'IfNode')
  })
})

// ── substituteExpr with non-primitive value ───────────────────────────────────

describe('Optimizer.substituteExpr — non-primitive guard (line 287)', () => {
  const { Optimizer } = require('../src/optimizer')
  const N = require('../src/ast')

  test('substituteExpr with array binding returns original expr (not inlined)', () => {
    const opt = new Optimizer({})
    const expr = N.Identifier('items', 0)
    // If the resolved value is an array, substituteExpr must not inline it
    // (would corrupt downstream emitters via String([object]) = "[object Object]")
    const result = opt.substituteExpr(expr, { items: [1, 2, 3] })
    assert.equal(result, expr, 'should return original expr for array value')
  })

  test('substituteExpr with object binding returns original expr', () => {
    const opt = new Optimizer({})
    const expr = N.Identifier('cfg', 0)
    const result = opt.substituteExpr(expr, { cfg: { key: 'val' } })
    assert.equal(result, expr, 'should return original expr for object value')
  })

  test('substituteExpr with string value inlines as Literal', () => {
    const opt = new Optimizer({})
    const expr = N.Identifier('name', 0)
    const result = opt.substituteExpr(expr, { name: 'Alice' })
    assert.equal(result.type, 'Literal', 'string value should be inlined as Literal')
    assert.equal(result.value, 'Alice')
  })

  test('substituteExpr with null value inlines as Literal', () => {
    const opt = new Optimizer({})
    const expr = N.Identifier('nothing', 0)
    const result = opt.substituteExpr(expr, { nothing: null })
    assert.equal(result.type, 'Literal', 'null value should be inlined as Literal')
    assert.equal(result.value, null)
  })
})
