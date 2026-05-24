# Install: GitHub Copilot

GitHub Copilot doesn't have a direct "system prompt" API like Cursor or Cline. Three workarounds:

## Strategy 1: Workspace-context file (Copilot Chat)

Copilot Chat reads files in your workspace as implicit context. Drop the Arc skills bundle into your repo:

```bash
cp node_modules/arc-web/editor-extensions/llm-skills/all.md docs/arc-skills.md
```

Then reference it in your Copilot prompts:

```
@workspace using docs/arc-skills.md, create a new Arc page for a contact form
```

Copilot reads `docs/arc-skills.md` and applies the patterns. Less automatic than Cursor/Cline but works.

## Strategy 2: Inline comment hints

Copilot's inline completion reads adjacent comments aggressively. Lead with a comment block:

```arc
// Arc skills: arc-new-page + arc-add-form + arc-self-verify
// Pattern: @state per field, @server fn typed with Result<T,E>, bind:value, form on:submit
page "Contact"
  <cursor here — Copilot completes following the hint>
```

The skills folder has snippets you can paste as comment blocks before triggering completion.

## Strategy 3: Custom instructions (Copilot Enterprise / Business)

Enterprise + Business plans support custom organization instructions via the GitHub Copilot admin panel. Paste the content of `all.md` there once; it applies to every repo in the org.

If you have access:
1. Go to your GitHub org's Copilot settings
2. "Custom instructions" → paste `editor-extensions/llm-skills/all.md`
3. Save

Now every developer in the org gets Arc skills automatically.

## Strategy 4: `.github/copilot-instructions.md` (Copilot 1.156+)

GitHub now supports a `.github/copilot-instructions.md` file that Copilot picks up automatically for the repo. This is the cleanest install:

```bash
mkdir -p .github
cp node_modules/arc-web/editor-extensions/llm-skills/all.md .github/copilot-instructions.md
```

Or symlink for auto-update:

```bash
ln -s ../node_modules/arc-web/editor-extensions/llm-skills/all.md .github/copilot-instructions.md
```

Copilot will apply Arc skills to all chat + completion sessions in this repo.

## Verify

In a `.arc` file, ask Copilot Chat:

```
@workspace add a counter
```

Expected: Copilot generates `@state let count = 0` + `@count += 1` pattern (NOT `let count = ...` + `count = count + 1`).

If you see the wrong pattern, the skills aren't being picked up — verify the install above.

## Limitations

- Copilot Chat's context loading is less explicit than Claude Code / Cline. Sometimes a long workspace means Copilot doesn't reach the skills file.
- Inline completion (Tab) has shorter context than Chat — it benefits from comment hints (Strategy 2).
- Enterprise custom instructions are the most reliable but require the right plan.

## See also

- [GitHub Copilot docs](https://docs.github.com/en/copilot)
- [Copilot custom instructions](https://docs.github.com/en/copilot/customizing-copilot/about-customizing-github-copilot-chat-responses)
- [Arc skills catalog](../SKILLS.md)
