# Installation

## Requirements

- **Node.js ≥ 20** (Arc uses native test runner, modern crypto APIs, top-level await)
- That's it.

Arc has **zero runtime dependencies**. The compiler is pure Node.

## Install

```bash
npm install -g arc-web
```

Or run without installing:

```bash
npx arc-web build
```

> **Note:** the npm package is `arc-web` (the unscoped name `arc` was already taken on npm). The CLI binary you call is still `arc`.

## Verify

```bash
arc --version
# 0.1.0
```

## Optional: image pipeline

Arc's image pipeline (AVIF/WebP transcoding, srcset generation, dominant-color extraction) requires [`sharp`](https://sharp.pixelplumbing.com):

```bash
npm install -g sharp
```

Without `sharp`, `<img src="local.png">` passes through unchanged — Arc still compiles, you just don't get the optimization. See [Image Pipeline](../features/images.md) for details.

## Create a project

```bash
arc new my-app                         # default template
arc new my-blog --template blog
arc new my-counter --template counter
```

The scaffold:

```
my-app/
├── index.arc           # your first page
└── (no package.json, no node_modules — Arc needs neither)
```

## Build

```bash
cd my-app
arc build               # single page  → dist/index.html
arc build-site          # multi-page   → dist/*.html + shared.css + sitemap + _headers
arc dev                 # watch mode with live reload
```

## Editor support

- **VS Code**: install the `arc` extension (provides syntax highlighting + LSP)
- **Vim/Neovim**: see [`internals/contributing.md`](../internals/contributing.md) for syntax file
- **Treesitter**: grammar lives in `tree-sitter-arc` repo

## Next step

Read [Your First Page](first-page.md) — a 5-minute tutorial.
