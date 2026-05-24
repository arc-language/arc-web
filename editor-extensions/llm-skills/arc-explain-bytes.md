---
name: arc-explain-bytes
description: Use when the user asks "why is dist/ so big?" or pastes build output asking about specific artifacts. Itemizes every file in dist/ with what it is, why it exists, and how to shrink it if needed.
---

# arc-explain-bytes

**When to use:** the user is auditing build output size, comparing to other frameworks, or asking what's in a specific file.

**Reference docs:** `docs/internals/pipeline.md`, `docs/features/multi-page.md`, `arc-bench/RESULTS.md` for comparison numbers.

## Inventory of dist/ artifacts

After `arc build` (single-page):

| File | What it is | Typical size | How to shrink |
| --- | --- | --- | --- |
| `index.html` | The page HTML + inlined CSS (when CSS ≤14 KB) + inlined JS reference | 1–10 KB (Brotli ~500 B–3 KB) | Trim content; opt out of OG/JSON-LD; use `arc build-site` for multi-page CSS dedup |
| `styles.css` | External CSS when above 14 KB inline threshold | only present when CSS is large | Tune `criticalCssThreshold` in `arc.config.json` |
| `app.js` | Client JS (state setters, event listeners, ADP runtime if `@server` used from client) | 0 B (static) – ~2 KB | Drop unused `@state`; tree-shake ADP by avoiding client-side `@server` calls when possible |
| `app.js.map` | Source map for `app.js` | ~3× the JS size | Production: opt out via `--no-sourcemap` (CLI flag if added) |
| `_arc/functions.js` | `@server fn` bodies for edge runtime (server-only, NOT shipped to browser) | 1–20 KB | Out of client-byte budget — irrelevant for browser perf |
| `_arc/renderer.js` | `@live` edge worker (server-only, NOT shipped to browser) | 5–15 KB | Same — server-side only |

After `arc build-site` (multi-page), additional files:

| File | What it is |
| --- | --- |
| `shared.{sha}.css` | CSS rules used by ≥2 pages, content-hashed for immutable caching |
| `sitemap.xml` | Auto-generated from `meta.canonical` |
| `robots.txt` | Auto-generated, references sitemap |
| `_headers` | Cloudflare Pages / Netlify manifest (CSP + cache-immutable + Link preload) |

With image pipeline:

| File pattern | What it is |
| --- | --- |
| `<stem>.<sha>.{w}w.avif` | AVIF variant at width `w` (best modern compression) |
| `<stem>.<sha>.{w}w.webp` | WebP variant |
| `<stem>.<sha>.{w}w.<ext>` | Original-format fallback |

Each image generates up to 12 variants (3 formats × 4 widths). The BROWSER downloads ONE per `<img>`.

## How to read `arc build` stats output

```
arc: built index.arc
  HTML  2.9 KB    ← <head>+<body>, includes inlined CSS (under threshold)
  CSS   1.7 KB    ← original generated CSS size (before minify+inline)
  JS    4.2 KB    ← client bundle (raw, pre-gzip)
  Edge  6.0 KB    ← @server function bodies (server-only)
  Live  10.1 KB   ← @live edge renderer (server-only)
  → dist/
```

**Browser-shipped** = HTML + CSS + JS (when external) = ~9 KB raw → ~2 KB Brotli for this example.
**Server-only** = Edge + Live = 16 KB (zero cost to visitor, runs at edge).

## Comparison to other frameworks (typical numbers)

For an equivalent 20-section docs page at SEO parity (numbers from `arc-bench/RESULTS.md`):

| Stack | Brotli total |
| --- | --- |
| Arc | **1688 B** |
| Vanilla | 1750 B |
| Astro | 1794 B |
| Next.js | ~200 KB (React + Next runtime) |

The 100–200× gap vs Next.js is the runtime React framework JS. Arc has no equivalent runtime.

## Diagnosing "why is X so big?"

1. **HTML is bigger than expected** → inlined CSS may be exceeding threshold; consider splitting via `arc build-site` for multi-page. Check `dist/index.html` head for inlined `<style>` size.
2. **JS exists when expected 0** → page uses `@state` or `@server` invoked from client. Run `arc-self-verify` — could the user have used `@build` / `@live` instead?
3. **`app.js` is ~1 KB larger than expected** → ADP runtime is included (any `@server` call from client triggers it). Tree-shake by avoiding direct client `@server` invocations.
4. **dist/ is 100s of MB** → image pipeline generated too many variants (large source images at 3 formats × 4 widths × N images). Reduce source image dimensions; tune `imageFormats` per page.
5. **`_arc/*` is large** → many `@server` fns or complex `@live` template. These don't ship to browser — they cost edge function deploy size, not user bandwidth.

## Anti-patterns

- ❌ **Confusing server bytes with browser bytes**. `_arc/functions.js` and `_arc/renderer.js` are SERVER-SIDE — they don't affect user load time or Core Vitals.
- ❌ **Comparing raw bytes to other frameworks' gzipped bytes** — always compare apples to apples. Default to Brotli (matches what CDNs serve).
- ❌ **Treating `app.js.map` as bundle size** — source maps don't ship to users by default (browsers only fetch when DevTools opens).
- ❌ **Optimizing for build-time disk size** instead of wire-served bytes. Disk is cheap; bandwidth is what users feel.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Files categorized as "browser-shipped" vs "server-only"** — the user should know which numbers matter for Core Vitals.
- [ ] **Brotli sizes given alongside raw** (`gzip -c file | wc -c` for gzip, `node -e "require('zlib').brotliCompressSync(...)"` for Brotli level 11).
- [ ] **Comparison baseline cited** — "Vanilla 1750 B" + "Next.js 200 KB" gives the user a reference frame.
- [ ] **Shrink suggestions ranked by impact** — biggest savings first (e.g., "use `@build` to drop 600 B of ADP runtime" before "shorten variable names to save 30 B").
- [ ] **If user has multi-page**: confirm they're running `arc build-site` (not `arc build`) — single-page builds don't dedup CSS across pages, inflating per-page bytes.
- [ ] **Time complexity** of build: linear in source size + image count. State `O(n)` of pages + `O(image_size × format_count)` of images.
