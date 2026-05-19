'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// Use /var/tmp instead of TMPDIR — /tmp has overlay fs issues in this environment
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

  test('unsupported array method throws', async () => {
    const e = exec()
    e.context.arr = [1, 2, 3]
    const call = N.CallExpr(
      N.MemberExpr(ident('arr'), N.Identifier('reduce', 0), false, 0),
      [lit(0)], 0
    )
    await assert.rejects(() => e.evalExpr(call), /Array\.reduce not supported/)
  })
})
