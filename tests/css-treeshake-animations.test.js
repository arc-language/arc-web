'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { _internal } = require('../src/cli')
const { treeshakeAnimationCss } = _internal

describe('treeshakeAnimationCss', () => {

  test('drops .animate-X rules whose class is not in HTML', () => {
    const css = `
.animate-float-in { animation: float-in .6s ease-out both }
.animate-zoom-in  { animation: zoom-in  .6s ease-out both }
.animate-glow     { animation: glow     2s linear infinite }
@keyframes float-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes zoom-in  { from { transform: scale(0.9) } to { transform: scale(1) } }
@keyframes glow     { 50% { box-shadow: 0 0 16px cyan } }
`
    const html = `<div class="animate-float-in">hi</div>`
    const out = treeshakeAnimationCss(css, html)
    assert.ok(out.includes('.animate-float-in'), 'kept float-in rule')
    assert.ok(!out.includes('.animate-zoom-in'), 'dropped zoom-in rule')
    assert.ok(!out.includes('.animate-glow'),    'dropped glow rule')
    assert.ok(out.includes('@keyframes float-in'),  'kept float-in keyframe')
    assert.ok(!out.includes('@keyframes zoom-in'),  'dropped zoom-in keyframe')
    assert.ok(!out.includes('@keyframes glow'),     'dropped glow keyframe')
  })

  test('keeps user-defined keyframes still referenced by surviving rules', () => {
    // .my-thing is not an .animate-* rule, so it survives unchanged.
    // Its `animation: my-spin` reference must keep @keyframes my-spin alive.
    const css = `
.my-thing { animation: my-spin 1s linear infinite }
.animate-foo { animation: foo 1s ease-out both }
@keyframes my-spin { to { transform: rotate(1turn) } }
@keyframes foo     { to { opacity: 1 } }
@keyframes unused  { 0% { x: 0 } }
`
    const html = `<div class="my-thing">hi</div>`
    const out = treeshakeAnimationCss(css, html)
    assert.ok(out.includes('.my-thing'),         'kept user rule')
    assert.ok(!out.includes('.animate-foo'),     'dropped unused .animate-foo rule')
    assert.ok(out.includes('@keyframes my-spin'),'kept keyframe referenced by user rule')
    assert.ok(!out.includes('@keyframes foo'),   'dropped keyframe whose .animate-* class is unused')
    assert.ok(!out.includes('@keyframes unused'),'dropped unreferenced keyframe')
  })

  test('handles vendor-prefixed @-webkit-keyframes', () => {
    const css = `
.animate-spin { animation: spin 1s linear infinite }
@-webkit-keyframes spin { to { transform: rotate(1turn) } }
@keyframes spin { to { transform: rotate(1turn) } }
@-webkit-keyframes orphan { 0% { x: 0 } }
@keyframes orphan { 0% { x: 0 } }
`
    const html = `<div class="animate-spin"></div>`
    const out = treeshakeAnimationCss(css, html)
    assert.ok(out.includes('@-webkit-keyframes spin'), 'kept vendor-prefixed spin')
    assert.ok(out.includes('@keyframes spin'),         'kept standard spin')
    assert.ok(!out.includes('orphan'),                 'dropped both forms of orphan')
  })

  test('handles compound selectors like .animate-X:hover and .a.animate-X', () => {
    const css = `
.animate-glow         { animation: glow 1s ease infinite }
.animate-glow:hover   { animation-play-state: paused }
.card.animate-glow    { will-change: box-shadow }
.animate-unused       { animation: unused 1s ease }
@keyframes glow   { 50% { opacity: .8 } }
@keyframes unused { 0% { x: 0 } }
`
    const html = `<div class="animate-glow card">x</div>`
    const out = treeshakeAnimationCss(css, html)
    assert.ok(out.includes('.animate-glow'),       'kept primary rule')
    assert.ok(out.includes('.animate-glow:hover'), 'kept pseudo rule')
    assert.ok(out.includes('.card.animate-glow'),  'kept compound selector')
    assert.ok(!out.includes('.animate-unused'),    'dropped unused rule')
    assert.ok(out.includes('@keyframes glow'),     'kept glow keyframe')
    assert.ok(!out.includes('@keyframes unused'),  'dropped unused keyframe')
  })

  test('keeps non-animation CSS untouched when no .animate-* rules are present', () => {
    const css = `.foo { color: red } .bar { padding: 10px }`
    const out = treeshakeAnimationCss(css, '<div class="foo"></div>')
    assert.equal(out.trim(), css.trim())
  })

  test('drops orphaned @keyframes (not referenced by any animation property)', () => {
    const css = `.foo { color: red } @keyframes orphan { 0% { x: 0 } }`
    const out = treeshakeAnimationCss(css, '<div class="foo"></div>')
    assert.ok(!out.includes('@keyframes orphan'), 'orphaned keyframe removed')
    assert.ok(out.includes('.foo'), 'unrelated rule preserved')
  })

  test('does not strip keyframes referenced by animation shorthand with leading duration', () => {
    const css = `
.box { animation: 1s ease-out forwards slidein }
@keyframes slidein { to { transform: translateX(0) } }
`
    const out = treeshakeAnimationCss(css, '<div class="box"></div>')
    assert.ok(out.includes('@keyframes slidein'), 'keyframe survives even when name is the last shorthand token')
  })

})
