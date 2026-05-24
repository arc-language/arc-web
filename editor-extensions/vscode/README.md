# Arc — VS Code Extension

Syntax highlighting and snippets for the [Arc language](https://github.com/arc-language/arc-web).

## Features

- **Syntax highlighting** for `.arc` files: keywords, reactive annotations (`@state`, `@build`, `@live`, etc.), string interpolation, types, element vocabulary
- **Snippets** for common patterns: `page`, `widget`, `@state`, `@build`, `@server`, `@live`, `for`, `if`, `match`, `design`, `card`, `button`, `form`
- **Indentation rules** matching Arc's 2-space convention
- **Auto-closing pairs** for `{}`, `[]`, `()`, `""`, `''`

## Install

From the VS Code Marketplace (when published):

```
ext install arc-language.arc-language-vscode
```

Or from source:

```bash
git clone https://github.com/arc-language/arc-web
cd arc/editor-extensions/vscode
vsce package
code --install-extension arc-language-vscode-0.1.0.vsix
```

## What's NOT included (yet)

- **LSP** — full language server with diagnostics, go-to-definition, etc. Tracked in [`tree-sitter-arc`](https://github.com/arc-language/tree-sitter-arc) and a planned `arc-lsp` repo. See the [main Arc roadmap](https://github.com/arc-language/arc-web/blob/main/ROADMAP.md).
- **Formatter** integration — `arc fmt` CLI is on the roadmap.

## Issues

File issues on the [main Arc repo](https://github.com/arc-language/arc-web/issues) with the `editor-extension` label.

## License

MIT — same as Arc.
