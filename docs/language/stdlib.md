# Standard Library

Arc's standard library lives in `/home/claude/arc/stdlib/` and is written **in Arc**. Importing a stdlib module costs 0 bytes — it inlines like any other Arc widget.

```arc
import { router } from "arc/router"
import { store } from "arc/store"
import { fetch } from "arc/fetch"
import { Form } from "arc/form"
import { icon } from "arc/icons"
```

## `arc/router` — View Transitions routing

Client-side routing for multi-page sites using the View Transitions API + Arc's auto-emitted `<link rel="prefetch">` from `arc build-site`.

```arc
import { router } from "arc/router"

page "App"
  nav
    link href="/" "Home"
    link href="/about" "About"
    link href="/blog" "Blog"
  main
    router()                  // renders the current route's content
```

Behavior:
- Intercepts in-app `<a>` clicks
- Triggers View Transition (smooth fade by default)
- Updates `<title>` + meta from the new page
- Falls back to full navigation for browsers without View Transitions

Configure:

```arc
router({
  transition: "slide-left",         // built-in: fade | slide-left | none
  prefetch: "viewport",             // hover | viewport | none
})
```

## `arc/store` — global reactive store

For state shared across widgets / pages:

```arc
import { store } from "arc/store"

const cart = store({ items: [], total: 0 })

widget AddToCart(productId)
  button on:click={ cart.items = [...cart.items, productId] } "Add"

widget CartBadge
  text "{cart.items.length}"
```

`store(initial)` returns a proxy. Reads subscribe automatically; writes notify subscribers. Each subscriber gets a direct DOM update (same mechanism as `@state`).

## `arc/fetch` — typed API client + ADP

```arc
import { fetch } from "arc/fetch"

type User = { id: String, name: String }

@server fn getUsers() -> User[]
  return await db.users.findAll()

@state let users: User[] = []

button on:click={
  users = await fetch.adp<User[]>("/api/users")     // ADP binary, decoded to User[]
} "Load"
```

`fetch.adp<T>(url, opts)` uses Arc Data Protocol — 3× smaller than JSON, 10× faster decode. See [ADP reference](../reference/adp.md).

`fetch.json<T>(url, opts)` for regular JSON when interoperating with non-Arc APIs.

## `arc/form` — enhanced form with validation

```arc
import { Form } from "arc/form"

type ContactInput = {
  name: String
  email: Email
  message: String
}

@server fn submitContact(data: ContactInput) -> Result<String, String>
  return Ok("Thanks!")

Form(onSubmit={ data => submitContact(data) })
  input name="name" required minlength=2
  input type="email" name="email" required
  textarea name="message" required minlength=10
  button type="submit" "Send"
```

Arc auto-derives client validation from the `@server` fn's input type. Errors render inline via the `Form`'s slot:

```arc
Form(onSubmit={ ... })
  ...
  @slot errors
    for err in errors
      text "{err.field}: {err.message}"
```

## `arc/icons` — optimized SVG icons

```arc
import { icon } from "arc/icons"

icon("check")               // emits inline SVG, ~120 B
icon("trash", size=20, color="red")
```

The compiler tree-shakes unused icons — only the ones actually referenced ship.

Custom icon set:

```arc
import { icon } from "arc/icons"
import { register } from "arc/icons"

register({
  "my-logo": "<path d='...' />",
})

icon("my-logo")
```

## Adding to stdlib

The stdlib is just Arc files in `/home/claude/arc/stdlib/`. Each module is a widget or a set of related widgets/functions. To contribute:

1. Add `stdlib/mymod.arc` 
2. Add tests in `tests/stdlib.test.js`
3. Submit a PR. See [Contributing](../internals/contributing.md).

## Next

- [ADP](../reference/adp.md) — wire format used by `arc/fetch`
- [Recipe: Forms](../recipes/forms.md) — `arc/form` patterns
- [Recipe: Routing](../recipes/routing.md) — `arc/router` patterns
