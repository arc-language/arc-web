# Error Catalog

Every error and warning Arc emits, with cause and fix. For LLM self-correction and human debugging.

## Format

```
LEVEL: message
  → what triggered it
  → how to fix
```

Sorted by source file.

---

## Lexer errors (`src/lexer.js`)

### `Unexpected character: "..."`
- **Trigger:** an invalid character in source (rare — Arc's character set is liberal).
- **Fix:** check for non-UTF-8 bytes; replace smart quotes with straight quotes.

### `Unterminated string literal`
- **Trigger:** opening `"` without matching close before EOF or newline.
- **Fix:** add the closing `"`. To embed newlines, use `\n` escape.

### `Unterminated string interpolation`
- **Trigger:** `"{expr ...` without `}`.
- **Fix:** close the `{` with `}`. To embed a literal `{`, escape: `\{`.

### `Invalid escape sequence: \X`
- **Trigger:** unknown `\` escape in string.
- **Fix:** supported escapes are `\n \t \r \\ \" \' \{`. Anything else is rejected.

### `Indentation must be 2 spaces (got tab)`
- **Trigger:** tab characters in indentation.
- **Fix:** use 2 spaces per level. Configure your editor to insert spaces.

---

## Parser errors (`src/parser.js`)

### `Unexpected token: ...`
- **Trigger:** parser couldn't match the token to any production rule.
- **Fix:** check syntax. Most often a missing operator, comma, or wrong indentation.

### `Expected IDENT, got ...`
- **Trigger:** parser expected an identifier (variable name, element name, etc.).
- **Fix:** use a valid identifier — letters/digits/underscores, starting with letter or underscore.

### `Expected '(' after fn name`
- **Trigger:** `fn myFn body` instead of `fn myFn() body`.
- **Fix:** add parens for the parameter list, even when empty: `fn myFn() { ... }`.

### `Match must have a catch-all '_'`
- **Trigger:** `match expr { case1 => ... }` without a `_` arm.
- **Fix:** add `_ => default` as the last arm. `match` is exhaustive.

### `bind:value path must be a simple variable or dotted path`
- **Trigger:** `bind:value={complexExpr()}` instead of `bind:value={user.name}`.
- **Fix:** bind targets must be assignable paths. Use a `@state` variable or a dotted path into one.

---

## Checker errors + warnings (`src/checker.js`)

### `WARN: <input> has no accessible name`
- **Trigger:** `<input>`, `<select>`, `<textarea>` without `aria-label`, `aria-labelledby`, `id` (with sibling `<label>`), or `placeholder`.
- **Fix:** add one of those. Best: `<label>` + `id`. Worst-but-accepted: `placeholder=`.

### `Undefined variable: x`
- **Trigger:** referenced an identifier with no declaration in scope.
- **Fix:** declare with `let`, `const`, `@state`, `@build`, etc. Or import.

### `var is not allowed in Arc — use let or const`
- **Trigger:** `var x = ...`.
- **Fix:** use `let` (mutable) or `const` (immutable).

### `null is not a value in Arc — use none`
- **Trigger:** `null` keyword.
- **Fix:** use `none`. Same semantics, no JavaScript ambiguity.

### `=== is not used in Arc — use ==`
- **Trigger:** `===` or `!==` operator.
- **Fix:** `==` and `!=` are already strict. Drop the extra `=`.

### `function keyword not allowed — use fn`
- **Trigger:** `function name() { ... }`.
- **Fix:** `fn name() { ... }`.

### `this not allowed — use @field`
- **Trigger:** `this.x` inside a class method.
- **Fix:** `@x`. Arc auto-binds methods.

### `for..in not allowed — use 'for k, v in object'`
- **Trigger:** `for k in obj`.
- **Fix:** explicit destructuring: `for k, v in obj`.

### `switch not allowed — use match`
- **Trigger:** `switch (x) { ... }`.
- **Fix:** `match x { ... }`. See [Logic](../language/logic.md).

### `typeof / instanceof not allowed — use 'is'`
- **Trigger:** `typeof x === 'string'` or `x instanceof Foo`.
- **Fix:** `x is String`, `x is Foo`.

---

## Build executor errors (`src/build-exec.js`)

### `@build fetch: invalid URL: <url>`
- **Trigger:** `@build const x = await fetch("not-a-url")`.
- **Fix:** provide a full URL with scheme: `http://...` or `https://...`.

### `@build fetch: only http/https allowed, got <protocol>`
- **Trigger:** `@build const x = await fetch("file://...")` or similar.
- **Fix:** Arc's `@build` only allows network HTTP(S). For local files, use `readFile()`.

### `@build fetch: internal addresses not allowed: <host>`
- **Trigger:** fetch to `127.0.0.1`, `localhost`, `[::1]`, `0.0.0.0`, private IP ranges.
- **Fix:** use a public URL. Arc's `@build` blocks SSRF-style internal targets.

### `@build fetch: redirects not allowed (3XX): <url>`
- **Trigger:** the server returned 301/302/etc.
- **Fix:** fetch the final URL directly. Arc doesn't follow redirects (prevents accidental cross-origin data leaks).

### `@build fetch: HTTP <status> from <url>`
- **Trigger:** non-2XX response.
- **Fix:** fix the URL or the server.

### `@build fetch: response too large (max 10MB): <url>`
- **Trigger:** response body > 10 MB.
- **Fix:** paginate, or restructure to load less at build time.

### `@build fetch: timeout after 10s: <url>`
- **Trigger:** server didn't respond within 10 seconds.
- **Fix:** check the URL, server health, or use a cache.

### `@build readFile: requires a path argument`
- **Trigger:** `readFile()` with no args.
- **Fix:** `readFile("./content/post.md")`.

### `@build readFile: path traversal blocked: <path>`
- **Trigger:** `readFile("../../etc/passwd")` etc.
- **Fix:** keep paths within the project root.

### `@build readFile: forbidden filename pattern: <name>`
- **Trigger:** trying to read `.env`, `.git/...`, `id_rsa`, `secrets.*`, etc.
- **Fix:** read from a non-sensitive file. Arc has an allowlist for safety.

---

## Image pipeline warnings (`src/img-pipeline.js`)

### `arc: sharp not installed — skipping image optimization`
- **Trigger:** any `<img src="local.*">` exists but `sharp` is not in `node_modules`.
- **Fix:** `npm install sharp` to enable AVIF/WebP/srcset/dimensions. Or ignore — Arc will pass the `<img>` through unchanged.

### `arc: image pipeline error: <message>`
- **Trigger:** sharp failed to decode an image (corrupt file, unsupported format).
- **Fix:** verify the source file is a valid image. SVGs aren't auto-transcoded — emit them via `<img>` with the SVG as source.

---

## CLI errors (`src/cli.js`)

### `arc: no .arc files found in <dir>`
- **Trigger:** ran `arc build` in a directory with no `*.arc` files.
- **Fix:** check the directory; run `arc new <name>` to scaffold.

### `arc: cannot read directory <dir>: <reason>`
- **Trigger:** permission denied, dir doesn't exist.
- **Fix:** check the path and permissions.

### `arc: warning: import not found: <src>`
- **Trigger:** `import X from "./missing"` where the file doesn't exist.
- **Fix:** correct the path. Arc continues — the import is treated as if absent.

### `arc: warning: import escapes project root, skipping: <src>`
- **Trigger:** `import X from "../../../etc/passwd"`.
- **Fix:** keep imports within the project root.

### `arc: error writing output files: <reason>`
- **Trigger:** can't write to `dist/` — permission denied, disk full, file conflict.
- **Fix:** check `dist/` permissions; remove conflicting files.

---

## Edge renderer errors (`src/edge/renderer.js`)

### `[arc] @live data error: <message>`
- **Trigger:** `_resolveData()` threw inside the edge worker.
- **Fix:** check the failing `@server` fn. Wrap with try/catch + return Result to handle gracefully.

### `[arc] edge render error: <message>`
- **Trigger:** outer error in the fetch handler (rare — usually a streaming or encoding issue).
- **Fix:** check the source file written to `dist/_arc/renderer.js`; report a bug if it's compiler output.

---

## Realtime client errors

### `ADP: unknown tag <N>`
- **Trigger:** decoder received a frame with a tag outside `0x00–0x08`.
- **Fix:** the server is using a different protocol version or corrupted bytes. Verify the server is using Arc's ADP encoder.

---

## When you can't find your error here

Some errors are passthroughs from Node, V8, or sharp. Common ones:

- `EACCES: permission denied` — file/dir permission issue
- `ENOENT: no such file or directory` — missing input file
- `Maximum call stack size exceeded` — infinite recursion in your `@server` body
- `Heap out of memory` — large `@build readFile` on a huge file

When in doubt, run `arc check` first to surface compile-time issues, then run `arc build` with `ARC_LOG_LEVEL=debug` for verbose output.

## File a bug

If you hit an error that's not in this catalog and looks like an Arc compiler bug (not a user error), open an issue with:

1. The `.arc` source that triggered it
2. The full error message + stack
3. Your Arc version (`arc --version`)
4. Your Node version (`node --version`)

## See also

- [Logic](../language/logic.md) — banned constructs
- [CLI](cli.md) — exit codes
- [Contributing](../internals/contributing.md) — error message conventions
