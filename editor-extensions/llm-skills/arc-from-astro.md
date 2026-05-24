---
name: arc-from-astro
description: Use when the user pastes an Astro file (.astro frontmatter + template) and wants the Arc equivalent. Frontmatter maps to @build/@server, components to widgets, slots stay slots.
---

# arc-from-astro

**When to use:** the user pastes an `.astro` file or asks "translate this Astro page to Arc."

**Reference docs:** `docs/guides/migrating-from-astro.md`.

## Translation table

| Astro pattern | Arc equivalent |
| --- | --- |
| `--- frontmatter ---` | Top-of-file `@build` / `@server` / `import` declarations |
| `const x = await fetch(url)` (frontmatter) | `@build const x = await fetch(url)` |
| `Astro.glob('./posts/*.md')` | Iterate filesystem manually: `@build const posts = readDir("./posts").map(readFile)` (or pre-process to JSON) |
| `Astro.props` | Widget parameters: `widget Card(title, body)` |
| `Astro.params` | `@session` or URL routing params (`arc/router`) |
| `<Component />` (auto-import) | `Component()` (after `import Component from "..."`) |
| `<slot />` | `@slot` |
| `<slot name="x" />` | `@slot x` |
| `client:load` islands | Just use `@state` — Arc is reactive without islands |
| `client:idle` | Same — no opt-in needed |
| `<Image src={img} ... />` | `img src="img.jpg" alt="..."` — pipeline auto-applies |
| `set:html={raw}` | Arc doesn't have raw HTML injection (security). Restructure to use Arc elements. |
| `getStaticPaths()` | One `.arc` file per route + `arc build-site` |
| `getStaticProps()` | `@build const props = ...` |
| `Astro.request.headers` | `@session` (inside `@server fn`) |
| `import.meta.env.X` | `@build const X = process.env.X` (cautiously — Arc's `@build` doesn't read env by default) |
| `.astro` file | `.arc` file (kebab-case naming) |
| `astro.config.mjs` | `arc.config.json` (much smaller surface) |
| `@astrojs/sitemap` integration | Built-in via `arc build-site` (uses `meta.canonical`) |
| `@astrojs/image` | Built-in image pipeline (no plugin) |
| `astro:transitions` | `<meta name="view-transition">` auto-injected by `arc build-site` |

## Concrete examples

### Astro blog post → Arc

```astro
---
import Layout from '../layouts/Layout.astro'
import { getCollection } from 'astro:content'

const posts = await getCollection('blog')
const featured = posts.find(p => p.data.featured)
---

<Layout title={featured.data.title}>
  <h1>{featured.data.title}</h1>
  <article set:html={featured.body} />
</Layout>
```

```arc
import Layout from "./layouts/Layout"

# Note: Arc doesn't have `astro:content` collections. Pre-process markdown
# to JSON at build time, or use @build readFile with a markdown parser.
@build const posts = readFile("./content/blog-index.json")
@build const featured = posts.find(p => p.featured)

Layout(featured.title)
  heading "{featured.title}"
  # Arc has no set:html — convert markdown to Arc structure during preprocessing
  for paragraph in featured.body.paragraphs
    text "{paragraph}"
```

### Astro component → Arc widget

```astro
---
// Card.astro
const { title, body } = Astro.props
---
<article class="card">
  <h2>{title}</h2>
  <p>{body}</p>
  <slot />
</article>
```

```arc
# Card.arc
widget Card(title, body)
  card
    heading "{title}"
    text "{body}"
    @slot
```

### Astro server endpoint → Arc @server fn

```astro
// pages/api/contact.ts
export async function POST({ request }) {
  const data = await request.json()
  await db.contacts.add(data)
  return new Response(JSON.stringify({ ok: true }))
}
```

```arc
# In any .arc file
@server fn contact(data: { name: String, email: Email }) -> Result<String, String>
  await db.contacts.add(data)
  return Ok("Thanks!")
```

Arc generates the route + ADP encoding automatically. No `Response` construction.

### Astro multi-page with sitemap

```astro
// astro.config.mjs
import sitemap from '@astrojs/sitemap'
export default { site: 'https://example.com', integrations: [sitemap()] }
```

```arc
# No config needed. Set meta.canonical on each page; arc build-site emits sitemap.xml
page "Hello" canonical="https://example.com/hello"
  ...
```

## What doesn't translate cleanly

- **MDX content collections** — Arc has no schema-validated MDX. Use `@build readFile()` with a custom parser, or pre-process to JSON.
- **React/Vue/Svelte islands** — Arc is Arc-only. Translate the entire component tree to Arc widgets.
- **`set:html`** — security boundary in Arc. Restructure to use Arc elements (decode whatever you were injecting into structured data first).
- **`Astro.cookies`** — use `@session` (auto-validated in `@server fn` bodies).
- **`Astro.redirect()`** — return a Result from `@server fn`; handle navigation client-side via `window.location` or `arc/router`.
- **Endpoint files (`pages/api/*.ts`)** — fold into a `@server fn` in any `.arc` file. Arc auto-routes by function name.

## Anti-patterns when translating

- ❌ **Keeping `Astro.props` reference** in the body — replace with widget params upfront.
- ❌ **Preserving `<Component client:load />` syntax** — Arc has no islands; just use the component.
- ❌ **Manually constructing `<picture>`** to match `@astrojs/image` output — Arc's image pipeline does this from `<img>`.
- ❌ **Adding plugins for sitemap / View Transitions / prefetch** — built-in.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **No `--- ... ---` frontmatter** in output — Arc has no frontmatter syntax.
- [ ] **No `Astro.props` / `Astro.glob` / `Astro.cookies`** references.
- [ ] **No `client:*` directives** — Arc decides per-context.
- [ ] **Slots use `@slot`** (not `<slot />`).
- [ ] **`@server fn` typed and using `Result<T, E>`** for fallible operations.
- [ ] **Per-page `canonical` meta** if user wants the page in sitemap.
- [ ] **`set:html` removed and replaced** with structured Arc elements (or noted as out-of-scope).
- [ ] **Plugin imports removed**: no `@astrojs/sitemap`, `@astrojs/image`, `astro:transitions` in output.
- [ ] **Bundle delta noted**: typically Arc is similar to Astro on byte count (both ship 0 client JS for static), but Arc's automatic infrastructure (sitemap, headers, dedup) is a feature delta.
