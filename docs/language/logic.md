# Logic + Control Flow

Arc's expression and control-flow vocabulary. Designed to match JS where compatible, fix it where not.

## Variables

```arc
const x = 42           // immutable
let y = "hello"        // mutable
y = "world"
```

`var` is banned (compile error).

## Functions

```arc
fn double(x) => x * 2                    // expression body
fn greet(name) {
  return "Hello, " + name
}

fn add(a: Number, b: Number) -> Number   // typed
  return a + b
```

## Classes

```arc
class User
  @name = ""                  // instance field (replaces this.name)
  @age = 0

  fn greet() => "Hi, I'm @{@name}"

  @get isAdult() => @age >= 18

  static fn anonymous() {
    return new User()
  }
```

Methods are **auto-bound** — passing `user.greet` as a callback always works.

## Conditionals

```arc
if x > 10
  text "big"
else if x > 0
  text "small"
else
  text "zero or negative"

unless user                  // equivalent to: if !user
  link href="/login" "Sign in"
```

## Loops

```arc
for i in 0..10              // exclusive
  text "{i}"

for i in 0..=10             // inclusive
  text "{i}"

for item in items
  card "{item.name}"

for i, item in items        // with index
  text "{i + 1}. {item.name}"

for key, value in object    // object iteration
  text "{key}: {value}"

while condition
  ...

until condition             // while not condition
  ...

loop                        // infinite (break with `return` or `break`)
  ...
```

## `match` — exhaustive pattern matching

```arc
const label = match status {
  "loading"           => "Loading…"
  "success"           => "Done"
  "error"             => "Try again"
  _                   => "Unknown"           // required catch-all
}
```

Type guards:

```arc
match value {
  x is Number   => x * 2
  x is String   => x.length
  x is Array    => x.length
  _             => 0
}
```

Object destructuring:

```arc
match action {
  { type: "increment" }              => state.count + 1
  { type: "set", payload: n }        => n
  { type: "reset" }                  => 0
  _                                  => state.count
}
```

`match` is **exhaustive**: omitting `_` is a compile error unless every variant is statically covered.

## Pipeline operator (`|>`)

```arc
const result = data
  |> filter(x => x.active)
  |> map(x => x.name)
  |> sort
  |> take(10)
```

Equivalent to:

```arc
const result = take(sort(map(filter(data, x => x.active), x => x.name)), 10)
```

Reads top-to-bottom, no nested parens.

## `Result` type — Ok / Err

For functions that can fail without exceptions:

```arc
fn divide(a: Number, b: Number) -> Result<Number, String>
  if b == 0
    return Err("Division by zero")
  return Ok(a / b)

match try divide(10, 2) {
  Ok(v)   => text "Got {v}"
  Err(e)  => text "Failed: {e}"
}
```

`try expr` extracts the value or propagates the error up.

## Equality

```arc
1 == 1                       // true
1 == "1"                     // ERROR: type mismatch at compile
none == none                 // true
NaN == NaN                   // true (fixed from JS)
```

`==` is always strict. `===` doesn't exist.

## Null coalesce + optional chaining

```arc
const name = user?.profile?.name ?? "Anonymous"
const items = data?.items ?? []
```

`??` returns the right side when the left is `none` (NOT for `0`, `""`, `false`).

## Truthiness

Only `false` and `none` are falsy. Specifically:

```arc
if 0           // true
if ""          // true
if []          // true
if {}          // true
if false       // false
if none        // false
```

This is intentional — explicit emptiness checks (`x.length > 0`, `x !== ""`) are clearer than relying on truthiness.

## Spread + destructuring

```arc
const merged = { ...a, ...b }
const [first, ...rest] = items
const { name, age } = user
const { name: userName, age: userAge } = user      // rename
```

## Async / await

```arc
@server fn loadUser() -> User
  const r = await fetch("/api/me")
  const data = await r.json()
  return data
```

`await` is allowed in `@server`, `@worker`, `@build`, and inside `async fn` bodies. The Arc compiler may warn `"await" used outside async context` for declarative contexts — the edge runtime wraps in `async` automatically.

## Type assertions

```arc
const arr = value as Array<String>     // when you know better
const n = parseInt(s) as Number
```

Use sparingly — Arc's type checker prefers inference.

## Comments

```arc
// single line only — no block comments
```

## Banned

| Construct | Why | Alternative |
| --- | --- | --- |
| `var` | Hoisting footgun | `let`, `const` |
| `null` | Two empty values is one too many | `none` |
| `===`, `!==` | Confusing alongside `==` | `==` is already strict |
| `function` | Verbose | `fn` |
| `this` | Implicit binding errors | `@field` |
| `for ... in` (object) | Iterates inherited keys | `for k, v in obj` |
| `switch` | Not exhaustive | `match` |
| `typeof`, `instanceof` | Different rules per type | `x is Type` |
| `with`, `void`, `eval`, `delete` | Footguns | (no replacement) |
| Truthy `0` / `""` | Confusing | Explicit comparison |

## Next

- [Reactive](reactive.md) — `@state`/`@computed` semantics
- [Types](types.md) — type system reference
