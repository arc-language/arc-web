---
name: arc-add-image
description: Use when the user wants to add images. Arc has a built-in image pipeline that auto-generates AVIF/WebP/JPEG variants, picks layout-aware widths, applies fetchpriority + lazy-loading based on AST position, and emits dominant-color placeholders. The pattern is ALWAYS plain `<img src>`.
---

# arc-add-image

**When to use:** the user wants to add an image (hero, logo, thumbnail, card image).

**Reference docs:** `docs/features/images.md`, `docs/internals/image-pipeline.md`.

## Pattern

**Just use `img src="local.jpg" alt="...">`**. Arc's image pipeline handles everything else.

### Minimal hero + logo + below-fold cards

```arc
page "Showcase"
  header
    img src="hero.jpg" alt="Product hero shot"

  img src="logo.png" alt="Company logo"

  section
    grid cols=3
      img src="card1.jpg" alt="Card 1"
      img src="card2.jpg" alt="Card 2"
      img src="card3.jpg" alt="Card 3"
```

Arc's image pipeline auto-applies:
- **AVIF + WebP + original-format `<picture>` source set** at multiple widths
- **`width=` and `height=`** from the image file header (prevents CLS)
- **`fetchpriority="high"`** on the first 2 images (LCP candidates)
- **`loading="lazy" decoding="async"`** on images after the first `<section>` (below the fold)
- **Dominant-color `background:#...`** style (no gray flash during load)
- **Smart AVIF threshold**: drops AVIF source when not ≥20% smaller than WebP (decode cost would outweigh wire savings)
- **Content-hash dedup**: same image used N times → ONE file in `dist/`

## When the pipeline is a no-op

- **`sharp` not installed**: pipeline falls back to plain `<img>` and warns at build time. Tell the user `npm install sharp` for optimization.
- **External URL** (`src="https://..."` / `src="data:..."`): not processed. For external images you want optimized, download at build time:

```arc
@build const heroBytes = await fetch("https://cdn.example/hero.jpg").then(r => r.arrayBuffer())
# then save to disk + reference locally
```

## Layout-aware widths

Arc emits ONLY the widths the design needs, not a generic ladder:

```arc
img src="thumbnail.jpg" alt="Thumbnail"

design
  img
    w: 200px       # Arc emits widths [200, 400] for retina — NOT [320, 640, 960, 1280]
```

vs Astro / Next.js which emit a fixed ladder regardless of container size.

## Opting out per page

```arc
page "Photos" imageFormats=["webp","jpg"]
  # No AVIF will be generated for any img on this page
  img src="photo1.jpg" alt="..."
```

Useful when AVIF decode cost matters more than wire savings (very small images, low-end devices).

## Anti-patterns

- ❌ **`<picture>` / `<source>` written manually** — Arc generates this. Just use `<img>`.
- ❌ **Manual `srcset`** — Arc generates from intrinsic dimensions + container width.
- ❌ **Adding `loading="lazy"` everywhere** — Arc auto-decides based on AST position. Manual override only when Arc's heuristic is wrong (rare).
- ❌ **Adding `fetchpriority="high"` manually** — same; Arc auto-applies to LCP candidates.
- ❌ **Omitting `alt`** — `arc check` warns. Use `alt=""` for decorative.
- ❌ **External CDN refs when local would work** — local images get the pipeline; external get nothing.
- ❌ **Using SVG as `<img>`** — works but Arc doesn't optimize SVG. For inline SVG, use the `<svg>` element directly.
- ❌ **`<img>` with no `width`/`height`** — Arc fills these from the file. Manual override only when you need different dimensions than the source.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **`alt` attribute set** (even if empty: `alt=""` for decorative).
- [ ] **`sharp` mentioned** if user hasn't installed it — pipeline is a no-op without it.
- [ ] **Above-fold images NOT marked `loading="lazy"`** — Arc handles this; manual `loading="lazy"` on the hero will tank LCP.
- [ ] **CLS-safe**: image has explicit dimensions (Arc auto-adds; verify by reading the emitted HTML).
- [ ] **No `<picture>` written manually** — let the pipeline emit it.
- [ ] **Time complexity**: build-time only — encoding scales with image size + format count. Cards-at-1080p × 3 formats × 4 widths ≈ 1–2 seconds per image. Hero-at-4K may take 10–20 seconds.
- [ ] **Space complexity (disk)**: each image generates ~12 variants (3 formats × 4 widths) by default. For a 1 MB JPEG, dist grows ~3–5 MB on disk. On the wire, browser picks ONE variant.
- [ ] **Bandwidth saved noted**: AVIF is typically 30–50% smaller than WebP, which is 30% smaller than JPEG. Hero often goes from 50 KB JPEG → 8 KB AVIF.
- [ ] **Same image referenced multiple times** triggers Arc's content-hash dedup → ONE file in dist. Verify by checking dist for duplicate basenames.
- [ ] **No images larger than necessary**: if the rendered width is 400 px, source image should be ≤ 800 px (2x retina). Larger sources waste encode time AND disk; Arc clamps widths to intrinsic but won't downsize the source.
