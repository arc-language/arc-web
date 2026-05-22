'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { compile } = require('../src/cli')
const { CssEmitter, SHORTHANDS, KEYFRAMES } = require('../src/emitters/css')

// Helper: build a minimal AST program with a DesignBlock for direct CssEmitter testing
function makeDesignProgram(selector, props) {
  return {
    declarations: [{
      type: 'DesignBlock',
      rules: [{
        type: 'StyleRule',
        selector,
        props: props.map(([name, value]) => ({ type: 'StyleProp', name, value, line: 1 })),
        children: [],
        line: 1
      }]
    }]
  }
}

describe('CSS Emitter', () => {

  describe('base layer (via compile)', () => {
    test('CSS output contains @layer base', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('@layer base {'), `Expected @layer base { in:\n${css}`)
    })

    test('@layer base includes box-sizing reset', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('box-sizing: border-box'))
    })

    test('@layer base defines CSS custom properties for fonts', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('--arc-font-sans:'))
    })

    test('@layer base includes arc-row flex utility', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('.arc-row'))
      assert.ok(css.includes('flex-direction: row'))
    })

    test('@layer base includes arc-col flex utility', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('.arc-col'))
    })

    test('@layer base defines shadow CSS variables', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('--arc-shadow-sm:'))
    })

    test('@layer base defines radius CSS variables', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('--arc-radius-sm:'))
    })

    test('@layer base defines mono font variable', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('--arc-font-mono:'))
    })
  })

  describe('design blocks via compile (end-to-end)', () => {
    test('widget with design block emits scoped CSS', async () => {
      const src = `widget Card
  text "Hello"
  design
    p: 16px
    bg: white`
      const { css } = await compile(src)
      assert.ok(css.includes('padding'), `Expected padding in CSS:\n${css}`)
    })

    test('page with design block emits CSS for the page', async () => {
      const src = `page "T"
  heading "Hi"
  design
    bg: #f0f0f0`
      const { css } = await compile(src)
      // The design block should produce CSS (not be silently dropped)
      assert.ok(css.length > 100, `Expected non-trivial CSS, got:\n${css}`)
    })
  })

  describe('design blocks emit component layer (direct emitter)', () => {
    test('design block emits @layer component wrapper', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.card', [['p', '16px']]))
      assert.ok(css.includes('@layer component {'), `Expected @layer component in:\n${css}`)
    })

    test('design block scopes class selectors with hash suffix', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.card', [['p', '16px']]))
      assert.ok(css.includes('.card_h1'), `Expected .card_h1 in:\n${css}`)
    })

    test('design block p shorthand expands to padding', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.box', [['p', '16px']]))
      assert.ok(css.includes('padding: 16px'), `Expected padding: 16px in:\n${css}`)
    })

    test('design block m shorthand expands to margin', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.item', [['m', '8px']]))
      assert.ok(css.includes('margin: 8px'))
    })

    test('design block bg shorthand expands to background-color', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.hero', [['bg', 'blue']]))
      assert.ok(css.includes('background-color:'))
    })

    test('design block size shorthand expands to font-size', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.title', [['size', '24px']]))
      assert.ok(css.includes('font-size: 24px'), `Expected font-size in:\n${css}`)
    })

    test('design block gap shorthand emits gap property', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.row', [['gap', '12px']]))
      assert.ok(css.includes('gap: 12px'))
    })

    test('design block w shorthand emits width', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.box', [['w', '100%']]))
      assert.ok(css.includes('width:'))
    })

    test('design block fg shorthand emits color', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.text', [['fg', 'red']]))
      assert.ok(css.includes('color:'))
    })
  })

  describe('CssEmitter.scopeSelector', () => {
    test('scopes class selectors with hash', () => {
      const emitter = new CssEmitter({ hash: 'abc1' })
      const scoped = emitter.scopeSelector('.card')
      assert.equal(scoped, '.card_abc1')
    })

    test('scopes multiple class selectors', () => {
      const emitter = new CssEmitter({ hash: 'abc1' })
      const scoped = emitter.scopeSelector('.card .title')
      assert.equal(scoped, '.card_abc1 .title_abc1')
    })

    test('element selectors are not scoped', () => {
      const emitter = new CssEmitter({ hash: 'abc1' })
      const scoped = emitter.scopeSelector('button')
      assert.equal(scoped, 'button')
    })

    test('nav element selector is unchanged', () => {
      const emitter = new CssEmitter({ hash: 'abc1' })
      const scoped = emitter.scopeSelector('nav')
      assert.equal(scoped, 'nav')
    })

    test('compound selector with class and element scopes class only', () => {
      const emitter = new CssEmitter({ hash: 'abc1' })
      const scoped = emitter.scopeSelector('div.active')
      assert.ok(scoped.includes('_abc1'))
    })
  })

  describe('CSS shorthands', () => {
    test('SHORTHANDS has p shorthand', () => {
      assert.ok(typeof SHORTHANDS['p'] === 'function')
      assert.equal(SHORTHANDS['p']('16px'), 'padding: 16px')
    })

    test('SHORTHANDS has fg shorthand for color', () => {
      assert.ok(typeof SHORTHANDS['fg'] === 'function')
      const result = SHORTHANDS['fg']('red')
      assert.ok(result.includes('color:'))
    })

    test('SHORTHANDS has gap shorthand', () => {
      assert.ok(typeof SHORTHANDS['gap'] === 'function')
      assert.equal(SHORTHANDS['gap']('8px'), 'gap: 8px')
    })

    test('SHORTHANDS weight maps bold to 700', () => {
      assert.ok(typeof SHORTHANDS['weight'] === 'function')
      assert.equal(SHORTHANDS['weight']('bold'), 'font-weight: 700')
    })

    test('SHORTHANDS weight maps semibold to 600', () => {
      assert.equal(SHORTHANDS['weight']('semibold'), 'font-weight: 600')
    })

    test('SHORTHANDS hidden produces display none', () => {
      assert.ok(typeof SHORTHANDS['hidden'] === 'function')
      assert.equal(SHORTHANDS['hidden'](), 'display: none')
    })

    test('SHORTHANDS w shorthand produces width', () => {
      assert.ok(typeof SHORTHANDS['w'] === 'function')
      assert.ok(SHORTHANDS['w']('100%').includes('width:'))
    })

    test('SHORTHANDS m-x expands to horizontal margins', () => {
      assert.ok(typeof SHORTHANDS['m-x'] === 'function')
      const result = SHORTHANDS['m-x']('auto')
      assert.ok(result.includes('margin-left'))
      assert.ok(result.includes('margin-right'))
    })

    test('SHORTHANDS p-y expands to vertical padding', () => {
      assert.ok(typeof SHORTHANDS['p-y'] === 'function')
      const result = SHORTHANDS['p-y']('8px')
      assert.ok(result.includes('padding-top'))
      assert.ok(result.includes('padding-bottom'))
    })
  })

  describe('keyframes', () => {
    test('KEYFRAMES has fade-in definition', () => {
      assert.ok(KEYFRAMES['fade-in'].includes('@keyframes fade-in'))
    })

    test('KEYFRAMES has slide-up definition', () => {
      assert.ok(KEYFRAMES['slide-up'].includes('@keyframes slide-up'))
    })

    test('KEYFRAMES has spin definition', () => {
      assert.ok(KEYFRAMES['spin'].includes('@keyframes spin'))
    })

    test('KEYFRAMES has bounce definition', () => {
      assert.ok(KEYFRAMES['bounce'].includes('@keyframes bounce'))
    })

    test('animate shorthand in design block emits keyframes in CSS', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.logo', [['animate', 'spin 1s linear']]))
      assert.ok(css.includes('@keyframes spin'), `Expected spin keyframes in:\n${css}`)
    })

    test('animate shorthand emits animation property', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.icon', [['animate', 'fade-in 0.3s ease']]))
      assert.ok(css.includes('animation:'))
    })
  })

  describe('pseudo-class shorthands (hover/focus/active)', () => {
    test('hover: { ... } emits :hover rule', async () => {
      const src = 'page "T"\n  button on:click={}\n  design\n    button\n      bg: #333\n      hover: { bg: #555 }'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes(':hover'), `Expected :hover in:\n${css}`)
      assert.ok(css.includes('#555'), `Expected hover color in:\n${css}`)
    })

    test('focus: { ... } emits :focus-visible rule', async () => {
      const src = 'page "T"\n  input\n  design\n    input\n      focus: { outline: 2px #0070f3 }'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes(':focus-visible'), `Expected :focus-visible in:\n${css}`)
    })

    test('hover rule is separate from base rule', async () => {
      const src = 'page "T"\n  button on:click={}\n  design\n    button\n      bg: #333\n      hover: { bg: #555 }'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes('#333'), 'base bg missing')
      assert.ok(css.includes('#555'), 'hover bg missing')
      assert.ok(css.includes(':hover'), ':hover selector missing')
    })
  })

  describe('responsive conditions and design correctness', () => {
    test('@mobile block emits @media max-width query', async () => {
      const src = 'page "T"\n  text "hi"\n  design\n    @mobile\n      text\n        size: 14px'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes('@media'), `Expected @media in:\n${css}`)
      assert.ok(css.includes('max-width'), `Expected max-width in:\n${css}`)
    })

    test('@dark block emits prefers-color-scheme: dark query', async () => {
      const src = 'page "T"\n  text "hi"\n  design\n    @dark\n      text\n        fg: white'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes('prefers-color-scheme'), `Expected dark mode query in:\n${css}`)
    })

    test('hyphenated CSS property names compile correctly', async () => {
      const src = 'page "T"\n  text "hi"\n  design\n    body\n      align-items: center\n      justify-content: flex-start'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes('align-items: center'), `Expected align-items in:\n${css}`)
      assert.ok(css.includes('justify-content: flex-start'), `Expected justify-content in:\n${css}`)
    })

    test('3-digit hex colors compile correctly', async () => {
      const src = 'page "T"\n  text "hi"\n  design\n    body\n      fg: #111\n      bg: #fff'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes('#111'), `Expected #111 in:\n${css}`)
      assert.ok(css.includes('#fff'), `Expected #fff in:\n${css}`)
    })

    test('font stack with hyphens compiles correctly', async () => {
      const src = 'page "T"\n  text "hi"\n  design\n    body\n      font: system-ui, sans-serif'
      const { css } = await compile(src, 'test.arc', {})
      assert.ok(css.includes('system-ui'), `Expected system-ui in:\n${css}`)
      assert.ok(css.includes('sans-serif'), `Expected sans-serif in:\n${css}`)
      assert.ok(!css.includes('system - ui'), 'Should not have spaces around hyphen')
    })
  })

  describe('@-rule conditions (direct emitter)', () => {
    test('@tablet condition emits @media query', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleCondition',
            kind: 'tablet',
            query: null,
            rules: [{
              type: 'StyleRule',
              selector: 'body',
              props: [{ type: 'StyleProp', name: 'font-size', value: '16px', line: 1 }],
              children: [],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('@media'), `Expected @media in:\n${css}`)
    })

    test('@dark condition emits prefers-color-scheme query', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleCondition',
            kind: 'dark',
            query: null,
            rules: [{
              type: 'StyleRule',
              selector: 'body',
              props: [{ type: 'StyleProp', name: 'color', value: 'white', line: 1 }],
              children: [],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('prefers-color-scheme: dark'), `Expected dark query in:\n${css}`)
    })

    test('@container condition emits @container query with size', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleCondition',
            kind: 'container',
            query: '(max-width: 400px)',
            rules: [{
              type: 'StyleRule',
              selector: '.card',
              props: [{ type: 'StyleProp', name: 'padding', value: '8px', line: 1 }],
              children: [],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('@container'), `Expected @container in:\n${css}`)
    })

    test('scopeSelector adds hash suffix to class', () => {
      const emitter = new CssEmitter({ hash: 'abc' })
      const scoped = emitter.scopeSelector('.card')
      assert.ok(scoped.includes('_abc'), `Expected hash suffix in: ${scoped}`)
    })

    test('scopeSelector leaves element selectors unchanged', () => {
      const emitter = new CssEmitter({ hash: 'abc' })
      const scoped = emitter.scopeSelector('body')
      assert.equal(scoped, 'body')
    })

    test('unknown rule type returns empty string', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const result = emitter.emitRule({ type: 'WeirdUnknown' })
      assert.equal(result, '')
    })
  })
})
