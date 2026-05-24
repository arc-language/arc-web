# Recipe: API Fetching

When to use `@build` vs `@live` vs `@server` vs `@realtime` for any given API call. The most important architectural decision in an Arc app.

## Decision tree

```
Will the data ever change?
├── No (or only at deploy time)         → @build
└── Yes
    ├── Changes per user?
    │   ├── Yes
    │   │   ├── Always need server-rendered?  → @live + @server fn
    │   │   └── Only on action (clicks)?      → @server fn (called from on:click)
    │   └── No (changes globally over time)
    │       ├── Updates streamed?             → @realtime
    │       └── Periodic re-fetch?            → @live with cache or @server on interval
```

## `@build` — fetch once at build time

For data that doesn't change between visitors:

```arc
@build const posts = await fetch("https://cms.example/posts").then(r => r.json())
@build const stars = await fetch("https://api.github.com/repos/me/repo")
  .then(r => r.json())
  .then(d => d.stargazers_count)
@build const docs = readFile("./content/docs.md")
```

**Cost to visitor:** 0 bytes runtime, 0 ms latency.

**When to re-fetch:** every `arc build`. Run CI on git push, on a cron, or via a CMS webhook. Cloudflare Pages can trigger builds via API.

**Limits:** 10 MB response cap; only public HTTP(S); no internal addresses; no auth headers (use a build-time secret in `@build` only with care).

## `@live` — render per-request at the edge

For user-specific data or data that changes faster than your build cadence:

```arc
@server fn getUser() -> User
  return await db.users.find(@session.userId)

@server fn getStats() -> Stats
  return await db.stats.summary()

@live let user = getUser()
@live let stats = getStats()

heading "Welcome, {user.name}"
text "Revenue: ${stats.revenue}"
```

**Cost to visitor:** the edge round-trip (typically 50-200 ms total — edge-to-origin plus render). HTML arrives complete; no client-side fetch.

**When to use:** authenticated dashboards, personalized landing pages, "logged in as" headers.

**Trade-off:** every request runs the edge function. For high-traffic pages where the data is the same for many users, consider caching at the edge.

## `@server` — callable from client JS

For mutations, search, paginate, infinite scroll — anything triggered by user action after initial render:

```arc
@server fn search(query: String) -> Result[]
  return await db.products.search(query)

@server fn likePost(id: String) -> Number
  return await db.likes.add({ user: @session.userId, postId: id })
  
@state let results: Result[] = []

input type="search" on:input={ @results = await search(event.target.value) }
button on:click={ const count = await likePost(post.id); @count = count } "♡ {count}"
```

**Cost to visitor:** ~600 B ADP runtime + ~200 B per stub fn + the actual API round-trip.

**When to use:** anything that needs server logic but isn't required at first render.

## `@realtime` — pushed updates

For collaborative editing, chat, presence, live feeds:

```arc
@realtime let messages = channel("chat/room-42")
@realtime let presence = channel("presence/room-42")

for msg in messages
  card "{msg.author}: {msg.body}"

text "{presence.length} online"
```

**Cost to visitor:** persistent WebSocket connection + ~800 B client (decoder + reconnect logic).

**When to use:** when changes must appear within seconds without polling.

## Combinations

A real page often uses multiple:

```arc
page "Project Dashboard"
  // Static reference data
  @build const departments = await fetch("https://api/departments").then(r => r.json())

  // Per-user, on every page load
  @server fn getProjects() -> Project[]
    return await db.projects.where({ userId: @session.userId })
  @live let projects = getProjects()

  // Live updates pushed when new comments appear
  @realtime let comments = channel("project-comments/" + @session.userId)

  // Server actions
  @server fn archive(id: String) -> none
    await db.projects.archive(id)

  header
    heading "Welcome"
    badge "{comments.length} new comments"
  main
    nav
      for d in departments
        link href="?dept={d.id}" "{d.name}"
    for p in projects
      card
        text "{p.name}"
        button on:click={ await archive(p.id) } "Archive"
```

- `departments` — inlined, zero runtime cost
- `projects` — server-rendered, no loading state
- `comments` — pushed live via WebSocket
- `archive(id)` — RPC, only loaded into client bundle because it's called

## Cache strategies

For `@live` data that doesn't change often:

```arc
@server fn getStats() -> Stats
  // Cache for 60 seconds at the edge
  return await fetch("https://api/stats", {
    cf: { cacheTtl: 60 }      // Cloudflare-specific
  }).then(r => r.json())
```

For per-user `@live` data, you can cache per-session:

```arc
@server fn getCachedUser() -> User
  const cached = await KV.get(`user:${@session.userId}`)
  if cached return JSON.parse(cached)
  const user = await db.users.find(@session.userId)
  await KV.put(`user:${@session.userId}`, JSON.stringify(user), { expirationTtl: 300 })
  return user
```

## Optimistic updates

For mutations where you want instant feedback:

```arc
@server fn likePost(id: String) -> { count: Number, liked: Boolean }
  return await db.likes.toggle({ user: @session.userId, postId: id })

@state let liked = post.userLiked
@state let count = post.likeCount

button on:click={
  // Optimistic
  @liked = !liked
  @count = liked ? count - 1 : count + 1
  // Then sync
  const r = await likePost(post.id)
  @liked = r.liked
  @count = r.count
} "{liked ? '❤' : '♡'} {count}"
```

## Error handling

`@server` returning `Result`:

```arc
@server fn riskyOp(input: String) -> Result<Output, String>
  try
    return Ok(await doThing(input))
  catch e
    return Err(e.message)

@state let status: Result<Output, String> | none = none

button on:click={ @status = await riskyOp(input) }
  if status is Result.Ok
    text "Success: {status.value.field}"
  else if status is Result.Err
    text "Error: {status.value}"
```

## Don't use `@build` for:

- Per-user data (use `@live`)
- Data that changes faster than your CI cadence
- Secret API keys (build-time secrets aren't ideal — use `@server` with env vars)
- 10 MB+ responses (limit; use pagination + `@live`)

## Don't use `@live` for:

- Data identical across all users (use `@build`)
- Per-second updates (use `@realtime`)
- Things callable from user actions (use `@server`)

## See also

- [Data Contexts](../language/data-contexts.md) — the formal reference
- [Edge Rendering](../features/edge-rendering.md) — `@live` deployment
- [Realtime](../features/realtime.md) — channel mechanics
