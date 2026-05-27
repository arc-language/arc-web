# CLI Reference

Complete reference for every `arc` command.

```bash
arc <command> [args] [flags]
```

## `arc build [dir]`

Compile a single page.

```bash
arc build               # build current dir
arc build my-app        # build my-app/
arc build my-app -o ../public   # custom output (not yet implemented)
```

Discovers `index.arc` in `dir`. If none, uses the first `*.arc` file alphabetically.

Output:
```
dist/
├── index.html
├── styles.css        # only when CSS exceeds inline threshold
├── app.js            # only when @state / @server stubs used
├── app.js.map        # source map
└── _arc/             # only when @server / @live present
    ├── functions.js
    └── renderer.js
```

Stats:
```
arc: built index.arc
  HTML  2.5 KB
  CSS   1.7 KB
  JS    478 bytes
  Edge  6.0 KB (@server functions)
  Live  10.1 KB (@live edge renderer)
  → dist/
```

## `arc build-site [dir]`

Compile every `*.arc` file in `dir` as a cohesive site. Extracts shared CSS, generates sitemap, emits `_headers`.

```bash
arc build-site             # build current dir
arc build-site docs/       # build docs/*.arc
```

Output adds:
```
dist/
├── *.html              # one per .arc input
├── shared.{sha}.css    # rules used by ≥2 pages
├── sitemap.xml
├── robots.txt
└── _headers
```

Stats:
```
arc: built site (20 pages)
  HTML  74.2 KB total (20 files)
  CSS   1.1 KB shared (shared.26e7ee47.css)
  SEO   sitemap.xml (20 urls) + robots.txt
  → dist/
```

If `dir` has only one `.arc` file, `build-site` falls back to `build`.

See [Multi-page](../features/multi-page.md).

## `arc build-server [dir]`

Compile all `@route` declarations in `dir` into a production Bun HTTP server.

```bash
arc build-server              # build current dir
arc build-server my-api       # build my-api/
```

Output:
```
dist/
└── server.js     # self-contained Bun server (bun run dist/server.js)
```

Flags:

| Flag | Effect |
| --- | --- |
| `--no-rate-limit` | Omit built-in rate-limiter middleware |
| `--no-tracing` | Omit request trace ID injection |
| `--bun-routes` | Use Bun native C++ route dispatcher (fastest, Bun 1.x only) |
| `--db postgres` | Emit PostgreSQL queries + `pg` Pool (default: SQLite via `bun:sqlite`) |

Stats:
```
arc: server built → dist/server.js (18.1 KB)
```

See [Deployment](../features/deployment.md) for running in production.

## `arc dev [dir]`

Watch mode with live reload. Browser reconnects automatically when files change.

```bash
arc dev
arc dev my-app
arc dev --port 3000
```

Default port: 8080. Local-only (`127.0.0.1`).

Live reload uses Server-Sent Events. Endpoints:
- `/` — current page
- `/_arc/reload` — SSE stream
- `/_arc/health` — JSON health check
- `/styles.css`, `/app.js` — assets

The dev server uses `arc build` internally; it does not run `build-site` (no shared CSS in dev — fewer reloads).

## `arc db <subcommand>`

Manage database schema and data for projects with `model` declarations.

```bash
arc db migrate [dir]   # diff models against live DB, apply missing tables/columns
arc db status  [dir]   # show per-model migration status (no changes applied)
arc db reset   [dir]   # drop all model tables, re-migrate, run seed.arc if present
arc db seed    [dir]   # run server/seed.arc
```

Flags shared by all subcommands:

| Flag | Effect |
| --- | --- |
| `--db sqlite\|postgres` | Dialect (default: `sqlite`) |
| `--url <url>` | Connection string (default: `app.db` or `DATABASE_URL`) |

Additional flags:

| Flag | Subcommand | Effect |
| --- | --- | --- |
| `--dry` | `migrate` | Show SQL that would run without applying |
| `--no-seed` | `reset` | Skip seed step after reset |

Example output:

```
  ⚡ arc db  →  app.db

  CREATE  posts    (id, title, body, published, createdAt)
  ALTER   users    (+email)

  ✓  2 migrations applied in 34ms
```

## `arc check [files...]`

Type + accessibility check without emitting:

```bash
arc check                  # check all *.arc in current dir
arc check src/             # check directory recursively
arc check page.arc widget.arc   # specific files
```

Reports:
- Type errors (parser + checker)
- Accessibility warnings (missing alt, missing label, etc.)
- Deprecated patterns

Exits non-zero on errors. Use in CI.

## `arc new <name> [--template <t>]`

Scaffold a new project:

```bash
arc new my-app                     # default template
arc new my-blog --template blog
arc new my-counter --template counter
```

Templates:
- `default` — single page with `Hello, Arc`
- `counter` — `@state` example
- `blog` — `@build` data inlining

Creates:
```
<name>/
├── index.arc
└── (no package.json — Arc needs none)
```

## `arc deploy [dir] [--target <target>]`

Bundle for a deploy target:

```bash
arc deploy --target cloudflare     # default
arc deploy --target deno
arc deploy --target bun
arc deploy --target node
arc deploy my-app --target cloudflare
```

Output adds a target-specific directory inside `dist/`:
```
dist/
├── ... (static assets)
└── worker/ or deno/ or bun/ or node/
    ├── entry / index / server.js
    └── target-specific config
```

`arc deploy` only **builds** the deploy bundle; you still run the target's deploy command (`wrangler deploy`, `deployctl deploy`, etc.). See [Deployment](../features/deployment.md).

## Common flags

| Flag | Effect |
| --- | --- |
| `--help`, `-h` | Show usage |
| `--version`, `-V` | Show Arc version |
| `--no-color` | Disable colored output (CI-friendly) |

Flags are global where they make sense — `arc --version` works regardless of command.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Compile error (syntax, type, missing file) |
| 2 | I/O error (can't read dir, can't write dist/) |
| 3 | Dev server port already in use |

## Environment variables

| Var | Effect |
| --- | --- |
| `ARC_LOG_LEVEL` | `silent`, `warn`, `info` (default), `debug` |
| `NO_COLOR` | Disable colored output |
| `ARC_NO_SHARP` | Force-skip image pipeline even if `sharp` is installed |

## See also

- [Configuration](configuration.md) — `arc.config.json` schema
- [Errors](errors.md) — every error message + fix
