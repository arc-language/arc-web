---
name: arc-new-page
description: Use when the user asks to create a new Arc page, route, or screen. Triggers on "create a page", "new route", "scaffold a page", "make a new screen". Produces a page with SEO + accessibility defaults pre-filled.
---

# arc-new-page

**When to use:** the user wants a new top-level page (a new route in their site).

**Reference docs:** `docs/getting-started/first-page.md`, `docs/features/seo.md`, `docs/language/structure.md`.

## Pattern

Every new page starts with `page "Title"` and a body containing layout primitives. For pages that will be linked from external sites (most pages), include SEO meta.

### Minimal static page

```arc
page "Hello"
  main
    heading "Hello, Arc"
    text "Built from scratch. Zero dependencies. Zero runtime."
```

### Page with full SEO baseline

```arc
page "Hello World — My Blog"
  description="Introduction to Arc, the zero-runtime web compiler."
  canonical="https://blog.example.com/hello-world"
  image="https://blog.example.com/og/hello-world.png"
  author="Alex Chen"
  schemaType="Article"
  siteName="My Blog"

  main
    heading "Hello World"
    text "Body content here."
```

Arc auto-emits from this meta: `<title>`, `<meta name="description">`, `<link rel="canonical">`, Open Graph tags, Twitter Card tags, JSON-LD structured data, robots meta, CSP, viewport.

### Page with @build data

```arc
page "Blog" description="..." canonical="https://blog.example.com" schemaType="WebSite"
  @build const posts = await fetch("https://cms.example.com/posts").then(r => r.json())

  header
    heading size=1 "My Blog"
    text "{posts.length} posts"

  main
    for post in posts
      card
        heading "{post.title}"
        text "{post.excerpt}"
```

## Element vocabulary (most-used)

| Arc | Purpose |
| --- | --- |
| `page "Title"` | Top-level route declaration |
| `main` | Main content region (auto-injected if absent) |
| `header` / `footer` / `nav` / `aside` / `article` / `section` | Semantic HTML |
| `card` | Elevated surface with shadow + radius |
| `row [gap] [align]` / `col [gap]` / `grid [cols]` / `center` | Layout primitives |
| `heading [size=N]` | `<h1>` to `<h6>` (default `<h2>`) |
| `text` | `<p>` |
| `link href="..."` | `<a>` — auto external `target="_blank" rel=noopener noreferrer` |
| `img src alt` | Routes through image pipeline (AVIF + WebP + dominant color) |
| `button on:click={...}` | Auto `type="button"` |

## Anti-patterns (common LLM mistakes)

- ❌ `<page>` or `<html>` tags — Arc has its own block syntax, no JSX
- ❌ `function Page() { return ... }` — Arc has `page "Title"`, not React functions
- ❌ Manual `<head>` / `<meta charset>` / `<meta viewport>` — Arc auto-emits these
- ❌ `null` for missing meta — omit the attribute or use `none`
- ❌ `style={{ ... }}` props — use a `design` block at the end of the page
- ❌ Three blank lines between sections — Arc doesn't care, but `arc fmt` will normalize

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] Set `canonical` if the page is publicly indexable (one of the strongest SEO signals)
- [ ] Set `description` ≤ 160 characters (Google truncates beyond)
- [ ] Set `image` if you want shareable OG previews (skip = no preview)
- [ ] Set `schemaType` matching the page kind (`Article` / `WebSite` / `Product` / `Recipe` / etc.) — drives JSON-LD
- [ ] Page has a `<main>` element OR doesn't (Arc injects one if absent — both fine, but explicit is clearer)
- [ ] At least one `<h1>` (Arc auto-injects a hidden one with the page title if absent — but a visible `<h1>` improves SEO + a11y)
- [ ] No runtime data fetch where `@build` works — see `arc-pick-data-context`
- [ ] If the page has multiple sibling pages, the user should run `arc build-site` (not `arc build`) — see `arc-multi-page-setup`
