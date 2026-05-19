'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')

// Helper: lex + parse source and return the Program node
function parse(source) {
  const lexer = new Lexer(source)
  const tokens = lexer.tokenize()
  const parser = new Parser(tokens)
  return parser.parse()
}

// Helper: return the first declaration in the program
function firstDecl(source) {
  return parse(source).declarations[0]
}

// Helper: return all declarations
function decls(source) {
  return parse(source).declarations
}

// ── Page declarations ──────────────────────────────────────────────────────────

describe('Parser - PageDecl', () => {
  test('parses a bare page declaration', () => {
    const node = firstDecl('page "Home"')
    assert.equal(node.type, 'PageDecl')
    assert.equal(node.title.value, 'Home')
  })

  test('page with no title', () => {
    const node = firstDecl('page')
    assert.equal(node.type, 'PageDecl')
    assert.equal(node.title, null)
  })

  test('page body contains element children', () => {
    const src = 'page "Title"\n  heading "Hello"'
    const node = firstDecl(src)
    assert.equal(node.type, 'PageDecl')
    assert.ok(node.body.length > 0)
    assert.equal(node.body[0].type, 'Element')
    assert.equal(node.body[0].tag, 'heading')
  })

  test('page body with text element', () => {
    const src = 'page "Blog"\n  text "Welcome"'
    const node = firstDecl(src)
    assert.equal(node.body[0].tag, 'text')
  })
})

// ── Widget declarations ────────────────────────────────────────────────────────

describe('Parser - WidgetDecl', () => {
  test('parses a basic widget declaration', () => {
    const src = 'widget Counter\n  text "hello"'
    const node = firstDecl(src)
    assert.equal(node.type, 'WidgetDecl')
    assert.equal(node.name, 'Counter')
  })

  test('widget with params', () => {
    const src = 'widget Button(label)\n  text "x"'
    const node = firstDecl(src)
    assert.equal(node.type, 'WidgetDecl')
    assert.equal(node.name, 'Button')
    assert.equal(node.params.length, 1)
    assert.equal(node.params[0].name, 'label')
  })

  test('widget body contains children', () => {
    const src = 'widget Card\n  heading "Title"'
    const node = firstDecl(src)
    assert.equal(node.body.length, 1)
    assert.equal(node.body[0].tag, 'heading')
  })
})

// ── @state declarations ────────────────────────────────────────────────────────

describe('Parser - StateDecl', () => {
  test('parses @state let with initializer', () => {
    const node = firstDecl('@state let count = 0')
    assert.equal(node.type, 'StateDecl')
    assert.equal(node.name, 'count')
    assert.equal(node.init.type, 'Literal')
    assert.equal(node.init.value, 0)
  })

  test('parses @state let string initializer', () => {
    const node = firstDecl('@state let name = "Alice"')
    assert.equal(node.type, 'StateDecl')
    assert.equal(node.name, 'name')
    assert.equal(node.init.value, 'Alice')
  })

  test('parses @state const with type annotation', () => {
    const node = firstDecl('@state const items: String[] = []')
    assert.equal(node.type, 'StateDecl')
    assert.equal(node.name, 'items')
    assert.equal(node.typeAnnotation.type, 'ArrayType')
  })

  test('@state arcTag is "reactive"', () => {
    const node = firstDecl('@state let x = 1')
    assert.equal(node.arcTag, 'reactive')
  })
})

// ── @build declarations ────────────────────────────────────────────────────────

describe('Parser - BuildDecl', () => {
  test('parses @build const with function call', () => {
    const node = firstDecl('@build const posts = fetch(url)')
    assert.equal(node.type, 'BuildDecl')
    assert.equal(node.name, 'posts')
    assert.equal(node.init.type, 'CallExpr')
  })

  test('parses @build let with await', () => {
    const node = firstDecl('@build let data = await fetch(url)')
    assert.equal(node.type, 'BuildDecl')
    assert.equal(node.name, 'data')
    assert.equal(node.init.type, 'AwaitExpr')
  })

  test('@build arcTag is "build"', () => {
    const node = firstDecl('@build const x = 1')
    assert.equal(node.arcTag, 'build')
  })
})

// ── @live declarations ─────────────────────────────────────────────────────────

describe('Parser - LiveDecl', () => {
  test('parses @live let declaration', () => {
    const node = firstDecl('@live let user = getUser()')
    assert.equal(node.type, 'LiveDecl')
    assert.equal(node.name, 'user')
    assert.equal(node.init.type, 'CallExpr')
  })

  test('@live arcTag is "live"', () => {
    const node = firstDecl('@live let x = fn() { }')
    assert.equal(node.arcTag, 'live')
  })
})

// ── @computed declarations ─────────────────────────────────────────────────────

describe('Parser - ComputedDecl', () => {
  test('parses @computed let with expression', () => {
    const node = firstDecl('@computed let doubled = count * 2')
    assert.equal(node.type, 'ComputedDecl')
    assert.equal(node.name, 'doubled')
    assert.equal(node.init.type, 'BinaryExpr')
    assert.equal(node.init.op, '*')
  })

  test('@computed arcTag is "computed"', () => {
    const node = firstDecl('@computed let x = 1')
    assert.equal(node.arcTag, 'computed')
  })

  test('@computed with type annotation', () => {
    const node = firstDecl('@computed let total: Number = a + b')
    assert.equal(node.type, 'ComputedDecl')
    assert.equal(node.name, 'total')
    assert.equal(node.typeAnnotation.name, 'Number')
  })
})

// ── @realtime declarations ─────────────────────────────────────────────────────

describe('Parser - RealtimeDecl', () => {
  test('parses @realtime let with channel call', () => {
    const node = firstDecl('@realtime let feed = channel("posts")')
    assert.equal(node.type, 'RealtimeDecl')
    assert.equal(node.name, 'feed')
    assert.equal(node.channel.type, 'CallExpr')
  })

  test('@realtime arcTag is "realtime"', () => {
    const node = firstDecl('@realtime let x = channel("x")')
    assert.equal(node.arcTag, 'realtime')
  })
})

// ── @server function declarations ─────────────────────────────────────────────

describe('Parser - ServerFn', () => {
  test('parses @server fn with block body', () => {
    const src = '@server fn getData(id) { return id }'
    const node = firstDecl(src)
    assert.equal(node.type, 'ServerFn')
    assert.equal(node.name, 'getData')
    assert.equal(node.params.length, 1)
    assert.equal(node.params[0].name, 'id')
  })

  test('@server fn with return type annotation', () => {
    const src = '@server fn getUser(id) -> String { return id }'
    const node = firstDecl(src)
    assert.equal(node.type, 'ServerFn')
    assert.equal(node.name, 'getUser')
    assert.equal(node.returnType.name, 'String')
  })

  test('@server arcTag is "server"', () => {
    const src = '@server fn doThing() { return none }'
    const node = firstDecl(src)
    assert.equal(node.arcTag, 'server')
  })
})

// ── Template elements ──────────────────────────────────────────────────────────

describe('Parser - Template Elements', () => {
  test('parses heading element with inline text', () => {
    const src = 'page "T"\n  heading "Welcome"'
    const page = firstDecl(src)
    const el = page.body[0]
    assert.equal(el.type, 'Element')
    assert.equal(el.tag, 'heading')
    assert.equal(el.children[0].type, 'TextNode')
    assert.equal(el.children[0].value, 'Welcome')
  })

  test('parses button element', () => {
    const src = 'page "T"\n  button "Click me"'
    const page = firstDecl(src)
    const el = page.body[0]
    assert.equal(el.tag, 'button')
  })

  test('parses card with nested children', () => {
    const src = 'page "T"\n  card\n    heading "Title"\n    text "Body"'
    const page = firstDecl(src)
    const card = page.body[0]
    assert.equal(card.tag, 'card')
    assert.equal(card.children.length, 2)
    assert.equal(card.children[0].tag, 'heading')
    assert.equal(card.children[1].tag, 'text')
  })

  test('parses row with children', () => {
    const src = 'page "T"\n  row\n    text "left"\n    text "right"'
    const page = firstDecl(src)
    const row = page.body[0]
    assert.equal(row.tag, 'row')
    assert.equal(row.children.length, 2)
  })

  test('element has empty classes and no id by default', () => {
    const src = 'page "T"\n  text "hello"'
    const page = firstDecl(src)
    const el = page.body[0]
    assert.deepEqual(el.classes, [])
    assert.equal(el.id, null)
  })

  test('element with .class suffix', () => {
    const src = 'page "T"\n  text.highlight "hello"'
    const page = firstDecl(src)
    const el = page.body[0]
    assert.equal(el.tag, 'text')
    assert.deepEqual(el.classes, ['highlight'])
  })

  test('element with #id suffix', () => {
    const src = 'page "T"\n  text#main "hello"'
    const page = firstDecl(src)
    const el = page.body[0]
    assert.equal(el.id, 'main')
  })
})

// ── Event handlers and bind ────────────────────────────────────────────────────

describe('Parser - Event handlers and bind attributes', () => {
  test('button with on:click attribute', () => {
    const src = 'page "T"\n  button on:click={count + 1} "Add"'
    const page = firstDecl(src)
    const btn = page.body[0]
    assert.equal(btn.tag, 'button')
    assert.ok('on:click' in btn.attrs)
    assert.equal(btn.attrs['on:click'].type, 'BinaryExpr')
  })

  test('input with bind:value attribute', () => {
    const src = 'page "T"\n  input bind:value={name}'
    const page = firstDecl(src)
    const input = page.body[0]
    assert.equal(input.tag, 'input')
    assert.ok('bind:value' in input.attrs)
    assert.equal(input.attrs['bind:value'].type, 'Identifier')
    assert.equal(input.attrs['bind:value'].name, 'name')
  })
})

// ── For loops in templates ─────────────────────────────────────────────────────

describe('Parser - Template For loops', () => {
  test('parses for loop in template', () => {
    const src = 'page "T"\n  for item in items\n    text "x"'
    const page = firstDecl(src)
    const forNode = page.body[0]
    assert.equal(forNode.type, 'ForNode')
    assert.equal(forNode.itemName, 'item')
    assert.equal(forNode.collection.name, 'items')
    assert.equal(forNode.indexName, null)
  })

  test('for loop with index', () => {
    const src = 'page "T"\n  for i, item in items\n    text "x"'
    const page = firstDecl(src)
    const forNode = page.body[0]
    assert.equal(forNode.type, 'ForNode')
    assert.equal(forNode.indexName, 'i')
    assert.equal(forNode.itemName, 'item')
  })
})

// ── If/unless conditionals ─────────────────────────────────────────────────────

describe('Parser - Template If/Unless', () => {
  test('parses if node in template', () => {
    const src = 'page "T"\n  if show\n    text "visible"'
    const page = firstDecl(src)
    const ifNode = page.body[0]
    assert.equal(ifNode.type, 'IfNode')
    assert.equal(ifNode.condition.name, 'show')
  })

  test('parses unless node in template', () => {
    const src = 'page "T"\n  unless hidden\n    text "shown"'
    const page = firstDecl(src)
    const unlessNode = page.body[0]
    assert.equal(unlessNode.type, 'UnlessNode')
    assert.equal(unlessNode.condition.name, 'hidden')
  })

  test('if node has consequent children', () => {
    const src = 'page "T"\n  if ready\n    heading "Go"'
    const page = firstDecl(src)
    const ifNode = page.body[0]
    assert.equal(ifNode.consequent.length, 1)
    assert.equal(ifNode.consequent[0].tag, 'heading')
  })
})

// ── Type annotations ───────────────────────────────────────────────────────────

describe('Parser - Type annotations', () => {
  test('parses simple type annotation', () => {
    const node = firstDecl('@state let name: String = "x"')
    assert.equal(node.typeAnnotation.type, 'TypeAnnotation')
    assert.equal(node.typeAnnotation.name, 'String')
  })

  test('parses Number type annotation', () => {
    const node = firstDecl('@state let count: Number = 0')
    assert.equal(node.typeAnnotation.name, 'Number')
  })

  test('parses none as type annotation', () => {
    const node = firstDecl('@state let x: none = none')
    assert.equal(node.typeAnnotation.type, 'TypeAnnotation')
    assert.equal(node.typeAnnotation.name, 'none')
  })

  test('parses array type annotation', () => {
    const node = firstDecl('@state let tags: String[] = []')
    assert.equal(node.typeAnnotation.type, 'ArrayType')
    assert.equal(node.typeAnnotation.elementType.name, 'String')
  })

  test('parses object type annotation', () => {
    const node = firstDecl('@state let user: { name: String } = {}')
    assert.equal(node.typeAnnotation.type, 'ObjectType')
    assert.ok('name' in node.typeAnnotation.fields)
    assert.equal(node.typeAnnotation.fields.name.name, 'String')
  })

  test('parses nullable type annotation', () => {
    const node = firstDecl('@state let user: String? = none')
    assert.equal(node.typeAnnotation.type, 'TypeAnnotation')
    assert.equal(node.typeAnnotation.nullable, true)
  })
})

// ── TemplateLiteral interpolation ──────────────────────────────────────────────

describe('Parser - TemplateLiteral interpolation', () => {
  test('text element with pure interpolation in string produces TemplateLiteral', () => {
    const src = 'page "T"\n  text "Count: {count}"'
    const page = firstDecl(src)
    const el = page.body[0]
    // The child is the inline content node — TemplateLiteral or TextNode
    const content = el.children[0]
    assert.equal(content.type, 'TemplateLiteral')
    // First part is the "Count: " string
    assert.equal(content.parts[0].type, 'Literal')
    assert.equal(content.parts[0].value, 'Count: ')
    // Second part is the identifier
    assert.equal(content.parts[1].type, 'Identifier')
    assert.equal(content.parts[1].name, 'count')
  })

  test('interpolation with member access', () => {
    const src = 'page "T"\n  text "Hello {user.name}"'
    const page = firstDecl(src)
    const el = page.body[0]
    const content = el.children[0]
    assert.equal(content.type, 'TemplateLiteral')
    // The identifier part should be a MemberExpr
    const exprPart = content.parts.find(p => p.type === 'MemberExpr')
    assert.ok(exprPart, 'should have a MemberExpr part')
  })
})

// ── Hoisting @state from template body ────────────────────────────────────────

describe('Parser - hoisting', () => {
  test('@state inside page body is hoisted to program declarations', () => {
    const src = 'page "T"\n  @state let count = 0\n  text "x"'
    const program = parse(src)
    // hoistedDecls are prepended, so the first decl in the program should be StateDecl
    const stateDecl = program.declarations.find(d => d.type === 'StateDecl')
    assert.ok(stateDecl, 'StateDecl should be hoisted to program declarations')
    assert.equal(stateDecl.name, 'count')
  })
})

// ── VarDecl (const / let) ──────────────────────────────────────────────────────

describe('Parser - VarDecl', () => {
  test('parses const declaration', () => {
    const node = firstDecl('const x = 42')
    assert.equal(node.type, 'VarDecl')
    assert.equal(node.kind, 'const')
    assert.equal(node.name, 'x')
    assert.equal(node.init.value, 42)
  })

  test('parses let declaration with string', () => {
    const node = firstDecl('let msg = "hello"')
    assert.equal(node.type, 'VarDecl')
    assert.equal(node.kind, 'let')
    assert.equal(node.name, 'msg')
    assert.equal(node.init.value, 'hello')
  })

  test('parses let without initializer', () => {
    const node = firstDecl('let x')
    assert.equal(node.type, 'VarDecl')
    assert.equal(node.init, null)
  })
})

// ── FnDecl ─────────────────────────────────────────────────────────────────────

describe('Parser - FnDecl', () => {
  test('parses fn declaration with block body', () => {
    const node = firstDecl('fn add(a, b) { return a }')
    assert.equal(node.type, 'FnDecl')
    assert.equal(node.name, 'add')
    assert.equal(node.params.length, 2)
    assert.equal(node.params[0].name, 'a')
    assert.equal(node.params[1].name, 'b')
  })

  test('parses fn with expression body (=>)', () => {
    const node = firstDecl('fn double(x) => x * 2')
    assert.equal(node.type, 'FnDecl')
    assert.equal(node.name, 'double')
    assert.equal(node.body.type, 'BinaryExpr')
  })

  test('parses fn with return type annotation', () => {
    const node = firstDecl('fn greet(name) -> String { return name }')
    assert.equal(node.returnType.name, 'String')
  })
})

// ── Expressions ────────────────────────────────────────────────────────────────

describe('Parser - Expressions', () => {
  test('parses binary arithmetic expression', () => {
    const node = firstDecl('const x = a + b')
    assert.equal(node.init.type, 'BinaryExpr')
    assert.equal(node.init.op, '+')
  })

  test('parses comparison expression', () => {
    const node = firstDecl('const x = a == b')
    assert.equal(node.init.type, 'BinaryExpr')
    assert.equal(node.init.op, '==')
  })

  test('parses logical AND', () => {
    const node = firstDecl('const x = a && b')
    assert.equal(node.init.type, 'LogicalExpr')
    assert.equal(node.init.op, '&&')
  })

  test('parses logical OR', () => {
    const node = firstDecl('const x = a || b')
    assert.equal(node.init.type, 'LogicalExpr')
    assert.equal(node.init.op, '||')
  })

  test('parses function call expression', () => {
    const node = firstDecl('const x = foo(1, 2)')
    assert.equal(node.init.type, 'CallExpr')
    assert.equal(node.init.args.length, 2)
  })

  test('parses member expression', () => {
    const node = firstDecl('const x = obj.prop')
    assert.equal(node.init.type, 'MemberExpr')
    assert.equal(node.init.property.name, 'prop')
  })

  test('parses array literal', () => {
    const node = firstDecl('const x = [1, 2, 3]')
    assert.equal(node.init.type, 'ArrayLiteral')
    assert.equal(node.init.elements.length, 3)
  })

  test('parses object literal', () => {
    const node = firstDecl('const x = { a: 1, b: 2 }')
    assert.equal(node.init.type, 'ObjectLiteral')
    assert.equal(node.init.properties.length, 2)
  })

  test('parses arrow function with parens', () => {
    const node = firstDecl('const f = (x) => x + 1')
    assert.equal(node.init.type, 'ArrowFn')
    assert.equal(node.init.params[0].name, 'x')
  })

  test('parses ternary expression', () => {
    const node = firstDecl('const x = a ? b : c')
    assert.equal(node.init.type, 'TernaryExpr')
  })

  test('parses await expression', () => {
    const node = firstDecl('const x = await fetch(url)')
    assert.equal(node.init.type, 'AwaitExpr')
    assert.equal(node.init.argument.type, 'CallExpr')
  })

  test('parses unary negation', () => {
    const node = firstDecl('const x = -5')
    assert.equal(node.init.type, 'UnaryExpr')
    assert.equal(node.init.op, '-')
  })
})

// ── ImportDecl ─────────────────────────────────────────────────────────────────

describe('Parser - ImportDecl', () => {
  test('parses named import', () => {
    const node = firstDecl('import { foo } from "bar"')
    assert.equal(node.type, 'ImportDecl')
    assert.equal(node.source, 'bar')
    assert.equal(node.names.length, 1)
    assert.equal(node.names[0].imported, 'foo')
  })

  test('parses default import', () => {
    const node = firstDecl('import MyLib from "mylib"')
    assert.equal(node.type, 'ImportDecl')
    assert.equal(node.defaultName, 'MyLib')
    assert.equal(node.source, 'mylib')
  })
})
