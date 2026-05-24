# Install: ChatGPT / Claude.ai (chat-based LLMs)

For browser-based chat LLMs (ChatGPT, Claude.ai, Gemini, etc.), paste the Arc skills bundle into the system prompt / custom instructions / project context.

## ChatGPT (with Custom Instructions or Projects)

1. Open ChatGPT
2. Settings → "Custom Instructions" (or create a "Project" for Arc-specific work)
3. In "How would you like ChatGPT to respond?", paste the content of `editor-extensions/llm-skills/all.md`:

   ```bash
   # Print + copy
   cat node_modules/arc-web/editor-extensions/llm-skills/all.md | pbcopy   # macOS
   cat node_modules/arc-web/editor-extensions/llm-skills/all.md | xclip    # Linux
   ```

4. Save

ChatGPT now applies Arc skills + verification on every conversation in that scope (Project or global).

## Claude.ai (with Projects)

1. Create a new Project in Claude.ai
2. In "Project knowledge" / system prompt, paste `all.md`
3. Every chat in that project has Arc context

## Gemini

1. Open Gemini
2. Settings → "Custom Instructions"
3. Paste `all.md`

## Token budget

The full `all.md` is ~128 KB ≈ 32K tokens. This fits comfortably in:

| Model | Context | Fit? |
| --- | --- | --- |
| Claude Opus 4.7 | 1M | ✓ (3% of context) |
| Claude Sonnet 4.6 | 200K | ✓ (16% of context) |
| GPT-5 (when available) | TBD | likely ✓ |
| GPT-4o | 128K | ✓ (25% of context) |
| GPT-3.5 / GPT-4 (legacy) | 16-32K | ✗ — use subset |
| Gemini 2.5 | 1M+ | ✓ |
| Local 7B (Ollama Llama) | 8-16K | ✗ — use single-skill files |

For tight context, drop in only the skills you need:

```bash
# Just the verification + form-related skills (~15 KB)
for f in arc-self-verify arc-style-guide arc-add-form arc-add-state arc-add-server-fn; do
  cat node_modules/arc-web/editor-extensions/llm-skills/$f.md
  echo "\n---\n"
done | pbcopy
```

## Verify

Paste a prompt:

```
Create an Arc page with a contact form. Email field, message field, submit button.
```

Expected response:
- Page declaration with SEO meta
- `@state` for each field with `bind:value`
- `@server fn` with typed `Result<T, E>` return
- `on:submit` handler with `match` on the result
- A verification block at the end citing arc-self-verify (Big-O, Core Vitals, bundle bytes)

If the LLM produces React/Vue/JSX-flavored code, the skills weren't loaded — repaste into the system prompt.

## Updating

When Arc releases a new version:
1. Update your local Arc install (`npm update -g arc-web` or `git pull`)
2. Re-copy `all.md` into your custom instructions

A simple shell function:

```bash
arc-update-chatgpt() {
  cat node_modules/arc-web/editor-extensions/llm-skills/all.md | pbcopy
  echo "Copied. Paste into ChatGPT Settings → Custom Instructions."
}
```

## See also

- [ChatGPT Custom Instructions](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions-faq)
- [Claude.ai Projects](https://www.anthropic.com/news/projects)
- [Arc skills catalog](../SKILLS.md)
