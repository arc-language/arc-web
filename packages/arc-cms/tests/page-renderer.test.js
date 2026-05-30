'use strict'

const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert')

// Clear module cache so _purgeCache tests get a fresh in-process cache
// and so we can reload if needed.
function loadModule() {
  // Delete cached version so each top-level suite gets the same live module
  const key = require.resolve('../src/server/page-renderer')
  delete require.cache[key]
  return require('../src/server/page-renderer')
}

const { esc, escAttr, RENDERERS, _purgeCache, renderCmsPage } = loadModule()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb({ page = null, blocks = [], theme = null } = {}) {
  return {
    query(sql) {
      if (sql.includes('pages'))      return { get: () => page }
      if (sql.includes('pageblocks')) return { all: () => blocks }
      if (sql.includes('themes'))     return { get: () => theme }
      return { get: () => null, all: () => [] }
    }
  }
}

function makePage(overrides = {}) {
  return {
    slug: 'test-page',
    title: 'Test Page',
    published: 1,
    metaDescription: 'A test page',
    ogImage: null,
    themeId: null,
    ...overrides,
  }
}

function makeBlock(type, data, overrides = {}) {
  return {
    type,
    data: JSON.stringify(data),
    visible: 1,
    ...overrides,
  }
}

function fakeReq(url = 'http://localhost/p/test-page') {
  return { url }
}

// Parse headers from a Response-like object
async function getBody(resp) {
  if (typeof resp.text === 'function') return resp.text()
  return resp.body ? String(resp.body) : ''
}

// ---------------------------------------------------------------------------
// 1. esc() and escAttr()
// ---------------------------------------------------------------------------

describe('esc()', () => {
  test('escapes & character', () => {
    assert.strictEqual(esc('a & b'), 'a &amp; b')
  })
  test('escapes < character', () => {
    assert.strictEqual(esc('<tag>'), '&lt;tag&gt;')
  })
  test('escapes > character', () => {
    assert.strictEqual(esc('a > b'), 'a &gt; b')
  })
  test('escapes double quote', () => {
    assert.strictEqual(esc('"hello"'), '&quot;hello&quot;')
  })
  test('escapes single quote', () => {
    assert.strictEqual(esc("it's"), "it&#39;s")
  })
  test('escapes all special chars in one string', () => {
    assert.strictEqual(esc(`<"a" & 'b'>`), '&lt;&quot;a&quot; &amp; &#39;b&#39;&gt;')
  })
  test('null input returns empty string', () => {
    assert.strictEqual(esc(null), '')
  })
  test('undefined input returns empty string', () => {
    assert.strictEqual(esc(undefined), '')
  })
  test('non-string number input is coerced', () => {
    assert.strictEqual(esc(42), '42')
  })
  test('non-string boolean input is coerced', () => {
    assert.strictEqual(esc(true), 'true')
  })
  test('plain string with no special chars is unchanged', () => {
    assert.strictEqual(esc('hello world'), 'hello world')
  })
  test('empty string returns empty string', () => {
    assert.strictEqual(esc(''), '')
  })
})

describe('escAttr()', () => {
  test('escapes & character', () => {
    assert.strictEqual(escAttr('a & b'), 'a &amp; b')
  })
  test('escapes < character', () => {
    assert.strictEqual(escAttr('<tag>'), '&lt;tag&gt;')
  })
  test('escapes > character', () => {
    assert.strictEqual(escAttr('a > b'), 'a &gt; b')
  })
  test('escapes double quote', () => {
    assert.strictEqual(escAttr('"hello"'), '&quot;hello&quot;')
  })
  test('escapes single quote', () => {
    assert.strictEqual(escAttr("it's"), "it&#39;s")
  })
  test('null input returns empty string', () => {
    assert.strictEqual(escAttr(null), '')
  })
  test('undefined input returns empty string', () => {
    assert.strictEqual(escAttr(undefined), '')
  })
  test('non-string number input is coerced', () => {
    assert.strictEqual(escAttr(99), '99')
  })
})

// ---------------------------------------------------------------------------
// 2. baseStyle() — accessed indirectly through RENDERERS
// ---------------------------------------------------------------------------

describe('baseStyle() via hero renderer', () => {
  const heroFn = RENDERERS.hero

  test('uses default padding and align when style is empty', () => {
    const html = heroFn({ title: 'Hi' }, {})
    assert.ok(html.includes('padding:120px 24px'), 'default padding')
    assert.ok(html.includes('text-align:center'), 'default align')
  })

  test('uses default background transparent when not specified', () => {
    const html = heroFn({ title: 'Hi' }, {})
    assert.ok(html.includes('background:transparent'), 'default background')
  })

  test('uses default textColor inherit when not specified', () => {
    const html = heroFn({ title: 'Hi' }, {})
    assert.ok(html.includes('color:inherit'), 'default textColor')
  })

  test('overrides padding', () => {
    const html = heroFn({ title: 'Hi' }, { padding: '10px' })
    assert.ok(html.includes('padding:10px'))
  })

  test('overrides background', () => {
    const html = heroFn({ title: 'Hi' }, { background: '#ff0000' })
    assert.ok(html.includes('background:#ff0000'))
  })

  test('overrides textColor', () => {
    const html = heroFn({ title: 'Hi' }, { textColor: '#333' })
    assert.ok(html.includes('color:#333'))
  })

  test('overrides align', () => {
    const html = heroFn({ title: 'Hi' }, { align: 'right' })
    assert.ok(html.includes('text-align:right'))
  })

  test('null style argument uses defaults', () => {
    const html = heroFn({ title: 'Hi' }, null)
    assert.ok(html.includes('padding:120px 24px'))
    assert.ok(html.includes('background:transparent'))
  })

  test('escapes XSS in style values', () => {
    const html = heroFn({ title: 'Hi' }, { background: '<script>' })
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })
})

// ---------------------------------------------------------------------------
// 3. innerStyle() — accessed indirectly through RENDERERS
// ---------------------------------------------------------------------------

describe('innerStyle() via hero renderer', () => {
  const heroFn = RENDERERS.hero

  test('uses default maxWidth when style is empty', () => {
    const html = heroFn({ title: 'Hi' }, {})
    assert.ok(html.includes('max-width:820px'))
  })

  test('overrides maxWidth', () => {
    const html = heroFn({ title: 'Hi' }, { maxWidth: '600px' })
    assert.ok(html.includes('max-width:600px'))
  })

  test('includes margin:0 auto', () => {
    const html = heroFn({ title: 'Hi' }, {})
    assert.ok(html.includes('margin:0 auto'))
  })

  test('null style uses defaults', () => {
    const html = heroFn({ title: 'Hi' }, null)
    assert.ok(html.includes('max-width:820px'))
    assert.ok(html.includes('margin:0 auto'))
  })
})

// ---------------------------------------------------------------------------
// 4. RENDERERS — all 6 block types
// ---------------------------------------------------------------------------

describe('RENDERERS.hero', () => {
  const fn = RENDERERS.hero

  test('renders title', () => {
    const html = fn({ title: 'Hello World' }, {})
    assert.ok(html.includes('Hello World'))
    assert.ok(html.includes('<h1'))
  })

  test('omits subtitle when not provided', () => {
    const html = fn({ title: 'Hello' }, {})
    assert.ok(!html.includes('<p '))
  })

  test('renders subtitle when provided', () => {
    const html = fn({ title: 'Hello', subtitle: 'Sub text' }, {})
    assert.ok(html.includes('Sub text'))
    assert.ok(html.includes('<p '))
  })

  test('omits CTA when ctaLabel is absent', () => {
    const html = fn({ title: 'Hello' }, {})
    assert.ok(!html.includes('<button'))
  })

  test('renders CTA button when ctaLabel provided', () => {
    const html = fn({ title: 'Hello', ctaLabel: 'Click Me', ctaHref: '/go' }, {})
    assert.ok(html.includes('Click Me'))
    assert.ok(html.includes('<button'))
    assert.ok(html.includes('href="/go"'))
  })

  test('CTA defaults href to # when ctaHref absent', () => {
    const html = fn({ title: 'Hello', ctaLabel: 'Go' }, {})
    assert.ok(html.includes('href="#"'))
  })

  test('escapes XSS in title', () => {
    const html = fn({ title: '<script>alert(1)</script>' }, {})
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  test('escapes XSS in subtitle', () => {
    const html = fn({ title: 'T', subtitle: '<img onerror=x>' }, {})
    assert.ok(!html.includes('<img'))
    assert.ok(html.includes('&lt;img'))
  })

  test('escapes XSS in ctaLabel', () => {
    const html = fn({ title: 'T', ctaLabel: '<b>Click</b>' }, {})
    assert.ok(!html.includes('<b>'))
    assert.ok(html.includes('&lt;b&gt;'))
  })

  test('escapes XSS in ctaHref attribute', () => {
    const html = fn({ title: 'T', ctaLabel: 'Go', ctaHref: 'javascript:"xss"' }, {})
    // Attribute escaping: double quote should be escaped
    assert.ok(!html.includes('"xss"'))
  })

  test('returns section element', () => {
    const html = fn({ title: 'T' }, {})
    assert.ok(html.startsWith('<section'))
    assert.ok(html.endsWith('</section>'))
  })
})

describe('RENDERERS.text', () => {
  const fn = RENDERERS.text

  test('renders body text', () => {
    const html = fn({ body: 'Some content here' }, {})
    assert.ok(html.includes('Some content here'))
  })

  test('omits h2 when heading is absent', () => {
    const html = fn({ body: 'Content' }, {})
    assert.ok(!html.includes('<h2'))
  })

  test('renders heading when provided', () => {
    const html = fn({ heading: 'My Heading', body: 'Content' }, {})
    assert.ok(html.includes('My Heading'))
    assert.ok(html.includes('<h2'))
  })

  test('escapes XSS in body', () => {
    const html = fn({ body: '<script>evil()</script>' }, {})
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  test('escapes XSS in heading', () => {
    const html = fn({ heading: '<b>bold</b>', body: '' }, {})
    assert.ok(!html.includes('<b>'))
    assert.ok(html.includes('&lt;b&gt;'))
  })

  test('uses left align by default', () => {
    const html = fn({ body: 'x' }, {})
    assert.ok(html.includes('text-align:left'))
  })

  test('returns section element', () => {
    const html = fn({ body: 'x' }, {})
    assert.ok(html.startsWith('<section'))
    assert.ok(html.endsWith('</section>'))
  })
})

describe('RENDERERS.features', () => {
  const fn = RENDERERS.features

  test('renders empty section for empty items array', () => {
    const html = fn({ items: [] }, {})
    assert.ok(html.includes('<section'))
    assert.ok(!html.includes('<div style="font-size:28px"'))
  })

  test('renders empty section when items is not an array', () => {
    const html = fn({ items: 'not-an-array' }, {})
    assert.ok(html.includes('<section'))
    assert.ok(!html.includes('font-size:28px'))
  })

  test('renders empty section when items is undefined', () => {
    const html = fn({}, {})
    assert.ok(html.includes('<section'))
  })

  test('renders single feature card with icon/title/body', () => {
    const html = fn({ items: [{ icon: '🚀', title: 'Fast', body: 'Very fast' }] }, {})
    assert.ok(html.includes('🚀'))
    assert.ok(html.includes('Fast'))
    assert.ok(html.includes('Very fast'))
  })

  test('renders multiple feature cards', () => {
    const html = fn({ items: [
      { icon: '⚡', title: 'A', body: 'Body A' },
      { icon: '🔥', title: 'B', body: 'Body B' },
    ] }, {})
    assert.ok(html.includes('Body A'))
    assert.ok(html.includes('Body B'))
  })

  test('renders optional heading when provided', () => {
    const html = fn({ heading: 'Features', items: [] }, {})
    assert.ok(html.includes('Features'))
    assert.ok(html.includes('<h2'))
  })

  test('omits h2 when heading is absent', () => {
    const html = fn({ items: [] }, {})
    assert.ok(!html.includes('<h2'))
  })

  test('escapes XSS in item title', () => {
    const html = fn({ items: [{ icon: '⚡', title: '<script>', body: 'b' }] }, {})
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  test('escapes XSS in item body', () => {
    const html = fn({ items: [{ icon: '⚡', title: 't', body: '<img onerror=x>' }] }, {})
    assert.ok(!html.includes('<img'))
  })

  test('uses default maxWidth of 1100px', () => {
    const html = fn({ items: [] }, {})
    assert.ok(html.includes('max-width:1100px'))
  })
})

describe('RENDERERS.cta', () => {
  const fn = RENDERERS.cta

  test('renders heading', () => {
    const html = fn({ heading: 'Call to action' }, {})
    assert.ok(html.includes('Call to action'))
    assert.ok(html.includes('<h2'))
  })

  test('omits button when buttonLabel is absent', () => {
    const html = fn({ heading: 'H' }, {})
    assert.ok(!html.includes('<button'))
  })

  test('renders button when buttonLabel is provided', () => {
    const html = fn({ heading: 'H', buttonLabel: 'Sign Up', buttonHref: '/signup' }, {})
    assert.ok(html.includes('Sign Up'))
    assert.ok(html.includes('<button'))
    assert.ok(html.includes('href="/signup"'))
  })

  test('button defaults href to # when buttonHref absent', () => {
    const html = fn({ heading: 'H', buttonLabel: 'Go' }, {})
    assert.ok(html.includes('href="#"'))
  })

  test('escapes XSS in heading', () => {
    const html = fn({ heading: '<script>evil()</script>' }, {})
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  test('escapes XSS in buttonLabel', () => {
    const html = fn({ heading: 'H', buttonLabel: '<b>Click</b>' }, {})
    assert.ok(!html.includes('<b>'))
  })

  test('uses center align by default', () => {
    const html = fn({ heading: 'H' }, {})
    assert.ok(html.includes('text-align:center'))
  })

  test('uses default maxWidth 640px', () => {
    const html = fn({ heading: 'H' }, {})
    assert.ok(html.includes('max-width:640px'))
  })
})

describe('RENDERERS.code', () => {
  const fn = RENDERERS.code

  test('renders source code inside pre/code', () => {
    const html = fn({ source: 'const x = 1' }, {})
    assert.ok(html.includes('const x = 1'))
    assert.ok(html.includes('<pre'))
    assert.ok(html.includes('<code>'))
  })

  test('escapes HTML in source code', () => {
    const html = fn({ source: '<script>alert("xss")</script>' }, {})
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
    assert.ok(html.includes('&quot;'))
  })

  test('escapes & in source', () => {
    const html = fn({ source: 'a && b' }, {})
    assert.ok(html.includes('&amp;&amp;'))
  })

  test('handles empty source', () => {
    const html = fn({ source: '' }, {})
    assert.ok(html.includes('<code></code>'))
  })

  test('uses default maxWidth 900px', () => {
    const html = fn({ source: 'x' }, {})
    assert.ok(html.includes('max-width:900px'))
  })
})

describe('RENDERERS.faq', () => {
  const fn = RENDERERS.faq

  test('renders empty section for empty items array', () => {
    const html = fn({ items: [] }, {})
    assert.ok(html.includes('<section'))
    assert.ok(!html.includes('<details'))
  })

  test('renders empty section when items is not an array', () => {
    const html = fn({ items: null }, {})
    assert.ok(html.includes('<section'))
    assert.ok(!html.includes('<details'))
  })

  test('renders single FAQ item', () => {
    const html = fn({ items: [{ question: 'What is it?', answer: 'A thing' }] }, {})
    assert.ok(html.includes('What is it?'))
    assert.ok(html.includes('A thing'))
    assert.ok(html.includes('<details'))
    assert.ok(html.includes('<summary'))
  })

  test('renders multiple FAQ items', () => {
    const html = fn({ items: [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ] }, {})
    assert.ok(html.includes('Q1?'))
    assert.ok(html.includes('A2'))
    const detailsCount = (html.match(/<details/g) || []).length
    assert.strictEqual(detailsCount, 2)
  })

  test('escapes XSS in question', () => {
    const html = fn({ items: [{ question: '<script>evil()</script>', answer: 'ok' }] }, {})
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  test('escapes XSS in answer', () => {
    const html = fn({ items: [{ question: 'Q?', answer: '<img onerror=x src=x>' }] }, {})
    assert.ok(!html.includes('<img'))
    assert.ok(html.includes('&lt;img'))
  })

  test('uses default maxWidth 720px', () => {
    const html = fn({ items: [] }, {})
    assert.ok(html.includes('max-width:720px'))
  })
})

// ---------------------------------------------------------------------------
// 5. _purgeCache()
// ---------------------------------------------------------------------------

describe('_purgeCache()', () => {
  test('second renderCmsPage call is a cache hit', async () => {
    _purgeCache('cache-test')
    const page = makePage({ slug: 'cache-test' })
    const db = makeDb({ page })
    const req = fakeReq('http://localhost/p/cache-test')

    // First call — miss
    const r1 = renderCmsPage(req, db, 'cache-test')
    assert.strictEqual(r1.status, 200)
    assert.ok(r1.headers.get('X-Cache') !== 'mem-hit')

    // Second call immediately after — should be a hit
    const r2 = renderCmsPage(req, db, 'cache-test')
    assert.strictEqual(r2.status, 200)
    assert.strictEqual(r2.headers.get('X-Cache'), 'mem-hit')
  })

  test('after purge, next call is a cache miss again', async () => {
    _purgeCache('purge-test')
    const page = makePage({ slug: 'purge-test' })
    const db = makeDb({ page })
    const req = fakeReq('http://localhost/p/purge-test')

    // Populate cache
    renderCmsPage(req, db, 'purge-test')

    // Purge
    _purgeCache('purge-test')

    // Should miss again
    const r3 = renderCmsPage(req, db, 'purge-test')
    assert.ok(r3.headers.get('X-Cache') !== 'mem-hit')
  })

  test('purging a non-existent slug does not throw', () => {
    assert.doesNotThrow(() => _purgeCache('non-existent-slug-xyz'))
  })
})

// ---------------------------------------------------------------------------
// 6. renderCmsPage()
// ---------------------------------------------------------------------------

describe('renderCmsPage() — not found cases', () => {
  test('returns 404 when page is not found', async () => {
    const db = makeDb({ page: null })
    const resp = renderCmsPage(fakeReq(), db, 'missing')
    assert.strictEqual(resp.status, 404)
    assert.strictEqual(resp.headers.get('Cache-Control'), 'no-store')
    const body = await resp.text()
    assert.ok(body.includes('Not found'))
  })

  test('returns 404 when page exists but is not published', async () => {
    const page = makePage({ published: 0 })
    const db = makeDb({ page })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    assert.strictEqual(resp.status, 404)
  })

  test('returns 404 when published is null/falsy', async () => {
    const page = makePage({ published: null })
    const db = makeDb({ page })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    assert.strictEqual(resp.status, 404)
  })
})

describe('renderCmsPage() — successful renders', () => {
  beforeEach(() => {
    // Purge any cached slugs used in these tests
    _purgeCache('test-page')
    _purgeCache('block-page')
    _purgeCache('bad-json-page')
    _purgeCache('unknown-type-page')
    _purgeCache('themed-page')
    _purgeCache('bad-theme-page')
  })

  test('renders HTML document with title and meta when no blocks', async () => {
    const page = makePage({ title: 'My Title', metaDescription: 'My desc' })
    const db = makeDb({ page, blocks: [] })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    assert.strictEqual(resp.status, 200)

    const body = await resp.text()
    assert.ok(body.startsWith('<!doctype html>'))
    assert.ok(body.includes('<title>My Title</title>'))
    assert.ok(body.includes('content="My desc"'))
    assert.ok(body.includes('<html lang="en">'))
  })

  test('escapes XSS in page title', async () => {
    const page = makePage({ title: '<script>alert(1)</script>' })
    const db = makeDb({ page })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    const body = await resp.text()
    assert.ok(!body.includes('<script>alert(1)'))
    assert.ok(body.includes('&lt;script&gt;'))
  })

  test('escapes XSS in metaDescription attribute', async () => {
    const page = makePage({ metaDescription: '"onload=evil()' })
    const db = makeDb({ page })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    const body = await resp.text()
    assert.ok(!body.includes('"onload='))
    assert.ok(body.includes('&quot;'))
  })

  test('includes og:image when ogImage is set', async () => {
    const page = makePage({ ogImage: 'https://example.com/img.png' })
    const db = makeDb({ page })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    const body = await resp.text()
    assert.ok(body.includes('og:image'))
    assert.ok(body.includes('https://example.com/img.png'))
  })

  test('omits og:image when ogImage is null', async () => {
    const page = makePage({ ogImage: null })
    const db = makeDb({ page })
    const resp = renderCmsPage(fakeReq(), db, 'test-page')
    const body = await resp.text()
    assert.ok(!body.includes('og:image'))
  })

  test('renders sections for valid blocks', async () => {
    const page = makePage({ slug: 'block-page' })
    const blocks = [
      makeBlock('hero', { title: 'Hero Title', subtitle: 'Subtitle' }),
      makeBlock('text', { heading: 'Text Heading', body: 'Some body text' }),
    ]
    const db = makeDb({ page, blocks })
    const resp = renderCmsPage(fakeReq(), db, 'block-page')
    const body = await resp.text()
    assert.ok(body.includes('Hero Title'))
    assert.ok(body.includes('Text Heading'))
    assert.ok(body.includes('Some body text'))
  })

  test('gracefully handles block with invalid JSON data (renders empty data={})', async () => {
    const page = makePage({ slug: 'bad-json-page' })
    const blocks = [{ type: 'text', data: '{INVALID JSON}', visible: 1 }]
    const db = makeDb({ page, blocks })
    const resp = renderCmsPage(fakeReq(), db, 'bad-json-page')
    assert.strictEqual(resp.status, 200)
    const body = await resp.text()
    // Should still render valid HTML, just with empty data
    assert.ok(body.startsWith('<!doctype html>'))
    // text renderer with empty data will render body as empty string (esc(undefined)='')
    assert.ok(body.includes('<section'))
  })

  test('renders empty string for unknown block type', async () => {
    const page = makePage({ slug: 'unknown-type-page' })
    const blocks = [makeBlock('unknown_xyz', { foo: 'bar' })]
    const db = makeDb({ page, blocks })
    const resp = renderCmsPage(fakeReq(), db, 'unknown-type-page')
    assert.strictEqual(resp.status, 200)
    const body = await resp.text()
    assert.ok(body.startsWith('<!doctype html>'))
    // No section from unknown type
    assert.ok(!body.includes('<section'))
  })

  test('uses _style from block data for block-level style overrides', async () => {
    const page = makePage({ slug: 'block-page' })
    const blocks = [makeBlock('hero', { title: 'Hi', _style: { background: '#ff0000' } })]
    const db = makeDb({ page, blocks })
    _purgeCache('block-page')
    const resp = renderCmsPage(fakeReq(), db, 'block-page')
    const body = await resp.text()
    assert.ok(body.includes('background:#ff0000'))
  })
})

describe('renderCmsPage() — theme support', () => {
  beforeEach(() => {
    _purgeCache('themed-page')
    _purgeCache('bad-theme-page')
    _purgeCache('no-theme-page')
    _purgeCache('empty-tokens-page')
  })

  test('injects CSS vars from theme tokens', async () => {
    const page = makePage({ slug: 'themed-page', themeId: 42 })
    const theme = { id: 42, tokens: JSON.stringify({ bg: '#111', fg: '#fff', accent: '#0ff' }) }
    const db = makeDb({ page, theme })
    const resp = renderCmsPage(fakeReq(), db, 'themed-page')
    const body = await resp.text()
    assert.ok(body.includes('--cms-bg:#111'))
    assert.ok(body.includes('--cms-fg:#fff'))
    assert.ok(body.includes('--cms-accent:#0ff'))
  })

  test('theme with invalid JSON tokens falls back to empty themeCss', async () => {
    const page = makePage({ slug: 'bad-theme-page', themeId: 99 })
    const theme = { id: 99, tokens: '{INVALID JSON}' }
    const db = makeDb({ page, theme })
    const resp = renderCmsPage(fakeReq(), db, 'bad-theme-page')
    assert.strictEqual(resp.status, 200)
    const body = await resp.text()
    // :root{} block should be empty — no injected --cms- vars from tokens
    const rootMatch = body.match(/:root\{([^}]*)\}/)
    const rootContent = rootMatch ? rootMatch[1] : ''
    assert.strictEqual(rootContent, '', `expected empty :root{} but got: ${rootContent}`)
  })

  test('no theme when themeId is null', async () => {
    const page = makePage({ slug: 'no-theme-page', themeId: null })
    const db = makeDb({ page, theme: null })
    const resp = renderCmsPage(fakeReq(), db, 'no-theme-page')
    assert.strictEqual(resp.status, 200)
    const body = await resp.text()
    // :root{} block should be empty — no theme vars
    const rootMatch = body.match(/:root\{([^}]*)\}/)
    const rootContent = rootMatch ? rootMatch[1] : ''
    assert.strictEqual(rootContent, '', `expected empty :root{} but got: ${rootContent}`)
  })

  test('theme with empty tokens string uses empty object', async () => {
    const page = makePage({ slug: 'empty-tokens-page', themeId: 1 })
    const theme = { id: 1, tokens: '' }
    const db = makeDb({ page, theme })
    _purgeCache('empty-tokens-page')
    const resp = renderCmsPage(fakeReq(), db, 'empty-tokens-page')
    assert.strictEqual(resp.status, 200)
    const body = await resp.text()
    // :root{} block should be empty — empty tokens string parses to {}
    const rootMatch = body.match(/:root\{([^}]*)\}/)
    const rootContent = rootMatch ? rootMatch[1] : ''
    assert.strictEqual(rootContent, '', `expected empty :root{} but got: ${rootContent}`)
  })
})

describe('renderCmsPage() — response headers', () => {
  beforeEach(() => {
    _purgeCache('header-test')
  })

  test('includes Content-Type text/html', () => {
    const db = makeDb({ page: makePage({ slug: 'header-test' }) })
    const resp = renderCmsPage(fakeReq(), db, 'header-test')
    assert.ok(resp.headers.get('Content-Type').includes('text/html'))
  })

  test('includes Cache-Control header', () => {
    const db = makeDb({ page: makePage({ slug: 'header-test' }) })
    const resp = renderCmsPage(fakeReq(), db, 'header-test')
    const cc = resp.headers.get('Cache-Control')
    assert.ok(cc !== null && cc.length > 0)
  })

  test('includes X-Content-Type-Options nosniff', () => {
    const db = makeDb({ page: makePage({ slug: 'header-test' }) })
    const resp = renderCmsPage(fakeReq(), db, 'header-test')
    assert.strictEqual(resp.headers.get('X-Content-Type-Options'), 'nosniff')
  })

  test('includes Referrer-Policy header', () => {
    const db = makeDb({ page: makePage({ slug: 'header-test' }) })
    const resp = renderCmsPage(fakeReq(), db, 'header-test')
    assert.strictEqual(resp.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
  })

  test('cache hit response includes X-Cache: mem-hit header', () => {
    const db = makeDb({ page: makePage({ slug: 'header-test' }) })
    renderCmsPage(fakeReq(), db, 'header-test') // populate cache
    const resp = renderCmsPage(fakeReq(), db, 'header-test') // hit
    assert.strictEqual(resp.headers.get('X-Cache'), 'mem-hit')
  })
})

// ---------------------------------------------------------------------------
// 7. globalThis.cmsPurge
// ---------------------------------------------------------------------------

describe('globalThis.cmsPurge', () => {
  test('is set after module load', () => {
    assert.ok(typeof globalThis.cmsPurge === 'function', 'cmsPurge should be a function')
  })

  test('is the same as _purgeCache', () => {
    assert.strictEqual(globalThis.cmsPurge, _purgeCache)
  })

  test('can be called via globalThis to invalidate cache', async () => {
    _purgeCache('global-purge-test')
    const page = makePage({ slug: 'global-purge-test' })
    const db = makeDb({ page })
    const req = fakeReq()

    renderCmsPage(req, db, 'global-purge-test')
    // Verify cached
    const cached = renderCmsPage(req, db, 'global-purge-test')
    assert.strictEqual(cached.headers.get('X-Cache'), 'mem-hit')

    // Purge via globalThis
    globalThis.cmsPurge('global-purge-test')

    // Should miss now
    const after = renderCmsPage(req, db, 'global-purge-test')
    assert.ok(after.headers.get('X-Cache') !== 'mem-hit')
  })
})
