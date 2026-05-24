---
name: arc-bug-report
description: Use when the user describes a problem with Arc and wants to file a bug report. Walks them through the GitHub issue template + helps draft the reproducer.
---

# arc-bug-report

**When to use:** the user encountered an Arc compiler bug, syntax error they think is wrong, unexpected output, etc. — and wants to file an issue.

**Reference:** `.github/ISSUE_TEMPLATE/bug_report.yml`, `docs/reference/errors.md`.

## What goes in a good bug report

1. **Arc version** — `arc --version`
2. **Node version** — `node --version`
3. **OS** — Linux / macOS / Windows + version
4. **Minimal `.arc` reproducer** — smallest source that triggers the bug
5. **Command run** — `arc build`, `arc check`, `arc dev`, etc.
6. **Expected behavior** — what should have happened
7. **Actual behavior** — what did happen (full error + stack)
8. **Anything else** — related issues, hypotheses, screenshots

The `.github/ISSUE_TEMPLATE/bug_report.yml` form prompts for each of these.

## How to minimize a reproducer

Iteratively delete until the bug goes away, then put back the last thing you deleted. The goal: shortest `.arc` source that still triggers the issue.

Common minimization steps:
1. Delete unrelated widgets / pages from the project.
2. Replace `@build fetch(...)` with `@build const x = [...]` (rules out network).
3. Replace external imports with inline equivalents.
4. Trim CSS that isn't part of the bug.
5. Reduce to one element if possible.

A 5-line reproducer is gold; a 50-line one is fine; a 500-line one needs more minimization before filing.

## Check the error catalog first

Before filing, check `docs/reference/errors.md` for the exact error message. If it's listed with a fix, the bug might be your code rather than Arc's. (No shame — the catalog exists because these are common.)

## Check existing issues

Search `github.com/arc-language/arc/issues` (open + closed) for keywords from the error message. Duplicates close fast; pointing at the existing issue is more useful than filing again.

## Template the user fills out

```markdown
**Arc version:** 0.1.0
**Node version:** v22.0.0
**OS:** Linux 6.8

**Minimal source (.arc):**
\`\`\`arc
page "Repro"
  ...
\`\`\`

**Command:** `arc build`

**Expected:** the page builds without error.

**Actual:**
\`\`\`
arc: error: index.arc:3:5: <error message>
  3 │   problematic line
        ^
\`\`\`

**Notes:**
- Worked in 0.0.X (if regression)
- See also #123 (related)
- Hypothesis: the bug might be in src/parser.js because...
```

## When NOT to file as a bug

| Symptom | Right channel |
| --- | --- |
| Question "how do I do X?" | [GitHub Discussions](https://github.com/arc-language/arc/discussions) |
| Feature request | Issue with `feature_request.yml` template |
| Security vulnerability | Privately via [security advisory](https://github.com/arc-language/arc/security/advisories/new) — NEVER public issue |
| Documentation gap | Issue OR PR with the doc fix |
| Behavior matches docs but you disagree with the design | Discussion first; if traction, RFC PR |

## Anti-patterns

- ❌ **"Arc is broken" with no reproducer** — won't get diagnosed. A 5-line `.arc` file is the minimum.
- ❌ **Pasting your entire app** — minimize first.
- ❌ **"Fix this"** without describing expected vs actual.
- ❌ **Including secrets** in the reproducer (env vars, API keys, internal URLs).
- ❌ **Multiple bugs in one issue** — split. Each issue gets its own reproducer.
- ❌ **Filing security issues publicly** — use the private advisory channel.

## Verification

Apply the universal **arc-self-verify** checklist to the user's BUG (verify it's actually broken). In addition:

- [ ] **Reproducer minimized** — under 20 lines if possible.
- [ ] **Versions stated** (Arc, Node, OS).
- [ ] **Command stated** (`arc build` / `arc check` / etc.).
- [ ] **Expected vs actual** clearly separated.
- [ ] **Error message full** — including line number + caret + stack trace if any.
- [ ] **No secrets** in the reproducer.
- [ ] **Checked against `docs/reference/errors.md`** — if listed, the user's code is the bug, not Arc.
- [ ] **Searched existing issues** — no obvious duplicate.
- [ ] **Right channel chosen** — bug template for bugs; discussion for questions; advisory for security.
- [ ] **Issue title is specific**: "Parser eats DEDENTs after design block when followed by top-level const" — NOT "parser bug".
