# Design Vocabulary

Arc's design block compiles to scoped CSS. The vocabulary maps to CSS but with shorter names, presets, and built-in responsive / state / dark-mode support.

## Block structure

```arc
page "Example"
  card "Hello"

  design
    card
      p: 24px
      radius: md
      bg: #fff
      hover: { shadow: lg }
      @mobile { p: 16px }
      @dark { bg: #1a1a1a }
```

Each design block scopes to one component or element selector. Arc emits scoped class names — no global selectors.

## Property reference

### Spacing

| Arc | CSS |
| --- | --- |
| `p: 16px` | `padding: 16px` |
| `p-x: 16px` | `padding-inline: 16px` |
| `p-y: 12px` | `padding-block: 12px` |
| `p-t / p-r / p-b / p-l` | `padding-top / right / bottom / left` |
| `m: ...` | `margin: ...` (same x/y/t/r/b/l variants) |
| `gap: 16px` | `gap: 16px` |
| `gap-x / gap-y` | `column-gap / row-gap` |

### Sizing

| Arc | CSS |
| --- | --- |
| `w: 100%` | `width: 100%` |
| `h: 60vh` | `height: 60vh` |
| `min-w / max-w / min-h / max-h` | `min-width` etc. |
| `full` | `width: 100%; height: 100%` |

### Layout

| Arc | CSS |
| --- | --- |
| `row [gap] [align] [justify]` | `display: flex; flex-direction: row; ...` |
| `col [gap] [align] [justify]` | `display: flex; flex-direction: column; ...` |
| `grid [cols] [gap]` | `display: grid; grid-template-columns: repeat(N, 1fr); ...` |

### Colors

| Arc | CSS |
| --- | --- |
| `bg: #fff` | `background-color: #fff` |
| `bg: red` | `background-color: red` |
| `bg: token` | `background-color: var(--arc-color-token)` |
| `fg: ...` | `color: ...` |
| `border: 1px solid #ccc` | `border: 1px solid #ccc` |

### Typography

| Arc | CSS |
| --- | --- |
| `size: 16px` | `font-size: 16px` |
| `size: lg` | `font-size: var(--arc-text-lg)` (presets: xs/sm/md/lg/xl/2xl/3xl) |
| `weight: bold` | `font-weight: 700` (presets: thin/light/normal/medium/semibold/bold/black) |
| `font: sans` | `font-family: var(--arc-font-sans)` (sans/serif/mono) |
| `line: 1.5` | `line-height: 1.5` |
| `tracking: 0.05em` | `letter-spacing: 0.05em` |
| `align: center` | `text-align: center` |

### Shape

| Arc | CSS |
| --- | --- |
| `radius: 8px` | `border-radius: 8px` |
| `radius: md` | `border-radius: var(--arc-radius-md)` (presets: sm/md/lg/xl/2xl/full) |
| `shadow: md` | `box-shadow: var(--arc-shadow-md)` (sm/md/lg/xl) |

### State

| Arc | CSS |
| --- | --- |
| `hover: { ... }` | `&:hover { ... }` |
| `focus: { ... }` | `&:focus-visible { ... }` |
| `active: { ... }` | `&:active { ... }` |

### Responsive

| Arc | CSS |
| --- | --- |
| `@mobile { ... }` | `@media (max-width: 640px) { ... }` |
| `@tablet { ... }` | `@media (min-width: 641px) and (max-width: 1024px)` |
| `@desktop { ... }` | `@media (min-width: 1025px)` |
| `@container < 600px { ... }` | container query |

### Dark mode

| Arc | CSS |
| --- | --- |
| `@dark { ... }` | `@media (prefers-color-scheme: dark) { ... }` |

### Animation

| Arc | CSS |
| --- | --- |
| `animate: fadeIn 300ms ease` | `animation: fadeIn 300ms ease` |
| `transition: opacity 200ms` | `transition: opacity 200ms` |
| `@starting-style { ... }` | `@starting-style { ... }` |

Arc auto-respects `prefers-reduced-motion: reduce` — animations are reduced to 0.01ms automatically.

### Math (no `calc()`)

```arc
card
  w: 100% - 32px            // → calc(100% - 32px)
  p: 16px + 8px             // → calc(16px + 8px) — folded to 24px at build
```

### Full CSS passthrough

Any property Arc doesn't recognize passes through unchanged:

```arc
card
  background-image: linear-gradient(to right, red, blue)
  -webkit-mask-image: url(...)
```

## Tokens (CSS custom properties)

Arc emits these in the base CSS layer:

```css
--arc-font-sans, --arc-font-serif, --arc-font-mono
--arc-radius-sm, -md, -lg, -xl, -2xl, -full
--arc-shadow-sm, -md, -lg, -xl
```

Reference any token:

```arc
card
  radius: var(--arc-radius-lg)
  shadow: var(--arc-shadow-md)
```

## Scoping

A design block declared inside `page` or `widget` scopes its selectors to that component. The compiler appends a hash:

```arc
widget Card
  card "Hi"
  design
    card
      bg: #fff
```

Emits:

```css
.arc-card_1g18 { background: #fff }
```

The same `card` element in a different `widget` gets a different hash — no leak.

## Tree-shaking

Arc strips base utility CSS that no element references. If your page uses no `row` primitive, `.arc-row { ... }` is removed from the output. See [Internals: Optimizer](../internals/optimizer.md).

## Next

- [Structure](structure.md) — what elements consume these styles
- [Recipe: Dark Mode](../recipes/dark-mode.md) — full pattern
