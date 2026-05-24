---
name: arc-perf-audit
description: Use when the user pastes a Lighthouse report, complains "this is slow", or asks for performance improvements. Diagnoses LCP/CLS/INP/TBT regressions and proposes Arc-idiomatic fixes ranked by impact.
---

# arc-perf-audit

**When to use:** the user has a Lighthouse report, WebPageTest result, or just says "this page feels slow." Distinct from `arc-explain-bytes` (which is about file sizes) — this is about user-perceived speed and Core Web Vitals.

**Reference docs:** `docs/features/multi-page.md`, `docs/features/images.md`, `arc-bench/RESULTS.md` for benchmark baselines.

## Methodology

1. **Identify the failing metric**: LCP, CLS, INP, FCP, TBT. Each has a different cause class.
2. **Bisect the cause**: image, JS, layout, render-blocking resource.
3. **Apply the Arc-idiomatic fix** (usually a 1-line change).
4. **Verify with `arc-self-verify` Core Vitals section**.

## LCP (Largest Contentful Paint) — target ≤ 2.5 s

Most common LCP element: a hero image OR the largest above-fold text block.

| Cause | Fix |
| --- | --- |
| Hero image not pre-prioritized | Arc auto-applies `fetchpriority="high"` to first 2 `<img>` before `<section>`. Verify the LCP element is one of them. If your LCP image is below a `<section>`, restructure or use `meta.fetchPriority` hint. |
| Server-rendered text waits on slow `@server` fn | Reduce the slowest `@server` fn's work; cache at the edge (Cloudflare KV). All `@live` decls run in parallel, so the slowest one IS the LCP gate. |
| Render-blocking CSS | Arc inlines critical CSS automatically below 14 KB. If your CSS is larger, the rest is `<link rel="preload">` deferred. Check `dist/index.html` head. |
| External font without `<link rel="preload">` | Add the preload hint manually; or use `font-display: swap` in the design block. Arc doesn't auto-preload custom fonts (yet). |
| Hero image too large | Image pipeline picks smallest viable AVIF, but source image dimensions matter. 4K source → still 4K in AVIF. Resize source to ≤ 2× display width. |

## CLS (Cumulative Layout Shift) — target ≤ 0.1

| Cause | Fix |
| --- | --- |
| Image missing dimensions | Arc auto-adds `width=`/`height=` via image pipeline. If you see CLS from an image, sharp probably isn't installed (pipeline no-op). Run `npm install sharp`. |
| Async-loaded content pushes layout | For `@state`-bound dynamic content, reserve space in CSS (`min-height`). For `@live` data — Arc renders before HTML ships, so no CLS. |
| Web font swap | Use `font-display: optional` to avoid swap entirely, OR pre-define the metric-equivalent fallback (`size-adjust`). |
| Late-loaded ad / iframe | Set explicit `width`/`height` on `<iframe>`. If you can't predict size, reserve aspect-ratio space with CSS. |

## INP (Interaction to Next Paint) — target ≤ 200 ms

| Cause | Fix |
| --- | --- |
| Event handler runs heavy synchronous work | Move to `@worker` (Web Worker) for CPU-bound work, OR debounce. Arc emits direct DOM updates with no diff cost, so per-update is fast. |
| Filtering/sorting huge lists on every keystroke | Debounce input (300 ms is the sweet spot). For >1000 items, move filtering to `@server fn` to avoid blocking main thread. |
| JSON.parse of huge payload | Use ADP (`@server fn` returns) — 10× faster decode than JSON. |
| Reactive cascade fires many `@computed` | Check the dependency graph — if `@computed let x = ...` triggers more computeds, the chain runs synchronously. Restructure to compute on read instead of on write where possible. |

## FCP (First Contentful Paint) — target ≤ 1.8 s

| Cause | Fix |
| --- | --- |
| Runtime data fetch before render | Move to `@build` (compile-time inline) or `@live` (edge-rendered) — both eliminate the client-side fetch round trip. |
| Render-blocking script | Arc emits `<script defer>` for `app.js`. Verify nothing else (analytics, etc.) blocks. |
| External CSS file | Arc inlines critical CSS below 14 KB. For multi-page, `arc build-site` uses `shared.<sha>.css` with `Link: rel=preload` hint in `_headers` for 103 Early Hints. |
| Cloudflare/Fastly without Early Hints | Deploy to a host that supports 103 (Cloudflare Pages, Fastly Compute). |

## TBT (Total Blocking Time) — target ≤ 200 ms

| Cause | Fix |
| --- | --- |
| Framework JS parse/eval | Arc ships ~0 framework JS. If TBT is high, check for inline scripts or third-party JS. |
| Synchronous third-party scripts | Add `async` / `defer`; or load on user interaction only. |
| Heavy `@worker` initialization on page load | Lazy-instantiate workers on first use. |

## Lighthouse-specific quirks

- Lighthouse runs in headless Chrome with simulated throttling (Slow 4G + 4× CPU). Real-device numbers may differ.
- AVIF decode in headless Chrome is ~50–100 ms slower than WebP. Arc's smart AVIF threshold (≥20% smaller than WebP) handles this — if you see LCP regress when AVIF is emitted, set `meta.imageFormats=["webp","jpg"]` per-page.
- `NO_LCP` error on Lighthouse: page has no detectable LCP element (very rare for real pages). Often happens on placeholder/error pages.

## Anti-patterns

- ❌ **Adding `loading="lazy"` to the hero image** — tanks LCP. Arc auto-prioritizes first 2 images; don't override.
- ❌ **Adding `<link rel="preload">` to every image** — counterproductive (browsers parallelize anyway). Use only for LCP candidates.
- ❌ **Caching `@live` results indefinitely** to "speed up the page" — that's `@build` territory. If data is the same forever, use `@build`.
- ❌ **Debouncing every input** including ones that should feel immediate (toggles, sliders) — only debounce expensive operations (filter, search, autosave).
- ❌ **Optimizing for one Lighthouse run** — numbers fluctuate ±5%. Run 3+ times, take median.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Failing metric named** with its target threshold (e.g., "LCP 3.2 s — above 2.5 s threshold").
- [ ] **Cause class identified** (image / JS / layout / blocking resource).
- [ ] **Arc-idiomatic fix proposed** (not "add memoization" — that's React-think).
- [ ] **Expected post-fix metric stated** (e.g., "should drop to ~900 ms LCP based on benchmark baseline").
- [ ] **Verify after applying**: re-run Lighthouse, confirm the metric improved.
- [ ] **If multiple causes**: rank by impact. Don't ship a 50-line refactor for a 5 ms gain.
- [ ] **Mention measurement noise**: ±5% per run; need 3+ runs for confidence.
- [ ] **Compare to benchmark baseline**: Arc's expected docs page LCP is ~900 ms on Lighthouse mobile profile. If far worse, something specific is wrong.
