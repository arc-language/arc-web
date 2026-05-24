# Core Concepts

If you know React, Vue, or Astro, this page maps Arc's ideas to those you already know.

## The compiler does the work

Frameworks like React run **in the browser**. They ship a runtime (~45 KB minimum), then figure out what to render. Arc runs **at build time** and figures out the result once. Browsers receive the answer, not the engine.

```
React app loading:
   HTML shell (1 KB)
+  JS bundle (200 KB)
+  parse + execute
+  diff + render
+  data fetch
+  re-render
=  ~3 s on Slow 4G

Arc app loading:
   Pre-rendered HTML with data inline (2 KB)
=  ~900 ms on Slow 4G
```

## The four data contexts

Every value in a web app has an execution context. Arc names all four explicitly:

| Context     | Runs at        | Ships to browser | Use for |
| ----------- | -------------- | ---------------- | --- |
| `@build`    | compile time   | inlined as HTML  | blog content, docs, marketing |
| `@state`    | client         | tiny JS setter   | counters, toggles, form state |
| `@live`     | edge per request | rendered HTML  | dashboards, auth-gated pages |
| `@realtime` | live channel   | WebSocket frames | chat, collab, live feeds |

A React app uses `useState` for both `@state` AND `@live` AND `@realtime` (with different libraries layered on top). Arc separates them so the compiler knows where each value lives and ships only the code that's needed.

See [Data Contexts](../language/data-contexts.md) for the full reference.

## Three block types

```arc
page "Title"          # a route — emits one HTML file
  ...elements...

  design              # styles for THIS page
    ...

widget MyCard         # a reusable component
  ...elements...

import Button from "./Button"  # composition
```

That's it. No `function Component()`, no class components, no JSX, no `<template>` ceremony.

## Structure: layout primitives over divs

Arc has layout vocabulary you use directly:

```arc
row gap=16              # → <div class="arc-row_HASH"> + display:flex
  card "A"              # → elevated surface
  card "B"

col gap=24
  heading "Title"
  text "Body"

grid cols=3 gap=16      # → CSS grid
  card "1"
  card "2"
  card "3"
```

Falls through to semantic HTML for anything not in Arc's vocabulary:

```arc
nav
  link href="/about" "About"
header
main
footer
section
article
```

See [Structure](../language/structure.md).

## Design vocabulary, not CSS files

Style lives next to structure:

```arc
card "Hello"

design
  card
    p: 24px              # padding
    radius: md           # border-radius preset
    bg: #fff
    fg: #222
    hover: { shadow: lg }
    focus: { outline: 2px solid blue }
    @mobile { p: 16px }
    @dark { bg: #1a1a1a; fg: #f0f0f0 }
```

Arc compiles `p:` to `padding:`, `radius:` to `border-radius:`, picks scoped class names, emits proper `@media (max-width: 640px)` queries. No CSS-in-JS runtime; no Tailwind-style className soup.

See [Design Vocabulary](../language/design-vocabulary.md).

## Compile-time vs runtime: a mental shift

In React you write:

```jsx
const [posts, setPosts] = useState([])
useEffect(() => { fetch('/api/posts').then(r => r.json()).then(setPosts) }, [])
return <div>{posts.length} posts</div>
```

This **runs in the browser** every time. The user pays for `useState` + `useEffect` + a render + a fetch + another render.

In Arc:

```arc
@build const posts = await fetch("/api/posts").then(r => r.json())
text "{posts.length} posts"
```

Arc fetches `posts` once **during `arc build`**. The HTML literally contains `<p>42 posts</p>`. The user pays nothing.

If the post list changes between deploys, `arc build` runs again (your CI pipeline). If it changes per user, you use `@live` instead. If it changes per second, you use `@realtime`. **Pick the context that matches the data's actual lifetime**, not the framework's only option.

## "But what about… ?"

| You want | Arc primitive |
| --- | --- |
| Component | `widget Name` |
| Props | `widget Name(prop1, prop2)` — params just listed |
| Slots / children | `@slot` inside widget |
| State | `@state let x = 0` |
| Computed | `@computed let y = x * 2` |
| Effect | None needed — direct DOM updates |
| Conditional render | `if / else` blocks; or `match` |
| List render | `for x in xs` |
| Refs | `id="foo"` + `document.getElementById` (escape hatch only) |
| Context / global state | `import { store } from "arc/store"` |
| Router | `import { router } from "arc/router"` — uses View Transitions |
| Image optimization | Built-in. Use `img src=...`. |
| API call (build-time) | `@build const x = await fetch(...)` |
| API call (per-request) | `@live let x = serverFn()` |
| API call (from client) | `@server fn` + call from `on:click` handler |
| WebSocket | `@realtime let x = channel("name")` |
| Form validation | `form` element with `<input type=email>` etc. + Arc's field types |
| Dark mode | `@dark { ... }` in design block |
| Animations | `animate: name 300ms ease` in design block |

## What Arc deliberately doesn't have

| Missing | Reason |
| --- | --- |
| `var`, `null`, loose `==` | These are footguns. Arc errors at compile time. Use `let`/`const`, `none`, strict `==`. |
| `function` keyword | `fn name() ...` |
| `this` | `@field` in classes; auto-bound methods |
| `for...in` | Use `for k, v in object` |
| `switch` | Use `match` (exhaustive). |
| `typeof`, `instanceof` | Use `x is String / Number / MyClass`. |
| Truthy `0` / `""` | Only `false` and `none` are falsy. `0`, `""`, `[]`, `{}` are truthy. |
| JSX | Arc syntax is indentation-based, not XML. |
| File-based routing convention | One `.arc` file = one route. Multi-page via `arc build-site`. |

## Next

- [Syntax + EBNF](../language/syntax.md) — formal grammar
- [Data Contexts](../language/data-contexts.md) — when to use each `@`
- [Recipes](../recipes/) — common patterns
