# Install: Continue.dev

Continue (VS Code, JetBrains) supports custom system prompts and context providers via `~/.continue/config.json`.

## Install

Edit `~/.continue/config.json` and add the Arc skills as a custom system message:

```json
{
  "models": [
    {
      "title": "Arc (Claude)",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "sk-..."
    }
  ],
  "systemMessage": "When working with .arc files, follow the Arc skills bundle at @file:.continue/arc-skills.md",
  "contextProviders": [
    { "name": "file", "params": { "includeFiles": [".continue/arc-skills.md"] } }
  ]
}
```

Then copy the bundle into your config dir:

```bash
mkdir -p ~/.continue
cp node_modules/arc-web/editor-extensions/llm-skills/all.md ~/.continue/arc-skills.md
```

## Project-specific install

For per-project Arc context (recommended), use `.continue/config.json` in your project root:

```json
{
  "systemMessage": "Follow Arc skills at @file:editor-extensions/llm-skills/all.md (or node_modules/arc-web/editor-extensions/llm-skills/all.md if installed via npm)."
}
```

Continue will prepend the skill bundle to every conversation in this project.

## Slash commands per skill

Continue supports custom slash commands. Wire one per Arc skill for explicit invocation:

```json
{
  "slashCommands": [
    {
      "name": "arc-new-page",
      "description": "Scaffold a new Arc page with SEO + a11y defaults",
      "prompt": "Following node_modules/arc-web/.claude/skills/arc-new-page/SKILL.md, create a new Arc page for: {{ input }}"
    },
    {
      "name": "arc-perf-audit",
      "description": "Audit pasted Lighthouse output for Arc-idiomatic fixes",
      "prompt": "Following node_modules/arc-web/.claude/skills/arc-perf-audit/SKILL.md, analyze this Lighthouse output: {{ input }}"
    }
    // ... etc
  ]
}
```

User can now type `/arc-new-page contact form` and Continue applies that exact skill.

## Verify

In a `.arc` file, ask Continue:

```
Add a form to submit a contact message to the server
```

Expected: code uses `@state` for fields, `@server fn` for submission, `Result<T, E>` for errors, `Email` field type — and Continue includes a verification block citing `arc-self-verify`.

## Updating

```bash
cp node_modules/arc-web/editor-extensions/llm-skills/all.md ~/.continue/arc-skills.md
```

Or wire up a postinstall hook in `package.json`:

```json
{
  "scripts": {
    "postinstall": "cp node_modules/arc-web/editor-extensions/llm-skills/all.md ~/.continue/arc-skills.md"
  }
}
```

## See also

- [Continue.dev docs](https://docs.continue.dev)
- [Arc skills catalog](../SKILLS.md)
