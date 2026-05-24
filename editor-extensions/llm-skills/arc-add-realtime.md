---
name: arc-add-realtime
description: Use when the user wants live pushed updates from server to browser — chat, presence, collaborative editing, live counters, notifications. Triggers on "chat", "live updates", "presence", "WebSocket", "real-time", "pushed from server".
---

# arc-add-realtime

**When to use:** data updates need to push from server to browser without the user reloading the page. Distinct from `@live` (one-shot per page request) and `@server` (one-shot per user action).

**Reference docs:** `docs/features/realtime.md`, `docs/reference/adp.md`.

## Pattern

`@realtime let messages = channel("name")` declares a WebSocket subscription. Arc generates:
1. WebSocket connection management with auto-reconnect (exponential backoff: 1s → 2s → 4s → 8s, capped at 30s)
2. ADP binary frame parser (3× smaller than JSON, 10× faster decode)
3. Direct DOM updates as frames arrive

Client cost: ~800 B gzipped (decoder + reconnect logic + binding wiring).

### Minimal chat

```arc
@realtime let messages = channel("chat/room-42")
@state let draft = ""

main
  for msg in messages live="polite"
    card
      text "{msg.author}: {msg.body}"

  form on:submit={
    messages.send({ author: "Me", body: draft })
    @draft = ""
  }
    input bind:value={draft}
    button type="submit" "Send"
```

`live="polite"` opts the rendered list into `aria-live` for screen readers — by default Arc does NOT auto-emit `aria-live` for reactive lists (would be noisy).

### Presence

```arc
@realtime let onlineUsers = channel("presence/room-42")

text "{onlineUsers.length} online"
for u in onlineUsers
  img src="{u.avatar}" alt="{u.name}"
```

### Multiple channels (multiplexed over one connection where possible)

```arc
@realtime let messages = channel("chat/room-42")
@realtime let presence = channel("presence/room-42")
@realtime let typing   = channel("typing/room-42")
```

## Sending

`channel("name").send(value)` ADP-encodes and sends:

```arc
messages.send({ author: "Me", body: text })
```

Becomes:

```js
const buf = _adpEncode({ author: "Me", body: _text })
_ws.send(buf)
```

## Server side (NOT auto-generated)

Arc generates the **client**. You provide the **server**. The server's job:
1. Accept WebSocket at `wss://your-app/realtime/<channel-name>`
2. Validate the session cookie (Arc forwards it on the WS handshake)
3. Subscribe the connection to channel events
4. Send ADP-encoded frames as state changes

Common server choices:
- **Cloudflare Durable Objects** — `arc deploy --target cloudflare` generates a DO stub per `@realtime` channel; you fill in broadcast logic
- **Bun / Node standalone** — `arc deploy --target {bun,node}` emits a `realtime-server.js` with WebSocket boilerplate
- **External broker** (Pusher, Ably, custom Redis pub/sub) — configure `arc.config.json` `realtime.url`

## Frame format

ADP-encoded objects:

```js
{
  type: "append" | "set" | "delete" | "error",
  value: <any>,
  meta?: <any>
}
```

- `append` → push to array (default behavior for `for x in messages`)
- `set` → replace entire array (use on reconnect to resync)
- `delete` → remove by id
- `error` → user-facing error message

## Optimistic updates

```arc
@realtime let messages = channel("chat/room-42")
@state let pending = []  # local optimistic queue

fn submit(text) {
  const tmpId = crypto.randomUUID()
  @pending = [...pending, { id: tmpId, body: text, sending: true }]
  messages.send({ tmpId, body: text })
}

# Server echoes back { tmpId, id: realId, body, sentAt }
# Listen for echo and swap pending[tmpId] → confirmed
```

## Anti-patterns

- ❌ **Polling with `@live` instead of using `@realtime`**: if updates need to push, don't fetch every second.
- ❌ **Using `@realtime` for one-time fetches**: persistent WebSocket connection has overhead. For "show user's current X once," use `@live`.
- ❌ **Not handling reconnect resync**: Arc auto-reconnects but the server must send a `{ type: "set", value: [...currentState] }` frame on connect so the client doesn't show stale data.
- ❌ **Sending huge payloads**: ADP is efficient but per-frame >100 KB will stress the connection. Paginate or use delta updates.
- ❌ **Mutating `messages` directly** — it's managed by Arc. Use `.send()` to publish; the local view updates when the server echoes back.
- ❌ **Skipping `live="polite"` on critical message lists** — screen readers won't announce new messages. Use `polite` (or `assertive` sparingly).

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Server-side endpoint exists or scaffold instructions provided** — `@realtime` client is auto-generated but useless without a WS server. Always mention this when scaffolding.
- [ ] **Channel name is parameterized appropriately**: per-room (`chat/{roomId}`), per-user (`notify/{userId}`) — not a global firehose.
- [ ] **Auth on the WS handshake**: server reads cookie from upgrade request. Don't forget — WebSockets bypass usual auth middleware unless you wire it in the upgrade handler.
- [ ] **Reconnect strategy includes resync**: server should send `{ type: "set", value: [...] }` on connect with current state.
- [ ] **Wire format is ADP** (`Content-Type: application/x-adp` for HTTP fallback if any). Don't mix JSON frames into the same channel.
- [ ] **`aria-live` opt-in on the message list**: `live="polite"` for chat, `live="assertive"` only for critical alerts (sparingly — overuse is screen-reader-hostile).
- [ ] **Time complexity**: list updates are O(1) for `append`/`delete-by-id`, O(n) for `set`. Most chat patterns are append-only → O(1).
- [ ] **Space complexity**: messages array grows unbounded. If retention matters, cap with `messages.slice(-100)` in the render template or have the server limit history.
- [ ] **Bytes**: WebSocket connection + reconnect logic is ~800 B gz (shared across all `@realtime` channels on the page). Adding more channels is ~0 incremental client bytes.
