'use strict'

// Arc image pipeline.
// Five things this provides that runtime plugins (Astro's @astrojs/image, Next/image) can't:
//   F1. Build-time transcoding to AVIF + WebP + original-format fallback (baseline parity)
//   F2. Layout-aware srcset widths - uses ONLY widths the design block actually needs,
//       not a generic ladder
//   F3. AST-derived above-the-fold detection - first image in header/main gets
//       fetchpriority=high, others get loading=lazy automatically
//   F4. Dominant-color background fill - image slot shows the right color while loading
//   F5. Content-hash dedup - same image used on 20 pages → one file in dist
//
// `sharp` is loaded via optional require. Without it, the pipeline is a no-op and
// the compiler still emits a working <img> tag.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let sharp = null
try { sharp = require('sharp') } catch { /* optional; pipeline becomes a no-op */ }

const DEFAULT_WIDTHS = [400, 800, 1200, 1600]
const DEFAULT_FORMATS = ['avif', 'webp', 'original']
// If AVIF isn't at least this much smaller than WebP at the same width,
// drop AVIF from the picture sources - the decode cost (~50–100 ms on slower
// devices for large images) doesn't repay the wire savings.
const AVIF_BENEFIT_THRESHOLD = 0.20

class ImagePipeline {
  constructor({ srcDir, outDir, dominantColors = true, formats = DEFAULT_FORMATS, sharpLib = sharp } = {}) {
    this.srcDir = srcDir
    this.outDir = outDir
    this.dominantColors = dominantColors
    this.formats = formats     // ordered list controlling which <source> tags emit
    this.sharp = sharpLib
    this.hashByPath = new Map()      // src path → sha8
    this.processed = new Map()       // sha8 → { widths, variants, color, w, h, useAvif }
    this._inFlight = new Map()       // sha8 → Promise — coalesces concurrent calls for same image
    // Cap Sharp's internal worker threads to avoid saturating libuv's thread pool
    // (default 4 threads) when many images are processed in parallel across pages.
    if (this.sharp?.concurrency) {
      const { cpus } = require('os')
      this.sharp.concurrency(Math.max(1, Math.floor(cpus().length / 2)))
    }
  }

  // imgRefs: [{ src, alt, containerWidth?, position: 'above-fold'|'below-fold' }]
  async processAll(imgRefs) {
    if (!this.sharp) return
    fs.mkdirSync(this.outDir, { recursive: true })

    // De-dup by source path first
    const unique = new Map()
    for (const ref of imgRefs) {
      if (unique.has(ref.src)) continue
      const abs = path.isAbsolute(ref.src) ? ref.src : path.join(this.srcDir, ref.src)
      if (!fs.existsSync(abs)) continue
      unique.set(ref.src, { abs, ref })
    }

    const processImage = async ([src, { abs, ref }]) => {
      // Stream-hash the file to compute sha8 without loading the full image into memory
      const sha8 = await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(abs)
        stream.on('data', c => hash.update(c))
        stream.on('end', () => resolve(hash.digest('hex').slice(0, 8)))
        stream.on('error', reject)
      })
      this.hashByPath.set(src, sha8)
      if (this.processed.has(sha8)) return   // F5: dedup by content
      // Coalesce concurrent calls for the same image (e.g. same img on multiple pages compiled in parallel).
      // Without this, two concurrent processAll() calls (one per page in Promise.all) both pass the
      // processed.has(sha8) guard and write to the same output file simultaneously.
      if (this._inFlight.has(sha8)) { await this._inFlight.get(sha8); return }

      let _resolve, _reject
      const p = new Promise((res, rej) => { _resolve = res; _reject = rej })
      this._inFlight.set(sha8, p)

      try {
      const img = this.sharp(abs)
      const meta = await img.metadata()
      const widths = this._chooseWidths(meta.width, ref.containerWidth)

      const stem = path.basename(src, path.extname(src))
      const variants = { avif: {}, webp: {}, original: {} }
      const sizes = { avif: {}, webp: {}, original: {} }
      const wantAvif = this.formats.includes('avif')
      const wantWebp = this.formats.includes('webp')
      const wantOriginal = this.formats.includes('original') || this.formats.includes('jpg') || this.formats.includes('png')
      // Flatten all width × format tasks into one Promise.all so all I/O runs concurrently
      const allTasks = []
      for (const w of widths) {
        const base = `${stem}.${sha8}.${w}w`
        // Use .clone() so Sharp decodes the file only once per width, then branches to each format
        const resized = this.sharp(abs).resize(w)
        if (wantAvif) {
          const p = path.join(this.outDir, `${base}.avif`)
          allTasks.push(resized.clone().avif({ quality: 60 }).toFile(p).then(info => { variants.avif[w] = `${base}.avif`; sizes.avif[w] = info.size }))
        }
        if (wantWebp) {
          const p = path.join(this.outDir, `${base}.webp`)
          allTasks.push(resized.clone().webp({ quality: 75 }).toFile(p).then(info => { variants.webp[w] = `${base}.webp`; sizes.webp[w] = info.size }))
        }
        if (wantOriginal) {
          const p = path.join(this.outDir, `${base}${path.extname(src)}`)
          allTasks.push(resized.clone().toFile(p).then(info => { variants.original[w] = `${base}${path.extname(src)}`; sizes.original[w] = info.size }))
        }
      }
      await Promise.all(allTasks)

      // Smart format selection: if AVIF isn't meaningfully smaller than WebP at
      // every width, drop AVIF - its decode cost outweighs the wire savings.
      let useAvif = wantAvif
      if (wantAvif && wantWebp) {
        const benefit = widths.every(w =>
          sizes.avif[w] && sizes.webp[w] && (sizes.webp[w] - sizes.avif[w]) / sizes.webp[w] >= AVIF_BENEFIT_THRESHOLD
        )
        if (!benefit) {
          useAvif = false
          // Clean up AVIF files we just wrote - they won't be referenced
          for (const w of widths) {
            await fs.promises.unlink(path.join(this.outDir, variants.avif[w])).catch(() => {})
          }
        }
      }

      let color = null
      if (this.dominantColors) {
        const stats = await this.sharp(abs).stats()
        const d = stats.dominant
        color = '#' + [d.r, d.g, d.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
      }

      this.processed.set(sha8, {
        widths, variants, color, useAvif,
        intrinsicWidth: meta.width,
        intrinsicHeight: meta.height,
      })
      // _resolve() after processed.set() so concurrent awaiter sees the result immediately
      _resolve()
      } catch (e) { _reject(e); throw e } finally { this._inFlight.delete(sha8) }
    }

    const results = await Promise.allSettled([...unique].map(processImage))
    results.filter(r => r.status === 'rejected').forEach(r => console.warn('[arc:img] skipped image:', r.reason?.message ?? r.reason))
  }

  // F3 helper: derive position from AST node path. Returns 'above-fold' for the
  // first 2 images encountered in header/main before any <section>.
  static classifyPositions(imgRefs) {
    // imgRefs are in document order. Count above-fold by index.
    let aboveCount = 0
    return imgRefs.map(r => {
      const pos = (!r.afterSection && aboveCount < 2) ? 'above-fold' : 'below-fold'
      if (pos === 'above-fold') aboveCount++
      return { ...r, position: pos }
    })
  }

  // Emit a <picture> for a processed image. If not processed (no sharp / file missing),
  // returns null so caller falls back to plain <img>.
  emitPicture(src, alt = '', position = 'below-fold') {
    const sha8 = this.hashByPath.get(src)
    if (!sha8) return null
    const p = this.processed.get(sha8)
    if (!p) return null

    const aspect = p.intrinsicHeight / p.intrinsicWidth
    const renderWidth = p.widths[0]
    const renderHeight = Math.round(renderWidth * aspect)
    const srcset = (variants) => p.widths.map(w => `${variants[w]} ${w}w`).join(', ')
    const above = position === 'above-fold'
    const escAlt = String(alt).replace(/"/g, '&quot;')
    const colorAttr = p.color ? ` style="background:${p.color}"` : ''
    const loadAttr = above ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'

    const sources = []
    if (p.useAvif && Object.keys(p.variants.avif).length > 0) {
      sources.push(`<source type="image/avif" srcset="${srcset(p.variants.avif)}">`)
    }
    if (Object.keys(p.variants.webp).length > 0) {
      sources.push(`<source type="image/webp" srcset="${srcset(p.variants.webp)}">`)
    }
    // Fallback <img> uses the original format when available; otherwise WebP.
    const fallbackVariants = Object.keys(p.variants.original).length > 0
      ? p.variants.original : p.variants.webp
    return `<picture>` +
      sources.join('') +
      `<img src="${fallbackVariants[renderWidth]}" srcset="${srcset(fallbackVariants)}" ` +
      `alt="${escAlt}" width="${renderWidth}" height="${renderHeight}"${loadAttr}${colorAttr}>` +
      `</picture>`
  }

  // F2: if the container width is known (from a parent's `w: NNNpx` design rule),
  // emit just that width and its 2× variant. Otherwise fall back to the default ladder.
  _chooseWidths(intrinsic, container) {
    const candidates = container
      ? [container, container * 2]
      : DEFAULT_WIDTHS
    const usable = candidates.filter(w => w > 0 && w <= intrinsic)
    return usable.length > 0 ? usable : [intrinsic]
  }
}

// Walk the AST and collect all <img src=...> references in document order.
// Records `afterSection: true` for any img encountered after the first <section>.
function collectImgRefs(program) {
  const refs = []
  let sawSection = false

  function evalStatic(v) {
    if (v == null) return v
    if (typeof v === 'string') return v
    if (v.type === 'Literal') return v.value
    return null
  }

  function visit(node) {
    if (!node) return
    if (Array.isArray(node)) { for (const n of node) visit(n); return }
    if (typeof node !== 'object') return

    if (node.type === 'Element') {
      if (node.tag === 'section') sawSection = true
      if (node.tag === 'img') {
        const src = evalStatic(node.attrs?.src)
        if (typeof src === 'string' && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
          refs.push({
            src,
            alt: evalStatic(node.attrs?.alt) || '',
            afterSection: sawSection,
          })
        }
      }
      visit(node.children)
      return
    }
    // Generic recurse on declarations / arrays of children
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (v && (Array.isArray(v) || (typeof v === 'object' && (v.type || Array.isArray(v))))) {
        visit(v)
      }
    }
  }

  for (const decl of program.declarations ?? []) {
    if (decl.type === 'PageDecl' || decl.type === 'WidgetDecl') {
      visit(decl.body)
    }
  }
  return refs
}

module.exports = { ImagePipeline, collectImgRefs }
