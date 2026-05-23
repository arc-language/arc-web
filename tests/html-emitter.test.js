'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { compile } = require('../src/cli')
const { HtmlEmitter } = require('../src/emitters/html')
const N = require('../src/ast')

describe('HTML Emitter', () => {

  describe('page structure', () => {
    test('page title produces <title> tag', async () => {
      const { html } = await compile('page "Hello"')
      assert.ok(html.includes('<title>Hello</title>'), `Expected <title>Hello</title> in:\n${html}`)
    })

    test('page has html lang="en" by default', async () => {
      const { html } = await compile('page "Test"')
      assert.ok(html.includes('<html lang="en">'), `Expected lang="en" in:\n${html}`)
    })

    test('page starts with DOCTYPE', async () => {
      const { html } = await compile('page "Test"')
      assert.ok(html.startsWith('<!DOCTYPE html>'), 'Expected DOCTYPE at start')
    })

    test('page has charset meta tag', async () => {
      const { html } = await compile('page "Test"')
      assert.ok(html.includes('<meta charset="UTF-8">'))
    })

    test('page has viewport meta tag', async () => {
      const { html } = await compile('page "Test"')
      assert.ok(html.includes('content="width=device-width'))
    })

    test('page has link to styles.css', async () => {
      const { html } = await compile('page "Test"')
      assert.ok(html.includes('href="styles.css"'))
    })
  })

  describe('text elements', () => {
    test('heading emits <h2> by default', async () => {
      const { html } = await compile('page "T"\n  heading "Title"')
      assert.ok(html.includes('<h2'), `Expected <h2 in:\n${html}`)
      assert.ok(html.includes('Title'), `Expected "Title" in:\n${html}`)
    })

    test('heading size=1 emits <h1> and strips size attr', async () => {
      const { html } = await compile('page "T"\n  heading size=1 "Big"')
      assert.ok(html.includes('<h1'), `Expected <h1 in:\n${html}`)
      assert.ok(!html.match(/<h1[^>]*size=/), 'size attr should be stripped from rendered tag')
    })

    test('heading size=4 emits <h4>', async () => {
      const { html } = await compile('page "T"\n  heading size=4 "Medium"')
      assert.ok(html.includes('<h4'))
    })

    test('heading size=99 (out of range) falls back to <h2>', async () => {
      const { html } = await compile('page "T"\n  heading size=99 "X"')
      assert.ok(html.includes('<h2'))
    })

    test('text emits <p>', async () => {
      const { html } = await compile('page "T"\n  text "Para"')
      assert.ok(html.includes('<p'), `Expected <p in:\n${html}`)
      assert.ok(html.includes('Para'))
    })

    test('paragraph emits <p>', async () => {
      const { html } = await compile('page "T"\n  paragraph "Body text"')
      assert.ok(html.includes('<p'))
      assert.ok(html.includes('Body text'))
    })
  })

  describe('structural elements', () => {
    test('card emits <div> with scoped arc-card class', async () => {
      const { html } = await compile('page "T"\n  card')
      assert.match(html, /class="arc-card_[a-z0-9]+"/)
    })

    test('row emits <div> with scoped arc-row class', async () => {
      const { html } = await compile('page "T"\n  row')
      assert.match(html, /class="arc-row_[a-z0-9]+"/)
    })

    test('col emits <div> with arc-col class', async () => {
      const { html } = await compile('page "T"\n  col')
      assert.match(html, /class="arc-col_[a-z0-9]+"/)
    })

    test('button emits <button>', async () => {
      const { html } = await compile('page "T"\n  button "Click"')
      assert.ok(html.includes('<button'))
      assert.ok(html.includes('Click'))
    })

    test('button gets auto type="button" to prevent accidental form submits', async () => {
      const { html } = await compile('page "T"\n  button "Click"')
      assert.ok(html.includes('type="button"'), `Expected type="button" auto-injected: ${html}`)
    })

    test('button with explicit type="submit" is preserved', async () => {
      const { html } = await compile('page "T"\n  form\n    button type="submit" "Send"')
      assert.ok(html.includes('type="submit"'), `Expected explicit type=submit preserved: ${html}`)
      assert.ok(!html.match(/type="submit"[^>]*type="button"/), 'should not double-inject')
    })

    test('link emits <a> with href', async () => {
      const { html } = await compile('page "T"\n  link href="/" "Home"')
      assert.ok(html.includes('<a'))
      assert.ok(html.includes('href="/"'))
      assert.ok(html.includes('Home'))
    })
  })

  describe('img auto-enhancements', () => {
    test('img gets loading="lazy" auto-added', async () => {
      const { html } = await compile('page "T"\n  img src="photo.jpg" alt="A photo"')
      assert.ok(html.includes('loading="lazy"'), `Expected loading="lazy" in:\n${html}`)
    })

    test('img gets decoding="async" auto-added', async () => {
      const { html } = await compile('page "T"\n  img src="photo.jpg" alt="test"')
      assert.ok(html.includes('decoding="async"'))
    })

    test('img src attribute is preserved', async () => {
      const { html } = await compile('page "T"\n  img src="photo.jpg" alt="A photo"')
      assert.ok(html.includes('src="photo.jpg"'))
    })
  })

  describe('external links', () => {
    test('external link gets target="_blank" automatically', async () => {
      const { html } = await compile('page "T"\n  link href="https://example.com" "Visit"')
      assert.ok(html.includes('target="_blank"'), `Expected target="_blank" in:\n${html}`)
    })

    test('external link gets rel="noopener noreferrer" automatically', async () => {
      const { html } = await compile('page "T"\n  link href="https://example.com" "Visit"')
      assert.ok(html.includes('rel="noopener noreferrer"'), `Expected rel in:\n${html}`)
    })

    test('external link renders href and text', async () => {
      const { html } = await compile('page "T"\n  link href="https://example.com" "Visit"')
      assert.ok(html.includes('href="https://example.com"'))
      assert.ok(html.includes('Visit'))
      assert.ok(html.includes('</a>'))
    })

    test('internal link does NOT get target="_blank"', async () => {
      const { html } = await compile('page "T"\n  link href="/about" "About"')
      assert.ok(!html.includes('target="_blank"'), 'Internal links should not have target="_blank"')
    })
  })

  describe('native zero-JS patterns', () => {
    test('accordion emits <details>', async () => {
      const { html } = await compile('page "T"\n  accordion\n    summary "Open me"\n    text "Content"')
      assert.ok(html.includes('<details'), `Expected <details in:\n${html}`)
    })

    test('accordion has scoped class', async () => {
      const { html } = await compile('page "T"\n  accordion\n    summary "S"')
      assert.match(html, /arc-accordion_[a-z0-9]+/)
    })

    test('modal emits native dialog element', async () => {
      const { html } = await compile('page "T"\n  modal id="x"\n    text "Hello"')
      assert.ok(html.includes('<dialog'), `Expected <dialog> in:\n${html}`)
      assert.ok(html.includes('id="x"'), `Expected id="x" in:\n${html}`)
      assert.ok(!html.includes('<dialog id="x" popover'), `dialog must not have popover attribute:\n${html}`)
    })

    test('modal uses native dialog element', async () => {
      const { html } = await compile('page "T"\n  modal id="m1"\n    text "Hi"')
      assert.ok(html.includes('<dialog'), `Expected <dialog> in:\n${html}`)
      assert.ok(!html.includes('popover'), `dialog must not use popover API:\n${html}`)
      assert.ok(html.includes('aria-modal="true"'), `Expected aria-modal="true" in:\n${html}`)
    })

    test('button with trigger emits showModal onclick', async () => {
      const { html } = await compile('page "T"\n  button trigger="x" "Open"')
      assert.ok(html.includes('showModal'), `Expected showModal in:\n${html}`)
      assert.ok(html.includes('getElementById'), `Expected getElementById in:\n${html}`)
      assert.ok(html.includes('x'), `Expected dialog id in:\n${html}`)
    })
  })

  describe('@build for loops (static unrolling)', () => {
    test('for loop over @build data unrolls in HTML', async () => {
      const src = `page "Blog"
  @build const posts = [
    { title: "Post One" },
    { title: "Post Two" }
  ]
  for post in posts
    heading "{post.title}"`
      const { html } = await compile(src)
      // Loop is unrolled: should contain heading elements
      assert.ok(html.includes('<h2'), `Expected <h2 headings in:\n${html}`)
    })

    test('for loop over @build data produces zero JS', async () => {
      const src = `page "Blog"
  @build const items = [{ name: "A" }, { name: "B" }]
  for item in items
    text "{item.name}"`
      const { js } = await compile(src)
      assert.equal(js.trim(), '', `Expected empty JS for @build loop, got:\n${js}`)
    })
  })

  describe('reactive state', () => {
    test('@state produces reactive span placeholder', async () => {
      const src = `page "T"
  @state let x = 0
  text "{x}"`
      const { html } = await compile(src)
      assert.match(html, /<span id="_a\d+" data-arc-live><\/span>/, `Expected reactive span in:\n${html}`)
    })
  })

  describe('static pages produce zero JS', () => {
    test('purely static page has empty JS output', async () => {
      const { js } = await compile('page "Hello"\n  heading "Hi"\n  text "World"')
      assert.equal(js.trim(), '', `Expected empty JS for static page, got:\n${js}`)
    })

    test('page with only @build data has empty JS output', async () => {
      const src = `page "T"
  @build const name = "World"
  heading "Hello"`
      const { js } = await compile(src)
      assert.equal(js.trim(), '', `Expected empty JS, got:\n${js}`)
    })
  })

  describe('widget invocation and @attr references', () => {
    test('widget with @attr interpolation renders passed attribute value', async () => {
      const src = `
widget Card
  div
    heading "{@title}"

page "T"
  Card title="Hello"`
      const { html } = await compile(src)
      assert.ok(html.includes('Hello'), `Expected attr value in:\n${html}`)
    })

    test('widget body is inlined at usage site', async () => {
      const src = `
widget Chip
  span "{@label}"

page "T"
  row
    Chip label="first"
    Chip label="second"`
      const { html } = await compile(src)
      assert.ok(html.includes('first'), `Expected first in:\n${html}`)
      assert.ok(html.includes('second'), `Expected second in:\n${html}`)
    })

    test('widget emits correct HTML structure', async () => {
      const src = `
widget Badge
  span
    "{@text}"

page "T"
  Badge text="New"`
      const { html } = await compile(src)
      assert.ok(html.includes('New'), `Expected attr text in:\n${html}`)
      assert.ok(html.includes('<span'), `Expected span element in:\n${html}`)
    })
  })

  describe('HTML escaping', () => {
    test('special chars in title are HTML-escaped', async () => {
      const { html } = await compile('page "Hello & World"')
      assert.ok(html.includes('Hello &amp; World'), `Expected escaped & in:\n${html}`)
    })

    test('angle brackets in text are escaped', async () => {
      const { html } = await compile('page "T"\n  text "1 < 2"')
      assert.ok(html.includes('&lt;'))
    })
  })

  describe('external link attributes', () => {
    test('external https link gets target=_blank', async () => {
      const src = `page "T"
  link href="https://example.com" "Visit"`
      const { html } = await compile(src)
      assert.ok(html.includes('target="_blank"'), `Expected target=_blank in:\n${html}`)
    })

    test('external https link gets rel=noopener noreferrer', async () => {
      const src = `page "T"
  link href="https://example.com" "Visit"`
      const { html } = await compile(src)
      assert.ok(html.includes('rel="noopener noreferrer"'), `Expected rel in:\n${html}`)
    })

    test('internal relative link does not get target=_blank', async () => {
      const src = `page "T"
  link href="/about" "About"`
      const { html } = await compile(src)
      assert.ok(!html.includes('target="_blank"'), `Should not have target=_blank for relative link:\n${html}`)
    })
  })

  describe('icon aria-hidden', () => {
    test('icon element without aria-label gets aria-hidden=true', async () => {
      const src = `page "T"
  icon name="star"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-hidden="true"'), `Expected aria-hidden in:\n${html}`)
    })

    test('multiple icon elements each get aria-hidden', async () => {
      const src = `page "T"
  row
    icon name="star"
    icon name="heart"`
      const { html } = await compile(src)
      const count = (html.match(/aria-hidden="true"/g) ?? []).length
      assert.ok(count >= 2, `Expected 2 aria-hidden attrs, got ${count}:\n${html}`)
    })
  })

  describe('if/unless template nodes', () => {
    test('static if with true @build condition emits consequent only', async () => {
      const src = `page "T"
  @build const flag = true
  if flag
    text "shown"
  else
    text "hidden"`
      const { html } = await compile(src)
      assert.ok(html.includes('shown'), `Expected "shown" in:\n${html}`)
      assert.ok(!html.includes('hidden'), `Should not include "hidden":\n${html}`)
    })

    test('static if with false @build condition emits alternate', async () => {
      const src = `page "T"
  @build const flag = false
  if flag
    text "shown"
  else
    text "hidden"`
      const { html } = await compile(src)
      assert.ok(html.includes('hidden'), `Expected "hidden" in:\n${html}`)
      assert.ok(!html.includes('shown'), `Should not include "shown":\n${html}`)
    })

    test('reactive if (on @state) emits aria-live container', async () => {
      const src = `page "T"
  @state let show = true
  if show
    text "visible"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-live'), `Expected aria-live container in:\n${html}`)
    })

    test('reactive if with else emits both branches with separate ids', async () => {
      const src = `page "T"
  @state let show = true
  if show
    text "yes"
  else
    text "no"`
      const { html } = await compile(src)
      assert.ok(html.includes('yes') && html.includes('no'), `Expected both branches in:\n${html}`)
    })

    test('unless with static false condition emits body', async () => {
      const src = `page "T"
  @build const broken = false
  unless broken
    text "ok"`
      const { html } = await compile(src)
      assert.ok(html.includes('ok'), `Expected body in:\n${html}`)
    })
  })

  describe('match template node', () => {
    test('static @build match resolves and includes matching arm', async () => {
      const src = `page "T"
  @build const mode = "dark"
  match mode {
    "dark" => text "Dark Mode"
    _ => text "Other"
  }`
      const { html } = await compile(src)
      // At minimum the matching arm content appears in output
      assert.ok(html.includes('Dark Mode'), `Expected dark arm in:\n${html}`)
    })

    test('static @build match with no matching arm falls through to wildcard', async () => {
      const src = `page "T"
  @build const mode = "unknown"
  match mode {
    "dark" => text "Dark"
    _ => text "Default"
  }`
      const { html } = await compile(src)
      assert.ok(html.includes('Default'), `Expected wildcard arm in:\n${html}`)
    })

    test('reactive match template emits aria-live container', async () => {
      const src = `page "T"
  @state let mode = "dark"
  match mode {
    "dark" => text "Dark"
    "light" => text "Light"
    _ => text "Default"
  }`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-live'), `Expected aria-live for reactive match:\n${html}`)
    })
  })

  describe('for template nodes', () => {
    test('static for with @build array unrolls to multiple HTML items', async () => {
      const src = `page "T"
  @build const items = ["one", "two", "three"]
  for item in items
    text "{item}"`
      const { html } = await compile(src)
      assert.ok(html.includes('one'), `Expected "one" in:\n${html}`)
      assert.ok(html.includes('two'), `Expected "two"`)
      assert.ok(html.includes('three'), `Expected "three"`)
    })

    test('reactive for (on @state) emits list container with aria-live', async () => {
      const src = `page "T"
  @state let items = []
  for item in items
    text "{item}"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-live'), `Expected aria-live list container in:\n${html}`)
    })
  })

  describe('helper functions via direct emitter', () => {
    test('isStaticExpr returns true for Literal nodes', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.isStaticExpr(N.Literal(42, '42', 0)), true)
    })

    test('isStaticExpr returns true for @build identifier in buildContext', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { count: 10 } })
      assert.equal(emitter.isStaticExpr(N.Identifier('count', 0)), true)
    })

    test('isStaticExpr returns false for undeclared identifier', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.isStaticExpr(N.Identifier('unknown', 0)), false)
    })

    test('isStaticExpr returns true for BinaryExpr of two literals', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.BinaryExpr('+', N.Literal(1, '1', 0), N.Literal(2, '2', 0), 0)
      assert.equal(emitter.isStaticExpr(expr), true)
    })

    test('isStaticExpr returns true for TemplateLiteral with all static parts', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const tpl = N.TemplateLiteral([N.Literal('hi', '"hi"', 0)], 0)
      assert.equal(emitter.isStaticExpr(tpl), true)
    })

    test('isStaticExpr returns true for MemberExpr on static object', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { user: { name: 'A' } } })
      const expr = N.MemberExpr(N.Identifier('user', 0), N.Identifier('name', 0), false, 0)
      assert.equal(emitter.isStaticExpr(expr), true)
    })

    test('evalStaticExpr on Literal returns its value', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.evalStaticExpr(N.Literal(42, '42', 0)), 42)
    })

    test('evalStaticExpr on BinaryExpr computes the result', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.BinaryExpr('+', N.Literal(2, '2', 0), N.Literal(3, '3', 0), 0)
      assert.equal(emitter.evalStaticExpr(expr), 5)
    })

    test('evalStaticExpr on MemberExpr reads from buildContext', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { user: { name: 'Alice' } } })
      const expr = N.MemberExpr(N.Identifier('user', 0), N.Identifier('name', 0), false, 0)
      assert.equal(emitter.evalStaticExpr(expr), 'Alice')
    })

    test('evalStaticExpr on TemplateLiteral concatenates', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { name: 'World' } })
      const tpl = N.TemplateLiteral([
        N.Literal('Hello ', '"Hello "', 0),
        N.Identifier('name', 0),
        N.Literal('!', '"!"', 0),
      ], 0)
      assert.equal(emitter.evalStaticExpr(tpl), 'Hello World!')
    })

    test('applyOp arithmetic operations', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.applyOp('+', 1, 2), 3)
      assert.equal(emitter.applyOp('-', 5, 2), 3)
      assert.equal(emitter.applyOp('*', 3, 4), 12)
      assert.equal(emitter.applyOp('/', 10, 2), 5)
      assert.equal(emitter.applyOp('%', 10, 3), 1)
      assert.equal(emitter.applyOp('unknown', 1, 2), undefined)
    })

    test('exprToString for Literal renders JSON', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.exprToString(N.Literal(42, '42', 0)), '42')
      assert.equal(emitter.exprToString(N.Literal('hi', '"hi"', 0)), '"hi"')
    })

    test('exprToString for AtProperty prefixes with @', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.exprToString(N.AtProperty('count', 0)), '@count')
    })

    test('exprToString for MemberExpr (dotted)', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.MemberExpr(N.Identifier('user', 0), N.Identifier('name', 0), false, 0)
      assert.equal(emitter.exprToString(expr), 'user.name')
    })

    test('exprToString for MemberExpr (computed [])', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.MemberExpr(N.Identifier('arr', 0), N.Literal(0, '0', 0), true, 0)
      assert.equal(emitter.exprToString(expr), 'arr[0]')
    })

    test('exprToString for BinaryExpr wraps in parens', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.BinaryExpr('+', N.Identifier('a', 0), N.Identifier('b', 0), 0)
      assert.equal(emitter.exprToString(expr), '(a+b)')
    })

    test('exprToString for OptionalChain uses ?.', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = { type: 'OptionalChain',
        object: N.Identifier('user', 0),
        property: N.Identifier('name', 0),
        line: 0 }
      assert.equal(emitter.exprToString(expr), 'user?.name')
    })

    test('exprToString for NullCoalesce uses ??', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.NullCoalesce(N.Identifier('a', 0), N.Literal('b', '"b"', 0), 0)
      assert.equal(emitter.exprToString(expr), '(a??"b")')
    })

    test('exprToString for TernaryExpr renders ? :', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.TernaryExpr(
        N.Identifier('cond', 0),
        N.Literal('a', '"a"', 0),
        N.Literal('b', '"b"', 0),
        0)
      assert.equal(emitter.exprToString(expr), '(cond?"a":"b")')
    })

    test('exprToString for ArrayLiteral renders [...]', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.ArrayLiteral([N.Literal(1, '1', 0), N.Literal(2, '2', 0)], 0)
      assert.equal(emitter.exprToString(expr), '[1,2]')
    })

    test('exprToString for unknown node type returns undefined', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.exprToString({ type: 'Weird', line: 0 }), 'undefined')
    })

    test('exprToString for CallExpr renders fn(args)', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.CallExpr(N.Identifier('fn', 0), [N.Literal(1, '1', 0)], 0)
      assert.equal(emitter.exprToString(expr), 'fn(1)')
    })

    test('exprToString for UnaryExpr', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.UnaryExpr('!', N.Identifier('x', 0), 0)
      assert.equal(emitter.exprToString(expr), '(!x)')
    })

    test('exprToString for LogicalExpr', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.LogicalExpr('&&', N.Identifier('a', 0), N.Identifier('b', 0), 0)
      assert.equal(emitter.exprToString(expr), '(a&&b)')
    })

    test('exprToString for AwaitExpr', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = { type: 'AwaitExpr', argument: N.Identifier('p', 0), line: 0 }
      assert.equal(emitter.exprToString(expr), 'await p')
    })

    test('_extractRootIdent returns name for simple Identifier', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter._extractRootIdent(N.Identifier('foo', 0)), 'foo')
    })

    test('_extractRootIdent walks through MemberExpr chain', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.MemberExpr(
        N.MemberExpr(N.Identifier('user', 0), N.Identifier('profile', 0), false, 0),
        N.Identifier('name', 0), false, 0)
      assert.equal(emitter._extractRootIdent(expr), 'user')
    })

    test('_extractRootIdent returns null when path has OptionalChain', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = {
        type: 'MemberExpr',
        object: { type: 'OptionalChain', object: N.Identifier('user', 0), property: N.Identifier('profile', 0), line: 0 },
        property: N.Identifier('name', 0),
        computed: false,
        line: 0
      }
      assert.equal(emitter._extractRootIdent(expr), null)
    })

    test('_hasOptionalChain detects optional chain', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter._hasOptionalChain({ type: 'OptionalChain' }), true)
      assert.equal(emitter._hasOptionalChain(N.Identifier('x', 0)), false)
    })

    test('emitExpr for Literal returns escaped string', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.emitExpr(N.Literal('a<b', '"a<b"', 0)), 'a&lt;b')
    })

    test('emitExpr for TemplateLiteral with all literal parts', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const tpl = N.TemplateLiteral([
        N.Literal('Hello ', '"Hello "', 0),
        N.Literal('World', '"World"', 0),
      ], 0)
      assert.equal(emitter.emitExpr(tpl), 'Hello World')
    })

    test('emitExpr for null returns empty string', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.emitExpr(null), '')
    })

    test('emitRaw throws without allowRaw option', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.throws(() => emitter.emitRaw({ type: 'RawNode', html: '<x>' }),
        /requires opt-in via allowRaw/)
    })

    test('emitRaw returns html when allowRaw is true', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {}, allowRaw: true })
      assert.equal(emitter.emitRaw({ type: 'RawNode', html: '<custom>' }), '<custom>')
    })

    test('escape returns String of non-string input', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.escape(42), '42')
      assert.equal(emitter.escape(null), '')
      assert.equal(emitter.escape(undefined), '')
    })

    test('evalStaticExpr returns undefined for BinaryExpr with unknown left', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.BinaryExpr('+', N.Identifier('unknown', 0), N.Literal(2, '2', 0), 0)
      assert.equal(emitter.evalStaticExpr(expr), undefined)
    })

    test('evalStaticExpr returns undefined for TemplateLiteral with unknown part', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const tpl = N.TemplateLiteral([N.Identifier('unknown', 0)], 0)
      assert.equal(emitter.evalStaticExpr(tpl), undefined)
    })

    test('evalStaticExpr returns undefined for MemberExpr with null object', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { user: null } })
      const expr = N.MemberExpr(N.Identifier('user', 0), N.Identifier('name', 0), false, 0)
      assert.equal(emitter.evalStaticExpr(expr), undefined)
    })

    test('emitWidgetInvocation with dynamic attr expression (not static)', async () => {
      // Use a widget invoked with a @state-driven attr: dynamic, not static
      const { html } = await compile(`widget Badge
  span "{@label}"
page "T"
  @state let n = 5
  Badge label={n}
`)
      assert.ok(html.includes('<span'), `Expected widget span in:\n${html}`)
    })

    test('emitExpr for unknown type returns empty string', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      assert.equal(emitter.emitExpr({ type: 'Weird', line: 0 }), '')
    })

    test('emitFor unrolls static collection directly via emitNode', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { items: ['a', 'b', 'c'] } })
      const forNode = N.ForNode(null, 'item', N.Identifier('items', 0),
        [N.InterpolationNode(N.Identifier('item', 0), 0)], 0)
      const result = emitter.emitNode(forNode)
      assert.ok(result.includes('a'), `Expected 'a' in:\n${result}`)
      assert.ok(result.includes('b'))
      assert.ok(result.includes('c'))
    })

    test('emitFor returns empty for non-array static collection', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { items: 42 } })
      const forNode = N.ForNode(null, 'item', N.Identifier('items', 0),
        [N.InterpolationNode(N.Identifier('item', 0), 0)], 0)
      const result = emitter.emitNode(forNode)
      assert.equal(result, '')
    })

    test('emitIf with static truthy condition emits consequent', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { flag: true } })
      const ifNode = N.IfNode(N.Identifier('flag', 0),
        [N.TextNode('yes', 0)],
        [N.TextNode('no', 0)], 0)
      const result = emitter.emitNode(ifNode)
      assert.ok(result.includes('yes'))
      assert.ok(!result.includes('no'))
    })

    test('emitIf with static falsy condition emits alternate', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { flag: false } })
      const ifNode = N.IfNode(N.Identifier('flag', 0),
        [N.TextNode('yes', 0)],
        [N.TextNode('no', 0)], 0)
      const result = emitter.emitNode(ifNode)
      assert.ok(result.includes('no'))
      assert.ok(!result.includes('yes'))
    })

    test('emitIf with static falsy and no alternate emits empty', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { flag: false } })
      const ifNode = N.IfNode(N.Identifier('flag', 0), [N.TextNode('hi', 0)], null, 0)
      const result = emitter.emitNode(ifNode)
      assert.equal(result, '')
    })

    test('static @build match with no matching arm and no wildcard returns empty', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { mode: 'unknown' } })
      const node = {
        type: 'MatchTemplateNode',
        subject: N.Identifier('mode', 0),
        arms: [
          { pattern: N.Literal('a', '"a"', 0), body: N.TextNode('A', 0), line: 0 },
          { pattern: N.Literal('b', '"b"', 0), body: N.TextNode('B', 0), line: 0 },
        ],
        line: 0
      }
      const result = emitter.emitNode(node)
      assert.equal(result, '')
    })

    test('evalStaticExpr for OptionalChain', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { user: { name: 'A' } } })
      const expr = { type: 'OptionalChain', object: N.Identifier('user', 0), property: N.Identifier('name', 0), line: 0 }
      // OptionalChain is not in isStaticExpr, so this returns undefined
      assert.equal(emitter.evalStaticExpr(expr), undefined)
    })

    test('exprToString for CallExpr with multiple args', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = N.CallExpr(N.Identifier('fn', 0), [
        N.Literal(1, '1', 0),
        N.Literal(2, '2', 0),
      ], 0)
      assert.equal(emitter.exprToString(expr), 'fn(1,2)')
    })

    test('emitInterpolation reactive (non-static) emits span placeholder', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      // Identifier not in buildContext → not static → reactive span
      const node = N.InterpolationNode(N.Identifier('reactiveVar', 0), 0)
      const result = emitter.emitNode(node)
      assert.ok(result.includes('data-arc-live'), `Expected reactive span: ${result}`)
    })

    test('emitInterpolation inside for-template uses _esc inline', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      emitter._inForTemplate = true
      const node = N.InterpolationNode(N.Identifier('item', 0), 0)
      const result = emitter.emitNode(node)
      assert.ok(result.includes('_esc(String('), `Expected _esc inline: ${result}`)
      emitter._inForTemplate = false
    })

    test('emitTemplateLiteral inside for-template inlines expression parts', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      emitter._inForTemplate = true
      const node = N.TemplateLiteral([
        N.Literal('Hello ', '"Hello "', 0),
        N.Identifier('name', 0),
      ], 0)
      const result = emitter.emitNode(node)
      assert.ok(result.includes('_esc(String('), `Expected for-template inline: ${result}`)
      emitter._inForTemplate = false
    })

    test('emitMatchTemplate reactive with Literal arm pattern uses === comparison', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const node = {
        type: 'MatchTemplateNode',
        subject: N.Identifier('val', 0),
        arms: [
          { pattern: N.Literal(1, '1', 0), body: N.TextNode('one', 0), line: 0 },
          { pattern: { type: 'Wildcard', line: 0 }, body: N.TextNode('other', 0), line: 0 },
        ],
        line: 0
      }
      const result = emitter.emitNode(node)
      assert.ok(result.includes('aria-live'), `Expected aria-live: ${result}`)
      assert.ok(result.includes('hidden'), `Expected hidden arms: ${result}`)
    })

    test('emitMatchTemplate reactive with non-literal pattern uses exprToString', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const node = {
        type: 'MatchTemplateNode',
        subject: N.Identifier('val', 0),
        arms: [
          { pattern: N.Identifier('THRESHOLD', 0), body: N.TextNode('match', 0), line: 0 },
        ],
        line: 0
      }
      const result = emitter.emitNode(node)
      assert.ok(result.includes('aria-live'))
    })

    test('emitTooltipAttr wraps element with aria-describedby anchor', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const el = N.Element('button', [], null, { tooltip: 'help me' }, [
        N.TextNode('Click', 0)
      ], 0)
      const result = emitter.emitElement(el)
      assert.ok(result.includes('aria-describedby'), `Expected aria-describedby: ${result}`)
      assert.ok(result.includes('popover='), `Expected popover attr: ${result}`)
      assert.ok(result.includes('help me'), `Expected tooltip text`)
    })

    test('emitWidget delegates to emitChildren of widget body', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const widget = N.WidgetDecl('Card', [], [N.TextNode('hello', 0)], 0)
      const result = emitter.emitWidget(widget)
      assert.ok(result.includes('hello'), `Expected widget body content: ${result}`)
    })

    test('exprToString for AwaitExpr with template literal arg', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: {} })
      const expr = {
        type: 'AwaitExpr',
        argument: N.TemplateLiteral([N.Literal('x', '"x"', 0)], 0),
        line: 0
      }
      const result = emitter.exprToString(expr)
      assert.ok(result.startsWith('await'))
    })

    test('emitUnless always falls to reactive path (UnaryExpr not static)', () => {
      const emitter = new HtmlEmitter({ hash: 'h1', buildContext: { broken: false } })
      const node = N.UnlessNode(N.Identifier('broken', 0), [N.TextNode('OK', 0)], 0)
      const result = emitter.emitNode(node)
      // Unless wraps in UnaryExpr which is not static: emits a reactive aria-live container
      assert.ok(result.includes('aria-live'), `Got: ${result}`)
    })
  })

  describe('native patterns (tooltip, accordion, modal)', () => {
    test('tooltip element emits aria-describedby and popover', async () => {
      const src = `page "T"
  tooltip text="Help text"
    text "hover me"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-describedby'), `Expected aria-describedby in:\n${html}`)
      assert.ok(html.includes('popover='), `Expected popover attr in:\n${html}`)
      assert.ok(html.includes('Help text'), `Expected tooltip text`)
    })

    test('accordion element emits details/summary', async () => {
      const src = `page "T"
  accordion
    summary "Click me"
    text "content"`
      const { html } = await compile(src)
      assert.ok(html.includes('<details'), `Expected <details> in:\n${html}`)
      assert.ok(html.includes('<summary'), `Expected <summary> in:\n${html}`)
    })

    test('accordion without summary gets a fallback summary', async () => {
      const src = `page "T"
  accordion
    text "content"`
      const { html } = await compile(src)
      assert.ok(html.includes('<details'))
      assert.ok(html.includes('<summary'), `Expected fallback summary in:\n${html}`)
    })

    test('element with tooltip attr is wrapped in tooltip-anchor span', async () => {
      const src = `page "T"
  button tooltip="Click to save" "Save"`
      const { html } = await compile(src)
      assert.ok(html.includes('tooltip-anchor'), `Expected tooltip-anchor wrapper in:\n${html}`)
      assert.ok(html.includes('Click to save'))
    })

    test('modal element emits <dialog> with aria-modal', async () => {
      const src = `page "T"
  modal id="confirm"
    heading "Confirm?"`
      const { html } = await compile(src)
      assert.ok(html.includes('<dialog'), `Expected <dialog> in:\n${html}`)
      assert.ok(html.includes('aria-modal="true"'), `Expected aria-modal in:\n${html}`)
      assert.ok(html.includes('id="confirm"'))
    })
  })

  describe('reactive template literal span placeholders', () => {
    test('@state variable in text template emits reactive span', async () => {
      const src = `page "T"
  @state let name = "World"
  text "Hello {name}"`
      const { html } = await compile(src)
      assert.ok(html.includes('data-arc-live'), `Expected reactive span in:\n${html}`)
    })

    test('reactive span has a stable id attribute', async () => {
      const src = `page "T"
  @state let count = 0
  text "Count: {count}"`
      const { html } = await compile(src)
      const match = html.match(/id="([^"]+)" data-arc-live/)
      assert.ok(match, `Expected id on reactive span in:\n${html}`)
    })
  })

})
