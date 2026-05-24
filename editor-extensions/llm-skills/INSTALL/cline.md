# Install: Cline (VS Code)

Cline reads "Custom Instructions" from its settings panel — paste the Arc skills bundle there.

## Install

1. Open VS Code
2. Click the Cline icon in the activity bar
3. Click the ⚙ (Settings) gear icon in the Cline panel
4. Find "Custom Instructions" section
5. Paste the content of `editor-extensions/llm-skills/all.md`:

   ```bash
   # Print to clipboard
   cat node_modules/arc-web/editor-extensions/llm-skills/all.md | pbcopy   # macOS
   cat node_modules/arc-web/editor-extensions/llm-skills/all.md | xclip    # Linux
   ```

6. Save settings

Cline now has all 22 Arc skills + the universal verification checklist in its system prompt for every conversation.

## Alternative: project-level instructions

Cline also reads `.clinerules` from your workspace root (Cline 2.0+). This is preferred for project-specific instructions vs your global Cline settings.

```bash
cp node_modules/arc-web/editor-extensions/llm-skills/all.md .clinerules
```

Project-level instructions override global instructions, so this isolates Arc context to projects that need it.

## Verify

Open a `.arc` file. Ask Cline:

```
Create a dashboard page that fetches user data from /api/me
```

Expected behavior:
- Cline asks no clarifying questions (the skills cover this)
- Uses `@server fn getUser()` + `@live let user = getUser()` (NOT client-side fetch)
- Adds typed signature: `-> User`
- Runs `arc-self-verify` checklist before returning, callouts in comments

## Updating

```bash
# After arc-web release
cp node_modules/arc-web/editor-extensions/llm-skills/all.md .clinerules
```

Or watch the Arc GitHub releases page; the skills bundle is published with each tag.

## Notes

- Cline supports any model with custom instructions (Claude, GPT, Gemini, local models via Ollama). The skills are model-agnostic markdown.
- For very small models (< 7B), the 128 KB `all.md` may exceed context. Use a subset — e.g., just `arc-self-verify.md` + the authoring skills you actually use.

## See also

- [Cline GitHub](https://github.com/cline/cline)
- [Arc skills catalog](../SKILLS.md)
