---
name: arc-add-live
description: Use when the user wants per-request, server-rendered data inlined into the initial HTML — dashboards, auth-gated pages, personalized greetings. Triggers on "server-render", "auth-gated", "personalized", "no loading state", "first-paint with real data".
---

# arc-add-live

**When to use:** the user wants data that:
- Changes per visitor (not the same for everyone — that's `@build`)
- Must appear in the FIRST byte of HTML (no loading spinner, no client fetch)
- Doesn't need to update after page load via push (that's `@realtime`)

**Reference docs:** `docs/features/edge-rendering.md`, `docs/recipes/auth-flow.md`.

## Pattern

`@live let x = serverFn()` declares a server-rendered variable. Arc generates an edge function (`dist/_arc/renderer.js`) that:
1. Receives the request at the edge (Cloudflare Worker etc.)
2. Runs all `@live` resolvers in **parallel** via `Promise.all`
3. Fills the values into the HTML template
4. **Streams** the response — `<head>` flushes before data resolves, body follows when ready

The browser receives complete HTML in one round trip. **No loading flash.** No client-side fetch.

### Minimal dashboard

```arc
page "Dashboard"
  @server fn getUser() -> { name: String, role: String }
    return await db.users.find(@session.userId)

  @server fn getStats() -> { users: Number, revenue: Number }
    return await db.stats.summary()

  @live let user = getUser()
  @live let stats = getStats()

  header
    heading "Welcome back, {user.name}"
  main
    row
      card { heading "Users";   text "{stats.users}" }
      card { heading "Revenue"; text "${stats.revenue}" }
```

Time complexity (request-time): `max(getUser, getStats)` — they run in parallel.
Space complexity: O(1) per resolved value, kept in edge worker memory only for the duration of the request.
Client bytes: **0 B for the @live data itself** — it's inlined in HTML. Plus whatever `@state` / `@server` invocations the rest of the page needs.

## Parallel resolution is automatic

Arc emits:

```js
const [user, stats] = await Promise.all([getUser(), getStats()])
```

If you have 3 `@live let` declarations with 50 ms server-side cost each, total wait is **50 ms** (not 150 ms). Verify they're independent — `@live let b = useA(a)` chains break parallelism.

## Streaming response

`renderer.js` returns `Response(stream)` instead of `Response(html)`:
1. Flushes `<head>` immediately — browser starts parsing CSS, preloading fonts
2. Awaits data
3. Flushes filled-in body

On a real production network, this saves the data-fetch latency from FCP. On localhost it's invisible.

## Auth example

```arc
page "Settings"
  @server fn getMe() -> User
    return await db.users.find(@session.userId)
    # @session.userId access triggers automatic 401 if session cookie is missing/invalid

  @live let me = getMe()

  header
    heading "{me.name}"
    text "Email: {me.email}"
```

If the request has no valid session, Arc returns 401 before `getMe()` runs. You don't write middleware.

## Updates after first render

If the user wants the `@live` value to refresh after a button click, reference it from a `@server fn` invocation:

```arc
@server fn getStats() -> Stats
  return await db.stats.fresh()

@live let stats = getStats()
button on:click={ stats = await getStats() } "Refresh"

text "Revenue: ${stats.revenue}"
```

The button click triggers an ADP binary call; the response decodes to `Stats` and updates bound elements — no full reload.

## Anti-patterns

- ❌ **Chaining `@live` resolvers** that depend on each other: `@live let user = getUser(); @live let posts = getPosts(user.id)` — defeats parallelism. Make one `@live let { user, posts } = getEverything()` instead.
- ❌ **Using `@live` for static data**: if the value is the same for everyone, use `@build` (zero edge function cost, zero per-request latency).
- ❌ **Using `@live` for client-only state**: form inputs, toggles → `@state`. Edge rendering of pure UI state is wasted compute.
- ❌ **Adding loading skeletons** before `@live` data — there is no loading state. The HTML arrives with data already in it.
- ❌ **`@live let x = someExpression()` where `someExpression` is not a `@server fn`** — must be a server function (or stdlib call that compiles to one).
- ❌ **Accessing `@session` outside `@server`** — only available in `@server fn` bodies, validated at edge boundary.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Each `@live let` calls an independent `@server fn`** — no chains, no shared dependencies that block parallelism.
- [ ] **All `@server fn` signatures are typed** (params + return) — Arc needs types to generate the ADP wire format.
- [ ] **Edge function emit verified**: after build, check `dist/_arc/renderer.js` exists and contains `Promise.all`.
- [ ] **`@session` accesses are explicit** so Arc knows to validate.
- [ ] **No spinner UI** — `@live` is server-rendered, no loading state to show.
- [ ] **Error path defined**: wrap server logic in `try { ... } catch { return Err(...) }` if it can fail; otherwise the edge worker returns 500 with no user-visible message.
- [ ] **LCP impact stated**: total `@live` resolution time directly affects LCP. Each resolver should run in <100 ms typical. If any takes >500 ms, consider caching (edge KV) or moving to `@build` if data allows.
- [ ] **No PII in `console.error`** that the edge logs (Cloudflare/Deno log streams may persist; scrub user data).
