'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { compile } = require('../src/cli')

describe('JS Emitter', () => {

  describe('static pages produce no JS', () => {
    test('basic static page produces empty JS', async () => {
      const { js } = await compile('page "Hello"\n  heading "Hi"')
      assert.equal(js.trim(), '', `Expected empty JS, got:\n${js}`)
    })

    test('page with text and card produces empty JS', async () => {
      const { js } = await compile(`page "T"
  card
    heading "Title"
    text "Content"`)
      assert.equal(js.trim(), '', `Expected empty JS, got:\n${js}`)
    })
  })

  describe('@state declarations', () => {
    test('@state emits setter function', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  text "{count}"`)
      assert.ok(js.includes('_set_count'), `Expected _set_count function in:\n${js}`)
    })

    test('@state emits variable declaration with underscore prefix', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  text "{count}"`)
      assert.ok(js.includes('let _count='), `Expected let _count= in:\n${js}`)
    })

    test('@state initialises to the literal value', async () => {
      const { js } = await compile(`page "T"
  @state let score = 42
  text "{score}"`)
      assert.ok(js.includes('let _score=42'), `Expected _score=42 in:\n${js}`)
    })

    test('@state emits IIFE wrapper', async () => {
      const { js } = await compile(`page "T"
  @state let x = 0
  text "{x}"`)
      assert.ok(js.includes('(function(){'), `Expected IIFE in:\n${js}`)
      assert.ok(js.includes('})();'), `Expected IIFE close in:\n${js}`)
    })
  })

  describe('event listeners from on:click', () => {
    test('button on:click emits addEventListener', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  button on:click={ @count += 1 } "+"`)
      assert.ok(js.includes("addEventListener('click'"), `Expected click listener in:\n${js}`)
    })

    test('on:click handler calls setter function', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  button on:click={ @count += 1 } "+"`)
      assert.ok(js.includes('_set_count'), `Expected _set_count in event handler:\n${js}`)
    })

    test('counter with +/- buttons emits two click listeners', async () => {
      const { js } = await compile(`page "Counter"
  @state let count = 0
  row
    button on:click={ @count -= 1 } "−"
    button on:click={ @count += 1 } "+"`)
      const clickCount = (js.match(/addEventListener\('click'/g) ?? []).length
      assert.ok(clickCount >= 2, `Expected at least 2 click listeners, got ${clickCount}:\n${js}`)
    })
  })

  describe('@computed declarations', () => {
    test('@computed emits variable declaration', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  @computed let doubled = count * 2
  text "{doubled}"`)
      assert.ok(js.includes('let _doubled='), `Expected _doubled= in:\n${js}`)
    })

    test('@computed emits _recompute_ function for updating DOM', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  @computed let doubled = count * 2
  text "{doubled}"`)
      assert.ok(js.includes('_recompute_doubled'), `Expected _recompute_doubled function in:\n${js}`)
    })

    test('@computed is recomputed inside its @state dependency setter', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  @computed let doubled = count * 2
  text "{doubled}"`)
      // _set_count must recompute doubled
      const setCount = js.slice(js.indexOf('function _set_count'))
      const nextFn = setCount.indexOf('function', 10)
      const setCountBody = nextFn > 0 ? setCount.slice(0, nextFn) : setCount
      assert.ok(
        setCountBody.includes('_doubled') || setCountBody.includes('doubled'),
        `Expected doubled recompute in _set_count:\n${setCountBody}`
      )
    })
  })

  describe('DOM element captures', () => {
    test('reactive binding captures element by getElementById', async () => {
      const { js } = await compile(`page "T"
  @state let msg = "hi"
  text "{msg}"`)
      assert.ok(js.includes('getElementById'), `Expected getElementById in:\n${js}`)
    })

    test('element textContent is updated in setter', async () => {
      const { js } = await compile(`page "T"
  @state let name = "World"
  text "{name}"`)
      assert.ok(js.includes('textContent='), `Expected textContent= in:\n${js}`)
    })
  })

  describe('bind:value two-way binding', () => {
    test('bind:value emits event listener', async () => {
      const { js } = await compile(`page "T"
  @state let query = ""
  input type="text" bind:value={query}`)
      assert.ok(js.includes('addEventListener'), `Expected addEventListener in:\n${js}`)
      assert.ok(js.includes("'input'") || js.includes("'change'") || js.includes('_bevt'), `Expected event type in:\n${js}`)
    })

    test('bind:value calls the @state setter', async () => {
      const { js } = await compile(`page "T"
  @state let query = ""
  input type="text" bind:value={query}`)
      assert.ok(js.includes('_set_query'), `Expected _set_query in bind handler:\n${js}`)
    })

    test('bind:value sets initial input value', async () => {
      const { js } = await compile(`page "T"
  @state let name = "Alice"
  input type="text" bind:value={name}`)
      assert.ok(js.includes('.value='), `Expected .value= assignment in:\n${js}`)
    })

    test('bind:value element gets an ID for DOM capture', async () => {
      const { html } = await compile(`page "T"
  @state let q = ""
  input type="text" bind:value={q}`)
      assert.ok(html.includes('id="'), `Expected id attribute on bound input in:\n${html}`)
    })
  })

  describe('@computed with correct state variable prefixing', () => {
    test('@computed expression uses prefixed state var name', async () => {
      const { js } = await compile(`page "T"
  @state let count = 0
  @computed let doubled = count * 2
  text "{doubled}"`)
      assert.ok(js.includes('_count*2') || js.includes('_count * 2'), `Expected _count in computed expr:\n${js}`)
    })

    test('multiple @state deps all prefixed in @computed', async () => {
      const { js } = await compile(`page "T"
  @state let a = 1
  @state let b = 2
  @computed let sum = a + b
  text "{sum}"`)
      assert.ok(js.includes('_a') && js.includes('_b'), `Expected _a and _b in:\n${js}`)
    })
  })

  describe('full counter example', () => {
    test('counter example compiles with all expected parts', async () => {
      const src = `page "Counter"
  @state let count = 0
  main
    card
      heading "Counter"
      text "{count}"
      row
        button on:click={ @count -= 1 } "−"
        button on:click={ @count += 1 } "+"`
      const { html, css, js } = await compile(src)

      // HTML contains structure
      assert.ok(html.includes('<h2'))
      assert.ok(html.includes('<button'))

      // CSS contains base layer
      assert.ok(css.includes('@layer base'))

      // JS is non-empty (has reactive state)
      assert.ok(js.trim().length > 0, 'Expected non-empty JS for counter')

      // JS has setter
      assert.ok(js.includes('_set_count'))

      // JS has click listeners
      assert.ok(js.includes("addEventListener('click'"))
    })
  })

  describe('match expression binding patterns', () => {
    test('identifier pattern in match arm becomes binding (not equality check)', async () => {
      const src = `page "T"
  @state let val = 0
  @computed let label = match val {
    0 => "zero"
    n => "nonzero"
  }
  main text "{label}"`
      const { js } = await compile(src)
      // Binding arm should use arrow fn: (n) => 'nonzero', not val===n
      assert.ok(js.includes('(n)=>'), `Expected binding arrow fn in:\n${js}`)
      assert.ok(!js.includes('===n'), `Should not use equality check for binding:\n${js}`)
    })

    test('computed cascade updates transitively (a→b→c)', async () => {
      const src = `page "T"
  @state let a = 1
  @computed let b = a * 2
  @computed let c = b + 1
  main text "{c}"`
      const { js } = await compile(src)
      // setter for a must update both b and c
      const setterMatch = js.match(/function _set_a\(v\)\{([^}]+)\}/)
      assert.ok(setterMatch, `Expected _set_a setter in:\n${js}`)
      assert.ok(setterMatch[1].includes('_b='), `Expected _b recompute in setter:\n${setterMatch[1]}`)
      assert.ok(setterMatch[1].includes('_c='), `Expected _c recompute in setter:\n${setterMatch[1]}`)
    })
  })

})
