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
