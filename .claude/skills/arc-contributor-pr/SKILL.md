---
name: arc-contributor-pr
description: Use when a contributor wants to submit a PR to the Arc compiler itself (not their own Arc project). Guides through finding the right file, writing the test, updating docs + CHANGELOG, matching the PR template.
---

# arc-contributor-pr

**When to use:** the user says "I want to fix a bug in Arc", "I'd like to add a feature to the compiler", "how do I contribute?". This is about contributing to `github.com/arc-language/arc-web` itself, NOT about writing Arc apps.

**Reference docs:** `CONTRIBUTING.md`, `docs/internals/contributing.md`, `docs/internals/pipeline.md`, `.github/PULL_REQUEST_TEMPLATE.md`.

## PR checklist (matches `.github/PULL_REQUEST_TEMPLATE.md`)

Before opening:

- [ ] `node --test tests/*.test.js` passes locally
- [ ] Coverage ≥95% on lines you touched (`node --test --experimental-test-coverage tests/`)
- [ ] No new entries in `dependencies` of `package.json` (Arc is zero-prod-dep)
- [ ] Docs updated if you added a CLI flag, error, syntax, or public API
- [ ] `CHANGELOG.md` `[Unreleased]` updated if user-visible
- [ ] Examples still build: `for ex in examples/*; do node src/cli.js build "$ex"; done`

## Where to make the change

| Change kind | File(s) |
| --- | --- |
| New syntax | `src/lexer.js` (token), `src/parser.js` (parse rule), `src/checker.js` (semantic check), `src/emitters/{html,css,js}.js` (output), `tests/*` |
| Bug in HTML emitter | `src/emitters/html.js` + `tests/html-emitter.test.js` |
| Bug in CSS emitter | `src/emitters/css.js` + `tests/css-emitter.test.js` |
| Bug in JS emitter | `src/emitters/js.js` + `tests/js-emitter.test.js` |
| Bug in `@server` codegen | `src/emitters/server.js` + `tests/server.test.js` (if exists) |
| Bug in `@live` edge renderer | `src/edge/renderer.js` + `tests/integration.test.js` |
| Bug in `@realtime` | `src/realtime/client.js` + `tests/realtime.test.js` |
| Bug in image pipeline | `src/img-pipeline.js` + `tests/img-pipeline.test.js` |
| New CLI flag | `src/cli.js` (main switch + help text) + `docs/reference/cli.md` |
| New `@build` capability | `src/build-exec.js` + `tests/build-exec.test.js` |
| Stdlib module | `stdlib/<name>.arc` + `tests/stdlib.test.js` |
| New error message | the emitting file + `docs/reference/errors.md` (catalog) |
| Doc improvement | `docs/<area>/<page>.md` |

## Test conventions

```js
// tests/feature.test.js
const { describe, test } = require('node:test')
const assert = require('node:assert')

describe('feature: behavior', () => {
  test('descriptive case name', async () => {
    // 1. Arrange: set up input
    const src = 'page "T"\n  text "hi"'

    // 2. Act: run the compiler
    const { html, css, js } = await compile(src)

    // 3. Assert: verify output
    assert.ok(html.includes('<p>hi</p>'))
    assert.equal(js.trim(), '')
  })

  test('failing case before fix, passing case after', async () => {
    // Tests for bug fixes should FAIL on the old code, PASS on the new
    ...
  })
})
```

## Commit message convention

Follows what's already in the git log:

| Prefix | Use |
| --- | --- |
| `feat:` | New user-visible feature |
| `fix:` | Bug fix |
| `refactor:` | Code restructure (no behavior change) |
| `chore:` | Tooling, CI, deps |
| `docs:` | Docs only |
| `test:` | Tests only |
| `perf:` | Performance improvement |

Example: `fix: parser eatIf consumed all DEDENTs via skipWhitespace`

## Workflow

1. **Open an issue** describing the problem. Big changes (new syntax, breaking API) should be discussed before code.
2. **Fork** + create a branch: `git checkout -b fix/parser-dedent-bug`.
3. **Make the smallest change** that fixes the issue. No unrelated cleanups.
4. **Add a failing test first** (for fixes) — then make it pass.
5. **Run full test suite**: `node --test tests/*.test.js`. Expect 1070+ passing.
6. **Update docs**: error catalog, CLI reference, syntax doc, whatever applies.
7. **Update `CHANGELOG.md`** under `[Unreleased]` if user-visible.
8. **Open PR** using the template in `.github/PULL_REQUEST_TEMPLATE.md`.
9. **Wait for CI** to go green (Node 20 + 22 matrix).
10. **Iterate** on review.

## Anti-patterns

- ❌ **Bundling unrelated fixes** in one PR. One concern per PR.
- ❌ **Refactoring touched files** beyond what the fix needs. Save for a separate PR.
- ❌ **No tests** — won't merge. Even for "obvious" fixes.
- ❌ **Adding new dependencies** to `dependencies`. Arc is zero-prod-dep; this is a hard rule.
- ❌ **Skipping the CHANGELOG** for user-visible changes.
- ❌ **Suppressing CI failures** (`if: false`, `--skip`) instead of fixing them.
- ❌ **Force-pushing after review starts** — confuses reviewers; use new commits, squash on merge.

## Verification

Apply the universal **arc-self-verify** checklist for the code change itself. In addition:

- [ ] **Test added** that fails on old code, passes on new (for fixes) OR exercises the new behavior (for features).
- [ ] **Coverage on touched lines ≥95%**.
- [ ] **Full test suite passes** (`node --test tests/*.test.js` → 1070+/1071).
- [ ] **Examples still build** (the loop in CI does this; mirror locally before pushing).
- [ ] **Lint passes** (`find src adp -name '*.js' | xargs node --check`).
- [ ] **Docs updated** for the change category from the table above.
- [ ] **CHANGELOG.md `[Unreleased]`** has an entry if user-visible.
- [ ] **PR description filled** per template — including risk assessment.
- [ ] **No new `package.json` deps** added (unless explicitly discussed in an issue first).
- [ ] **Commit messages** follow conventional prefixes (`fix:`, `feat:`, etc.).
