# Configuration

`arc.config.json` is the optional project-level configuration file for Arc. It controls site metadata, content security policy, session handling, image optimization, CORS policy, and deployment targets — all in one place, with sensible defaults so the file can be omitted entirely for simple projects.

Arc reads `arc.config.json` from the project root (next to `index.arc` or the first discovered `.arc` file). All keys are optional.

## Full schema

```json
{
  "site": {
    "baseUrl": "https://example.com",
    "name": "My Site",
    "lang": "en",
    "defaultDescription": "...",
    "defaultImage": "https://example.com/og.png"
  },
  "csp": "default-src 'self'; script-src 'self'; ...",
  "criticalCssThreshold": 14336,
  "session": {
    "cookieName": "session",
    "validate": "./session-validator.js"
  },
  "realtime": {
    "url": "wss://realtime.example.com"
  },
  "deploy": {
    "target": "cloudflare",
    "projectName": "my-arc-app"
  },
  "cors": "https://app.example.com",
  "img": {
    "formats": ["avif", "webp", "original"],
    "widths": [400, 800, 1200, 1600],
    "avifBenefitThreshold": 0.20,
    "dominantColors": true
  }
}
```

## Key reference

### `site`

Sets defaults for per-page meta that aren't overridden.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `baseUrl` | String (URL) | derived from `meta.canonical` | Used in `sitemap.xml` and `robots.txt` when no canonical present |
| `name` | String | none | Default for `meta.siteName` |
| `lang` | String ([BCP 47](https://www.ietf.org/rfc/bcp/bcp47.txt)) | `"en"` | Default `<html lang="...">`. Use subtags for regional variants: `"en-US"`, `"fr-CA"`, `"zh-Hans"`. |
| `defaultDescription` | String | none | Used when a page lacks `meta.description` |
| `defaultImage` | String (URL) | none | Used when a page lacks `meta.image` |

### `csp`

Override the default Content-Security-Policy:

```json
{ "csp": "default-src 'self'; script-src 'self' https://analytics.example; ..." }
```

Applies to both `<meta>` (single-page) and `_headers` (multi-page).

### `criticalCssThreshold`

CSS smaller than this byte size is inlined fully. Larger is split into critical (base layer inlined) + rest (deferred via `<link rel="preload">`).

| | |
| --- | --- |
| Default | 14336 (14 KB) |
| Min | 0 — always split |
| Max | unlimited — always inline |

Tune up if your above-fold styling needs more than 14 KB; tune down if your inlined CSS is bloating per-page HTML on multi-page sites.

### `session`

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `cookieName` | String | `"session"` | Cookie Arc looks for in `@server` requests |
| `validate` | String (path) | none | JS module exporting `validate(cookie) → { userId, ... } \| null` |

> **Warning:** If `validate` is unset, Arc treats *any* presence of the cookie as a valid session — every request is considered authenticated. This is only safe for local development. Always set `validate` before deploying to production.

### `realtime`

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `url` | String (wss://) | same origin | Override the WebSocket URL for `@realtime` channels |

### `deploy`

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `target` | String | `"cloudflare"` | Default target for `arc deploy` |
| `projectName` | String | derived from `package.json` name | Used in target-specific config (e.g., `wrangler.toml` `name`) |

### `cors`

Set the `Access-Control-Allow-Origin` header emitted by the built server. Applies to all routes and handles OPTIONS preflight requests automatically.

```json
{ "cors": "*" }
```

```json
{ "cors": "https://app.example.com" }
```

| Value | Effect |
| --- | --- |
| `"*"` | Allow any origin |
| `"https://..."` | Allow exactly that origin |

Only applies to the Bun server target (`arc build-server`). The `--cors` CLI flag overrides this value.

> **Note:** `cors: "*"` is incompatible with cookie-based authentication (`@auth` routes). Browsers will not send cookies to wildcard-origin responses. Use an explicit origin (`"https://app.example.com"`) when your API uses session cookies.

### `img`

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `formats` | String[] | `["avif","webp","original"]` | Which formats to generate; opt-out by removing |
| `widths` | Number[] | `[400, 800, 1200, 1600]` | Generic ladder when no layout context known |
| `avifBenefitThreshold` | Number 0–1 | `0.20` | Drop AVIF when not ≥20% smaller than WebP |
| `dominantColors` | Boolean | `true` | Emit `style="background:#abc"` on `<img>` |

Per-page overrides via page `meta.imageFormats=["webp","jpg"]` etc.

## No config = sensible defaults

Arc is designed to work with no config file at all. Add `arc.config.json` only when you need to override a default — e.g., custom CSP, custom session validator, custom realtime broker URL.

## Example: tightly locked production config

```json
{
  "site": {
    "baseUrl": "https://myapp.com",
    "name": "My App",
    "defaultImage": "https://myapp.com/og.png"
  },
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.myapp.com; connect-src 'self' wss://realtime.myapp.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
  "session": {
    "cookieName": "myapp_session",
    "validate": "./auth.js"
  },
  "realtime": {
    "url": "wss://realtime.myapp.com"
  },
  "deploy": {
    "target": "cloudflare",
    "projectName": "myapp"
  }
}
```

## Runtime environment variables

These are not part of `arc.config.json` but are read by the generated server at runtime:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP port to listen on (default: `3000`) |
| `DATABASE_URL` | SQLite file path (default: `app.db`) or Postgres connection string (`postgres://user:pass@host/db`). Required in production when using `@model` declarations. |
| `SESSION_SECRET` | Secret key for session signing. **Required in production** when any `@auth` route is present — the server will refuse to start without it. |
| `ARC_DEBUG=1` | Include error `message`, `name`, and truncated `stack` in HTTP 500 JSON responses. Only active when `NODE_ENV=development` is also set — never fires with unset or production `NODE_ENV`. Useful for local debugging when console logs are not accessible. Also controls verbose output in `arc serve` and `arc build`. |
| `TRUSTED_PROXY_IPS` | Comma-separated list of trusted proxy IPs (matched against the direct TCP connection). When set, the rate limiter reads the client IP from the `X-Forwarded-For` header only when the TCP-level peer IP is in this list. |
| `REDIS_URL` | Redis connection string (e.g. `redis://localhost:6379`). Required when `arc-jobs` is configured with a Redis queue backend. |

## See also

- [CLI](cli.md) — commands consume this config
- [SEO](../features/seo.md) — what `site.*` defaults affect
- [Deployment](../features/deployment.md) — target-specific config
