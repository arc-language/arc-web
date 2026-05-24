---
name: arc-add-server-fn
description: Use when the user wants a function that runs on the server but is callable from the client — RPC, mutations, form submissions, anything triggered by a user action. Triggers on "RPC", "callable from client", "mutation", "API endpoint", "save to database".
---

# arc-add-server-fn

**When to use:** the client (browser) needs to invoke server-side logic in response to a user action (click, form submit). Distinct from `@live` (which renders server data into the initial HTML, no client invocation).

**Reference docs:** `docs/features/edge-rendering.md`, `docs/reference/adp.md`.

## Pattern

A `@server fn` declaration generates:
1. The function body runs on the edge (Cloudflare Worker / Deno Deploy / Bun / Node) at request time.
2. A typed client stub: `async function fnName(args) { ... fetch with ADP body ... }` that POSTs ADP-encoded args to `/_arc/fn/fnName`.
3. ADP encoder + decoder runtime in the client bundle (ONLY if any `@server fn` is actually called from client JS — otherwise tree-shaken).

### Minimal mutation

```arc
@server fn likePost(postId: String) -> Number
  return await db.likes.toggle({ user: @session.userId, postId })

@state let likeCount = post.likes

button on:click={ @likeCount = await likePost(post.id) }
  "♥ {likeCount}"
```

Time complexity: O(1) client-side. Server-side depends on `db.likes.toggle`.
Client bytes: ~250 B (stub + button handler) + ~600 B ADP runtime (shared across all `@server` fns on the page).

### Fallible operations with `Result<T, E>`

```arc
@server fn submitContact(data: { name: String, email: Email, message: String }) -> Result<String, String>
  if data.message.length < 10
    return Err("Message too short")
  await db.contacts.add(data)
  return Ok("Thanks!")

@state let result: String | none = none

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(msg)   => @result = msg
    Err(err)  => @result = "Error: " + err
  }
}
  ...
  if result
    text "{result}"
```

### @session validation (auto)

```arc
@server fn deletePost(id: String) -> Result<none, String>
  if @session.role != "admin"
    return Err("Forbidden")
  await db.posts.delete(id)
  return Ok(none)
```

If `@session.userId` (or `@session.role`, etc.) is accessed and the request has no valid session cookie, Arc returns **401 Unauthorized** before your function body runs. You don't write auth middleware.

## Tree-shake awareness

The ~600 B ADP runtime ships to the client ONLY when at least one `@server fn` is actually invoked from client code (an `on:click` handler, etc.). If `@server` fns exist but are only called from `@live`, the runtime is stripped.

**Verify** when scaffolding: the generated `@server fn` should be referenced from a client handler, or its presence is wasted setup.

## Anti-patterns

- ❌ **Throwing across the boundary**: `throw new Error("bad")` — instead `return Err("bad")` so the client can pattern-match. Throws cross-compile to a 500 with no user-visible message.
- ❌ **Untyped signatures**: `@server fn save(x)` — Arc can't generate client validation; ADP encoder falls back to JSON. Always type both params and return.
- ❌ **Accessing `@session` outside `@server`/`@live`** — it's only available at the edge boundary.
- ❌ **Returning non-serializable**: functions, Date objects with extra props, class instances. ADP supports primitives + arrays + plain objects. Use ISO date strings for dates.
- ❌ **Calling `@server fn` in `@computed`** — fires on every reactive change, hammers the server. Debounce, or restructure.
- ❌ **Forgetting `await`**: `const r = likePost(id)` returns a Promise. Use `await`.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Signature is fully typed**: params + return type. Untyped fns lose validation + ADP optimization.
- [ ] **Fallible fns return `Result<T, E>`**, not throw. Pattern-match at call site.
- [ ] **`@session` accesses are explicit** (`@session.userId`, `@session.role`) so Arc knows to validate at the edge.
- [ ] **Called from client JS**, OR the user is okay with the ~600 B ADP runtime cost. If only used by `@live`, prefer inline + no client invocation (saves bytes via tree-shake).
- [ ] **Idempotent or has CSRF protection**: state-changing fns should be safe to call multiple times OR protected. Arc adds CSRF tokens automatically for `@live`-rendered pages; static pages need `arc.config.json` `session.csrf: true`.
- [ ] **Server-side validation NOT skipped just because client validates**: defense in depth. The auto-generated client validation is convenience, not a security boundary.
- [ ] **Time complexity stated** for any new logic in the fn body — these run on every request.
- [ ] **No N+1 queries** in the fn body — batch DB calls if iterating over a list.
