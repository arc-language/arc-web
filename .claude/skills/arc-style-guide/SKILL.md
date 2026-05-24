---
name: arc-style-guide
description: Arc code conventions — naming, comments, file layout, when to extract widgets. Apply when generating any Arc code; reference from the more specific authoring skills.
---

# arc-style-guide

Canonical style rules for Arc code. Sourced from `docs/internals/contributing.md` and the existing `examples/` directory.

## Naming

| Construct | Convention | Example |
| --- | --- | --- |
| Variables (`let`/`const`) | camelCase | `let userName`, `const maxItems` |
| Reactive vars (`@state`/`@build`/`@live`) | camelCase | `@state let count`, `@build const posts` |
| Functions (`fn`) | camelCase | `fn formatDate`, `fn submitContact` |
| Server fns (`@server fn`) | camelCase verb | `@server fn getUser`, `@server fn toggleLike` |
| Widgets | PascalCase | `widget Card`, `widget UserAvatar` |
| Classes | PascalCase | `class User`, `class Order` |
| Class fields (`@field`) | camelCase | `@name`, `@balance` |
| Type aliases | PascalCase | `type User = { ... }` |
| CSS scoped classes | auto-hashed by Arc | (don't name manually; let `design` block scope) |
| Files | kebab-case + `.arc` | `user-profile.arc`, `blog-post.arc` |

## Indentation

- **2 spaces. No tabs.** Tabs are a compile error.
- One level per nested template depth.
- `design` blocks: same 2-space convention.

## Quotes

- **Double quotes** for strings: `"hello"`, not `'hello'`.
- Single quotes are valid in expressions (`'hello'.length`) but reserve `"..."` for template content.
- Inside strings, escape `{` as `\{` to emit a literal brace.

## Comments

- **`//` only.** Block comments (`/* */`) are not supported.
- **No comments explaining WHAT** the code does — names cover that.
- **Comments explain WHY** when non-obvious — workarounds, edge cases, performance choices.

```arc
// ❌ Bad: explains what
// Increment count by 1
button on:click={ @count += 1 } "+"

// ✓ Good: explains why
// Debounce input to avoid filtering 10K products per keystroke (INP budget)
input on:input={ debounce(filter, 300) }
```

## File organization

```arc
// 1. Imports
import { router } from "arc/router"
import Card from "./Card"

// 2. Type definitions
type User = { name: String, email: Email }

// 3. @build constants (compile-time data)
@build const config = readFile("./config.json")

// 4. @server functions
@server fn getUser() -> User
  ...

// 5. Top-level reactive declarations
@live let user = getUser()

// 6. The page / widget body
page "Profile"
  ...
  design
    ...

// 7. Helper functions (if not reused)
fn formatName(u: User) => "{u.name}"
```

## When to extract a `widget`

- **Inline** when the pattern is used ≤ 2 times in the file.
- **Extract** when used ≥ 3 times OR when the inline version exceeds ~15 lines.
- Name widgets by what they DISPLAY, not how they work: `widget UserCard`, not `widget RenderUser`.
- Widget params are required arguments; don't pass props that the widget could compute from `@build` or `@session`.

## When to use `@build` vs `@state` vs `@live`

- **`@build`** when the value is the same for every visitor and changes ≤ once per deploy.
- **`@state`** when the value lives entirely in the browser (UI toggles, form fields, counters).
- **`@live`** when the value is per-user OR changes faster than your deploy cadence.
- **`@server fn`** when the client triggers it (form submit, button click that mutates).
- **`@realtime`** when changes need to push to the browser without polling.

Default to the leftmost option that fits — ship the least JS possible.

## Truthiness rules (Arc differs from JavaScript)

- **Only `false` and `none` are falsy.**
- `0`, `""`, `[]`, `{}` are all **truthy**.
- For zero/empty checks, be explicit:

```arc
if count > 0              // explicit number check
if items.length > 0       // explicit array check
if user                   // truthy when user is anything except none/false
```

## Equality

- `==` is **always strict**. There is no `===`.
- `none == none` is `true`.
- `NaN == NaN` is `true` (fixed from JS).

## Banned constructs (compile errors)

- `var` → use `let` or `const`
- `null` → use `none`
- `===` / `!==` → use `==` / `!=`
- `function` → use `fn`
- `this` → use `@field` in classes
- `for ... in` over object → use `for k, v in obj`
- `switch` → use `match` (exhaustive)
- `typeof` / `instanceof` → use `is`
- `with`, `void`, `eval`, `delete`, `~`, `>>>` → banned

## CSS / design block style

- Use Arc's shorthand vocabulary first (`p:`, `bg:`, `radius:`, etc.).
- Fall back to plain CSS only when Arc doesn't have the shorthand (`background-image: linear-gradient(...)`).
- Group related properties (spacing, color, typography, layout).
- Use design tokens (`radius: md`, `shadow: lg`) over hard-coded values.
- Define `@dark { ... }` adjacent to the light styling, not in a separate section.

## Examples to reference (in this repo)

| Pattern | See |
| --- | --- |
| Minimal static page | `examples/hello/index.arc` |
| `@state` reactivity | `examples/counter/index.arc` |
| `@build` data inlining | `examples/blog/index.arc` |
| `@server` functions | `examples/dashboard/index.arc` |
| `@live` streaming | `examples/live/index.arc` |
| `@realtime` WebSocket | `examples/chat/index.arc` |
| Native modal/tooltip/accordion | `examples/patterns/index.arc` |

---

When applying this style guide in skill output:
- Match the existing file's conventions if extending one
- Match Arc examples if creating a new file
- If in doubt, run `arc-self-verify` for the simplicity check
