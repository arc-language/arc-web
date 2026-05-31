<img src="../packages/arc-cms/src/public/logo.png" alt="Arc" width="80">

# Arc Documentation

Complete reference for the [Arc compiler](../README.md). Start with [Getting Started](#getting-started) if you've never used Arc; jump to [Reference](#reference) if you have.

> **For LLMs:** start with [`llms.txt`](llms.txt) for a clean index, or [`llms-full.txt`](llms-full.txt) for everything in one file.

---

## Getting Started

| Doc | What it covers |
| --- | --- |
| [Installation](getting-started/installation.md) | npm install, system requirements, optional `sharp` for images |
| [Your First Page](getting-started/first-page.md) | 5-minute tutorial: hello → counter → data-driven |
| [Core Concepts](getting-started/concepts.md) | The four data contexts; mental model from React/Astro |

## Language Reference

| Doc | What it covers |
| --- | --- |
| [Syntax + EBNF](language/syntax.md) | Complete grammar with formal EBNF |
| [Data Contexts](language/data-contexts.md) | `@build`, `@state`, `@computed`, `@live`, `@realtime`, `@server`, `@worker`, `@session` |
| [Structure](language/structure.md) | `page`, `widget`, `design`, `import` blocks; element vocabulary |
| [Design Vocabulary](language/design-vocabulary.md) | Complete CSS-equivalent reference |
| [Logic + Control Flow](language/logic.md) | `match`, `for`, `unless`, `until`, pipeline, `Result` |
| [Reactive](language/reactive.md) | `bind:value`, `on:click`, the computed dependency graph |
| [Types](language/types.md) | Primitives, classes, generics, `Result`, `none` vs `null` |
| [Standard Library](language/stdlib.md) | `router`, `store`, `fetch`, `form`, `icons` |

## Features

| Doc | What it covers |
| --- | --- |
| [SEO + Structured Data](features/seo.md) | Canonical, OG, Twitter, JSON-LD; auto-sitemap |
| [Image Pipeline](features/images.md) | AVIF/WebP/JPEG, smart format selection, dedup |
| [Edge Rendering](features/edge-rendering.md) | `@live` + `@server`; targets; streaming |
| [Realtime](features/realtime.md) | `@realtime` channels; ADP binary frames |
| [Backend HTTP Server](reference/cli.md#arc-build-server-dir) | `@route`, `@auth`, `arc/db` models, background `job`s — compiles to Bun or Cloudflare Workers |
| [Multi-page Sites](features/multi-page.md) | `arc build-site`, shared CSS, prefetch, View Transitions |
| [Deployment](features/deployment.md) | `_headers`, sitemap, Cloudflare / Netlify / Bun / Deno / Node |
| [Accessibility](features/accessibility.md) | Skip link, sr-only, `prefers-reduced-motion`, ARIA defaults |

## Reference

| Doc | What it covers |
| --- | --- |
| [CLI](reference/cli.md) | Every command + every flag |
| [Configuration](reference/configuration.md) | `arc.config.json` schema |
| [Compile API](reference/compile-api.md) | Programmatic `compile()` function |
| [ADP — Arc Data Protocol](reference/adp.md) | Binary wire format spec |
| [Error Catalog](reference/errors.md) | Every emitted error + fix |

## Guides

| Doc | What it covers |
| --- | --- |
| [Migrating from React](guides/migrating-from-react.md) | Hooks → `@state`; `useEffect` → `@live`; etc. |
| [Migrating from Astro](guides/migrating-from-astro.md) | Frontmatter → `@build`; `Image` → `img` |
| [Migrating from Vanilla HTML](guides/migrating-from-vanilla.md) | Progressive enhancement story |

## Recipes

| Doc | Pattern |
| --- | --- |
| [Auth Flow](recipes/auth-flow.md) | `@session` + `@live` + form |
| [Forms](recipes/forms.md) | Validation, `bind:value`, submit handlers |
| [Routing](recipes/routing.md) | Multi-page + prefetch + View Transitions |
| [Dark Mode](recipes/dark-mode.md) | `@dark` in design block + system preference |
| [Interactive List](recipes/interactive-list.md) | `@state` + `@computed` filtering |
| [API Fetching](recipes/api-fetching.md) | `@build` vs `@live` vs `@server` |
| [Progressive Disclosure](recipes/progressive-disclosure.md) | Accordion, tooltip, modal — zero JS |

## Community

| Doc | What it covers |
| --- | --- |
| [Showcase](showcase.md) | Sites and apps built with Arc — submit yours |
| [Comparisons](comparisons.md) | Honest side-by-side: Arc vs React/Next, Astro, SvelteKit, Vanilla |

## Internals

| Doc | What it covers |
| --- | --- |
| [Compile Pipeline](internals/pipeline.md) | Lexer → Parser → Checker → @build → Optimizer → Emit |
| [Emitters](internals/emitters.md) | HTML / CSS / JS emitter contracts |
| [Optimizer](internals/optimizer.md) | Static loop unrolling, dead code elimination |
| [Image Pipeline](internals/image-pipeline.md) | F1–F5 implementation details |
| [Contributing](internals/contributing.md) | Test layout, coverage rules, PR checklist |
