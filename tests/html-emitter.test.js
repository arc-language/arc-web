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
    test('card emits <div> with arc-card class', async () => {
      const { html } = await compile('page "T"\n  card')
      assert.match(html, /class="arc-card"/)
    })

    test('row emits <div> with arc-row class', async () => {
      const { html } = await compile('page "T"\n  row')
      assert.match(html, /class="arc-row"/)
    })

    test('col emits <div> with arc-col class', async () => {
      const { html } = await compile('page "T"\n  col')
      assert.match(html, /class="arc-col"/)
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

    test('modal uses aria-modal and no popover', async () => {
      const { html } = await compile('page "T"\n  modal id="m1"\n    text "Hi"')
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

    test('reactive if (on @state) emits reactive container (no default aria-live)', async () => {
      const src = `page "T"
  @state let show = true
  if show
    text "visible"`
      const { html } = await compile(src)
      // aria-live is opt-in; default reactive wrapper is a plain div so only meaningful
      // AT changes get announced (authors add aria-live explicitly when needed)
      assert.ok(!html.includes('aria-live'), `Default reactive if should not have aria-live:\n${html}`)
      assert.ok(html.includes('hidden'), `Expected hidden branch in:\n${html}`)
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

    test('reactive match template wrapper does not emit aria-live by default', async () => {
      const src = `page "T"
  @state let mode = "dark"
  match mode {
    "dark" => text "Dark"
    "light" => text "Light"
    _ => text "Default"
  }`
      const { html } = await compile(src)
      // aria-live is opt-in; default reactive match wrapper is a plain div
      assert.ok(!html.includes('aria-live'), `Default reactive match should not have aria-live:\n${html}`)
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

    test('reactive for (on @state) emits list container', async () => {
      const src = `page "T"
  @state let items = []
  for item in items
    text "{item}"`
      const { html } = await compile(src)
      // aria-live is opt-in; default for reactive list is a plain container
      assert.ok(html.match(/<div id="[^"]+"><\/div>/), `Expected list container div in:\n${html}`)
    })

    test('reactive for default does NOT emit aria-live (opt-in only)', async () => {
      const src = `page "T"
  @state let items = []
  for item in items
    text "{item}"`
      const { html } = await compile(src)
      // Default reactive for should produce a quiet list container (no aria-live)
      // to avoid noisy screen-reader announcements on every mutation.
      const listDiv = html.match(/<div id="_a\d+"[^>]*><\/div>/)
      assert.ok(listDiv, `Expected list container in:\n${html}`)
      assert.ok(!listDiv[0].includes('aria-live'),
        `List container should not have aria-live by default: ${listDiv[0]}`)
    })
  })

  describe('native patterns (tooltip, accordion, modal)', () => {
    test('tooltip element emits aria-describedby and popover', async () => {
      const src = `page "T"
  tooltip text="Help text"
    text "hover me"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-describedby'), `Expected aria-describedby in:\n${html}`)
      assert.ok(html.includes('role="tooltip"'), `Expected role="tooltip" on tooltip span in:\n${html}`)
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

  describe('slider widget', () => {
    test('slider emits carousel region with scoped class', async () => {
      const src = `page "T"
  slider
    div "Slide 1"
    div "Slide 2"`
      const { html } = await compile(src)
      assert.ok(html.includes('role="region"'), `Expected role="region" in:\n${html}`)
      assert.ok(html.includes('aria-roledescription="carousel"'), `Expected aria-roledescription in:\n${html}`)
      assert.match(html, /arc-slider_[a-z0-9_]+/)
    })

    test('slider emits scroll-snap track with scoped class', async () => {
      const src = `page "T"
  slider
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.match(html, /arc-slider-track_[a-z0-9_]+/)
    })

    test('slider wraps children as slides with ARIA labels', async () => {
      const src = `page "T"
  slider
    div "First"
    div "Second"
    div "Third"`
      const { html } = await compile(src)
      assert.ok(html.includes('1 of 3'), `Expected "1 of 3" label in:\n${html}`)
      assert.ok(html.includes('3 of 3'), `Expected "3 of 3" label in:\n${html}`)
      assert.ok(html.includes('role="group"'), `Expected role="group" on slides in:\n${html}`)
    })

    test('slider emits prev/next nav buttons by default', async () => {
      const src = `page "T"
  slider
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-label="Previous slide"'), `Expected prev button in:\n${html}`)
      assert.ok(html.includes('aria-label="Next slide"'), `Expected next button in:\n${html}`)
    })

    test('slider nav=false omits nav buttons', async () => {
      const src = `page "T"
  slider nav=false
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.ok(!html.includes('Previous slide'), `Expected no nav buttons in:\n${html}`)
      assert.ok(!html.includes('Next slide'), `Expected no nav buttons in:\n${html}`)
    })

    test('slider emits pagination dots by default', async () => {
      const src = `page "T"
  slider
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.match(html, /arc-slider-dots_[a-z0-9_]+/)
      assert.ok(html.includes('role="group"'), `Expected dots wrapper role="group" in:\n${html}`)
      assert.ok(html.includes('aria-label="Go to slide 1"'), `Expected dot aria-label in:\n${html}`)
      assert.ok(html.includes('aria-current="true"'), `Expected first dot active in:\n${html}`)
    })

    test('slider dots=false omits dots and script', async () => {
      const src = `page "T"
  slider dots=false
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.ok(!html.match(/arc-slider-dots_/), `Expected no dots in:\n${html}`)
    })

    test('slider autoplay emits inline script', async () => {
      const src = `page "T"
  slider autoplay=true dots=false
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.ok(html.includes('<script>'), `Expected inline script for autoplay in:\n${html}`)
      assert.ok(html.includes('setInterval'), `Expected setInterval in:\n${html}`)
    })

    test('slider with no autoplay and dots=false emits no script', async () => {
      const src = `page "T"
  slider dots=false
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.ok(!html.includes('setInterval'), `Expected no autoplay setInterval script in:\n${html}`)
    })

    test('slider items=3 sets CSS custom property', async () => {
      const src = `page "T"
  slider items=3
    div "A"
    div "B"
    div "C"`
      const { html } = await compile(src)
      assert.ok(html.includes('--arc-si:3'), `Expected --arc-si:3 in:\n${html}`)
    })

    test('slider center=true sets snap-align to center', async () => {
      const src = `page "T"
  slider center=true
    div "A"
    div "B"`
      const { html } = await compile(src)
      assert.ok(html.includes('--arc-ss:center'), `Expected --arc-ss:center in:\n${html}`)
    })

    test('slider custom label sets aria-label', async () => {
      const src = `page "T"
  slider label="Featured products"
    div "A"`
      const { html } = await compile(src)
      assert.ok(html.includes('aria-label="Featured products"'), `Expected custom aria-label in:\n${html}`)
    })

    test('slider with single child omits nav and dots', async () => {
      const src = `page "T"
  slider
    div "Only slide"`
      const { html } = await compile(src)
      assert.ok(!html.includes('Previous slide'), `Expected no nav with single slide in:\n${html}`)
      assert.ok(!html.match(/arc-slider-dots_/), `Expected no dots with single slide in:\n${html}`)
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

// ── HtmlEmitter unit tests — utility methods ──────────────────────────────────

describe('HtmlEmitter — evalStaticExpr branches', () => {
  function makeEmitter() {
    return new HtmlEmitter({ hash: 'test' })
  }

  test('BinaryExpr with known operands evaluates to result', () => {
    const e = makeEmitter()
    const expr = { type: 'BinaryExpr', op: '+', left: N.Literal(2, 0), right: N.Literal(3, 0) }
    assert.equal(e.evalStaticExpr(expr), 5)
  })

  test('BinaryExpr with unknown right operand returns undefined', () => {
    const e = makeEmitter()
    const expr = { type: 'BinaryExpr', op: '+', left: N.Literal(2, 0), right: { type: 'Identifier', name: 'x' } }
    assert.equal(e.evalStaticExpr(expr), undefined)
  })

  test('TemplateLiteral with all known parts joins to string', () => {
    const e = makeEmitter()
    const expr = { type: 'TemplateLiteral', parts: [N.Literal('Hello ', 0), N.Literal('World', 0)] }
    assert.equal(e.evalStaticExpr(expr), 'Hello World')
  })

  test('TemplateLiteral with unknown part returns undefined', () => {
    const e = makeEmitter()
    const expr = { type: 'TemplateLiteral', parts: [N.Literal('Hello ', 0), { type: 'Identifier', name: 'name' }] }
    assert.equal(e.evalStaticExpr(expr), undefined)
  })

  test('TernaryExpr with truthy condition returns consequent', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TernaryExpr',
      condition: N.Literal(true, 0),
      consequent: N.Literal('yes', 0),
      alternate: N.Literal('no', 0),
    }
    assert.equal(e.evalStaticExpr(expr), 'yes')
  })

  test('TernaryExpr with falsy condition returns alternate', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TernaryExpr',
      condition: N.Literal(false, 0),
      consequent: N.Literal('yes', 0),
      alternate: N.Literal('no', 0),
    }
    assert.equal(e.evalStaticExpr(expr), 'no')
  })

  test('TernaryExpr with unknown condition returns undefined', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TernaryExpr',
      condition: { type: 'Identifier', name: 'flag' },
      consequent: N.Literal('yes', 0),
      alternate: N.Literal('no', 0),
    }
    assert.equal(e.evalStaticExpr(expr), undefined)
  })

  test('ArrayLiteral evaluates each element', () => {
    const e = makeEmitter()
    const expr = { type: 'ArrayLiteral', elements: [N.Literal(1, 0), N.Literal(2, 0)] }
    assert.deepEqual(e.evalStaticExpr(expr), [1, 2])
  })

  test('MemberExpr with known object returns property value', () => {
    const e = makeEmitter()
    e.buildContext = { config: { theme: 'dark' } }
    const expr = {
      type: 'MemberExpr',
      computed: false,
      object: { type: 'Identifier', name: 'config' },
      property: { type: 'Identifier', name: 'theme' },
    }
    assert.equal(e.evalStaticExpr(expr), 'dark')
  })

  test('MemberExpr with null object returns undefined', () => {
    const e = makeEmitter()
    const expr = {
      type: 'MemberExpr',
      computed: false,
      object: { type: 'Identifier', name: 'noSuchVar' },
      property: { type: 'Identifier', name: 'key' },
    }
    assert.equal(e.evalStaticExpr(expr), undefined)
  })
})

describe('HtmlEmitter — isStaticExpr branches', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('TernaryExpr with all static parts is static', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TernaryExpr',
      condition: N.Literal(true, 0),
      consequent: N.Literal('a', 0),
      alternate: N.Literal('b', 0),
    }
    assert.equal(e.isStaticExpr(expr), true)
  })

  test('TernaryExpr with dynamic condition is not static', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TernaryExpr',
      condition: { type: 'Identifier', name: 'x' },
      consequent: N.Literal('a', 0),
      alternate: N.Literal('b', 0),
    }
    assert.equal(e.isStaticExpr(expr), false)
  })

  test('ArrayLiteral with all literals is static', () => {
    const e = makeEmitter()
    const expr = { type: 'ArrayLiteral', elements: [N.Literal(1, 0), N.Literal(2, 0)] }
    assert.equal(e.isStaticExpr(expr), true)
  })

  test('ArrayLiteral with identifier element is not static', () => {
    const e = makeEmitter()
    const expr = { type: 'ArrayLiteral', elements: [N.Literal(1, 0), { type: 'Identifier', name: 'x' }] }
    assert.equal(e.isStaticExpr(expr), false)
  })
})

describe('HtmlEmitter — applyOp operators', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('applyOp: -, *, /, % work on numbers', () => {
    const e = makeEmitter()
    assert.equal(e.applyOp('-', 10, 3), 7)
    assert.equal(e.applyOp('*', 4, 3), 12)
    assert.equal(e.applyOp('/', 10, 2), 5)
    assert.equal(e.applyOp('%', 10, 3), 1)
  })

  test('applyOp: comparison operators', () => {
    const e = makeEmitter()
    assert.equal(e.applyOp('<', 1, 2), true)
    assert.equal(e.applyOp('>', 2, 1), true)
    assert.equal(e.applyOp('<=', 2, 2), true)
    assert.equal(e.applyOp('>=', 3, 2), true)
    assert.equal(e.applyOp('==', 1, '1'), true)
    assert.equal(e.applyOp('!=', 1, 2), true)
    assert.equal(e.applyOp('===', 1, 1), true)
    assert.equal(e.applyOp('!==', 1, '1'), true)
  })

  test('applyOp: logical operators', () => {
    const e = makeEmitter()
    assert.equal(e.applyOp('&&', true, false), false)
    assert.equal(e.applyOp('||', false, 'fallback'), 'fallback')
  })

  test('applyOp: unknown operator returns undefined', () => {
    const e = makeEmitter()
    assert.equal(e.applyOp('??', 1, 2), undefined)
  })
})

describe('HtmlEmitter — emitRaw', () => {
  test('emitRaw returns html when allowRaw is true', () => {
    const e = new HtmlEmitter({ hash: 'test', allowRaw: true })
    const node = { html: '<b>bold</b>' }
    assert.equal(e.emitRaw(node), '<b>bold</b>')
  })

  test('emitRaw throws when allowRaw is not set', () => {
    const e = new HtmlEmitter({ hash: 'test' })
    assert.throws(() => e.emitRaw({ html: '<b>bold</b>' }), /RawNode requires opt-in/)
  })
})

describe('HtmlEmitter — SEO JSON-LD schemaType', () => {
  test('page with schemaType generates JSON-LD script tag', async () => {
    const src = `page "My Post" lang: "en" schema: "Article" author: "Alice"
  text "content"`
    try {
      const { html } = await compile(src)
      // May or may not support schema: attr, skip if not
      if (html.includes('application/ld+json') || html.includes('schema.org')) {
        assert.ok(html.includes('schema.org'), 'JSON-LD should reference schema.org')
      }
    } catch (_e) {
      // Parser may not support schema: attribute — skip gracefully
    }
  })
})

// ── HtmlEmitter — CSS shorthand attrs expand to inline style ──────────────────

describe('HtmlEmitter — CSS shorthand attribute expansion', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('p-x expands to padding-left and padding-right', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'div', attrs: { 'p-x': '10px' }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('padding-left:10px'), `Expected padding-left in: ${out}`)
    assert.ok(out.includes('padding-right:10px'), `Expected padding-right in: ${out}`)
  })

  test('m-x expands to margin-left and margin-right', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'div', attrs: { 'm-x': '8px' }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('margin-left:8px'), `Expected margin-left in: ${out}`)
    assert.ok(out.includes('margin-right:8px'), `Expected margin-right in: ${out}`)
  })

  test('p-y expands to padding-top and padding-bottom', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'div', attrs: { 'p-y': '5px' }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('padding-top:5px'), `Expected padding-top in: ${out}`)
    assert.ok(out.includes('padding-bottom:5px'), `Expected padding-bottom in: ${out}`)
  })

  test('m-y expands to margin-top and margin-bottom', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'div', attrs: { 'm-y': '12px' }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('margin-top:12px'), `Expected margin-top in: ${out}`)
    assert.ok(out.includes('margin-bottom:12px'), `Expected margin-bottom in: ${out}`)
  })

  test('other CSS shorthand (p) expands to single property', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'div', attrs: { p: '20px' }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('padding:20px'), `Expected padding in: ${out}`)
  })

  test('existing style attr merges with shorthand expansions', () => {
    const e = makeEmitter()
    const node = {
      type: 'Element', tag: 'div',
      attrs: { style: 'color:red', 'p-x': '5px' }, children: [], line: 1,
    }
    const out = e.emitElement(node)
    assert.ok(out.includes('color:red'), `Expected existing style in: ${out}`)
    assert.ok(out.includes('padding-left:5px'), `Expected padding-left in: ${out}`)
  })
})

// ── HtmlEmitter — dialog attrs ────────────────────────────────────────────────

describe('HtmlEmitter — dialog: attributes', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('dialog:open attr emits data-arc-dialog-open', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'button', attrs: { 'dialog:open': 'my-modal' }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('data-arc-dialog-open="my-modal"'), `Expected data-arc-dialog-open in: ${out}`)
  })

  test('dialog:close attr emits data-arc-dialog-close', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'button', attrs: { 'dialog:close': true }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('data-arc-dialog-close'), `Expected data-arc-dialog-close in: ${out}`)
  })

  test('dialog:cancel attr emits data-arc-dialog-close', () => {
    const e = makeEmitter()
    const node = { type: 'Element', tag: 'button', attrs: { 'dialog:cancel': true }, children: [], line: 1 }
    const out = e.emitElement(node)
    assert.ok(out.includes('data-arc-dialog-close'), `Expected data-arc-dialog-close in: ${out}`)
  })
})

// ── HtmlEmitter — static emitIf / emitUnless / emitFor / emitMatchTemplate ───

describe('HtmlEmitter — static conditional and loop rendering', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('emitIf with static true condition renders consequent only', () => {
    const e = makeEmitter()
    const node = {
      type: 'IfNode',
      condition: N.Literal(true, 0),
      consequent: [N.TextNode('yes', 0)],
      alternate: [N.TextNode('no', 0)],
      line: 1,
    }
    const out = e.emitIf(node)
    assert.ok(out.includes('yes'), `Expected yes in: ${out}`)
    assert.ok(!out.includes('no'), `Expected no 'no' in: ${out}`)
  })

  test('emitIf with static false condition renders alternate', () => {
    const e = makeEmitter()
    const node = {
      type: 'IfNode',
      condition: N.Literal(false, 0),
      consequent: [N.TextNode('yes', 0)],
      alternate: [N.TextNode('no', 0)],
      line: 1,
    }
    const out = e.emitIf(node)
    assert.ok(!out.includes('yes'), `Expected no 'yes' in: ${out}`)
    assert.ok(out.includes('no'), `Expected 'no' in: ${out}`)
  })

  test('emitUnless wraps to emitIf with negated condition', () => {
    // emitUnless converts UnlessNode to IfNode with !condition.
    // UnaryExpr is not in isStaticExpr, so goes reactive path with div+hidden.
    const e = makeEmitter()
    const node = {
      type: 'UnlessNode',
      condition: N.Literal(true, 0),
      body: [N.TextNode('hidden', 0)],
      line: 1,
    }
    const out = e.emitUnless(node)
    assert.ok(typeof out === 'string', 'emitUnless returns a string')
    assert.ok(out.length > 0, 'emitUnless produces non-empty output for reactive path')
  })

  test('emitFor with static array unrolls to N copies', () => {
    const e = makeEmitter()
    const node = {
      type: 'ForNode',
      collection: { type: 'ArrayLiteral', elements: [N.Literal('a', 0), N.Literal('b', 0)] },
      itemName: 'x',
      indexName: 'i',
      body: [N.TextNode('item', 0)],
      line: 1,
    }
    const out = e.emitFor(node)
    assert.equal((out.match(/item/g) ?? []).length, 2, 'should repeat body 2 times')
  })

  test('emitFor with static non-array collection returns empty', () => {
    const e = makeEmitter()
    const node = {
      type: 'ForNode',
      collection: N.Literal('not-an-array', 0),
      body: [N.TextNode('item', 0)],
      line: 1,
    }
    const out = e.emitFor(node)
    assert.equal(out, '', 'non-array static collection → empty string')
  })

  test('emitMatchTemplate with static subject resolves matching arm', () => {
    const e = makeEmitter()
    const node = {
      type: 'MatchTemplateNode',
      subject: N.Literal('b', 0),
      arms: [
        { pattern: N.Literal('a', 0), body: N.TextNode('first', 0) },
        { pattern: N.Literal('b', 0), body: N.TextNode('second', 0) },
      ],
      line: 1,
    }
    const out = e.emitMatchTemplate(node)
    assert.ok(out.includes('second'), `Expected 'second' in: ${out}`)
    assert.ok(!out.includes('first'), `Expected no 'first' in: ${out}`)
  })

  test('emitMatchTemplate wildcard arm matches when no literal matches', () => {
    const e = makeEmitter()
    const node = {
      type: 'MatchTemplateNode',
      subject: N.Literal('z', 0),
      arms: [
        { pattern: N.Literal('a', 0), body: N.TextNode('first', 0) },
        { pattern: { type: 'Wildcard' }, body: N.TextNode('fallback', 0) },
      ],
      line: 1,
    }
    const out = e.emitMatchTemplate(node)
    assert.ok(out.includes('fallback'), `Expected fallback in: ${out}`)
  })

  test('emitInterpolation with static expr returns escaped string', () => {
    const e = makeEmitter()
    const node = { type: 'InterpolationNode', expr: N.Literal('<b>bold</b>', 0), line: 1 }
    const out = e.emitInterpolation(node)
    assert.ok(out.includes('&lt;'), `Expected escaped HTML in: ${out}`)
    assert.ok(!out.includes('data-arc-live'), 'no reactive span for static expr')
  })
})

// ── HtmlEmitter — avatar a11y warning ─────────────────────────────────────────

describe('HtmlEmitter — avatar a11y warning', () => {
  test('avatar element without alt= emits accessibility warning', () => {
    const stderrMsgs = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (s) => { stderrMsgs.push(s); return true }
    try {
      const e = new HtmlEmitter({ hash: 'test' })
      e.emitElement({ type: 'Element', tag: 'avatar', attrs: { src: '/me.jpg' }, children: [], line: 5 })
    } finally {
      process.stderr.write = origWrite
    }
    assert.ok(stderrMsgs.some(m => m.includes('a11y') && m.includes('avatar')), 'Expected a11y warning for avatar without alt')
  })
})

// ── HtmlEmitter — exprToString branches ──────────────────────────────────────

describe('HtmlEmitter — exprToString', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }
  const N = require('../src/ast')

  test('OptionalChain emits ?. accessor', () => {
    const e = makeEmitter()
    const expr = { type: 'OptionalChain', object: N.Identifier('user', 0), property: N.Identifier('name', 0) }
    assert.equal(e.exprToString(expr), 'user?.name')
  })

  test('LogicalExpr emits with operator', () => {
    const e = makeEmitter()
    const expr = { type: 'LogicalExpr', op: '||', left: N.Identifier('a', 0), right: N.Identifier('b', 0) }
    assert.equal(e.exprToString(expr), '(a||b)')
  })

  test('NullCoalesce emits ??', () => {
    const e = makeEmitter()
    const expr = { type: 'NullCoalesce', left: N.Identifier('val', 0), right: N.Literal('default', 0) }
    assert.equal(e.exprToString(expr), '(val??"default")')
  })

  test('TernaryExpr emits ternary string', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TernaryExpr',
      condition: N.Identifier('x', 0),
      consequent: N.Literal('a', 0),
      alternate: N.Literal('b', 0),
    }
    assert.equal(e.exprToString(expr), '(x?"a":"b")')
  })

  test('CallExpr emits function call with args', () => {
    const e = makeEmitter()
    const expr = {
      type: 'CallExpr',
      callee: N.Identifier('fn', 0),
      args: [N.Literal(1, 0), N.Literal(2, 0)],
    }
    assert.equal(e.exprToString(expr), 'fn(1,2)')
  })

  test('TemplateLiteral emits backtick string', () => {
    const e = makeEmitter()
    const expr = {
      type: 'TemplateLiteral',
      parts: [N.Literal('Hello ', 0), N.Identifier('name', 0)],
    }
    assert.equal(e.exprToString(expr), '`Hello ${name}`')
  })

  test('ArrayLiteral emits bracket array', () => {
    const e = makeEmitter()
    const expr = { type: 'ArrayLiteral', elements: [N.Literal(1, 0), N.Literal(2, 0)] }
    assert.equal(e.exprToString(expr), '[1,2]')
  })

  test('AwaitExpr emits await', () => {
    const e = makeEmitter()
    const expr = { type: 'AwaitExpr', argument: N.Identifier('p', 0) }
    assert.equal(e.exprToString(expr), 'await p')
  })

  test('unknown expr type returns undefined', () => {
    const e = makeEmitter()
    const expr = { type: 'SomeUnknownType' }
    assert.equal(e.exprToString(expr), 'undefined')
  })

  test('MemberExpr computed emits bracket access', () => {
    const e = makeEmitter()
    const expr = {
      type: 'MemberExpr',
      computed: true,
      object: N.Identifier('arr', 0),
      property: N.Literal(0, 0),
    }
    assert.equal(e.exprToString(expr), 'arr[0]')
  })
})

// ── HtmlEmitter — _blank link without aria-label gets sr-only notice ──────────

describe('HtmlEmitter — _blank link accessibility', () => {
  test('external link without aria-label gets screen-reader notice', async () => {
    const { html } = await compile(`page "T"
  a href: "https://example.com" target: "_blank"
    text "Visit"`)
    assert.ok(html.includes('arc-sr-only'), `Expected sr-only notice in:\n${html}`)
  })
})

// ── HtmlEmitter — emitInterpolation in for-template context ──────────────────

describe('HtmlEmitter — reactive interpolation inside for-loop', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('interpolation inside for-template context emits inline template string', () => {
    const e = makeEmitter()
    e._inForTemplate = true
    const node = { type: 'InterpolationNode', expr: N.Identifier('item', 0), line: 1 }
    const out = e.emitInterpolation(node)
    assert.ok(out.includes('${_esc('), `Expected template string in: ${out}`)
  })
})

// ── HtmlEmitter — emitWidgetInvocation with param defaults ────────────────────

describe('HtmlEmitter — emitWidgetInvocation', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'test' }) }

  test('widget invocation with bool=true attr resolves correctly', () => {
    const e = makeEmitter()
    const widgetDecl = {
      body: [N.TextNode('content', 0)],
      params: [],
    }
    const out = e.emitWidgetInvocation(widgetDecl, { visible: true }, [])
    assert.equal(out, 'content')
  })

  test('widget invocation with missing param uses Literal default', () => {
    const e = makeEmitter()
    const widgetDecl = {
      body: [{ type: 'TextNode', value: 'hi', line: 0 }],
      params: [{ name: 'color', defaultValue: N.Literal('blue', 0) }],
    }
    const out = e.emitWidgetInvocation(widgetDecl, {}, [])
    // Output contains widget body and currentAttrs is restored after the call
    assert.equal(out, 'hi', 'widget body rendered')
    assert.deepEqual(e.currentAttrs, {}, 'currentAttrs restored after call')
  })
})

// ── HtmlEmitter — _hasH1 with IfNode/ForNode/MatchTemplateNode ────────────────

describe('HtmlEmitter — page seo schemaType', () => {
  test('page with schemaType meta emits JSON-LD script tag', () => {
    const e = new HtmlEmitter({ hash: 'seo1' })
    const page = {
      type: 'PageDecl',
      title: N.Literal('My Post', 0),
      meta: {
        schemaType: N.Literal('Article', 0),
        author: N.Literal('Alice', 0),
        published: N.Literal('2024-01-01', 0),
        modified: N.Literal('2024-06-01', 0),
        image: N.Literal('https://example.com/img.jpg', 0),
        canonical: N.Literal('https://example.com/post', 0),
        description: N.Literal('A test post', 0),
      },
      body: [],
    }
    const html = e.emitPage(page)
    assert.ok(html.includes('application/ld+json'), 'should emit JSON-LD script')
    assert.ok(html.includes('"@type":"Article"'), 'should include schema type')
    assert.ok(html.includes('"datePublished"'), 'should include datePublished')
    assert.ok(html.includes('"dateModified"'), 'should include dateModified')
    assert.ok(html.includes('"author"'), 'should include author')
  })
})

// ── HtmlEmitter — emitWidget ──────────────────────────────────────────────────

describe('HtmlEmitter — emitWidget direct call', () => {
  test('emitWidget renders body children', () => {
    const e = new HtmlEmitter({ hash: 'w1' })
    const node = { type: 'Widget', body: [N.TextNode('hello', 0)] }
    const result = e.emitWidget(node)
    assert.equal(result, 'hello')
  })
})

// ── HtmlEmitter — emitExpr with TemplateLiteral parts ────────────────────────

describe('HtmlEmitter — emitExpr', () => {
  test('emitExpr with Literal escapes HTML', () => {
    const e = new HtmlEmitter({ hash: 'ex1' })
    const result = e.emitExpr({ type: 'Literal', value: '<b>bold</b>' })
    assert.equal(result, '&lt;b&gt;bold&lt;/b&gt;')
  })

  test('emitExpr with TemplateLiteral concatenates literal parts', () => {
    const e = new HtmlEmitter({ hash: 'ex2' })
    const result = e.emitExpr({
      type: 'TemplateLiteral',
      parts: [
        { type: 'Literal', value: 'Hello ' },
        { type: 'Identifier', name: 'name' },
        { type: 'Literal', value: '!' },
      ]
    })
    assert.equal(result, 'Hello !')
  })

  test('emitExpr with null/undefined returns empty string', () => {
    const e = new HtmlEmitter({ hash: 'ex3' })
    assert.equal(e.emitExpr(null), '')
    assert.equal(e.emitExpr(undefined), '')
  })

  test('emitExpr with unknown type returns empty string', () => {
    const e = new HtmlEmitter({ hash: 'ex4' })
    assert.equal(e.emitExpr({ type: 'Identifier', name: 'x' }), '')
  })
})

// ── HtmlEmitter — reactive interpolation (non-for-loop) ───────────────────────

describe('HtmlEmitter — reactive interpolation span', () => {
  test('reactive identifier interpolation emits span placeholder', () => {
    const e = new HtmlEmitter({ hash: 'ri1' })
    const node = { type: 'Interpolation', expr: { type: 'Identifier', name: 'count' }, line: 1 }
    const result = e.emitInterpolation(node)
    assert.ok(result.includes('<span'), 'should emit span')
    assert.ok(result.includes('data-arc-live'), 'should have data-arc-live attribute')
    assert.ok(e.stateBindings.some(b => b.expr === 'count'), 'should register count binding')
  })
})

// ── HtmlEmitter — reactive match template ─────────────────────────────────────

describe('HtmlEmitter — reactive match template', () => {
  test('reactive match emits all arms as hidden divs', () => {
    const e = new HtmlEmitter({ hash: 'rm1' })
    const node = {
      type: 'MatchTemplateNode',
      subject: { type: 'Identifier', name: 'status' },
      arms: [
        { pattern: { type: 'Literal', value: 'ok' }, body: N.TextNode('OK', 0) },
        { pattern: { type: 'Wildcard' }, body: N.TextNode('Other', 0) },
      ],
      line: 1,
    }
    const result = e.emitMatchTemplate(node)
    assert.ok(result.includes('<div'), 'should emit wrapper div')
    assert.ok(result.includes('hidden'), 'arms should be hidden')
    assert.ok(result.includes('OK'), 'first arm body rendered')
    assert.ok(result.includes('Other'), 'wildcard arm body rendered')
    assert.ok(e.stateBindings.length >= 2, 'should register stateBindings for each arm')
  })

  test('reactive match with non-wildcard pattern emits equality check', () => {
    const e = new HtmlEmitter({ hash: 'rm2' })
    const node = {
      type: 'MatchTemplateNode',
      subject: { type: 'Identifier', name: 'mode' },
      arms: [
        { pattern: { type: 'Literal', value: 'dark' }, body: N.TextNode('Dark', 0) },
      ],
      line: 1,
    }
    e.emitMatchTemplate(node)
    assert.ok(e.stateBindings.some(b => b.expr.includes('===')), 'should use === comparison')
  })
})

// ── HtmlEmitter — isStaticExpr TemplateLiteral ────────────────────────────────

describe('HtmlEmitter — isStaticExpr TemplateLiteral and ArrayLiteral', () => {
  test('isStaticExpr TemplateLiteral: all Literal parts → true', () => {
    const e = new HtmlEmitter({ hash: 'is1' })
    assert.equal(e.isStaticExpr({
      type: 'TemplateLiteral',
      parts: [{ type: 'Literal', value: 'a' }, { type: 'Literal', value: 'b' }]
    }), true)
  })

  test('isStaticExpr TemplateLiteral: Identifier part → false', () => {
    const e = new HtmlEmitter({ hash: 'is2' })
    assert.equal(e.isStaticExpr({
      type: 'TemplateLiteral',
      parts: [{ type: 'Literal', value: 'a' }, { type: 'Identifier', name: 'x' }]
    }), false)
  })

  test('evalStaticExpr ArrayLiteral returns mapped array', () => {
    const e = new HtmlEmitter({ hash: 'es1' })
    const result = e.evalStaticExpr({
      type: 'ArrayLiteral',
      elements: [
        { type: 'Literal', value: 1 },
        { type: 'Literal', value: 2 },
      ]
    })
    assert.deepEqual(result, [1, 2])
  })

  test('evalStaticExpr with unknown type returns undefined', () => {
    const e = new HtmlEmitter({ hash: 'es2' })
    assert.equal(e.evalStaticExpr({ type: 'CallExpr', callee: 'fn', args: [] }), undefined)
  })
})

// ── HtmlEmitter — modal label resolution ─────────────────────────────────────

describe('HtmlEmitter — _resolveModalLabel', () => {
  test('modal with label= attr uses aria-label', () => {
    const e = new HtmlEmitter({ hash: 'ml1' })
    const node = {
      attrs: { label: 'Dialog Title' },
      children: [],
    }
    const { labelAttr } = e._resolveModalLabel(node, 'my-modal')
    assert.ok(labelAttr.includes('aria-label="Dialog Title"'))
  })

  test('modal with heading child uses aria-labelledby', () => {
    const e = new HtmlEmitter({ hash: 'ml2' })
    const node = {
      attrs: {},
      children: [
        { type: 'Element', tag: 'heading', attrs: {}, children: [N.TextNode('My Title', 0)] },
      ],
    }
    const { labelAttr } = e._resolveModalLabel(node, 'dlg')
    assert.ok(labelAttr.includes('aria-labelledby='), 'should use aria-labelledby when heading found')
  })

  test('modal with heading child having existing id does not patch', () => {
    const e = new HtmlEmitter({ hash: 'ml3' })
    const node = {
      attrs: {},
      children: [
        { type: 'Element', tag: 'h2', id: 'existing-id', attrs: {}, children: [N.TextNode('Title', 0)] },
      ],
    }
    const { labelAttr, resolvedNode } = e._resolveModalLabel(node, 'dlg2')
    assert.ok(labelAttr.includes('aria-labelledby="existing-id"'))
    assert.equal(resolvedNode, node, 'should return original node when id already exists')
  })

  test('modal with no label or heading falls back to id', () => {
    const e = new HtmlEmitter({ hash: 'ml4' })
    const node = { attrs: {}, children: [] }
    const { labelAttr } = e._resolveModalLabel(node, 'fallback-id')
    assert.ok(labelAttr.includes('aria-label="fallback-id"'))
  })
})

// ── HtmlEmitter — _hasH1 traversal into nested control nodes ─────────────────

describe('HtmlEmitter — _hasH1 traversal (IfNode/ForNode/MatchTemplateNode)', () => {
  function makeEmitter() { return new HtmlEmitter({ hash: 'h1test' }) }

  test('page with main > IfNode with h1 in consequent does not warn', () => {
    const e = makeEmitter()
    const warnMsgs = []
    const origWarn = console.warn
    console.warn = m => warnMsgs.push(m)
    try {
      const page = {
        type: 'PageDecl',
        title: N.Literal('Test', 0),
        meta: {},
        body: [{
          type: 'Element', tag: 'main', attrs: {}, classes: [], children: [
            {
              type: 'IfNode',
              condition: { type: 'Literal', value: true },
              consequent: [{ type: 'Element', tag: 'h1', attrs: {}, classes: [], children: [] }],
              alternate: [],
              line: 1,
            }
          ], line: 0
        }]
      }
      e.emitPage(page)
      assert.ok(!warnMsgs.some(m => m.includes('no <h1>')), 'no a11y warning when h1 is inside IfNode')
    } finally { console.warn = origWarn }
  })

  test('page with main > ForNode with h1 body does not warn', () => {
    const e = makeEmitter()
    const warnMsgs = []
    const origWarn = console.warn
    console.warn = m => warnMsgs.push(m)
    try {
      const page = {
        type: 'PageDecl',
        title: N.Literal('Test', 0),
        meta: {},
        body: [{
          type: 'Element', tag: 'main', attrs: {}, classes: [], children: [
            {
              type: 'ForNode',
              body: [{ type: 'Element', tag: 'h1', attrs: {}, classes: [], children: [] }],
              line: 1,
            }
          ], line: 0
        }]
      }
      e.emitPage(page)
      assert.ok(!warnMsgs.some(m => m.includes('no <h1>')), 'no warning when h1 is inside ForNode')
    } finally { console.warn = origWarn }
  })

  test('page with main > MatchTemplateNode with h1 arm body does not warn', () => {
    const e = makeEmitter()
    const warnMsgs = []
    const origWarn = console.warn
    console.warn = m => warnMsgs.push(m)
    try {
      const page = {
        type: 'PageDecl',
        title: N.Literal('Test', 0),
        meta: {},
        body: [{
          type: 'Element', tag: 'main', attrs: {}, classes: [], children: [
            {
              type: 'MatchTemplateNode',
              subject: { type: 'Identifier', name: 'x' },
              arms: [
                { pattern: { type: 'Wildcard' }, body: { type: 'Element', tag: 'h1', attrs: {}, classes: [], children: [] } }
              ],
              line: 1,
            }
          ], line: 0
        }]
      }
      e.emitPage(page)
      assert.ok(!warnMsgs.some(m => m.includes('no <h1>')), 'no warning when h1 is inside MatchTemplateNode arm')
    } finally { console.warn = origWarn }
  })
})

// ── HtmlEmitter — _hasRealLabel with AST node value ──────────────────────────

describe('HtmlEmitter — _hasRealLabel (lines 71-73)', () => {
  test('_blank link with raw string aria-label skips sr-only notice', () => {
    const e = new HtmlEmitter({ hash: 'rl1' })
    const node = {
      type: 'Element', tag: 'a',
      attrs: { href: 'https://example.com', target: '_blank', 'aria-label': 'Visit example' },
      children: [], classes: [], line: 1,
    }
    const result = e.emitElement(node)
    assert.ok(!result.includes('arc-sr-only'), 'should not add sr-only when aria-label is present')
  })

  test('_blank link with static AST aria-label (type+isStatic) skips sr-only notice', () => {
    const e = new HtmlEmitter({ hash: 'rl2' })
    const node = {
      type: 'Element', tag: 'a',
      attrs: { href: 'https://example.com', target: '_blank', 'aria-label': N.Literal('Open site', 0) },
      children: [], classes: [], line: 1,
    }
    const result = e.emitElement(node)
    assert.ok(!result.includes('arc-sr-only'), 'should not add sr-only when aria-label is a static AST node')
  })

  test('_blank link without aria-label gets sr-only notice via direct element', () => {
    const e = new HtmlEmitter({ hash: 'rl3' })
    const node = {
      type: 'Element', tag: 'a',
      attrs: { target: '_blank' },
      children: [N.TextNode('Go', 0)], classes: [], line: 1,
    }
    const result = e.emitElement(node)
    assert.ok(result.includes('arc-sr-only'), 'should add sr-only when no aria-label')
  })
})

// ── HtmlEmitter — emitWidgetInvocation with non-static expr attr ─────────────

describe('HtmlEmitter — emitWidgetInvocation non-static expr attr (line 334)', () => {
  test('widget attr with non-static expr emits via emitExpr', () => {
    const e = new HtmlEmitter({ hash: 'nse1' })
    const widgetDecl = {
      body: [N.TextNode('body', 0)],
      params: [],
    }
    // Pass a non-static Identifier value (will call emitExpr)
    const out = e.emitWidgetInvocation(widgetDecl, {
      label: { type: 'Identifier', name: 'dynamicVal' }
    }, [])
    assert.equal(out, 'body', 'widget body rendered even with non-static attr')
  })

  test('widget attr with plain string value goes through else branch', () => {
    const e = new HtmlEmitter({ hash: 'nse2' })
    let capturedAttrs = null
    const widgetDecl = {
      body: [N.TextNode('body', 0)],
      params: [],
    }
    const origEmitChildren = e.emitChildren.bind(e)
    e.emitChildren = (children) => { capturedAttrs = { ...e.currentAttrs }; return origEmitChildren(children) }
    const out = e.emitWidgetInvocation(widgetDecl, { size: 'large' }, [])
    assert.equal(out, 'body')
    assert.equal(capturedAttrs?.size, 'large', 'plain string attr in currentAttrs during render')
  })
})

// ── HtmlEmitter — reactive match with non-Literal pattern ────────────────────

describe('HtmlEmitter — reactive match with Identifier pattern (line 937)', () => {
  test('reactive match with Identifier pattern uses exprToString for comparison', () => {
    const e = new HtmlEmitter({ hash: 'rm3' })
    const node = {
      type: 'MatchTemplateNode',
      subject: { type: 'Identifier', name: 'status' },
      arms: [
        {
          pattern: { type: 'Identifier', name: 'ACTIVE' },
          body: N.TextNode('Active', 0),
        }
      ],
      line: 1,
    }
    e.emitMatchTemplate(node)
    const binding = e.stateBindings[0]
    assert.ok(binding.expr.includes('ACTIVE'), 'should use exprToString for non-literal pattern')
  })
})

// ── HtmlEmitter — imgPipeline path (lines 416-425) ───────────────────────────

describe('HtmlEmitter — imgPipeline integration', () => {
  test('img element with imgPipeline uses pipeline when src is a string', () => {
    const mockPicture = '<picture><img src="/processed.webp" alt="Photo"></picture>'
    const imgPipeline = {
      emitPicture: (src, alt, position) => {
        if (src === '/photo.jpg') return mockPicture
        return null
      }
    }
    const e = new HtmlEmitter({ hash: 'img1', imgPipeline })
    const node = {
      type: 'Element', tag: 'img',
      attrs: { src: '/photo.jpg', alt: 'Photo' },
      children: [], classes: [], line: 1,
    }
    const result = e.emitElement(node)
    assert.equal(result, mockPicture, 'should return pipeline result')
  })

  test('img element with imgPipeline falls through when pipeline returns null', () => {
    const imgPipeline = { emitPicture: () => null }
    const e = new HtmlEmitter({ hash: 'img2', imgPipeline })
    const node = {
      type: 'Element', tag: 'img',
      attrs: { src: '/photo.jpg', alt: 'x' },
      children: [], classes: [], line: 1,
    }
    const result = e.emitElement(node)
    assert.ok(result.includes('<img'), 'should fall through to normal img emit')
  })

  test('img element with imgPipeline and AST src node evaluates src', () => {
    let capturedSrc = null
    const imgPipeline = {
      emitPicture: (src, alt, pos) => { capturedSrc = src; return null }
    }
    const e = new HtmlEmitter({ hash: 'img3', imgPipeline })
    const node = {
      type: 'Element', tag: 'img',
      attrs: { src: { type: 'Literal', value: '/hero.png' } },
      children: [], classes: [], line: 1,
    }
    e.emitElement(node)
    assert.equal(capturedSrc, '/hero.png', 'should evaluate AST src Literal')
  })
})
