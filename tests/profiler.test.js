'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { BunServerEmitter } = require('../src/emitters/server-bun')
const { profilerPreamble, profilerDbWrapper } = require('../src/profiler/hooks')

function makeProgram(routes = [], schemas = []) {
  return {
    declarations: [
      ...routes.map(r => ({
        type: 'RouteDecl',
        method: r.method ?? 'GET',
        path: r.path ?? '/',
        annotations: r.annotations ?? [],
        body: r.body ?? { body: [] },
      })),
      ...schemas,
    ],
  }
}

describe('profiler/hooks', () => {
  test('profilerPreamble() returns non-empty string', () => {
    const code = profilerPreamble()
    assert.ok(code.length > 100)
    assert.ok(code.includes('_arc_p_als'))
    assert.ok(code.includes('AsyncLocalStorage'))
    assert.ok(code.includes('_arc_p_push'))
    assert.ok(code.includes('_arc_p_handle'))
    assert.ok(code.includes('/_arc/profiler'))
  })

  test('profilerPreamble() embeds dashboard HTML', () => {
    const code = profilerPreamble()
    assert.ok(code.includes('arc profiler'))
    assert.ok(code.includes('_arc_p_dashboard'))
  })

  test('profilerPreamble() embeds toolbar JS', () => {
    const code = profilerPreamble()
    assert.ok(code.includes('_arc_p_toolbar'))
    assert.ok(code.includes('_arc_prof'))
  })

  test('profilerDbWrapper() wraps _db.query methods', () => {
    const code = profilerDbWrapper()
    assert.ok(code.includes('_db.query'))
    assert.ok(code.includes('_arc_p_stmt.all'))
    assert.ok(code.includes('_arc_p_stmt.run'))
    assert.ok(code.includes('_arc_p_stmt.get'))
    assert.ok(code.includes('_arc_p_als.getStore'))
  })
})

describe('BunServerEmitter with profile=true', () => {
  const program = makeProgram(
    [{ method: 'GET', path: '/posts' }, { method: 'POST', path: '/posts' }]
  )

  test('injects profiler preamble', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('_arc_p_als'))
    assert.ok(out.includes('AsyncLocalStorage'))
    assert.ok(out.includes('_arc_p_push'))
  })

  test('injects profiler route handler', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('/_arc/profiler'))
    assert.ok(out.includes('_arc_p_handle'))
  })

  test('uses async fetch when profile=true', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('async fetch(req)'))
  })

  test('wraps dispatch with timing', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('_arc_p_t0'))
    assert.ok(out.includes('_arc_p_store'))
    assert.ok(out.includes('_arc_p_als.run'))
  })

  test('queues microtask for non-blocking push', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('queueMicrotask'))
  })

  test('prints profiler URL in banner', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('arc: profiler'))
    assert.ok(out.includes('/_arc/profiler'))
  })

  test('records request headers and response headers', () => {
    const emitter = new BunServerEmitter({ profile: true })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('reqHeaders'))
    assert.ok(out.includes('resHeaders'))
  })
})

describe('BunServerEmitter with profile=false (default)', () => {
  const program = makeProgram([{ method: 'GET', path: '/' }])

  test('no profiler code injected when profile=false', () => {
    const emitter = new BunServerEmitter({ profile: false })
    const out = emitter.emitProgram(program)
    assert.ok(!out.includes('_arc_p_als'))
    assert.ok(!out.includes('AsyncLocalStorage'))
    assert.ok(!out.includes('/_arc/profiler'))
  })

  test('uses async fetch when profile=false', () => {
    const emitter = new BunServerEmitter({ profile: false })
    const out = emitter.emitProgram(program)
    assert.ok(out.includes('async fetch(req)'))
  })

  test('no profiler code when profile option omitted', () => {
    const emitter = new BunServerEmitter({})
    const out = emitter.emitProgram(program)
    assert.ok(!out.includes('_arc_p_push'))
  })
})

describe('BunServerEmitter profile + SQLite DB', () => {
  const programWithSchema = makeProgram(
    [{ method: 'GET', path: '/items' }],
    [{
      type: 'ModelDecl',
      name: 'Item',
      fields: [{ name: 'title', typeAnnotation: { name: 'String' } }],
    }]
  )

  test('injects DB query wrapper after SQLite setup', () => {
    const emitter = new BunServerEmitter({ profile: true, db: 'sqlite' })
    const out = emitter.emitProgram(programWithSchema)
    assert.ok(out.includes('_arc_p_oq'))
    assert.ok(out.includes('_db.query = (_arc_p_sql)'))
  })

  test('DB wrapper intercepts all statement methods', () => {
    const emitter = new BunServerEmitter({ profile: true, db: 'sqlite' })
    const out = emitter.emitProgram(programWithSchema)
    assert.ok(out.includes('_arc_p_stmt.all'))
    assert.ok(out.includes('_arc_p_stmt.run'))
    assert.ok(out.includes('_arc_p_stmt.get'))
  })

  test('DB wrapper appears before prepared statement definitions', () => {
    const emitter = new BunServerEmitter({ profile: true, db: 'sqlite' })
    const out = emitter.emitProgram(programWithSchema)
    const wrapperIdx = out.indexOf('_arc_p_oq')
    const stmtIdx = out.indexOf('_q_items_findMany')
    assert.ok(wrapperIdx < stmtIdx, 'DB wrapper must appear before prepared statements')
  })
})
