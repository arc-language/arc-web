# Multi-page Sites

`arc build-site` compiles every `.arc` file in a directory as one cohesive site. It dedups CSS, generates a sitemap, emits a `_headers` manifest, and injects prefetch + View Transitions for instant cross-page navigation.

## When to use

| Command | Use for |
| --- | --- |
| `arc build` | Single-page apps; per-page builds in CI |
| `arc build-site` | 2+ pages that share styling and link to each other |

## Quick example

```
my-docs/
├── page-01.arc
├── page-02.arc
└── page-20.arc
```

Each `.arc` file is a standalone page with its own meta. Run:

```bash
arc build-site
```

Output:

```
dist/
├── page-01.html
├── page-02.html
├── ...
├── page-20.html
├── shared.{sha}.css         ← CSS rules common to ≥2 pages, content-hashed
├── sitemap.xml              ← auto-generated from page meta.canonical
├── robots.txt               ← auto-generated, references sitemap
└── _headers                 ← Cloudflare Pages / Netlify config
```

## Shared CSS dedup (H1)

Without `build-site`, each Arc page inlines its full CSS into `<style>` — duplicated 20× across pages. `build-site` extracts rules used by **2 or more pages** into a single content-hashed file:

```html
<!-- in every page -->
<link rel="stylesheet" href="shared.26e7ee47.css">
<style>/* only this page's unique rules */</style>
```

Browser caches `shared.26e7ee47.css` once; subsequent page loads only download HTML.

**Measured impact** (20-page docs site):
- Per-page Brotli: 1419 B → 1021 B (−28%)
- Site total HTML: 106 KB → 79 KB (raw)
- Warm-cache 2nd page: HTML only (~3 KB)

## Auto sitemap

For each page with `meta.canonical`:

```arc
page "Hello World" canonical="https://blog.example/hello-world" modified="2026-05-24"
  ...
```

Arc adds an entry to `sitemap.xml`:

```xml
<url>
  <loc>https://blog.example/hello-world</loc>
  <lastmod>2026-05-24</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.5</priority>
</url>
```

`baseUrl` for `robots.txt` is the most-common origin across all `canonical`s.

Override per page:

```arc
page "Top page" canonical="..." priority=1.0 changefreq="daily"
page "Archive" canonical="..." priority=0.1 changefreq="monthly"
```

See [SEO](seo.md) for the full meta reference.

## Auto prefetch + View Transitions (I2)

Each page is post-processed:

1. Find all `<a href="other-page.html">` that link to another page in the same build
2. Inject `<link rel="prefetch" href="other-page.html">` in `<head>`
3. Inject `<meta name="view-transition" content="same-origin">` in `<head>`

Result:
- Hovering or being-near a link triggers browser prefetch of the target HTML
- Click → near-instant navigation + smooth fade transition (where supported)
- Falls back to full navigation in unsupported browsers

Disable per page:

```arc
page "Heavy page" prefetch=false viewTransitions=false
```

The prefetch tags inflate per-page HTML — for a 20-page sidebar nav site, every page emits 19 prefetch links (~1 KB raw / ~100 B Brotli). Brotli compresses repetition heavily, so the wire cost is minimal; the UX gain (instant nav) is large.

## `_headers` manifest (I3)

For Cloudflare Pages / Netlify:

```
/*
  Content-Security-Policy: default-src 'self'; ...
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/shared.*.css
  Cache-Control: public, max-age=31536000, immutable

/*.avif
/*.webp
/*.jpg
/*.png
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: public, max-age=0, must-revalidate
  Link: </shared.26e7ee47.css>; rel=preload; as=style
```

When `_headers` ships, the per-page `<meta http-equiv="Content-Security-Policy">` is stripped from HTML (it's now in headers). Saves ~80 B per page.

The `Link: rel=preload` header tells CDNs (Cloudflare, Fastly) to send the shared CSS as a [103 Early Hint](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/103) — browser starts fetching CSS before the HTML body arrives.

## Page discovery

`arc build-site` discovers all `*.arc` files in the directory (non-recursive — for nested routes use a flat structure with naming like `blog-post-1.arc`, `blog-post-2.arc`).

For 1 file, `arc build-site` falls back to `arc build`.

## Cross-page links

```arc
// page-01.arc
nav
  link href="page-02.html" "Next →"
  link href="index.html" "Home"
```

References use `.html` extensions (matching the output filenames). For SPA-feel routing, use `arc/router`:

```arc
import { router } from "arc/router"

nav
  link href="/page-02" "Next →"

router()
```

See [Stdlib: router](../language/stdlib.md#arcrouter-view-transitions-routing).

## Stats output

```
arc: built site (20 pages)
  HTML  74.2 KB total (20 files)
  CSS   1.1 KB shared (shared.26e7ee47.css)
  SEO   sitemap.xml (20 urls) + robots.txt
  → dist/
```

## Next

- [SEO](seo.md) — `meta.canonical`, `priority`, `changefreq`
- [Deployment](deployment.md) — what to do with `dist/` next
- [Recipe: Routing](../recipes/routing.md) — full SPA pattern
