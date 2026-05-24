# Image Pipeline Internals

Source: `/home/claude/arc/src/img-pipeline.js`. Five features (F1-F5).

## Architecture

```
AST
 │
 ▼
collectImgRefs(program)              ─── walks AST, gathers <img src> refs in document order
 │
 ▼
[{src, alt, afterSection: bool}, ...]
 │
 ▼
new ImagePipeline({srcDir, outDir, formats?, dominantColors?})
 │
 ▼
await pipeline.processAll(refs)      ─── reads each file, transcodes via sharp, writes variants
 │
 ▼
HtmlEmitter({imgPipeline: pipeline}) ─── intercepts <img> nodes, calls emitPicture
 │
 ▼
<picture>...</picture>
```

## F1: Multi-format transcoding (baseline)

For each unique source image:

```js
for (const w of widths) {
  await this.sharp(buf).resize(w).avif({ quality: 60 }).toFile(`${stem}.${sha8}.${w}w.avif`)
  await this.sharp(buf).resize(w).webp({ quality: 75 }).toFile(`${stem}.${sha8}.${w}w.webp`)
  await this.sharp(buf).resize(w).toFile(`${stem}.${sha8}.${w}w${ext}`)   // original format
}
```

Quality tuning:
- AVIF 60: gives ~2× compression vs WebP without visible quality loss for most images
- WebP 75: matches `cwebp` default; safe for photos
- Original: keeps source format as fallback for the `<img>` element

## F2: Layout-aware srcset widths

```js
_chooseWidths(intrinsic, container) {
  const candidates = container
    ? [container, container * 2]
    : DEFAULT_WIDTHS  // [400, 800, 1200, 1600]
  const usable = candidates.filter(w => w > 0 && w <= intrinsic)
  return usable.length > 0 ? usable : [intrinsic]
}
```

- **With container width** (passed in from design analysis): emit just `[W, 2W]` for normal + retina
- **Without**: emit the default ladder
- **Clamp to intrinsic**: never upscale beyond the source image dimensions

Container width detection isn't yet implemented in the AST walker — currently always falls back to `DEFAULT_WIDTHS` unless `ref.containerWidth` is explicitly passed. TODO: parse design block to derive container widths from `w:` declarations.

## F3: Above-the-fold detection

```js
static classifyPositions(imgRefs) {
  let aboveCount = 0
  return imgRefs.map(r => {
    const pos = (!r.afterSection && aboveCount < 2) ? 'above-fold' : 'below-fold'
    if (pos === 'above-fold') aboveCount++
    return { ...r, position: pos }
  })
}
```

Rules:
1. The first 2 images encountered before any `<section>` are above-fold
2. Anything after the first `<section>` is below-fold
3. Above-fold gets `fetchpriority="high"`, no `loading="lazy"`
4. Below-fold gets `loading="lazy" decoding="async"`

The HTML emitter calls this implicitly via the `_imgOrdinal` + `_sawSection` flags during traversal.

## F4: Dominant color extraction

```js
if (this.dominantColors) {
  const stats = await this.sharp(buf).stats()
  const d = stats.dominant
  color = '#' + [d.r, d.g, d.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}
```

`sharp`'s `stats()` method computes histograms and the dominant color (most-common pixel value, weighted). Emitted as `style="background:#RRGGBB"` on the `<img>` element. While loading, the slot shows the dominant color instead of gray — perceived LCP improvement, especially on slow networks.

Opt-out via `meta.dominantColors=false` or constructor option.

## F5: Content-hash dedup

```js
const sha8 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)
this.hashByPath.set(src, sha8)
if (this.processed.has(sha8)) continue   // skip — already processed
```

Two source paths with identical bytes get the same `sha8` → one entry in `processed` map → one set of variants on disk. The HTML emitter looks up by `src` path, gets the shared `sha8`, references the shared variants.

For multi-page sites (`arc build-site`), the same logo referenced from 20 pages → 1 file on disk, 20 HTML refs all pointing at it. CDN caches once.

## H2: Smart AVIF threshold

```js
let useAvif = wantAvif
if (wantAvif && wantWebp) {
  const benefit = widths.every(w =>
    sizes.avif[w] && sizes.webp[w] &&
    (sizes.webp[w] - sizes.avif[w]) / sizes.webp[w] >= AVIF_BENEFIT_THRESHOLD
  )
  if (!benefit) {
    useAvif = false
    for (const w of widths) {
      try { fs.unlinkSync(path.join(this.outDir, variants.avif[w])) } catch {}
    }
  }
}
```

After writing both AVIF and WebP variants, compare sizes:
- If AVIF isn't ≥20% smaller than WebP at **every width**, drop AVIF
- Delete the AVIF files we just wrote
- `emitPicture` won't emit `<source type="image/avif">` for this image

Why: AVIF decode is ~50-100 ms slower than WebP in headless Chrome (real cost on slow devices). For small images where AVIF doesn't save much wire bytes, the decode cost outweighs the savings.

Per-page opt-out via `meta.imageFormats=["webp","jpg"]` — pipeline doesn't generate AVIF at all.

## `emitPicture(src, alt, position)`

```js
emitPicture(src, alt = '', position = 'below-fold') {
  const sha8 = this.hashByPath.get(src)
  if (!sha8) return null              // not processed → caller emits plain <img>
  const p = this.processed.get(sha8)
  if (!p) return null

  const sources = []
  if (p.useAvif) sources.push(`<source type="image/avif" srcset="${srcset(p.variants.avif)}">`)
  if (Object.keys(p.variants.webp).length) sources.push(`<source type="image/webp" srcset="${srcset(p.variants.webp)}">`)
  
  return `<picture>${sources.join('')}<img src="${fallback[renderWidth]}" ...>` + `</picture>`
}
```

Falls back to `null` when:
- sharp isn't installed (`processAll` returned early)
- the source file didn't exist
- transcoding failed

In all `null` cases, the HTML emitter falls through to plain `<img>` emit — graceful degradation.

## Sharp as optional dep

```js
let sharp = null
try { sharp = require('sharp') } catch { /* optional */ }

class ImagePipeline {
  async processAll(imgRefs) {
    if (!this.sharp) return        // no-op when sharp absent
    ...
  }
}
```

Without `sharp`, the pipeline is a no-op:
- `processAll` returns immediately
- `emitPicture` returns `null` for every image
- HTML emitter emits plain `<img>` tags
- Arc warns at build time: `arc: sharp not installed — skipping image optimization`

## Performance

Image processing dominates `arc build` time for image-heavy sites:
- Sharp's AVIF encoder is slow (~200-500 ms per image at 1600px)
- WebP is faster (~50-100 ms)
- JPEG is fastest (~20-50 ms)

The pipeline runs all transcodes for one image sequentially (sharp's pipeline isn't safe to parallelize across formats from the same source buffer). Images themselves are processed in series — a parallel batch wrapper is a TODO.

## Tests

`tests/img-pipeline.test.js` covers all 5 features + the H2 opt-out. Uses sharp to generate a tiny PNG fixture on the fly.

## See also

- [Image Pipeline (feature docs)](../features/images.md) — user-facing reference
- [Emitters: HTML](emitters.md#html-emitter-emittershtmljs) — `<img>` interception
