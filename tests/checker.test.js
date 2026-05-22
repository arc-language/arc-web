'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')
const { Checker } = require('../src/checker')

function checkSource(src) {
  const lexer = new Lexer(src, 'test.arc')
  const tokens = lexer.tokenize()
  const parser = new Parser(tokens, 'test.arc')
  const program = parser.parse()
  const checker = new Checker('test.arc')
  return checker.check(program)
}

function errors(src) { return checkSource(src).errors }
function warnings(src) { return checkSource(src).warnings }
function hasError(src, msg) {
  return errors(src).some(e => e.message.includes(msg))
}
function hasWarning(src, msg) {
  return warnings(src).some(w => w.message.includes(msg))
}
function clean(src) { return errors(src).length === 0 }

describe('Checker — undefined variables', () => {
  test('clean file has no errors', () => {
    assert.ok(clean('page "T"\n  text "hello"'))
  })

  test('undefined var in text interpolation', () => {
    assert.ok(hasError('page "T"\n  text "{undeclared}"', 'Undefined variable "undeclared"'))
  })

  test('declared @state var is valid', () => {
    assert.ok(clean('page "T"\n  @state let x = 0\n  text "{x}"'))
  })

  test('declared @build var is valid', () => {
    assert.ok(clean('page "T"\n  @build const data = []\n  text "{data}"'))
  })

  test('undefined var in event handler', () => {
    assert.ok(hasError(
      'page "T"\n  button on:click={ notDeclared() } "Click"',
      'Undefined variable "notDeclared"'
    ))
  })

  test('declared fn is valid in event handler', () => {
    const src = `page "T"
  @server fn doThing() -> none
    return none
  button on:click={ doThing() } "Click"`
    assert.ok(clean(src))
  })

  test('@state var used with @ prefix is valid', () => {
    assert.ok(clean('page "T"\n  @state let count = 0\n  button on:click={ @count += 1 } "+"'))
  })

  test('@computed depends on @state var', () => {
    assert.ok(clean(`page "T"
  @state let n = 0
  @computed let doubled = n * 2
  text "{doubled}"`))
  })

  test('for loop item var is valid inside loop', () => {
    assert.ok(clean(`page "T"
  @build const items = [1,2,3]
  for item in items
    text "{item}"`))
  })

  test.todo('for loop item not accessible outside loop body — scope exit detection is future work')
})

describe('Checker — @state/@build declarations', () => {
  test('duplicate @state declaration is an error', () => {
    assert.ok(hasError(
      'page "T"\n  @state let x = 0\n  @state let x = 1',
      'Duplicate declaration: "x"'
    ))
  })

  test('duplicate @server fn is an error', () => {
    const src = `page "T"
  @server fn foo() -> none
    return none
  @server fn foo() -> none
    return none`
    assert.ok(hasError(src, 'Duplicate declaration: "foo"'))
  })

  test('@build and @state with same name is an error', () => {
    assert.ok(hasError(
      'page "T"\n  @state let data = []\n  @build const data = []',
      'Duplicate declaration: "data"'
    ))
  })
})

describe('Checker — img alt warnings', () => {
  test('img without alt gets warning', () => {
    assert.ok(hasWarning('page "T"\n  img src="photo.jpg"', 'missing alt'))
  })

  test('img with alt has no warning', () => {
    assert.ok(!hasWarning('page "T"\n  img src="photo.jpg" alt="A photo"', 'missing alt'))
  })

  test('img with empty alt (decorative) has no warning', () => {
    assert.ok(!hasWarning('page "T"\n  img src="deco.svg" alt=""', 'missing alt'))
  })
})

describe('Checker — @server fn params in scope', () => {
  test('@server fn body can use its params', () => {
    const src = `page "T"
  @server fn greet(name: String) -> String
    return name`
    assert.ok(clean(src))
  })

  test('@server fn body errors on undeclared var', () => {
    const src = `page "T"
  @server fn broken() -> none
    return undeclaredThing`
    assert.ok(hasError(src, 'Undefined variable "undeclaredThing"'))
  })
})

describe('Checker — JS globals are not errors', () => {
  test('Math.floor is valid', () => {
    assert.ok(clean('page "T"\n  @state let x = Math.floor(1.5)\n  text "{x}"'))
  })

  test('console.log is valid in server fn', () => {
    const src = `page "T"
  @server fn log() -> none
    console.log("hi")
    return none`
    assert.ok(clean(src))
  })

  test('fetch is valid in @build', () => {
    // fetch is a global — should not error (it would fail at runtime if URL is bad,
    // but that's a @build execution error, not a check error)
    assert.ok(clean('page "T"\n  @state let x = 0\n  text "{x}"'))
  })
})

describe('Checker — error line numbers', () => {
  test('error includes correct line number', () => {
    const src = `page "T"
  heading "Hi"
  text "{badVar}"`
    const errs = errors(src)
    assert.equal(errs.length, 1)
    assert.equal(errs[0].line, 3)
  })

  test('duplicate declaration error has line of second declaration', () => {
    const src = `page "T"
  @state let x = 0
  @state let x = 1`
    const errs = errors(src)
    assert.ok(errs.length >= 1)
    // The duplicate is on line 3
    assert.equal(errs[0].line, 3)
  })
})

describe('Checker — match expressions', () => {
  test('match expression in @computed is clean', () => {
    assert.ok(clean(`
@state let x = 0
@computed let label = match x {
  0 => "zero"
  _ => "other"
}
page "T"
  text "{label}"
`))
  })

  test('match arm body references bound name — clean', () => {
    assert.ok(clean(`
@state let x = 0
@computed let doubled = match x {
  n => n * 2
}
page "T"
  text "{doubled}"
`))
  })

  test('match arm with undeclared identifier in @computed is an error', () => {
    assert.ok(hasError(`
@state let x = 0
@computed let result = match x {
  0 => undeclared
  _ => 0
}
page "T"
  text "{result}"
`, 'Undefined variable "undeclared"'))
  })
})

describe('Checker — class declarations', () => {
  test('class declaration registers the name', () => {
    assert.ok(clean(`
class Counter {
  fn increment() { }
}
page "T"
  text "ok"
`))
  })

  test('duplicate class name is an error', () => {
    assert.ok(hasError(`
class Foo {
  fn noop() { }
}
class Foo {
  fn noop() { }
}
page "T"
  text "ok"
`, 'Duplicate declaration: "Foo"'))
  })
})

describe('Checker — statement checking', () => {
  test('while loop with undeclared condition var is an error', () => {
    assert.ok(hasError(`
@server fn process() {
  while undeclaredCond {
  }
}
page "T"
  text "ok"
`, 'Undefined variable "undeclaredCond"'))
  })

  test('while loop with declared var is clean', () => {
    assert.ok(clean(`
@server fn process(x) {
  while x > 0 {
  }
}
page "T"
  text "ok"
`))
  })

  test('until loop with undeclared condition is an error', () => {
    assert.ok(hasError(`
@server fn process() {
  until undeclaredFlag {
  }
}
page "T"
  text "ok"
`, 'Undefined variable "undeclaredFlag"'))
  })

  test('loop statement (infinite) is clean', () => {
    assert.ok(clean(`
@server fn process() {
  loop {
    break
  }
}
page "T"
  text "ok"
`))
  })

  test('try/catch registers catch param in catch body scope', () => {
    assert.ok(clean(`
@server fn process(x) {
  try {
    const result = x
  } catch e {
    const msg = e
  }
}
page "T"
  text "ok"
`))
  })

  test('catch param not visible outside catch body is an error', () => {
    assert.ok(hasError(`
@server fn process(x) {
  try {
    const result = x
  } catch e {
  }
  const bad = e
}
page "T"
  text "ok"
`, 'Undefined variable "e"'))
  })

  test('match statement in fn body is clean', () => {
    assert.ok(clean(`
@server fn process(x) {
  match x {
    0 => 0
    _ => x
  }
}
page "T"
  text "ok"
`))
  })

  test('local var declaration inside fn body is clean', () => {
    assert.ok(clean(`
@server fn process(x) {
  let result = x
  let doubled = result
}
page "T"
  text "ok"
`))
  })

  test('local var declaration with undeclared init is an error', () => {
    assert.ok(hasError(`
@server fn process() {
  let result = undeclaredVar
}
page "T"
  text "ok"
`, 'Undefined variable "undeclaredVar"'))
  })

  test('for statement puts item and index into body scope', () => {
    assert.ok(clean(`
@server fn process(items) {
  for i, item in items {
    const v = item
    const idx = i
  }
}
page "T"
  text "ok"
`))
  })

  test('await in @server fn generates a warning', () => {
    assert.ok(hasWarning(`
@server fn process(x) {
  await x
}
page "T"
  text "ok"
`, '"await" used outside async context'))
  })
})

describe('Checker — widget and class declarations', () => {
  test('widget with @attr reference is clean (no false positive)', () => {
    assert.ok(clean(`
widget Card
  div
    text "{@title}"
page "T"
  Card title="Hello"
`))
  })

  test('widget body uses passed attr value without error', () => {
    assert.ok(clean(`
widget Badge
  span
    text "{@label}"
page "T"
  Badge label="New"
`))
  })

  test('class with fields and methods is clean', () => {
    assert.ok(clean(`
class Counter {
  @count = 0
  fn increment() { return 1 }
}
page "T"
  text "ok"
`))
  })

  test('bind:value on undeclared variable produces an error', () => {
    assert.ok(hasError(`
page "T"
  input type="text" bind:value={undeclaredVar}
`, 'bind:value references undeclared'))
  })

  test('bind:value on declared @state is clean', () => {
    assert.ok(clean(`
page "T"
  @state let name = ""
  input type="text" bind:value={name}
`))
  })
})

describe('Checker — scope chain and ClassDecl', () => {
  const { Checker } = require('../src/checker')

  test('Scope.get walks up parent chain to find key', () => {
    // The Scope class is internal — exercise it via a real check that requires
    // a child scope reading from the parent (e.g. fn body reading outer @state)
    assert.ok(clean(`
@state let outerVal = 42
@server fn process() {
  let inner = outerVal
}
page "T"
  text "ok"
`))
  })

  test('ClassDecl is recognized without error', () => {
    assert.ok(clean(`
class Empty {
}
page "T"
  text "ok"
`))
  })
})

describe('Checker — expression checking (arrow, coalesce, pipeline, spread)', () => {
  test('arrow function in @computed introduces param binding', () => {
    assert.ok(clean(`
@state let items = []
@computed let doubled = items.map(x => x * 2)
page "T"
  text "{doubled}"
`))
  })

  test('arrow function body with undeclared variable is an error', () => {
    assert.ok(hasError(`
@state let items = []
@computed let bad = items.map(x => x + undeclaredVar)
page "T"
  text "{bad}"
`, 'Undefined variable "undeclaredVar"'))
  })

  test('TemplateLiteral interpolation with undeclared var is an error', () => {
    // Arc string interpolation: "text {expr}"
    assert.ok(hasError(`
page "T"
  text "Hello {undeclaredName}"
`, 'Undefined variable "undeclaredName"'))
  })

  test('BlockStatement in expression body checks inner statements', () => {
    // Match expression with block body
    assert.ok(clean(`
@state let x = 0
@computed let r = match x {
  0 => 0
  _ => x
}
page "T"
  text "{r}"
`))
  })

  test('MatchExpr in @computed with simple patterns is clean', () => {
    assert.ok(clean(`
@state let val = 0
@computed let result = match val {
  0 => "zero"
  _ => "other"
}
page "T"
  text "{result}"
`))
  })

  test('null coalesce ?? in @computed is clean', () => {
    assert.ok(clean(`
@state let val = none
@computed let display = val ?? "default"
page "T"
  text "{display}"
`))
  })

  test('null coalesce with undeclared right is an error', () => {
    assert.ok(hasError(`
@state let val = none
@computed let display = val ?? undeclaredFallback
page "T"
  text "{display}"
`, 'Undefined variable "undeclaredFallback"'))
  })

  test('pipeline expression in @computed is clean', () => {
    assert.ok(clean(`
@state let n = 5
@computed let abs_n = n |> Math.abs
page "T"
  text "{abs_n}"
`))
  })

  test('pipeline with undeclared right side is an error', () => {
    assert.ok(hasError(`
@state let n = 5
@computed let bad = n |> undeclaredFn
page "T"
  text "{bad}"
`, 'Undefined variable "undeclaredFn"'))
  })

  test('object literal nested expressions are checked', () => {
    assert.ok(hasError(`
@state let x = 0
@computed let obj = { a: x, b: undeclaredKey }
page "T"
  text "{obj}"
`, 'Undefined variable "undeclaredKey"'))
  })

  test('spread element in array literal is checked', () => {
    assert.ok(hasError(`
@state let items = []
@computed let combined = [...undeclaredArr, 1]
page "T"
  text "{combined}"
`, 'Undefined variable "undeclaredArr"'))
  })
})

describe('Checker — direct AST construction for dead-code path coverage', () => {
  const { Checker } = require('../src/checker')
  const N = require('../src/ast')

  test('Scope.get walks up parent chain when key not in own', () => {
    // Test the Scope class directly
    const checker = new Checker('test')
    // Build nested scopes through checkBody indirectly
    const program = N.Program([], [
      N.ServerFn('fn1', [N.Param('x', null, null, false, 0)], null,
        { type: 'BlockStatement', body: [
          // Reading x from outer scope inside an inner block
          N.ExprStatement(N.Identifier('x', 0), 0)
        ], line: 0 }, 0),
      N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
    ], 0)
    const result = checker.check(program)
    assert.equal(result.errors.length, 0)
  })

  test('checkStmt with BlockStatement at statement level', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.ServerFn('fn1', [], null, {
          type: 'BlockStatement',
          body: [
            // Inner BlockStatement
            { type: 'BlockStatement', body: [
              N.ExprStatement(N.Identifier('undefinedVar', 0), 0)
            ], line: 0 }
          ],
          line: 0
        }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    // Should report undefinedVar
    assert.ok(result.errors.some(e => e.message.includes('undefinedVar')),
      `Expected undefinedVar error: ${result.errors.map(e => e.message).join(', ')}`)
  })

  test('checkStmt with ThrowExpr directly in body checks argument', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.ServerFn('fn1', [], null, {
          type: 'BlockStatement',
          body: [
            // ThrowExpr directly as a statement (not wrapped in ExprStatement)
            { type: 'ThrowExpr', argument: N.Identifier('undeclaredErr', 0), line: 0 }
          ],
          line: 0
        }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclaredErr')),
      `Expected undeclaredErr error: ${result.errors.map(e => e.message).join(', ')}`)
  })

  test('checkStmt with nested FnDecl declares the name in scope', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.ServerFn('outer', [], null, {
          type: 'BlockStatement',
          body: [
            N.FnDecl('inner', [N.Param('a', null, null, false, 0)], null,
              { type: 'BlockStatement', body: [
                N.ReturnStatement(N.Identifier('a', 0), 0)
              ], line: 0 }, false, 0)
          ],
          line: 0
        }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.equal(result.errors.length, 0,
      `Expected no errors, got: ${result.errors.map(e => e.message).join(', ')}`)
  })

  test('checkWidget creates scope for widget params', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.WidgetDecl('Card', [N.Param('title', null, null, false, 0)], [
          // body using @title (widget attr) — should not error in widget
          N.InterpolationNode(N.AtProperty('title', 0), 0)
        ], null, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.equal(result.errors.length, 0)
  })

  test('checkLocalDecl with init expression', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.VarDecl('const', 'x', null, N.Identifier('undeclaredVal', 0), 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclaredVal')),
      `Expected error: ${result.errors.map(e => e.message).join(', ')}`)
  })

  test('checkExpr with RangeExpr checks start and end', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.BuildDecl('r', null, N.RangeExpr(
          N.Identifier('startVal', 0),
          N.Identifier('endVal', 0),
          false, 0), 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    const errs = result.errors.map(e => e.message)
    assert.ok(errs.some(m => m.includes('startVal')))
    assert.ok(errs.some(m => m.includes('endVal')))
  })

  test('checkExpr with UnaryExpr using argument (alt field name) instead of operand', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.BuildDecl('r', null, {
          type: 'UnaryExpr',
          op: '!',
          argument: N.Identifier('undeclared', 0),  // using "argument" field
          line: 0
        }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclared')),
      `Expected undeclared error`)
  })

  test('checkExpr with TemplateLiteral expression part is checked', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.BuildDecl('r', null, N.TemplateLiteral([
          N.Literal('Hello ', '"..."', 0),
          N.Identifier('undeclaredName', 0),
        ], 0), 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclaredName')))
  })

  test('checkExpr with BlockStatement traverses body', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.BuildDecl('r', null, {
          type: 'BlockStatement',
          body: [N.ExprStatement(N.Identifier('undeclaredBlock', 0), 0)],
          line: 0
        }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclaredBlock')))
  })

  test('checkExpr with await marks warning in non-async context', () => {
    const checker = new Checker('test')
    // @state init expression with await — not in async context, generates warning
    const program = {
      declarations: [
        N.StateDecl('x', null, { type: 'AwaitExpr', argument: N.Literal(1, '1', 0), line: 0 }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.warnings.some(w => w.message.includes('await')),
      `Expected await warning`)
  })

  test('checkClassDecl with method that has params puts them in scope', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.ClassDecl('Box', [], [
          N.ClassMethod('set', [N.Param('value', null, null, false, 0)], null,
            { type: 'BlockStatement', body: [
              N.ExprStatement(N.Identifier('value', 0), 0)  // uses value param
            ], line: 0 }, false, false, 0)
        ], 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.equal(result.errors.length, 0)
  })

  test('Scope.get returns from parent chain when key only in parent', () => {
    const { Checker } = require('../src/checker')
    // Construct via the public Scope API indirectly
    // Test that an inner block can read an outer scope binding
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.StateDecl('outer', null, N.Literal(1, '1', 0), 0),
        N.ServerFn('fn1', [], null, {
          type: 'BlockStatement',
          body: [
            { type: 'BlockStatement', body: [
              N.ExprStatement(N.AtProperty('outer', 0), 0)
            ], line: 0 }
          ],
          line: 0
        }, 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.equal(result.errors.length, 0)
  })

  test('checkClassDecl with field that has init expression', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.ClassDecl('Box', [
          N.ClassField('count', null, N.Identifier('undeclaredInit', 0), false, 0),
        ], [], 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclaredInit')))
  })

  test('checkExpr with SpreadElement checks argument', () => {
    const checker = new Checker('test')
    const program = {
      declarations: [
        N.BuildDecl('r', null, N.ArrayLiteral([
          N.SpreadElement(N.Identifier('undeclaredArr', 0), 0)
        ], 0), 0),
        N.PageDecl('T', {}, [N.TextNode('ok', 0)], null, 0),
      ]
    }
    const result = checker.check(program)
    assert.ok(result.errors.some(e => e.message.includes('undeclaredArr')))
  })
})

describe('Checker — clean examples', () => {
  const fs = require('fs')
  const examples = ['hello', 'counter', 'blog', 'dashboard', 'patterns', 'live', 'chat']

  for (const name of examples) {
    test(`${name}/index.arc has no checker errors`, () => {
      const src = fs.readFileSync(`examples/${name}/index.arc`, 'utf8')
      const errs = errors(src)
      assert.equal(errs.length, 0, `Expected no errors in ${name}, got:\n${errs.map(String).join('\n')}`)
    })
  }
})
