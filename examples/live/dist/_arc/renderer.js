'use strict'
// Arc @live edge renderer: auto-generated
// One request → edge resolves data → full HTML → browser

const BASE_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"index,follow\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self';\">\n<title>Dashboard</title>\n<meta property=\"og:title\" content=\"Dashboard\">\n<meta property=\"og:type\" content=\"website\">\n<meta name=\"twitter:card\" content=\"summary\">\n<meta name=\"twitter:title\" content=\"Dashboard\">\n<link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n<a href=\"#main-content\" class=\"arc-skip-link\">Skip to main content</a>\n<header><h2>Dashboard</h2>\n<p>Welcome back, <span id=\"_a1\" data-arc-live></span></p></header>\n<main id=\"main-content\"><div class=\"arc-row_3pqs\"><div class=\"arc-card_3pqs\"><h2>Users</h2>\n<p><span id=\"_a2\" data-arc-live></span></p></div>\n<div class=\"arc-card_3pqs\"><h2>Posts</h2>\n<p><span id=\"_a3\" data-arc-live></span></p></div>\n<div class=\"arc-card_3pqs\"><h2>Revenue</h2>\n<p>$<span id=\"_a4\" data-arc-live></span></p></div></div>\n<div class=\"arc-card_3pqs\"><div class=\"arc-row_3pqs\"><button id=\"_a5\" type=\"button\">Overview</button>\n<button id=\"_a6\" type=\"button\">Analytics</button></div>\n<p>Tab: <span id=\"_a7\" data-arc-live></span></p></div></main>\n</body>\n</html>"
const BASE_CSS = "*, *::before, *::after { box-sizing: border-box }\n  :root {\n    --arc-font-sans: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;\n    --arc-font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;\n    --arc-font-serif: Lora, Georgia, serif;\n    --arc-radius-sm: 4px;\n    --arc-radius-md: 8px;\n    --arc-radius-lg: 12px;\n    --arc-radius-xl: 16px;\n    --arc-radius-2xl: 24px;\n    --arc-radius-full: 9999px;\n    --arc-shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.05);\n    --arc-shadow-md: 0 4px 6px oklch(0% 0 0 / 0.07), 0 1px 3px oklch(0% 0 0 / 0.06);\n    --arc-shadow-lg: 0 10px 15px oklch(0% 0 0 / 0.08), 0 4px 6px oklch(0% 0 0 / 0.05);\n    --arc-shadow-xl: 0 20px 25px oklch(0% 0 0 / 0.10), 0 8px 10px oklch(0% 0 0 / 0.04);\n  }\n:focus-visible { outline: 2px solid oklch(60% 0.15 250); outline-offset: 2px }\n.arc-skip-link { position: absolute; top: -40px; left: 0; background: #fff; color: #000; padding: 8px 16px; z-index: 9999; text-decoration: none; border: 2px solid #000 }\n  .arc-skip-link:focus { top: 0 }\n  @media (prefers-reduced-motion: reduce) {\n    *, *::before, *::after {\n      animation-duration: 0.01ms !important;\n      animation-iteration-count: 1 !important;\n      transition-duration: 0.01ms !important;\n      scroll-behavior: auto !important;\n    }\n  }"
const CLIENT_JS = "(function(){\nlet _activeTab=\"overview\";\nconst _el__a1=document.getElementById('_a1');\nconst _el__a2=document.getElementById('_a2');\nconst _el__a3=document.getElementById('_a3');\nconst _el__a4=document.getElementById('_a4');\nconst _el__a7=document.getElementById('_a7');\nfunction _set_activeTab(v){\n_activeTab=v;\n_el__a7.textContent=_activeTab;\n}\n(function(){const _ee=document.getElementById('_a5');if(_ee)_ee.addEventListener('click',function(event){_set_activeTab(\"overview\");});})();\n(function(){const _ee=document.getElementById('_a6');if(_ee)_ee.addEventListener('click',function(event){_set_activeTab(\"analytics\");});})();\n_el__a1.textContent=user.name;\n_el__a2.textContent=stats.users;\n_el__a3.textContent=stats.posts;\n_el__a4.textContent=stats.revenue;\n_el__a7.textContent=_activeTab;\n})();"

// @server functions: run at request time on the edge
async function getUser(id) {
  return {"name":"Alex Chen","role":"admin"};
}

async function getStats() {
  return {"users":12483,"posts":3721,"revenue":94200};
}

async function _resolveData(request) {
  const _session = request._arc_session ?? {}
  try {
    const [user, stats] = await Promise.all([(getUser("current")), (getStats())])
    return { user, stats }
  } catch (e) {
    console.error('[arc] @live data error:', e instanceof Error ? e.message : String(e))
    return { __arc_render_error__: true }
  }
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

const _SPAN_RE = new RegExp('<span id="(' + "_a1|_a2|_a3|_a4" + ')" data-arc-live><\/span>', 'g')

function _fillHtml(data) {
  const { user = undefined, stats = undefined } = data
  const _m = Object.create(null)
  try { _m['_a1'] = _esc(String(user.name ?? '')) } catch { _m['_a1'] = '' }
  try { _m['_a2'] = _esc(String(stats.users ?? '')) } catch { _m['_a2'] = '' }
  try { _m['_a3'] = _esc(String(stats.posts ?? '')) } catch { _m['_a3'] = '' }
  try { _m['_a4'] = _esc(String(stats.revenue ?? '')) } catch { _m['_a4'] = '' }
  let html = BASE_HTML.replace(_SPAN_RE, (_m0, id) => {
    return id in _m ? _m[id] : _m0
  })
  html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>${BASE_CSS.replace(/<\/style>/gi, '<\/style>')}</style>`)
  if (CLIENT_JS) html = html.replace('</body>', `<script>${CLIENT_JS.replace(/<\/script>/gi, '<\/script>')}</script></body>`)
  return html
}

// Streaming HTML: flush <head> immediately, then await @live data, then flush body.
// On any network with >0 latency to the data source, the browser starts parsing
// the head (CSS, fonts, preconnects) before the data round-trip completes.
function _splitHeadBody(html) {
  const i = html.indexOf('</head>')
  if (i === -1) return { head: '', rest: html }
  const end = i + '</head>'.length
  let head = html.slice(0, end)
  head = head.replace('<link rel="stylesheet" href="styles.css">', `<style>${BASE_CSS.replace(/<\/style>/gi, '<\/style>')}</style>`)
  return { head, rest: html.slice(end) }
}

const _RESPONSE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-cache',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Transfer-Encoding': 'chunked',
}

// WinterCG fetch handler (Cloudflare Workers / Deno Deploy / Bun)
export default {
  async fetch(request, env, ctx) {
    try {
      const enc = new TextEncoder()
      const { head, rest } = _splitHeadBody(BASE_HTML)
      const stream = new ReadableStream({
        async start(controller) {
          // Flush head immediately — browser starts parsing CSS / fonts now
          controller.enqueue(enc.encode(head))
          try {
            const data = await _resolveData(request)
            if (data.__arc_render_error__) {
              controller.enqueue(enc.encode('<body><!-- @live data error --></body></html>'))
              controller.close(); return
            }
            // Fill spans + inline JS, then emit body remainder
            const filled = _fillHtml(data)
            const { rest: filledRest } = _splitHeadBody(filled)
            controller.enqueue(enc.encode(filledRest))
            controller.close()
          } catch (e) {
            console.error('[arc] edge render error:', e instanceof Error ? e.message : String(e))
            controller.enqueue(enc.encode('<body><!-- render error --></body></html>'))
            controller.close()
          }
        },
      })
      return new Response(stream, { headers: _RESPONSE_HEADERS })
    } catch (e) {
      console.error('[arc] edge render error:', e instanceof Error ? e.message : String(e))
      return new Response('Internal Server Error', { status: 500 })
    }
  }
}

// Node.js / Bun / Deno adapter (non-streaming fallback for direct require())
if (typeof module !== 'undefined') module.exports = { _resolveData, _fillHtml, _splitHeadBody }