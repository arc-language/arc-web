# Accessibility

Arc applies accessibility defaults that match WCAG 2.1 AA — without you writing markup. Opt-out per page when you need different behavior.

## What's on by default

| Default | Where | Why |
| --- | --- | --- |
| Skip link `<a href="#main-content">` | Every page with a `<main>` | Keyboard users can skip nav |
| `<main id="main-content">` injection | Pages without explicit `<main>` | Makes the skip link work |
| `<h1 class="arc-sr-only">{title}</h1>` | Pages without explicit `<h1>` | Every page has a page heading |
| `@media (prefers-reduced-motion: reduce)` rule | Base CSS | All animations reduced to 0.01 ms |
| `:focus-visible { outline: 2px solid ...; outline-offset: 2px }` | Base CSS | Keyboard focus visible |
| `loading="lazy"` on below-fold `<img>` | Image emit | Saves data + reduces jank |
| `decoding="async"` on below-fold `<img>` | Image emit | Doesn't block main thread |
| `fetchpriority="high"` on above-fold `<img>` | Image emit | LCP candidate downloads first |
| `alt=""` on `<img>` without alt | Image emit | Marks as decorative (better than missing) |
| `type="button"` on `<button>` | Button emit | Prevents accidental form submit |
| `target="_blank" rel="noopener noreferrer"` on external `<a>` | Link emit | Security + opens-in-new-tab UX |
| Auto sr-only "(opens in new tab)" on external links | Link emit | Screen readers announce it |
| `aria-hidden="true"` on `<icon>` without `aria-label` | Icon emit | Decorative icons silent |
| `tabindex="0"` on tooltip wrapper | Tooltip emit | Tooltip reachable by keyboard |
| `<dialog>` for `modal` | Modal emit | Native focus trap |
| `<details>`/`<summary>` for `accordion` | Accordion emit | Native disclosure |

## Skip link

Auto-emitted whenever a page has (or gets injected) a `<main>`:

```html
<a href="#main-content" class="arc-skip-link">Skip to main content</a>
```

CSS hides it visually until focused:

```css
.arc-skip-link {
  position: absolute; top: -40px; left: 0;
  background: #fff; color: #000; padding: 8px 16px;
  z-index: 9999; border: 2px solid #000;
}
.arc-skip-link:focus { top: 0 }
```

Customize the text:

```arc
page "Article" skipLinkText="Skip to article"
  main
    ...
```

## `prefers-reduced-motion`

Every page emits this in the base CSS:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Users who've set the OS preference get a calmer experience. You don't write the media query yourself.

## Form labels

Arc warns at build time when a form control has no accessible name:

```arc
form
  input type="text"                  // WARN: no aria-label, aria-labelledby, id, or placeholder
  input type="email" placeholder="Email"   // OK
  label for="name" "Name"
  input type="text" id="name"        // OK
  input type="search" aria-label="Search docs"   // OK
```

This is a warning, not an error — but fix it.

## Reactive list announcements

By default, list updates via `for x in xs` do NOT emit `aria-live` (screen readers would spam). Opt in per region:

```arc
for msg in notifications live="polite"
  card "{msg.body}"

for alert in urgentAlerts live="assertive"   // use sparingly
  card "{alert.title}"
```

## Heading hierarchy

Arc's `heading` primitive:

```arc
heading "Title"                  // → <h2> (default size=2)
heading size=1 "Page Title"      // → <h1>
heading size=3 "Subsection"      // → <h3>
```

Sizes 1-6 are valid; anything else falls back to `<h2>`.

A page without a user-defined `<h1>` gets an auto-injected `<h1 class="arc-sr-only">{page.title}</h1>` — visible to screen readers, hidden visually.

## Color contrast

Arc doesn't enforce contrast (no automated WCAG check). When using `design`, follow these guidelines:

- Body text: contrast ratio ≥ 4.5:1 with background
- Large text (≥18pt or ≥14pt bold): ≥ 3:1
- UI components and graphics: ≥ 3:1
- Use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) during design

For dark mode, define both light and dark colors in your design block:

```arc
text "Hello"
design
  text
    bg: #ffffff
    fg: #222222         // 16.1:1 — well above AA
    @dark {
      bg: #1a1a1a
      fg: #f0f0f0       // 15.2:1
    }
```

## Keyboard navigation

Arc preserves native focusable behavior:

- `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`, `<dialog>` — focusable by default
- `<details>` / `<summary>` — accordion fully keyboard-accessible
- `tooltip="..."` — adds `tabindex="0"` to the host so tooltip reachable by Tab

For custom interactive elements:

```arc
div role="button" tabindex=0 on:click={ ... } on:keydown={
  if event.key == "Enter" || event.key == " " { /* handle */ }
}
```

(Prefer a real `<button>` when possible.)

## ARIA

Arc auto-applies `role` and `aria-*` for its own primitives. Don't fight it — use semantic HTML primitives. Reach for `role=` only when you're writing custom widgets that don't have a native HTML equivalent.

## Tools

- `arc check` — warns on missing form labels, missing alt text
- `axe` browser extension — runtime audit
- Lighthouse Accessibility category — should score ≥95 with Arc defaults

## Next

- [Structure](../language/structure.md) — semantic element vocabulary
- [Design Vocabulary](../language/design-vocabulary.md) — `:focus-visible`, color tokens
- [Recipe: Forms](../recipes/forms.md) — labeled fields, validation announcements
