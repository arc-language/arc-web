#!/usr/bin/env bash
# Regenerate llms-full.txt from all docs. Run from arc/docs/.
set -euo pipefail
cd "$(dirname "$0")"

OUT=llms-full.txt

cat > "$OUT" <<'HEAD'
# Arc — Complete Documentation (LLM single-file context)

> Arc compiles `.arc` source into hand-tuned HTML, CSS, and JavaScript. Zero framework runtime, zero production dependencies.

This file concatenates every Arc documentation page into a single LLM-ingestible source. Each section begins with `## <relative-path>` so links and references are unambiguous.

HEAD

# Concatenate in a deterministic order matching docs/README.md
declare -a PAGES=(
  "getting-started/installation.md"
  "getting-started/first-page.md"
  "getting-started/concepts.md"
  "language/syntax.md"
  "language/data-contexts.md"
  "language/structure.md"
  "language/design-vocabulary.md"
  "language/logic.md"
  "language/reactive.md"
  "language/types.md"
  "language/stdlib.md"
  "features/seo.md"
  "features/images.md"
  "features/edge-rendering.md"
  "features/realtime.md"
  "features/multi-page.md"
  "features/deployment.md"
  "features/accessibility.md"
  "reference/cli.md"
  "reference/configuration.md"
  "reference/compile-api.md"
  "reference/adp.md"
  "reference/errors.md"
  "guides/migrating-from-react.md"
  "guides/migrating-from-astro.md"
  "guides/migrating-from-vanilla.md"
  "recipes/auth-flow.md"
  "recipes/forms.md"
  "recipes/routing.md"
  "recipes/dark-mode.md"
  "recipes/interactive-list.md"
  "recipes/api-fetching.md"
  "recipes/progressive-disclosure.md"
  "internals/pipeline.md"
  "internals/emitters.md"
  "internals/optimizer.md"
  "internals/image-pipeline.md"
  "internals/contributing.md"
  "showcase.md"
  "comparisons.md"
)

for page in "${PAGES[@]}"; do
  if [[ ! -f "$page" ]]; then
    echo "WARN: missing $page" >&2
    continue
  fi
  printf '\n\n---\n\n## %s\n\n' "$page" >> "$OUT"
  cat "$page" >> "$OUT"
done

echo ""
echo "Generated $OUT:"
wc -c "$OUT"
echo "Pages: ${#PAGES[@]}"
