'use strict'

// Auto-generates sitemap.xml + robots.txt from compiled page metadata.
// Called only from `arc build-site` (multi-page builds); no-op for single page.

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// pages: [{ slug, meta: { canonical?, modified?, priority?, changefreq? } }]
// Returns { sitemap: string|null, robots: string|null, baseUrl: string|null }
function emit(pages, { buildDate = new Date() } = {}) {
  // Pages must have canonical URLs to appear in sitemap; pick the most-common
  // origin as the baseUrl for robots.txt.
  const canonicalPages = pages.filter(p => p.meta?.canonical)
  if (canonicalPages.length === 0) return { sitemap: null, robots: null, baseUrl: null }

  const originCounts = new Map()
  for (const p of canonicalPages) {
    try {
      const origin = new URL(p.meta.canonical).origin
      originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1)
    } catch { /* invalid URL — skip */ }
  }
  let baseUrl = null
  let max = 0
  for (const [origin, count] of originCounts) {
    if (count > max) { max = count; baseUrl = origin }
  }

  const isoDate = (d) => {
    if (!d) return null
    const dt = d instanceof Date ? d : new Date(d)
    if (isNaN(dt.getTime())) return null
    return dt.toISOString().slice(0, 10)
  }
  const defaultLastmod = isoDate(buildDate)

  const _validChangefreq = new Set(['always','hourly','daily','weekly','monthly','yearly','never'])
  const urlEntries = canonicalPages.map(p => {
    const loc = p.meta.canonical
    const lastmod = isoDate(p.meta.modified) ?? defaultLastmod
    const priority = (typeof p.meta.priority === 'number' ? p.meta.priority : 0.5).toFixed(1)
    const changefreq = _validChangefreq.has(p.meta.changefreq) ? p.meta.changefreq : 'weekly'
    return `  <url>
    <loc>${xmlEscape(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
  }).join('\n')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`

  const robots = baseUrl
    ? `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`
    : `User-agent: *\nAllow: /\n`

  return { sitemap, robots, baseUrl }
}

module.exports = { emit }
