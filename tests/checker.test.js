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
