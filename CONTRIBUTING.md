# Contributing to Arc

Thanks for considering contributing! Arc is a small, focused project — every PR matters.

## Quick start

```bash
git clone https://github.com/arc-language/arc
cd arc
node --test tests/*.test.js     # all 1070+ tests should pass
```

That's it. Arc has zero production dependencies and one optional dev dependency (`sharp` for the image pipeline). Nothing else to install.

## What to contribute

| Welcome | Details |
| --- | --- |
| Bug fixes | Include a test that fails on old code, passes on new |
| Docs improvements | Typos, clarifications, new recipes |
| Examples | Demonstrate a real use case under `examples/` |
| New compile-time optimizations | Discuss in an issue first if architectural |
| Performance improvements | Include a before/after benchmark from `arc-bench/` |
| Stdlib widgets | New widgets in `stdlib/` if they're broadly useful |

| Discuss first (open an issue) | Why |
| --- | --- |
| New syntax (keywords, operators, block types) | Breaking change risk |
| New dependencies | Arc is zero-prod-dep by design |
| New CLI commands | Surface area + maintenance burden |
| Breaking API changes | Affects every Arc user |

## PR checklist

Before opening:

- [ ] `node --test tests/*.test.js` passes locally
- [ ] Coverage ≥95% on lines you touched (`node --test --experimental-test-coverage tests/`)
- [ ] No new entries in `dependencies` of `package.json` (use `optionalDependencies` for opt-in tooling)
- [ ] Docs updated if you added a CLI flag, a new error, a new syntax, or a new public API
- [ ] CHANGELOG.md updated under `[Unreleased]` if user-visible
- [ ] Examples still build: `for ex in examples/*; do node src/cli.js build "$ex"; done`

## Detailed guide

The internals walkthrough — code organization, emitter contracts, optimizer rules, test layout, coverage policy — lives at [`docs/internals/contributing.md`](docs/internals/contributing.md).

See also:
- [`docs/internals/pipeline.md`](docs/internals/pipeline.md) — full compile pipeline
- [`docs/internals/emitters.md`](docs/internals/emitters.md) — extension points
- [`docs/reference/errors.md`](docs/reference/errors.md) — error message conventions

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.

## Reporting security issues

**Please do not file public issues for vulnerabilities.** See [SECURITY.md](SECURITY.md) for the responsible disclosure process.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

## Questions?

- General questions: [GitHub Discussions](https://github.com/arc-language/arc/discussions)
- Bug reports / feature requests: [GitHub Issues](https://github.com/arc-language/arc/issues)
