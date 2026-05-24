# Realtime — `@realtime` channels

For data that updates after the page loads — chat, presence, live counters, collaborative editing — Arc generates a WebSocket client with ADP binary frames.

## The pattern

```arc
page "Chat"
  @realtime let messages = channel("chat/room-42")

  main
    for msg in messages
      card
        text "{msg.author}: {msg.body}"

    form on:submit={ messages.send({ author: "Me", body: input.value }) }
      input bind:value={draft}
      button type="submit" "Send"
```

What Arc generates:

```js
// Auto-generated client
const _ws = new WebSocket("wss://your-app/realtime/chat%2Froom-42")
_ws.binaryType = "arraybuffer"

const _messages = []
_ws.addEventListener("message", (ev) => {
  const frame = _adpDecode(new Uint8Array(ev.data))
  if (frame.type === "append") _messages.push(frame.value)
  if (frame.type === "set") _messages.splice(0, _messages.length, ...frame.value)
  _renderMessages()
})

// Auto-reconnect with exponential backoff
_ws.addEventListener("close", () => setTimeout(() => location.reload(), 1000))
```

The client is ~800 B gzipped, including ADP decoder.

## Wire format (ADP frames)

Each frame is an ADP-encoded object:

```
{
  type: "append" | "set" | "delete" | "error",
  value: <any>,
  meta?: <any>
}
```

ADP encodes 3× smaller than JSON and decodes 10× faster. See [ADP reference](../reference/adp.md).

## Server side

You provide the server. Arc gives you the client. The server's job:

1. Accept WebSocket connections at `wss://your-app/realtime/<channel>`
2. Validate session (Arc forwards the request cookies)
3. Subscribe the connection to channel events
4. Send ADP-encoded frames as state changes

Three common server choices:

### Cloudflare Durable Objects

`arc deploy --target cloudflare` generates a Durable Object stub for each `@realtime` channel:

```js
// auto-generated
export class ChatRoom42 extends DurableObject {
  async fetch(req) {
    const [, ws] = await this.acceptWebsocket(req)
    this.connections.add(ws)
    return new Response(null, { status: 101 })
  }
}
```

You fill in the broadcast logic; Arc generates the routing + ADP encode side.

### Bun / Node standalone

`arc deploy --target bun` / `node` emits a `realtime-server.js` with the WebSocket upgrade boilerplate. You add the broadcast logic.

### Connect your own (Redis pub/sub, Postgres LISTEN, etc.)

Override the channel URL via config:

```json
{ "realtime": { "url": "wss://my-realtime-broker.example" } }
```

## Send

`channel("name").send(value)` ADP-encodes and sends:

```arc
form on:submit={ messages.send({ author: me.name, body: draft }) }
```

Becomes:

```js
const buf = _adpEncode({ author: _me.name, body: _draft })
_ws.send(buf)
```

## Presence

For "who's online" lists:

```arc
@realtime let presence = channel("presence/room-42")

text "{presence.length} online"
for user in presence
  img src="{user.avatar}" alt="{user.name}"
```

The server emits `{ type: "set", value: [...users] }` on join/leave. Arc updates the list directly.

## Auto-reconnect

The client auto-reconnects on disconnect with exponential backoff (1 s → 2 s → 4 s → 8 s, capped at 30 s). On successful reconnect, the server should send a `{ type: "set", value: <current state> }` frame so the client resyncs.

## Send confirmation / optimistic updates

```arc
@realtime let messages = channel("chat/room-42")
@state let pending = []     // local optimistic queue

fn submit(text) {
  const tmpId = crypto.randomUUID()
  @pending = [...pending, { id: tmpId, body: text, sending: true }]
  messages.send({ tmpId, body: text })
}

// Server echoes back { tmpId, id: realId, body, sentAt }
// On frame arrival, we'd swap pending[tmpId] → confirmed message
```

For more complex sync, use `arc/store` (see [Stdlib](../language/stdlib.md)).

## Multiple channels

```arc
@realtime let messages = channel("chat/room-42")
@realtime let presence = channel("presence/room-42")
@realtime let typing = channel("typing/room-42")
```

Arc multiplexes over a single WebSocket connection where possible.

## Auth

Server-side, `@session` is available in your channel handler (validate the WebSocket upgrade request's cookies). Arc forwards cookies on the WS handshake.

## Internals

Generator: `/home/claude/arc/src/realtime/client.js`. Wire format: [ADP reference](../reference/adp.md).

## Next

- [Recipe: API Fetching](../recipes/api-fetching.md) — when to use `@build` vs `@live` vs `@realtime`
- [ADP](../reference/adp.md) — wire format spec
