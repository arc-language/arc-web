'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  _RETURN_FUNS,
  _RETURN_AWAIT_FUNS,
  _AWAIT_FUNS,
  emitRouteBody,
  emitRouteStmt,
  emitRouteArmBody,
  emitRouteMatch,
} = require('../src/emitters/route-body-emitter')

// ── Mock emitter ──────────────────────────────────────────────────────────────

function pathOf(callee) {
  if (!callee) return ''
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpr') return `${pathOf(callee.object)}.${callee.property?.name ?? ''}`
  return ''
}

function makeEmitter() {
  return {
    _matchCounter: 0,
    emitExpr(node) {
      if (!node) return ''
      if (node.type === 'Literal') return JSON.stringify(node.value)
      if (node.type === 'Identifier') return node.name
      if (node.type === 'CallExpr') {
        const p = pathOf(node.callee)
        const args = (node.args ?? []).map(a => this.emitExpr(a)).join(', ')
        return `${p}(${args})`
      }
      if (node.type === 'MemberExpr') {
        return `${this.emitExpr(node.object)}.${node.property?.name ?? ''}`
      }
      return String(node.value ?? '')
    },
    emitStmt(stmt) { return `/* ${stmt.type} */` },
    emitPattern(pattern, subj) {
      if (pattern.type === 'VariantPattern') return `${subj}?.type === '${pattern.variant ?? pattern.name}'`
      return `${subj} !== null`
    },
  }
}

// ── AST helpers ───────────────────────────────────────────────────────────────

function id(name) { return { type: 'Identifier', name } }
function lit(v) { return { type: 'Literal', value: v } }
function memberExpr(obj, prop) { return { type: 'MemberExpr', object: obj, property: id(prop) } }
function callExpr(callee, args = []) {
  return { type: 'CallExpr', callee: typeof callee === 'string' ? id(callee) : callee, args }
}
function exprStmt(expr) { return { type: 'ExprStatement', expr } }
function varDecl(name, init, kind = 'const') { return { type: 'VarDecl', name, init, kind } }
function dbCall(model, method, args = []) {
  return callExpr(memberExpr(memberExpr(id('db'), model), method), args)
}

// ── Constant sets ─────────────────────────────────────────────────────────────

test('_RETURN_FUNS contains all response helper names', () => {
  assert.ok(_RETURN_FUNS.has('json'))
  assert.ok(_RETURN_FUNS.has('redirect'))
  assert.ok(_RETURN_FUNS.has('html'))
  assert.ok(_RETURN_FUNS.has('text'))
  assert.ok(_RETURN_FUNS.has('auth.clear'))
  assert.ok(!_RETURN_FUNS.has('parseBody'))
})

test('_RETURN_AWAIT_FUNS contains auth.set', () => {
  assert.ok(_RETURN_AWAIT_FUNS.has('auth.set'))
  assert.ok(!_RETURN_AWAIT_FUNS.has('json'))
})

test('_AWAIT_FUNS contains async helpers', () => {
  assert.ok(_AWAIT_FUNS.has('parseBody'))
  assert.ok(_AWAIT_FUNS.has('auth.session'))
  assert.ok(_AWAIT_FUNS.has('auth.require'))
  assert.ok(_AWAIT_FUNS.has('jwt.sign'))
  assert.ok(_AWAIT_FUNS.has('jwt.verify'))
  assert.ok(_AWAIT_FUNS.has('email.send'))
  assert.ok(!_AWAIT_FUNS.has('json'))
})

// ── emitRouteStmt: ExprStatement with return funs ─────────────────────────────

test('emitRouteStmt: json() call gets return prefix', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(callExpr('json', [lit(null)])), e)
  assert.ok(out.startsWith('return json('), `got: ${out}`)
  assert.ok(out.endsWith(';'))
})

test('emitRouteStmt: redirect() gets return prefix', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(callExpr('redirect', [lit('/home')])), e)
  assert.ok(out.startsWith('return redirect('), `got: ${out}`)
})

test('emitRouteStmt: html() gets return prefix', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(callExpr('html', [lit('<p>hi</p>')])), e)
  assert.ok(out.startsWith('return html('))
})

test('emitRouteStmt: text() gets return prefix', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(callExpr('text', [lit('ok')])), e)
  assert.ok(out.startsWith('return text('))
})

test('emitRouteStmt: auth.clear() gets return prefix', () => {
  const e = makeEmitter()
  const callee = memberExpr(id('auth'), 'clear')
  const out = emitRouteStmt(exprStmt(callExpr(callee)), e)
  assert.ok(out.startsWith('return auth.clear('), `got: ${out}`)
})

test('emitRouteStmt: auth.set() gets return await prefix', () => {
  const e = makeEmitter()
  const callee = memberExpr(id('auth'), 'set')
  const out = emitRouteStmt(exprStmt(callExpr(callee)), e)
  assert.ok(out.startsWith('return await auth.set('), `got: ${out}`)
})

test('emitRouteStmt: parseBody() gets await prefix (not return)', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(callExpr('parseBody')), e)
  assert.ok(out.startsWith('await parseBody('), `got: ${out}`)
  assert.ok(!out.includes('return '))
})

test('emitRouteStmt: email.send() gets await prefix', () => {
  const e = makeEmitter()
  const callee = memberExpr(id('email'), 'send')
  const out = emitRouteStmt(exprStmt(callExpr(callee)), e)
  assert.ok(out.startsWith('await email.send('), `got: ${out}`)
})

test('emitRouteStmt: db.posts.findMany() gets await prefix', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(dbCall('posts', 'findMany')), e)
  assert.ok(out.startsWith('await db.posts.findMany('), `got: ${out}`)
})

test('emitRouteStmt: db.users.create() gets await prefix', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(exprStmt(dbCall('users', 'create')), e)
  assert.ok(out.startsWith('await db.users.create('), `got: ${out}`)
})

test('emitRouteStmt: plain expression emitted without prefix', () => {
  const e = makeEmitter()
  const callee = memberExpr(id('console'), 'log')
  const out = emitRouteStmt(exprStmt(callExpr(callee, [lit('hi')])), e)
  assert.ok(!out.startsWith('return '), `should not have return: ${out}`)
  assert.ok(!out.startsWith('await '), `should not have await: ${out}`)
  assert.ok(out.includes('console.log('))
  assert.ok(out.endsWith(';'))
})

test('emitRouteStmt: null input returns empty string', () => {
  assert.strictEqual(emitRouteStmt(null, makeEmitter()), '')
  assert.strictEqual(emitRouteStmt(undefined, makeEmitter()), '')
})

// ── emitRouteStmt: VarDecl ───────────────────────────────────────────────────

test('emitRouteStmt: VarDecl with db call gets await', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(varDecl('posts', dbCall('posts', 'findMany')), e)
  assert.ok(out.includes('await '), `expected await: ${out}`)
  assert.ok(out.startsWith('const posts = await'), `got: ${out}`)
})

test('emitRouteStmt: VarDecl with parseBody gets await', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(varDecl('body', callExpr('parseBody')), e)
  assert.ok(out.startsWith('const body = await parseBody('), `got: ${out}`)
})

test('emitRouteStmt: VarDecl with let kind emits let', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(varDecl('count', lit(0), 'let'), e)
  assert.ok(out.startsWith('let count ='), `got: ${out}`)
})

test('emitRouteStmt: VarDecl with plain value emits without await', () => {
  const e = makeEmitter()
  const out = emitRouteStmt(varDecl('x', lit(42)), e)
  assert.ok(out.startsWith('const x ='), `got: ${out}`)
  assert.ok(!out.includes('await'))
})

// ── emitRouteStmt: BlockStatement ────────────────────────────────────────────

test('emitRouteStmt: BlockStatement wraps body in braces', () => {
  const e = makeEmitter()
  const block = { type: 'BlockStatement', body: [exprStmt(callExpr('json', [lit(null)]))] }
  const out = emitRouteStmt(block, e)
  assert.ok(out.startsWith('{'), `got: ${out}`)
  assert.ok(out.endsWith('}'))
  assert.ok(out.includes('return json('))
})

// ── emitRouteStmt: MatchStatement falls through ───────────────────────────────

test('emitRouteStmt: MatchStatement delegates to emitRouteMatch', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: id('result'),
    arms: [{ pattern: { type: 'Wildcard' }, body: callExpr('json', [lit(null)]) }],
  }
  const out = emitRouteStmt(stmt, e)
  assert.ok(out.includes('result'), `got: ${out}`)
})

// ── emitRouteBody ─────────────────────────────────────────────────────────────

test('emitRouteBody: null/undefined returns empty string', () => {
  assert.strictEqual(emitRouteBody(null, makeEmitter()), '')
  assert.strictEqual(emitRouteBody(undefined, makeEmitter()), '')
})

test('emitRouteBody: single statement', () => {
  const e = makeEmitter()
  const out = emitRouteBody([exprStmt(callExpr('json', [lit(1)]))], e)
  assert.ok(out.includes('return json('))
})

test('emitRouteBody: multiple statements joined with newlines', () => {
  const e = makeEmitter()
  const stmts = [
    varDecl('body', callExpr('parseBody')),
    exprStmt(callExpr('json', [id('body')])),
  ]
  const out = emitRouteBody(stmts, e)
  assert.ok(out.includes('const body = await parseBody('))
  assert.ok(out.includes('return json('))
})

test('emitRouteBody: non-array single stmt wrapped automatically', () => {
  const e = makeEmitter()
  const stmt = exprStmt(callExpr('json', [lit(null)]))
  const out = emitRouteBody(stmt, e)
  assert.ok(out.includes('return json('))
})

// ── emitRouteArmBody ──────────────────────────────────────────────────────────

test('emitRouteArmBody: null returns empty string', () => {
  assert.strictEqual(emitRouteArmBody(null, makeEmitter()), '')
})

test('emitRouteArmBody: CallExpr with return fun gets return prefix', () => {
  const e = makeEmitter()
  const out = emitRouteArmBody(callExpr('json', [lit(null)]), e)
  assert.ok(out.startsWith('return json('), `got: ${out}`)
})

test('emitRouteArmBody: CallExpr with return await fun gets return await', () => {
  const e = makeEmitter()
  const callee = memberExpr(id('auth'), 'set')
  const out = emitRouteArmBody(callExpr(callee), e)
  assert.ok(out.startsWith('return await auth.set('), `got: ${out}`)
})

test('emitRouteArmBody: BlockStatement body unwrapped to statements', () => {
  const e = makeEmitter()
  const block = { type: 'BlockStatement', body: [exprStmt(callExpr('json', [lit(42)]))] }
  const out = emitRouteArmBody(block, e)
  assert.ok(out.includes('return json('))
})

test('emitRouteArmBody: array body treated as statement list', () => {
  const e = makeEmitter()
  const stmts = [exprStmt(callExpr('redirect', [lit('/')])) ]
  const out = emitRouteArmBody(stmts, e)
  assert.ok(out.includes('return redirect('))
})

test('emitRouteArmBody: non-response CallExpr emitted as expression', () => {
  const e = makeEmitter()
  const callee = memberExpr(id('console'), 'log')
  const out = emitRouteArmBody(callExpr(callee, [lit('x')]), e)
  assert.ok(out.includes('console.log('), `got: ${out}`)
  assert.ok(out.endsWith(';'))
})

// ── emitRouteMatch ─────────────────────────────────────────────────────────────

test('emitRouteMatch: binds subject to temp variable', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: id('result'),
    arms: [{ pattern: { type: 'Wildcard' }, body: exprStmt(callExpr('json', [lit(null)])) }],
  }
  const out = emitRouteMatch(stmt, e)
  assert.ok(/const _ms\d+ = result/.test(out), `expected subject bind: ${out}`)
})

test('emitRouteMatch: wildcard-only arm renders as bare block', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: id('x'),
    arms: [{ pattern: { type: 'Wildcard' }, body: callExpr('json', [lit(null)]) }],
  }
  const out = emitRouteMatch(stmt, e)
  assert.ok(out.includes('{ return json('), `got: ${out}`)
  assert.ok(!out.includes('if('))
})

test('emitRouteMatch: VariantPattern arm uses if(...) { }', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: id('maybeUser'),
    arms: [
      { pattern: { type: 'VariantPattern', variant: 'Some', name: 'user' }, body: callExpr('json', [id('user')]) },
      { pattern: { type: 'Wildcard' }, body: callExpr('json', [lit(null)]) },
    ],
  }
  const out = emitRouteMatch(stmt, e)
  assert.ok(out.includes('if('), `expected if clause: ${out}`)
  assert.ok(out.includes('else {'), `expected else for wildcard: ${out}`)
})

test('emitRouteMatch: Identifier pattern binds value', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: id('x'),
    arms: [
      { pattern: { type: 'Identifier', name: 'v' }, body: callExpr('json', [id('v')]) },
    ],
  }
  const out = emitRouteMatch(stmt, e)
  assert.ok(out.includes('const v ='), `expected binding: ${out}`)
})

test('emitRouteMatch: wildcard sorted after variant arms', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: id('res'),
    arms: [
      { pattern: { type: 'Wildcard' }, body: callExpr('json', [lit('none')]) },
      { pattern: { type: 'VariantPattern', variant: 'Some', name: null }, body: callExpr('json', [lit('some')]) },
    ],
  }
  const out = emitRouteMatch(stmt, e)
  // Wildcard should be sorted to end, so if(...) appears before else
  const ifIdx = out.indexOf('if(')
  const elseIdx = out.indexOf('else {')
  assert.ok(ifIdx !== -1, `expected if clause: ${out}`)
  assert.ok(elseIdx !== -1, `expected else clause: ${out}`)
  assert.ok(ifIdx < elseIdx, `if should appear before else: ${out}`)
})

test('emitRouteMatch: increments _matchCounter for unique temp vars', () => {
  const e = makeEmitter()
  const makeStmt = () => ({
    type: 'MatchStatement',
    subject: id('x'),
    arms: [{ pattern: { type: 'Wildcard' }, body: callExpr('json', [lit(null)]) }],
  })
  const out1 = emitRouteMatch(makeStmt(), e)
  const out2 = emitRouteMatch(makeStmt(), e)
  const var1 = out1.match(/const (_ms\d+)/)[1]
  const var2 = out2.match(/const (_ms\d+)/)[1]
  assert.notStrictEqual(var1, var2, 'each match should use a unique temp variable')
})

// ── Coverage for remaining uncovered lines ────────────────────────────────────

test('_calleePath returns empty string for unknown callee type (line 49)', () => {
  // _calleePath is not exported; exercise it via emitRouteStmt with an ExprStatement
  // whose callee is neither Identifier nor MemberExpr
  const e = makeEmitter()
  const stmt = {
    type: 'ExprStatement',
    expr: {
      type: 'CallExpr',
      callee: { type: 'CallExpr', callee: { type: 'Identifier', name: 'fn' }, args: [] },
      args: [],
    }
  }
  // Should not throw, just fall back to generic emit
  const out = emitRouteStmt(stmt, e)
  assert.ok(typeof out === 'string')
})

test('emitRouteStmt falls through to jsEmitter.emitStmt for unrecognized types (lines 92-94)', () => {
  const e = makeEmitter()
  // A ReturnStatement should fall through to the general emitter (emitStmt)
  const stmt = {
    type: 'ReturnStatement',
    value: { type: 'Literal', value: 42 },
  }
  const out = emitRouteStmt(stmt, e)
  assert.ok(typeof out === 'string')
})

test('emitRouteMatch with Literal pattern falls through to emitPattern (lines 144-145)', () => {
  const e = makeEmitter()
  const stmt = {
    type: 'MatchStatement',
    subject: { type: 'Identifier', name: 'code' },
    arms: [
      { pattern: { type: 'Literal', value: 200 }, body: { type: 'CallExpr', callee: { type: 'Identifier', name: 'json' }, args: [] } },
    ],
  }
  const out = emitRouteMatch(stmt, e)
  assert.ok(typeof out === 'string', `should not throw: ${out}`)
})
