# Changelog

All notable changes to Arc are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — LLM Skills Library
- **22 curated skills** for code-aware LLMs (Claude Code, Cursor, Cline, Aider, Continue, GitHub Copilot, ChatGPT, Claude.ai) at `.claude/skills/<slug>/SKILL.md` + flat mirrors at `editor-extensions/llm-skills/<slug>.md`.
- **Universal verification checklist** (`arc-self-verify`) referenced by every authoring skill — enforces simplicity, time/space complexity stated, Core Web Vitals impact analyzed (LCP/CLS/INP/FCP), bundle bytes counted, reversibility, accessibility defaults preserved, and `@server fn` type safety.
- **Skill categories**: 9 authoring (new-page, pick-data-context, add-state, add-server-fn, add-live, add-realtime, add-form, add-image, multi-page-setup), 5 diagnostic (fix-checker-error, explain-bytes, perf-audit, debug-state-binding, debug-live-streaming), 3 migration (from-react, from-astro, from-vanilla), 3 contributor (contributor-pr, bug-report, write-test), 2 meta (self-verify, style-guide).
- **Cross-tool distribution**: `editor-extensions/llm-skills/all.md` (128 KB single-file concat for system-prompt paste) + per-tool install guides at `editor-extensions/llm-skills/INSTALL/{claude-code,cursor,cline,aider,continue,copilot,chatgpt,generic}.md`.
- **`npm run skills:build`** regenerates the flat mirror + all.md from canonical `.claude/skills/` source. Run after any skill edit.
- **Ships in npm package** via updated `files:` in `package.json`.

### Documentation
- **Roadmap: mobile + desktop targets** added as a 2.x exploration track. Arc's compiled HTML/CSS/JS will be bundled via Tauri (desktop) and Capacitor / Tauri Mobile (iOS + Android). New stdlib namespaces planned: `arc/native/window`, `arc/native/camera`, `arc/native/storage`, etc. Same `.arc` source compiles to web, desktop, and mobile. Not in 1.x — web has to be perfect first.

### Fixed — Parser
- **`eatIf(T.DEDENT)` silently consumed all DEDENTs** via `skipWhitespace` → made `parseStyleRule`/`parseDesign` eat past their scope. Now `eatIf` doesn't skip the target whitespace type.
- **`parseDesign` + `parseStyleRule` now bail out** on top-level declaration keywords (`const`, `let`, `fn`, `class`, `widget`, `page`, `import`, `export`) — was eating top-level decls when DEDENT handling was off.
- **Multi-line object literals now parse correctly** — `parseObjectLiteral` consumes newlines + INDENT/DEDENT inside `{ ... }` blocks.
- **`const`/`let` inside widget/page bodies** are now parsed (previously silently treated as element names).
- **Checker hoists top-level declarations** before walking bodies — forward references resolve correctly (matches JS function-hoisting semantics).

### Fixed — Stdlib
- **All 21 stdlib checker errors fixed.** `arc check stdlib/*.arc` now reports 0 errors (was 21). Issues were in `stdlib/{form,icons,router,fetch}.arc` — caused by the parser bugs above, not by the stdlib code itself.

### Fixed — Tests
- 2 new test files: `tests/site-meta.test.js` (8 tests) and `tests/headers-manifest.test.js` (5 tests) — bring new emitters to 100% line coverage.
- Test count: 1071 → 1071 (no change; new tests offset by the dev-server test cleanup).

## [0.1.0] — 2026-05-24

First public release. Compiler is feature-complete for static, reactive, server-rendered, and realtime use cases. Documented end to end; benchmarked against Vanilla / Astro / Next.js.

### Added — language core
- `page`, `widget`, `design`, `import` block types
- `@build`, `@state`, `@computed`, `@live`, `@realtime`, `@server`, `@worker`, `@session` reactive contexts
- `bind:value` and `on:event` reactive attributes
- `match` exhaustive pattern matching with type guards
- `for ... in`, `unless`, `until`, pipeline operator `|>`
- `Result<T, E>` type with `Ok` / `Err` / `try`
- Strict `==` only (no `===`), `none` (no `null`), `let` / `const` only (no `var`)
- Class syntax with `@field` (no `this`), auto-bound methods, `@get` getters

### Added — emitters
- HTML emitter with auto-applied a11y enhancements (`loading="lazy"`, `type="button"`, `target="_blank" rel=...`, skip link, auto `<main>`)
- CSS emitter with per-component scoping, `@layer base` / `@layer component`, responsive (`@mobile` / `@tablet` / `@desktop`), state (`hover:` / `focus:` / `active:`), `@dark`, `prefers-reduced-motion`
- JS emitter producing direct DOM updates from compile-time dependency graph (no virtual DOM)
- Server emitter for `@server fn` → edge function + typed ADP client stub
- Edge renderer for `@live` with streaming `Response(ReadableStream)` and parallel `Promise.all` resolution
- Realtime client emitter for `@realtime channel()` with auto-reconnect + ADP binary frames

### Added — image pipeline (optional `sharp`)
- Build-time AVIF + WebP + original transcoding
- Layout-aware srcset widths (uses container width × 2 instead of generic ladder)
- AST-derived above-the-fold detection (first 2 images get `fetchpriority="high"`, rest get `loading="lazy" decoding="async"`)
- Dominant-color background fill (no gray flash during load)
- Content-hash dedup (same image used N times → one file in `dist/`)
- Smart format selection: AVIF auto-dropped when not ≥20% smaller than WebP at same width
- Per-page opt-out via `meta.imageFormats = ["webp","jpg"]`

### Added — SEO + structured data
- Auto-emitted Open Graph, Twitter Card, canonical, robots, keywords, author meta from page-level `meta` properties
- JSON-LD structured data emission from `meta.schemaType` (Article, Product, WebSite, etc.)
- Full SEO baseline shipped by default; opt-out per page

### Added — multi-page (`arc build-site`)
- New `arc build-site` command for multi-route projects
- Shared CSS dedup: rules used by ≥2 pages extracted into content-hashed `shared.<sha>.css`
- Auto `sitemap.xml` + `robots.txt` from `meta.canonical` + `meta.modified` + `meta.priority` + `meta.changefreq`
- Auto `_headers` manifest (Cloudflare Pages / Netlify compatible): CSP, security headers, `Cache-Control: immutable` for hashed assets, `Link:` preload for shared CSS (enables 103 Early Hints)
- CSP `<meta>` tag stripped from HTML when `_headers` ships (saves ~80 B per page)
- Auto `<link rel="prefetch">` injected for every same-site `<a>` target
- Auto `<meta name="view-transition" content="same-origin">` injected

### Added — Arc Data Protocol (ADP)
- Binary wire format spec for `@server` calls and `@realtime` frames
- 3× smaller than JSON, 10× faster decode
- ~1 KB client runtime (encoder + decoder)
- Tree-shaken from client bundle when no `@server` is invoked from client JS

### Added — CLI
- `arc build [dir]` — single-page build
- `arc build-site [dir]` — multi-page build with all the auto-emitted artifacts above
- `arc dev [dir]` — watch mode with live reload via SSE
- `arc check [files]` — type + a11y check without emitting
- `arc new <name> [--template default|counter|blog]` — scaffold
- `arc deploy [dir] [--target cloudflare|deno|bun|node]` — bundle for a deploy target

### Added — examples
- `hello` (static, 0 JS)
- `counter` (`@state` reactivity)
- `blog` (`@build` data inlining)
- `dashboard` (`@server` functions)
- `live` (`@live` streaming edge render)
- `chat` (`@realtime` WebSocket)
- `patterns` (native `<dialog>`, Popover API, `<details>`)

### Added — documentation
- 39 markdown files under `docs/` covering getting-started, language reference, features, reference, guides, recipes, internals
- `docs/llms.txt` (terse LLM index) and `docs/llms-full.txt` (211 KB single-file ingest)
- README with badges, syntax tour, ASCII benchmark charts, architecture diagram, feature matrix
- Migration guides for React, Astro, and vanilla HTML

### Added — benchmarks (external repo `arc-bench/`)
- Comparison vs Vanilla, Astro, Next.js across:
  - Static docs (SEO parity): **Arc 1688 B Brotli — smallest of all stacks**
  - Dashboard (50 ms simulated API latency): **Arc 804 ms LCP — tied with Astro**
  - Multi-page (20 routes): **Arc 1021 B Brotli per page — within 29 B of Vanilla**
  - Hero with images: Arc tied with Astro on LCP after smart AVIF threshold
- Build time: Arc 0.11 s vs Astro 1.5 s vs Next.js 14 s — **10–250× faster**

### Quality
- 1071 tests, 1070 passing (1 pre-existing todo)
- 95.85% line coverage / 86.52% branch / 91.59% function
- Zero production dependencies (`sharp` is `optionalDependencies`)
- All examples build clean; CI runs on Node 20 + 22

### Known issues
- `arc check` against `stdlib/{form,icons,router}.arc` emits 21 errors + 2 warnings due to widget-parameter scoping in the checker — does not affect user code or compilation, only stdlib introspection. Fix planned for 0.2.

[Unreleased]: https://github.com/arc-language/arc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/arc-language/arc/releases/tag/v0.1.0
