# tree-sitter-arc

Tree-sitter grammar for the [Arc language](https://github.com/arc-language/arc).

> **Status: scaffold / 0.1.0**
>
> This grammar covers top-level structure + the most common patterns for
> syntax highlighting + structural navigation in editors that consume
> tree-sitter (Neovim, Helix, Zed, Atom). It is NOT a second parser —
> Arc's authoritative parser is `src/parser.js` in the main repo.

## Build

```bash
npm install
npm run build      # generates src/parser.c
npm test           # run grammar tests against test/corpus/
```

## Use in Neovim

Add to your `init.lua` (with nvim-treesitter):

```lua
local parser_config = require('nvim-treesitter.parsers').get_parser_configs()
parser_config.arc = {
  install_info = {
    url = 'https://github.com/arc-language/arc',
    files = { 'editor-extensions/tree-sitter-arc/src/parser.c' },
    branch = 'main',
  },
  filetype = 'arc',
}
```

## Limitations

- Indentation-based block detection uses a simplified token model. Future
  versions should use tree-sitter externals (a C scanner) for accurate
  INDENT/DEDENT tracking matching Arc's lexer.
- No queries (`highlights.scm`, `locals.scm`, `injections.scm`) ship yet.
  Editors using this grammar will fall back to generic highlighting until
  those are added.

## Roadmap

See the [main Arc roadmap](https://github.com/arc-language/arc/blob/main/ROADMAP.md).
Tracking work for this grammar:

- [ ] External scanner for INDENT / DEDENT / NEWLINE
- [ ] `queries/highlights.scm` for full syntax highlighting
- [ ] `queries/locals.scm` for go-to-definition
- [ ] `queries/injections.scm` for embedded JS in `on:click={...}` and `{...}` interpolation
- [ ] Publish to npm as `tree-sitter-arc`
- [ ] PR to [github-linguist/linguist](https://github.com/github-linguist/linguist) to register `.arc` for syntax highlighting on GitHub

## License

MIT — same as Arc.
