# Install: Any other code LLM

If your tool isn't covered by a dedicated INSTALL guide, this generic guide works for any LLM that accepts text input.

## The universal pattern

Every LLM accepts a system prompt or context preamble. The Arc skills bundle is a single markdown file:

```
editor-extensions/llm-skills/all.md  (~128 KB / ~32K tokens)
```

Paste it into whatever your tool calls "system prompt", "context", "instructions", or "preamble".

## For tools with a config file

Most tools (Codeium, Tabnine, Sourcegraph Cody, JetBrains AI Assistant, etc.) have a config file with a custom-instructions field. Format your install as:

```yaml
# pseudo-config
system_prompt: |
  <paste contents of all.md here>
```

OR reference the file:

```yaml
system_prompt_file: ./arc-skills.md
```

After install, your tool will apply Arc skills to every code generation in the project.

## For LLMs you control via API

If you're calling an LLM API directly (Anthropic SDK, OpenAI SDK, etc.), prepend the bundle to your system message:

```js
const skills = fs.readFileSync('node_modules/arc-web/editor-extensions/llm-skills/all.md', 'utf8')

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  system: skills + '\n\nYou are helping a developer write Arc code.',
  messages: [{ role: 'user', content: userPrompt }],
})
```

```python
import os
skills = open('node_modules/arc-web/editor-extensions/llm-skills/all.md').read()

response = client.messages.create(
  model='claude-sonnet-4-6',
  system=skills + '\n\nYou are helping a developer write Arc code.',
  messages=[{'role': 'user', 'content': user_prompt}],
)
```

## Per-skill loading (for tools with small context windows)

If your tool's context window is < 32K tokens, load only the skills you need:

```bash
# Working on forms
cat editor-extensions/llm-skills/arc-self-verify.md \
    editor-extensions/llm-skills/arc-style-guide.md \
    editor-extensions/llm-skills/arc-add-form.md \
    editor-extensions/llm-skills/arc-add-server-fn.md \
    > context.md

# Working on performance
cat editor-extensions/llm-skills/arc-self-verify.md \
    editor-extensions/llm-skills/arc-perf-audit.md \
    editor-extensions/llm-skills/arc-explain-bytes.md \
    > context.md
```

**Always include `arc-self-verify`** — every other skill references it.

## URL-based loading (for tools that fetch context)

The skills are hosted at:

```
https://github.com/arc-language/arc-web/tree/main/editor-extensions/llm-skills/
```

Tools that support URL-based context (some browser-based LLMs, agentic frameworks) can fetch:

```
https://raw.githubusercontent.com/arc-language/arc-web/main/editor-extensions/llm-skills/all.md
```

## Verify it's working

Ask your tool:

```
Create an Arc page that displays user data fetched from /api/me
```

Expected output uses:
- `page "Title"` (NOT `function Page()` or `<page>` tag)
- `@server fn getUser() -> User` (typed)
- `@live let user = getUser()` (server-rendered, not client fetch)
- Substitution via `{user.name}` (NOT React-style `{user.name}` in JSX)
- A verification block citing arc-self-verify dimensions

If you get React/Vue/JSX-flavored code, the bundle wasn't loaded into context — verify the install above.

## Updating

When Arc releases a new version, the skills update with the npm package:

```bash
npm update arc-web
# Re-load your tool's context with the new editor-extensions/llm-skills/all.md
```

## See also

- [Arc skills catalog](../SKILLS.md)
- [All bundled into one file](../all.md)
