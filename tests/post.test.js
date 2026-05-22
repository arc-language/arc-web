'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { PostProcessor, postProcess } = require('../src/post')

describe('PostProcessor.process', () => {
  test('returns unchanged html/css when css is empty', () => {
    const pp = new PostProcessor()
    const result = pp.process('<html><head></head><body></body></html>', '')
    assert.ok(result.html.includes('<html>'))
    assert.equal(result.css, '')
  })

  test('returns unchanged html when css is whitespace only', () => {
    const pp = new PostProcessor()
    const result = pp.process('<html><head></head><body></body></html>', '   \n  ')
    assert.equal(result.css.trim(), '')
  })
})

describe('PostProcessor.inlineCriticalCss', () => {
  test('small CSS is inlined into <style> tag (replaces stylesheet link)', () => {
    const pp = new PostProcessor()
    const html = '<head><link rel="stylesheet" href="styles.css"></head>'
    const css = '.x { color: red }'
    const result = pp.inlineCriticalCss(html, css)
    assert.ok(result.html.includes('<style>'), `Expected <style> in:\n${result.html}`)
    assert.ok(result.html.includes('color: red'), `Expected inlined CSS`)
    assert.ok(!result.html.includes('href="styles.css"'), `Expected stylesheet link removed`)
  })

  test('large CSS (above threshold) creates preload link + inline critical', () => {
    const pp = new PostProcessor({ criticalCssThreshold: 50 })
    const html = '<head><link rel="stylesheet" href="styles.css"></head>'
    const baseCss = '@layer base { body { margin: 0 } }'
    const restCss = '@layer component { .big { padding: 1000px; color: navy; background: pink; border: 1px solid red; } }'
    const css = baseCss + '\n' + restCss
    const result = pp.inlineCriticalCss(html, css)
    assert.ok(result.html.includes('<style>'), `Expected inline <style> for critical`)
    assert.ok(result.html.includes('rel="preload"'), `Expected preload link in:\n${result.html}`)
    assert.ok(result.html.includes('onload='), `Expected onload swap for preload`)
  })

  test('escapes </style> inside CSS to prevent breakout', () => {
    const pp = new PostProcessor()
    const html = '<head><link rel="stylesheet" href="styles.css"></head>'
    const css = '.x { content: "</style>" }'
    const result = pp.inlineCriticalCss(html, css)
    assert.ok(!result.html.includes('</style>"'), `Expected </style> escape: ${result.html}`)
    assert.ok(result.html.includes('<\\/style>'), `Expected escaped /style`)
  })
})

describe('PostProcessor.splitCriticalCss', () => {
  test('extracts @layer base block as critical', () => {
    const pp = new PostProcessor()
    const css = '@layer base { body { margin: 0 } } @layer component { .x { padding: 10px } }'
    const { critical, rest } = pp.splitCriticalCss(css)
    assert.ok(critical.includes('@layer base'), `Expected base in critical`)
    assert.ok(critical.includes('margin: 0'))
    assert.ok(rest.includes('component'), `Expected component in rest`)
  })

  test('handles nested braces correctly (brace depth counting)', () => {
    const pp = new PostProcessor()
    const css = '@layer base { .x { color: red } .y { color: blue } } trailing'
    const { critical, rest } = pp.splitCriticalCss(css)
    assert.ok(critical.includes('.x'))
    assert.ok(critical.includes('.y'))
    assert.equal(rest, 'trailing')
  })

  test('returns css unchanged when no @layer base marker is present', () => {
    const pp = new PostProcessor()
    const css = '.x { color: red }'
    const { critical, rest } = pp.splitCriticalCss(css)
    assert.equal(critical, css)
    assert.equal(rest, '')
  })
})

describe('PostProcessor.addResourceHints', () => {
  test('adds preconnect link for external https domain', () => {
    const pp = new PostProcessor()
    const html = '<head></head><body><img src="https://cdn.example.com/img.png"></body>'
    const result = pp.addResourceHints(html)
    assert.ok(result.includes('rel="preconnect"'), `Expected preconnect in:\n${result}`)
    assert.ok(result.includes('https://cdn.example.com'), `Expected cdn domain`)
  })

  test('does not add hints when no external domains are referenced', () => {
    const pp = new PostProcessor()
    const html = '<head></head><body><img src="/local.png"></body>'
    const result = pp.addResourceHints(html)
    assert.ok(!result.includes('preconnect'), `Should not have preconnect for local-only`)
  })
})

describe('PostProcessor.minifyHtml', () => {
  test('collapses whitespace between tags', () => {
    const pp = new PostProcessor()
    const result = pp.minifyHtml('<div>\n  <p>hi</p>\n  <p>yo</p>\n</div>')
    assert.ok(!result.includes('\n  <'), `Expected newlines between tags removed: ${result}`)
  })

  test('preserves content inside <pre> tags', () => {
    const pp = new PostProcessor()
    const result = pp.minifyHtml('<pre>  preserved\n  whitespace  </pre>')
    assert.ok(result.includes('  preserved\n  whitespace  '), `Expected pre content preserved: ${result}`)
  })

  test('preserves content inside <script> tags', () => {
    const pp = new PostProcessor()
    const result = pp.minifyHtml('<script>  const x = 1;\n  const y = 2;\n</script>')
    assert.ok(result.includes('const x = 1;\n  const y = 2;'), `Expected script content preserved: ${result}`)
  })

  test('preserves content inside <style> tags', () => {
    const pp = new PostProcessor()
    const result = pp.minifyHtml('<style>  .x {  color:  red;  }\n</style>')
    assert.ok(result.includes('  .x {  color:  red;  }'), `Expected style content preserved: ${result}`)
  })
})

describe('postProcess convenience function', () => {
  test('returns full processed result', () => {
    const html = '<head><link rel="stylesheet" href="styles.css"></head><body></body>'
    const css = '.x { color: red }'
    const result = postProcess(html, css)
    assert.ok(result.html.includes('<style>'))
    assert.equal(result.css, css)
  })

  test('accepts options', () => {
    const html = '<head><link rel="stylesheet" href="styles.css"></head><body></body>'
    const css = '@layer base { body { margin: 0 } }' + ' '.repeat(200)
    const result = postProcess(html, css, { criticalCssThreshold: 10 })
    assert.ok(result.html.includes('preload') || result.html.includes('<style>'), `Expected processed:\n${result.html}`)
  })
})
