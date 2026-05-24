# Deployment

Arc deploys to four targets out of the box. Static output goes anywhere that serves files; dynamic output (with `@live`/`@server`/`@realtime`) needs a WinterCG runtime at the edge.

## `arc deploy` command

```bash
arc deploy --target cloudflare     # recommended for dynamic
arc deploy --target deno
arc deploy --target bun
arc deploy --target node
```

Each target bundles:
- Static assets (`*.html`, `*.css`, `*.js`, images) → CDN-served
- Edge functions (`_arc/renderer.js`, `_arc/functions.js`) → target runtime
- Per-target glue (`wrangler.toml`, `Deno.serve()` entrypoint, etc.)

## Static-only deploys

If your site has no `@live` / `@server` / `@realtime`, `dist/` is just files — push to any static host:

| Host | Notes |
| --- | --- |
| **Cloudflare Pages** | `_headers` file auto-recognized; immutable cache works; 103 Early Hints supported |
| **Netlify** | `_headers` file auto-recognized; same |
| **Vercel** | static; use `vercel.json` for headers if needed |
| **GitHub Pages** | static; `_headers` ignored (no header support) |
| **S3 + CloudFront** | static; CSP-via-header config in CloudFront |
| Any static server | even `python3 -m http.server` works |

The `_headers` file emitted by `arc build-site` is Cloudflare/Netlify-compatible verbatim.

## Cloudflare Pages (recommended)

```bash
arc build-site
npx wrangler pages deploy dist/
```

Or via the Cloudflare dashboard:
- Connect your repo
- Build command: `arc build-site`
- Output directory: `dist`

Arc-emitted features that Cloudflare Pages picks up automatically:
- `_headers` — applied per route
- `_redirects` — if you write one
- `Link:` preload header → 103 Early Hints
- Functions in `dist/_arc/` → Workers (for `@live`/`@server`)

## Dynamic deploys (with `@live` / `@server`)

### Cloudflare Workers

`arc deploy --target cloudflare` emits:

```
dist/
├── static assets (cached at edge)
└── worker/
    ├── index.js               # entrypoint
    └── wrangler.toml
```

Run:

```bash
cd dist/worker
wrangler deploy
```

Worker handles `GET /` → @live renderer; `POST /api/_arc/fn/<name>` → @server functions; `wss://.../realtime/<channel>` → @realtime sockets.

### Deno Deploy

```bash
arc deploy --target deno
cd dist/deno
deployctl deploy --prod main.ts
```

### Bun (self-hosted)

```bash
arc deploy --target bun
cd dist/bun
bun start
```

### Node (self-hosted)

```bash
arc deploy --target node
cd dist/node
node server.js
```

## CSP delivered via header

For multi-page builds, the per-page `<meta http-equiv="Content-Security-Policy">` is **stripped** from HTML — the CSP lives in `_headers` instead. This means:

- HTML is ~80 B smaller per page
- CSP can use directives that meta can't (`frame-ancestors`, `report-uri`)
- One source of truth for security policy

If you customize the CSP:

```json
// arc.config.json
{
  "csp": "default-src 'self'; script-src 'self' https://analytics.example; ..."
}
```

The custom CSP applies to both `<meta>` (single-page) and `_headers` (multi-page).

## Cache-Control summary

`_headers` sets:

| Path pattern | Cache-Control | Why |
| --- | --- | --- |
| `/shared.*.css` | `public, max-age=31536000, immutable` | Content-hashed; safe to cache forever |
| `/*.avif`, `*.webp`, `*.jpg`, `*.png` | `public, max-age=31536000, immutable` | Image variants are content-hashed |
| `/*.html` | `public, max-age=0, must-revalidate` | HTML changes when content changes; must revalidate |

## Performance recommendations

1. **Always use `arc build-site` for ≥2 pages** — shared CSS + immutable caching beats per-page inlining for repeat visits.
2. **Set `canonical` per page** — sitemap can't include pages without it.
3. **Deploy `_headers`** — even on static hosts that support it (Cloudflare Pages, Netlify).
4. **Use Cloudflare** for dynamic apps — globally distributed edge, 103 Early Hints, free tier covers most sites.
5. **Self-host with Bun** for high-throughput dynamic apps — Bun's HTTP server outperforms Node by ~3×.

## Domain + SSL

Out of scope for Arc — use your host's tools:
- Cloudflare Pages: automatic
- Netlify: automatic
- Vercel: automatic
- Self-hosted: Caddy in front for auto-Let's Encrypt

## Monitoring

For `@live` errors:
- Cloudflare: `wrangler tail` for live logs
- Deno: dashboard log stream
- Bun/Node: stdout / your log aggregator

Arc's edge renderer logs errors via `console.error('[arc] @live data error: ...')` — searchable in any host's log UI.

## Next

- [Multi-page](multi-page.md) — `arc build-site` mechanics
- [Edge Rendering](edge-rendering.md) — `@live` deployment
- [SEO](seo.md) — sitemap is part of deploy
