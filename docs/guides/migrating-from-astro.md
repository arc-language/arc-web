# Migrating from Astro

Astro and Arc share a lot: islands architecture, zero-JS-by-default, file-per-route. Most patterns translate directly. Arc has fewer plugins to install (image, sitemap, view transitions are all built-in).

## Mental model overlap

| Astro | Arc |
| --- | --- |
| `.astro` file | `.arc` file |
| Frontmatter `--- ... ---` | `@build`, `@server`, etc. at top of file |
| Component syntax: JSX-flavored | Indentation-based template |
| `Astro.props`, `Astro.params` | Widget parameters, page meta |
| `client:load` / `client:idle` islands | `@state` / event handlers |
| `getStaticPaths` | One `.arc` file per route |
| `Astro.glob('./posts/*.md')` | `@build const posts = ...` reading files |
| `<Image src={...}>` | `<img src=...>` (auto-optimized) |
| `astro/router` w/ View Transitions | `arc/router` (built-in) |
| `@astrojs/sitemap` | built-in via `arc build-site` |
| `@astrojs/image` | built-in image pipeline |

## Frontmatter → @build

```astro
---
const posts = await Astro.glob('./posts/*.md')
const featured = posts.find(p => p.frontmatter.featured)
---
<h1>{featured.frontmatter.title}</h1>
```

```arc
@build const posts = ["./posts/1.md", "./posts/2.md"].map(p => readFile(p))
@build const featured = posts[0]   // simplified

heading "{featured.title}"
```

## Component → widget

```astro
---
// Card.astro
const { title, body } = Astro.props
---
<article>
  <h2>{title}</h2>
  <p>{body}</p>
</article>
```

```arc
// Card.arc
widget Card(title, body)
  card
    heading "{title}"
    text "{body}"
```

Invocation:

```astro
<Card title="Hi" body="World" />
```

```arc
Card("Hi", "World")
```

## Slots / children

```astro
---
// Wrapper.astro
const { title } = Astro.props
---
<div>
  <h2>{title}</h2>
  <slot />
</div>
```

```arc
widget Wrapper(title)
  card
    heading "{title}"
    @slot
```

## `client:load` islands

```astro
<Counter client:load />
```

```arc
// Arc doesn't have "islands" — every page is hydration-free unless @state is used.
// If your widget has @state, it's automatically reactive.
Counter()
```

## Image

```astro
import { Image } from 'astro:assets'
import hero from '../assets/hero.jpg'
<Image src={hero} widths={[400, 800]} sizes="100vw" alt="Hero" />
```

```arc
img src="hero.jpg" alt="Hero"
// Arc auto-derives widths from layout context, picks AVIF/WebP, sets
// fetchpriority + dimensions, dominant-color fill.
```

## SSR data

```astro
---
const r = await fetch('/api/user', { headers: Astro.request.headers })
const user = await r.json()
---
<h1>Welcome, {user.name}</h1>
```

```arc
@server fn getUser() -> User
  return await fetch("/api/user", { headers: { cookie: @session.cookie } })
    .then(r => r.json())
@live let user = getUser()
heading "Welcome, {user.name}"
```

## Multi-page

```astro
// astro.config.mjs
// content collection setup, getStaticPaths, etc.
```

```arc
// Just put one .arc per route + arc build-site.
// build-site auto-generates sitemap.xml, shared CSS, _headers, prefetch.
```

## Sitemap

```astro
// astro.config.mjs
import sitemap from '@astrojs/sitemap'
export default { integrations: [sitemap({ ... })] }
```

```arc
// Nothing to configure. Set meta.canonical on each page; arc build-site emits sitemap.xml.
page "Hello" canonical="https://example.com/hello"
```

## View Transitions

```astro
---
import { ViewTransitions } from 'astro:transitions'
---
<head>
  <ViewTransitions />
</head>
```

```arc
// arc build-site auto-injects <meta name="view-transition" content="same-origin">
// in every page that has same-site links. Opt out with prefetch=false viewTransitions=false.
```

## CSS

```astro
<style>
  .card { padding: 24px; }
</style>
```

```arc
design
  card
    p: 24px
```

Both are scoped automatically. Arc's `design` block uses Arc vocabulary (`p:` for padding, etc.) but accepts CSS passthrough for anything not in the shorthand.

## Things Arc does that Astro requires plugins for

| Feature | Astro plugin | Arc |
| --- | --- | --- |
| Sitemap | `@astrojs/sitemap` | built-in |
| Image opt | `@astrojs/image` | built-in |
| Sharp / Vite image | bundled | optional dep |
| Headers manifest | manual `_headers` | built-in |
| Prefetch | `@astrojs/prefetch` | built-in |
| View Transitions | `astro:transitions` | built-in |
| Dark mode | manual | `@dark { ... }` |
| Multi-format images | `<Picture>` from `@astrojs/image` | built-in `<picture>` always |
| RPC functions | `Astro.props` + `fetch` | `@server fn` with typed ADP client |
| WebSocket | manual | `@realtime let x = channel(...)` |

## Things Astro does that Arc doesn't

| Feature | Astro | Arc |
| --- | --- | --- |
| MDX content collections | yes | no — use Arc's `@build readFile()` for markdown |
| UI framework adapters (React/Vue/Svelte islands) | yes | no — Arc is its own language |
| Image service abstraction (CDN-backed) | yes | no — local image processing only |
| Per-route hot-reload during dev | partial | yes via `arc dev` |

If you want React/Vue components, Astro is a better fit. If you want one consistent language end to end, Arc.

## Migration steps

1. **One file at a time.** Pick an Astro page; copy its content side-by-side with a new `.arc` file.
2. **Frontmatter → `@build`/`@server`.** Move `await fetch(...)` calls into `@build` (if data-once) or `@server fn` (if per-request).
3. **Components → widgets.** Each Astro component becomes a `widget Name(...)`.
4. **Slots → `@slot`.** Direct replacement.
5. **CSS → design block.** Or paste your CSS as-is into a design block — Arc accepts pass-through.
6. **Run `arc build`.** Fix any errors via the [error catalog](../reference/errors.md).
7. **Verify output matches.** Same content, smaller bytes.

## Next

- [Core Concepts](../getting-started/concepts.md)
- [Recipe: Routing](../recipes/routing.md)
