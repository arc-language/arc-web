'use strict'

// arc-cms public page renderer.
// Server-side HTML composition for /p/:slug. Pure JS — no Arc compiler dependency.
// Output: zero client-side JS, aggressive HTTP cache headers, instant freshness.
//
// Extension: site authors can register custom block types by mutating RENDERERS
// before the server starts:
//   const pr = require('./server/cms/page-renderer')
//   pr.RENDERERS.banner = (data, style) => `<section>...</section>`

const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => _ESC_MAP[c])
const escAttr = s => String(s ?? '').replace(/[&<>"']/g, c => _ESC_MAP[c])

function baseStyle(s, defaultPad, defaultAlign) {
  s = s ?? {}
  const padding = s.padding ?? defaultPad
  const bg = s.background ?? 'transparent'
  const fg = s.textColor ?? 'inherit'
  const align = s.align ?? defaultAlign
  return `padding:${esc(padding)};background:${esc(bg)};color:${esc(fg)};text-align:${esc(align)}`
}
function innerStyle(s, defaultMaxW) {
  s = s ?? {}
  const maxW = s.maxWidth ?? defaultMaxW
  return `max-width:${esc(maxW)};margin:0 auto`
}

// Per-type renderers. Each takes (data, style) and returns a complete HTML <section>.
const RENDERERS = {
  hero: (d, s) => `<section style="${baseStyle(s, '120px 24px', 'center')}"><div style="${innerStyle(s, '820px')}">
    <h1 style="font-size:clamp(2rem,6vw,3.5rem);font-weight:800;letter-spacing:-0.02em;line-height:1.1;margin:0 0 18px">${esc(d.title)}</h1>
    ${d.subtitle ? `<p style="font-size:1.125rem;line-height:1.6;opacity:.85;margin:0 0 24px">${esc(d.subtitle)}</p>` : ''}
    ${d.ctaLabel ? `<a href="${escAttr(d.ctaHref || '#')}" style="text-decoration:none"><button class="cms-btn">${esc(d.ctaLabel)}</button></a>` : ''}
  </div></section>`,

  text: (d, s) => `<section style="${baseStyle(s, '64px 24px', 'left')}"><div style="${innerStyle(s, '720px')}">
    ${d.heading ? `<h2 style="font-size:1.75rem;font-weight:700;letter-spacing:-0.02em;margin:0 0 16px">${esc(d.heading)}</h2>` : ''}
    <div style="font-size:1rem;line-height:1.7;white-space:pre-wrap">${esc(d.body)}</div>
  </div></section>`,

  features: (d, s) => {
    const items = Array.isArray(d.items) ? d.items : []
    const cards = items.map(it => `<div style="padding:24px;border-radius:12px;background:rgba(0,0,0,0.04);display:flex;flex-direction:column;gap:8px">
      <div style="font-size:28px">${esc(it.icon)}</div>
      <div style="font-size:1.05rem;font-weight:600">${esc(it.title)}</div>
      <div style="font-size:.9rem;line-height:1.5;opacity:.85">${esc(it.body)}</div>
    </div>`).join('')
    return `<section style="${baseStyle(s, '64px 24px', 'left')}"><div style="${innerStyle(s, '1100px')}">
      ${d.heading ? `<h2 style="font-size:1.75rem;font-weight:700;margin:0 0 32px">${esc(d.heading)}</h2>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px">${cards}</div>
    </div></section>`
  },

  cta: (d, s) => `<section style="${baseStyle(s, '64px 24px', 'center')}"><div style="${innerStyle(s, '640px')};text-align:center">
    <h2 style="font-size:1.75rem;font-weight:700;letter-spacing:-0.02em;margin:0 0 20px">${esc(d.heading)}</h2>
    ${d.buttonLabel ? `<a href="${escAttr(d.buttonHref || '#')}" style="text-decoration:none"><button class="cms-btn">${esc(d.buttonLabel)}</button></a>` : ''}
  </div></section>`,

  code: (d, s) => `<section style="${baseStyle(s, '32px 24px', 'left')}"><div style="${innerStyle(s, '900px')}">
    <pre style="padding:18px 20px;background:#0d1117;color:#e6edf3;border-radius:10px;font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:13px;line-height:1.6;overflow-x:auto;margin:0"><code>${esc(d.source)}</code></pre>
  </div></section>`,

  faq: (d, s) => {
    const items = Array.isArray(d.items) ? d.items : []
    const rows = items.map(it => `<details style="padding:14px 18px;border-radius:10px;background:rgba(0,0,0,0.04)">
      <summary style="font-size:1rem;font-weight:600;cursor:pointer">${esc(it.question)}</summary>
      <div style="margin-top:10px;font-size:.95rem;line-height:1.6;opacity:.85;white-space:pre-wrap">${esc(it.answer)}</div>
    </details>`).join('')
    return `<section style="${baseStyle(s, '64px 24px', 'left')}"><div style="${innerStyle(s, '720px')};display:flex;flex-direction:column;gap:12px">${rows}</div></section>`
  },
}

// Cache-Control tuning. Override via env: ARC_CMS_SMAXAGE, ARC_CMS_SWR.
const _SMAXAGE = +(process.env.ARC_CMS_SMAXAGE ?? 60)
const _SWR = +(process.env.ARC_CMS_SWR ?? 300)
const _CACHE_HDR = _SMAXAGE > 0
  ? `public, s-maxage=${_SMAXAGE}, stale-while-revalidate=${_SWR}`
  : 'no-store'

// In-process cache (per Bun worker). Real freshness comes from CDN purge or short s-maxage.
// In-process cache TTL: short by default so edits propagate near-instantly.
// Tune via ARC_CMS_MEM_TTL_MS. Real CDN cache is governed by Cache-Control above.
const _memCache = new Map()
const _MEM_TTL_MS = +(process.env.ARC_CMS_MEM_TTL_MS ?? 1000)

function _purgeCache(slug) {
  _memCache.delete(`/p/${slug}`)
}

function renderCmsPage(req, db, slug) {
  // Memory cache first
  const cacheKey = `/p/${slug}`
  const hit = _memCache.get(cacheKey)
  if (hit && (Date.now() - hit.t) < _MEM_TTL_MS) {
    return new Response(hit.html, { status: 200, headers: { ..._RESP_HDRS, 'X-Cache': 'mem-hit' } })
  }

  const pg = db.query('SELECT * FROM pages WHERE slug = ?1').get(slug)
  if (!pg || !pg.published) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const blocks = db.query('SELECT * FROM pageblocks WHERE page = ?1 AND visible = 1 ORDER BY "order" ASC').all(slug)
  const theme = pg.themeId ? db.query('SELECT * FROM themes WHERE id = ?1').get(pg.themeId) : null

  let themeCss = ''
  if (theme) {
    try {
      const tokens = JSON.parse(theme.tokens || '{}')
      themeCss = Object.entries(tokens).map(([k, v]) => `--cms-${k}:${v}`).join(';')
    } catch { themeCss = '' }
  }

  const sections = blocks.map(b => {
    let data = {}
    try { data = JSON.parse(b.data || '{}') } catch {}
    const style = data._style || {}
    const fn = RENDERERS[b.type]
    return fn ? fn(data, style) : ''
  }).join('')

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(pg.title)}</title><meta name="description" content="${escAttr(pg.metaDescription || '')}"><meta property="og:title" content="${escAttr(pg.title)}">${pg.ogImage ? `<meta property="og:image" content="${escAttr(pg.ogImage)}">` : ''}<style>:root{${themeCss}}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;background:var(--cms-bg,#fff);color:var(--cms-fg,#0a0a0a)}.cms-btn{padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:none;background:var(--cms-accent,#5b8cff);color:#fff;cursor:pointer}</style></head><body>${sections}</body></html>`

  _memCache.set(cacheKey, { html, t: Date.now() })

  return new Response(html, { status: 200, headers: _RESP_HDRS })
}

const _RESP_HDRS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': _CACHE_HDR,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

// Expose a global purge hook so admin server fns can invalidate the cache
// without needing to import this module. Safe: idempotent, gracefully no-ops
// if called before the renderer ever runs.
globalThis.cmsPurge = _purgeCache

module.exports = { renderCmsPage, RENDERERS, _purgeCache, esc, escAttr }
