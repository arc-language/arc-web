'use strict'

// Integration tests: build each example and verify compiled output.
// These tests exercise the full compiler pipeline end-to-end:
// lex → parse → check → optimize → emit HTML/CSS/JS → post-process

const { test, describe, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { compile } = require('../src/cli')

// ── Helpers ───────────────────────────────────────────────────────────────────

function readExample(name) {
  const p = path.join(__dirname, '..', 'examples', name, 'index.arc')
  return fs.readFileSync(p, 'utf8')
}

async function buildExample(name) {
  const src = readExample(name)
  const filename = `examples/${name}/index.arc`
  const projectDir = path.join(__dirname, '..', 'examples', name)
  return compile(src, filename, { projectDir })
}

// ── hello ────────────────────────────────────────────────────────────────────

describe('integration: hello example', () => {
  let result

  before(async () => { result = await buildExample('hello') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'), 'missing doctype')
    assert.ok(result.html.includes('</html>'), 'missing closing html')
  })

  test('HTML contains page title', () => {
    assert.ok(result.html.includes('<title>'), 'missing title tag')
  })

  test('zero JS for static page', () => {
    assert.equal(result.js.trim(), '', `expected no JS, got: ${result.js.slice(0, 100)}`)
  })

  test('produces some CSS', () => {
    assert.ok(result.css.trim().length > 0, 'expected some CSS')
  })

  test('HTML contains hello content', () => {
    const lower = result.html.toLowerCase()
    assert.ok(lower.includes('hello') || lower.includes('arc'), 'missing hello content')
  })
})

// ── counter ───────────────────────────────────────────────────────────────────

describe('integration: counter example', () => {
  let result

  before(async () => { result = await buildExample('counter') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'))
    assert.ok(result.html.includes('</html>'))
  })

  test('emits client JS for @state reactivity', () => {
    assert.ok(result.js.trim().length > 0, 'counter needs JS for @state')
  })

  test('JS contains a DOM update setter', () => {
    // The JS emitter produces setters like _setCount or direct DOM update functions
    assert.ok(
      result.js.includes('textContent') || result.js.includes('innerHTML') || result.js.includes('function'),
      'expected DOM manipulation in JS'
    )
  })

  test('HTML has a button element', () => {
    assert.ok(result.html.includes('<button'), 'expected button in counter HTML')
  })

  test('JS is reasonably small (< 5KB)', () => {
    const size = Buffer.byteLength(result.js)
    assert.ok(size < 5120, `JS too large: ${size} bytes`)
  })
})

// ── blog ─────────────────────────────────────────────────────────────────────

describe('integration: blog example', () => {
  let result

  before(async () => { result = await buildExample('blog') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'))
    assert.ok(result.html.includes('</html>'))
  })

  test('zero or minimal JS (blog is static)', () => {
    // Blog may have no JS at all (pure @build data), or minimal
    const size = Buffer.byteLength(result.js ?? '')
    assert.ok(size < 2048, `Blog JS should be minimal, got ${size} bytes`)
  })

  test('HTML is substantial (blog posts inlined)', () => {
    const size = Buffer.byteLength(result.html)
    assert.ok(size > 200, `Blog HTML should contain content, got ${size} bytes`)
  })
})

// ── dashboard ─────────────────────────────────────────────────────────────────

describe('integration: dashboard example', () => {
  let result

  before(async () => { result = await buildExample('dashboard') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'))
    assert.ok(result.html.includes('</html>'))
  })

  test('produces HTML and CSS', () => {
    assert.ok(result.html.length > 0)
    assert.ok(result.css.length > 0)
  })
})

// ── patterns ─────────────────────────────────────────────────────────────────

describe('integration: patterns example', () => {
  let result

  before(async () => { result = await buildExample('patterns') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'))
    assert.ok(result.html.includes('</html>'))
  })

  test('accordion uses <details> (zero JS native pattern)', () => {
    assert.ok(result.html.includes('<details'), 'expected <details> element')
  })

  test('modal uses popover API (zero JS)', () => {
    // Popover-based modals don't need JS
    assert.ok(
      result.html.includes('popover') || result.html.includes('dialog'),
      'expected popover or dialog element'
    )
  })
})

// ── live ─────────────────────────────────────────────────────────────────────

describe('integration: live example', () => {
  let result

  before(async () => { result = await buildExample('live') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'))
    assert.ok(result.html.includes('</html>'))
  })

  test('produces edge renderer for @live', () => {
    // The live example uses @live, so the renderer must be non-empty
    // and contain the WinterCG fetch handler boilerplate.
    assert.ok(result.liveEdgeFunction.length > 0, 'live example must produce edge renderer')
    assert.ok(result.liveEdgeFunction.includes('fetch') || result.liveEdgeFunction.includes('_resolveData'),
      `expected fetch handler in renderer: ${result.liveEdgeFunction.slice(0, 200)}`)
  })
})

// ── chat ─────────────────────────────────────────────────────────────────────

describe('integration: chat example', () => {
  let result

  before(async () => { result = await buildExample('chat') })

  test('produces valid HTML', () => {
    assert.ok(result.html.includes('<!DOCTYPE html>'))
    assert.ok(result.html.includes('</html>'))
  })

  test('has realtime JS or server functions', () => {
    // Chat needs either @realtime client code or @server functions
    const hasJs = result.js.trim().length > 0
    const hasEdge = (result.edgeFunctions ?? '').trim().length > 0
    assert.ok(hasJs || hasEdge, 'chat should produce JS or edge functions')
  })
})

// ── HTML correctness ──────────────────────────────────────────────────────────

describe('integration: HTML structural correctness', () => {
  const examples = ['hello', 'counter', 'blog', 'dashboard']

  for (const name of examples) {
    test(`${name}: HTML has <head> and <body>`, async () => {
      const { html } = await buildExample(name)
      assert.ok(html.includes('<head>') || html.includes('<head '), `${name}: missing <head>`)
      assert.ok(html.includes('<body>') || html.includes('<body '), `${name}: missing <body>`)
    })
  }

  for (const name of examples) {
    test(`${name}: HTML has charset meta`, async () => {
      const { html } = await buildExample(name)
      assert.ok(html.includes('charset') || html.includes('UTF-8'), `${name}: missing charset`)
    })
  }

  for (const name of examples) {
    test(`${name}: HTML has viewport meta`, async () => {
      const { html } = await buildExample(name)
      assert.ok(html.includes('viewport'), `${name}: missing viewport meta`)
    })
  }
})

// ── CSS correctness ───────────────────────────────────────────────────────────

describe('integration: CSS structural correctness', () => {
  test('counter: CSS is non-empty', async () => {
    const { css } = await buildExample('counter')
    assert.ok(css.trim().length > 0)
  })

  test('hello: CSS uses @layer', async () => {
    const { css } = await buildExample('hello')
    // Arc emits CSS in @layer blocks. The hello example has a design block,
    // so CSS must be non-empty and contain @layer.
    assert.ok(css.length > 0, 'hello example must produce CSS')
    assert.ok(css.includes('@layer'), `expected @layer in CSS, got: ${css.slice(0, 200)}`)
  })

  test('CSS has no syntax errors (basic bracket balance)', async () => {
    for (const name of ['hello', 'counter', 'blog']) {
      const { css } = await buildExample(name)
      let depth = 0
      let inString = false
      for (const ch of css) {
        if (ch === '"' || ch === "'") inString = !inString
        if (inString) continue
        if (ch === '{') depth++
        if (ch === '}') depth--
      }
      assert.equal(depth, 0, `${name}: CSS has unbalanced braces (depth=${depth})`)
    }
  })
})

// ── JS correctness ────────────────────────────────────────────────────────────

describe('integration: JS correctness', () => {
  test('counter JS: contains event listener or click handler', async () => {
    const { js } = await buildExample('counter')
    assert.ok(
      js.includes('addEventListener') || js.includes('onclick') || js.includes('click'),
      'counter JS should have click handling'
    )
  })

  test('counter JS: contains DOM text update', async () => {
    const { js } = await buildExample('counter')
    assert.ok(
      js.includes('textContent') || js.includes('innerHTML'),
      'counter JS should update DOM text'
    )
  })

  test('hello JS: is empty (no reactivity needed)', async () => {
    const { js } = await buildExample('hello')
    assert.equal(js.trim(), '', 'hello page should produce no JS')
  })
})

// ── Compiler error handling ───────────────────────────────────────────────────

describe('integration: compiler error handling', () => {
  test('undefined variable causes compile error', async () => {
    const src = 'page "T"\n  text "{notDeclared}"'
    await assert.rejects(
      () => compile(src, 'test.arc', {}),
      /Undefined variable/
    )
  })

  test('duplicate @state declaration causes error', async () => {
    const src = 'page "T"\n  @state let x = 0\n  @state let x = 1'
    await assert.rejects(
      () => compile(src, 'test.arc', {}),
      /Duplicate declaration/
    )
  })

  test('undefined variable in event handler causes error', async () => {
    const src = 'page "T"\n  button on:click={ undeclaredFn() } "Go"'
    await assert.rejects(
      () => compile(src, 'test.arc', {}),
      /Undefined variable/
    )
  })

  test('clean source compiles without error', async () => {
    const src = 'page "Hello"\n  text "world"'
    const result = await compile(src, 'test.arc', {})
    assert.ok(result.html.includes('world'))
  })
})

// ── Output size sanity checks ─────────────────────────────────────────────────

describe('integration: output size', () => {
  test('hello HTML is reasonably sized (< 10KB)', async () => {
    const { html } = await buildExample('hello')
    assert.ok(Buffer.byteLength(html) < 10240, `Hello HTML too large: ${Buffer.byteLength(html)} bytes`)
  })

  test('counter JS is minimal (< 3KB without ADP runtime)', async () => {
    const { js } = await buildExample('counter')
    // Strip the ADP runtime header comment if present
    const size = Buffer.byteLength(js)
    assert.ok(size < 3072, `Counter JS too large: ${size} bytes`)
  })

  test('no example produces JS > 50KB', async () => {
    for (const name of ['hello', 'counter', 'blog', 'dashboard']) {
      const { js } = await buildExample(name)
      const size = Buffer.byteLength(js ?? '')
      assert.ok(size < 51200, `${name} JS too large: ${size} bytes`)
    }
  })
})
