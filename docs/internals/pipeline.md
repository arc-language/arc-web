# Compile Pipeline

A walk through the Arc compiler from `.arc` source to `dist/`. Source: `/home/claude/arc/src/cli.js` `compile()` function.

## Stages

```
.arc source
    │
    1. Lexer       (src/lexer.js)        → tokens
    │
    2. Parser      (src/parser.js)       → AST
    │
    3. Imports     (src/cli.js)          → AST with imports inlined
    │
    4. Checker     (src/checker.js)      → semantic + a11y errors/warnings
    │
    5. @build exec (src/build-exec.js)   → AST with @build values populated
    │
    6. Optimizer   (src/optimizer.js)    → AST with static loops unrolled, dead code stripped
    │
    7. Img pipe    (src/img-pipeline.js) → image variants written to dist/; pipeline obj available
    │
    8. HTML emit   (src/emitters/html.js) → HTML string + stateBindings + eventBindings
    │
    9. CSS emit    (src/emitters/css.js)  → CSS string
    │
   10. Treeshake   (src/cli.js)           → CSS pruned of unused base utilities
    │
   11. Server emit (src/emitters/server.js) → @server fn → edge fns + client stubs
    │
   12. JS emit     (src/emitters/js.js)    → reactive setters + bindings
    │
   13. Realtime    (src/realtime/client.js) → WS client code
    │
   14. Compose JS  (src/cli.js)           → ADP runtime + stubs + reactive + realtime
    │
   15. Edge render (src/edge/renderer.js) → @live edge fn (if @live present)
    │
   16. Post        (src/post.js)          → inline critical CSS, minify, resource hints
    │
   17. Write       (src/cli.js)           → dist/index.html, dist/styles.css, dist/app.js, dist/_arc/*
```

## Stage-by-stage

### 1. Lexer

Token stream from source text. Handles:
- Indentation (`INDENT` / `DEDENT` tokens)
- String interpolation (`{...}` inside `"..."`)
- Escape sequences
- Keywords vs identifiers (Arc keywords table in `tokens.js`)

Output: `Token[]`.

### 2. Parser

Recursive-descent over tokens. Produces an AST per `src/ast.js` node definitions:

- `Program`
- `ImportDecl`, `PageDecl`, `WidgetDecl`, `ReactiveDecl`, `ServerFn`, `WorkerFn`, `LiveDecl`, `RealtimeDecl`, `DesignBlock`, `ClassDecl`, `FnDecl`, `TypeDecl`
- Template: `Element`, `TextNode`, `IfNode`, `UnlessNode`, `ForNode`, `MatchNode`, `SlotNode`, `InterpolationNode`, `TemplateLiteral`
- Expressions: `Literal`, `Identifier`, `BinaryExpr`, `UnaryExpr`, `MemberExpr`, `CallExpr`, `ArrayLit`, `ObjectLit`, `AwaitExpr`, `AtProperty`, etc.

### 3. Import resolution

Recursively reads imported `.arc` files, merges their `WidgetDecl` / `FnDecl` into the importer's program. Cycle-safe via `visited` set. Path traversal guarded — imports can't escape the project root.

### 4. Checker

Two passes:
- **Semantic**: undefined vars, type mismatches, banned constructs (`var`, `null`, `===`, etc.)
- **Accessibility**: missing form labels, unhandled `aria-*` requirements

Output: `{ errors: [...], warnings: [...] }`. Throws on errors.

### 5. @build executor

Walks the AST. For each `@build` decl, evaluates the RHS in a sandboxed Node context:
- `fetch(url)` — HTTPS/HTTP with SSRF guards
- `readFile(path)` — local files within project root, sensitive-name blocklist
- Arithmetic, conditionals, array methods

Writes results back into the AST as Literal values. Failures collected as warnings.

### 6. Optimizer

- **Loop unrolling**: `for x in arr` where `arr` is statically known → flattens to N copies of the body with `x` substituted
- **If/match folding**: branches with statically-determinable conditions become the chosen branch
- **Constant inlining**: `@build` value references substituted by their literal values (primitives only)
- **Dead code**: `if false { ... }` blocks dropped

### 7. Image pipeline

`collectImgRefs(program)` walks the AST collecting every `<img src=...>` with position info. If sharp is available + at least one local img reference:

1. Transcode to AVIF + WebP + original at requested widths
2. Compute dominant color
3. Hash content → dedup filenames
4. Apply smart format selection (drop AVIF when not 20% smaller than WebP)

The pipeline object is passed to the HTML emitter for `<img>` → `<picture>` rewriting.

### 8. HTML emit

Walks the AST emitting HTML strings. Tracks:
- `stateBindings: [{ id, expr, kind }]` — every `{expr}` interpolation or `bind:value` that references a `@state`
- `eventBindings: [{ elementId, event, handler }]` — every `on:event={...}`

Auto-applies enhancements: `loading="lazy"`, `type="button"`, `target="_blank"` etc. Auto-injects skip link, `<main>`, `<h1>` if absent.

### 9. CSS emit

Walks `DesignBlock` rules. Scopes selectors with a per-component hash. Emits `@layer base { ... }` (utilities + reset) + `@layer component { ... }` (user rules). Tracks `usedKeyframes`.

### 10. Tree-shake CSS

Scans the emitted HTML for `arc-*` utility class names. Strips utility rules whose class isn't referenced.

### 11. Server fn emit

For each `@server fn`:
- Generate an **edge handler** body: parses ADP request body, calls the fn, encodes the result
- Generate a **client stub**: `async function fn(args) { fetch('/_arc/fn/...', adp.encode(args)) }`

### 12. JS emit

For each `@state`:
- Generate a setter that updates exactly the DOM nodes referenced by `stateBindings`
- Wire up event handlers from `eventBindings`

For `@computed`:
- Resolve dependency graph
- Inline the recomputation into upstream setters

### 13. Realtime emit

For each `@realtime channel(...)`:
- Generate WebSocket connection code with auto-reconnect
- ADP frame parser
- Direct DOM updates on frame arrival

### 14. Compose client JS

Concatenate: ADP runtime (if any `@server` stub called from client OR realtime present) + stubs + reactive + realtime.

**Tree-shake**: if no stub is actually referenced from client JS, drop the ADP runtime + stubs.

### 15. Edge renderer (`@live` only)

When the program has `@live` decls:
- Generate a `_resolveData` function (parallel `Promise.all` over `@live` calls)
- Generate `_fillHtml(data)` that substitutes data into the HTML template
- Wrap in a streaming `Response(ReadableStream)` that flushes `<head>` first

### 16. Post-process

`PostProcessor.process(html, css)`:
- `inlineCriticalCss` — small CSS → inline into `<style>`; large CSS → critical inline + preload rest
- `minifyCss` — strip whitespace/comments
- `addResourceHints` — `<link rel="preconnect">` for external domains
- `minifyHtml` — strip whitespace between tags (preserves `<pre>`, `<style>`, etc.)

Returns `{ html, css, cssInlined }`.

### 17. Write

Writes outputs to `dist/`:
- `index.html` — always
- `styles.css` — only if NOT inlined
- `app.js` + `.map` — only if non-empty
- `_arc/functions.js` — only if `@server` fns present
- `_arc/renderer.js` — only if `@live` present

For `build-site`: extra step extracts shared CSS across pages, emits `sitemap.xml`, `robots.txt`, `_headers`, injects prefetch tags.

## File sizes

After all stages, a single-page docs site typical output:

```
dist/index.html      2.5 KB (HTML + inlined CSS)
dist/_arc/*           0 B  (no @server/@live)
```

A dashboard with `@state` + `@server` + `@live`:

```
dist/index.html       3 KB
dist/app.js          800 B
dist/_arc/functions.js  6 KB (server-side only)
dist/_arc/renderer.js   8 KB (server-side only)
```

## Performance

Each stage is single-pass over its input. The whole pipeline runs in ~100 ms for a typical page on commodity hardware (no AST traversal happens more than 3 times total).

## See also

- [Emitters](emitters.md) — html/css/js emitter contracts
- [Optimizer](optimizer.md) — loop unrolling + tree-shake details
- [Image Pipeline](image-pipeline.md) — F1-F5 implementation
