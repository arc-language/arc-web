# Migrating from Vanilla HTML

If you've been hand-writing HTML/CSS/JS, Arc gives you:
- The same output, less typing
- Automatic SEO, accessibility, and performance defaults
- Reactivity without a framework runtime
- Multi-page CSS dedup without manual link management

You can adopt Arc one page at a time.

## Direct translation

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hello</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
  <h1>Hello, World</h1>
  <p>Welcome.</p>
</main>
</body>
</html>
```

becomes:

```arc
page "Hello"
  main
    heading size=1 "Hello, World"
    text "Welcome."
```

`<!doctype>`, `<html>`, `<head>`, meta charset/viewport, `<body>`, scoped CSS link — Arc handles all of it.

## What you get for free

| Hand-written HTML you'd need to add | Arc auto-applies |
| --- | --- |
| `<meta name="robots">` | yes |
| CSP meta tag | yes (or via `_headers` for multi-page) |
| OG / Twitter meta | when you set `description`/`image` |
| JSON-LD structured data | when you set `schemaType` |
| Skip link | yes (when page has `<main>`) |
| `prefers-reduced-motion` CSS | yes |
| `:focus-visible` style | yes |
| `loading="lazy"` on below-fold images | yes |
| Image `width`/`height` (CLS prevention) | yes (via image pipeline) |
| `target="_blank" rel="noopener noreferrer"` on external links | yes |
| Auto `<picture>` with AVIF + WebP | yes (when sharp present) |

## Common patterns

### Click handler

```html
<!-- vanilla -->
<button id="incr">Count: 0</button>
<script>
let count = 0
document.getElementById('incr').addEventListener('click', () => {
  count++
  document.getElementById('incr').textContent = `Count: ${count}`
})
</script>
```

```arc
@state let count = 0
button on:click={ @count += 1 } "Count: {count}"
```

Arc emits ~50 B of JS — direct DOM updates, no framework.

### Fetch data on load

```html
<!-- vanilla -->
<div id="users"></div>
<script>
fetch('/api/users').then(r => r.json()).then(users => {
  document.getElementById('users').innerHTML = users.map(u => `<li>${u.name}</li>`).join('')
})
</script>
```

Two better alternatives in Arc:

**Option 1: fetch at build time** (if data is the same for all visitors):

```arc
@build const users = await fetch("https://api.example/users").then(r => r.json())
ul
  for u in users
    li "{u.name}"
```

The user list is **inlined as HTML**. Zero runtime fetch.

**Option 2: render at edge** (if data is per-user):

```arc
@server fn getUsers() -> User[]
  return await fetch("https://api.example/users").then(r => r.json())
@live let users = getUsers()
ul
  for u in users
    li "{u.name}"
```

Server fills the list before sending HTML. **No loading flash.**

### Form

```html
<!-- vanilla -->
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
@server fn submit(email: Email) -> none
  await db.contacts.add(email)

form on:submit={ await submit(email) }
  input type="email" bind:value={email} required
  button type="submit" "Send"
```

### CSS

Inline `<style>` works, but Arc's design block is scoped:

```arc
card "..."
design
  card
    p: 24px
    radius: 8px
    bg: #f5f5f5
    @dark { bg: #1a1a1a }
```

Or paste vanilla CSS:

```arc
design
  body
    background-image: linear-gradient(to right, red, blue)
    /* full CSS passthrough for anything not in Arc's shorthand */
```

### Multi-page CSS dedup

```html
<!-- vanilla — every page links to the same styles.css -->
<link rel="stylesheet" href="styles.css">
```

Arc with `arc build-site`:
- Per-page CSS is automatically deduped into `shared.{sha}.css`
- Each page links to it via `<link rel="stylesheet">`
- Browser caches once across all pages

You get the same behavior automatically when you have ≥2 pages.

## What Arc takes away

- No `<script>` tags (use `@state` / `@server` / `@realtime` instead)
- No global CSS without scoping (use `design` block; passthrough is opt-in)
- No `null` (use `none`)
- No `var` (use `let` / `const`)
- No `===` (use `==` — already strict)

## What you keep

- `<a>`, `<button>`, `<input>`, all semantic HTML elements work as-is
- Plain CSS works inside the `design` block (passthrough)
- Browser DOM APIs work in event handlers (`event.target`, `document.getElementById`, etc.)
- npm packages work in `@server` function bodies
- Service Workers, manifests, custom HTTP headers (via `_headers`)

## Incremental adoption

You can convert one page at a time:

1. Pick a low-traffic page
2. Translate it to `.arc`
3. Run `arc build` to produce `dist/index.html`
4. Deploy `dist/index.html` alongside your other HTML
5. When confident, convert more pages
6. Eventually run `arc build-site` for the whole site

Arc doesn't need a build system you don't have. Pure Node + zero deps.

## Next

- [Quick Start](../getting-started/first-page.md) — 5-minute tutorial
- [Core Concepts](../getting-started/concepts.md)
