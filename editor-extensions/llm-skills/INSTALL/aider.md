# Install: Aider

Aider supports `--read <file>` for read-only context files. Use it to load the Arc skills bundle into every Aider session.

## Install (single command)

```bash
# From your Arc project root
aider --read node_modules/arc-web/editor-extensions/llm-skills/all.md
```

Every subsequent Aider command in that session has the full Arc skill bundle in context.

## Persistent setup via .aider.conf.yml

Make Arc skills automatic for the project:

```yaml
# .aider.conf.yml (project root)
read:
  - node_modules/arc-web/editor-extensions/llm-skills/all.md
```

Now `aider` alone loads the skills automatically.

## Per-skill granularity

The full `all.md` is 128 KB. For session efficiency on small models or large refactors, load only the relevant skills:

```bash
# Working on a form?
aider --read node_modules/arc-web/editor-extensions/llm-skills/arc-self-verify.md \
      --read node_modules/arc-web/editor-extensions/llm-skills/arc-add-form.md \
      --read node_modules/arc-web/editor-extensions/llm-skills/arc-add-server-fn.md

# Debugging a checker error?
aider --read node_modules/arc-web/editor-extensions/llm-skills/arc-fix-checker-error.md \
      --read node_modules/arc-web/editor-extensions/llm-skills/arc-self-verify.md
```

`arc-self-verify` should always be loaded — every other skill references it.

## Verify

```bash
aider --read node_modules/arc-web/editor-extensions/llm-skills/all.md
> Create a counter widget in counter.arc
```

Expected: Aider opens `counter.arc`, writes:

```arc
@state let count = 0

main
  card
    text "{count}"
    button on:click={ @count += 1 } "+"
```

And mentions the `arc-self-verify` checklist (bundle bytes ~150 B, O(1) per click, no Core Vitals impact, etc.) before showing the diff.

## With cheap models

Aider works with any OpenAI-compatible API + local models via Ollama. For local models smaller than 8B, the 128 KB bundle may strain context. Two strategies:

1. **Use per-skill loading** (above) — only the skills you need
2. **Use a quantized larger model** — Qwen-2.5-32B-Instruct or Llama-3.1-70B at Q4 typically handles the full bundle

## Updating

```bash
# After Arc release
git -C node_modules/arc-web pull   # if installed via git
# OR
npm update arc-web                   # if installed via npm
```

The skills update with the npm package; no separate sync step.

## See also

- [Aider docs: --read flag](https://aider.chat/docs/usage/conventions.html)
- [Arc skills catalog](../SKILLS.md)
