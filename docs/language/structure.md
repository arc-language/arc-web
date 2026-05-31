# Structure: Element Vocabulary

Arc has layout primitives + semantic HTML pass-through + native patterns. The full table:

## Layout primitives (Arc-specific)

| Arc | Compiles to | Purpose |
| --- | --- | --- |
| `page "title"` | `<!DOCTYPE><html><head>...</head><body>` wrapper | Top-level route |
| `widget Name` | (none — inlined at invocation site) | Reusable component |
| `card` | `<div class="arc-card_HASH">` + elevated surface CSS | Surface with shadow + radius |
| `row [gap] [align] [justify]` | `<div>` + `display:flex; flex-direction:row` | Horizontal flex |
| `col [gap] [align] [justify]` | `<div>` + `display:flex; flex-direction:column` | Vertical flex |
| `grid [cols] [gap]` | `<div>` + `display:grid` | CSS grid container |
| `center` | `<div>` + `display:flex; align-items:center; justify-content:center` | Centered container |
| `stack [gap]` | alias for `col` | |
| `spacer` | `<div>` + `flex:1 0 auto` | Flex spacer |
| `divider` | `<hr>` | Horizontal rule |

## Semantic HTML (pass-through)

Arc emits these as their HTML equivalents:

| Arc | HTML | Notes |
| --- | --- | --- |
| `nav` | `<nav>` | |
| `main` | `<main>` | Auto-injected with `id="main-content"` if user doesn't set it |
| `header` | `<header>` | |
| `footer` | `<footer>` | |
| `aside` | `<aside>` | |
| `article` | `<article>` | |
| `section` | `<section>` | Marks transition from above-fold to below-fold (image pipeline) |
| `heading [size=N]` | `<h1>`...`<h6>` | `size=N` picks the level (1-6); without it, defaults to `<h2>` |
| `text [class]` | `<p>` | |
| `span` | `<span>` | Inline text |
| `link href="..."` | `<a href="...">` | Auto `target="_blank" rel="noopener noreferrer"` for external |
| `img src alt` | `<picture>` (with image pipeline) or `<img>` | Auto width/height, loading/decoding, fetchpriority |
| `input [type]` | `<input>` | Arc validates `type` against allowed values |
| `select` | `<select>` | |
| `textarea` | `<textarea>` | |
| `button [variant]` | `<button>` | Auto `type="button"` (avoids accidental form submit) |
| `form` | `<form>` | Arc field validation |
| `table`, `row`, `cell` | `<table>`, `<tr>`, `<td>` | |
| `code`, `pre` | `<code>`, `<pre>` | |
| `video`, `audio` | `<video>`, `<audio>` | |
| `canvas` | `<canvas>` | |
| `icon` | `<svg>` wrapper | Auto `aria-hidden="true"` unless aria-label given |

## Native interactive patterns (zero JS)

Arc has macros for the patterns most apps reach for JS to build:

| Arc | Compiles to | Notes |
| --- | --- | --- |
| `modal id="name"` | `<dialog>` | Native browser modal; no JS needed |
| `tooltip text="..."` | Popover API | Native; works without JS |
| `accordion` | `<details>` / `<summary>` | Native disclosure |
| `slider` | Scroll-snap carousel | CSS-native scrolling; JS only for dots/autoplay/keyboard |

### Modal example

```arc
button on:click={ document.getElementById('confirm').showModal() } "Delete"
modal id="confirm"
  heading "Are you sure?"
  text "This cannot be undone."
  row
    button on:click={ document.getElementById('confirm').close() } "Cancel"
    button on:click={ /* delete */ } "Delete"
```

Compiles to:

```html
<button onclick="document.getElementById('confirm').showModal()">Delete</button>
<dialog id="confirm">
  <h2>Are you sure?</h2>
  <p>This cannot be undone.</p>
  ...
</dialog>
```

### Tooltip on any element

```arc
button tooltip="Save to disk" "Save"
```

Compiles to:

```html
<button popovertarget="tt_HASH" tabindex="0">Save</button>
<span popover id="tt_HASH" role="tooltip">Save to disk</span>
```

### Accordion

```arc
accordion
  summary="What is Arc?"
  text "A compiler that produces optimal HTML, CSS, and JavaScript."
```

Compiles to:

```html
<details>
  <summary>What is Arc?</summary>
  <p>A compiler that produces optimal HTML, CSS, and JavaScript.</p>
</details>
```

### Slider

A scroll-snap carousel. Scrolling is CSS-native (no JS for basic use). Arrow-key navigation is on by default; dots and autoplay are opt-in.

```arc
slider
  img src="a.jpg" alt="Slide 1"
  img src="b.jpg" alt="Slide 2"
  img src="c.jpg" alt="Slide 3"
```

All attributes are optional:

| Attribute | Default | Description |
| --- | --- | --- |
| `items=N` | `1` | Slides visible at once |
| `gap=N` | `0` | Gap between slides (`px` appended to bare numbers) |
| `peek=N` | `0` | Show edge of next slide (`px` appended to bare numbers) |
| `nav=false` | `true` | Show previous/next buttons |
| `dots=false` | `true` | Show pagination dots |
| `center=true` | `false` | Snap-align slides to center instead of start |
| `wrap=true` | `false` | Nav buttons wrap from last → first and first → last |
| `keyboard=false` | `true` | Arrow-key navigation when the track is focused |
| `autoplay=true` | `false` | Auto-advance slides |
| `timeout=N` | `4000` | Autoplay interval in ms (min 500) |
| `label="..."` | locale `"Slider"` | `aria-label` for the carousel region |
| `class="..."` | — | Extra CSS classes on the outer wrapper |

**Multi-item example with peek:**

```arc
slider items=3 gap=16 peek=40 wrap=true
  card
    img src="a.jpg" alt="Product A"
    heading "Product A"
  card
    img src="b.jpg" alt="Product B"
    heading "Product B"
  card
    img src="c.jpg" alt="Product C"
    heading "Product C"
```

**Theming with CSS custom properties:**

```css
.my-page {
  --arc-slider-nav-bg: oklch(30% 0.2 270);   /* button background */
  --arc-slider-nav-size: 2.5rem;              /* button width/height */
  --arc-slider-nav-icon-size: 1.25rem;        /* arrow icon size */
  --arc-slider-dot-size: 0.625rem;            /* dot width/height */
}
```

## Attributes

| Pattern | Effect |
| --- | --- |
| `attr="value"` | Literal string attribute |
| `attr=value` | Number / boolean / identifier |
| `attr={expr}` | Dynamic; expression evaluated |
| `bind:value={var}` | Two-way bind for inputs |
| `on:event={handler}` | Event handler (e.g. `on:click`, `on:input`) |
| `class="foo bar"` | Additional CSS classes |
| `id="x"` | Element ID (also enables reactive targeting) |

## Widget composition

```arc
widget Card(title, body)
  card
    heading "{title}"
    text "{body}"

page "Home"
  main
    Card("Hi", "World")
    Card("Another", "Body")
```

With slots (for children):

```arc
widget Wrapper(title)
  card
    heading "{title}"
    @slot

page "Home"
  Wrapper("Greeting")
    text "Slot content here"
    button "OK"
```

Children passed via indented block become the `@slot` content.

## Auto-enhancements

The HTML emitter applies these automatically:

- `<img>` → `loading="lazy"` + `decoding="async"` + `alt=""` if missing
- `<button>` → `type="button"` (unless explicit)
- `<a href="https://...">` → `target="_blank" rel="noopener noreferrer"`
- `<form>` → built-in validation hooks
- `<input type="email">` → server-side and client-side validation
- `<dialog>` → focus trap built-in

## Auto-injected page chrome

Every `page` gets:

- `<!DOCTYPE html><html lang="en">`
- `<meta charset="UTF-8">`
- `<meta name="viewport" ...>`
- `<meta name="robots" content="index,follow">`
- `<meta http-equiv="Content-Security-Policy" ...>` (removed when `_headers` ships)
- OG, Twitter Card, JSON-LD (when meta provided — see [SEO](../features/seo.md))
- Skip link `<a href="#main-content" class="arc-skip-link">` (only if page has `<main>`)
- Auto `<main id="main-content">` wrapper if user didn't write one

## Next

- [Design Vocabulary](design-vocabulary.md) — styling reference
- [Reactive](reactive.md) — `bind:` and `on:` semantics
- [Features: SEO](../features/seo.md) — what gets auto-emitted
