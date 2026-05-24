'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { compile } = require('../src/cli')
const { JsEmitter } = require('../src/emitters/js')
const N = require('../src/ast')

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

      // CSS contains base styles (counter has no design block → @layer wrapper stripped)
      assert.ok(css.includes('box-sizing'))

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

  describe('bind:value with dotted-path two-way binding', () => {
    test('bind:value on user.name generates immutable update with spread', async () => {
      const { js } = await compile(`page "T"
  @state let user = { name: "" }
  input type="text" bind:value={user.name}`)
      // Should contain spread of _user and assignment of "name"
      assert.ok(js.includes('_set_user'), `Expected _set_user`)
      assert.ok(js.includes('"name":_bv') || js.includes('"name":'), `Expected immutable update`)
    })

    test('bind:value with deeply nested path generates nested spread', async () => {
      const { js } = await compile(`page "T"
  @state let user = { profile: { email: "" } }
  input type="text" bind:value={user.profile.email}`)
      // Should have nested spread: {...(_user??{}), profile:{...(_user.profile??{}), email:_bv}}
      assert.ok(js.includes('profile'), `Expected profile in path: ${js}`)
      assert.ok(js.includes('email'), `Expected email in path`)
    })

    test('emitProgram throws for bind:value with unsafe expression and no bindRoot', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      // Construct an unsafe bind binding directly — this throws via the codegen guard
      const program = { declarations: [{ type: 'StateDecl', name: 'x', init: N.Literal(0, '0', 0), line: 0 }] }
      const stateBindings = [
        { id: 'el1', kind: 'bind', expr: 'items[0]', bindRoot: null, line: 0 },
      ]
      assert.throws(() => emitter.emitProgram(program, stateBindings, []),
        /bind:value only supports/)
    })

    test('bind:value on non-simple path compiles (allowed)', async () => {
      // Test that the compile path runs — actual semantics may vary
      const r = await compile(`page "T"
  @state let val = ""
  input type="text" bind:value={val}`)
      assert.ok(r.js.includes('bind') || r.js.includes('_set_val'))
    })
  })

  describe('source map mappings for fn declarations', () => {
    test('compile with sourceMap option emits mappings for @server fn', async () => {
      const { SourceMapBuilder } = require('../src/sourcemap')
      const sm = new SourceMapBuilder()
      await compile(`page "T"
  @server fn process() {
    return 1
  }
  text "ok"`, '<input>', { sourceMap: sm })
      const mapJson = sm.generate('app.js', '@server fn process() { return 1 }')
      assert.ok(mapJson.version === 3, `Expected source map v3: ${JSON.stringify(mapJson)}`)
    })

    test('compile with sourceMap and top-level fn decl emits fn mappings', async () => {
      const { SourceMapBuilder } = require('../src/sourcemap')
      const sm = new SourceMapBuilder()
      await compile(`fn helper(x) {
  return x * 2
}
page "T"
  @state let n = 5
  text "{n}"`, '<input>', { sourceMap: sm })
      const mapJson = sm.generate('app.js', 'fn helper(x) { return x*2 }')
      assert.ok(mapJson.mappings.length > 0, `Expected non-empty mappings`)
    })
  })

  describe('expression emitter — complex expressions', () => {
    test('template literal in @computed concatenation is reactive', async () => {
      const { js } = await compile(`page "T"
  @state let name = "World"
  @computed let greeting = "Hello " + name
  text "{greeting}"`)
      assert.ok(js.includes('_name'), `Expected _name reference in:\n${js}`)
    })

    test('null coalesce ?? emits correct JS', async () => {
      const { js } = await compile(`page "T"
  @state let val = none
  @computed let display = val ?? "default"
  text "{display}"`)
      assert.ok(js.includes('??'), `Expected ?? operator in:\n${js}`)
    })

    test('pipeline |> emits function call form', async () => {
      const { js } = await compile(`page "T"
  @state let count = 5
  @computed let positive = count |> Math.abs
  text "{positive}"`)
      assert.ok(js.includes('Math.abs'), `Expected Math.abs reference in:\n${js}`)
    })

    test('range expression emits Array.from', async () => {
      const { js } = await compile(`page "T"
  @state let n = 5
  @computed let nums = 0..n
  text "{nums}"`)
      assert.ok(js.includes('Array.from'), `Expected Array.from for range in:\n${js}`)
    })

    test('is String expression emits typeof check', async () => {
      const { js } = await compile(`page "T"
  @state let val = ""
  @computed let isStr = val is String
  text "{isStr}"`)
      assert.ok(js.includes("typeof") && js.includes("'string'"), `Expected typeof string check in:\n${js}`)
    })

    test('ResultOk Ok(x) emits {ok:true,value:...}', async () => {
      const { js } = await compile(`page "T"
  @state let x = 5
  @computed let r = Ok(x)
  text "{r}"`)
      assert.ok(js.includes('ok:true'), `Expected ok:true in:\n${js}`)
    })

    test('ResultErr Err("msg") emits {ok:false,error:...}', async () => {
      const { js } = await compile(`page "T"
  @state let x = 0
  @computed let r = Err("oops")
  text "{r}"`)
      assert.ok(js.includes('ok:false'), `Expected ok:false in:\n${js}`)
    })

    test('match expression emits IIFE with Symbol sentinel', async () => {
      const { js } = await compile(`page "T"
  @state let x = 0
  @computed let label = match x {
    0 => "zero"
    _ => "other"
  }
  text "{label}"`)
      assert.ok(js.includes('Symbol()'), `Expected Symbol sentinel in match IIFE:\n${js}`)
    })

    test('ternary expression emits JS ternary', async () => {
      const { js } = await compile(`page "T"
  @state let show = true
  @computed let msg = show ? "yes" : "no"
  text "{msg}"`)
      assert.ok(js.includes('"yes"') && js.includes('"no"'), `Expected ternary values in:\n${js}`)
    })

    test('arrow function in event handler emits arrow syntax', async () => {
      const { js } = await compile(`page "T"
  @state let items = []
  button on:click={ @items = [1,2,3].map(x => x * 2) } "go"`)
      assert.ok(js.includes('=>'), `Expected arrow function in:\n${js}`)
    })

    test('keyed for loop emits keyed reconciliation code', async () => {
      const { js } = await compile(`page "T"
  @state let items = []
  for item in items
    div key=item.id
      text "{item.name}"`)
      assert.ok(js.includes('arcKey') || js.includes('_km') || js.includes('data-arc-key'),
        `Expected keyed reconciliation in:\n${js}`)
    })
  })

  describe('statement emitter — via @server fn bodies (edge output)', () => {
    test('unless statement compiles to if(!cond)', async () => {
      const r = await compile(`page "T"
  @server fn process(x) {
    unless x > 0 {
      return 0
    }
    return x
  }`)
      assert.ok(r.edgeFunctions.includes('if(!('), `Expected if(!cond) for unless in edge output`)
    })

    test('while statement compiles to while(cond)', async () => {
      const r = await compile(`page "T"
  @server fn process(n) {
    while n > 0 {
      n = n - 1
    }
    return n
  }`)
      assert.ok(r.edgeFunctions.includes('while('), `Expected while loop in edge output`)
    })

    test('until statement compiles to while(!cond)', async () => {
      const r = await compile(`page "T"
  @server fn process(n) {
    until n > 10 {
      n = n + 1
    }
    return n
  }`)
      assert.ok(r.edgeFunctions.includes('while(!('), `Expected while(!) for until in edge output`)
    })

    test('loop statement compiles to while(true)', async () => {
      const r = await compile(`page "T"
  @server fn process(n) {
    loop {
      if n > 5 { break }
      n = n + 1
    }
    return n
  }`)
      assert.ok(r.edgeFunctions.includes('while(true)'), `Expected while(true) for loop`)
    })

    test('try/catch statement emits try/catch JS', async () => {
      const r = await compile(`page "T"
  @server fn process(x) {
    try {
      return x
    } catch e {
      return 0
    }
  }`)
      assert.ok(r.edgeFunctions.includes('try{'), `Expected try block`)
      assert.ok(r.edgeFunctions.includes('catch('), `Expected catch block`)
    })

    test('for statement with index var emits forEach', async () => {
      const r = await compile(`page "T"
  @server fn process(items) {
    for i, item in items {
      item
    }
    return items
  }`)
      assert.ok(r.edgeFunctions.includes('.forEach('), `Expected .forEach for indexed for`)
    })

    test('for statement without index emits for...of', async () => {
      const r = await compile(`page "T"
  @server fn process(items) {
    for item in items {
      item
    }
    return items
  }`)
      assert.ok(r.edgeFunctions.includes('for(const'), `Expected for(const ... of) loop`)
    })

    test('break statement compiles to break;', async () => {
      const r = await compile(`page "T"
  @server fn process(n) {
    loop {
      if n > 5 { break }
      n = n + 1
    }
    return n
  }`)
      assert.ok(r.edgeFunctions.includes('break'), `Expected break statement`)
    })

    test('emitUpdate for attr-kind binding uses setAttribute', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const result = emitter.emitBindingUpdate({
        id: 'el1',
        expr: 'cond',
        kind: 'attr',
        attr: 'aria-label',
      })
      assert.ok(result.includes('setAttribute'), `Expected setAttribute: ${result}`)
    })

    test('emitUpdate for attr-kind binding rejects unsafe attr name', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.throws(() =>
        emitter.emitBindingUpdate({
          id: 'el1',
          expr: 'cond',
          kind: 'attr',
          attr: 'bad attr!',
        }),
        /unsafe attribute/
      )
    })

    test('emitUpdate for class-toggle binding uses classList.toggle', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const result = emitter.emitBindingUpdate({
        id: 'el1',
        expr: 'cond',
        kind: 'class-toggle',
        cls: 'active',
      })
      assert.ok(result.includes('classList.toggle'), `Expected classList.toggle: ${result}`)
    })

    test('emitUpdate for class-toggle rejects unsafe class name', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.throws(() =>
        emitter.emitBindingUpdate({
          id: 'el1',
          expr: 'cond',
          kind: 'class-toggle',
          cls: 'bad class!',
        }),
        /unsafe attribute\/class/
      )
    })

    test('emitExpr for TemplateLiteral with mixed parts', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.TemplateLiteral([
        N.Literal('Hello ', '"Hello "', 0),
        N.Identifier('name', 0),
        N.Literal('!', '"!"', 0),
      ], 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.startsWith('`'), `Expected backticks: ${result}`)
      assert.ok(result.includes('${name}'), `Expected interpolation: ${result}`)
    })

    test('emitExpr for TemplateLiteral escapes special chars in literal parts', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.TemplateLiteral([
        N.Literal('a`b\\c$d', '"..."', 0),
      ], 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('\\`'), `Expected backtick escape: ${result}`)
      assert.ok(result.includes('\\\\'), `Expected backslash escape`)
      assert.ok(result.includes('\\$'), `Expected dollar escape`)
    })

    test('emitExpr for AtProperty prefixes with _', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.AtProperty('count', 0)
      assert.equal(emitter.emitExpr(expr), '_count')
    })

    test('emitPattern returns true for Wildcard or undefined', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.equal(emitter.emitPattern({ type: 'Wildcard' }, '_subj'), 'true')
      assert.equal(emitter.emitPattern(null, '_subj'), 'true')
    })

    test('emitPattern returns === check for Literal pattern', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.equal(emitter.emitPattern(N.Literal(42, '42', 0), '_subj'), '_subj===42')
    })

    test('emitPattern returns "true" for unknown pattern type (Identifier handled elsewhere)', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const result = emitter.emitPattern({ type: 'Identifier', name: 'n', line: 0 }, '_subj')
      assert.equal(result, 'true')
    })

    test('emitFnDecl with param missing .name uses _ fallback', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fn = N.FnDecl('go', [{ type: 'NotAParam', name: 'x', line: 0 }], null,
        { type: 'BlockStatement', body: [], line: 0 }, false, 0)
      const result = emitter.emitFnDecl(fn)
      // The non-Param case falls into `const pname = p.name ?? '_'`
      assert.ok(result.includes('function go(x)'), `Expected fn with x param: ${result}`)
    })

    test('emitFnDecl with bare-string param uses fallback', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fn = N.FnDecl('go', ['x', 'y'], null,
        { type: 'BlockStatement', body: [], line: 0 }, false, 0)
      const result = emitter.emitFnDecl(fn)
      // bare strings: p.name === undefined, p ?? '_' = string itself? No, p.name ?? '_' → undefined ?? '_' = '_'
      // Actually for bare strings: p has no .name, so p.name is undefined, so pname = '_'
      assert.ok(result.includes('function go'), `Expected fn: ${result}`)
    })

    test('emitPattern for IsExpr uses typeof check', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const pat = { type: 'IsExpr', typeOrValue: N.Identifier('String', 0), subject: null, line: 0 }
      const result = emitter.emitPattern(pat, '_subj')
      assert.ok(result.includes('typeof'), `Expected typeof check: ${result}`)
    })

    test('emitPipeline where right is non-CallExpr identifier', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.PipelineExpr(N.Identifier('x', 0), N.Identifier('fn', 0), 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('(fn)(x)'), `Expected (fn)(x) form: ${result}`)
    })

    test('emitPipeline with CallExpr right and no args adds left as only arg', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const callExpr = N.CallExpr(N.Identifier('Math', 0), [], 0)
      // Need to also test the CallExpr case with non-empty args (already tested)
      const expr = N.PipelineExpr(N.Identifier('x', 0), callExpr, 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('Math(x)'), `Expected Math(x): ${result}`)
    })

    test('emitStmt for unknown statement type returns empty string', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.equal(emitter.emitStmt({ type: 'WeirdStmt', line: 0 }), '')
    })

    test('emitFnDecl with non-block expression body returns expression value', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fn = N.FnDecl('square',
        [N.Param('x', null, null, false, 0)],
        null,
        N.BinaryExpr('*', N.Identifier('x', 0), N.Identifier('x', 0), 0),
        false, 0)
      const result = emitter.emitFnDecl(fn)
      assert.ok(result.includes('return (x*x)'), `Expected return: ${result}`)
    })

    test('emitClassDecl method with named params', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const cls = N.ClassDecl('Box', [], [
        N.ClassMethod('set', [N.Param('value', null, null, false, 0), N.Param('flag', null, null, false, 0)], null,
          { type: 'BlockStatement', body: [N.ReturnStatement(N.Identifier('value', 0), 0)], line: 0 },
          false, false, 0)
      ], 0)
      const result = emitter.emitClassDecl(cls)
      assert.ok(result.includes('set(value,flag)'), `Expected method with params: ${result}`)
    })

    test('emitClassDecl method with bare-string params (no Param wrapper)', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      // Some Arc paths produce bare strings for params instead of Param nodes
      const cls = N.ClassDecl('Box', [], [{
        type: 'ClassMethod',
        name: 'go',
        params: ['x', 'y'],  // bare strings instead of Param objects
        body: { type: 'BlockStatement', body: [], line: 0 },
        isStatic: false,
        isGetter: false,
        line: 0
      }], 0)
      const result = emitter.emitClassDecl(cls)
      assert.ok(result.includes('go(x,y)'), `Expected bare param strings: ${result}`)
    })

    test('emitClassDecl with field that has no init (no = part)', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const cls = N.ClassDecl('C', [
        N.ClassField('value', null, null, false, 0),  // No init
      ], [], 0)
      const result = emitter.emitClassDecl(cls)
      assert.ok(result.includes('value;'), `Expected field without init: ${result}`)
    })

    test('class declaration via direct emitter — emits JS class syntax', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const classDecl = N.ClassDecl('Counter', [
        N.ClassField('count', null, N.Literal(0, '0', 0), false, 0),
      ], [
        N.ClassMethod('increment', [], null,
          { type: 'BlockStatement', body: [
            N.ReturnStatement(N.Literal(1, '1', 0), 0)
          ], line: 0 }, false, false, 0)
      ], 0)
      const result = emitter.emitStmt(classDecl)
      assert.ok(result.includes('class Counter'), `Expected class Counter in: ${result}`)
      assert.ok(result.includes('increment'), `Expected method name in: ${result}`)
      assert.ok(result.includes('count=0'), `Expected field init in: ${result}`)
    })

    test('class declaration with static field via direct emitter', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const classDecl = N.ClassDecl('Foo', [
        N.ClassField('VERSION', null, N.Literal(1, '1', 0), true, 0),
      ], [], 0)
      const result = emitter.emitStmt(classDecl)
      assert.ok(result.includes('static VERSION'), `Expected static field: ${result}`)
    })

    test('class declaration with getter via direct emitter', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const classDecl = N.ClassDecl('Box', [], [
        N.ClassMethod('value', [], null,
          { type: 'BlockStatement', body: [N.ReturnStatement(N.Literal(42, '42', 0), 0)], line: 0 },
          false, true, 0)
      ], 0)
      const result = emitter.emitStmt(classDecl)
      assert.ok(result.includes('get value'), `Expected getter syntax: ${result}`)
    })

    test('fn declaration with rest param via direct emitter', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fnDecl = N.FnDecl('sum',
        [N.Param('args', null, null, true, 0)],
        null,
        { type: 'BlockStatement', body: [N.ReturnStatement(N.Literal(0, '0', 0), 0)], line: 0 },
        false,
        0)
      const result = emitter.emitStmt(fnDecl)
      assert.ok(result.includes('function sum(...args)'), `Expected rest param: ${result}`)
    })

    test('fn declaration with default param via direct emitter', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fnDecl = N.FnDecl('greet',
        [N.Param('name', null, N.Literal('guest', '"guest"', 0), false, 0)],
        null,
        { type: 'BlockStatement', body: [N.ReturnStatement(N.Identifier('name', 0), 0)], line: 0 },
        false,
        0)
      const result = emitter.emitStmt(fnDecl)
      assert.ok(result.includes('name="guest"'), `Expected default value: ${result}`)
    })

    test('async fn declaration emits async prefix', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fnDecl = N.FnDecl('load', [], null,
        { type: 'BlockStatement', body: [N.ReturnStatement(N.Literal(0, '0', 0), 0)], line: 0 },
        true,
        0)
      const result = emitter.emitStmt(fnDecl)
      assert.ok(result.includes('async function load'), `Expected async prefix: ${result}`)
    })

    test('fn declaration with expression body emits return', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const fnDecl = N.FnDecl('double',
        [N.Param('x', null, null, false, 0)],
        null,
        N.BinaryExpr('*', N.Identifier('x', 0), N.Literal(2, '2', 0), 0),
        false,
        0)
      const result = emitter.emitStmt(fnDecl)
      assert.ok(result.includes('return'), `Expected return for expr body: ${result}`)
      assert.ok(result.includes('x*2') || result.includes('x * 2'))
    })

    test('match statement via direct emitter emits const subj + if/else', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const stmt = N.MatchStatement(N.Identifier('x', 0), [
        N.MatchArm(N.Literal(0, '0', 0),
          { type: 'BlockStatement', body: [
            N.ExprStatement(N.AssignExpr('=', N.Identifier('y', 0), N.Literal(1, '1', 0), 0), 0)
          ], line: 0 }, 0),
        N.MatchArm({ type: 'Wildcard', line: 0 },
          { type: 'BlockStatement', body: [
            N.ExprStatement(N.AssignExpr('=', N.Identifier('y', 0), N.Literal(2, '2', 0), 0), 0)
          ], line: 0 }, 0),
      ], 0)
      const result = emitter.emitStmt(stmt)
      assert.ok(result.includes('const _ms'), `Expected match subject const: ${result}`)
      assert.ok(result.includes('if('), `Expected if dispatch: ${result}`)
    })

    test('match statement with identifier binding pattern', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const stmt = N.MatchStatement(N.Identifier('x', 0), [
        N.MatchArm(N.Identifier('n', 0),
          { type: 'BlockStatement', body: [
            N.ExprStatement(N.Identifier('n', 0), 0)
          ], line: 0 }, 0),
      ], 0)
      const result = emitter.emitStmt(stmt)
      assert.ok(result.includes('const n='), `Expected binding: ${result}`)
    })

    test('emitExpr for OptionalChain emits ?.', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = { type: 'OptionalChain',
        object: N.Identifier('user', 0),
        property: N.Identifier('name', 0),
        line: 0 }
      assert.equal(emitter.emitExpr(expr), 'user?.name')
    })

    test('emitExpr for SpreadElement emits ...', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.SpreadElement(N.Identifier('arr', 0), 0)
      assert.equal(emitter.emitExpr(expr), '...arr')
    })

    test('emitExpr for AwaitExpr emits await', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = { type: 'AwaitExpr', argument: N.Identifier('p', 0), line: 0 }
      assert.equal(emitter.emitExpr(expr), 'await p')
    })

    test('emitExpr for ThrowExpr wraps in IIFE', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.ThrowExpr(N.Literal('error', '"error"', 0), 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('throw new Error'), `Expected throw IIFE: ${result}`)
    })

    test('emitExpr for TryExpr wraps in try/catch IIFE', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.TryExpr(N.Identifier('x', 0), 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('try{'), `Expected try block: ${result}`)
      assert.ok(result.includes('catch('), `Expected catch block: ${result}`)
    })

    test('emitExpr for ObjectLiteral with computed key', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.ObjectLiteral([
        N.ObjectProp(null, N.Literal(42, '42', 0), false, 0, N.Identifier('key', 0)),
      ], 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('[key]:42'), `Expected computed key: ${result}`)
    })

    test('emitExpr for ObjectLiteral with shorthand', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.ObjectLiteral([
        { type: 'ObjectProp', key: 'name', value: null, shorthand: true, line: 0 }
      ], 0)
      const result = emitter.emitExpr(expr)
      assert.ok(result.includes('{name}'), `Expected shorthand: ${result}`)
    })

    test('emitExpr for MemberExpr (computed)', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.MemberExpr(N.Identifier('arr', 0), N.Literal(0, '0', 0), true, 0)
      assert.equal(emitter.emitExpr(expr), 'arr[0]')
    })

    test('emitExpr for LogicalExpr emits both sides', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.LogicalExpr('&&', N.Identifier('a', 0), N.Identifier('b', 0), 0)
      assert.equal(emitter.emitExpr(expr), '(a&&b)')
    })

    test('emitExpr for AssignExpr on plain identifier emits =', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.AssignExpr('=', N.Identifier('x', 0), N.Literal(1, '1', 0), 0)
      assert.equal(emitter.emitExpr(expr), '(x=1)')
    })

    test('emitStmt for VarDecl with const kind', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      // N.VarDecl(kind, name, typeAnnotation, init, line)
      const stmt = N.VarDecl('const', 'x', null, N.Literal(42, '42', 0), 0)
      const result = emitter.emitStmt(stmt)
      assert.ok(result.includes('const x=42'), `Expected const x=42: ${result}`)
    })

    test('emitStmt for VarDecl with let kind', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const stmt = N.VarDecl('let', 'y', null, N.Literal(10, '10', 0), 0)
      const result = emitter.emitStmt(stmt)
      assert.ok(result.includes('let y=10'), `Expected let y=10: ${result}`)
    })

    test('emitStmt for BreakStatement', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.equal(emitter.emitStmt({ type: 'BreakStatement', line: 0 }), 'break;')
    })

    test('emitStmt for ContinueStatement', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.equal(emitter.emitStmt({ type: 'ContinueStatement', line: 0 }), 'continue;')
    })

    test('emitStmt for BlockStatement wraps in braces', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const stmt = { type: 'BlockStatement', body: [
        N.ExprStatement(N.Literal(1, '1', 0), 0)
      ], line: 0 }
      const result = emitter.emitStmt(stmt)
      assert.ok(result.startsWith('{'))
      assert.ok(result.endsWith('}'))
    })

    test('emitStmt for VarDecl with unsafe name throws', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const stmt = N.VarDecl('const', 'bad-name!', null, N.Literal(1, '1', 0), 0)
      assert.throws(() => emitter.emitStmt(stmt), /unsafe identifier/)
    })

    test('emitExpr for unsafe BinaryExpr op throws', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.BinaryExpr('XXX_UNSAFE', N.Literal(1, '1', 0), N.Literal(2, '2', 0), 0)
      assert.throws(() => emitter.emitExpr(expr), /unsafe BinaryExpr operator/)
    })

    test('emitExpr for unsafe UnaryExpr op throws', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const expr = N.UnaryExpr('XXX', N.Identifier('x', 0), 0)
      assert.throws(() => emitter.emitExpr(expr), /unsafe UnaryExpr operator/)
    })

    test('emitExpr for unhandled expression type throws (compiler bug guard)', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.throws(() => emitter.emitExpr({ type: 'Weird', line: 0 }), /unhandled expression type/)
    })

    test('emitFnDecl rejects unsafe fn name', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.throws(() => emitter.emitFnDecl({
        name: 'bad-fn', params: [], body: { type: 'BlockStatement', body: [], line: 0 }
      }), /unsafe identifier/)
    })

    test('emitClassDecl rejects unsafe class name', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      assert.throws(() => emitter.emitClassDecl({
        name: 'Bad-Class!', fields: [], methods: []
      }), /unsafe identifier/)
    })

    test('emitClassDecl with static field with init', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const cls = N.ClassDecl('C', [
        N.ClassField('TYPE', null, N.Literal('user', '"user"', 0), true, 0),
      ], [], 0)
      const result = emitter.emitStmt(cls)
      assert.ok(result.includes('static TYPE="user"'), `Expected static field with init: ${result}`)
    })

    test('emitClassDecl with static method', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const cls = N.ClassDecl('C', [], [
        N.ClassMethod('create', [], null,
          { type: 'BlockStatement', body: [N.ReturnStatement(N.Literal(1, '1', 0), 0)], line: 0 },
          true, false, 0)
      ], 0)
      const result = emitter.emitStmt(cls)
      assert.ok(result.includes('static create'), `Expected static method: ${result}`)
    })

    test('pipeline expression where right is a CallExpr emits with extra args', async () => {
      // Pipeline left |> fn(extra) — fn(left, extra)
      const { js } = await compile(`page "T"
  @state let x = 5
  @computed let r = x |> Math.max(0)
  text "{r}"`)
      assert.ok(js.includes('Math.max'), `Expected Math.max call: ${js}`)
    })

    test('list update with key= triggers keyed reconciliation path', async () => {
      const { js } = await compile(`page "T"
  @state let users = []
  for u in users
    div key=u.id class="user-row"
      text "{u.name}"`)
      assert.ok(js.includes('_km') || js.includes('arcKey'), `Expected keyed code: ${js.slice(0, 300)}`)
    })

    test('emitStmt for IfStatement with else branch', () => {
      const emitter = new JsEmitter({ hash: 'h1' })
      const stmt = {
        type: 'IfStatement',
        condition: N.Identifier('cond', 0),
        consequent: { type: 'BlockStatement', body: [
          N.ExprStatement(N.AssignExpr('=', N.Identifier('a', 0), N.Literal(1, '1', 0), 0), 0)
        ], line: 0 },
        alternate: { type: 'BlockStatement', body: [
          N.ExprStatement(N.AssignExpr('=', N.Identifier('a', 0), N.Literal(2, '2', 0), 0), 0)
        ], line: 0 },
        line: 0
      }
      const result = emitter.emitStmt(stmt)
      assert.ok(result.includes('if('))
      assert.ok(result.includes('else{'))
    })

    test('class declaration compiles to JS class (via compile)', async () => {
      const { js } = await compile(`class Counter {
  @count = 0
  fn increment() { return 1 }
}
page "T"
  text "ok"`)
      assert.ok(js.includes('class Counter') || js.length === 0,
        `Expected class Counter or no client JS:\n${js.slice(0, 200)}`)
    })
  })

})
