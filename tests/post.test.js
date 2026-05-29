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
    assert.ok(result.html.includes('<style'), `Expected <style> in:\n${result.html}`)
    assert.ok(/color:\s*red/.test(result.html), `Expected inlined CSS color rule`)
    assert.ok(!result.html.includes('href="styles.css"'), `Expected stylesheet link removed`)
    assert.strictEqual(result.cssInlined, true, 'cssInlined flag should be true for small CSS')
  })

  test('large CSS (above threshold) creates preload link + inline critical', () => {
    const pp = new PostProcessor({ criticalCssThreshold: 50 })
    const html = '<head><link rel="stylesheet" href="styles.css"></head>'
    const baseCss = '@layer base { body { margin: 0 } }'
    const restCss = '@layer component { .big { padding: 1000px; color: navy; background: pink; border: 1px solid red; } }'
    const css = baseCss + '\n' + restCss
    const result = pp.inlineCriticalCss(html, css)
    assert.ok(result.html.includes('<style>'), `Expected inline <style> for critical CSS split`)
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
    assert.ok(result.html.includes('<style'))
    assert.ok(result.css.includes('.x') && result.css.includes('color'), 'css should contain the rule')
  })

  test('accepts options: threshold below css size triggers preload split', () => {
    const html = '<head><link rel="stylesheet" href="styles.css"></head><body></body>'
    // Above-threshold CSS with both a critical @layer base block AND a non-trivial
    // non-critical block, so the splitter has real content for both halves.
    const css = '@layer base { body { margin: 0 } } .extra { padding: 10px; color: red; border: 1px solid black; }'
    const result = postProcess(html, css, { criticalCssThreshold: 10 })
    assert.ok(result.html.includes('preload'), `Expected preload link for non-critical CSS:\n${result.html}`)
    assert.ok(result.html.includes('<style>'), `Expected inline <style> for critical CSS`)
    // The preload mechanism keeps a <noscript> fallback link, but the original
    // render-blocking stylesheet link must be replaced
    assert.ok(result.html.includes('<noscript>'), 'Expected noscript fallback for non-JS users')
    assert.ok(result.html.includes('rel="preload"'), 'Expected non-blocking preload swap')
  })

  test('warns and returns unchanged html when CSS link tag is not found', () => {
    // HTML without the expected stylesheet link — triggers the "CSS link tag not found" warning
    const html = '<head></head><body>no link here</body>'
    const css = '.x { color: red }'
    const stderrMsgs = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (s) => { stderrMsgs.push(s); return true }
    let result
    try {
      result = postProcess(html, css)
    } finally {
      process.stderr.write = origWrite
    }
    assert.ok(stderrMsgs.some(m => m.includes('CSS link tag not found')), 'Expected CSS link tag not found warning')
    assert.ok(result.html === html, 'html should be returned unchanged')
    assert.strictEqual(result.cssInlined, false, 'cssInlined should be false')
  })

  test('threshold split with no rest block (only critical CSS) omits preload', () => {
    const html = '<head><link rel="stylesheet" href="styles.css"></head><body></body>'
    // Only critical CSS — no non-critical block means rest is empty, preloadBlock = ''
    const css = '@layer base { body { margin: 0; padding: 0; color: black; font-size: 16px } }'
    const result = postProcess(html, css, { criticalCssThreshold: 1 })
    assert.ok(result.html.includes('<style>'), 'Expected inline critical style')
    assert.ok(!result.html.includes('preload'), 'No preload when rest is empty')
    assert.strictEqual(result.cssInlined, false)
  })
})
