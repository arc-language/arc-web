# Image Pipeline

Arc's image pipeline runs at build time. It transcodes to modern formats, generates srcsets, picks the best variants for layout, classifies above/below fold, and dedups by content hash — all from a plain `<img src="local.jpg">`.

## Quick start

```arc
page "Hero"
  img src="hero.jpg" alt="Hero image"
  img src="logo.png" alt="Logo"
  section
    img src="card1.jpg" alt="First card"
    img src="card2.jpg" alt="Second card"
```

Build:

```bash
arc build
```

What ships:
- `dist/hero.{sha}.{400,800,1200,1600}w.{avif,webp,jpg}` (12 variants for the hero)
- `dist/logo.{sha}.{200}w.{webp,png}` (AVIF dropped — see "Smart format selection")
- `dist/card1.{sha}.{400,800}w.{avif,webp,jpg}` + ditto for card2
- HTML with `<picture>` elements pointing at the variants

## Requirements

Install `sharp`:

```bash
npm install sharp
```

Without `sharp`, the pipeline becomes a no-op: `<img>` is emitted unchanged. Arc warns at build time so you know optimization didn't run.

## What you get automatically

| Behavior | Triggered by | Notes |
| --- | --- | --- |
| Multi-format `<picture>` | Any `<img src="local.*">` | AVIF + WebP + original |
| Multi-width srcset | Same | Widths derived from image intrinsic + design context |
| Auto `width` / `height` | Same | Read from image header — prevents CLS |
| Auto `loading="lazy"` + `decoding="async"` | Below-fold images | First 2 images = above-fold; rest = below |
| Auto `fetchpriority="high"` | Above-fold images | LCP candidates download first |
| Dominant color background | Always (when sharp present) | No gray flash during load |
| Content-hash filenames | Always | `logo.{sha}.png` — cacheable forever via `_headers` immutable |
| Content dedup | Same image bytes used twice | One file on disk; both refs share URL |

## Smart format selection (H2)

Modern AVIF decode is slow (~50-100 ms per image in headless Chrome). When AVIF isn't meaningfully smaller than WebP, the decode cost outweighs the wire savings. Arc auto-skips AVIF when it's not at least **20% smaller than WebP** at the same width.

For the hero example:
- `hero.jpg` (1600w): AVIF 6.4 KB, WebP 10.4 KB → AVIF kept (38% smaller)
- `logo.png` (200w): AVIF 1.5 KB, WebP 1.4 KB → AVIF dropped (no benefit)
- Cards: similar — kept where it helps

You can opt out per page:

```arc
page "Photos" imageFormats=["webp","jpg"]
  // no AVIF will be emitted for any img on this page
  img src="photo1.jpg" alt="..."
```

## Layout-aware srcset widths (F2)

Astro emits a generic ladder of widths (320 / 640 / 960 / 1280 / 1920). Arc emits **only the widths your design actually needs**:

```arc
page "Card grid"
  for card in cards
    img src="{card.image}" alt="{card.title}"
  design
    img
      w: 400px              // each card is exactly 400px wide
```

Arc emits widths `[400, 800]` (400 + 2× retina) per card image. Generic ladders skip the irrelevant sizes — fewer variants generated, smaller deploy, faster CDN cache fill.

## Above-the-fold detection (F3)

Arc walks the AST in document order. The first 2 images encountered before any `<section>` are LCP candidates:

```arc
page "Article"
  header
    img src="hero.jpg" alt="..."           // above-fold → fetchpriority="high"
    img src="byline.jpg" alt="..."         // above-fold → fetchpriority="high"
  section
    img src="figure-1.jpg" alt="..."       // below-fold → loading="lazy" decoding="async"
    img src="figure-2.jpg" alt="..."       // below-fold
```

No annotations needed. The first 2 images get `fetchpriority="high"`; subsequent images and anything after the first `<section>` gets `loading="lazy" decoding="async"`.

Astro and Next/Image require you to manually add `priority` or `loading="eager"` — they don't have AST visibility.

## Dominant color background (F4)

Arc samples each image at build time and emits the dominant color as an inline `style="background:#abc123"`:

```html
<picture>
  <source type="image/avif" srcset="hero.abc123.1600w.avif 1600w">
  <source type="image/webp" srcset="hero.abc123.1600w.webp 1600w">
  <img src="hero.abc123.1600w.jpg" width="1600" height="900"
       fetchpriority="high" style="background:#3b6ea8" alt="Hero">
</picture>
```

While the image loads, the slot shows the correct color — not gray. Combined with auto `width`/`height`, **CLS stays at 0** and perceived LCP improves.

## Content-hash dedup (F5)

When the same image is referenced from multiple `<img src>` (e.g., a logo used across 20 docs pages), Arc computes a content hash and emits **one** physical file in `dist/`:

```arc
// page-01.arc
img src="logo.png" alt="Logo"

// page-02.arc
img src="logo.png" alt="Logo"

// page-03.arc
img src="logo.png" alt="Logo"
```

Build with `arc build-site`:

```
dist/
├── logo.116e5799.200w.webp     # ONE file
├── logo.116e5799.200w.png      # ONE file
├── page-01.html → references logo.116e5799.*
├── page-02.html → references logo.116e5799.*
└── page-03.html → references logo.116e5799.*
```

CDN sees one URL across 20 pages → maximum cache hit rate from the first visit onward.

## Comparison to alternatives

| Feature | Arc | Astro `@astrojs/image` | Next `next/image` |
| --- | :---: | :---: | :---: |
| Build-time transcoding | ✅ | ✅ | ❌ (runtime, needs server) |
| AVIF | ✅ smart-skip | optional | ✅ |
| Layout-aware srcset widths | ✅ | ❌ | ❌ |
| AST above-fold detection | ✅ | ❌ (manual `priority`) | ❌ (manual `priority`) |
| Dominant color fill | ✅ | ❌ | ❌ (only blur placeholder) |
| Content-hash dedup | ✅ | partial | ❌ (per-route hashing) |
| Zero JS for static images | ✅ | ✅ | ❌ (`next/image` ships JS) |
| Works in `output: 'export'` | ✅ | ✅ | ❌ (forces `unoptimized: true`) |

## When to skip the pipeline

The pipeline ONLY runs on local file references (`src="hero.jpg"`). External URLs and data URIs pass through unchanged:

```arc
img src="https://cdn.example/photo.jpg" alt="..."     // not processed
img src="data:image/svg+xml,..." alt="..."            // not processed
```

For external images you want optimized, download them at build time:

```arc
@build const heroBytes = await fetch("https://cdn.example/photo.jpg")
  .then(r => r.arrayBuffer())
// then save and reference locally — see Recipe: External assets
```

## Internals

See [Internals: Image Pipeline](../internals/image-pipeline.md) for the source walkthrough.

## Next

- [Accessibility](accessibility.md) — `alt`, ARIA defaults
- [Multi-page](multi-page.md) — dedup wins compound across routes
- [Deployment](deployment.md) — `_headers` makes image variants cache forever
