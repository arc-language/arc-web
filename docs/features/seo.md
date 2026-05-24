# SEO + Structured Data

Arc auto-emits a complete SEO baseline whenever a page provides metadata. Every option is opt-in via page-level `meta` properties — but with sensible defaults, the typical site gets full SEO without writing any markup.

## What's emitted (by default)

For every `page`:

| Element | Emitted | Source |
| --- | --- | --- |
| `<meta charset="UTF-8">` | always | hardcoded |
| `<meta name="viewport" ...>` | always | hardcoded |
| `<meta name="robots" content="index,follow">` | always | hardcoded; opt-out via meta |
| `<meta http-equiv="Content-Security-Policy" ...>` | always (single-page) / via `_headers` (multi-page) | hardcoded CSP |
| `<title>` | always | `page "Title"` |
| `<meta name="description">` | when `meta.description` | `description="..."` |
| `<meta name="keywords">` | when `meta.keywords` | `keywords="..."` |
| `<meta name="author">` | when `meta.author` | `author="..."` |
| `<link rel="canonical">` | when `meta.canonical` | `canonical="..."` |
| Open Graph (`og:title`, `og:description`, `og:type`, `og:url`, `og:image`, `og:site_name`) | always | derived from page title + description + meta |
| Twitter Card (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:site`) | always | same source |
| `<script type="application/ld+json">` | when `meta.schemaType` | derived from meta |

## Full example

```arc
page "Hello World — My Blog"
  description="An introduction to Arc, the zero-runtime web compiler."
  canonical="https://blog.example/hello-world"
  image="https://blog.example/og/hello-world.png"
  author="Alex Chen"
  keywords="arc, web, compiler, html"
  schemaType="Article"
  siteName="My Blog"
  twitterSite="@myblog"
  published="2026-05-23"
  modified="2026-05-24"

  main
    heading "Hello World"
    text "..."
```

Emits (head):

```html
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
<meta http-equiv="Content-Security-Policy" content="…">
<title>Hello World — My Blog</title>
<meta name="description" content="An introduction to Arc, the zero-runtime web compiler.">
<meta name="keywords" content="arc, web, compiler, html">
<meta name="author" content="Alex Chen">
<link rel="canonical" href="https://blog.example/hello-world">
<meta property="og:title" content="Hello World — My Blog">
<meta property="og:description" content="An introduction to Arc…">
<meta property="og:type" content="website">
<meta property="og:url" content="https://blog.example/hello-world">
<meta property="og:image" content="https://blog.example/og/hello-world.png">
<meta property="og:site_name" content="My Blog">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Hello World — My Blog">
<meta name="twitter:description" content="An introduction to Arc…">
<meta name="twitter:image" content="https://blog.example/og/hello-world.png">
<meta name="twitter:site" content="@myblog">
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Article",
  "name":"Hello World — My Blog","headline":"Hello World — My Blog",
  "description":"An introduction to Arc…",
  "image":"https://blog.example/og/hello-world.png",
  "author":{"@type":"Person","name":"Alex Chen"},
  "url":"https://blog.example/hello-world"
}</script>
<style>...</style>
</head>
```

All from 10 lines of meta. No imports, no plugins.

## Meta reference

| Field | Type | Default | Effect |
| --- | --- | --- | --- |
| `description` | String | none | `<meta name="description">` + OG description + Twitter description + JSON-LD description |
| `canonical` | String (URL) | none | `<link rel="canonical">` + `og:url` + JSON-LD url + included in sitemap |
| `image` | String (URL) | none | `og:image` + `twitter:image` + JSON-LD image |
| `author` | String | none | `<meta name="author">` + JSON-LD author |
| `keywords` | String | none | `<meta name="keywords">` |
| `siteName` | String | none | `og:site_name` |
| `twitterSite` | String (handle) | none | `twitter:site` |
| `schemaType` | String (Schema.org type) | none | JSON-LD `@type` (e.g. `"Article"`, `"WebSite"`, `"Product"`) |
| `ogType` | String | `"website"` | `og:type` |
| `published` | String (ISO date) | none | JSON-LD datePublished |
| `modified` | String (ISO date) | build date | JSON-LD dateModified + sitemap lastmod |
| `priority` | Number 0.0–1.0 | 0.5 | sitemap `<priority>` |
| `changefreq` | String | `"weekly"` | sitemap `<changefreq>` |
| `imageFormats` | String[] | `["avif","webp","original"]` | image pipeline opt-out |
| `viewTransitions` | Boolean | true | enable View Transitions meta tag |
| `prefetch` | Boolean | true | enable auto-prefetch of in-app links |

## JSON-LD structured data

When `meta.schemaType` is set, Arc emits a JSON-LD block:

```arc
page "iPhone 17"
  description="..."
  schemaType="Product"
  meta.brand="Apple"
  meta.price=999
```

Emits:

```html
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@type":"Product",
  "name":"iPhone 17",
  "headline":"iPhone 17",
  "description":"…",
  "brand":"Apple",
  "price":999
}</script>
```

Supported types follow schema.org conventions. The compiler maps `meta.*` keys to JSON-LD properties; unknown keys are emitted verbatim.

## `sitemap.xml` (multi-page)

`arc build-site` emits `dist/sitemap.xml` with one `<url>` per page that has a `canonical`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://blog.example/hello-world</loc>
    <lastmod>2026-05-24</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
  ...
</urlset>
```

See [Multi-page](multi-page.md) and [Deployment](deployment.md).

## `robots.txt`

Auto-emitted alongside `sitemap.xml`:

```
User-agent: *
Allow: /
Sitemap: https://blog.example/sitemap.xml
```

`baseUrl` is derived from the most-common origin across all pages' canonicals.

## CSP via header (multi-page)

When `arc build-site` emits `_headers`, the per-page `<meta http-equiv="Content-Security-Policy">` becomes redundant and is stripped — saving ~80 B per page. The CSP is delivered via HTTP header instead, which is more powerful (can set `frame-ancestors`, `report-uri`, etc. that meta can't).

## Best practices

- **Always set `canonical`** — even for single-page sites. It's the strongest SEO signal.
- **Always set `image`** for shareable pages — OG previews drop drastically without one.
- **Use `schemaType`** matching your content — `Article`, `BlogPosting`, `Product`, `Recipe`, etc. Google rewards rich snippets.
- **Set `published` + `modified`** for time-sensitive content — sitemap freshness improves crawl frequency.
- **Don't set `description` longer than 160 chars** — Google truncates. Arc doesn't warn but should.

## Next

- [Multi-page](multi-page.md) — sitemap.xml emission
- [Deployment](deployment.md) — `_headers` for CSP delivery
- [Accessibility](accessibility.md) — semantic HTML is the other half of SEO
