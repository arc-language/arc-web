# Roadmap

What's coming for Arc. Items are grouped by release; ordering inside each version is informal. Suggestions and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

This roadmap is updated when meaningful work lands. For everything that's already shipped, see [CHANGELOG.md](CHANGELOG.md).

---

## 0.2 — polish + adoption (next minor)

- **Fix stdlib checker errors.** `arc check` against `stdlib/{form,icons,router}.arc` emits 21 false positives. Either teach the checker about widget-parameter scoping, or annotate stdlib widgets explicitly.
- **Layout-aware srcset widths (real implementation).** The image pipeline F2 currently falls back to the generic ladder because the AST walker doesn't yet derive container widths from `design` blocks. Plumb the design-block width-resolver into `collectImgRefs`.
- **`arc fmt` formatter.** Canonical formatting for `.arc` files. Reuses the lexer + parser, emits normalized whitespace + indentation. ~300 lines.
- **CSS value minification.** `oklch(60% 0.15 250)` → hex; `0.5em` → `.5em`; collapse-able hex (`#aabbcc` → `#abc`). Adds ~30-80 B savings per stylesheet.
- **Shorter scoped class names.** Currently `arc-card_1g18` (10 chars). Switch to sequential `c0`, `c1`, ... allocation when collision-free. ~50 B raw saved per page.
- **`arc dev` improvements.** HMR for design blocks (no full page reload on CSS-only changes); error overlay in the browser; better fail-fast on syntax errors.

## 0.3 — DX investments

- **VS Code extension.** Syntax highlighting + brace matching + snippets. Ships as `editor-extensions/vscode/` in this repo; published to the Marketplace. Scaffold landed in 0.1.
- **Treesitter grammar.** Standalone `tree-sitter-arc` repo. Enables GitHub linguist registration + Neovim + Helix support. Scaffold landed in 0.1.
- **LSP server.** Standalone `arc-lsp` repo. Diagnostics from the existing checker; go-to-definition for widget invocations; auto-import suggestions.
- **`arc playground`.** Browser-based "try Arc" tool — paste source, see HTML/CSS/JS output side-by-side. Implementable as a Cloudflare Worker or by compiling the compiler to WASM.
- **GitHub linguist registration.** Open the PR to [github-linguist/linguist](https://github.com/github-linguist/linguist) to make `.arc` syntax-highlight on GitHub.

## 0.4 — production features

- **Auto Service Worker.** Compiler knows route graph + asset hashes. Emit a SW that caches all routes on install + prefetches likely-next on idle. No competitor framework auto-generates SWs.
- **Critical-CSS by viewport, not by layer.** Today's inliner ships the whole `@layer base` + `@layer component`. Analyze which selectors match nodes above the first `<section>` and inline only those. ~30% inlined-CSS reduction on deep pages.
- **103 Early Hints in edge renderer.** `@live` edge worker emits a 103 response with preload hints for shared CSS before computing data. Real win on production networks.
- **Brotli pre-compression to `.html.br`.** Static-build option: emit pre-compressed `.html.br` / `.css.br` / `.js.br` alongside originals so CDNs can serve without runtime compression cost.
- **Image content-aware compression.** Detect photo vs illustration vs screenshot per image; pick optimal codec settings per category.

## 0.5 — stdlib expansion

- **`arc/auth`** — session helpers, OAuth, magic-link flows.
- **`arc/markdown`** — MDX-style mixed markdown + Arc widgets at build time.
- **`arc/db`** — minimal typed query builder for `@server` fns. Maps to D1 / Postgres / SQLite.
- **`arc/i18n`** — compile-time message extraction + per-locale builds.
- **`arc/analytics`** — privacy-first event collection (no third-party JS).

## 1.0 — stable

Once 0.2-0.5 ship and the API has settled:

- **Stable syntax + semver guarantees.** No breaking changes within 1.x. Major version bumps only for hard breaking changes.
- **Long-term support.** Every 1.x minor receives security fixes for 12 months after the next minor ships.
- **Comprehensive comparison page.** `docs/comparisons.md` covers Arc vs every major competitor with benchmarks current as of 1.0.
- **First conference talk / blog series.** Move from "interesting project" to "interesting + actively maintained framework."

---

## 2.0+ — Beyond the browser (exploratory)

Arc's compiled output is plain HTML/CSS/JS. That makes it well-suited to webview-based native shells without changing the compiler's core. Strategy under exploration:

### Desktop (`arc build --target desktop`)
- Bundle Arc's output inside a [Tauri](https://tauri.app) shell — same `.arc` source, ~3 MB executable, native window chrome
- New stdlib: `arc/native/window`, `arc/native/fs`, `arc/native/notifications`, `arc/native/menu`
- Use `@server` functions to bridge to native Rust APIs via Tauri's IPC layer

### Mobile (`arc build --target mobile`)
- [Capacitor](https://capacitorjs.com) or [Tauri Mobile](https://tauri.app/blog/tauri-mobile-alpha/) shell — iOS + Android
- New stdlib: `arc/native/camera`, `arc/native/geolocation`, `arc/native/storage`, `arc/native/biometric`
- Output `.ipa` (iOS) and `.aab` (Android) signed builds via host SDKs

### What stays the same
- The Arc language. Your `.arc` source compiles to web, desktop, AND mobile.
- The emitted HTML/CSS/JS. The native shell just provides a webview + native APIs.
- The build pipeline. `arc build` learns new targets; existing targets unchanged.

### What's new
- Platform-conditional code: `@platform("ios")`, `@platform("desktop")`, etc. — compiled-out for other targets
- Native API stdlib modules — auto-stubbed for web target (graceful no-op or fallback)
- Build tooling: Xcode + Android SDK integration for mobile signing/upload

### Honest constraints
- **Not native UI.** Mobile/desktop output runs in a webview. For full native widget rendering (SwiftUI / Jetpack Compose / AppKit), Arc would need entirely new emitters — much bigger scope, sacrificing the "same source everywhere" property.
- **Bundle size starts at ~3 MB** (Tauri) or ~30 MB (iOS WKWebView app baseline). Far larger than Arc's web output, but typical for native apps.
- **Platform store rules apply.** Apple's [WebKit-only mandate](https://developer.apple.com/news/?id=jxky8h89) is satisfied. Android allows any webview.

### When
Post-1.0 stable web. Mobile/desktop is a 2.x track, not a 1.x feature. Web has to be perfect before we split focus.

## Not on the roadmap (deliberately)

These have been raised and rejected as misaligned with Arc's design:

- **React/Vue/Svelte adapter (run other frameworks inside Arc).** Use Astro if you need this. Arc is its own language.
- **Server-side state across requests.** That's a database's job. Use `@server fn` to call your DB.
- **Runtime VDOM / diff.** Arc is compile-time on purpose. Adding a runtime defeats the point.
- **CSS-in-JS.** `design` block is the CSS-in-Arc story.
- **TypeScript transpilation.** Arc's types are Arc's types; we won't accept `.ts` files as compilable input.

## Want to influence this roadmap?

- **Quick feedback:** [GitHub Discussions](https://github.com/arc-language/arc-web/discussions)
- **Specific feature request:** [Open an issue](https://github.com/arc-language/arc-web/issues/new/choose) with the feature template
- **Wanting to drive an item?** Comment on the relevant issue (or open one) saying you'd like to take it on. Maintainers will assign + scope.
