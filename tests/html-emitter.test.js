'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { compile } = require('../src/cli')

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
    test('heading emits <h2>', async () => {
      const { html } = await compile('page "T"\n  heading "Title"')
      assert.ok(html.includes('<h2'), `Expected <h2 in:\n${html}`)
      assert.ok(html.includes('Title'), `Expected "Title" in:\n${html}`)
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

    test('button with trigger becomes popovertarget', async () => {
      const { html } = await compile('page "T"\n  button trigger="x" "Open"')
      assert.ok(html.includes('popovertarget="x"'), `Expected popovertarget="x" in:\n${html}`)
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
      // Loop is unrolled — should contain heading elements
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
      assert.match(html, /<span id="_a\d+" aria-live="polite"><\/span>/, `Expected reactive span in:\n${html}`)
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

})
