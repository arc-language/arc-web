# Compile API

For programmatic use of the Arc compiler from Node — e.g., build pipelines, custom CLIs, test helpers.

## Import

```js
const { compile, _internal } = require('arc/src/cli')
```

## `compile(source, filename, options) → Promise<Result>`

The main entry point. Lexes, parses, checks, executes `@build`, optimizes, and emits HTML / CSS / JS / edge functions.

### Signature

```ts
async function compile(
  source: string,
  filename?: string,
  options?: {
    projectDir?: string,
    distDir?: string,
    sourceMap?: SourceMapBuilder | null,
  }
): Promise<{
  html: string,
  css: string,
  js: string,
  edgeFunctions: string,           // empty when no @server
  liveEdgeFunction: string | null, // null when no @live
  handlerNames: string[],
  program: ProgramAST,
}>
```

### Example

```js
const fs = require('fs')
const { compile } = require('arc/src/cli')

const source = fs.readFileSync('index.arc', 'utf8')
const result = await compile(source, 'index.arc', {
  projectDir: __dirname,
  distDir: __dirname + '/dist',
})

fs.writeFileSync('dist/index.html', result.html)
fs.writeFileSync('dist/styles.css', result.css)
if (result.js.trim()) fs.writeFileSync('dist/app.js', result.js)
if (result.liveEdgeFunction) {
  fs.writeFileSync('dist/_arc/renderer.js', result.liveEdgeFunction)
}
```

### Options

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `projectDir` | String | `process.cwd()` | Used for relative import resolution + image pipeline source dir |
| `distDir` | String | none | Required for image pipeline (where to write `*.avif`, `*.webp`, `*.jpg` variants). When unset, image pipeline is a no-op |
| `sourceMap` | SourceMapBuilder \| null | null | When provided, populates source map info for the emitted JS |

### Errors

`compile()` throws on syntax or type errors. Catch:

```js
try {
  const result = await compile(source, 'index.arc')
} catch (e) {
  console.error(e.message)        // contains line/column info
}
```

For machine-friendly error info, the error has properties:
- `e.line` — 1-indexed
- `e.column` — 1-indexed (sometimes absent)
- `e.filename` — the source filename if passed
- `e.message` — human-readable

See [Errors](errors.md) for the catalog.

## Internals namespace (`_internal`)

For advanced use cases — building custom CLIs, integrating into bundlers, etc.

```js
const { _internal } = require('arc/src/cli')

_internal.resolveImports(program, projectDir, filename, new Set(), projectDir)
_internal.composeClientJs(reactive, stubs, realtime)
_internal.hashString(s)
_internal.injectAssets(html, js)
_internal.fmt(bytes)
_internal.findArcFiles(dir)
_internal.newProject(name, template)
_internal.check(files)
_internal.build(projectDir)
_internal.deploy(projectDir, target)
```

**Stability note:** the internals namespace is **not** stable API. It's exposed for tool authors who accept the breakage risk.

## Per-emitter access

For very advanced use (custom emit pipelines, partial compiles):

```js
const { Lexer } = require('arc/src/lexer')
const { Parser } = require('arc/src/parser')
const { Checker } = require('arc/src/checker')
const { BuildExecutor } = require('arc/src/build-exec')
const { Optimizer } = require('arc/src/optimizer')
const { HtmlEmitter } = require('arc/src/emitters/html')
const { CssEmitter } = require('arc/src/emitters/css')
const { JsEmitter } = require('arc/src/emitters/js')
const { ServerEmitter } = require('arc/src/emitters/server')
const { EdgeRenderer } = require('arc/src/edge/renderer')
const { ImagePipeline, collectImgRefs } = require('arc/src/img-pipeline')
const { PostProcessor } = require('arc/src/post')
```

Each is documented in [Internals](../internals/).

## Use cases

### Vite / Rollup plugin

```js
const { compile } = require('arc/src/cli')

module.exports = function arcPlugin() {
  return {
    name: 'arc',
    async transform(code, id) {
      if (!id.endsWith('.arc')) return null
      const result = await compile(code, id)
      return { code: result.html, map: null }  // simplified
    },
  }
}
```

### Custom multi-page orchestrator

If `arc build-site` doesn't fit your output layout, replicate its loop:

```js
const { compile, _internal: { findArcFiles } } = require('arc/src/cli')
const { PostProcessor } = require('arc/src/post')

const files = findArcFiles('docs/')
const compiled = []
for (const f of files) {
  const source = fs.readFileSync(f, 'utf8')
  const result = await compile(source, f, { projectDir: 'docs/', distDir: 'dist/' })
  compiled.push({ file: f, ...result })
}

// Your own CSS dedup / sitemap / etc. logic here
```

### Testing

```js
const assert = require('assert')
const { compile } = require('arc/src/cli')

const { html, js } = await compile('page "Test"\n  text "hi"')
assert.ok(html.includes('<p>hi</p>'))
assert.equal(js.trim(), '')
```

## See also

- [CLI](cli.md) — command-line interface
- [Internals: Pipeline](../internals/pipeline.md) — what `compile()` does internally
