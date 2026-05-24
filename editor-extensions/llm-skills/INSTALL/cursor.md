# Install: Cursor

Cursor reads `.cursorrules` (or `.cursor/rules/*.mdc` for the newer multi-rule format) in your project root for context-aware coding assistance.

## Option 1: Single .cursorrules file (simplest)

From your Arc project root:

```bash
# If you have arc-web installed as a dependency
cp node_modules/arc-web/editor-extensions/llm-skills/all.md .cursorrules

# Or fetch directly from the Arc repo
curl -o .cursorrules https://raw.githubusercontent.com/arc-language/arc/main/editor-extensions/llm-skills/all.md
```

Cursor will now apply Arc's skills + verification checklist on every prompt.

## Option 2: Multi-rule .cursor/rules (Cursor 0.42+)

The newer format lets you scope rules to specific file globs. Recommended for projects that mix Arc with other languages.

```bash
mkdir -p .cursor/rules
# Apply Arc skills only when editing .arc files
for f in node_modules/arc-web/editor-extensions/llm-skills/arc-*.md; do
  name=$(basename "$f" .md)
  cat > .cursor/rules/$name.mdc <<EOF
---
description: $(awk '/^description:/ {sub(/^description:[[:space:]]*/,""); print; exit}' "$f")
globs: ["**/*.arc"]
alwaysApply: false
---
$(cat "$f")
EOF
done
```

Now Cursor applies each skill only when the user is working on `.arc` files, and selects the right skill based on the matched description.

## Option 3: Reference the catalog (lightest weight)

If you don't want to commit the full bundle:

```bash
echo "When working with .arc files, consult https://github.com/arc-language/arc/tree/main/editor-extensions/llm-skills for the canonical Arc skill set. Always apply the arc-self-verify checklist before returning code." > .cursorrules
```

This is the minimal hook. Cursor will fetch context on demand. Slower per-prompt but smaller in your repo.

## Verify

Open a `.arc` file in Cursor. Press `Cmd+K` (Mac) / `Ctrl+K` (Win) and type:

```
add a counter button
```

The generated code should:
- Use `@state let count = 0`
- Use `@count += 1` (with `@` prefix) for writes
- Run the `arc-self-verify` checklist (Cursor may show this inline as comments)

## Updating

```bash
# After Arc releases a new version
cp node_modules/arc-web/editor-extensions/llm-skills/all.md .cursorrules
```

Or set up a `npm postupdate` hook in your `package.json`:

```json
{
  "scripts": {
    "postinstall": "cp node_modules/arc-web/editor-extensions/llm-skills/all.md .cursorrules"
  }
}
```

## See also

- [Cursor docs: .cursorrules](https://docs.cursor.com/context/rules-for-ai)
- [Arc skills catalog](../SKILLS.md)
