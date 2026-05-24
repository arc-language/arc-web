# Data Contexts

Every value in a web app has a lifetime: known at build, known per-user, known per-tick. Arc names all of them. The compiler ships only the code each one actually needs.

## Quick decision matrix

| You have… | Use | Runs | Ships to browser |
| --- | --- | --- | --- |
| Data known at compile time | `@build` | once during `arc build` | inlined as HTML |
| UI state (counter, toggle, form) | `@state` | in the browser | ~50–200 B of direct DOM ops |
| Data derived from other reactive values | `@computed` | in the browser | added to the existing setter |
| Per-user data, server-rendered | `@live` | at the edge, per request | rendered HTML inline |
| Live updates pushed from server | `@realtime` | WebSocket / SSE channel | ~800 B WebSocket client |
| Callable function on the server | `@server` | at the edge, per call | client stub + ADP runtime (~600 B) |
| Background CPU work | `@worker` | in a Web Worker | the worker bundle |
| Session / auth context | `@session` | at the edge | nothing (server-only) |

## `@build` — compile-time

The compiler evaluates the RHS during `arc build` and inlines the value:

```arc
@build const posts = await fetch("https://cms.example/posts").then(r => r.json())
@build const config = readFile("./config.json")
@build const stars = await fetch("https://api.github.com/repos/me/repo")
  .then(r => r.json())
  .then(d => d.stargazers_count)
```

Allowed inside `@build`:
- Literals, arithmetic, conditionals
- `fetch(url)` — same-origin restrictions: only `http://` and `https://`, no internal addresses (`127.0.0.1`, `[::1]`, `0.0.0.0`)
- `readFile(path)` — local files only, no `/etc/passwd`-style traversal
- Array/object methods that don't require runtime state
- `await` for promises

Forbidden:
- Reading from `process.env` (use a config file)
- Spawning subprocesses
- Writing to the filesystem
- Importing arbitrary Node modules

After the optimizer pass, `for` loops and `if` conditions that depend only on `@build` values are **unrolled** — the user receives flat HTML, not a runtime loop.

```arc
@build const items = [1, 2, 3]

for n in items
  card "{n}"
```

Compiles to:

```html
<div class="arc-card_HASH">1</div>
<div class="arc-card_HASH">2</div>
<div class="arc-card_HASH">3</div>
```

## `@state` — client-side reactive

```arc
@state let count = 0
@state let name = ""
@state let isOpen = false
```

The compiler tracks every element that depends on each `@state` variable. On change, it generates a setter that updates exactly those elements — no virtual DOM, no diff.

Writes use `@varname`:

```arc
button on:click={ @count += 1 }
button on:click={ @count = 0 }
button on:click={ @name = e.target.value }
```

Two-way binding via `bind:value`:

```arc
input type="text" bind:value={name}
select bind:value={role}
  option value="admin" "Admin"
  option value="user" "User"
```

## `@computed` — derived reactive

```arc
@state let items = []
@state let query = ""
@computed let filtered = items.filter(x => x.name.includes(query))
@computed let count = filtered.length
```

`@computed` recomputes only when one of its dependencies changes. The dependency graph is built at compile time — Arc knows that changing `query` invalidates `filtered`, which invalidates `count`, but changing `items` invalidates both directly without re-running through `query`.

## `@live` — edge-rendered

For data that changes per request (per-user, time-sensitive):

```arc
@server fn getStats() -> { users: Number, revenue: Number }
  const r = await fetch("https://api.example/stats")
  return await r.json()

@live let stats = getStats()

main
  text "Users: {stats.users}"
  text "Revenue: ${stats.revenue}"
```

What Arc generates:

1. **Edge function** (`dist/_arc/renderer.js`) — a WinterCG-compatible fetch handler. Runs on Cloudflare Workers / Deno Deploy / Bun / Node.
2. **Streaming HTML response**:
   - `<head>` flushes immediately (browser starts parsing CSS, fonts)
   - `_resolveData()` runs all `@live` in parallel via `Promise.all`
   - Body flushes once data is filled in
3. **No client-side fetch**. The HTML the browser receives already has the data.

After initial render, if `@live` changes (e.g., user updates their profile), Arc can also generate **client-side update code** that re-fetches via ADP binary protocol. Opt in by referencing the `@live` variable from an `on:click` handler.

See [Edge Rendering](../features/edge-rendering.md).

## `@realtime` — channel subscription

```arc
@realtime let messages = channel("chat/room-42")
@realtime let onlineUsers = channel("presence/room-42")

main
  for msg in messages
    card
      text "{msg.author}: {msg.body}"
```

Arc generates:
- WebSocket connection management with auto-reconnect + exponential backoff
- ADP binary frame parsing (3× smaller than JSON, 10× faster decode)
- Direct DOM updates as frames arrive

You don't write `new WebSocket(...)` anywhere. Arc handles the lifecycle.

## `@server` — callable from client

For RPC-style functions the client invokes (form submits, mutations):

```arc
@server fn toggleLike(postId: String) -> Boolean
  return await db.likes.toggle({ user: @session.userId, postId })

button on:click={ await toggleLike(post.id) }
  "{post.liked ? '❤' : '♡'} {post.likeCount}"
```

What Arc generates:
- The function body runs on the edge (same target as `@live`)
- A typed client stub: `async function toggleLike(postId) { ... }` that POSTs an ADP-encoded body to `/_arc/fn/toggleLike`
- An ADP encoder + decoder runtime (only included if any `@server` is actually called from the client; tree-shaken otherwise)

`@server` differs from `@live`:
- `@live` is **declarative** — the value is rendered into the initial HTML; updates push from edge to browser.
- `@server` is **imperative** — the client calls it explicitly, typically in event handlers.

## `@worker` — Web Worker

For CPU-bound work that shouldn't block the main thread:

```arc
@worker fn parseJson(big: String) -> any
  return JSON.parse(big)

@worker fn processImage(bytes: ArrayBuffer) -> ImageData
  // expensive transform
```

Arc generates a worker bundle + a proxy stub on the main thread. You call `parseJson(...)` as if local; Arc routes it through `postMessage` transparently.

## `@session` — auth context

Available inside any `@server` fn or `@live` resolver:

```arc
@server fn getMyPosts() -> Post[]
  return await db.posts.where({ userId: @session.userId })

@live let myStats = getMyPosts()
```

Arc validates `@session` at the edge function boundary automatically. If `@session.userId` is accessed and the request has no valid session cookie, Arc returns **401 Unauthorized** before your function runs.

## Combining contexts

A real page mixes contexts:

```arc
page "Dashboard"
  @build const features = await fetch("/api/feature-flags").then(r => r.json())
  @server fn getUser() -> User
    return await db.users.find(@session.userId)
  @live let user = getUser()
  @state let activeTab = "overview"
  @realtime let notifications = channel("notify/" + user.id)

  header
    heading "Welcome, {user.name}"      // @live → server-rendered
    badge "{notifications.length} new"  // @realtime → updates live
  main
    nav
      for tab in features.tabs           // @build → inlined at compile
        button on:click={ @activeTab = tab.id } "{tab.label}"
    text "Active: {activeTab}"           // @state → client-side
```

Each value lives where it should. The compiler ships exactly what's needed for each:
- `features.tabs` — zero runtime cost (inlined)
- `user.name` — server-rendered, no client fetch
- `activeTab` — ~50 B of client JS
- `notifications.length` — WebSocket client + frame handler

## Next

- [Reactive](reactive.md) — the dependency graph in detail
- [Edge Rendering](../features/edge-rendering.md) — `@live` deployment targets
- [Realtime](../features/realtime.md) — `@realtime` wire format
- [Recipe: API Fetching](../recipes/api-fetching.md) — when to use which context
