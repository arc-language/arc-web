---
name: arc-fix-checker-error
description: Use when the user pastes `arc check` or `arc build` output with an error/warning. Matches the message against Arc's error catalog and suggests the precise fix.
---

# arc-fix-checker-error

**When to use:** the user pastes a compile error, syntax error, or `arc check` warning. Triggers on output containing `arc: error:`, `arc: warning:`, `Undefined variable`, `Unexpected token`, etc.

**Reference docs:** `docs/reference/errors.md` (authoritative catalog).

## Pattern

1. Identify the error category (lexer / parser / checker / build-exec / image-pipeline / cli).
2. Look up the exact message in `docs/reference/errors.md`.
3. Apply the documented fix to the user's source.
4. Verify the fix passes the `arc-self-verify` checklist.

## Top 15 errors (most common LLM hits)

| Error | Fix |
| --- | --- |
| `null is not a value in Arc — use none` | Replace `null` with `none` |
| `=== is not used in Arc — use ==` | Replace `===` with `==`, `!==` with `!=` (Arc's `==` is already strict) |
| `var is not allowed in Arc — use let or const` | Replace `var` with `let` (mutable) or `const` (immutable) |
| `function keyword not allowed — use fn` | Replace `function name() { }` with `fn name() { }` |
| `this not allowed — use @field` | Inside a class method, replace `this.x` with `@x` |
| `typeof / instanceof not allowed — use 'is'` | Replace `typeof x === 'string'` with `x is String`, `x instanceof Foo` with `x is Foo` |
| `switch not allowed — use match` | Convert switch to `match` with required `_` catch-all |
| `for..in not allowed — use 'for k, v in object'` | Use destructured `for k, v in obj` |
| `Match must have a catch-all '_'` | Add `_ => default` as the last arm |
| `bind:value path must be a simple variable or dotted path` | Use `@state` variable or dotted path; not a function call |
| `Undefined variable: x` | Declare `x` with `let`/`const`/`@state`/`@build`/etc. OR import it |
| `Unterminated string literal` | Add closing `"`. For newlines inside strings, use `\n` escape. |
| `Unterminated string interpolation` | Close `{...}` with `}`. For literal `{`, escape with `\{`. |
| `Indentation must be 2 spaces (got tab)` | Convert tabs to 2-space indent (configure editor to use spaces) |
| `WARN: <input> has no accessible name` | Add `<label for="id">` + `id=`, OR `aria-label=`, OR `placeholder=` |

## Less common (build / runtime errors)

| Error | Fix |
| --- | --- |
| `@build fetch: invalid URL` | Use absolute `http://` or `https://` URL |
| `@build fetch: only http/https allowed` | Arc blocks file://, ws://, etc. in `@build` for security. |
| `@build fetch: internal addresses not allowed` | Don't fetch `127.0.0.1` / `localhost` / private IPs from `@build` (SSRF guard). |
| `@build fetch: redirects not allowed (3XX)` | Use the final destination URL directly. Arc doesn't follow redirects. |
| `@build fetch: HTTP {status}` | Fix the URL or check the server. |
| `@build fetch: response too large (max 10MB)` | Paginate or restructure to fetch less. |
| `@build fetch: timeout after 10s` | Use a cache; check server health. |
| `@build readFile: path traversal blocked` | Keep paths within project root. |
| `@build readFile: forbidden filename pattern` | Don't read `.env`, `.git/`, `id_rsa`, `secrets.*`. |
| `arc: warning: import not found` | Fix the path; ensure the file exists. |
| `arc: warning: import escapes project root` | Keep imports within project root. |
| `arc: sharp not installed — skipping image optimization` | Run `npm install sharp` to enable AVIF/WebP/srcset. |
| `arc: image pipeline error` | Verify source file is a valid image. SVG isn't auto-transcoded. |
| `[arc] @live data error` | A `@server fn` threw inside `_resolveData()`. Wrap with try/catch + return `Err`. |
| `ADP: unknown tag N` | Decoder received a frame with unknown type tag. Server may be using a different protocol version. |

## Workflow for a pasted error

1. **Extract** the exact error line (`arc: error: <file>:<line>: <message>`).
2. **Read** the file at the cited line (use `Read` tool).
3. **Match** the message against the catalog above + `docs/reference/errors.md`.
4. **Propose** the minimal edit that resolves it.
5. **Apply** the edit.
6. **Re-run** `arc check` (or `arc build`) to confirm the error is gone.
7. **Run `arc-self-verify`** on the surrounding code — sometimes a checker error is a symptom of a broader simplification opportunity.

## Anti-patterns

- ❌ **Suggesting a workaround** (suppression, type cast) instead of the documented fix. Arc's errors are designed to be cheap to fix; the catalog has the right answer for each.
- ❌ **Disabling the check** (`// arc-ignore-next`) — Arc doesn't have suppression syntax for a reason. Fix the root cause.
- ❌ **Adding `// TODO: fix this` and moving on**.
- ❌ **Inventing an error category** not in the catalog. If the error isn't documented, it might be a compiler bug — recommend filing an issue.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Cited error is exactly reproducible** before the fix (run `arc check` to confirm).
- [ ] **Cited error is gone** after the fix (re-run `arc check`).
- [ ] **No new errors introduced** by the fix (compare before/after error count).
- [ ] **Fix matches the documented one** in `docs/reference/errors.md`. If you deviate, explain why.
- [ ] **Side effects considered**: e.g., changing `null → none` may affect comparisons elsewhere; changing `switch → match` requires a catch-all.
- [ ] **If the error is in stdlib** (`stdlib/*.arc`), tell the user it's a known stdlib issue — don't try to fix the stdlib unless they specifically asked. (Should be 0 errors after Arc 0.1.0.)
- [ ] **If the error is unrecognized**: don't guess. Tell the user it's not in the catalog and recommend filing an issue at `github.com/arc-language/arc/issues`.
