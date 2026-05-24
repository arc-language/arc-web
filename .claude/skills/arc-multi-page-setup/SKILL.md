---
name: arc-multi-page-setup
description: Use when the user has (or is about to have) 2+ pages in their Arc project. Triggers on "multi-page", "docs site", "blog with multiple posts", "I need routes". Switches the build to `arc build-site` which dedups CSS, generates sitemap.xml, emits _headers, injects prefetch + View Transitions.
---

# arc-multi-page-setup

**When to use:** the user has, or is about to have, two or more `.arc` files in their project. The single-page `arc build` doesn't dedup CSS or emit sitemap/headers — `arc build-site` does.

**Reference docs:** `docs/features/multi-page.md`, `docs/features/deployment.md`.

## Pattern

For a 2+ page project, structure as flat `.arc` files at the project root + run `arc build-site` instead of `arc build`.

### Project layout

```
my-site/
├── index.arc          # home page (becomes index.html)
├── about.arc          # → about.html
├── contact.arc        # → contact.html
└── docs/              # subdirectories also work
    ├── intro.arc      # → docs/intro.html
    └── advanced.arc   # → docs/advanced.html
```

### Build command

```bash
arc build-site
```

Output:

```
dist/
├── index.html
├── about.html
├── contact.html
├── docs/intro.html
├── docs/advanced.html
├── shared.{sha}.css         # CSS rules used by ≥2 pages, content-hashed
├── sitemap.xml              # from each page's meta.canonical
├── robots.txt
└── _headers                 # Cloudflare Pages / Netlify compatible
```

### What each page should declare

```arc
page "About Us" canonical="https://mysite.com/about" description="..." schemaType="WebPage"
  nav
    link href="index.html" "Home"
    link href="contact.html" "Contact"
  main
    heading "About"
    text "..."
```

The `canonical` meta drives the sitemap. Without it, the page won't appear in `sitemap.xml`.

## What `arc build-site` gives you for free

| Feature | What it does |
| --- | --- |
| Shared CSS dedup | Rules used on ≥2 pages → `shared.<sha>.css` (browser caches once across all routes) |
| sitemap.xml | One `<url>` per page with `<lastmod>`, `<changefreq>`, `<priority>` |
| robots.txt | References the sitemap |
| `_headers` manifest | CSP + security headers + `Cache-Control: immutable` for hashed assets + `Link:` preload (enables 103 Early Hints on Cloudflare/Fastly) |
| `<link rel="prefetch">` injection | One per same-site `<a href>` target — browser prefetches in idle time |
| `<meta name="view-transition">` injection | Cross-page nav gets smooth fade on supporting browsers |
| CSP via header | The per-page `<meta http-equiv="Content-Security-Policy">` is stripped from HTML (saves ~80 B per page) |

Measured impact on a 20-page docs site:
- Per-page Brotli: ~1419 B → ~1021 B (−28%)
- Site total HTML: 106 KB → 79 KB
- Warm-cache 2nd page: HTML only (~3 KB)

## Per-page meta drives sitemap

```arc
page "Hello" canonical="https://blog.example/hello" published="2026-05-01" modified="2026-05-24" priority=0.8 changefreq="weekly"
  ...
```

| Meta key | Sitemap effect |
| --- | --- |
| `canonical` | `<loc>` (required — without it, the page is skipped) |
| `modified` | `<lastmod>` (defaults to build date) |
| `priority` | `<priority>` (0.0–1.0, default 0.5) |
| `changefreq` | `<changefreq>` (default `weekly`) |

## Per-page opt-out

```arc
page "Heavy page" prefetch=false viewTransitions=false
  # No prefetch tags injected; no view-transition meta
```

Useful for heavy pages where you don't want background prefetch eating user bandwidth.

## Cross-page links

```arc
nav
  link href="about.html" "About"      # → /about.html (Arc prefetches this in idle)
  link href="docs/intro.html" "Docs"   # → /docs/intro.html
```

For SPA-feel routing without full page loads, use `arc/router` from the stdlib (View Transitions powered):

```arc
import { router } from "arc/router"

page "App shell"
  nav
    link href="/" "Home"
    link href="/about" "About"
  main
    router()
```

## Deploying

For Cloudflare Pages (recommended):

```bash
arc build-site
npx wrangler pages deploy dist/
```

Cloudflare Pages reads `_headers` automatically — applying CSP, cache-immutable for hashed assets, and 103 Early Hints from the `Link:` preload header.

Netlify supports `_headers` identically. Vercel needs manual `vercel.json` config (Arc doesn't auto-emit Vercel-specific config yet).

## Anti-patterns

- ❌ **Running `arc build` for a multi-page project**: no shared CSS, no sitemap, no `_headers`. Use `arc build-site`.
- ❌ **Forgetting `canonical` on pages you want indexed**: skipped from sitemap.
- ❌ **Hard-coded absolute URLs to your own pages** (`https://mysite.com/about` in `<a href>`): use relative `about.html` so prefetch + dev server work locally.
- ❌ **Inlining the same image on every page** without using `arc build-site`: content-hash dedup is part of multi-page mode. With single-page builds, every page gets its own copy.
- ❌ **Splitting into many subdirectories deeply nested**: Arc's discovery is straightforward but deeply nested routes (4+ levels) get awkward URLs. Flatten when possible.
- ❌ **Using `arc build-site` for a 1-page project**: works (falls back to `arc build`) but adds no value.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **`arc build-site` (not `arc build`)** in user instructions, build scripts, CI workflows.
- [ ] **Every page has `canonical`** if it should appear in sitemap. (Verify: `find dist -name '*.html' | xargs grep -L 'rel="canonical"'` should be empty.)
- [ ] **`shared.{sha}.css` is emitted** — verify after build. If not, all pages have unique CSS (rare) or only one page exists (`build-site` falls back to `build`).
- [ ] **`_headers` exists** in `dist/`. Verify CSP is in headers + stripped from per-page HTML.
- [ ] **`sitemap.xml` URL count matches expected page count** with canonicals.
- [ ] **Cross-page links use relative paths** (`about.html`, not `https://...`). Otherwise prefetch injection doesn't match.
- [ ] **Time complexity (build)**: linear in page count. 20-page site: ~1–2 seconds. 200 pages: ~10–20 seconds. Beyond that, consider parallelizing or partitioning.
- [ ] **Space complexity (dist)**: per-page HTML + ONE shared CSS + image variants (deduped). Linear in unique content.
- [ ] **First-visit + warm-cache scenario explained to user**: cold cache fetches `<page>.html` + `shared.css`. Warm cache (2nd page same session) fetches only `<page2>.html` — `shared.css` cached. That's the big win.
- [ ] **Mobile users tested**: prefetch can eat data on metered connections. The default is on; pages with large CSS/JS might want `prefetch=false`.
