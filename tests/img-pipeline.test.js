'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { ImagePipeline } = require('../src/img-pipeline')

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-img-'))
  return dir
}

// Build a real, valid 16x16 PNG via sharp on the fly. Returns a Buffer or null.
async function buildTinyPng() {
  try {
    const sharp = require('sharp')
    return await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer()
  } catch { return null }
}

describe('ImagePipeline', () => {
  test('no-op when sharp is unavailable (graceful fallback)', async () => {
    const dir = mkTmp()
    const pipe = new ImagePipeline({ srcDir: dir, outDir: dir, sharpLib: null })
    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0]))
    await pipe.processAll([{ src: 'logo.png', alt: 'logo' }])
    assert.equal(pipe.emitPicture('logo.png'), null, 'returns null when no sharp')
  })

  test('F5: content-hash dedup — same bytes via two refs reuse one entry', async () => {
    const png = await buildTinyPng()
    if (!png) return  // skip without sharp
    const dir = mkTmp()
    fs.writeFileSync(path.join(dir, 'a.png'), png)
    fs.writeFileSync(path.join(dir, 'b.png'), png)   // identical bytes
    const pipe = new ImagePipeline({ srcDir: dir, outDir: dir, dominantColors: false })
    await pipe.processAll([
      { src: 'a.png', alt: 'one' },
      { src: 'b.png', alt: 'two' },
    ])
    const shaA = pipe.hashByPath.get('a.png')
    const shaB = pipe.hashByPath.get('b.png')
    assert.equal(shaA, shaB, 'identical content → same sha8')
    assert.equal(pipe.processed.size, 1, 'one entry in processed map')
  })

  test('F1+F4: emits <picture> with avif/webp/original sources, dominant color, dimensions', async () => {
    const png = await buildTinyPng()
    if (!png) return
    const dir = mkTmp()
    fs.writeFileSync(path.join(dir, 'logo.png'), png)
    const pipe = new ImagePipeline({ srcDir: dir, outDir: dir })
    await pipe.processAll([{ src: 'logo.png', alt: 'logo', containerWidth: 16 }])
    const html = pipe.emitPicture('logo.png', 'logo', 'above-fold')
    assert.ok(html.includes('<picture>'))
    // AVIF may be auto-skipped for tiny images where it doesn't beat WebP by 20%.
    // WebP is always emitted; assert WebP at minimum.
    assert.ok(html.includes('image/webp'), 'WebP source present')
    assert.ok(html.includes('alt="logo"'))
    assert.ok(html.includes('width="16"'), 'has intrinsic width')
    assert.ok(html.includes('fetchpriority="high"'), 'above-fold → high priority')
    assert.ok(/background:#[0-9a-f]{6}/.test(html), 'dominant color emitted as background')
  })

  test('H2: meta.imageFormats=["webp","jpg"] omits AVIF source entirely', async () => {
    const png = await buildTinyPng()
    if (!png) return
    const dir = mkTmp()
    fs.writeFileSync(path.join(dir, 'logo.png'), png)
    const pipe = new ImagePipeline({
      srcDir: dir, outDir: dir, dominantColors: false,
      formats: ['webp', 'jpg'],
    })
    await pipe.processAll([{ src: 'logo.png', alt: 'logo' }])
    const html = pipe.emitPicture('logo.png', 'logo', 'above-fold')
    assert.ok(!html.includes('image/avif'), 'no AVIF source when opted out')
    assert.ok(html.includes('image/webp'), 'WebP still emitted')
    // No .avif files on disk either
    const files = fs.readdirSync(dir)
    assert.ok(files.every(f => !f.endsWith('.avif')), 'no AVIF files written: ' + files.join(','))
  })

  test('F3: below-fold image gets loading=lazy + decoding=async', async () => {
    const png = await buildTinyPng()
    if (!png) return
    const dir = mkTmp()
    fs.writeFileSync(path.join(dir, 'logo.png'), png)
    const pipe = new ImagePipeline({ srcDir: dir, outDir: dir, dominantColors: false })
    await pipe.processAll([{ src: 'logo.png', alt: 'logo', containerWidth: 16 }])
    const html = pipe.emitPicture('logo.png', 'logo', 'below-fold')
    assert.ok(html.includes('loading="lazy"'))
    assert.ok(html.includes('decoding="async"'))
    assert.ok(!html.includes('fetchpriority="high"'))
  })

  test('F2: layout-aware widths — uses container width + 2× when given', () => {
    const pipe = new ImagePipeline({ srcDir: '/', outDir: '/' })
    assert.deepEqual(pipe._chooseWidths(3200, 400), [400, 800])
    assert.deepEqual(pipe._chooseWidths(3200, 1000), [1000, 2000])
    // Default ladder when no container width
    assert.deepEqual(pipe._chooseWidths(3200), [400, 800, 1200, 1600])
    // Clamp to intrinsic
    assert.deepEqual(pipe._chooseWidths(500), [400])
  })

  test('F3: classifyPositions marks first 2 as above-fold, rest below', () => {
    const refs = [{ src: 'a' }, { src: 'b' }, { src: 'c' }, { src: 'd', afterSection: true }]
    const out = ImagePipeline.classifyPositions(refs)
    assert.equal(out[0].position, 'above-fold')
    assert.equal(out[1].position, 'above-fold')
    assert.equal(out[2].position, 'below-fold')
    assert.equal(out[3].position, 'below-fold')
  })
})
