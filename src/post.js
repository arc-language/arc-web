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
    let s = css.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (m) => {
      strings.push(m)
      return `__S${strings.length - 1}__`
    })
    // Strip /* ... */ comments
    s = s.replace(/\/\*[\s\S]*?\*\//g, '')
    // Collapse all whitespace runs to a single space
    s = s.replace(/\s+/g, ' ')
    // Remove spaces adjacent to syntactic tokens
    s = s.replace(/\s*([{}:;,>+~])\s*/g, '$1')
    // Drop trailing ; right before }
    s = s.replace(/;}/g, '}')
    s = s.trim()
    // Restore strings
    s = s.replace(/__S(\d+)__/g, (_, i) => strings[parseInt(i, 10)])
    return s
  }

  // ── Resource hints ────────────────────────────────────────────────────────

  addResourceHints(html) {
    // Find external domains referenced in the HTML
    const externalDomains = new Set()
    const hrefMatches = html.matchAll(/(?:href|src)="(https?:\/\/[^/"]+)/g)
    for (const m of hrefMatches) {
      try {
        externalDomains.add(new URL(m[1]).origin)
      } catch { /* skip malformed URLs in resource-hint scan */ }
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
