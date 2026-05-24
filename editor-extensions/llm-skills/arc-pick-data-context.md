---
name: arc-pick-data-context
description: Use when the user describes data they need to display or fetch. Decides between @build, @state, @computed, @live, @realtime, @server. This is the most important architectural decision in Arc — get it right and the app stays fast forever.
---

# arc-pick-data-context

**When to use:** the user says anything like "fetch X", "show user data", "load posts from API", "where should this data live?", "how do I make this dynamic?".

**Reference docs:** `docs/recipes/api-fetching.md`, `docs/language/data-contexts.md`.

## Decision tree

```
Will the data ever change after the user loads the page?
├── No (or only at deploy time)              → @build
└── Yes
    ├── Changes per user?
    │   ├── Yes
    │   │   ├── Needed at initial render?    → @live (server-rendered, inlined HTML)
    │   │   └── Only after a user action?    → @server fn (called from event handlers)
    │   └── No (changes globally over time)
    │       ├── Pushed updates (chat, presence)?  → @realtime
    │       └── Just want fresher data?           → @live (re-renders on each request)

Has the user said the value should react to other reactive values?
└── Yes → @computed (depends on @state / @live values)

Is the value purely client-side UI state?
└── Yes → @state (counter, toggle, form input)
```

## What to ask the user (if intent is ambiguous)

- "Does this data change per visitor?"
- "Does it need to be in the HTML before the user sees anything?"
- "Does it update after the page loads?"

## The five answers, ranked by client-bytes cost (cheapest first)

| Context | Client bytes | When |
| --- | --- | --- |
| `@build` | **0 B** | Data known at compile time. Fetched once during `arc build`. |
| `@live` | **0 B** | Per-request server data. Streamed into initial HTML at the edge. |
| `@state` | ~50–200 B per var | Client UI state (counter, toggle, form). |
| `@computed` | ~30 B per binding | Derived from `@state` (`@computed let doubled = count * 2`). |
| `@server` (called from client) | ~600 B ADP runtime + ~200 B per stub | RPC for actions (form submits, mutations). |
| `@realtime` | ~800 B WebSocket client | Live pushed updates. |

Prefer the leftmost option that fits the data's actual lifetime.

## Examples (each shows the right pick)

### Static blog content
```arc
# Same posts for every visitor, changes only at deploy
@build const posts = await fetch("https://cms/posts").then(r => r.json())
```

### Per-user dashboard
```arc
# Server-rendered, no loading state, one round trip
@server fn getUser() -> User
  return await db.users.find(@session.userId)
@live let user = getUser()
heading "Welcome, {user.name}"
```

### Counter / UI state
```arc
# Local only, no server, no fetch
@state let count = 0
button on:click={ @count += 1 } "{count}"
```

### Search-as-you-type against a small dataset
```arc
@build const products = readFile("./products.json")  # Inlined at build
@state let query = ""
@computed let filtered = products.filter(p => p.name.includes(query))
input bind:value={query}
for p in filtered { card "{p.name}" }
```

### Search-as-you-type against a huge dataset
```arc
# Too big to inline. Use @server, debounce, and ADP for fast wire format.
@server fn search(query: String) -> Product[]
  return await db.products.search(query, 20)
@state let query = ""
@state let results: Product[] = []
input on:input={ setTimeout(async () => @results = await search(query), 300) }
```

### Chat
```arc
@realtime let messages = channel("chat/room-42")
for msg in messages { card "{msg.author}: {msg.body}" }
```

## Anti-patterns

- ❌ `@state` for data that's the same for every visitor → wasted client JS. Use `@build`.
- ❌ `@server` called in `@computed` to fetch on every reactive change → spams the server. Debounce, or move to `@live`.
- ❌ `@live` for purely-client state like form input → unnecessarily edge-rendered. Use `@state`.
- ❌ Calling `fetch()` directly inside a component body — Arc doesn't have that pattern. Use the context annotations.
- ❌ Storing a derived value as `@state` instead of `@computed` — you'll forget to update it.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Bytes match data lifetime**: did you reach for `@state` when `@build` would have shipped 0 bytes?
- [ ] **`@server` fns are typed**: parameters AND return type. Untyped = no auto-validation, no ADP optimization.
- [ ] **`@server` fns called from client are tree-shake friendly**: if no client `on:click` invokes a `@server`, Arc strips the ADP runtime (~600 B). Verify the client code actually calls them.
- [ ] **`@live` resolutions are parallelizable**: if you have multiple `@live let`, Arc wraps them in `Promise.all` automatically. Verify they're independent (no `@live let b = useA(a)` chains).
- [ ] **`@realtime` server exists**: client is auto-generated but the user must provide the WebSocket server (Durable Object / Bun WS / etc.). Mention this if scaffolding.
- [ ] **No `await` outside async context** — Arc warns. `@server fn` bodies are implicitly async; `@build` allows `await`; `@computed` does not.
