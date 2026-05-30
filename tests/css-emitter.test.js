'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { compile } = require('../src/cli')
const { CssEmitter, SHORTHANDS, KEYFRAMES, GRADIENT_PRESETS } = require('../src/emitters/css')

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
    test('CSS output contains @layer base when user has component styles', async () => {
      // C5: @layer wrapping is stripped when only one layer is present.
      // Add a user design block to force component layer → both layers wrap.
      const { css } = await compile('page "T"\n  text "x"\ndesign\n  body\n    bg: red')
      assert.ok(css.includes('@layer base {'), `Expected @layer base { in:\n${css}`)
      assert.ok(css.includes('@layer component'), `Expected @layer component in:\n${css}`)
    })

    test('@layer base wrapper stripped when no user CSS present', async () => {
      const { css } = await compile('page "T"')
      assert.ok(!css.includes('@layer base {'), `Expected no @layer wrapper for single-layer output`)
      // Base styles still present, just unwrapped
      assert.ok(css.includes('box-sizing: border-box'))
    })

    test('@layer base includes box-sizing reset', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('box-sizing: border-box'))
    })

    test('@layer base defines CSS custom properties for fonts', async () => {
      const { css } = await compile('page "T"')
      assert.ok(css.includes('--arc-font-sans:'))
    })

    test('unused arc-* base utilities are tree-shaken from CSS', async () => {
      // Base utility classes (.arc-row, .arc-col, .arc-sr-only, etc.) are only
      // emitted in CSS when their bare class name appears in the HTML.
      // Arc primitives always emit scoped variants (arc-row_HASH), so the
      // unscoped utility is dead weight unless a user explicitly references it.
      const { css } = await compile('page "T"\n  main\n    text "hello"')
      assert.ok(!/\.arc-row\s*\{/.test(css), 'unused .arc-row should be stripped')
      assert.ok(!/\.arc-col\s*\{/.test(css), 'unused .arc-col should be stripped')
      assert.ok(!/\.arc-sr-only\s*\{/.test(css), 'unused .arc-sr-only should be stripped (user main, no auto h1)')
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

    test('unknown rule type returns empty string', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const result = emitter.emitRule({ type: 'WeirdUnknown' })
      assert.equal(result, '')
    })
  })

  describe('shorthand expansion functions', () => {
    test('w shorthand with arithmetic wraps in calc()', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['w', '100% - 32px']]))
      assert.ok(css.includes('calc(100% - 32px)'), `Expected calc() in:\n${css}`)
    })

    test('w shorthand without arithmetic leaves value as-is', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['w', '300px']]))
      assert.ok(css.includes('width: 300px'))
      // Only check that the width property itself is not wrapped in calc()
      const widthMatch = css.match(/width:[^;}\n]+/)
      assert.ok(widthMatch && !widthMatch[0].includes('calc('), `width should not be wrapped in calc: ${widthMatch && widthMatch[0]}`)
    })

    test('border 2-part shorthand expands to width/solid/color', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['border', '1px #ccc']]))
      assert.ok(css.includes('solid'), `Expected solid in:\n${css}`)
      assert.ok(css.includes('1px'))
      assert.ok(css.includes('#ccc'))
    })

    test('weight: bold expands to 700', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['weight', 'bold']]))
      assert.ok(css.includes('font-weight: 700'), `Expected 700 in:\n${css}`)
    })

    test('weight: semibold expands to 600', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['weight', 'semibold']]))
      assert.ok(css.includes('font-weight: 600'), `Expected 600 in:\n${css}`)
    })

    test('line: tight expands to 1.25', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['line', 'tight']]))
      assert.ok(css.includes('line-height: 1.25'))
    })

    test('tracking: wide expands to 0.025em', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['tracking', 'wide']]))
      assert.ok(css.includes('letter-spacing: 0.025em'))
    })

    test('flex with column+gap+align+justify expands all', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'column gap=16px align=center justify=between']]))
      assert.ok(css.includes('display: flex'))
      assert.ok(css.includes('flex-direction: column'))
      assert.ok(css.includes('gap: 16px'))
      assert.ok(css.includes('align-items: center'))
      assert.ok(css.includes('justify-content: space-between'))
    })

    test('grid with 3col expands to repeat(3, 1fr)', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['grid', '3col gap=16px']]))
      assert.ok(css.includes('display: grid'))
      assert.ok(css.includes('repeat(3, 1fr)'), `Expected 3col → repeat(3, 1fr) in:\n${css}`)
      assert.ok(css.includes('gap: 16px'))
    })

    test('transition with 2 parts adds default ease', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['transition', 'opacity 150ms']]))
      assert.ok(css.includes('opacity 150ms ease'), `Expected ease added in:\n${css}`)
    })

    test('border 1-part shorthand passes through unchanged', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['border', '1px']]))
      // 1-part: no expansion — passes through as is
      assert.ok(css.includes('border: 1px'))
    })

    test('weight: numeric value passes through unchanged', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['weight', '500']]))
      assert.ok(css.includes('font-weight: 500'))
    })

    test('line-height: numeric value passes through', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['line', '1.5']]))
      assert.ok(css.includes('line-height: 1.5'))
    })

    test('tracking: arbitrary value passes through', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['tracking', '0.1px']]))
      assert.ok(css.includes('letter-spacing: 0.1px'))
    })

    test('flex with row direction', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'row']]))
      assert.ok(css.includes('flex-direction: row'))
    })

    test('flex with wrap option', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'wrap']]))
      assert.ok(css.includes('flex-wrap: wrap'))
    })

    test('flex with nowrap option', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'nowrap']]))
      assert.ok(css.includes('flex-wrap: nowrap'))
    })

    test('flex with col alias', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'col']]))
      assert.ok(css.includes('flex-direction: column'))
    })

    test('flex with align=stretch', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'col align=stretch']]))
      assert.ok(css.includes('align-items: stretch'))
    })

    test('flex with justify=around', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', 'row justify=around']]))
      assert.ok(css.includes('justify-content: space-around'))
    })

    test('flex with no value uses defaults', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['flex', '']]))
      assert.ok(css.includes('display: flex'))
    })

    test('grid with no value uses defaults', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['grid', '']]))
      assert.ok(css.includes('display: grid'))
    })

    test('grid with fr unit columns', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['grid', '1fr']]))
      assert.ok(css.includes('grid-template-columns: 1fr'))
    })

    test('transition with single-part passes through', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['transition', 'all 200ms ease-out']]))
      assert.ok(css.includes('all 200ms ease-out'))
    })

    test('animation shorthand tracks keyframe in usedKeyframes', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.x', [['animate', 'fadeIn 200ms ease']]))
      assert.ok(css.includes('animation:'))
    })

    test('nested style rule with &:hover combinator', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.btn',
            props: [{ type: 'StyleProp', name: 'color', value: 'blue', line: 1 }],
            children: [{
              type: 'StyleRule',
              selector: '&:hover',
              props: [{ type: 'StyleProp', name: 'color', value: 'red', line: 1 }],
              children: [],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes(':hover'), `Expected hover in:\n${css}`)
    })

    test('nested style rule with descendant selector', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.card',
            props: [{ type: 'StyleProp', name: 'p', value: '16px', line: 1 }],
            children: [{
              type: 'StyleRule',
              selector: '.title',
              props: [{ type: 'StyleProp', name: 'weight', value: 'bold', line: 1 }],
              children: [],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('.card_h1 .title_h1'), `Expected descendant: ${css}`)
    })

    test('emitConditionNested with inline props and nested rules', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.card',
            props: [{ type: 'StyleProp', name: 'p', value: '16px', line: 1 }],
            children: [{
              type: 'StyleCondition',
              kind: 'mobile',
              query: null,
              rules: [
                { type: 'StyleProp', name: 'p', value: '8px', line: 1 },
                {
                  type: 'StyleRule',
                  selector: '&:hover',
                  props: [{ type: 'StyleProp', name: 'p', value: '4px', line: 1 }],
                  children: [],
                  line: 1
                }
              ],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('@media'), `Expected media query: ${css}`)
      assert.ok(css.includes('padding: 8px'), `Expected mobile padding`)
    })

    test('emitConditionNested with empty rules returns empty', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const result = emitter.emitConditionNested(
        { type: 'StyleCondition', kind: 'mobile', query: null, rules: [], line: 1 },
        '.card_h1'
      )
      assert.equal(result, '')
    })

    test('resolveCondition for unknown kind returns null', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      assert.equal(emitter.resolveCondition('unknown', null), null)
    })

    test('resolveCondition for starting-style', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      assert.equal(emitter.resolveCondition('starting-style', null), '@starting-style')
    })

    test('resolveCondition for media with explicit query', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      assert.equal(emitter.resolveCondition('media', '(min-width: 800px)'), '@media (min-width: 800px)')
    })

    test('scopeSelector returns selector unchanged when null/empty', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      assert.equal(emitter.scopeSelector(null), null)
      assert.equal(emitter.scopeSelector(''), '')
    })

    test('emitCondition with empty inner rules returns empty', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const result = emitter.emitCondition({
        kind: 'mobile', query: null, rules: [], line: 1
      })
      assert.equal(result, '')
    })

    test('width property uses expandCalc directly (literal property name)', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      // Use 'width' as the literal property name (not 'w' shorthand)
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.box',
            props: [{ type: 'StyleProp', name: 'width', value: '100% - 32px', line: 1 }],
            children: [],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('calc(100% - 32px)'), `Expected calc(): ${css}`)
    })

    test('height property uses expandCalc directly', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.box',
            props: [{ type: 'StyleProp', name: 'height', value: '50vh', line: 1 }],
            children: [],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('height: 50vh'))
    })

    test('CSS property with vendor prefix needed (e.g. appearance)', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      // Find a property that needs a prefix. Common candidates: appearance, user-select
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.btn',
            props: [{ type: 'StyleProp', name: 'appearance', value: 'none', line: 1 }],
            children: [],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      // Either has the property or has a -webkit-appearance prefix (or both)
      assert.ok(css.includes('appearance: none'))
    })

    test('emitConditionNested with rule that has empty decls returns empty inner', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.card',
            props: [{ type: 'StyleProp', name: 'p', value: '16px', line: 1 }],
            children: [{
              type: 'StyleCondition',
              kind: 'mobile',
              query: null,
              rules: [{
                type: 'StyleRule',
                selector: '&:focus',
                props: [],  // Empty props
                children: [],
                line: 1
              }],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.length > 0, `Expected output: ${css}`)
    })

    test('nested style condition with pseudo-class selector (::before)', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const program = {
        declarations: [{
          type: 'DesignBlock',
          rules: [{
            type: 'StyleRule',
            selector: '.card',
            props: [{ type: 'StyleProp', name: 'p', value: '16px', line: 1 }],
            children: [{
              type: 'StyleCondition',
              kind: 'mobile',
              query: null,
              rules: [{
                type: 'StyleRule',
                selector: '::before',
                props: [{ type: 'StyleProp', name: 'content', value: '""', line: 1 }],
                children: [],
                line: 1
              }],
              line: 1
            }],
            line: 1
          }]
        }]
      }
      const css = emitter.emitProgram(program)
      assert.ok(css.includes('::before'), `Expected ::before in: ${css}`)
    })

    test('emitCondition with unknown kind returns empty', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const result = emitter.emitCondition({
        kind: 'unknown', query: null, rules: [
          { type: 'StyleRule', selector: '.x', props: [{ type: 'StyleProp', name: 'color', value: 'red', line: 1 }], children: [], line: 1 }
        ], line: 1
      })
      assert.equal(result, '')
    })
  })

  describe('gradient-text shorthand', () => {
    test('GRADIENT_PRESETS is exported and has 8 named presets', () => {
      const keys = Object.keys(GRADIENT_PRESETS)
      assert.equal(keys.length, 8)
      assert.ok(keys.includes('rainbow'))
      assert.ok(keys.includes('ocean'))
    })

    test('gradient-text: rainbow expands to 4 CSS declarations', () => {
      const result = SHORTHANDS['gradient-text']('rainbow')
      assert.ok(result.includes('linear-gradient(to right,'), `Expected gradient: ${result}`)
      assert.ok(result.includes('#ff0000'), `Expected rainbow red: ${result}`)
      assert.ok(result.includes('background-clip: text'), `Expected clip: ${result}`)
      assert.ok(result.includes('-webkit-background-clip: text'), `Expected webkit clip: ${result}`)
      assert.ok(result.includes('color: transparent'), `Expected transparent: ${result}`)
    })

    test('gradient-text: ocean expands with correct preset colors', () => {
      const result = SHORTHANDS['gradient-text']('ocean')
      assert.ok(result.includes('#0ea5e9'), `Expected ocean blue: ${result}`)
    })

    test('gradient-text with deg direction prefix strips it correctly', () => {
      const result = SHORTHANDS['gradient-text']('135deg, #ff0000, #0000ff')
      assert.ok(result.includes('linear-gradient(135deg,'), `Expected 135deg direction: ${result}`)
      assert.ok(result.includes('#ff0000'), `Expected red: ${result}`)
      assert.ok(result.includes('#0000ff'), `Expected blue: ${result}`)
    })

    test('gradient-text with single-word to-direction strips it correctly', () => {
      const result = SHORTHANDS['gradient-text']('to bottom, #ff0000, #0000ff')
      assert.ok(result.includes('linear-gradient(to bottom,'), `Expected to bottom: ${result}`)
    })

    test('gradient-text with two-word to-direction (to bottom right) strips it correctly', () => {
      const result = SHORTHANDS['gradient-text']('to bottom right, #ff0000, #0000ff')
      assert.ok(result.includes('linear-gradient(to bottom right, #ff0000'), `Expected two-word direction then colors: ${result}`)
      // Verify colors were NOT treated as the direction (would produce "linear-gradient(to right, to bottom right, ...)")
      assert.ok(!result.includes('linear-gradient(to right, to bottom'), 'Direction should not be mis-parsed')
    })

    test('gradient-text with raw color list (no direction) uses default direction', () => {
      const result = SHORTHANDS['gradient-text']('#ff0000, #00ff00, #0000ff')
      assert.ok(result.includes('linear-gradient(to right,'), `Expected default direction: ${result}`)
      assert.ok(result.includes('#ff0000'), `Expected colors: ${result}`)
    })

    test('gradient-text emits in design block and produces scoped CSS', () => {
      const emitter = new CssEmitter({ hash: 'test' })
      const css = emitter.emitProgram(makeDesignProgram('.hero', [['gradient-text', 'neon']]))
      assert.ok(css.includes('background-clip: text'), `Expected clip in: ${css}`)
      assert.ok(css.includes('color: transparent'), `Expected transparent in: ${css}`)
      assert.ok(css.includes('.hero_test'), `Expected scoped selector in: ${css}`)
    })

    test('animate: gradient-shift with infinite passes through extra token', () => {
      const result = SHORTHANDS['animate']('gradient-shift 4s linear infinite')
      assert.equal(result, 'animation: gradient-shift 4s linear infinite')
    })

    test('animate: gradient-shift in design block emits gradient-shift keyframes', () => {
      const emitter = new CssEmitter({ hash: 'h1' })
      const css = emitter.emitProgram(makeDesignProgram('.gt', [
        ['background-size', '200% auto'],
        ['animate', 'gradient-shift 4s linear infinite'],
      ]))
      assert.ok(css.includes('@keyframes gradient-shift'), `Expected keyframe: ${css}`)
      assert.ok(css.includes('background-position'), `Expected background-position: ${css}`)
    })

    test('KEYFRAMES has gradient-shift, gradient-x, and shimmer', () => {
      assert.ok(KEYFRAMES['gradient-shift'].includes('@keyframes gradient-shift'))
      assert.ok(KEYFRAMES['gradient-x'].includes('@keyframes gradient-x'))
      assert.ok(KEYFRAMES['shimmer'].includes('@keyframes shimmer'))
    })

    test('gradient-text with empty value emits empty string and warns', () => {
      const result = SHORTHANDS['gradient-text']('')
      assert.equal(result, '')
    })

    test('GRADIENT_PRESETS and SHORTHANDS gradient-text presets are consistent', () => {
      for (const name of Object.keys(GRADIENT_PRESETS)) {
        const result = SHORTHANDS['gradient-text'](name)
        assert.ok(result.includes('linear-gradient'), `Expected gradient for preset "${name}": ${result}`)
        assert.ok(result.includes(GRADIENT_PRESETS[name].split(',')[0]), `Expected first color of "${name}": ${result}`)
      }
    })

    test('gradient-text with unrecognized to-direction warns and falls back to default', () => {
      // "to diagonal" is not a recognized direction pattern — should warn but still produce output
      const stderrMsgs = []
      const origWrite = process.stderr.write.bind(process.stderr)
      process.stderr.write = (s) => { stderrMsgs.push(s); return true }
      try {
        const result = SHORTHANDS['gradient-text']('to diagonal, #ff0000, #00ff00')
        assert.ok(result.includes('linear-gradient'), `Expected gradient, got: ${result}`)
      } finally {
        process.stderr.write = origWrite
      }
      assert.ok(stderrMsgs.some(m => m.includes('not recognized')), 'Expected direction-not-recognized warning')
    })

    test('gradient-text with unknown non-color value warns', () => {
      const stderrMsgs = []
      const origWrite = process.stderr.write.bind(process.stderr)
      process.stderr.write = (s) => { stderrMsgs.push(s); return true }
      try {
        const result = SHORTHANDS['gradient-text']('notapreset')
        assert.ok(typeof result === 'string', 'should return a string')
      } finally {
        process.stderr.write = origWrite
      }
      assert.ok(stderrMsgs.some(m => m.includes("is not a known preset")), 'Expected unknown-preset warning')
    })
  })
})

// ── expandAnimation and emitProps passthrough ─────────────────────────────────

describe('CssEmitter — animate shorthand and emitProps passthrough', () => {
  const { CssEmitter } = require('../src/emitters/css')

  function makeEmitter() {
    return new CssEmitter({ hash: 'test' })
  }

  test('animate with empty value warns and emits animation: none', () => {
    const stderrMsgs = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (s) => { stderrMsgs.push(s); return true }
    let result
    try {
      const e = makeEmitter()
      // emitProps takes an array of {name, value} objects
      result = e.emitProps([{ name: 'animate', value: '' }])
    } finally {
      process.stderr.write = origWrite
    }
    assert.ok(stderrMsgs.some(m => m.includes('animate')), 'Expected animate warning for empty value')
    assert.ok(result.some(d => d.includes('animation')), `Expected animation declaration, got: ${result}`)
  })

  test('CSS property with no vendor prefix just passes through', () => {
    const e = makeEmitter()
    // emitProps takes an array of {name, value} objects
    const result = e.emitProps([{ name: 'opacity', value: '0.5' }])
    assert.ok(result.some(d => d === 'opacity: 0.5'), `Expected opacity: 0.5, got: ${result}`)
    assert.equal(result.length, 1, 'Should have exactly 1 declaration (no prefix)')
  })
})


describe('CssEmitter — emitStyleRule with unknown child type (line 426)', () => {
  function makeEmitter() { return new CssEmitter({ hash: 'test' }) }

  test('emitStyleRule with unknown child type returns empty for that child', () => {
    const e = makeEmitter()
    const rule = {
      type: 'StyleRule',
      selector: '.btn',
      props: [{ name: 'color', value: 'red' }],
      children: [
        { type: 'UnknownChildType', selector: '.x', props: [] }
      ]
    }
    const result = e.emitStyleRule(rule)
    assert.ok(result.includes('.btn'), 'should still emit the parent rule')
    assert.ok(result.includes('color: red'), 'should include parent declarations')
  })

  test('emitCondition with non-StyleRule inner rule returns empty for that rule (line 500)', () => {
    const e = makeEmitter()
    const result = e.emitCondition({
      kind: 'media',
      query: 'max-width: 768px',
      rules: [
        { type: 'UnknownRule', selector: '.x', props: [] }
      ]
    })
    assert.equal(result, '', 'should return empty when all inner rules are unknown type')
  })
})
