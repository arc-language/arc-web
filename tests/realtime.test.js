'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { RealtimeEmitter } = require('../src/realtime/client')
const N = require('../src/ast')

describe('RealtimeEmitter.emitAll', () => {
  test('returns empty string when no realtime declarations', () => {
    const e = new RealtimeEmitter({ hash: 'h1' })
    assert.equal(e.emitAll([], []), '')
  })

  test('emits IIFE wrapper with decode helper and WebSocket connection', () => {
    const decl = N.RealtimeDecl('messages',
      N.CallExpr(N.Identifier('channel', 0), [N.Literal('chat', '"chat"', 0)], 0),
      0)
    const e = new RealtimeEmitter({ hash: 'h1' })
    const code = e.emitAll([decl], [])
    assert.ok(code.includes('_rt_decode'), 'should include decoder')
    assert.ok(code.includes('WebSocket'), 'should include WebSocket')
    assert.ok(code.includes('_connect_messages'), 'should include channel connect')
  })

  test('throws on unsafe @realtime variable name', () => {
    const decl = { type: 'RealtimeDecl', name: 'bad-name', channel: null, line: 0 }
    const e = new RealtimeEmitter({ hash: 'h1' })
    assert.throws(() => e.emitAll([decl], []), /unsafe @realtime variable name/)
  })
})

describe('RealtimeEmitter.extractChannelName', () => {
  test('returns "unknown" for null/undefined channel expr', () => {
    const e = new RealtimeEmitter({ hash: 'h1' })
    assert.equal(e.extractChannelName(null), '"unknown"')
    assert.equal(e.extractChannelName(undefined), '"unknown"')
  })

  test('extracts string literal from channel("name") call', () => {
    const e = new RealtimeEmitter({ hash: 'h1' })
    const expr = N.CallExpr(N.Identifier('channel', 0), [N.Literal('chat', '"chat"', 0)], 0)
    assert.equal(e.extractChannelName(expr), '"chat"')
  })

  test('converts template literal channel name to JS template literal', () => {
    const e = new RealtimeEmitter({ hash: 'h1' })
    const tpl = N.TemplateLiteral([
      N.Literal('chat/', '"chat/"', 0),
      N.Identifier('roomId', 0),
    ], 0)
    const expr = N.CallExpr(N.Identifier('channel', 0), [tpl], 0)
    const result = e.extractChannelName(expr)
    assert.ok(result.includes('chat/'), `Expected static part: ${result}`)
    assert.ok(result.includes('${roomId}'), `Expected interpolation: ${result}`)
  })

  test('template literal with unsafe identifier uses empty fallback', () => {
    const e = new RealtimeEmitter({ hash: 'h1' })
    const tpl = N.TemplateLiteral([
      N.Literal('x/', '"x/"', 0),
      { type: 'Identifier', name: '0bad', line: 0 },
    ], 0)
    const expr = N.CallExpr(N.Identifier('channel', 0), [tpl], 0)
    const result = e.extractChannelName(expr)
    assert.ok(result.includes('${\'\'}'), `Expected safe fallback: ${result}`)
  })

  test('non-CallExpr returns generic "channel"', () => {
    const e = new RealtimeEmitter({ hash: 'h1' })
    assert.equal(e.extractChannelName(N.Identifier('something', 0)), '"channel"')
  })
})

describe('RealtimeEmitter — DOM update wiring', () => {
  test('emits _set_var calls for stateVar bindings that reference the realtime var', () => {
    const decl = N.RealtimeDecl('feed',
      N.CallExpr(N.Identifier('channel', 0), [N.Literal('feed', '"feed"', 0)], 0),
      0)
    const e = new RealtimeEmitter({ hash: 'h1' })
    const bindings = [
      { id: '_1', expr: 'feed.length', stateVar: 'feed' },
    ]
    const code = e.emitAll([decl], bindings)
    assert.ok(code.includes('_set_feed'), `Expected _set_feed call: ${code.slice(0, 500)}`)
  })

  test('emits direct DOM update for bindings without stateVar', () => {
    const decl = N.RealtimeDecl('msg',
      N.CallExpr(N.Identifier('channel', 0), [N.Literal('m', '"m"', 0)], 0),
      0)
    const e = new RealtimeEmitter({ hash: 'h1' })
    const bindings = [
      { id: '_1', expr: 'msg', stateVar: null },
    ]
    const code = e.emitAll([decl], bindings)
    assert.ok(code.includes("getElementById('_1')"), `Expected direct getElementById: ${code.slice(0, 500)}`)
    assert.ok(code.includes('textContent'))
  })

  test('emits placeholder comment when no bindings match', () => {
    const decl = N.RealtimeDecl('other',
      N.CallExpr(N.Identifier('channel', 0), [N.Literal('o', '"o"', 0)], 0),
      0)
    const e = new RealtimeEmitter({ hash: 'h1' })
    const code = e.emitAll([decl], [])
    assert.ok(code.includes('No DOM bindings found'), `Expected placeholder comment in:\n${code}`)
  })
})
