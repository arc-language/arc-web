# Recipe: Dark Mode

Arc supports `@dark { ... }` in design blocks. It compiles to `@media (prefers-color-scheme: dark)`. No JavaScript, no flash of wrong theme.

## System-driven (zero JS)

```arc
page "Themed"
  main
    heading "Hello"
    text "Both light and dark covered."

  design
    body
      bg: #ffffff
      fg: #222222
      @dark
        bg: #1a1a1a
        fg: #f0f0f0

    card
      bg: #f5f5f5
      border: 1px solid #e1e4e8
      @dark
        bg: #2a2a2a
        border: 1px solid #444
```

The browser follows the OS preference. No flash because the CSS is in `<head>` before the body renders.

## User-toggleable (with JS)

If you want a manual toggle that overrides OS preference:

```arc
page "Themed"
  @state let theme = "auto"   // "auto" | "light" | "dark"

  header
    select bind:value={theme} on:change={
      document.documentElement.setAttribute('data-theme', theme)
      localStorage.setItem('theme', theme)
    }
      option value="auto" "Auto"
      option value="light" "Light"
      option value="dark" "Dark"

  main
    text "Current: {theme}"

  design
    body
      bg: #fff
      fg: #222
      @dark
        bg: #1a1a1a
        fg: #f0f0f0

    body[data-theme="dark"]
      bg: #1a1a1a
      fg: #f0f0f0
    body[data-theme="light"]
      bg: #fff
      fg: #222
```

Add a tiny script in `<head>` to apply the saved preference before paint:

```arc
page "Themed" headScript="if(localStorage.theme){document.documentElement.setAttribute('data-theme',localStorage.theme)}"
```

(`meta.headScript` is inlined into `<head>` before CSS — runs synchronously, prevents flash.)

## Per-component dark variants

```arc
widget Card(title, body)
  card
    heading "{title}"
    text "{body}"
  design
    card
      bg: #ffffff
      fg: #222222
      border: 1px solid #e1e4e8
      shadow: sm
      @dark
        bg: #2a2a2a
        fg: #f0f0f0
        border: 1px solid #444
        shadow: none
```

Each widget can define its own dark variant. Scoping isolates them.

## CSS custom properties pattern

For complex themes, use CSS variables in the base layer:

```arc
design
  body
    background-color: var(--surface)
    color: var(--text)
    --surface: #ffffff
    --text: #222222
    --primary: #0366d6
    @dark
      --surface: #1a1a1a
      --text: #f0f0f0
      --primary: #58a6ff

  card
    bg: var(--surface)
    fg: var(--text)
    border: 1px solid var(--text)
```

Components reference the variables; only the root layer flips on dark mode. Cleaner for large themes.

## Honoring `prefers-reduced-motion`

Arc already does this for all animations (see [Accessibility](../features/accessibility.md)). For your own custom transitions, add the media query:

```arc
design
  button
    transition: bg 200ms ease
    @media (prefers-reduced-motion: reduce)
      transition: none
```

(Or just trust Arc's auto-emitted base rule, which already overrides `transition-duration: 0.01ms !important`.)

## Color contrast checks

Both themes should meet WCAG AA:
- Body text: ≥ 4.5:1 contrast with background
- Large text: ≥ 3:1
- UI elements: ≥ 3:1

Check both modes with the [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/).

## Image variants

If your images embed text or branding that needs different rendering in dark mode:

```arc
picture
  source srcset="logo-dark.png" media="(prefers-color-scheme: dark)"
  img src="logo-light.png" alt="Logo"
```

Arc's image pipeline doesn't auto-generate dark variants — you provide both source files.

## See also

- [Design Vocabulary](../language/design-vocabulary.md) — `@dark`, `@mobile`, `@tablet`
- [Accessibility](../features/accessibility.md)
