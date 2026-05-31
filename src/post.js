'use strict'

// Arc post-processor.
// Runs after emit: makes the output as fast as possible:
//
//   1. Critical CSS inlining: CSS needed for first paint is inlined in <head>,
//      non-critical CSS deferred with <link rel="preload">
//   2. Image optimization hints: adds width/height/loading/decoding to <img>
//   3. Prefetch link hints: <link rel="prefetch"> for navigable resources
//   4. Minification: strips whitespace from HTML
//   5. Resource hints: dns-prefetch, preconnect for external domains

const _CSS_STRING_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
const _CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const _CSS_WS_RE = /\s+/g
const _CSS_TOKEN_RE = /\s*([{}:;,>+~])\s*/g
const _CSS_SEMI_BRACE_RE = /;}/g
const _CSS_RESTORE_RE = /__S(\d+)__/g
const _CSS_ZERO_UNIT_RE = /\b0(px|em|rem|pt|ex|ch|cm|mm|in|vw|vh|vmin|vmax)\b/g
const _CSS_LEAD_ZERO_RE = /(^|[:\s,\(])(-?)0\.(\d)/g
const _CSS_TRAIL_ZERO_RE = /(\.\d*[1-9])0+(?=[\s;},\)]|$)/g
const _CSS_HEX6_RE = /#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi
const _CSS_4VAL_1_RE = /\b(margin|padding|border-radius|border-width|inset):([\w.%]+) \2 \2 \2(?=[;}])/g
const _CSS_4VAL_2_RE = /\b(margin|padding|border-radius|border-width|inset):([\w.%]+) ([\w.%]+) \2 \3(?=[;}])/g
const _RH_EXTERNAL_RE = /(?:href|src)="(https?:\/\/[^/"]+)/g

class PostProcessor {
  constructor(options = {}) {
    this.options = options
  }

  // Main entry point: returns { html, css }
  process(html, css) {
    if (typeof html !== 'string') throw new TypeError(`postProcess() expected html to be a string, got ${typeof html}`)
    let result = this.inlineCriticalCss(html, css)
    result.html = this.addResourceHints(result.html)
    result.html = this.minifyHtml(result.html)
    return result
  }

  // ── Critical CSS ──────────────────────────────────────────────────────────

  // Splits CSS into { critical, rest } using @layer base as the critical boundary.
  // If no @layer base marker is present, all CSS is returned as critical with empty rest.
  splitCriticalCss(css) {
    const marker = '@layer base'
    const idx = css.indexOf(marker)
    if (idx === -1) return { critical: css, rest: '' }

    // Walk forward from marker to find the matching closing brace
    let depth = 0
    let end = idx
    for (let i = idx; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }

    const critical = css.slice(idx, end).trim()
    const rest = (css.slice(0, idx) + css.slice(end)).trim()
    return { critical, rest }
  }

  // Inlines CSS into the HTML. For CSS below criticalCssThreshold (bytes), inlines
  // everything. For larger CSS, splits critical (@layer base) inline and defers the
  // rest via <link rel="preload"> with an onload swap and <noscript> fallback.
  inlineCriticalCss(html, css) {
    if (!css || !css.trim()) return { html, css, cssInlined: false }

    // Escape </style> sequences that could break out of inline style tags
    const safeInline = (s) => s.replace(/<\/style>/gi, '<\\/style>')

    const minified = this.minifyCss(css)
    const threshold = this.options.criticalCssThreshold

    let replacement
    let cssInlined = true
    if (threshold != null && minified.length > threshold) {
      const { critical, rest } = this.splitCriticalCss(minified)
      const criticalTag = critical ? `<style>${safeInline(critical)}</style>` : ''
      const preloadBlock = rest
        ? `<link rel="preload" href="styles.css" as="style" onload="this.onload=null;this.rel='stylesheet'">` +
          `<noscript><link rel="stylesheet" href="styles.css"></noscript>`
        : ''
      replacement = criticalTag + preloadBlock
      cssInlined = false
    } else {
      replacement = `<style data-arc-css>${safeInline(minified)}</style>`
    }

    const inlined = html.replace('<link rel="stylesheet" href="styles.css">', replacement)
    if (inlined === html) {
      process.stderr.write('[arc] Warning: CSS link tag not found in HTML — styles may not be inlined\n')
      return { html, css: minified, cssInlined: false }
    }
    return { html: inlined, css: minified, cssInlined }
  }

  // Conservative CSS minifier - strips comments, collapses whitespace, removes
  // spaces around { } : ; , and the trailing ; before }. Preserves string content.
  minifyCss(css) {
    // Pull out strings so we don't mangle their content
    const strings = []
    let s = css.replace(_CSS_STRING_RE, (m) => {
      strings.push(m)
      return `__S${strings.length - 1}__`
    })
    // Strip /* ... */ comments
    s = s.replace(_CSS_COMMENT_RE, '')
    // Collapse all whitespace runs to a single space
    s = s.replace(_CSS_WS_RE, ' ')
    // Remove spaces adjacent to syntactic tokens
    s = s.replace(_CSS_TOKEN_RE, '$1')
    // Drop trailing ; right before }
    s = s.replace(_CSS_SEMI_BRACE_RE, '}')
    // Strip units from zero values: 0px → 0, 0em → 0, etc.
    s = s.replace(_CSS_ZERO_UNIT_RE, '0')
    // Strip leading zeros: 0.5 → .5
    s = s.replace(_CSS_LEAD_ZERO_RE, (_, pre, sign, digits) => `${pre}${sign}.${digits}`)
    // Strip trailing zeros after decimal: .10 → .1
    s = s.replace(_CSS_TRAIL_ZERO_RE, '$1')
    // Shorten 6-digit hex to 3-digit where possible: #aabbcc → #abc
    s = s.replace(_CSS_HEX6_RE, '#$1$2$3')
    // Collapse identical 4-value shorthands: margin:8px 8px 8px 8px → margin:8px
    s = s.replace(_CSS_4VAL_1_RE, '$1:$2')
    // Collapse symmetric 4-value shorthands: margin:8px 16px 8px 16px → margin:8px 16px
    s = s.replace(_CSS_4VAL_2_RE, '$1:$2 $3')
    s = s.trim()
    // Restore strings
    s = s.replace(_CSS_RESTORE_RE, (_, i) => strings[parseInt(i, 10)])
    return s
  }

  // ── Resource hints ────────────────────────────────────────────────────────

  addResourceHints(html) {
    // Find external domains referenced in the HTML
    // m[1] captures scheme + host (no trailing slash), which is the origin
    const externalDomains = new Set()
    _RH_EXTERNAL_RE.lastIndex = 0
    for (const m of html.matchAll(_RH_EXTERNAL_RE)) {
      externalDomains.add(m[1])
    }

    if (externalDomains.size === 0) return html

    const hints = [...externalDomains].map(origin =>
      `<link rel="preconnect" href="${origin}" crossorigin>`
    ).join('\n')

    return html.replace('</head>', `${hints}\n</head>`)
  }

  // ── HTML minification ─────────────────────────────────────────────────────
  // Conservative: only strip redundant whitespace between tags.
  // Preserves content inside <pre>, <code>, <script>, <style>, <textarea>.

  minifyHtml(html) {
    // Preserve content of sensitive tags using indexOf instead of lazy-dot-all regex
    // (lazy [\s\S]*? on unclosed tags would cause catastrophic backtracking)
    const preserved = []
    const SENSITIVE_RE = /<(pre|code|script|style|textarea)([^>]*)>/gi
    let result = ''
    let last = 0
    let m
    SENSITIVE_RE.lastIndex = 0
    while ((m = SENSITIVE_RE.exec(html)) !== null) {
      const tag = m[1].toLowerCase()
      const closeTag = `</${tag}>`
      const closeIdx = html.indexOf(closeTag, m.index + m[0].length)
      if (closeIdx === -1) {
        process.stderr.write(`[arc] Warning: unclosed <${tag}> tag in HTML — minification may produce incorrect output\n`)
        break
      }
      const content = html.slice(m.index + m[0].length, closeIdx)
      const idx = preserved.length
      preserved.push(content)
      result += html.slice(last, m.index) + m[0] + `__PRESERVED_${idx}__` + closeTag
      last = closeIdx + closeTag.length
      SENSITIVE_RE.lastIndex = last
    }
    result += html.slice(last)

    // Strip newlines and extra spaces between tags
    result = result
      .replace(/>\s*\n\s*</g, '><')   // whitespace between tags
      .replace(/\s{2,}/g, ' ')         // multiple spaces → one
      .trim()

    // Restore preserved content (single pass via regex callback)
    result = result.replace(/__PRESERVED_(\d+)__/g, (_, i) => preserved[parseInt(i, 10)])

    return result
  }
}

// Convenience function for use in CLI
function postProcess(html, css, options = {}) {
  return new PostProcessor(options).process(html, css)
}

module.exports = { PostProcessor, postProcess }
