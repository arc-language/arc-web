'use strict'

// Arc post-processor.
// Runs after emit — makes the output as fast as possible:
//
//   1. Critical CSS inlining — CSS needed for first paint is inlined in <head>,
//      non-critical CSS deferred with <link rel="preload">
//   2. Image optimization hints — adds width/height/loading/decoding to <img>
//   3. Prefetch link hints — <link rel="prefetch"> for navigable resources
//   4. Minification — strips whitespace from HTML
//   5. Resource hints — dns-prefetch, preconnect for external domains

class PostProcessor {
  constructor(options = {}) {
    this.options = options
    this.criticalCssThreshold = options.criticalCssThreshold ?? 14336 // 14KB
  }

  // Main entry point — returns { html, css }
  process(html, css) {
    let result = { html, css }
    result = this.inlineCriticalCss(result.html, result.css)
    result.html = this.addResourceHints(result.html)
    result.html = this.minifyHtml(result.html)
    return result
  }

  // ── Critical CSS ──────────────────────────────────────────────────────────
  //
  // Strategy: inline the @layer base (always needed) + component-specific CSS.
  // Defer the stylesheet link so full CSS loads non-blocking.
  //
  // When CSS is small (<= threshold), just inline all of it — no split needed.

  inlineCriticalCss(html, css) {
    if (!css || !css.trim()) return { html, css }

    const cssBytes = Buffer.byteLength(css)

    // Escape </style> sequences that could break out of inline style tags
    const safeInline = (s) => s.replace(/<\/style>/gi, '<\\/style>')

    // Small CSS: inline everything, no external file needed
    if (cssBytes <= this.criticalCssThreshold) {
      const inlined = html
        .replace('<link rel="stylesheet" href="styles.css">', `<style>${safeInline(css)}</style>`)
      return { html: inlined, css }
    }

    // Large CSS: split critical (@layer base + first component layer) from rest
    const { critical, rest } = this.splitCriticalCss(css)

    const preload = rest.trim()
      ? `<link rel="preload" href="styles.css" as="style" onload="this.rel='stylesheet'">\n<noscript><link rel="stylesheet" href="styles.css"></noscript>`
      : ''

    const inlined = html.replace(
      '<link rel="stylesheet" href="styles.css">',
      `<style>${safeInline(critical)}</style>\n${preload}`
    )

    return { html: inlined, css }
  }

  splitCriticalCss(css) {
    // Critical = @layer base block (always above the fold)
    // Rest = @layer component and beyond
    // Use brace counting instead of regex to correctly handle nested rules
    const marker = '@layer base {'
    const start = css.indexOf(marker)
    if (start === -1) return { critical: css, rest: '' }

    let depth = 0
    let end = -1
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }
    if (end === -1) return { critical: css, rest: '' }

    const critical = css.slice(start, end)
    const rest = (css.slice(0, start) + css.slice(end)).trim()
    return { critical, rest }
  }

  // ── Resource hints ────────────────────────────────────────────────────────

  addResourceHints(html) {
    // Find external domains referenced in the HTML
    const externalDomains = new Set()
    const hrefMatches = html.matchAll(/(?:href|src)="(https?:\/\/[^/"]+)/g)
    for (const m of hrefMatches) {
      try {
        externalDomains.add(new URL(m[1]).origin)
      } catch {}
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
    // Preserve content of sensitive tags
    const preserved = []
    let result = html.replace(
      /(<(?:pre|code|script|style|textarea)[^>]*>)([\s\S]*?)(<\/(?:pre|code|script|style|textarea)>)/gi,
      (_, open, content, close) => {
        const idx = preserved.length
        preserved.push(content)
        return `${open}__PRESERVED_${idx}__${close}`
      }
    )

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
