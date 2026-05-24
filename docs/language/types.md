# Types

Arc has gradual typing. Annotations are optional but inferred where possible. The checker (`/home/claude/arc/src/checker.js`) runs at compile time.

## Primitives

| Type | Examples | Notes |
| --- | --- | --- |
| `String` | `"hello"`, `"line\nbreak"`, `"{name}"` | UTF-8, immutable |
| `Number` | `42`, `3.14`, `-0.5` | IEEE 754 double; no int/float distinction |
| `Boolean` | `true`, `false` | Only these two |
| `none` | `none` | The single empty value (no `null` AND no `undefined`) |
| `Date` | `new Date()`, `Date.now()` | Standard JS Date |
| `Array` | `[1, 2, 3]` | |
| `Object` | `{ key: value }` | |

## Type annotations

```arc
const name: String = "Alice"
let count: Number = 0
const items: Number[] = [1, 2, 3]
const user: { name: String, age: Number } = { name: "Alice", age: 30 }
```

On function signatures:

```arc
fn double(x: Number) -> Number => x * 2
fn greet(name: String, polite: Boolean = false) -> String
  return polite ? "Good day, " + name : "Hi " + name
```

On reactive declarations:

```arc
@state let count: Number = 0
@build const posts: Post[] = await fetch("/api/posts").then(r => r.json())
```

## Union types

```arc
fn statusText(status: "loading" | "success" | "error") -> String
  match status {
    "loading"  => "…"
    "success"  => "✓"
    "error"    => "✗"
  }

const id: Number | String = "abc-123"
```

## Type guards: `is`

```arc
if value is String
  text "{value.length} characters"
else if value is Number
  text "{value * 2}"
else
  text "unknown"
```

`is` narrows the type inside its branch. Works for primitives and user-defined classes.

## User types

```arc
type User = {
  id: String
  name: String
  email: Email           // see "Field types" below
  role: "admin" | "user"
  createdAt: Date
}

type Post = {
  id: String
  author: User           // nested
  tags: String[]
  publishedAt: Date | none
}

fn formatUser(u: User) -> String
  return "{u.name} <{u.email}>"
```

## Classes

```arc
class Account
  @id: String = ""
  @balance: Number = 0

  fn deposit(amount: Number) {
    @balance += amount
  }

  @get formatted() => "${@balance.toFixed(2)}"

  static fn create(id: String) -> Account {
    return new Account(@id: id)
  }
```

## Field types (built-in validators)

Arc has built-in semantic types that double as validators:

| Field type | Validates | Use in forms |
| --- | --- | --- |
| `Email` | RFC 5321 syntax | `<input type="email">` |
| `Url` | absolute URL | `<input type="url">` |
| `Phone` | E.164 | `<input type="tel">` |
| `PostalCode` | per-country | per-country |
| `Date`, `DateTime`, `Time` | ISO 8601 | `<input type="date">` etc. |
| `Slug` | URL-safe ascii | |
| `Color` | hex / rgb / hsl / oklch | `<input type="color">` |

```arc
type ContactForm = {
  name: String
  email: Email           // server + client validation auto-emitted
  phone: Phone | none
}
```

When such a type is used in an `@server` fn parameter, Arc auto-generates client-side validation matching the server's contract.

## `Result<T, E>`

For functions that may fail:

```arc
fn parsePrice(s: String) -> Result<Number, String>
  const n = Number(s)
  if Number.isNaN(n)
    return Err("Not a number: " + s)
  if n < 0
    return Err("Price must be non-negative")
  return Ok(n)

match parsePrice("19.99") {
  Ok(price)  => text "${price.toFixed(2)}"
  Err(msg)   => text "Error: {msg}"
}
```

Or with `try`:

```arc
fn checkout() -> Result<Order, String>
  const price = try parsePrice(input.value)    // propagates Err if fails
  return Ok(buildOrder(price))
```

## Generics

```arc
fn first<T>(arr: T[]) -> T | none {
  return arr.length > 0 ? arr[0] : none
}

class List<T>
  @items: T[] = []
  fn add(x: T) { @items.push(x) }
```

## Type inference

Most annotations are optional. The checker infers from context:

```arc
const x = 42                  // x: Number
const xs = [1, 2, 3]          // xs: Number[]
const user = { name: "Al" }   // user: { name: String }
fn double(x) => x * 2         // x: Number (inferred from * 2)
```

Annotate when:
- It's a public API (widget params, `@server` fn signatures)
- The inference is unclear or wrong
- Documentation would benefit a reader

## `none` vs JavaScript's `null` / `undefined`

Arc collapses both `null` and `undefined` to a single value: `none`.

```arc
let x = none
const y: String | none = none

// Detection
if x == none      // true
if x is none      // true
x ?? "default"    // returns "default"
```

When interoperating with JS APIs (browser DOM, npm libraries), Arc treats `undefined` as `none`.

## Banned

- `null` — use `none`
- `any` as a written annotation — let inference work, or use a union
- `unknown` — use a precise union or `Result`

## Next

- [Logic](logic.md) — control flow uses types
- [Reactive](reactive.md) — typed `@state`
- [ADP](../reference/adp.md) — how types map to binary wire format
