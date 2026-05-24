# Recipe: Routing

Multi-page sites with instant cross-page navigation.

## File-per-route

```
my-site/
├── index.arc
├── about.arc
├── blog.arc
├── contact.arc
```

Build:

```bash
arc build-site
```

Output:

```
dist/
├── index.html
├── about.html
├── blog.html
├── contact.html
├── shared.{sha}.css
├── sitemap.xml
├── robots.txt
└── _headers
```

Each `.arc` file is a standalone page. Cross-page links use `.html`:

```arc
// index.arc
page "Home"
  nav
    link href="about.html" "About"
    link href="blog.html" "Blog"
```

## What you get for free from `build-site`

- Shared CSS extracted into `shared.{sha}.css` (browser caches once)
- `<link rel="prefetch" href="other-page.html">` injected for every same-site link
- `<meta name="view-transition" content="same-origin">` injected
- `sitemap.xml` from `canonical` meta
- `_headers` for Cloudflare/Netlify (cache-immutable for hashed assets, preload `Link:` for shared CSS)

## Cross-page navigation: instant + smooth

The injected `prefetch` + View Transitions combination means:

1. Browser loads page-01
2. Encounters `<link rel="prefetch" href="page-02.html">`
3. Idly fetches page-02 in the background
4. User clicks the link
5. Cached HTML loads instantly
6. View Transitions API fades old → new content

In browsers without View Transitions support, fallback is a full navigation (still fast thanks to prefetch).

## Per-page meta

```arc
page "About"
  canonical="https://example.com/about"
  description="About our company"
  image="https://example.com/og/about.png"
  schemaType="WebPage"

  main
    heading "About"
    text "..."
```

Each page's canonical contributes to `sitemap.xml`. The metadata also drives OG/Twitter/JSON-LD.

## Opting out of prefetch / View Transitions

For heavy pages where you don't want background prefetch:

```arc
page "Big page" prefetch=false
```

For pages where view transitions look bad:

```arc
page "Special" viewTransitions=false
```

Defaults are on because they're usually wins.

## SPA-feel routing with `arc/router`

If you want JavaScript-driven navigation between Arc pages (no full HTML reload, even more interactive transitions):

```arc
import { router } from "arc/router"

page "App shell"
  nav
    link href="/" "Home"
    link href="/about" "About"
  main
    router()
```

`router()` intercepts in-app `<a>` clicks, fetches the target page, applies View Transition, updates `<title>` and meta. Browser without JS or without View Transitions fall back to full navigation.

## Dynamic routes

Arc doesn't have file-based dynamic routing (no `[slug].arc`). For dynamic content with shared structure:

**Option 1: Generate at build time** (recommended):

```js
// build.js (Node script)
const fs = require('fs')
const posts = await fetch('/api/posts').then(r => r.json())
for (const post of posts) {
  fs.writeFileSync(
    `posts/${post.slug}.arc`,
    `page "${post.title}" canonical="https://example.com/posts/${post.slug}"\n  main\n    heading "${post.title}"\n    text "${post.body}"\n`
  )
}
// then run: arc build-site
```

**Option 2: Use `@live`** for true dynamic per-request:

```arc
// post.arc — handles all post requests
page "Blog post"
  @server fn getPost(slug: String) -> Post
    return await db.posts.findBySlug(slug)
  @live let post = getPost(@url.params.slug)

  heading "{post.title}"
  text "{post.body}"
```

Configure routing in `arc.config.json`:

```json
{
  "routes": {
    "/posts/:slug": "post.arc"
  }
}
```

## Active link styling

```arc
import { router, isActive } from "arc/router"

nav
  link href="/" class={isActive("/") ? "active" : ""} "Home"
  link href="/about" class={isActive("/about") ? "active" : ""} "About"

design
  link
    color: #586069
    &.active { color: #0366d6; font-weight: 600 }
```

## See also

- [Multi-page](../features/multi-page.md) — `arc build-site` mechanics
- [Stdlib: router](../language/stdlib.md)
