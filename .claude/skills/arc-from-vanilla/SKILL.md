---
name: arc-from-vanilla
description: Use when the user pastes plain HTML (+ inline CSS + inline JS) and wants the Arc equivalent. Converts script tags to @state/@server, inline styles to design blocks, manual fetches to @build/@live/@server.
---

# arc-from-vanilla

**When to use:** the user pastes an `.html` file or `<script>` + `<style>` blocks and asks for the Arc translation.

**Reference docs:** `docs/guides/migrating-from-vanilla.md`.

## Translation table

| HTML pattern | Arc equivalent |
| --- | --- |
| `<!doctype html>` + `<html>` + `<head>` + `<body>` | `page "Title"` — Arc auto-emits the entire document chrome |
| `<meta charset>`, `<meta viewport>` | Auto-emitted, don't write manually |
| `<title>X</title>` | `page "X"` |
| `<meta name="description">` | `page "X" description="..."` |
| `<link rel="stylesheet">` | `design { ... }` block at end of page |
| `<script>` block doing state | `@state let x = ...` + `on:event={...}` handlers |
| `<script>` fetching data on load | `@build` (compile-time) OR `@live` (per-request) OR `@server` (on-action) |
| `document.getElementById('x')` | `id="x"` + Arc bindings (rarely needed; use `bind:value` / `on:event`) |
| `addEventListener('click', fn)` | `on:click={ fn() }` |
| `innerHTML = '...'` | Reactive interpolation: `text "{value}"` |
| `<form>` with manual fetch | `form on:submit={ await @server-fn() }` |
| `<button>` (no type) | `button` (Arc auto-adds `type="button"` — prevents accidental submit) |
| `<a href="https://external">` | `link href="https://external"` (Arc auto-adds `target="_blank" rel="noopener noreferrer"`) |
| `<img src>` without dimensions | `img src` (Arc auto-adds width/height + lazy-load via image pipeline) |
| Inline `style="..."` | Move to `design` block; Arc scopes automatically |

## Concrete examples

### Vanilla counter → Arc

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Counter</title>
</head>
<body>
  <button id="incr">Count: 0</button>
  <script>
    let count = 0
    const btn = document.getElementById('incr')
    btn.addEventListener('click', () => {
      count++
      btn.textContent = `Count: ${count}`
    })
  </script>
</body>
</html>
```

```arc
page "Counter"
  @state let count = 0
  button on:click={ @count += 1 } "Count: {count}"
```

Arc replaces 15 lines with 3, AND auto-emits SEO/security defaults (CSP, OG, robots) the vanilla version skipped.

### Vanilla fetch-on-load → Arc @build

```html
<div id="users"></div>
<script>
  fetch('/api/users').then(r => r.json()).then(users => {
    document.getElementById('users').innerHTML =
      users.map(u => `<li>${u.name}</li>`).join('')
  })
</script>
```

If the user list is the same for all visitors:

```arc
@build const users = await fetch("https://api.example/users").then(r => r.json())

ul
  for u in users
    li "{u.name}"
```

The users are inlined as HTML at compile time. **Zero runtime fetch. Zero JavaScript.**

If per-user:

```arc
@server fn getUsers() -> User[]
  return await db.users.find({ visibleTo: @session.userId })

@live let users = getUsers()

ul
  for u in users
    li "{u.name}"
```

Server-rendered, no loading flash, no client fetch.

### Vanilla form → Arc

```html
<form id="contact" action="/contact" method="POST">
  <input name="email" type="email" required>
  <button>Send</button>
</form>
<script>
  document.getElementById('contact').addEventListener('submit', async e => {
    e.preventDefault()
    await fetch('/contact', { method: 'POST', body: new FormData(e.target) })
  })
</script>
```

```arc
@state let email = ""
@server fn submit(email: Email) -> Result<String, String>
  await db.contacts.add(email)
  return Ok("Thanks!")

form on:submit={ await submit(email) }
  input type="email" bind:value={email} required
  button type="submit" "Send"
```

`Email` type auto-validates server-side AND emits matching client-side validation.

### Vanilla CSS → Arc design block

```html
<style>
  .card { padding: 24px; border-radius: 8px; background: #fff; }
  @media (max-width: 640px) { .card { padding: 16px; } }
  @media (prefers-color-scheme: dark) { .card { background: #1a1a1a; } }
</style>
<div class="card">Hello</div>
```

```arc
card "Hello"

design
  card
    p: 24px
    radius: 8px
    bg: #fff
    @mobile { p: 16px }
    @dark { bg: #1a1a1a }
```

Arc scopes the class automatically (no global namespace), maps shorthand (`p:` → `padding:`), and emits proper media queries.

## What auto-improves when translating

| Hand-written HTML you'd need to remember | Arc auto-applies |
| --- | --- |
| `<meta http-equiv="Content-Security-Policy">` | yes |
| Open Graph + Twitter Card meta | yes (when description/image set) |
| JSON-LD structured data | yes (when schemaType set) |
| Skip link (`<a href="#main">`) | yes (when `<main>` exists) |
| `<main id="main-content">` injection | yes (if absent) |
| `loading="lazy"` on below-fold images | yes (via image pipeline + AST analysis) |
| `width`/`height` on images (prevents CLS) | yes (via image pipeline reading file header) |
| `<button type="button">` default | yes (prevents accidental submit) |
| `target="_blank" rel="noopener noreferrer"` on external links | yes |
| `prefers-reduced-motion` CSS reset | yes (in base layer) |
| `:focus-visible` styles | yes |

## What's lost in translation (intentionally)

- **No build step (vanilla wins here)** — Arc adds a 0.1 s compile step. But everything else gets better.
- **Smallest absolute byte count** — vanilla can hit ~500 B for a simple page. Arc adds ~80 B of auto-emitted SEO/security defaults (CSP, OG, robots).
- **Direct `<script>` embedding** — Arc doesn't let you inline arbitrary JS into HTML for security (CSP). Use `@state` / `@server fn` / event handlers.

## Anti-patterns when translating

- ❌ **Keeping `<!doctype html>` + `<html>` + `<head>` + `<body>`** in output — Arc auto-emits, will reject manual.
- ❌ **Preserving `getElementById` / `addEventListener`** — use `bind:value` / `on:event`.
- ❌ **Keeping `<style>` blocks** in the page body — move to `design`.
- ❌ **Preserving inline `<script>`** — Arc forbids inline scripts for CSP. Convert to `@state` / `@server`.
- ❌ **Replicating manual ARIA when Arc auto-applies it** — Arc adds skip link, focus styles, `:focus-visible` for you.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **No `<!doctype>` / `<html>` / `<head>` / `<body>` / `<style>` / `<script>`** in output.
- [ ] **No manual `getElementById` / `addEventListener`** — use Arc bindings.
- [ ] **Data fetches classified** correctly: `@build` (same for everyone) / `@live` (per-request server-rendered) / `@server` (client-triggered).
- [ ] **Form has typed `@server fn`** with `Result<T, E>` return.
- [ ] **CSS moved to `design` block**, with Arc shorthand where applicable (passthrough OK for anything Arc doesn't have).
- [ ] **SEO meta added if missing** — set `description`, `canonical`, `image`, `schemaType` for shareable pages.
- [ ] **Lines reduced**: the Arc version should be 30–70% shorter than the original HTML+CSS+JS (it's almost always shorter).
- [ ] **Bytes shipped reduced**: state the rough delta. Arc almost always wins because of CSS dedup + scoped output + no inline `<script>`.
