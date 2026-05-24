# Emitters

Arc has four emitters. Each takes the AST (post-optimization) and produces one kind of output. Source: `/home/claude/arc/src/emitters/`.

## HTML emitter (`emitters/html.js`)

### Public surface

```js
class HtmlEmitter {
  constructor(options: {
    hash?: string,                    // component scope hash
    buildContext?: object,            // @build name → value map
    imgPipeline?: ImagePipeline,      // optional image pipeline instance
  })

  emitProgram(program: ProgramAST): string

  // After emitProgram, these are populated:
  stateBindings: Array<{ id, expr, bindRoot?, kind, line }>
  eventBindings: Array<{ elementId, event, handler, line }>
}
```

### Element dispatch

`emitElement(node)` switches on `node.tag`:

1. Native pattern macros (`modal`, `tooltip`, `accordion`)
2. Image pipeline interception (`img` tag → `<picture>`)
3. Widget invocation (recursive — inline widget body with bound attrs)
4. Element map lookup (`heading` → `<h2>`, etc.) + scoped class
5. Void elements (`<img>`, `<br>`, etc.) — no closing tag
6. Children recursion + closing tag

Auto-enhancements applied:
- `<img>` → `loading="lazy"`, `decoding="async"`, `alt=""` (if missing)
- `<button>` → `type="button"` (unless explicit)
- `<a href="https://...">` → `target="_blank" rel="noopener noreferrer"` + sr-only "(opens in new tab)"
- `<icon>` → `aria-hidden="true"` (unless `aria-label` set)

### `emitPage` flow

1. Read page meta (`title`, `lang`, `description`, `canonical`, `image`, `schemaType`, etc.)
2. Build JSON-LD if `schemaType` present
3. Detect user `<main>` — auto-inject `<main id="main-content">` if absent
4. Emit head (charset, viewport, robots, CSP, title, description, OG, Twitter, JSON-LD, stylesheet link)
5. Emit body: skip link → `<h1 class="arc-sr-only">` (if auto-injected) → user content → close

### Image pipeline integration

```js
if (tag === 'img' && this.imgPipeline) {
  const src = evalStaticExpr(attrs.src)
  const ordinal = this._imgOrdinal++
  const position = (!this._sawSection && ordinal < 2) ? 'above-fold' : 'below-fold'
  const picture = this.imgPipeline.emitPicture(src, alt, position)
  if (picture) return picture
}
```

`<section>` toggles `_sawSection` — first 2 images before any section are above-fold.

### Extension point

To add a new auto-emit feature: check the existing patterns in `emitElement` (e.g., `if (node.tag === 'icon')` block at line ~461). Add a new conditional.

## CSS emitter (`emitters/css.js`)

### Public surface

```js
class CssEmitter {
  constructor(options: { hash?: string })

  emitProgram(program: ProgramAST): string
}
```

### Layered output

```css
@layer base {
  *, *::before, *::after { box-sizing: border-box }
  :root { /* tokens */ }
  .arc-row { display: flex; flex-direction: row }
  ...
  @media (prefers-reduced-motion: reduce) { ... }
}

@layer component {
  .arc-card_HASH { padding: 24px; ... }
  ...
}
```

When the program has no user component rules, the `@layer base { ... }` wrapper is **stripped** (single-layer output doesn't need cascade ordering).

### Scoping

Selectors in `design` blocks get `_HASH` suffixed to each class:

```
card → .arc-card_1g18
row → .arc-row_1g18
```

The hash is per-component (per-page or per-widget). Same component name in different widgets gets different hashes — no leak.

### Nested + state selectors

```arc
design
  card
    bg: #fff
    hover: { shadow: lg }
    &:focus-visible { outline: 2px solid blue }
    @mobile { p: 16px }
```

Compiles to:

```css
.arc-card_HASH { background: #fff; }
.arc-card_HASH:hover { box-shadow: var(--arc-shadow-lg); }
.arc-card_HASH:focus-visible { outline: 2px solid blue; }
@media (max-width: 640px) { .arc-card_HASH { padding: 16px; } }
```

### Extension point

To add a new shorthand: see `emitProps` → switches on property name. Add a case mapping your shorthand to a CSS declaration.

## JS emitter (`emitters/js.js`)

### Public surface

```js
class JsEmitter {
  constructor(options: { hash?: string, sourceMap?: SourceMapBuilder })

  emitProgram(
    program: ProgramAST,
    stateBindings: Array<...>,
    eventBindings: Array<...>
  ): string

  // Also exposes helpers for the edge renderer:
  emitExpr(expr): string
  emitBody(body): string
}
```

### Direct DOM update generation

For each `@state` variable, emit a setter:

```js
let _count = 0
const _el_a1 = document.getElementById('_a1')
const _el_a2 = document.getElementById('_a2')

function _setCount(v) {
  _count = v
  _el_a1.textContent = `Count: ${_count}`
  _el_a2.textContent = `Doubled: ${_count * 2}`
}
```

The compiler resolves which DOM IDs each binding touches based on the AST + stateBindings.

### Event wiring

```js
(function() {
  const _ee = document.getElementById('_a3')
  if (_ee) _ee.addEventListener('click', function(event) {
    _setCount(_count + 1)
  })
})()
```

### List rendering

Heuristic based on collection size and update frequency:
- **< 20 items**: per-row DOM ops
- **20-200**: innerHTML batch
- **> 200**: virtual list (only render visible window)

Decision is hardcoded per element — runtime can't adapt.

### Extension point

Adding a new reactive pattern (e.g., a `@async` decl): add a case in `emitDeclaration` and update `composeClientJs` in `cli.js` to wire it in.

## Server emitter (`emitters/server.js`)

### Public surface

```js
class ServerEmitter {
  constructor(options: { hash?: string })

  emitProgram(program: ProgramAST): {
    edgeFunctions: string,    // body for dist/_arc/functions.js
    clientStubs: string,      // async function fn(...) for each @server
    handlerNames: string[],   // for routing
  }
}
```

### Edge function shape

For each `@server fn`:

```js
const handlers = {
  async '/_arc/fn/myFn'(request) {
    const body = await request.arrayBuffer()
    const args = _adpDecode(new Uint8Array(body))
    const result = await (async function myFn(...) {
      // user body here
    })(...args)
    return new Response(_adpEncode(result), {
      headers: { 'Content-Type': 'application/x-adp' }
    })
  },
  ...
}
```

### Session validation

Wraps each handler with cookie validation:

```js
const session = await validateSession(request.headers.get('cookie'))
if (!session) return new Response('Unauthorized', { status: 401 })
// then call the handler with @session = session
```

## See also

- [Pipeline](pipeline.md) — when each emitter runs
- [ADP](../reference/adp.md) — wire format for server emitter
