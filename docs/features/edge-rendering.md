# Edge Rendering — `@live` + `@server`

Arc generates a WinterCG-compatible edge function whenever a page uses `@live`. Per-request data is resolved at the edge (sub-5 ms from any user with Cloudflare Workers) and streamed into the HTML response.

## The pattern

```arc
page "Dashboard"
  @server fn getUser() -> { name: String, role: String }
    const r = await fetch("/api/me", {
      headers: { cookie: @session.cookie }
    })
    return await r.json()

  @server fn getStats() -> { revenue: Number, signups: Number }
    return await db.stats.summary()

  @live let user = getUser()
  @live let stats = getStats()

  header
    heading "Welcome, {user.name}"
  main
    text "Revenue: ${stats.revenue}"
    text "Signups: {stats.signups}"
```

What ships:

```
dist/
├── _arc/
│   ├── functions.js     # @server functions (callable via /api/_arc/fn/...)
│   └── renderer.js      # @live edge worker (handles `/` requests)
├── styles.css
└── index.html           # (a fallback; the worker generates the real HTML)
```

Browser flow:
1. Browser → edge worker (`renderer.js`)
2. Worker → `_resolveData()` runs all `@live` in parallel via `Promise.all`
3. Worker → fills `{user.name}` etc. into HTML template
4. Worker streams response: head flushes immediately, body follows when data resolves
5. Browser receives complete HTML with data inline. **No loading flash. No client-side fetch.**

## How streaming works (B2)

`renderer.js` returns `Response(stream)` instead of `Response(html)`:

```js
const stream = new ReadableStream({
  async start(controller) {
    // Flush <head> immediately — browser parses CSS, starts font fetch
    controller.enqueue(enc.encode(head))

    // Await data
    const data = await _resolveData(request)

    // Fill body, write the rest
    controller.enqueue(enc.encode(_fillHtml(data)))
    controller.close()
  }
})
```

On a real network with non-zero API latency, the browser starts parsing the head before the data round-trip completes. On localhost (sub-ms latency) the streaming win is negligible — but it's an architectural advantage on production networks.

## `@session` validation

`@session` is available inside any `@server` fn. Arc validates the request cookie at the edge boundary:

```arc
@server fn getMyPosts() -> Post[]
  return await db.posts.where({ userId: @session.userId })
```

If the request has no valid session cookie, Arc returns **401 Unauthorized** before your function body runs. You don't write auth middleware.

The session validator is configurable via `arc.config.json`:

```json
{
  "session": {
    "cookieName": "session",
    "validate": "./session-validator.js"
  }
}
```

## Deploy targets

`arc deploy --target <target>` bundles for one of:

| Target | Adapter | Notes |
| --- | --- | --- |
| `cloudflare` | Cloudflare Workers | Recommended. Global edge, <15 ms TTFB. |
| `deno` | Deno Deploy | |
| `bun` | Bun HTTP server | For self-hosting on Bun |
| `node` | Node HTTP server | For self-hosting on Node |

All targets use the same `renderer.js` source — Arc just generates the right entry-point glue.

## Parallel resolution

When a page has multiple `@live` decls, Arc resolves them in parallel via `Promise.all`:

```js
// auto-generated _resolveData()
const [user, stats, notifications] = await Promise.all([
  getUser(),
  getStats(),
  getNotifications(),
])
```

A page with 3 `@live` calls + 50 ms each = **50 ms** total, not 150 ms.

## Update after initial render

If a `@live` value is also referenced from a client `on:click` handler, Arc generates a client-side re-fetch via ADP:

```arc
@server fn getStats() -> Stats
  return await db.stats.fresh()

@live let stats = getStats()
button on:click={ stats = await getStats() } "Refresh"
text "Revenue: ${stats.revenue}"
```

The button click triggers an ADP binary call to `/api/_arc/fn/getStats`. The response decodes to `Stats` and updates the bound elements — no full page reload.

## `@server` without `@live`

You can have `@server` functions called only from event handlers (no `@live`):

```arc
@server fn likePost(id: String) -> Number
  return await db.likes.add({ user: @session.userId, postId: id })

@state let likeCount = 0
button on:click={ likeCount = await likePost(postId) }
  "❤ {likeCount}"
```

This emits the edge function + client ADP stub but no `@live` renderer (no per-request page generation). The page is static + can call server functions.

## CSP + security headers

The edge worker sets headers automatically:

```
Content-Type: text/html; charset=utf-8
Cache-Control: private, no-cache
Content-Security-Policy: default-src 'self'; ...
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

For static pages, the same headers are emitted via `dist/_headers` instead (see [Deployment](deployment.md)).

## Error handling

If `_resolveData` throws:

```
[arc] @live data error: <message>
→ Returns 500 Internal Server Error with body "Internal Server Error"
```

The error is logged via `console.error` (visible in Cloudflare/Deno/Bun/Node logs). The browser doesn't see the trace.

For graceful degradation, wrap your `@server` body:

```arc
@server fn getUser() -> User | none
  try
    return await db.users.find(@session.userId)
  catch
    return none

@live let user = getUser()

if user
  heading "Welcome, {user.name}"
else
  text "Unable to load user info."
```

## Internals

The generator lives at `/home/claude/arc/src/edge/renderer.js`. The output is a single self-contained module — no imports beyond `Request`/`Response`/`TextEncoder` (all WinterCG globals).

## Next

- [Realtime](realtime.md) — `@realtime` channels for live updates beyond render time
- [Deployment](deployment.md) — `arc deploy --target ...`
- [Recipe: Auth Flow](../recipes/auth-flow.md) — `@session` + form submission
