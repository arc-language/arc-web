# Optimizer

Source: `/home/claude/arc/src/optimizer.js`. Runs after `@build` execution, before HTML/CSS/JS emit.

## What it does

The optimizer transforms the AST by:

1. **Substituting `@build` references** with their literal values
2. **Unrolling static `for` loops** when the collection is statically known
3. **Folding static `if`/`unless` conditions**
4. **Inlining static interpolations** in template strings

Plus several tree-shaking passes outside the optimizer (in `cli.js`):

5. **Stripping unused base utility CSS** (`.arc-row`, `.arc-sr-only`, etc.) — see [Emitters](emitters.md)
6. **Stripping ADP runtime + `@server` stubs** when no client call sites exist
7. **Stripping the `@layer base` wrapper** when no user component rules present

## Static for-loop unrolling

```arc
@build const items = ["red", "green", "blue"]

for item in items
  card "{item}"
```

After parse, the AST contains a `ForNode` with `collection = items` and a body of one `Element`. The optimizer:

1. Resolves `items` from the `@build` context → `["red", "green", "blue"]`
2. Sees it's a static array (length known)
3. Expands the body 3 times, substituting `item` with each value

Result AST equivalent to:

```arc
card "red"
card "green"
card "blue"
```

When the loop body has nested `for` or `if`, they're recursively optimized with the loop variable in scope.

### When unrolling DOESN'T happen

```arc
@state let items = []     // dynamic — can't unroll
for item in items
  card "{item}"
```

Reactive collections stay as runtime `ForNode`s. The JS emitter generates list-render code.

## Static if folding

```arc
@build const DEBUG = true

if DEBUG
  text "Debug mode"
else
  text "Production"
```

Optimizer:
1. Resolves `DEBUG` → `true`
2. Replaces the `IfNode` with its `consequent` (just the `text "Debug mode"`)

The `else` branch is discarded entirely — no bytes emitted for it.

For an unknown condition (`@state`-derived, `@live`-derived), the IfNode stays.

## Constant inlining

```arc
@build const TITLE = "My Site"
@build const YEAR = 2026

heading "{TITLE}"
text "© {YEAR}"
```

Optimizer substitutes `TITLE` and `YEAR` into the interpolations:

```arc
heading "My Site"
text "© 2026"
```

**Important constraint**: only primitives (`string`, `number`, `boolean`, `null`) are inlined. Objects and arrays stay as references (otherwise they'd serialize as `[object Object]` via `String(val)`, corrupting the output).

```arc
@build const obj = { name: "Alice" }
text "{obj.name}"            // NOT inlined as "Alice" — stays as obj.name expression
```

## ADP runtime tree-shake (in `cli.js`)

```js
function composeClientJs(reactive, stubs, realtime) {
  let stubsToShip = stubs
  let adpNeeded = !!realtime
  if (stubs) {
    const names = [...stubs.matchAll(/async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1])
    const used = names.some(n => {
      const re = new RegExp(`\\b${n}\\s*\\(`)
      return re.test(reactive) || re.test(realtime || '')
    })
    if (!used) stubsToShip = ''
    else adpNeeded = true
  }
  const parts = []
  if (adpNeeded) parts.push(ADP_MINI_RUNTIME)
  if (stubsToShip) parts.push(stubsToShip)
  ...
}
```

Strategy: scan the emitted client JS for call sites of stub function names. If none exist (e.g., `@server` fns only called from `@live`, which resolves at edge), drop the runtime + stubs entirely.

Effect: dashboard with `@server` + `@live` only → 0 B of ADP in client bundle.

## Base utility CSS tree-shake (in `cli.js`)

```js
function treeshakeBaseCss(css, html) {
  const utilities = [
    'arc-row', 'arc-col', 'arc-center', 'arc-spacer', 'arc-wrap',
    'arc-sr-only', 'arc-skip-link',
  ]
  for (const cls of utilities) {
    const used = new RegExp(`class\\s*=\\s*"[^"]*\\b${cls}\\b`).test(html)
    if (used) continue
    const re = new RegExp(`^\\s*\\.${cls}(:[a-z-]+)?\\s*\\{[^}]*\\}\\s*\\n?`, 'gm')
    css = css.replace(re, '')
  }
  return css
}
```

Scans the final HTML for `class="...arc-foo..."` references. If a utility isn't used, strips its rule from CSS.

For `arc build-site` (multi-page), the tree-shake checks each page's HTML separately. The shared CSS extractor later only includes rules common to ≥2 pages.

## What the optimizer DOESN'T do

- **No JS-level dead code elimination**. Arc compiles to small JS bundles already; running a JS optimizer (like esbuild's tree-shake) over the output is left to whatever serves the JS.
- **No CSS minification beyond what `post.js` does**. The PostProcessor strips whitespace + comments. Property value normalization (`oklch` → hex, `0.5` → `.5`) is on the wishlist.
- **No image transformation**. That's the image pipeline (`img-pipeline.js`).
- **No re-ordering of CSS rules across `@layer`s**. Specificity must be preserved.

## Adding a new optimization

The optimizer has a clean visitor pattern: `optimizeProgram` → `optimizeDecl` → `optimizeNode` → recursive children.

To add (e.g.) constant folding for arithmetic:

```js
case 'BinaryExpr': {
  const left = this.optimizeExpr(node.left)
  const right = this.optimizeExpr(node.right)
  if (left.type === 'Literal' && right.type === 'Literal') {
    return N.Literal(applyOp(node.op, left.value, right.value), '', node.line)
  }
  return { ...node, left, right }
}
```

Add tests in `tests/optimizer.test.js`.

## See also

- [Pipeline](pipeline.md) — where the optimizer runs
- [Emitters](emitters.md) — what consumes the optimized AST
