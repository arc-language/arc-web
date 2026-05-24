#!/usr/bin/env bash
# Build the flat mirror + concatenated all.md from the canonical Claude Code
# skill files at .claude/skills/<slug>/SKILL.md.
#
# Run from the repo root.
#
# Outputs:
#   editor-extensions/llm-skills/<slug>.md         flat per-skill files
#   editor-extensions/llm-skills/all.md            single-file concat (all skills)
#   editor-extensions/llm-skills/SKILLS.md         index + brief catalog
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.claude/skills"
OUT="$ROOT/editor-extensions/llm-skills"

mkdir -p "$OUT"

# 1. Flat mirror
for dir in "$SRC"/*/; do
  [ -d "$dir" ] || continue
  slug=$(basename "$dir")
  src_file="$dir/SKILL.md"
  if [ ! -f "$src_file" ]; then
    echo "WARN: missing $src_file" >&2
    continue
  fi
  cp "$src_file" "$OUT/$slug.md"
done

# 2. Catalog index (SKILLS.md)
cat > "$OUT/SKILLS.md" <<'HEAD'
# Arc LLM Skills — Catalog

| Skill | When it fires |
| --- | --- |
HEAD

for f in "$OUT"/arc-*.md; do
  slug=$(basename "$f" .md)
  # Extract `description:` from frontmatter
  desc=$(awk '/^description:/ {sub(/^description:[[:space:]]*/,""); print; exit}' "$f")
  echo "| [\`$slug\`]($slug.md) | $desc |" >> "$OUT/SKILLS.md"
done

# 3. Concatenated all.md (single file for LLM context paste)
cat > "$OUT/all.md" <<'HEAD'
# Arc — Full LLM Skills Bundle

This file concatenates every Arc skill into one document. Paste into the system prompt of any LLM (ChatGPT, Claude.ai, etc.) to teach it Arc patterns.

For tool-specific integration, see `INSTALL/<tool>.md`.

---

HEAD

# Meta skills first (referenced by every other), then alphabetical
for f in "$OUT/arc-self-verify.md" "$OUT/arc-style-guide.md"; do
  [ -f "$f" ] || continue
  slug=$(basename "$f" .md)
  printf '\n\n---\n\n## %s\n\n' "$slug" >> "$OUT/all.md"
  cat "$f" >> "$OUT/all.md"
done

for f in $(ls "$OUT"/arc-*.md | grep -vE "(arc-self-verify|arc-style-guide)\.md$" | sort); do
  slug=$(basename "$f" .md)
  printf '\n\n---\n\n## %s\n\n' "$slug" >> "$OUT/all.md"
  cat "$f" >> "$OUT/all.md"
done

echo ""
echo "Build complete:"
echo "  Per-skill files: $(ls "$OUT"/arc-*.md | wc -l)"
echo "  Catalog:         $OUT/SKILLS.md"
echo "  Concat all.md:   $(wc -c < "$OUT/all.md") bytes"
