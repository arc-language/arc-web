# Contributing

Arc is a small codebase (~5,200 lines of pure Node, zero production deps). Contributions welcome — bug fixes, new features, docs improvements.

## Setup

```bash
git clone https://github.com/arc-language/arc-web
cd arc
npm install        # optional: only installs sharp for image pipeline tests
```

That's it. Arc itself has no dependencies.

## Tests

```bash
node --test tests/                # full suite (~10 seconds)
node --test tests/lexer.test.js   # one file
node --test --test-name-pattern="image" tests/   # by name
```

Tests use the Node built-in test runner (no Jest, no Mocha). Coverage:

```bash
node --test --experimental-test-coverage tests/
```

Targets: **≥95% line coverage** on `src/`. CI rejects PRs that drop below.

## Project structure

```
arc/
├── src/                  # compiler source (~5,200 lines)
│   ├── lexer.js
│   ├── parser.js
│   ├── ast.js            # AST node constructors
│   ├── tokens.js         # token types + keywords
│   ├── checker.js        # semantic + a11y
│   ├── build-exec.js     # @build sandbox
│   ├── optimizer.js      # AST optimizations
│   ├── img-pipeline.js   # image transcoding
│   ├── post.js           # critical CSS, minify
│   ├── cli.js            # entry point + commands
│   ├── emitters/
│   │   ├── html.js
│   │   ├── css.js
│   │   ├── js.js
│   │   ├── server.js
│   │   ├── site-meta.js
│   │   └── headers-manifest.js
│   ├── edge/
│   │   └── renderer.js
│   └── realtime/
│       └── client.js
├── adp/                  # binary protocol encoder/decoder
├── stdlib/               # written in Arc
├── tests/                # 1071 tests
└── docs/
```

## Coding style

- **2 spaces** indentation. Tabs forbidden.
- **No semicolons** at line ends (ASI works fine — Node's parser is lenient).
- **camelCase** for variables and functions; **PascalCase** for classes.
- **`const` by default**, `let` only when reassigning.
- **Pure functions** preferred over class methods where it doesn't hurt readability.
- **No comments explaining WHAT** the code does (well-named identifiers cover that).
- **Comments explaining WHY** when it's non-obvious — workarounds, edge cases, performance-sensitive code.

## Tests are mandatory

Every new feature and every bug fix needs at least one test:

- Bug fix → test that **fails on the old code, passes on the new**
- New feature → tests for the happy path, at least one edge case, and (where applicable) failure modes

Place tests in the file matching the source: `src/foo.js` → `tests/foo.test.js`.

## PR checklist

Before opening a PR:

- [ ] `node --test tests/` passes
- [ ] Coverage ≥95% on lines touched
- [ ] No new dependencies in `package.json` (Arc is zero-dep — discuss in an issue first if you think there's a justified exception)
- [ ] If you added a CLI flag, document it in `docs/reference/cli.md`
- [ ] If you added an emitted error, document it in `docs/reference/errors.md`
- [ ] If you changed the syntax, update `docs/language/syntax.md`
- [ ] If you added a new public API, write or update the relevant `docs/` file
- [ ] Run `arc check examples/*` to verify examples still parse

## Bug reports

Open an issue with:

1. Minimal `.arc` source that triggers the bug
2. Expected output / behavior
3. Actual output / behavior
4. Arc version (`arc --version`)
5. Node version (`node --version`)
6. OS

Bonus: a failing test in `tests/<file>.test.js` makes the fix mergeable in one commit.

## Feature proposals

Open a discussion or issue describing:
- The use case (concrete example, not theoretical)
- Why Arc's current vocabulary can't express it
- Sketch of the syntax / behavior you'd propose
- What other frameworks do (if anything) for comparison

Big architectural changes — new data context, new emitter, breaking syntax — should land as an RFC PR (markdown in `docs/rfcs/`) before code.

## Performance regressions

Arc's perf budget:
- `arc build` on a 5-section page: < 200 ms
- `arc build-site` on a 20-page docs site: < 1 second
- Test suite: < 15 seconds

CI runs benchmarks; PRs that regress beyond noise are blocked.

## Releases

Arc follows [SemVer](https://semver.org/):
- **Major** (1.0.0): breaking syntax or output changes
- **Minor**: new features, new CLI commands, new emitters
- **Patch**: bug fixes, doc improvements, perf wins

Current: 0.x — still pre-1.0; minor versions may include small breaking changes (announced in the changelog).

## Code of conduct

Be respectful. Disagreements are technical; people are people. If you wouldn't say it to a colleague in person, don't post it.

## License

MIT. By contributing, you agree your changes are licensed under MIT.

## Get help

- GitHub Discussions: design questions, "is this a good fit?", "how would I…"
- GitHub Issues: bugs, feature requests
- Discord (if/when established): real-time chat

## Acknowledgements

Arc draws inspiration from:
- **Svelte** — compile-time reactivity
- **Astro** — islands, zero-JS-by-default, file-per-route
- **Cloudflare Workers** — WinterCG edge runtime
- **HTML/CSS specs** — the actual web platform

## See also

- [Pipeline](pipeline.md) — overall architecture
- [Emitters](emitters.md) — extension points
