---
name: arc-debug-live-streaming
description: Use when a `@live` page hangs, returns 500, doesn't render data, or shows blank HTML. Walks through edge-renderer logs, parallel resolution, session validation, and template substitution.
---

# arc-debug-live-streaming

**When to use:** the user reports their `@live` page is "hanging", "blank", "returning 500", "data not appearing", or "loading forever".

**Reference docs:** `docs/features/edge-rendering.md`, `dist/_arc/renderer.js` (auto-generated).

## Diagnosis flow

### 1. Is there a `@live` decl at all?

```bash
grep -r "@live let\|@live const" <project>/*.arc
```

No matches → there's no edge function. Use `arc build` (not `arc build-site`) for static pages. The user may have confused `@live` with `@server` or `@state`.

### 2. Did `dist/_arc/renderer.js` emit?

After `arc build`, check:

```bash
ls dist/_arc/
# Should show: functions.js (if @server fns)
#             renderer.js (if @live decls)
```

If `renderer.js` is missing, the build skipped it — verify `@live` actually parses (run `arc check`).

### 3. Run the edge function locally

```bash
node -e "
const handler = require('./dist/_arc/renderer.js').default
const req = new Request('http://localhost/', { headers: { cookie: 'session=test' } })
handler.fetch(req, {}, {}).then(r => r.text()).then(html => console.log(html.slice(0, 1000)))
"
```

If this returns 500 → check stderr for `[arc] @live data error: ...`.

### 4. Check `_resolveData` runs in parallel

Open `dist/_arc/renderer.js`. Look for:

```js
async function _resolveData(request) {
  const _session = request._arc_session ?? {}
  try {
    const [user, stats] = await Promise.all([(getUser()), (getStats())])
    return { user, stats }
  } catch (e) { ... }
}
```

If it's NOT `Promise.all` (e.g., sequential `await`), Arc's parallel-resolver bug returned. File an issue with the Arc version.

### 5. Check each `@server fn` works in isolation

```bash
node -e "
const fns = require('./dist/_arc/functions.js')
fns.getUser('current').then(console.log).catch(console.error)
"
```

If this throws, the `@server fn` body has a bug — not Arc's fault. Check:
- DB connection string
- `@session.userId` access without a valid session
- External fetch URL reachable from the edge environment

### 6. Session validation failing → 401 before your fn runs

If `@session.userId` is accessed and there's no valid session cookie, Arc returns **401 Unauthorized** without running your `@server fn`. Verify:

```bash
curl -v -H "Cookie: session=YOUR_TOKEN" http://localhost:PORT/
```

Status 401 = session invalid. Check `arc.config.json` `session.validate` config + the cookie value sent.

### 7. Template substitution missing

The HTML has placeholder spans like `<span data-arc-live id="_a1"></span>` that get filled by `_fillHtml(data)`. If you see those spans in the served HTML, `_fillHtml` didn't run — usually means `_resolveData` returned `__arc_render_error__: true`.

Check the edge logs for `[arc] @live data error: <message>`.

### 8. Streaming half-renders

Arc's edge handler returns a `ReadableStream` — head flushes immediately, body flushes after data resolves. If the user sees the head but no body (page "hangs"):

- A `@server fn` is hanging (infinite await on a fetch that never resolves)
- Add timeout to the fetch: `fetch(url, { signal: AbortSignal.timeout(5000) })`
- Check edge worker logs for timeout messages

### 9. CSP / CORS issues with external fetches

If `@server fn` fetches `https://api.external/...`:
- Cloudflare Workers: outbound fetch works by default
- Deno Deploy: same
- Node `arc deploy --target node`: same
- Browser-side (NOT the case for `@server`, but verify): would need CORS allow

If the external API returns CORS errors, it's not Arc — fix the upstream.

### 10. Browser cache showing stale HTML

Arc emits `Cache-Control: private, no-cache` on `@live` responses — but a CDN in front may cache. Verify:

```bash
curl -v http://your-site/ 2>&1 | grep -i "cache-control"
```

If you see `public, max-age=...`, your CDN config is overriding Arc's headers. Adjust the CDN's caching for the dynamic path.

## Common LLM-generated bugs

- **Sequential `@live let` chains** that depend on each other → defeats parallelism. Fix: combine into one `@live let { a, b } = serverFn()`.
- **`@server fn` throwing instead of `return Err(...)`** → edge worker returns 500 with no user-visible message.
- **Forgetting `await` inside `@server fn` body** → returns a Promise as the response, ADP encodes weirdly.
- **Accessing `process.env` in `@server fn`** → only works on Node target; fails on Cloudflare Workers. Use `env` binding instead.

## Anti-patterns

- ❌ **Adding client-side loading skeleton** for `@live` data — `@live` is server-rendered, no client loading state.
- ❌ **Polling `@server fn` to refresh `@live` data** — that's just inefficient `@realtime`. Either use real `@realtime` or full page reload.
- ❌ **Try/catch around `@live let` declarations** — they're not statements; the edge function wraps them in try/catch automatically. Wrap inside the `@server fn` body instead.
- ❌ **Modifying `dist/_arc/renderer.js` by hand** — regenerated every build. Make the source change in `.arc`.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **`@live` declared at the page level**, not inside a widget (widgets don't get edge functions).
- [ ] **`@server fn` typed** (params + return type) so ADP works.
- [ ] **`@server fn` uses `return Err(...)`** not throw, for fallible operations.
- [ ] **`_resolveData` uses `Promise.all`** (verify in `dist/_arc/renderer.js`).
- [ ] **Edge function logs accessible**: `wrangler tail` (Cloudflare) / dashboard stream (Deno) / stdout (Bun/Node).
- [ ] **Session validation tested**: try a request with and without a valid cookie; expect 200 vs 401.
- [ ] **External fetch timeouts set**: never `await fetch(...)` without `signal: AbortSignal.timeout(N)` — a stuck origin will hang the edge function.
- [ ] **Time complexity stated**: edge function runs on EVERY request. If any fn is O(n) over a big collection, cache at the edge (KV).
- [ ] **No PII in `console.error`** logged from edge — log streams persist.
