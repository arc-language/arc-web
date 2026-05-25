# Roadmap

What's coming for Arc. Items are grouped by release; ordering inside each version is informal. Suggestions and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

This roadmap is updated when meaningful work lands. For everything that's already shipped, see [CHANGELOG.md](CHANGELOG.md).

---

## 0.2 — full-stack backend ✅ shipped 2026-05-24

Arc is now a full-stack language. Same `.arc` source compiles to frontend (HTML/CSS/JS) and backend (Bun server or Cloudflare Workers edge bundle).

- ✅ **`arc/http`** — `@route` annotation, compile-time radix-trie dispatch, `@auth` guard, `json()` / `redirect()` / `html()` helpers
- ✅ **`arc/db`** — `model` block, compile-time SQL, `arc db migrate`, `arc db seed`, SQLite + PostgreSQL
- ✅ **`arc/auth`** — HMAC-SHA256 signed sessions, JWT HS256, GitHub + Google OAuth
- ✅ **`arc/queue`** — `job` block, in-process async queue with retry, `email.send()`
- ✅ **Cloudflare Workers target** — D1 bindings, CF Queues, auto-generated `wrangler.toml`
- ✅ **`arc serve`** hot reload — `fs.watch` + 150 ms debounce, child-process restart
- ✅ **Multi-statement match arms** — indented block bodies after `->`
- ✅ **`arc check <dir>`** — type-check entire directory trees
- ✅ **`arc explain`** upgrade — shows DB reads/writes and job invocations per route

## 0.3 — backend hardening + DX (next)

- **`arc/magic-link`** — passwordless email login flow.
- **`arc/cron`** — scheduled jobs (`@cron "0 9 * * *" SendDailyDigest`). Compiles to `node-cron` (Bun) and CF Cron Triggers.
- **`arc/storage`** — `storage.put(key, file)` / `storage.get(key)`. Local filesystem (Bun) + R2 (CF).
- **`arc/kv`** — key-value store. Redis (Bun) + CF KV.
- **Compile-time OpenAPI** — `arc explain --format openapi` emits `openapi.json` from route AST. No runtime reflection.
- **VS Code extension.** Syntax highlighting + brace matching + snippets. Ships as `editor-extensions/vscode/` in this repo.
- **Treesitter grammar.** Standalone `tree-sitter-arc` repo. GitHub linguist registration + Neovim + Helix support.
- **LSP server.** Standalone `arc-lsp` repo. Diagnostics from the checker; go-to-definition for widget invocations.

## 0.4 — frontend polish

- **`arc fmt` formatter.** Canonical formatting for `.arc` files. Reuses lexer + parser, emits normalized whitespace. ~300 lines.
- **HMR for design blocks.** No full reload on CSS-only changes in `arc dev`.
- **Auto Service Worker.** Emit a SW that caches all routes on install + prefetches likely-next on idle.
- **103 Early Hints in edge renderer.** `@live` edge worker emits a 103 response with preload hints before computing data.
- **CSS value minification.** `oklch(60% 0.15 250)` → hex; `0.5em` → `.5em`. ~30-80 B savings per stylesheet.
- **`arc playground`.** Browser-based "try Arc" tool — paste source, see HTML/CSS/JS output side-by-side.

## 0.5 — stdlib expansion

- **`arc/markdown`** — MDX-style mixed markdown + Arc widgets at build time.
- **`arc/i18n`** — compile-time message extraction + per-locale builds.
- **`arc/analytics`** — privacy-first event collection (no third-party JS).
- **Type-flow front↔back** — `model Post` automatically types `db.posts.findMany()` return and frontend `@live` bindings. No manual `interface` duplication.

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
