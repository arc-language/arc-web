## Summary

<!-- 1-2 sentences. What does this PR do? Why? -->

## Type

<!-- Mark all that apply -->

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (anything that affects existing Arc source compilation, the CLI surface, or the emitted output)
- [ ] Documentation only
- [ ] Internal refactor (no user-visible change)
- [ ] Test improvement
- [ ] Build / CI / tooling

## Linked issue

<!-- Closes #123 / Refs #456 -->

## Changes

<!-- Bullet list of what changed -->

-
-

## Testing

<!-- How did you verify the change works? -->

- [ ] `node --test tests/*.test.js` passes locally
- [ ] Added at least one test that fails on the old code, passes on the new
- [ ] Coverage didn't drop (≥95% line on `src/`)
- [ ] Examples still build: `for ex in examples/*; do node src/cli.js build "$ex"; done`

## Documentation

- [ ] Updated `docs/reference/cli.md` if a CLI flag changed
- [ ] Updated `docs/reference/errors.md` if a new error was added
- [ ] Updated `docs/language/syntax.md` if syntax changed
- [ ] Updated `CHANGELOG.md` under `[Unreleased]` if user-visible
- [ ] Regenerated `docs/llms-full.txt` (`./docs/build-llms-full.sh`) if any doc changed

## Risk

<!-- What's the worst case if this PR has a bug nobody catches? -->

## Reviewer notes

<!-- Anything specific you want eyeballs on -->
