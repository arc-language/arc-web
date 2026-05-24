---
name: arc-write-test
description: Use when the user wants to write a test for the Arc compiler (a contribution) or for their own Arc app. Provides the test scaffolding pattern + assertion conventions.
---

# arc-write-test

**When to use:** the user is writing a test — either contributing to Arc itself (`tests/*.test.js`) or testing their own Arc project.

**Reference:** `docs/internals/contributing.md`, existing tests in `tests/`.

## Test runner: Node's built-in

Arc uses Node's `--test` flag (no Jest, no Mocha). Available since Node 18+, required Node 20+.

```bash
node --test tests/*.test.js                # run all
node --test tests/lexer.test.js            # one file
node --test --test-name-pattern="image" tests/   # by name pattern
node --test --experimental-test-coverage tests/  # with coverage
```

## File structure

```js
// tests/<area>.test.js
'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert')

// Import the thing under test
const { compile } = require('../src/cli')
// Or per-module:
// const { Lexer } = require('../src/lexer')
// const { Parser } = require('../src/parser')

describe('<feature>: <area>', () => {
  test('<specific behavior>', async () => {
    // Arrange
    const src = `page "Test"\n  text "hi"`

    // Act
    const { html, css, js } = await compile(src)

    // Assert
    assert.ok(html.includes('<p>hi</p>'))
    assert.equal(js.trim(), '')
  })

  test('<another behavior>', async () => {
    ...
  })
})
```

## Assertion patterns

```js
// Substring presence (most common for emit tests)
assert.ok(html.includes('<some-tag>'))
assert.ok(html.includes('class="arc-'))

// Exact match
assert.equal(actual, expected)
assert.strictEqual(actual, expected)   // === comparison

// Regex match
assert.match(html, /class="arc-card_[a-z0-9]+"/)

// Negative: substring NOT present (for tree-shake tests, opt-out tests)
assert.ok(!html.includes('something-that-should-be-stripped'))

// Throws
assert.throws(() => doIt(), /expected error pattern/)

// Async throws
await assert.rejects(asyncDoIt(), /pattern/)

// Deep equality (for AST nodes, JSON-LD, etc.)
assert.deepStrictEqual(actual, expected)
```

## What to test

### For Arc compiler contributions

| Layer | Test it as |
| --- | --- |
| Lexer | Token stream from a string source |
| Parser | AST shape from a token stream OR from source via lexer+parser |
| Checker | Errors / warnings from a source string |
| Optimizer | AST transformation (input AST → output AST) |
| Emitters (HTML/CSS/JS) | String output from a `page` / `widget` declaration |
| End-to-end | `compile(src)` returns `{ html, css, js, edgeFunctions, liveEdgeFunction }` with expected properties |

For each new feature or bug fix, test:
1. **Happy path** — the feature works as documented
2. **At least one edge case** — empty input, single element, deeply nested, etc.
3. **Failure mode** — invalid input emits the right error (use `assert.throws` or `assert.rejects`)

### For Arc projects (user apps)

Arc has no built-in test harness for `.arc` files. Two options:
1. **`arc check`** in CI — catches type / a11y / syntax errors at build time
2. **Manual integration tests** — use Playwright / Puppeteer against the built `dist/`

For unit-testing logic inside `@server fn`, extract pure functions into a `.js` file you can import + test:

```js
// helpers.js
function calculatePrice(items, discount) { ... }
module.exports = { calculatePrice }

// helpers.test.js
const assert = require('node:assert')
const { calculatePrice } = require('./helpers')

test('discount applies correctly', () => {
  assert.equal(calculatePrice([{ price: 10 }], 0.1), 9)
})
```

Then import the helper from your `.arc` `@server fn`:

```arc
@server fn checkout() -> Number
  const items = await getCart()
  return calculatePrice(items, 0.1)
```

## Coverage policy

- **Aim**: ≥95% line coverage on lines you touched
- **Run**: `node --test --experimental-test-coverage tests/`
- **Inspect per-file**: the output lists each file with line/branch/function percentages

For a PR, coverage on the diff matters more than total coverage. Use `--test-coverage-lines=95` to make CI fail on regression.

## Common pitfalls

- ❌ **Forgetting `await`** on async tests: `test('x', async () => { compile(src) })` — should be `await compile(src)`.
- ❌ **Hard-coded scoped class names**: `assert.ok(html.includes('arc-card_1g18'))` — the hash changes if anything in the program changes. Use `assert.match(html, /arc-card_[a-z0-9]+/)`.
- ❌ **Testing against entire HTML string with `assert.equal`** — fragile. Test for the SPECIFIC behavior (substring or regex).
- ❌ **Sharing state between tests** — each test should be isolated. Don't assign to module-level `let` in tests.
- ❌ **Time-dependent tests** without `Date.now()` mock — flaky. Either inject the date or accept slight imprecision.
- ❌ **Skipping cleanup** for tests that write files: use `os.tmpdir()` + `fs.mkdtempSync` + `try/finally rmDir`.

## Anti-patterns

- ❌ **No test for a bug fix** — PR won't merge. Always add one that fails on the old code, passes on the new.
- ❌ **Testing implementation details** (private function names, internal state) — test the OBSERVABLE behavior (compiled output).
- ❌ **Mocking the compiler** — Arc has no DI; just call `compile()` directly. It's fast (~10 ms for a simple page).
- ❌ **Multiple assertions for unrelated concerns in one test** — split into multiple tests.

## Verification

Apply the universal **arc-self-verify** checklist to the test itself. In addition:

- [ ] **Test fails on the broken code, passes on the fixed code** (for bug fixes — confirm both directions).
- [ ] **`describe` + `test` names are descriptive**: future maintainers should understand WHAT broke without reading the test body.
- [ ] **Arrange/Act/Assert structure** visible.
- [ ] **Isolated** — no order dependency, no shared mutable state.
- [ ] **Async tests use `await`** correctly.
- [ ] **Scoped class names matched with regex** (`arc-card_[a-z0-9]+`), not exact string.
- [ ] **Cleanup in `try/finally`** for tests that touch the filesystem.
- [ ] **Coverage on the touched code path ≥95%**.
- [ ] **Time complexity** of the test: should be O(1) for unit tests; integration tests may be O(n) for example builds.
- [ ] **Test runs in <1 s** (most unit tests should be <100 ms). Slow tests get cut by CI timeouts.
