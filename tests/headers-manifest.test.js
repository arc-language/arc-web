'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert')
const { emit } = require('../src/emitters/headers-manifest')

describe('headers-manifest emitter', () => {
  test('always emits site-wide security headers under /*', () => {
    const out = emit()
    assert.ok(out.includes('/*'))
    assert.ok(out.includes('Content-Security-Policy:'))
    assert.ok(out.includes('X-Content-Type-Options: nosniff'))
    assert.ok(out.includes('X-Frame-Options: SAMEORIGIN'))
    assert.ok(out.includes('Referrer-Policy: strict-origin-when-cross-origin'))
    assert.ok(out.includes('Permissions-Policy: camera=()'))
  })

  test('emits immutable Cache-Control for image variants', () => {
    const out = emit()
    assert.ok(out.includes('/*.avif'))
    assert.ok(out.includes('/*.webp'))
    assert.ok(out.includes('/*.jpg'))
    assert.ok(out.includes('/*.png'))
    assert.ok(out.includes('max-age=31536000, immutable'))
  })

  test('emits revalidate Cache-Control for HTML', () => {
    const out = emit()
    assert.ok(out.includes('/*.html'))
    assert.ok(out.includes('max-age=0, must-revalidate'))
  })

  test('when sharedCssFilename given, emits immutable rule + Link preload', () => {
    const out = emit({ sharedCssFilename: 'shared.abc12345.css' })
    assert.ok(out.includes('/shared.*.css'))
    assert.ok(out.includes('Link: </shared.abc12345.css>; rel=preload; as=style'))
  })

  test('when sharedCssFilename omitted, no Link preload header', () => {
    const out = emit()
    assert.ok(!out.includes('rel=preload'))
    assert.ok(!out.includes('/shared.*.css'))
  })

  test('custom CSP override is applied', () => {
    const customCsp = "default-src 'none'"
    const out = emit({ csp: customCsp })
    assert.ok(out.includes(`Content-Security-Policy: ${customCsp}`))
  })
})
