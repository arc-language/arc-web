# Arc LLM Skills

A curated set of 22 prompts/skills that teach any code-aware LLM how to write idiomatic Arc — and verify its own output for simplicity, performance, Core Web Vitals impact, time/space complexity, bundle bytes, accessibility, and type safety.

## Why this exists

LLMs are how most developers first encounter new languages in 2026. Without curated skills, tools like Cursor, Cline, Claude Code, Aider, Continue, GitHub Copilot, and chat-based LLMs (ChatGPT, Claude.ai) generate broken Arc code. These skills fix that — every authoring skill ends with a **universal verification checklist** (`arc-self-verify`) that the LLM runs before returning code.

## What's in the bundle

| Category | Skills |
| --- | --- |
| **Meta** (2) | `arc-self-verify`, `arc-style-guide` |
| **Authoring** (9) | `arc-new-page`, `arc-pick-data-context`, `arc-add-state`, `arc-add-server-fn`, `arc-add-live`, `arc-add-realtime`, `arc-add-form`, `arc-add-image`, `arc-multi-page-setup` |
| **Diagnostic** (5) | `arc-fix-checker-error`, `arc-explain-bytes`, `arc-perf-audit`, `arc-debug-state-binding`, `arc-debug-live-streaming` |
| **Migration** (3) | `arc-from-react`, `arc-from-astro`, `arc-from-vanilla` |
| **Contributor** (3) | `arc-contributor-pr`, `arc-bug-report`, `arc-write-test` |

Full catalog: [`SKILLS.md`](SKILLS.md).
Concatenated single-file bundle (for one-paste system prompts): [`all.md`](all.md) (~128 KB).

## Install for your LLM tool

| Tool | Install guide |
| --- | --- |
| **Claude Code** (CLI) | [INSTALL/claude-code.md](INSTALL/claude-code.md) — works automatically when the repo is open |
| **Cursor** | [INSTALL/cursor.md](INSTALL/cursor.md) — concat into `.cursorrules` |
| **Cline** (VS Code) | [INSTALL/cline.md](INSTALL/cline.md) — paste into custom instructions |
| **Aider** | [INSTALL/aider.md](INSTALL/aider.md) — `aider --read all.md` |
| **Continue.dev** | [INSTALL/continue.md](INSTALL/continue.md) — `~/.continue/config.json` snippet |
| **GitHub Copilot** | [INSTALL/copilot.md](INSTALL/copilot.md) — workspace-context strategy |
| **ChatGPT / Claude.ai** | [INSTALL/chatgpt.md](INSTALL/chatgpt.md) — system-prompt template |
| **Any other tool** | [INSTALL/generic.md](INSTALL/generic.md) — generic markdown ingestion |

## Universal verification (every skill applies it)

The `arc-self-verify` skill defines an 8-dimension checklist every other skill invokes before returning code:

1. **Simplicity** — lines ≤ what the problem requires; no premature abstractions
2. **Time complexity** — state Big-O of new functions; flag ≥ O(n²)
3. **Space complexity** — state allocation pattern; flag persistent ≥ O(n) data
4. **Core Web Vitals** — LCP / CLS / INP / FCP impact analyzed
5. **Bundle bytes** — could `@build` or `@live` replace `@state` to ship 0 client bytes?
6. **Reversibility** — sensible default + explicit override
7. **Accessibility** — preserves Arc's defaults (alt, aria, focus-visible, skip-link)
8. **Type safety** — `@server fn` typed; `Result<T, E>` for fallible operations

## Format

Each skill is a single markdown file with optional YAML frontmatter for Claude Code auto-discovery. Other LLMs read the markdown body directly.

```markdown
---
name: skill-name
description: When the skill fires
---

# skill-name

**When to use:** ...
**Reference docs:** ...

## Pattern
[example]

## Anti-patterns
[common mistakes]

## Verification
Apply arc-self-verify + skill-specific checks
```

## Updating

These skills track Arc's compiler version. After any Arc source change that affects user-visible behavior, regenerate the distribution mirror:

```bash
bash scripts/build-llm-skills.sh
```

That refreshes `editor-extensions/llm-skills/<slug>.md` from the canonical `.claude/skills/<slug>/SKILL.md` files and rebuilds `all.md`.

## License

MIT — same as Arc.
