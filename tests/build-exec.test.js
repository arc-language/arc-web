'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// Use /var/tmp instead of TMPDIR - /tmp has overlay fs issues in this environment
const TMPDIR = '/var/tmp'

const { BuildExecutor } = require('../src/build-exec')
const N = require('../src/ast')

// ── Helpers ───────────────────────────────────────────────────────────────────

function exec() {
  return new BuildExecutor(TMPDIR)
}

async function evalExpr(expr, locals = {}, ctx = {}) {
  const e = exec()
  Object.assign(e.context, ctx)
  return e.evalExpr(expr, locals)
}

// Shorthand AST builders for common patterns
const lit = (v) => N.Literal(v, String(v), 0)
const ident = (name) => N.Identifier(name, 0)

// ── execute() ─────────────────────────────────────────────────────────────────

describe('BuildExecutor.execute()', () => {
  test('populates context from BuildDecl nodes', async () => {
    const program = N.Program([], [
      N.BuildDecl('greeting', null, lit('hello'), 1),
      N.BuildDecl('count', null, lit(42), 2),
    ], 0)
    const e = exec()
    const ctx = await e.execute(program)
    assert.equal(ctx.greeting, 'hello')
    assert.equal(ctx.count, 42)
  })

  test('ignores non-BuildDecl declarations', async () => {
    const program = N.Program([], [
      N.StateDecl('x', null, lit(1), 1),
      N.BuildDecl('y', null, lit(99), 2),
    ], 0)
    const e = exec()
    const ctx = await e.execute(program)
    assert.ok(!('x' in ctx))
    assert.equal(ctx.y, 99)
  })

  test('records error and sets null on failure', async () => {
    const program = N.Program([], [
      N.BuildDecl('bad', null, ident('nope'), 1),
    ], 0)
    const e = exec()
    const ctx = await e.execute(program)
    assert.equal(ctx.bad, null)
    assert.equal(e.errors.length, 1)
    assert.ok(e.errors[0].includes('@build bad'))
  })

  test('later declarations can reference earlier ones', async () => {
    const program = N.Program([], [
      N.BuildDecl('a', null, lit(10), 1),
      N.BuildDecl('b', null, N.BinaryExpr('+', ident('a'), lit(5), 2), 2),
    ], 0)
    const e = exec()
    const ctx = await e.execute(program)
    assert.equal(ctx.b, 15)
  })
})

// ── evalExpr: node types ───────────────────────────────────────────────────────

describe('evalExpr - Literal', () => {
  test('string literal', async () => {
    assert.equal(await evalExpr(lit('arc')), 'arc')
  })

  test('number literal', async () => {
    assert.equal(await evalExpr(lit(3.14)), 3.14)
  })

  test('boolean literal', async () => {
    assert.equal(await evalExpr(lit(true)), true)
  })

  test('null literal', async () => {
    assert.equal(await evalExpr(lit(null)), null)
  })
})

describe('evalExpr - Identifier', () => {
  test('resolves from locals', async () => {
    assert.equal(await evalExpr(ident('x'), { x: 42 }), 42)
  })

  test('resolves from context when not in locals', async () => {
    assert.equal(await evalExpr(ident('env'), {}, { env: 'prod' }), 'prod')
  })

  test('locals take priority over context', async () => {
    assert.equal(await evalExpr(ident('v'), { v: 'local' }, { v: 'ctx' }), 'local')
  })

  test('throws on undefined identifier', async () => {
    await assert.rejects(
      () => evalExpr(ident('missing')),
      /Undefined identifier: missing/
    )
  })
})

describe('evalExpr - ArrayLiteral', () => {
  test('evaluates empty array', async () => {
    assert.deepEqual(await evalExpr(N.ArrayLiteral([], 0)), [])
  })

  test('evaluates array of literals', async () => {
    const expr = N.ArrayLiteral([lit(1), lit(2), lit(3)], 0)
    assert.deepEqual(await evalExpr(expr), [1, 2, 3])
  })

  test('evaluates nested arrays', async () => {
    const expr = N.ArrayLiteral([N.ArrayLiteral([lit('a')], 0), lit('b')], 0)
    assert.deepEqual(await evalExpr(expr), [['a'], 'b'])
  })
})

describe('evalExpr - ObjectLiteral', () => {
  test('evaluates empty object', async () => {
    assert.deepEqual(await evalExpr(N.ObjectLiteral([], 0)), {})
  })

  test('evaluates object with properties', async () => {
    const expr = N.ObjectLiteral([
      N.ObjectProp('name', lit('Alice'), false, 0),
      N.ObjectProp('age', lit(30), false, 0),
    ], 0)
    assert.deepEqual(await evalExpr(expr), { name: 'Alice', age: 30 })
  })
})

describe('evalExpr - MemberExpr', () => {
  test('non-computed member access', async () => {
    const obj = N.ObjectLiteral([N.ObjectProp('x', lit(7), false, 0)], 0)
    const expr = N.MemberExpr(obj, N.Identifier('x', 0), false, 0)
    assert.equal(await evalExpr(expr), 7)
  })

  test('computed member access', async () => {
    const arr = N.ArrayLiteral([lit('a'), lit('b'), lit('c')], 0)
    const expr = N.MemberExpr(arr, lit(1), true, 0)
    assert.equal(await evalExpr(expr), 'b')
  })

  test('returns undefined for null object', async () => {
    const expr = N.MemberExpr(lit(null), N.Identifier('x', 0), false, 0)
    assert.equal(await evalExpr(expr), undefined)
  })
})

describe('evalExpr - BinaryExpr', () => {
  test('addition', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('+', lit(3), lit(4), 0)), 7)
  })

  test('subtraction', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('-', lit(10), lit(3), 0)), 7)
  })

  test('multiplication', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('*', lit(6), lit(7), 0)), 42)
  })

  test('division', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('/', lit(10), lit(2), 0)), 5)
  })

  test('equality ==', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('==', lit(5), lit(5), 0)), true)
    assert.equal(await evalExpr(N.BinaryExpr('==', lit(5), lit(6), 0)), false)
  })

  test('inequality !=', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('!=', lit(1), lit(2), 0)), true)
  })

  test('less than <', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('<', lit(3), lit(5), 0)), true)
  })

  test('greater than >', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('>', lit(5), lit(3), 0)), true)
  })

  test('logical &&', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('&&', lit(true), lit(true), 0)), true)
    assert.equal(await evalExpr(N.BinaryExpr('&&', lit(true), lit(false), 0)), false)
  })

  test('logical ||', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('||', lit(false), lit(true), 0)), true)
    assert.equal(await evalExpr(N.BinaryExpr('||', lit(false), lit(false), 0)), false)
  })

  test('string concatenation via +', async () => {
    assert.equal(await evalExpr(N.BinaryExpr('+', lit('hello '), lit('world'), 0)), 'hello world')
  })
})

describe('evalExpr - TernaryExpr', () => {
  test('returns consequent when condition is truthy', async () => {
    const expr = N.TernaryExpr(lit(true), lit('yes'), lit('no'), 0)
    assert.equal(await evalExpr(expr), 'yes')
  })

  test('returns alternate when condition is falsy', async () => {
    const expr = N.TernaryExpr(lit(false), lit('yes'), lit('no'), 0)
    assert.equal(await evalExpr(expr), 'no')
  })

  test('evaluates condition expression', async () => {
    const cond = N.BinaryExpr('>', lit(5), lit(3), 0)
    const expr = N.TernaryExpr(cond, lit('big'), lit('small'), 0)
    assert.equal(await evalExpr(expr), 'big')
  })
})

describe('evalExpr - NullCoalesce', () => {
  test('returns left value when not null/undefined', async () => {
    const expr = N.NullCoalesce(lit('value'), lit('default'), 0)
    assert.equal(await evalExpr(expr), 'value')
  })

  test('returns right value when left is null', async () => {
    const expr = N.NullCoalesce(lit(null), lit('default'), 0)
    assert.equal(await evalExpr(expr), 'default')
  })

  test('returns right value when left is undefined identifier', async () => {
    const e = exec()
    // Force undefined by using context where key exists but value is undefined
    e.context.u = undefined
    const expr = N.NullCoalesce(ident('u'), lit('fallback'), 0)
    const result = await e.evalExpr(expr)
    assert.equal(result, 'fallback')
  })

  test('returns 0 and false (not null/undefined)', async () => {
    assert.equal(await evalExpr(N.NullCoalesce(lit(0), lit(99), 0)), 0)
    assert.equal(await evalExpr(N.NullCoalesce(lit(false), lit(99), 0)), false)
  })
})

describe('evalExpr - ArrowFn + CallExpr', () => {
  test('arrow fn with single param body expression', async () => {
    const fn = N.ArrowFn(
      [N.Param('x', null, null, false, 0)],
      N.BinaryExpr('*', ident('x'), lit(2), 0),
      false, 0
    )
    const fnValue = await evalExpr(fn)
    assert.equal(typeof fnValue, 'function')
    assert.equal(await fnValue(5), 10)
  })

  test('calls arrow function via CallExpr', async () => {
    const e = exec()
    const fn = N.ArrowFn(
      [N.Param('n', null, null, false, 0)],
      N.BinaryExpr('+', ident('n'), lit(1), 0),
      false, 0
    )
    const call = N.CallExpr(fn, [lit(41)], 0)
    assert.equal(await e.evalExpr(call), 42)
  })

  test('arrow fn captures outer locals', async () => {
    const e = exec()
    // fn = (y) => y + base  where base is from outer locals
    const fn = N.ArrowFn(
      [N.Param('y', null, null, false, 0)],
      N.BinaryExpr('+', ident('y'), ident('base'), 0),
      false, 0
    )
    const fnValue = await e.evalExpr(fn, { base: 100 })
    assert.equal(await fnValue(5), 105)
  })

  test('throws when calling non-function', async () => {
    const e = exec()
    e.context.notFn = 42
    const call = N.CallExpr(ident('notFn'), [], 0)
    await assert.rejects(() => e.evalExpr(call), /Cannot call/)
  })
})

// ── Array methods ─────────────────────────────────────────────────────────────

describe('Array methods', () => {
  // Helper: create a CallExpr calling method on a known array
  async function callMethod(arr, method, args = []) {
    const e = exec()
    e.context.arr = arr
    const callee = N.MemberExpr(ident('arr'), N.Identifier(method, 0), false, 0)
    const argNodes = args.map(a => (a !== null && typeof a === 'object' && a.type) ? a : lit(a))
    const call = N.CallExpr(callee, argNodes, 0)
    return e.evalExpr(call)
  }

  test('map doubles each element', async () => {
    const e = exec()
    e.context.nums = [1, 2, 3]
    const fn = N.ArrowFn(
      [N.Param('x', null, null, false, 0)],
      N.BinaryExpr('*', ident('x'), lit(2), 0),
      false, 0
    )
    const call = N.CallExpr(
      N.MemberExpr(ident('nums'), N.Identifier('map', 0), false, 0),
      [fn], 0
    )
    assert.deepEqual(await e.evalExpr(call), [2, 4, 6])
  })

  test('filter keeps even numbers', async () => {
    const e = exec()
    e.context.nums = [1, 2, 3, 4, 5]
    const fn = N.ArrowFn(
      [N.Param('x', null, null, false, 0)],
      N.BinaryExpr('==', N.BinaryExpr('%', ident('x'), lit(2), 0), lit(0), 0),
      false, 0
    )
    const call = N.CallExpr(
      N.MemberExpr(ident('nums'), N.Identifier('filter', 0), false, 0),
      [fn], 0
    )
    assert.deepEqual(await e.evalExpr(call), [2, 4])
  })

  test('sort returns sorted array', async () => {
    assert.deepEqual(await callMethod([3, 1, 2], 'sort'), [1, 2, 3])
  })

  test('slice returns subarray', async () => {
    assert.deepEqual(await callMethod([1, 2, 3, 4], 'slice', [1, 3]), [2, 3])
  })

  test('join concatenates with separator', async () => {
    assert.equal(await callMethod(['a', 'b', 'c'], 'join', ['-']), 'a-b-c')
  })

  test('find returns first matching element', async () => {
    const e = exec()
    e.context.nums = [10, 20, 30]
    const fn = N.ArrowFn(
      [N.Param('x', null, null, false, 0)],
      N.BinaryExpr('>', ident('x'), lit(15), 0),
      false, 0
    )
    const call = N.CallExpr(
      N.MemberExpr(ident('nums'), N.Identifier('find', 0), false, 0),
      [fn], 0
    )
    assert.equal(await e.evalExpr(call), 20)
  })

  test('includes checks membership', async () => {
    assert.equal(await callMethod(['a', 'b', 'c'], 'includes', ['b']), true)
    assert.equal(await callMethod(['a', 'b', 'c'], 'includes', ['z']), false)
  })

  test('reverse reverses array without mutating original', async () => {
    const original = [1, 2, 3]
    assert.deepEqual(await callMethod(original, 'reverse'), [3, 2, 1])
    assert.deepEqual(original, [1, 2, 3]) // original unchanged
  })
})

// ── String methods ────────────────────────────────────────────────────────────

describe('String methods', () => {
  async function callStrMethod(str, method, args = []) {
    const e = exec()
    e.context.s = str
    const callee = N.MemberExpr(ident('s'), N.Identifier(method, 0), false, 0)
    const argNodes = args.map(a => lit(a))
    const call = N.CallExpr(callee, argNodes, 0)
    return e.evalExpr(call)
  }

  test('split splits on separator', async () => {
    assert.deepEqual(await callStrMethod('a,b,c', 'split', [',']), ['a', 'b', 'c'])
  })

  test('trim removes whitespace', async () => {
    assert.equal(await callStrMethod('  hello  ', 'trim'), 'hello')
  })

  test('toLowerCase converts case', async () => {
    assert.equal(await callStrMethod('HELLO', 'toLowerCase'), 'hello')
  })

  test('includes checks substring', async () => {
    assert.equal(await callStrMethod('hello world', 'includes', ['world']), true)
    assert.equal(await callStrMethod('hello world', 'includes', ['xyz']), false)
  })

  test('startsWith checks prefix', async () => {
    assert.equal(await callStrMethod('hello', 'startsWith', ['hel']), true)
    assert.equal(await callStrMethod('hello', 'startsWith', ['bye']), false)
  })
})

// ── readFile() ────────────────────────────────────────────────────────────────

describe('readFile()', () => {
  test('reads a plain text file', async () => {
    const tmp = path.join(TMPDIR, `arc-test-${Date.now()}.txt`)
    fs.writeFileSync(tmp, 'hello from file', 'utf8')
    try {
      const e = new BuildExecutor(TMPDIR)
      const result = await e.doReadFile(tmp)
      assert.equal(result, 'hello from file')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  test('reads and parses a JSON file', async () => {
    const tmp = path.join(TMPDIR, `arc-test-${Date.now()}.json`)
    fs.writeFileSync(tmp, JSON.stringify({ key: 'val', num: 42 }), 'utf8')
    try {
      const e = new BuildExecutor(TMPDIR)
      const result = await e.doReadFile(tmp)
      assert.deepEqual(result, { key: 'val', num: 42 })
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  test('readFile() via CallExpr with absolute path', async () => {
    const tmp = path.join(TMPDIR, `arc-test-${Date.now()}.txt`)
    fs.writeFileSync(tmp, 'via callexpr', 'utf8')
    try {
      const e = new BuildExecutor(TMPDIR)
      const call = N.CallExpr(N.Identifier('readFile', 0), [lit(tmp)], 0)
      const result = await e.evalExpr(call)
      assert.equal(result, 'via callexpr')
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})

// ── Error cases ───────────────────────────────────────────────────────────────

describe('Error cases', () => {
  test('undefined identifier throws', async () => {
    await assert.rejects(
      () => evalExpr(ident('doesNotExist')),
      /Undefined identifier: doesNotExist/
    )
  })

  test('unsupported expr type throws', async () => {
    const unsupported = { type: 'WeirdCustomNode', line: 0 }
    await assert.rejects(
      () => evalExpr(unsupported),
      /Cannot evaluate WeirdCustomNode at build time/
    )
  })

  test('Array.flatMap doubles and flattens', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    const N2 = require('../src/ast')
    const fn = N2.ArrowFn(['x'], N2.ArrayLiteral([
      N2.Identifier('x', 0),
      N2.BinaryExpr('*', N2.Identifier('x', 0), lit(2), 0),
    ], 0), 0)
    const call = N2.CallExpr(
      N2.MemberExpr(ident('arr'), N2.Identifier('flatMap', 0), false, 0),
      [fn], 0
    )
    const result = await e.evalExpr(call)
    assert.deepEqual(result, [1, 2, 2, 4, 3, 6])
  })

  test('Array.forEach calls callback for each element', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    e.context.total = 0
    const seen = []
    const N2 = require('../src/ast')
    // Use a JS function captured into context for verifying iteration
    const recordFn = (x) => { seen.push(x) }
    e.context.record = recordFn
    const callRecord = N2.ArrowFn(['x'],
      N2.CallExpr(ident('record'), [N2.Identifier('x', 0)], 0), 0)
    const call = N2.CallExpr(
      N2.MemberExpr(ident('arr'), N2.Identifier('forEach', 0), false, 0),
      [callRecord], 0
    )
    await e.evalExpr(call)
    assert.deepEqual(seen, [1, 2, 3])
  })

  test('Array.some returns true when any element matches', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3, 4]
    const N2 = require('../src/ast')
    const isEven = N2.ArrowFn(['x'],
      N2.BinaryExpr('==',
        N2.BinaryExpr('%', N2.Identifier('x', 0), lit(2), 0),
        lit(0), 0), 0)
    const call = N2.CallExpr(
      N2.MemberExpr(ident('arr'), N2.Identifier('some', 0), false, 0),
      [isEven], 0
    )
    assert.equal(await e.evalExpr(call), true)
  })

  test('Array.every returns true when all elements match', async () => {
    const e = exec()
    e.context.arr = [2, 4, 6]
    const N2 = require('../src/ast')
    const isEven = N2.ArrowFn(['x'],
      N2.BinaryExpr('==',
        N2.BinaryExpr('%', N2.Identifier('x', 0), lit(2), 0),
        lit(0), 0), 0)
    const call = N2.CallExpr(
      N2.MemberExpr(ident('arr'), N2.Identifier('every', 0), false, 0),
      [isEven], 0
    )
    assert.equal(await e.evalExpr(call), true)
  })

  test('reduce sums array', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    const N2 = require('../src/ast')
    // reduce([1,2,3], fn(acc,x) => acc+x, 0) should return 6
    const addFn = N2.ArrowFn(['acc', 'x'],
      N2.BinaryExpr('+', N2.Identifier('acc', 0), N2.Identifier('x', 0), 0), 0)
    const call = N2.CallExpr(
      N2.MemberExpr(ident('arr'), N2.Identifier('reduce', 0), false, 0),
      [addFn, lit(0)], 0
    )
    const result = await e.evalExpr(call)
    assert.equal(result, 6)
  })

  test('unsupported array method throws', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    const call = N.CallExpr(
      N.MemberExpr(ident('arr'), N.Identifier('fill', 0), false, 0),
      [lit(0)], 0
    )
    await assert.rejects(() => e.evalExpr(call), /Array\.fill not supported/)
  })
})

// ── evalCall — fetch, readFile, object methods ────────────────────────────────

describe('BuildExecutor — TemplateLiteral, ObjectLiteral guards', () => {
  test('TemplateLiteral evaluates mixed literal and expression parts', async () => {
    const e = exec()
    e.context.name = 'World'
    const tpl = {
      type: 'TemplateLiteral',
      parts: [
        N.Literal('Hello, ', '"Hello, "', 0),
        N.Identifier('name', 0),
        N.Literal('!', '"!"', 0),
      ],
      line: 0
    }
    const result = await e.evalExpr(tpl)
    assert.equal(result, 'Hello, World!')
  })

  test('ObjectLiteral with __proto__ key throws', async () => {
    const e = exec()
    const obj = {
      type: 'ObjectLiteral',
      properties: [{ key: '__proto__', value: lit('evil') }],
      line: 0
    }
    await assert.rejects(() => e.evalExpr(obj), /forbidden key/)
  })

  test('ObjectLiteral with constructor key throws', async () => {
    const e = exec()
    const obj = {
      type: 'ObjectLiteral',
      properties: [{ key: 'constructor', value: lit('evil') }],
      line: 0
    }
    await assert.rejects(() => e.evalExpr(obj), /forbidden key/)
  })
})

describe('BuildExecutor — UnaryExpr, AwaitExpr, PipelineExpr', () => {
  test('UnaryExpr "!" negates truthy values', async () => {
    const e = exec()
    const expr = { type: 'UnaryExpr', op: '!', operand: lit(1), line: 0 }
    assert.equal(await e.evalExpr(expr), false)
  })

  test('UnaryExpr "!" negates falsy values', async () => {
    const e = exec()
    const expr = { type: 'UnaryExpr', op: '!', operand: lit(0), line: 0 }
    assert.equal(await e.evalExpr(expr), true)
  })

  test('UnaryExpr "-" negates numeric values', async () => {
    const e = exec()
    const expr = { type: 'UnaryExpr', op: '-', operand: lit(5), line: 0 }
    assert.equal(await e.evalExpr(expr), -5)
  })

  test('AwaitExpr passes through to argument value', async () => {
    const e = exec()
    const expr = { type: 'AwaitExpr', argument: lit(42), line: 0 }
    assert.equal(await e.evalExpr(expr), 42)
  })

  test('PipelineExpr applies function to left value', async () => {
    const e = exec()
    e.context.double = (x) => x * 2
    const expr = {
      type: 'PipelineExpr',
      left: lit(5),
      right: ident('double'),
      line: 0
    }
    assert.equal(await e.evalExpr(expr), 10)
  })

  test('PipelineExpr throws when right is not a function', async () => {
    const e = exec()
    e.context.notAFn = 42
    const expr = {
      type: 'PipelineExpr',
      left: lit(5),
      right: ident('notAFn'),
      line: 0
    }
    await assert.rejects(() => e.evalExpr(expr), /must be a function/)
  })
})

describe('BuildExecutor.evalCall — fetch and readFile', () => {
  test('fetch() with no args throws', async () => {
    const e = exec()
    const call = N.CallExpr(N.Identifier('fetch', 0), [], 0)
    await assert.rejects(() => e.evalExpr(call), /requires a URL argument/)
  })

  test('readFile() with no args throws', async () => {
    const e = exec()
    const call = N.CallExpr(N.Identifier('readFile', 0), [], 0)
    await assert.rejects(() => e.evalExpr(call), /requires a path argument/)
  })

  test('calling unsupported method on plain object throws', async () => {
    const e = exec()
    e.context.obj = { val: 42 }
    const call = N.CallExpr(
      N.MemberExpr(ident('obj'), N.Identifier('unsupportedMethod', 0), false, 0),
      [], 0
    )
    await assert.rejects(() => e.evalExpr(call), /not allowed at build time/)
  })

  test('calling allowed method toString on object works', async () => {
    const e = exec()
    e.context.obj = { val: 42 }
    const call = N.CallExpr(
      N.MemberExpr(ident('obj'), N.Identifier('toString', 0), false, 0),
      [], 0
    )
    const result = await e.evalExpr(call)
    assert.equal(result, '[object Object]')
  })
})

// ── doFetch — SSRF protection ─────────────────────────────────────────────────

// doFetch is async — use assert.rejects
describe('BuildExecutor.doFetch - SSRF protection', () => {
  test('rejects file: protocol', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('file:///etc/passwd'), /only http\/https allowed/)
  })

  test('rejects ftp: protocol', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('ftp://example.com/data'), /only http\/https allowed/)
  })

  test('rejects invalid URL', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('not-a-url'), /invalid URL/)
  })

  test('rejects localhost', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://localhost/api'), /internal addresses not allowed/)
  })

  test('rejects 127.0.0.1', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://127.0.0.1/api'), /internal addresses not allowed/)
  })

  test('rejects 192.168.x.x private range', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://192.168.1.100/api'), /internal addresses not allowed/)
  })

  test('rejects 10.x.x.x private range', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://10.0.0.1/api'), /internal addresses not allowed/)
  })

  test('rejects 172.16.x.x private range', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://172.16.0.1/api'), /internal addresses not allowed/)
  })

  test('rejects GCP metadata endpoint', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://metadata.google.internal/'), /internal addresses not allowed/)
  })

  test('rejects IPv6 loopback [::1]', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://[::1]/api'), /internal addresses not allowed/)
  })

  test('rejects IPv6 unspecified address [::]', async () => {
    // Linux routes :: to loopback, so it's an SSRF-equivalent target to ::1
    const e = exec()
    await assert.rejects(() => e.doFetch('http://[::]/api'), /internal addresses not allowed/)
  })

  test('rejects IPv6 unspecified address with zero blocks [0:0:0:0:0:0:0:0]', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://[0:0:0:0:0:0:0:0]/api'), /internal addresses not allowed/)
  })

  test('rejects IPv6 ULA range [fc00::1]', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://[fc00::1]/api'), /internal addresses not allowed/)
  })

  test('rejects IPv6 link-local [fe80::1]', async () => {
    const e = exec()
    await assert.rejects(() => e.doFetch('http://[fe80::1]/api'), /internal addresses not allowed/)
  })
})

// ── doReadFile — security ─────────────────────────────────────────────────────

describe('BuildExecutor.doReadFile — security', () => {
  test('rejects .env files', async () => {
    const e = new BuildExecutor(TMPDIR)
    await assert.rejects(() => e.doReadFile('.env'), /sensitive file/)
  })

  test('rejects .env.production', async () => {
    const e = new BuildExecutor(TMPDIR)
    await assert.rejects(() => e.doReadFile('.env.production'), /sensitive file/)
  })

  test('rejects .pem files', async () => {
    const e = new BuildExecutor(TMPDIR)
    await assert.rejects(() => e.doReadFile('server.pem'), /sensitive file/)
  })

  test('rejects path escaping project root via ../..', async () => {
    const e = new BuildExecutor(TMPDIR)
    await assert.rejects(() => e.doReadFile('../../etc/passwd'), /escapes project root/)
  })

  test('reads a text file within project root', async () => {
    const e = new BuildExecutor(TMPDIR)
    const tmpFile = path.join(TMPDIR, 'testproof-valid.txt')
    fs.writeFileSync(tmpFile, 'hello world')
    try {
      const result = await e.doReadFile(tmpFile)
      assert.equal(result, 'hello world')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('parses JSON files automatically', async () => {
    const e = new BuildExecutor(TMPDIR)
    const tmpFile = path.join(TMPDIR, 'testproof-data.json')
    fs.writeFileSync(tmpFile, '{"name":"test","count":42}')
    try {
      const result = await e.doReadFile(tmpFile)
      assert.deepEqual(result, { name: 'test', count: 42 })
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('rejects invalid JSON in .json files', async () => {
    const e = new BuildExecutor(TMPDIR)
    const tmpFile = path.join(TMPDIR, 'testproof-bad.json')
    fs.writeFileSync(tmpFile, 'not valid json {{')
    try {
      await assert.rejects(() => e.doReadFile(tmpFile), /invalid JSON/)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})

// ── Array methods — additional coverage ───────────────────────────────────────

describe('Array methods — uncovered branches', () => {
  function exec() { return new BuildExecutor('.') }
  const N2 = require('../src/ast')

  async function callMethod(arr, method, args = []) {
    const e = exec()
    e.context.arr = arr
    const callee = N2.MemberExpr(N2.Identifier('arr', 0), N2.Identifier(method, 0), false, 0)
    const argNodes = args.map(a => typeof a === 'function'
      ? N2.ArrowFn(
          [N2.Param('x', null, null, false, 0)],
          N2.Literal(a, 0),
          false, 0
        )
      : N2.Literal(a, 0)
    )
    const call = N2.CallExpr(callee, argNodes, 0)
    return e.evalExpr(call)
  }

  test('Array.sort: with sync comparator throws (executor always wraps arrow fns async)', async () => {
    const e = exec()
    e.context.nums = [3, 1, 2]
    // Build executor wraps ALL ArrowFn nodes in async wrappers, so even a
    // non-async comparator returns a Promise during the probe check and is
    // rejected as "must be synchronous".
    const cmpFn = N2.ArrowFn(
      [N2.Param('a', null, null, false, 0), N2.Param('b', null, null, false, 0)],
      N2.BinaryExpr('-', N2.Identifier('a', 0), N2.Identifier('b', 0), 0),
      false, 0
    )
    const call = N2.CallExpr(
      N2.MemberExpr(N2.Identifier('nums', 0), N2.Identifier('sort', 0), false, 0),
      [cmpFn], 0
    )
    await assert.rejects(() => e.evalExpr(call), /comparator must be synchronous/)
  })

  test('Array.sort: with async comparator throws', async () => {
    const e = exec()
    e.context.nums = [3, 1, 2]
    // Build an arrow fn that returns a promise-like object
    const asyncCmpFn = N2.ArrowFn(
      [N2.Param('a', null, null, false, 0), N2.Param('b', null, null, false, 0)],
      N2.Literal(0, 0),
      true, // isAsync
      0
    )
    const call = N2.CallExpr(
      N2.MemberExpr(N2.Identifier('nums', 0), N2.Identifier('sort', 0), false, 0),
      [asyncCmpFn], 0
    )
    await assert.rejects(() => e.evalExpr(call), /comparator must be synchronous/)
  })

  test('Array.find: returns undefined when nothing matches', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    const fn = N2.ArrowFn(
      [N2.Param('x', null, null, false, 0)],
      N2.BinaryExpr('>', N2.Identifier('x', 0), N2.Literal(100, 0), 0),
      false, 0
    )
    const call = N2.CallExpr(
      N2.MemberExpr(N2.Identifier('arr', 0), N2.Identifier('find', 0), false, 0),
      [fn], 0
    )
    const result = await e.evalExpr(call)
    assert.strictEqual(result, undefined)
  })

  test('Array.some: returns false when nothing matches', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    const fn = N2.ArrowFn(
      [N2.Param('x', null, null, false, 0)],
      N2.BinaryExpr('>', N2.Identifier('x', 0), N2.Literal(100, 0), 0),
      false, 0
    )
    const call = N2.CallExpr(
      N2.MemberExpr(N2.Identifier('arr', 0), N2.Identifier('some', 0), false, 0),
      [fn], 0
    )
    const result = await e.evalExpr(call)
    assert.strictEqual(result, false)
  })

  test('Array.every: returns false when one element fails', async () => {
    const e = exec()
    e.context.arr = [1, 2, 300]
    const fn = N2.ArrowFn(
      [N2.Param('x', null, null, false, 0)],
      N2.BinaryExpr('<', N2.Identifier('x', 0), N2.Literal(100, 0), 0),
      false, 0
    )
    const call = N2.CallExpr(
      N2.MemberExpr(N2.Identifier('arr', 0), N2.Identifier('every', 0), false, 0),
      [fn], 0
    )
    const result = await e.evalExpr(call)
    assert.strictEqual(result, false)
  })

  test('IPv6 loopback ::1 is blocked', async () => {
    const e = exec()
    await assert.rejects(
      () => e.doFetch('http://[::1]/api'),
      /internal addresses not allowed/
    )
  })

  test('IPv6 ULA fd00:: is blocked', async () => {
    const e = exec()
    await assert.rejects(
      () => e.doFetch('http://[fd00::1]/api'),
      /internal addresses not allowed/
    )
  })
})

// ── fetch via CallExpr ────────────────────────────────────────────────────────

describe('BuildExecutor.evalCall — fetch URL evaluation', () => {
  const N2 = require('../src/ast')
  function exec() { return new BuildExecutor('.') }
  function lit(v) { return N2.Literal(v, 0) }

  test('fetch() via CallExpr with blocked URL rejects', async () => {
    const e = exec()
    const call = N2.CallExpr(N2.Identifier('fetch', 0), [lit('http://localhost/api')], 0)
    await assert.rejects(() => e.evalExpr(call), /internal addresses not allowed/)
  })

  test('fetch() via CallExpr with file: URL rejects', async () => {
    const e = exec()
    const call = N2.CallExpr(N2.Identifier('fetch', 0), [lit('file:///etc/passwd')], 0)
    await assert.rejects(() => e.evalExpr(call), /only http\/https allowed/)
  })
})
