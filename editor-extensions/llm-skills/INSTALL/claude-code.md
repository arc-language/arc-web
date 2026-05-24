# Install: Claude Code

Claude Code auto-discovers skills in `.claude/skills/<slug>/SKILL.md`. **No install required** — the skills ship with the Arc repo.

## How it works

When you open the Arc repo (or any project that has copied the `.claude/skills/` directory) in Claude Code:

1. Claude Code reads every `SKILL.md` file at startup
2. The frontmatter `description` is used for skill matching against user requests
3. When the user's prompt matches a skill's trigger description, Claude Code automatically loads that skill's content into context BEFORE generating code

## Verify it's working

```bash
cd /path/to/arc
claude
> /help
```

You should see Arc skills listed (`arc-new-page`, `arc-add-state`, etc.) in the available skills section.

Then test:
```
> create a new Arc page for a contact form
```

Claude Code should pick up `arc-new-page` + `arc-add-form` automatically and follow their patterns + verification checklists.

## Use the skills in your own Arc project

Two options:

### Option 1: Copy the skills directory
```bash
cp -r path/to/arc/.claude/skills /path/to/your-arc-project/.claude/skills
```

Your project now has the same skills as the Arc compiler repo.

### Option 2: Reference via symlink (auto-update on Arc upgrades)
```bash
ln -s $(npm root -g)/arc-web/.claude/skills /path/to/your-arc-project/.claude/skills
```

When you `npm update -g arc-web`, the skills update too.

### Option 3: Reference via the npm package directly

If your Arc project has `arc-web` installed locally:
```bash
ln -s ./node_modules/arc-web/.claude/skills .claude/skills
```

## Customize

If you want to add project-specific skills alongside Arc's, just add a new directory:

```
.claude/skills/
├── arc-new-page/SKILL.md       # from Arc
├── arc-add-state/SKILL.md      # from Arc
└── my-project-deploy/SKILL.md  # your own
```

Claude Code merges them — your custom skills coexist with Arc's.

## Updating

```bash
bash scripts/build-llm-skills.sh
```

Run from the Arc repo root after any skill edits. This refreshes the flat mirrors at `editor-extensions/llm-skills/<slug>.md` (used by other LLM tools).

## See also

- [Claude Code documentation](https://docs.claude.com/en/docs/claude-code)
- [Arc skills catalog](../SKILLS.md)
- [Universal `all.md` bundle](../all.md) — for tools that prefer one-paste
