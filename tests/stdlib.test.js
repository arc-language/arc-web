'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// Verify all stdlib files exist and are valid Arc syntax (parse without errors)
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')

function parseFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8')
  const lexer = new Lexer(src, filePath)
  const tokens = lexer.tokenize()
  const parser = new Parser(tokens, filePath)
  return { ast: parser.parse(), src }
}

const STDLIB_DIR = path.join(__dirname, '..', 'stdlib')

describe('stdlib — file existence', () => {
  const required = ['router.arc', 'store.arc', 'form.arc', 'fetch.arc', 'icons.arc']

  for (const file of required) {
    test(`${file} exists`, () => {
      const p = path.join(STDLIB_DIR, file)
      assert.ok(fs.existsSync(p), `Missing stdlib/${file}`)
    })
  }
})

describe('stdlib — parse without errors', () => {
  const files = fs.readdirSync(STDLIB_DIR).filter(f => f.endsWith('.arc'))

  for (const file of files) {
    test(`${file} parses cleanly`, () => {
      const filePath = path.join(STDLIB_DIR, file)
      // Should not throw
      assert.doesNotThrow(
        () => parseFile(filePath),
        `${file} failed to parse`
      )
    })
  }
})

describe('stdlib/router.arc', () => {
  test('defines parseRoute function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('fn parseRoute'), 'parseRoute not found')
  })

  test('defines matchRoute function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('fn matchRoute'), 'matchRoute not found')
  })

  test('defines navigate function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('fn navigate'), 'navigate not found')
  })

  test('uses @state for reactive path', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('@state let _routerPath'), '_routerPath @state not found')
  })

  test('handles popstate for browser back/forward', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('popstate'), 'popstate handler not found')
  })

  test('uses View Transitions API when available', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('startViewTransition'), 'View Transitions API not used')
  })

  test('defines Router widget', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('widget Router'), 'Router widget not found')
  })

  test('defines Link widget', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'router.arc'), 'utf8')
    assert.ok(src.includes('widget Link'), 'Link widget not found')
  })
})

describe('stdlib/store.arc', () => {
  test('defines createStore function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('fn createStore'), 'createStore not found')
  })

  test('defines useStore function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('fn useStore'), 'useStore not found')
  })

  test('store has set method', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('set:') || src.includes('set('), 'store.set not found')
  })

  test('store has subscribe method', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('subscribe:') || src.includes('subscribe('), 'store.subscribe not found')
  })

  test('store has update method', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('update:') || src.includes('update('), 'store.update not found')
  })

  test('defines createCounter convenience function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('fn createCounter'), 'createCounter not found')
  })

  test('defines createList convenience function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('fn createList'), 'createList not found')
  })

  test('createList has add/remove/clear methods', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'store.arc'), 'utf8')
    assert.ok(src.includes('add:') || src.includes('add('), 'list.add not found')
    assert.ok(src.includes('remove:') || src.includes('remove('), 'list.remove not found')
    assert.ok(src.includes('clear:') || src.includes('clear()'), 'list.clear not found')
  })
})

describe('stdlib/form.arc', () => {
  test('defines createForm function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('fn createForm'), 'createForm not found')
  })

  test('has required validator', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('fn _required'), '_required validator not found')
  })

  test('has email validator', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('fn _email'), '_email validator not found')
  })

  test('has minLength validator', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('fn _minLength'), '_minLength validator not found')
  })

  test('form has submit handler that prevents default', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('e.preventDefault()'), 'preventDefault not found in submit')
  })

  test('form has reset function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('fn reset()'), 'reset not found')
  })

  test('form tracks touched fields', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('@state let touched'), 'touched state not found')
  })

  test('form tracks submission state', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('@state let isSubmitting'), 'isSubmitting state not found')
  })

  test('defines Field widget', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('widget Field'), 'Field widget not found')
  })

  test('defines FormError widget', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('widget FormError'), 'FormError widget not found')
  })

  test('Field has on:blur for touch tracking', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'form.arc'), 'utf8')
    assert.ok(src.includes('on:blur'), 'on:blur not found in Field')
  })
})

describe('stdlib/fetch.arc', () => {
  test('defines get function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('fn get(url'), 'get not found')
  })

  test('defines post function', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('fn post(url'), 'post not found')
  })

  test('defines put, patch, del functions', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('fn put('), 'put not found')
    assert.ok(src.includes('fn patch('), 'patch not found')
    assert.ok(src.includes('fn del('), 'del not found')
  })

  test('returns Ok/Err Result type', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('Ok('), 'Ok() not used')
    assert.ok(src.includes('Err('), 'Err() not used')
  })

  test('defines api object with adp sub-object', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('const api ='), 'api object not found')
    assert.ok(src.includes('adp') && src.includes('adpRequest'), 'adp support not found')
  })

  test('ADP uses application/x-adp content type', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('application/x-adp'), 'ADP content type not found')
  })

  test('defines useFetch reactive hook', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('fn useFetch'), 'useFetch not found')
  })

  test('useFetch has loading/data/error state', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('@state let loading'), 'loading state not found')
    assert.ok(src.includes('@state let data'), 'data state not found')
    assert.ok(src.includes('@state let error'), 'error state not found')
  })

  test('useFetch supports AbortController for cancellation', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'fetch.arc'), 'utf8')
    assert.ok(src.includes('AbortController'), 'AbortController not found')
  })
})

describe('stdlib/icons.arc', () => {
  test('defines Icon widget', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    assert.ok(src.includes('widget Icon'), 'Icon widget not found')
  })

  test('defines icons map', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    assert.ok(src.includes('const icons ='), 'icons map not found')
  })

  test('has commonly needed icons', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    const required = ['search', 'home', 'user', 'settings', 'check', 'x', 'plus', 'arrow-right', 'heart', 'star']
    for (const icon of required) {
      assert.ok(src.includes(`"${icon}"`), `Icon "${icon}" not found in icons map`)
    }
  })

  test('has at least 40 icons', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    // Count quoted icon name keys
    const matches = src.match(/"[a-z][a-z-]+": "</g) ?? []
    assert.ok(matches.length >= 40, `Expected 40+ icons, found ${matches.length}`)
  })

  test('Icon widget accepts size attr', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    assert.ok(src.includes('@size'), 'size attr not found')
  })

  test('Icon widget accepts color attr', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    assert.ok(src.includes('@color'), 'color attr not found')
  })

  test('Icon has aria-label support for accessibility', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    assert.ok(src.includes('aria-label'), 'aria-label not found')
  })

  test('Icon falls back gracefully for unknown names', () => {
    const src = fs.readFileSync(path.join(STDLIB_DIR, 'icons.arc'), 'utf8')
    assert.ok(src.includes('if svgPath'), 'missing guard for unknown icon name')
  })
})

describe('stdlib — content quality checks', () => {
  test('no TODO or FIXME markers in stdlib', () => {
    const files = fs.readdirSync(STDLIB_DIR).filter(f => f.endsWith('.arc'))
    for (const file of files) {
      const src = fs.readFileSync(path.join(STDLIB_DIR, file), 'utf8')
      assert.ok(!src.includes('TODO'), `TODO found in stdlib/${file}`)
      assert.ok(!src.includes('FIXME'), `FIXME found in stdlib/${file}`)
    }
  })

  test('all stdlib files have a usage comment at the top', () => {
    const files = fs.readdirSync(STDLIB_DIR).filter(f => f.endsWith('.arc'))
    for (const file of files) {
      const src = fs.readFileSync(path.join(STDLIB_DIR, file), 'utf8')
      assert.ok(src.startsWith('//'), `${file} missing top-level comment`)
    }
  })

  test('total stdlib line count is reasonable (< 1500 lines)', () => {
    const files = fs.readdirSync(STDLIB_DIR).filter(f => f.endsWith('.arc'))
    let total = 0
    for (const file of files) {
      const src = fs.readFileSync(path.join(STDLIB_DIR, file), 'utf8')
      total += src.split('\n').length
    }
    assert.ok(total < 1500, `stdlib is ${total} lines — should be < 1500`)
  })
})
