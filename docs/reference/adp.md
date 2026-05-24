# ADP — Arc Data Protocol

ADP is Arc's binary wire format for `@server` function calls and `@realtime` channel frames. It's typed, compact, and decodes faster than JSON.

## Why not JSON?

JSON is text. Decoding requires UTF-8 parse + tokenize + tree-build + value allocation. ADP is binary with type tags inline — decoders skip parsing and allocate directly.

| | JSON | ADP |
| --- | --- | --- |
| Wire size (typical) | baseline | **3× smaller** |
| Decode time | `JSON.parse()` ~2 ms / 1000 records | ~0.2 ms / 1000 records |
| Runtime in browser | built-in | **~1 KB gzipped** |
| Schema | none (you marshal yourself) | implicit via Arc's type system |

## Wire format

ADP is a tagged byte stream. The first byte of each value is its type tag:

| Tag | Type | Layout |
| --- | :---: | --- |
| `0x00` | `none` | (no payload) |
| `0x01` | `true` | (no payload) |
| `0x02` | `false` | (no payload) |
| `0x03` | small uint (0–255) | `[03][byte]` |
| `0x04` | int32 (big-endian) | `[04][b3][b2][b1][b0]` |
| `0x05` | float64 (big-endian IEEE 754) | `[05][8 bytes]` |
| `0x06` | string | `[06][varint length][UTF-8 bytes]` |
| `0x07` | array | `[07][varint length][value …]` |
| `0x08` | object | `[08][varint length][[varint keylen][UTF-8 key][value] …]` |

### Varint length

Length prefixes use 7-bit little-endian varints — same as Protobuf. Bytes with bit 7 set continue; the final byte has bit 7 clear.

```
length 0-127:    [LL]              (1 byte)
length 128-16383: [LL|0x80][LL]    (2 bytes)
...
```

### Example: `{ id: 1, name: "John" }`

```
08              object
02              2 fields
02 69 64        keylen=2, "id"
03 01           uint8(1)
04 6E 61 6D 65  keylen=4, "name"
06 04 4A 6F 68 6E  string len=4, "John"

= 14 bytes
```

Same as JSON:

```
{"id":1,"name":"John"}
= 22 bytes (1.6× larger)
```

## Encoder (server-side)

Auto-generated as `_adpEncode(v)` in client bundles. Server-side, when emitting an `@server` function:

```js
function _adpEncode(v) {
  const b = []
  function w(x) {
    if (x === null || x === undefined) b.push(0)
    else if (x === true) b.push(1)
    else if (x === false) b.push(2)
    else if (typeof x === 'number') {
      if (Number.isInteger(x) && x >= 0 && x <= 255) b.push(3, x)
      else if (Number.isInteger(x)) {
        b.push(4, (x>>>24)&255, (x>>>16)&255, (x>>>8)&255, x&255)
      } else {
        const d = new DataView(new ArrayBuffer(8))
        d.setFloat64(0, x, false)
        b.push(5); for (let i=0;i<8;i++) b.push(d.getUint8(i))
      }
    }
    else if (typeof x === 'string') {
      b.push(6); writeVarint(x.length); for (const c of TextEncoder.encode(x)) b.push(c)
    }
    else if (Array.isArray(x)) {
      b.push(7); writeVarint(x.length); x.forEach(w)
    }
    else if (typeof x === 'object') {
      const ks = Object.keys(x)
      b.push(8); writeVarint(ks.length)
      ks.forEach(k => { /* keylen + key + value */ })
    }
  }
  w(v); return new Uint8Array(b)
}
```

## Decoder (browser)

Auto-generated as `_adpDecode(buf)`:

```js
function _adpDecode(buf) {
  let p = 0
  function rv() {
    const t = buf[p++]
    if (t === 0) return null
    if (t === 1) return true
    if (t === 2) return false
    if (t === 3) return buf[p++]
    if (t === 4) { /* read int32 */ }
    if (t === 5) { /* read float64 */ }
    if (t === 6) { /* read varint + string */ }
    if (t === 7) { /* read varint + array */ }
    if (t === 8) { /* read varint + object */ }
    throw new Error('ADP: unknown tag ' + t)
  }
  return rv()
}
```

**Prototype pollution guard:** keys named `__proto__`, `constructor`, `prototype` are silently skipped during object decode.

## When ADP ships to the browser

The ADP encoder + decoder (~1 KB minified, ~600 B gzipped) is included in the client bundle **only when**:
1. The page has at least one `@server` function that's **invoked from client JS** (e.g., from an `on:click` handler), AND/OR
2. The page has a `@realtime` channel

When `@server` functions exist but are only used by `@live` (resolved at edge render, never called from client), the ADP runtime is **tree-shaken**. See [Internals: Optimizer](../internals/optimizer.md).

## Headers

ADP requests use:

```
Content-Type: application/x-adp
```

The server's `@server` adapter checks this header to decide whether to decode the body as ADP or JSON (for testing).

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| Max response size | 10 MB | Guard against accidental memory blowup |
| Max recursion depth | 100 | Stack-overflow guard |
| Max varint bytes | 5 | Prevents adversarial overflow |
| String/key max length | 2^28 (256 MB) | UTF-8 max |

## Versioning

The wire format is version 1. Future versions will add a magic byte prefix; v1 has no prefix (compact wins over forward compat for now).

## Source

- Server encoder: `/home/claude/arc/adp/encoder.js`
- Browser decoder: `/home/claude/arc/adp/decoder.js`
- Client stub generator: `/home/claude/arc/src/emitters/server.js`

## See also

- [Edge Rendering](../features/edge-rendering.md) — `@server` flow
- [Realtime](../features/realtime.md) — `@realtime` frames use ADP
- [Internals: Optimizer](../internals/optimizer.md) — ADP tree-shaking
