# Arc — Full LLM Skills Bundle

This file concatenates every Arc skill into one document. Paste into the system prompt of any LLM (ChatGPT, Claude.ai, etc.) to teach it Arc patterns.

For tool-specific integration, see `INSTALL/<tool>.md`.

---



---

## arc-self-verify

---
name: arc-self-verify
description: Run this checklist BEFORE returning ANY Arc code to the user. Verifies simplicity, performance, Core Web Vitals impact, time/space complexity, bundle bytes, accessibility, and type safety. Every other Arc skill ends by invoking this.
---

# arc-self-verify

The universal verification checklist Arc skills run before returning code. Apply every item; for items that don't apply, write `N/A` with a one-line reason.

## Reference docs

- `docs/internals/optimizer.md` — Arc's compile-time optimizations (loop unrolling, CSS tree-shake)
- `docs/features/accessibility.md` — defaults Arc auto-applies (don't regress these)
- `docs/language/data-contexts.md` — `@build` ships 0 client bytes; prefer over `@state` when data is static
- `docs/reference/errors.md` — every compile error and its fix

## The checklist

### 1. Simplicity

- [ ] **Line count ≤ what the problem requires.** No code added for hypothetical futures. Three similar lines beats a premature abstraction.
- [ ] **No half-finished work.** No TODOs. No commented-out branches. No "we'll wire this up later."
- [ ] **No dead branches.** If `if false { ... }` exists in the generated code, remove it.
- [ ] **No premature `widget` extraction.** Inline a pattern until it's used in ≥3 places.

### 2. Time complexity

- [ ] **State the Big-O** of any new function you wrote.
  - `fn double(x)` → `O(1)`
  - `for x in items` → `O(n)`
  - Nested loop → `O(n × m)` — flag if both could grow
- [ ] **Flag anything ≥ O(n²)** for review. Most Arc operations should be O(n) or O(log n).
- [ ] **Static loops should be `@build`-unrolled.** If you write `for x in items` where `items` is `@build const`, Arc unrolls at compile time → effectively O(1) at runtime.

### 3. Space complexity

- [ ] **State the allocation pattern** of any new data structure.
  - `@state let count = 0` → O(1) per page instance
  - `@state let items = []` → O(n) where n = items.length over the page lifetime
- [ ] **Flag any persistent structure ≥ O(n)** that the user didn't explicitly request.
- [ ] **`@build` data** is allocated once at compile time and inlined as HTML strings — runtime allocation is O(1) for the rendered text.

### 4. Core Web Vitals impact

For each generated change, ask: does it affect a Core Vital? Answer for all four:

- [ ] **LCP (Largest Contentful Paint)** — target ≤ 2.5 s
  - Does this delay first paint? (synchronous data fetch, render-blocking script)
  - **Fix:** use `@build` for static data; use `@live` with parallel `Promise.all` for per-request; auto `fetchpriority="high"` on hero `<img>` (Arc does this for the first 2 imgs)
- [ ] **CLS (Cumulative Layout Shift)** — target ≤ 0.1
  - Does this insert content after initial paint?
  - **Fix:** always set explicit `width`/`height` on images (Arc auto-adds via image pipeline); reserve space for loading skeletons
- [ ] **INP (Interaction to Next Paint)** — target ≤ 200 ms
  - Does this add an event handler that does heavy work?
  - **Fix:** debounce expensive handlers; offload CPU work to `@worker`; avoid `JSON.parse` on huge payloads (use ADP via `@server`)
- [ ] **FCP (First Contentful Paint)** — target ≤ 1.8 s
  - Does this add to the critical render path?
  - **Fix:** prefer `@build` over runtime fetch; let Arc inline critical CSS automatically (default behavior under 14 KB)

### 5. Bundle bytes (client-shipped JS)

- [ ] **How many bytes** does this add to client JS?
- [ ] **Could `@build` replace `@state`?** `@build` ships **0 client bytes**. Use it when data doesn't change per visitor.
- [ ] **Could `@live` replace client-side `@server` calls?** `@live` ships the data **inline in HTML** — no ADP runtime needed in browser.
- [ ] **Are `@server` functions called from event handlers?** If not, Arc's tree-shake removes the ADP runtime (saves ~600 B gzipped).
- [ ] **Did this add new utility CSS classes?** Arc tree-shakes unused base utilities; verify the new HTML actually references the class.

### 6. Reversibility / Defaults

- [ ] **Sensible default + explicit override.** If you added a feature, can the user opt out via page meta or `arc.config.json`?
- [ ] **No global side effects.** No code that pollutes window, sets globals, or monkey-patches built-ins.
- [ ] **No new hard dependencies** in `package.json` — Arc is zero-prod-deps.

### 7. Accessibility (don't regress Arc's defaults)

- [ ] `<img>` has `alt=` (use `alt=""` for decorative).
- [ ] `<button>` has visible label OR `aria-label`.
- [ ] `<input>` / `<select>` / `<textarea>` has accessible name (label/aria-label/placeholder).
- [ ] Color contrast in design block: body text ≥ 4.5:1, large text ≥ 3:1.
- [ ] No animation longer than 200 ms without a `prefers-reduced-motion` override (Arc auto-emits the reset; verify your custom animations don't bypass it).
- [ ] Focus indicators preserved (`:focus-visible` outline — Arc emits this by default).

### 8. Type safety

- [ ] **Every `@server fn` has typed parameters and return type.** Arc derives client validation from these — incomplete types = no validation.
- [ ] **`@live let` annotated** when the value's type isn't obvious.
- [ ] **Use `Result<T, E>` for fallible functions.** Never throw across the `@server` boundary — return `Err("message")` so the client can pattern-match.
- [ ] **Use `none` not `null`.** Use `?? "default"` not `|| "default"` for empty-value fallback (Arc's truthiness rules: only `false` and `none` are falsy).

## How to apply

When generating Arc code in response to a user prompt:

1. Generate the code following the requesting skill's pattern.
2. Walk through this checklist line by line.
3. For each item, decide: ✓ (passes), ⚠ (flag to user), or N/A (with reason).
4. If any item is ⚠, **show the warning + the simpler/faster alternative** before returning the code.
5. State the time and space complexity of any new function in a one-line comment above its declaration.

## Example application

User: "Add a search input that filters a list of products."

After generating code:

```
✓ Simplicity: 6 lines added, no premature widget extraction
✓ Time complexity: O(n) filter where n = products.length, runs on every keystroke
⚠ INP: filtering 10,000 products on every keystroke may exceed 200 ms.
  Suggestion: debounce to 300 ms via setTimeout, OR move to @server fn if products.length > 1000
✓ Space complexity: O(n) for the filtered result, garbage-collected after render
✓ Bundle bytes: ~200 B (one @state + one @computed + one bind:value listener)
✓ LCP/CLS/FCP: no change (interactive widget, fires after initial render)
✓ A11y: input has type="search", will use placeholder for label hint
✓ Reversibility: nothing global; user can replace any time

Returning code with the debounce suggestion inline.
```

---

When invoked by another skill, that skill's specific verification appends below this checklist — but every dimension here is still checked.


---

## arc-style-guide

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


---

## arc-add-form

---
name: arc-add-form
description: Use when the user wants a form with validated inputs and a submit handler. Triggers on "form", "input validation", "submit handler", "contact form", "login form".
---

# arc-add-form

**When to use:** the user wants HTML form elements bound to state, validated, and submitted.

**Reference docs:** `docs/recipes/forms.md`, `docs/language/types.md` (for `Email`, `Phone`, etc. field types).

## Pattern

Use `@state` for each field, `bind:value` for two-way binding, an `@server fn` for submission with a typed input shape, and `on:submit` on the form.

### Minimal contact form

```arc
@state let name = ""
@state let email = ""
@state let message = ""
@state let result: String | none = none

@server fn submitContact(data: { name: String, email: Email, message: String }) -> Result<String, String>
  if data.message.length < 10
    return Err("Message must be at least 10 characters.")
  await db.contacts.add(data)
  return Ok("Thanks!")

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(msg)  => { @result = msg; @name = ""; @email = ""; @message = "" }
    Err(err) => @result = err
  }
}
  label for="name" "Name"
  input id="name" type="text" bind:value={name} required minlength=2

  label for="email" "Email"
  input id="email" type="email" bind:value={email} required

  label for="message" "Message"
  textarea id="message" bind:value={message} required minlength=10

  button type="submit" "Send"

  if result
    text "{result}"
```

Time complexity: O(1) submission. Server-side depends on `db.contacts.add`.
Space complexity: O(1) per field + O(1) result.
Client bytes: ~400 B (three `@state` + form + submit handler) + ~600 B ADP runtime (shared with any other `@server` invocations on the page).

## Built-in validators (semantic types)

Arc has typed field types that serve as both server validators AND auto-generate matching client validation:

| Type | Validates | Matching `<input type>` |
| --- | --- | --- |
| `String` | non-empty if `required` | `text` |
| `Email` | RFC 5321 | `email` |
| `Url` | absolute URL | `url` |
| `Phone` | E.164 | `tel` |
| `Number` | numeric | `number` |
| `Date` / `DateTime` / `Time` | ISO 8601 | `date` / `datetime-local` / `time` |
| `Color` | hex/rgb/hsl/oklch | `color` |
| `Slug` | URL-safe ASCII | `text pattern=...` |

Use these in the `@server fn` parameter type — Arc auto-emits matching client validation.

## bind:value vs bind:checked

```arc
@state let name = ""        # text/email/etc
@state let agreed = false   # checkbox/radio
@state let role = "user"    # select

input type="text" bind:value={name}
input type="checkbox" bind:checked={agreed}
select bind:value={role}
  option value="user" "User"
  option value="admin" "Admin"
```

`bind:value` for text-like inputs and `<select>`. `bind:checked` for checkbox/radio.

`type="number"` auto-parses to Number with NaN guard.

## Inline error display

For per-field server errors, return a structured `Result`:

```arc
@server fn submitContact(data: ContactInput) -> Result<String, { [String]: String }>
  const errs = {}
  if data.name.length < 2  errs.name = "Name too short"
  if !isValidEmail(data.email)  errs.email = "Invalid email"
  if Object.keys(errs).length > 0
    return Err(errs)
  await db.contacts.add(data)
  return Ok("Thanks!")

@state let errors: { [String]: String } = {}

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(_)    => @errors = {}
    Err(es)  => @errors = es
  }
}
  input type="text" bind:value={name}
  if errors.name
    text "{errors.name}"
  ...
```

## File upload

```arc
@state let file: File | none = none

@server fn upload(file: ArrayBuffer, name: String) -> Result<String, String>
  await storage.put(name, file)
  return Ok("Uploaded")

form on:submit={
  if file
    const buf = await file.arrayBuffer()
    await upload(buf, file.name)
}
  input type="file" on:change={ @file = event.target.files[0] }
  button type="submit" disabled={file == none} "Upload"
```

## Native `<dialog>` for confirmation

```arc
button on:click={ document.getElementById('confirm').showModal() } "Delete"

modal id="confirm"
  heading "Delete this?"
  row
    button on:click={ document.getElementById('confirm').close() } "Cancel"
    button on:click={ await deleteItem(); document.getElementById('confirm').close() } "Delete"
```

## Anti-patterns

- ❌ **No `<label>`** for inputs — `arc check` warns. Use `<label for="id">` + `id=`, OR `aria-label`, OR `placeholder` (last resort).
- ❌ **Untyped `@server fn` params**: `@server fn submit(data)` — Arc can't auto-validate. Always type.
- ❌ **Throwing instead of `Err`**: `if (!valid) throw "bad"` — use `return Err("bad")` so client pattern-matches.
- ❌ **Forgetting `e.preventDefault()`**: Arc's `on:submit` does NOT auto-preventDefault. The form will navigate unless you handle the submit (typically with `await fn(...)`).
- ❌ **`bind:value` on a checkbox**: use `bind:checked`.
- ❌ **Manual `getElementById`** for form fields — use `bind:value` for state, `name=` for native form submission.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Every input has an accessible name** (`<label for>`, `aria-label`, or `placeholder`). `arc check` warns; satisfy it.
- [ ] **Required fields use `required` attribute** (client-side; server-side validation is in the `@server fn` body).
- [ ] **Field types match `@server fn` parameter types**: `<input type="email">` → fn param `Email`. Mismatch breaks auto-validation.
- [ ] **Submit handler awaits the `@server` call** — naked `submitContact(...)` returns a Promise; UI updates won't fire.
- [ ] **Form prevents default**: Arc's `on:submit={ await fn() }` blocks the native form submit only if the handler completes synchronously OR you explicitly call `event.preventDefault()` in the handler.
- [ ] **Errors handled with `match`**: `match` on `Result<T, E>` instead of try/catch — Arc's contract.
- [ ] **Time complexity stated** for any validation logic: per-keystroke validations should be O(1); per-submit can be O(n) for things like cross-field rules.
- [ ] **No double-submit guard missing**: disable the submit button while awaiting (`disabled={submitting}`), OR rely on the `Result` pattern to surface state.
- [ ] **Reset form state on success** if the user wants to submit again (`@name = ""` etc.).


---

## arc-add-image

---
name: arc-add-image
description: Use when the user wants to add images. Arc has a built-in image pipeline that auto-generates AVIF/WebP/JPEG variants, picks layout-aware widths, applies fetchpriority + lazy-loading based on AST position, and emits dominant-color placeholders. The pattern is ALWAYS plain `<img src>`.
---

# arc-add-image

**When to use:** the user wants to add an image (hero, logo, thumbnail, card image).

**Reference docs:** `docs/features/images.md`, `docs/internals/image-pipeline.md`.

## Pattern

**Just use `img src="local.jpg" alt="...">`**. Arc's image pipeline handles everything else.

### Minimal hero + logo + below-fold cards

```arc
page "Showcase"
  header
    img src="hero.jpg" alt="Product hero shot"

  img src="logo.png" alt="Company logo"

  section
    grid cols=3
      img src="card1.jpg" alt="Card 1"
      img src="card2.jpg" alt="Card 2"
      img src="card3.jpg" alt="Card 3"
```

Arc's image pipeline auto-applies:
- **AVIF + WebP + original-format `<picture>` source set** at multiple widths
- **`width=` and `height=`** from the image file header (prevents CLS)
- **`fetchpriority="high"`** on the first 2 images (LCP candidates)
- **`loading="lazy" decoding="async"`** on images after the first `<section>` (below the fold)
- **Dominant-color `background:#...`** style (no gray flash during load)
- **Smart AVIF threshold**: drops AVIF source when not ≥20% smaller than WebP (decode cost would outweigh wire savings)
- **Content-hash dedup**: same image used N times → ONE file in `dist/`

## When the pipeline is a no-op

- **`sharp` not installed**: pipeline falls back to plain `<img>` and warns at build time. Tell the user `npm install sharp` for optimization.
- **External URL** (`src="https://..."` / `src="data:..."`): not processed. For external images you want optimized, download at build time:

```arc
@build const heroBytes = await fetch("https://cdn.example/hero.jpg").then(r => r.arrayBuffer())
# then save to disk + reference locally
```

## Layout-aware widths

Arc emits ONLY the widths the design needs, not a generic ladder:

```arc
img src="thumbnail.jpg" alt="Thumbnail"

design
  img
    w: 200px       # Arc emits widths [200, 400] for retina — NOT [320, 640, 960, 1280]
```

vs Astro / Next.js which emit a fixed ladder regardless of container size.

## Opting out per page

```arc
page "Photos" imageFormats=["webp","jpg"]
  # No AVIF will be generated for any img on this page
  img src="photo1.jpg" alt="..."
```

Useful when AVIF decode cost matters more than wire savings (very small images, low-end devices).

## Anti-patterns

- ❌ **`<picture>` / `<source>` written manually** — Arc generates this. Just use `<img>`.
- ❌ **Manual `srcset`** — Arc generates from intrinsic dimensions + container width.
- ❌ **Adding `loading="lazy"` everywhere** — Arc auto-decides based on AST position. Manual override only when Arc's heuristic is wrong (rare).
- ❌ **Adding `fetchpriority="high"` manually** — same; Arc auto-applies to LCP candidates.
- ❌ **Omitting `alt`** — `arc check` warns. Use `alt=""` for decorative.
- ❌ **External CDN refs when local would work** — local images get the pipeline; external get nothing.
- ❌ **Using SVG as `<img>`** — works but Arc doesn't optimize SVG. For inline SVG, use the `<svg>` element directly.
- ❌ **`<img>` with no `width`/`height`** — Arc fills these from the file. Manual override only when you need different dimensions than the source.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **`alt` attribute set** (even if empty: `alt=""` for decorative).
- [ ] **`sharp` mentioned** if user hasn't installed it — pipeline is a no-op without it.
- [ ] **Above-fold images NOT marked `loading="lazy"`** — Arc handles this; manual `loading="lazy"` on the hero will tank LCP.
- [ ] **CLS-safe**: image has explicit dimensions (Arc auto-adds; verify by reading the emitted HTML).
- [ ] **No `<picture>` written manually** — let the pipeline emit it.
- [ ] **Time complexity**: build-time only — encoding scales with image size + format count. Cards-at-1080p × 3 formats × 4 widths ≈ 1–2 seconds per image. Hero-at-4K may take 10–20 seconds.
- [ ] **Space complexity (disk)**: each image generates ~12 variants (3 formats × 4 widths) by default. For a 1 MB JPEG, dist grows ~3–5 MB on disk. On the wire, browser picks ONE variant.
- [ ] **Bandwidth saved noted**: AVIF is typically 30–50% smaller than WebP, which is 30% smaller than JPEG. Hero often goes from 50 KB JPEG → 8 KB AVIF.
- [ ] **Same image referenced multiple times** triggers Arc's content-hash dedup → ONE file in dist. Verify by checking dist for duplicate basenames.
- [ ] **No images larger than necessary**: if the rendered width is 400 px, source image should be ≤ 800 px (2x retina). Larger sources waste encode time AND disk; Arc clamps widths to intrinsic but won't downsize the source.


---

## arc-add-live

---
name: arc-add-live
description: Use when the user wants per-request, server-rendered data inlined into the initial HTML — dashboards, auth-gated pages, personalized greetings. Triggers on "server-render", "auth-gated", "personalized", "no loading state", "first-paint with real data".
---

# arc-add-live

**When to use:** the user wants data that:
- Changes per visitor (not the same for everyone — that's `@build`)
- Must appear in the FIRST byte of HTML (no loading spinner, no client fetch)
- Doesn't need to update after page load via push (that's `@realtime`)

**Reference docs:** `docs/features/edge-rendering.md`, `docs/recipes/auth-flow.md`.

## Pattern

`@live let x = serverFn()` declares a server-rendered variable. Arc generates an edge function (`dist/_arc/renderer.js`) that:
1. Receives the request at the edge (Cloudflare Worker etc.)
2. Runs all `@live` resolvers in **parallel** via `Promise.all`
3. Fills the values into the HTML template
4. **Streams** the response — `<head>` flushes before data resolves, body follows when ready

The browser receives complete HTML in one round trip. **No loading flash.** No client-side fetch.

### Minimal dashboard

```arc
page "Dashboard"
  @server fn getUser() -> { name: String, role: String }
    return await db.users.find(@session.userId)

  @server fn getStats() -> { users: Number, revenue: Number }
    return await db.stats.summary()

  @live let user = getUser()
  @live let stats = getStats()

  header
    heading "Welcome back, {user.name}"
  main
    row
      card { heading "Users";   text "{stats.users}" }
      card { heading "Revenue"; text "${stats.revenue}" }
```

Time complexity (request-time): `max(getUser, getStats)` — they run in parallel.
Space complexity: O(1) per resolved value, kept in edge worker memory only for the duration of the request.
Client bytes: **0 B for the @live data itself** — it's inlined in HTML. Plus whatever `@state` / `@server` invocations the rest of the page needs.

## Parallel resolution is automatic

Arc emits:

```js
const [user, stats] = await Promise.all([getUser(), getStats()])
```

If you have 3 `@live let` declarations with 50 ms server-side cost each, total wait is **50 ms** (not 150 ms). Verify they're independent — `@live let b = useA(a)` chains break parallelism.

## Streaming response

`renderer.js` returns `Response(stream)` instead of `Response(html)`:
1. Flushes `<head>` immediately — browser starts parsing CSS, preloading fonts
2. Awaits data
3. Flushes filled-in body

On a real production network, this saves the data-fetch latency from FCP. On localhost it's invisible.

## Auth example

```arc
page "Settings"
  @server fn getMe() -> User
    return await db.users.find(@session.userId)
    # @session.userId access triggers automatic 401 if session cookie is missing/invalid

  @live let me = getMe()

  header
    heading "{me.name}"
    text "Email: {me.email}"
```

If the request has no valid session, Arc returns 401 before `getMe()` runs. You don't write middleware.

## Updates after first render

If the user wants the `@live` value to refresh after a button click, reference it from a `@server fn` invocation:

```arc
@server fn getStats() -> Stats
  return await db.stats.fresh()

@live let stats = getStats()
button on:click={ stats = await getStats() } "Refresh"

text "Revenue: ${stats.revenue}"
```

The button click triggers an ADP binary call; the response decodes to `Stats` and updates bound elements — no full reload.

## Anti-patterns

- ❌ **Chaining `@live` resolvers** that depend on each other: `@live let user = getUser(); @live let posts = getPosts(user.id)` — defeats parallelism. Make one `@live let { user, posts } = getEverything()` instead.
- ❌ **Using `@live` for static data**: if the value is the same for everyone, use `@build` (zero edge function cost, zero per-request latency).
- ❌ **Using `@live` for client-only state**: form inputs, toggles → `@state`. Edge rendering of pure UI state is wasted compute.
- ❌ **Adding loading skeletons** before `@live` data — there is no loading state. The HTML arrives with data already in it.
- ❌ **`@live let x = someExpression()` where `someExpression` is not a `@server fn`** — must be a server function (or stdlib call that compiles to one).
- ❌ **Accessing `@session` outside `@server`** — only available in `@server fn` bodies, validated at edge boundary.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Each `@live let` calls an independent `@server fn`** — no chains, no shared dependencies that block parallelism.
- [ ] **All `@server fn` signatures are typed** (params + return) — Arc needs types to generate the ADP wire format.
- [ ] **Edge function emit verified**: after build, check `dist/_arc/renderer.js` exists and contains `Promise.all`.
- [ ] **`@session` accesses are explicit** so Arc knows to validate.
- [ ] **No spinner UI** — `@live` is server-rendered, no loading state to show.
- [ ] **Error path defined**: wrap server logic in `try { ... } catch { return Err(...) }` if it can fail; otherwise the edge worker returns 500 with no user-visible message.
- [ ] **LCP impact stated**: total `@live` resolution time directly affects LCP. Each resolver should run in <100 ms typical. If any takes >500 ms, consider caching (edge KV) or moving to `@build` if data allows.
- [ ] **No PII in `console.error`** that the edge logs (Cloudflare/Deno log streams may persist; scrub user data).


---

## arc-add-realtime

---
name: arc-add-realtime
description: Use when the user wants live pushed updates from server to browser — chat, presence, collaborative editing, live counters, notifications. Triggers on "chat", "live updates", "presence", "WebSocket", "real-time", "pushed from server".
---

# arc-add-realtime

**When to use:** data updates need to push from server to browser without the user reloading the page. Distinct from `@live` (one-shot per page request) and `@server` (one-shot per user action).

**Reference docs:** `docs/features/realtime.md`, `docs/reference/adp.md`.

## Pattern

`@realtime let messages = channel("name")` declares a WebSocket subscription. Arc generates:
1. WebSocket connection management with auto-reconnect (exponential backoff: 1s → 2s → 4s → 8s, capped at 30s)
2. ADP binary frame parser (3× smaller than JSON, 10× faster decode)
3. Direct DOM updates as frames arrive

Client cost: ~800 B gzipped (decoder + reconnect logic + binding wiring).

### Minimal chat

```arc
@realtime let messages = channel("chat/room-42")
@state let draft = ""

main
  for msg in messages live="polite"
    card
      text "{msg.author}: {msg.body}"

  form on:submit={
    messages.send({ author: "Me", body: draft })
    @draft = ""
  }
    input bind:value={draft}
    button type="submit" "Send"
```

`live="polite"` opts the rendered list into `aria-live` for screen readers — by default Arc does NOT auto-emit `aria-live` for reactive lists (would be noisy).

### Presence

```arc
@realtime let onlineUsers = channel("presence/room-42")

text "{onlineUsers.length} online"
for u in onlineUsers
  img src="{u.avatar}" alt="{u.name}"
```

### Multiple channels (multiplexed over one connection where possible)

```arc
@realtime let messages = channel("chat/room-42")
@realtime let presence = channel("presence/room-42")
@realtime let typing   = channel("typing/room-42")
```

## Sending

`channel("name").send(value)` ADP-encodes and sends:

```arc
messages.send({ author: "Me", body: text })
```

Becomes:

```js
const buf = _adpEncode({ author: "Me", body: _text })
_ws.send(buf)
```

## Server side (NOT auto-generated)

Arc generates the **client**. You provide the **server**. The server's job:
1. Accept WebSocket at `wss://your-app/realtime/<channel-name>`
2. Validate the session cookie (Arc forwards it on the WS handshake)
3. Subscribe the connection to channel events
4. Send ADP-encoded frames as state changes

Common server choices:
- **Cloudflare Durable Objects** — `arc deploy --target cloudflare` generates a DO stub per `@realtime` channel; you fill in broadcast logic
- **Bun / Node standalone** — `arc deploy --target {bun,node}` emits a `realtime-server.js` with WebSocket boilerplate
- **External broker** (Pusher, Ably, custom Redis pub/sub) — configure `arc.config.json` `realtime.url`

## Frame format

ADP-encoded objects:

```js
{
  type: "append" | "set" | "delete" | "error",
  value: <any>,
  meta?: <any>
}
```

- `append` → push to array (default behavior for `for x in messages`)
- `set` → replace entire array (use on reconnect to resync)
- `delete` → remove by id
- `error` → user-facing error message

## Optimistic updates

```arc
@realtime let messages = channel("chat/room-42")
@state let pending = []  # local optimistic queue

fn submit(text) {
  const tmpId = crypto.randomUUID()
  @pending = [...pending, { id: tmpId, body: text, sending: true }]
  messages.send({ tmpId, body: text })
}

# Server echoes back { tmpId, id: realId, body, sentAt }
# Listen for echo and swap pending[tmpId] → confirmed
```

## Anti-patterns

- ❌ **Polling with `@live` instead of using `@realtime`**: if updates need to push, don't fetch every second.
- ❌ **Using `@realtime` for one-time fetches**: persistent WebSocket connection has overhead. For "show user's current X once," use `@live`.
- ❌ **Not handling reconnect resync**: Arc auto-reconnects but the server must send a `{ type: "set", value: [...currentState] }` frame on connect so the client doesn't show stale data.
- ❌ **Sending huge payloads**: ADP is efficient but per-frame >100 KB will stress the connection. Paginate or use delta updates.
- ❌ **Mutating `messages` directly** — it's managed by Arc. Use `.send()` to publish; the local view updates when the server echoes back.
- ❌ **Skipping `live="polite"` on critical message lists** — screen readers won't announce new messages. Use `polite` (or `assertive` sparingly).

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Server-side endpoint exists or scaffold instructions provided** — `@realtime` client is auto-generated but useless without a WS server. Always mention this when scaffolding.
- [ ] **Channel name is parameterized appropriately**: per-room (`chat/{roomId}`), per-user (`notify/{userId}`) — not a global firehose.
- [ ] **Auth on the WS handshake**: server reads cookie from upgrade request. Don't forget — WebSockets bypass usual auth middleware unless you wire it in the upgrade handler.
- [ ] **Reconnect strategy includes resync**: server should send `{ type: "set", value: [...] }` on connect with current state.
- [ ] **Wire format is ADP** (`Content-Type: application/x-adp` for HTTP fallback if any). Don't mix JSON frames into the same channel.
- [ ] **`aria-live` opt-in on the message list**: `live="polite"` for chat, `live="assertive"` only for critical alerts (sparingly — overuse is screen-reader-hostile).
- [ ] **Time complexity**: list updates are O(1) for `append`/`delete-by-id`, O(n) for `set`. Most chat patterns are append-only → O(1).
- [ ] **Space complexity**: messages array grows unbounded. If retention matters, cap with `messages.slice(-100)` in the render template or have the server limit history.
- [ ] **Bytes**: WebSocket connection + reconnect logic is ~800 B gz (shared across all `@realtime` channels on the page). Adding more channels is ~0 incremental client bytes.


---

## arc-add-server-fn

---
name: arc-add-server-fn
description: Use when the user wants a function that runs on the server but is callable from the client — RPC, mutations, form submissions, anything triggered by a user action. Triggers on "RPC", "callable from client", "mutation", "API endpoint", "save to database".
---

# arc-add-server-fn

**When to use:** the client (browser) needs to invoke server-side logic in response to a user action (click, form submit). Distinct from `@live` (which renders server data into the initial HTML, no client invocation).

**Reference docs:** `docs/features/edge-rendering.md`, `docs/reference/adp.md`.

## Pattern

A `@server fn` declaration generates:
1. The function body runs on the edge (Cloudflare Worker / Deno Deploy / Bun / Node) at request time.
2. A typed client stub: `async function fnName(args) { ... fetch with ADP body ... }` that POSTs ADP-encoded args to `/_arc/fn/fnName`.
3. ADP encoder + decoder runtime in the client bundle (ONLY if any `@server fn` is actually called from client JS — otherwise tree-shaken).

### Minimal mutation

```arc
@server fn likePost(postId: String) -> Number
  return await db.likes.toggle({ user: @session.userId, postId })

@state let likeCount = post.likes

button on:click={ @likeCount = await likePost(post.id) }
  "♥ {likeCount}"
```

Time complexity: O(1) client-side. Server-side depends on `db.likes.toggle`.
Client bytes: ~250 B (stub + button handler) + ~600 B ADP runtime (shared across all `@server` fns on the page).

### Fallible operations with `Result<T, E>`

```arc
@server fn submitContact(data: { name: String, email: Email, message: String }) -> Result<String, String>
  if data.message.length < 10
    return Err("Message too short")
  await db.contacts.add(data)
  return Ok("Thanks!")

@state let result: String | none = none

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(msg)   => @result = msg
    Err(err)  => @result = "Error: " + err
  }
}
  ...
  if result
    text "{result}"
```

### @session validation (auto)

```arc
@server fn deletePost(id: String) -> Result<none, String>
  if @session.role != "admin"
    return Err("Forbidden")
  await db.posts.delete(id)
  return Ok(none)
```

If `@session.userId` (or `@session.role`, etc.) is accessed and the request has no valid session cookie, Arc returns **401 Unauthorized** before your function body runs. You don't write auth middleware.

## Tree-shake awareness

The ~600 B ADP runtime ships to the client ONLY when at least one `@server fn` is actually invoked from client code (an `on:click` handler, etc.). If `@server` fns exist but are only called from `@live`, the runtime is stripped.

**Verify** when scaffolding: the generated `@server fn` should be referenced from a client handler, or its presence is wasted setup.

## Anti-patterns

- ❌ **Throwing across the boundary**: `throw new Error("bad")` — instead `return Err("bad")` so the client can pattern-match. Throws cross-compile to a 500 with no user-visible message.
- ❌ **Untyped signatures**: `@server fn save(x)` — Arc can't generate client validation; ADP encoder falls back to JSON. Always type both params and return.
- ❌ **Accessing `@session` outside `@server`/`@live`** — it's only available at the edge boundary.
- ❌ **Returning non-serializable**: functions, Date objects with extra props, class instances. ADP supports primitives + arrays + plain objects. Use ISO date strings for dates.
- ❌ **Calling `@server fn` in `@computed`** — fires on every reactive change, hammers the server. Debounce, or restructure.
- ❌ **Forgetting `await`**: `const r = likePost(id)` returns a Promise. Use `await`.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Signature is fully typed**: params + return type. Untyped fns lose validation + ADP optimization.
- [ ] **Fallible fns return `Result<T, E>`**, not throw. Pattern-match at call site.
- [ ] **`@session` accesses are explicit** (`@session.userId`, `@session.role`) so Arc knows to validate at the edge.
- [ ] **Called from client JS**, OR the user is okay with the ~600 B ADP runtime cost. If only used by `@live`, prefer inline + no client invocation (saves bytes via tree-shake).
- [ ] **Idempotent or has CSRF protection**: state-changing fns should be safe to call multiple times OR protected. Arc adds CSRF tokens automatically for `@live`-rendered pages; static pages need `arc.config.json` `session.csrf: true`.
- [ ] **Server-side validation NOT skipped just because client validates**: defense in depth. The auto-generated client validation is convenience, not a security boundary.
- [ ] **Time complexity stated** for any new logic in the fn body — these run on every request.
- [ ] **No N+1 queries** in the fn body — batch DB calls if iterating over a list.


---

## arc-add-state

---
name: arc-add-state
description: Use when adding reactive client-side state to an Arc page or widget — counters, toggles, form inputs, anything that updates the DOM without a server round-trip. Triggers on "make this interactive", "add a counter", "toggle", "track this value".
---

# arc-add-state

**When to use:** the user wants a value that lives in the browser and updates the DOM when it changes. Not server data (use `@live`/`@server`); not compile-time data (use `@build`).

**Reference docs:** `docs/language/reactive.md`, `docs/recipes/interactive-list.md`.

## Pattern

`@state let name = initialValue` declares a reactive variable. Writes use `@name` (with the `@` prefix). The compiler emits one setter per `@state` variable that updates exactly the DOM nodes that reference it — no virtual DOM, no diff.

### Minimal counter

```arc
@state let count = 0

main
  text "Count: {count}"
  button on:click={ @count += 1 } "+"
  button on:click={ @count -= 1 } "−"
  button on:click={ @count = 0 } "Reset"
```

Time complexity: O(1) per click. Space complexity: O(1) for `_count` + O(1) per element reference.
Client bytes: ~150 B (one setter + three event listeners).

### Two-way binding (form input)

```arc
@state let name = ""
@state let agreed = false

form
  input type="text" bind:value={name} placeholder="Name"
  label
    input type="checkbox" bind:checked={agreed}
    text "I agree"
  text "Hello, {name ?? "stranger"}"
```

`bind:value` wires both directions automatically — typing updates `@name`, programmatic `@name = "new"` updates the input.

### Derived values via @computed

```arc
@state let items = [1, 2, 3, 4, 5]
@state let multiplier = 2

@computed let doubled = items.map(x => x * multiplier)
@computed let sum = doubled.reduce((a, b) => a + b, 0)

text "Sum: {sum}"
button on:click={ @multiplier += 1 } "Multiply more"
```

Dependency graph: `items` + `multiplier` → `doubled` → `sum`. Changing `multiplier` recomputes `doubled` then `sum`; touching `items` does the same. Arc derives this graph at compile time — no runtime tracking overhead.

## Writes: ALWAYS use `@varname`

```arc
@state let count = 0

# ✓ Correct — @count triggers the setter, updates the DOM
button on:click={ @count += 1 } "+"

# ❌ Wrong — `count = count + 1` reassigns the local capture only;
#    DOM does NOT update. This is the #1 LLM mistake.
button on:click={ count = count + 1 } "+"

# ✓ Bulk update (replace whole array)
button on:click={ @items = [...items, newItem] } "Add"
```

## Don't reach for @state when…

- The value is the same for every visitor → use `@build`
- The value comes from the server per-request → use `@live`
- The value is derived from other reactive values → use `@computed`
- The user only needs the value at a single point in time (no re-render needed) → use a local `let`

## Anti-patterns

- ❌ Writing `count = count + 1` instead of `@count += 1` — the most common LLM mistake. The reactive update only fires with the `@` prefix.
- ❌ `@state let isLoading = false` for `@live` data — `@live` already has no loading state because it's server-rendered. Loading state is a vanilla-SPA anti-pattern.
- ❌ Mutating arrays/objects in place (`@items.push(x)`) — Arc's reactive setter requires re-assignment to detect changes. Use spread: `@items = [...items, x]`.
- ❌ Storing derived data: `@state let doubled = count * 2` then manually updating both — use `@computed`.
- ❌ `bind:value` on non-input elements — only `<input>`, `<select>`, `<textarea>`. For other elements, set the attribute via interpolation: `<div title="{name}">`.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Writes use `@` prefix**: grep the generated code for `<var> = ` where `<var>` is a `@state` name without `@` — that's a silent bug.
- [ ] **`bind:value`** used on the right input type (`bind:checked` for checkbox/radio; `bind:value` for everything else).
- [ ] **Number inputs**: `type="number"` auto-parses to Number; verify the user wants Number (not String).
- [ ] **Derived values use `@computed`**: any value that's `f(otherState)` should be `@computed`, not `@state`.
- [ ] **List updates use spread/re-assignment**: `@items = [...items, x]`, not `@items.push(x)`.
- [ ] **Initial value matches the declared type**: `@state let count = 0` (number), `@state let name = ""` (string), `@state let items = []` (array).
- [ ] **Client JS cost noted**: each `@state` ships ~50–200 B. Three `@state` vars = ~500 B before any handlers. If approaching 1 KB, consider whether `@build` could replace any of them.


---

## arc-bug-report

---
name: arc-bug-report
description: Use when the user describes a problem with Arc and wants to file a bug report. Walks them through the GitHub issue template + helps draft the reproducer.
---

# arc-bug-report

**When to use:** the user encountered an Arc compiler bug, syntax error they think is wrong, unexpected output, etc. — and wants to file an issue.

**Reference:** `.github/ISSUE_TEMPLATE/bug_report.yml`, `docs/reference/errors.md`.

## What goes in a good bug report

1. **Arc version** — `arc --version`
2. **Node version** — `node --version`
3. **OS** — Linux / macOS / Windows + version
4. **Minimal `.arc` reproducer** — smallest source that triggers the bug
5. **Command run** — `arc build`, `arc check`, `arc dev`, etc.
6. **Expected behavior** — what should have happened
7. **Actual behavior** — what did happen (full error + stack)
8. **Anything else** — related issues, hypotheses, screenshots

The `.github/ISSUE_TEMPLATE/bug_report.yml` form prompts for each of these.

## How to minimize a reproducer

Iteratively delete until the bug goes away, then put back the last thing you deleted. The goal: shortest `.arc` source that still triggers the issue.

Common minimization steps:
1. Delete unrelated widgets / pages from the project.
2. Replace `@build fetch(...)` with `@build const x = [...]` (rules out network).
3. Replace external imports with inline equivalents.
4. Trim CSS that isn't part of the bug.
5. Reduce to one element if possible.

A 5-line reproducer is gold; a 50-line one is fine; a 500-line one needs more minimization before filing.

## Check the error catalog first

Before filing, check `docs/reference/errors.md` for the exact error message. If it's listed with a fix, the bug might be your code rather than Arc's. (No shame — the catalog exists because these are common.)

## Check existing issues

Search `github.com/arc-language/arc-web/issues` (open + closed) for keywords from the error message. Duplicates close fast; pointing at the existing issue is more useful than filing again.

## Template the user fills out

```markdown
**Arc version:** 0.1.0
**Node version:** v22.0.0
**OS:** Linux 6.8

**Minimal source (.arc):**
\`\`\`arc
page "Repro"
  ...
\`\`\`

**Command:** `arc build`

**Expected:** the page builds without error.

**Actual:**
\`\`\`
arc: error: index.arc:3:5: <error message>
  3 │   problematic line
        ^
\`\`\`

**Notes:**
- Worked in 0.0.X (if regression)
- See also #123 (related)
- Hypothesis: the bug might be in src/parser.js because...
```

## When NOT to file as a bug

| Symptom | Right channel |
| --- | --- |
| Question "how do I do X?" | [GitHub Discussions](https://github.com/arc-language/arc-web/discussions) |
| Feature request | Issue with `feature_request.yml` template |
| Security vulnerability | Privately via [security advisory](https://github.com/arc-language/arc-web/security/advisories/new) — NEVER public issue |
| Documentation gap | Issue OR PR with the doc fix |
| Behavior matches docs but you disagree with the design | Discussion first; if traction, RFC PR |

## Anti-patterns

- ❌ **"Arc is broken" with no reproducer** — won't get diagnosed. A 5-line `.arc` file is the minimum.
- ❌ **Pasting your entire app** — minimize first.
- ❌ **"Fix this"** without describing expected vs actual.
- ❌ **Including secrets** in the reproducer (env vars, API keys, internal URLs).
- ❌ **Multiple bugs in one issue** — split. Each issue gets its own reproducer.
- ❌ **Filing security issues publicly** — use the private advisory channel.

## Verification

Apply the universal **arc-self-verify** checklist to the user's BUG (verify it's actually broken). In addition:

- [ ] **Reproducer minimized** — under 20 lines if possible.
- [ ] **Versions stated** (Arc, Node, OS).
- [ ] **Command stated** (`arc build` / `arc check` / etc.).
- [ ] **Expected vs actual** clearly separated.
- [ ] **Error message full** — including line number + caret + stack trace if any.
- [ ] **No secrets** in the reproducer.
- [ ] **Checked against `docs/reference/errors.md`** — if listed, the user's code is the bug, not Arc.
- [ ] **Searched existing issues** — no obvious duplicate.
- [ ] **Right channel chosen** — bug template for bugs; discussion for questions; advisory for security.
- [ ] **Issue title is specific**: "Parser eats DEDENTs after design block when followed by top-level const" — NOT "parser bug".


---

## arc-contributor-pr

---
name: arc-contributor-pr
description: Use when a contributor wants to submit a PR to the Arc compiler itself (not their own Arc project). Guides through finding the right file, writing the test, updating docs + CHANGELOG, matching the PR template.
---

# arc-contributor-pr

**When to use:** the user says "I want to fix a bug in Arc", "I'd like to add a feature to the compiler", "how do I contribute?". This is about contributing to `github.com/arc-language/arc-web` itself, NOT about writing Arc apps.

**Reference docs:** `CONTRIBUTING.md`, `docs/internals/contributing.md`, `docs/internals/pipeline.md`, `.github/PULL_REQUEST_TEMPLATE.md`.

## PR checklist (matches `.github/PULL_REQUEST_TEMPLATE.md`)

Before opening:

- [ ] `node --test tests/*.test.js` passes locally
- [ ] Coverage ≥95% on lines you touched (`node --test --experimental-test-coverage tests/`)
- [ ] No new entries in `dependencies` of `package.json` (Arc is zero-prod-dep)
- [ ] Docs updated if you added a CLI flag, error, syntax, or public API
- [ ] `CHANGELOG.md` `[Unreleased]` updated if user-visible
- [ ] Examples still build: `for ex in examples/*; do node src/cli.js build "$ex"; done`

## Where to make the change

| Change kind | File(s) |
| --- | --- |
| New syntax | `src/lexer.js` (token), `src/parser.js` (parse rule), `src/checker.js` (semantic check), `src/emitters/{html,css,js}.js` (output), `tests/*` |
| Bug in HTML emitter | `src/emitters/html.js` + `tests/html-emitter.test.js` |
| Bug in CSS emitter | `src/emitters/css.js` + `tests/css-emitter.test.js` |
| Bug in JS emitter | `src/emitters/js.js` + `tests/js-emitter.test.js` |
| Bug in `@server` codegen | `src/emitters/server.js` + `tests/server.test.js` (if exists) |
| Bug in `@live` edge renderer | `src/edge/renderer.js` + `tests/integration.test.js` |
| Bug in `@realtime` | `src/realtime/client.js` + `tests/realtime.test.js` |
| Bug in image pipeline | `src/img-pipeline.js` + `tests/img-pipeline.test.js` |
| New CLI flag | `src/cli.js` (main switch + help text) + `docs/reference/cli.md` |
| New `@build` capability | `src/build-exec.js` + `tests/build-exec.test.js` |
| Stdlib module | `stdlib/<name>.arc` + `tests/stdlib.test.js` |
| New error message | the emitting file + `docs/reference/errors.md` (catalog) |
| Doc improvement | `docs/<area>/<page>.md` |

## Test conventions

```js
// tests/feature.test.js
const { describe, test } = require('node:test')
const assert = require('node:assert')

describe('feature: behavior', () => {
  test('descriptive case name', async () => {
    // 1. Arrange: set up input
    const src = 'page "T"\n  text "hi"'

    // 2. Act: run the compiler
    const { html, css, js } = await compile(src)

    // 3. Assert: verify output
    assert.ok(html.includes('<p>hi</p>'))
    assert.equal(js.trim(), '')
  })

  test('failing case before fix, passing case after', async () => {
    // Tests for bug fixes should FAIL on the old code, PASS on the new
    ...
  })
})
```

## Commit message convention

Follows what's already in the git log:

| Prefix | Use |
| --- | --- |
| `feat:` | New user-visible feature |
| `fix:` | Bug fix |
| `refactor:` | Code restructure (no behavior change) |
| `chore:` | Tooling, CI, deps |
| `docs:` | Docs only |
| `test:` | Tests only |
| `perf:` | Performance improvement |

Example: `fix: parser eatIf consumed all DEDENTs via skipWhitespace`

## Workflow

1. **Open an issue** describing the problem. Big changes (new syntax, breaking API) should be discussed before code.
2. **Fork** + create a branch: `git checkout -b fix/parser-dedent-bug`.
3. **Make the smallest change** that fixes the issue. No unrelated cleanups.
4. **Add a failing test first** (for fixes) — then make it pass.
5. **Run full test suite**: `node --test tests/*.test.js`. Expect 1070+ passing.
6. **Update docs**: error catalog, CLI reference, syntax doc, whatever applies.
7. **Update `CHANGELOG.md`** under `[Unreleased]` if user-visible.
8. **Open PR** using the template in `.github/PULL_REQUEST_TEMPLATE.md`.
9. **Wait for CI** to go green (Node 20 + 22 matrix).
10. **Iterate** on review.

## Anti-patterns

- ❌ **Bundling unrelated fixes** in one PR. One concern per PR.
- ❌ **Refactoring touched files** beyond what the fix needs. Save for a separate PR.
- ❌ **No tests** — won't merge. Even for "obvious" fixes.
- ❌ **Adding new dependencies** to `dependencies`. Arc is zero-prod-dep; this is a hard rule.
- ❌ **Skipping the CHANGELOG** for user-visible changes.
- ❌ **Suppressing CI failures** (`if: false`, `--skip`) instead of fixing them.
- ❌ **Force-pushing after review starts** — confuses reviewers; use new commits, squash on merge.

## Verification

Apply the universal **arc-self-verify** checklist for the code change itself. In addition:

- [ ] **Test added** that fails on old code, passes on new (for fixes) OR exercises the new behavior (for features).
- [ ] **Coverage on touched lines ≥95%**.
- [ ] **Full test suite passes** (`node --test tests/*.test.js` → 1070+/1071).
- [ ] **Examples still build** (the loop in CI does this; mirror locally before pushing).
- [ ] **Lint passes** (`find src adp -name '*.js' | xargs node --check`).
- [ ] **Docs updated** for the change category from the table above.
- [ ] **CHANGELOG.md `[Unreleased]`** has an entry if user-visible.
- [ ] **PR description filled** per template — including risk assessment.
- [ ] **No new `package.json` deps** added (unless explicitly discussed in an issue first).
- [ ] **Commit messages** follow conventional prefixes (`fix:`, `feat:`, etc.).


---

## arc-debug-live-streaming

---
name: arc-debug-live-streaming
description: Use when a `@live` page hangs, returns 500, doesn't render data, or shows blank HTML. Walks through edge-renderer logs, parallel resolution, session validation, and template substitution.
---

# arc-debug-live-streaming

**When to use:** the user reports their `@live` page is "hanging", "blank", "returning 500", "data not appearing", or "loading forever".

**Reference docs:** `docs/features/edge-rendering.md`, `dist/_arc/renderer.js` (auto-generated).

## Diagnosis flow

### 1. Is there a `@live` decl at all?

```bash
grep -r "@live let\|@live const" <project>/*.arc
```

No matches → there's no edge function. Use `arc build` (not `arc build-site`) for static pages. The user may have confused `@live` with `@server` or `@state`.

### 2. Did `dist/_arc/renderer.js` emit?

After `arc build`, check:

```bash
ls dist/_arc/
# Should show: functions.js (if @server fns)
#             renderer.js (if @live decls)
```

If `renderer.js` is missing, the build skipped it — verify `@live` actually parses (run `arc check`).

### 3. Run the edge function locally

```bash
node -e "
const handler = require('./dist/_arc/renderer.js').default
const req = new Request('http://localhost/', { headers: { cookie: 'session=test' } })
handler.fetch(req, {}, {}).then(r => r.text()).then(html => console.log(html.slice(0, 1000)))
"
```

If this returns 500 → check stderr for `[arc] @live data error: ...`.

### 4. Check `_resolveData` runs in parallel

Open `dist/_arc/renderer.js`. Look for:

```js
async function _resolveData(request) {
  const _session = request._arc_session ?? {}
  try {
    const [user, stats] = await Promise.all([(getUser()), (getStats())])
    return { user, stats }
  } catch (e) { ... }
}
```

If it's NOT `Promise.all` (e.g., sequential `await`), Arc's parallel-resolver bug returned. File an issue with the Arc version.

### 5. Check each `@server fn` works in isolation

```bash
node -e "
const fns = require('./dist/_arc/functions.js')
fns.getUser('current').then(console.log).catch(console.error)
"
```

If this throws, the `@server fn` body has a bug — not Arc's fault. Check:
- DB connection string
- `@session.userId` access without a valid session
- External fetch URL reachable from the edge environment

### 6. Session validation failing → 401 before your fn runs

If `@session.userId` is accessed and there's no valid session cookie, Arc returns **401 Unauthorized** without running your `@server fn`. Verify:

```bash
curl -v -H "Cookie: session=YOUR_TOKEN" http://localhost:PORT/
```

Status 401 = session invalid. Check `arc.config.json` `session.validate` config + the cookie value sent.

### 7. Template substitution missing

The HTML has placeholder spans like `<span data-arc-live id="_a1"></span>` that get filled by `_fillHtml(data)`. If you see those spans in the served HTML, `_fillHtml` didn't run — usually means `_resolveData` returned `__arc_render_error__: true`.

Check the edge logs for `[arc] @live data error: <message>`.

### 8. Streaming half-renders

Arc's edge handler returns a `ReadableStream` — head flushes immediately, body flushes after data resolves. If the user sees the head but no body (page "hangs"):

- A `@server fn` is hanging (infinite await on a fetch that never resolves)
- Add timeout to the fetch: `fetch(url, { signal: AbortSignal.timeout(5000) })`
- Check edge worker logs for timeout messages

### 9. CSP / CORS issues with external fetches

If `@server fn` fetches `https://api.external/...`:
- Cloudflare Workers: outbound fetch works by default
- Deno Deploy: same
- Node `arc deploy --target node`: same
- Browser-side (NOT the case for `@server`, but verify): would need CORS allow

If the external API returns CORS errors, it's not Arc — fix the upstream.

### 10. Browser cache showing stale HTML

Arc emits `Cache-Control: private, no-cache` on `@live` responses — but a CDN in front may cache. Verify:

```bash
curl -v http://your-site/ 2>&1 | grep -i "cache-control"
```

If you see `public, max-age=...`, your CDN config is overriding Arc's headers. Adjust the CDN's caching for the dynamic path.

## Common LLM-generated bugs

- **Sequential `@live let` chains** that depend on each other → defeats parallelism. Fix: combine into one `@live let { a, b } = serverFn()`.
- **`@server fn` throwing instead of `return Err(...)`** → edge worker returns 500 with no user-visible message.
- **Forgetting `await` inside `@server fn` body** → returns a Promise as the response, ADP encodes weirdly.
- **Accessing `process.env` in `@server fn`** → only works on Node target; fails on Cloudflare Workers. Use `env` binding instead.

## Anti-patterns

- ❌ **Adding client-side loading skeleton** for `@live` data — `@live` is server-rendered, no client loading state.
- ❌ **Polling `@server fn` to refresh `@live` data** — that's just inefficient `@realtime`. Either use real `@realtime` or full page reload.
- ❌ **Try/catch around `@live let` declarations** — they're not statements; the edge function wraps them in try/catch automatically. Wrap inside the `@server fn` body instead.
- ❌ **Modifying `dist/_arc/renderer.js` by hand** — regenerated every build. Make the source change in `.arc`.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **`@live` declared at the page level**, not inside a widget (widgets don't get edge functions).
- [ ] **`@server fn` typed** (params + return type) so ADP works.
- [ ] **`@server fn` uses `return Err(...)`** not throw, for fallible operations.
- [ ] **`_resolveData` uses `Promise.all`** (verify in `dist/_arc/renderer.js`).
- [ ] **Edge function logs accessible**: `wrangler tail` (Cloudflare) / dashboard stream (Deno) / stdout (Bun/Node).
- [ ] **Session validation tested**: try a request with and without a valid cookie; expect 200 vs 401.
- [ ] **External fetch timeouts set**: never `await fetch(...)` without `signal: AbortSignal.timeout(N)` — a stuck origin will hang the edge function.
- [ ] **Time complexity stated**: edge function runs on EVERY request. If any fn is O(n) over a big collection, cache at the edge (KV).
- [ ] **No PII in `console.error`** logged from edge — log streams persist.


---

## arc-debug-state-binding

---
name: arc-debug-state-binding
description: Use when a `@state` value isn't updating the DOM, or a `bind:value` / `on:click` handler isn't firing. The #1 cause is missing `@` prefix on writes — but several other gotchas exist.
---

# arc-debug-state-binding

**When to use:** the user reports "my button doesn't update the count", "bind:value doesn't sync", "clicking does nothing", "input typing doesn't update state".

**Reference docs:** `docs/language/reactive.md`.

## Diagnosis flow

Run through these checks in order — the first match is usually the bug.

### 1. Missing `@` prefix on writes (the #1 cause)

```arc
# ❌ Wrong — assigns to local capture, DOM doesn't update
button on:click={ count = count + 1 } "+"

# ✓ Correct — @ prefix triggers the reactive setter
button on:click={ @count += 1 } "+"
```

**Detection**: grep the source for `<varname> =` where `<varname>` matches a `@state let <varname>` declaration. If the assignment doesn't start with `@`, it's the bug.

### 2. `bind:` vs `bind:value` typo

```arc
# ❌ Wrong attribute name
input bind={name}

# ✓ Correct
input bind:value={name}

# ✓ For checkboxes/radios
input type="checkbox" bind:checked={agreed}
```

`bind:value` works on `<input>` (most types), `<select>`, `<textarea>`. `bind:checked` works on checkbox/radio.

### 3. `on:` event name not a real DOM event

```arc
# ❌ Wrong event name
button on:tap={ @count += 1 }

# ✓ Use standard DOM event names
button on:click={ @count += 1 }
```

Valid: `click`, `input`, `change`, `submit`, `keydown`, `keyup`, `mouseenter`, `mouseleave`, `focus`, `blur`, etc.

### 4. Mutating array/object in place

```arc
@state let items = []

# ❌ Wrong — push mutates, doesn't trigger setter
button on:click={ @items.push(newItem) }

# ✓ Correct — re-assignment triggers the setter
button on:click={ @items = [...items, newItem] }
```

Arc detects changes via re-assignment. Mutations are invisible to the reactive system.

### 5. Computed value not reading from reactive

```arc
@state let x = 1

# ❌ Wrong — `let` is a one-time computation, not reactive
let doubled = x * 2
text "{doubled}"

# ✓ Correct — @computed re-runs when x changes
@computed let doubled = x * 2
text "{doubled}"
```

### 6. Reading `@state` value inside an event handler — use the bare name, not `@`

```arc
@state let count = 0

# ✓ Correct — @count for WRITES, bare count for READS
button on:click={ @count = count + 1 }
```

Pattern: `@x = ...` for writes; `x` for reads within the handler.

### 7. Variable referenced before declaration

```arc
# ❌ Wrong — forward reference in template
text "{count}"
@state let count = 0

# ✓ Correct — declare reactive vars at the top of the page/widget body
@state let count = 0
text "{count}"
```

While Arc has top-level hoisting in the checker, reactive declarations should appear before their use for readability + correctness in template bodies.

### 8. Element doesn't have a recognized ID for binding

If you wrote your own raw HTML and tried to bind, Arc can only target elements it emitted. Use `<input>` (which Arc instruments) not `<div contenteditable>` (which it doesn't).

### 9. Event handler has a syntax error inside the braces

```arc
# ❌ Syntax error inside the handler — silently fails
button on:click={ @count =+ 1 }    # =+ is not an operator

# ✓
button on:click={ @count += 1 }
```

Run `arc check` to surface these.

### 10. Multiple components, each their own state

```arc
widget Counter
  @state let count = 0
  button on:click={ @count += 1 } "{count}"

page "Multi"
  Counter()
  Counter()    # Each invocation has its OWN count — separate state
```

If the user expects shared state across widget instances, use `arc/store` from the stdlib (global reactive store).

## Anti-patterns

- ❌ **Suggesting React patterns**: `useState`, `useEffect`, dependency arrays. Arc has no hooks.
- ❌ **Suggesting `setState({ count: count + 1 })`** — Arc has no setState.
- ❌ **Adding manual `getElementById` / `addEventListener`** — Arc generates these from `on:` and the reactive bindings. Manual DOM ops fight the framework.
- ❌ **Adding a re-render trigger** — Arc has no re-renders. State changes update exactly the DOM nodes that bind to that state.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Write sites use `@varname`** (not bare `varname`).
- [ ] **Read sites use bare `varname`** (not `@varname`).
- [ ] **`bind:value`** for inputs that have a value (text, email, url, password, number, search, tel, date, etc., plus `<select>`, `<textarea>`).
- [ ] **`bind:checked`** for checkbox / radio.
- [ ] **List operations use re-assignment** (`@items = [...items, x]`), not in-place mutation (`@items.push(x)`).
- [ ] **Derived values are `@computed`**, not `@state` mirroring another state.
- [ ] **No raw `addEventListener`** — use `on:click={...}` etc.
- [ ] **`arc check` clean** — many binding bugs surface as compile errors. Run it first.
- [ ] **Time complexity confirmed**: most handlers should be O(1). If a handler iterates state on every interaction, debounce or restructure.
- [ ] **No new client JS** added when the user only needed a static change. (Could `@build` have replaced this `@state`?)


---

## arc-explain-bytes

---
name: arc-explain-bytes
description: Use when the user asks "why is dist/ so big?" or pastes build output asking about specific artifacts. Itemizes every file in dist/ with what it is, why it exists, and how to shrink it if needed.
---

# arc-explain-bytes

**When to use:** the user is auditing build output size, comparing to other frameworks, or asking what's in a specific file.

**Reference docs:** `docs/internals/pipeline.md`, `docs/features/multi-page.md`, `arc-bench/RESULTS.md` for comparison numbers.

## Inventory of dist/ artifacts

After `arc build` (single-page):

| File | What it is | Typical size | How to shrink |
| --- | --- | --- | --- |
| `index.html` | The page HTML + inlined CSS (when CSS ≤14 KB) + inlined JS reference | 1–10 KB (Brotli ~500 B–3 KB) | Trim content; opt out of OG/JSON-LD; use `arc build-site` for multi-page CSS dedup |
| `styles.css` | External CSS when above 14 KB inline threshold | only present when CSS is large | Tune `criticalCssThreshold` in `arc.config.json` |
| `app.js` | Client JS (state setters, event listeners, ADP runtime if `@server` used from client) | 0 B (static) – ~2 KB | Drop unused `@state`; tree-shake ADP by avoiding client-side `@server` calls when possible |
| `app.js.map` | Source map for `app.js` | ~3× the JS size | Production: opt out via `--no-sourcemap` (CLI flag if added) |
| `_arc/functions.js` | `@server fn` bodies for edge runtime (server-only, NOT shipped to browser) | 1–20 KB | Out of client-byte budget — irrelevant for browser perf |
| `_arc/renderer.js` | `@live` edge worker (server-only, NOT shipped to browser) | 5–15 KB | Same — server-side only |

After `arc build-site` (multi-page), additional files:

| File | What it is |
| --- | --- |
| `shared.{sha}.css` | CSS rules used by ≥2 pages, content-hashed for immutable caching |
| `sitemap.xml` | Auto-generated from `meta.canonical` |
| `robots.txt` | Auto-generated, references sitemap |
| `_headers` | Cloudflare Pages / Netlify manifest (CSP + cache-immutable + Link preload) |

With image pipeline:

| File pattern | What it is |
| --- | --- |
| `<stem>.<sha>.{w}w.avif` | AVIF variant at width `w` (best modern compression) |
| `<stem>.<sha>.{w}w.webp` | WebP variant |
| `<stem>.<sha>.{w}w.<ext>` | Original-format fallback |

Each image generates up to 12 variants (3 formats × 4 widths). The BROWSER downloads ONE per `<img>`.

## How to read `arc build` stats output

```
arc: built index.arc
  HTML  2.9 KB    ← <head>+<body>, includes inlined CSS (under threshold)
  CSS   1.7 KB    ← original generated CSS size (before minify+inline)
  JS    4.2 KB    ← client bundle (raw, pre-gzip)
  Edge  6.0 KB    ← @server function bodies (server-only)
  Live  10.1 KB   ← @live edge renderer (server-only)
  → dist/
```

**Browser-shipped** = HTML + CSS + JS (when external) = ~9 KB raw → ~2 KB Brotli for this example.
**Server-only** = Edge + Live = 16 KB (zero cost to visitor, runs at edge).

## Comparison to other frameworks (typical numbers)

For an equivalent 20-section docs page at SEO parity (numbers from `arc-bench/RESULTS.md`):

| Stack | Brotli total |
| --- | --- |
| Arc | **1688 B** |
| Vanilla | 1750 B |
| Astro | 1794 B |
| Next.js | ~200 KB (React + Next runtime) |

The 100–200× gap vs Next.js is the runtime React framework JS. Arc has no equivalent runtime.

## Diagnosing "why is X so big?"

1. **HTML is bigger than expected** → inlined CSS may be exceeding threshold; consider splitting via `arc build-site` for multi-page. Check `dist/index.html` head for inlined `<style>` size.
2. **JS exists when expected 0** → page uses `@state` or `@server` invoked from client. Run `arc-self-verify` — could the user have used `@build` / `@live` instead?
3. **`app.js` is ~1 KB larger than expected** → ADP runtime is included (any `@server` call from client triggers it). Tree-shake by avoiding direct client `@server` invocations.
4. **dist/ is 100s of MB** → image pipeline generated too many variants (large source images at 3 formats × 4 widths × N images). Reduce source image dimensions; tune `imageFormats` per page.
5. **`_arc/*` is large** → many `@server` fns or complex `@live` template. These don't ship to browser — they cost edge function deploy size, not user bandwidth.

## Anti-patterns

- ❌ **Confusing server bytes with browser bytes**. `_arc/functions.js` and `_arc/renderer.js` are SERVER-SIDE — they don't affect user load time or Core Vitals.
- ❌ **Comparing raw bytes to other frameworks' gzipped bytes** — always compare apples to apples. Default to Brotli (matches what CDNs serve).
- ❌ **Treating `app.js.map` as bundle size** — source maps don't ship to users by default (browsers only fetch when DevTools opens).
- ❌ **Optimizing for build-time disk size** instead of wire-served bytes. Disk is cheap; bandwidth is what users feel.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Files categorized as "browser-shipped" vs "server-only"** — the user should know which numbers matter for Core Vitals.
- [ ] **Brotli sizes given alongside raw** (`gzip -c file | wc -c` for gzip, `node -e "require('zlib').brotliCompressSync(...)"` for Brotli level 11).
- [ ] **Comparison baseline cited** — "Vanilla 1750 B" + "Next.js 200 KB" gives the user a reference frame.
- [ ] **Shrink suggestions ranked by impact** — biggest savings first (e.g., "use `@build` to drop 600 B of ADP runtime" before "shorten variable names to save 30 B").
- [ ] **If user has multi-page**: confirm they're running `arc build-site` (not `arc build`) — single-page builds don't dedup CSS across pages, inflating per-page bytes.
- [ ] **Time complexity** of build: linear in source size + image count. State `O(n)` of pages + `O(image_size × format_count)` of images.


---

## arc-fix-checker-error

---
name: arc-fix-checker-error
description: Use when the user pastes `arc check` or `arc build` output with an error/warning. Matches the message against Arc's error catalog and suggests the precise fix.
---

# arc-fix-checker-error

**When to use:** the user pastes a compile error, syntax error, or `arc check` warning. Triggers on output containing `arc: error:`, `arc: warning:`, `Undefined variable`, `Unexpected token`, etc.

**Reference docs:** `docs/reference/errors.md` (authoritative catalog).

## Pattern

1. Identify the error category (lexer / parser / checker / build-exec / image-pipeline / cli).
2. Look up the exact message in `docs/reference/errors.md`.
3. Apply the documented fix to the user's source.
4. Verify the fix passes the `arc-self-verify` checklist.

## Top 15 errors (most common LLM hits)

| Error | Fix |
| --- | --- |
| `null is not a value in Arc — use none` | Replace `null` with `none` |
| `=== is not used in Arc — use ==` | Replace `===` with `==`, `!==` with `!=` (Arc's `==` is already strict) |
| `var is not allowed in Arc — use let or const` | Replace `var` with `let` (mutable) or `const` (immutable) |
| `function keyword not allowed — use fn` | Replace `function name() { }` with `fn name() { }` |
| `this not allowed — use @field` | Inside a class method, replace `this.x` with `@x` |
| `typeof / instanceof not allowed — use 'is'` | Replace `typeof x === 'string'` with `x is String`, `x instanceof Foo` with `x is Foo` |
| `switch not allowed — use match` | Convert switch to `match` with required `_` catch-all |
| `for..in not allowed — use 'for k, v in object'` | Use destructured `for k, v in obj` |
| `Match must have a catch-all '_'` | Add `_ => default` as the last arm |
| `bind:value path must be a simple variable or dotted path` | Use `@state` variable or dotted path; not a function call |
| `Undefined variable: x` | Declare `x` with `let`/`const`/`@state`/`@build`/etc. OR import it |
| `Unterminated string literal` | Add closing `"`. For newlines inside strings, use `\n` escape. |
| `Unterminated string interpolation` | Close `{...}` with `}`. For literal `{`, escape with `\{`. |
| `Indentation must be 2 spaces (got tab)` | Convert tabs to 2-space indent (configure editor to use spaces) |
| `WARN: <input> has no accessible name` | Add `<label for="id">` + `id=`, OR `aria-label=`, OR `placeholder=` |

## Less common (build / runtime errors)

| Error | Fix |
| --- | --- |
| `@build fetch: invalid URL` | Use absolute `http://` or `https://` URL |
| `@build fetch: only http/https allowed` | Arc blocks file://, ws://, etc. in `@build` for security. |
| `@build fetch: internal addresses not allowed` | Don't fetch `127.0.0.1` / `localhost` / private IPs from `@build` (SSRF guard). |
| `@build fetch: redirects not allowed (3XX)` | Use the final destination URL directly. Arc doesn't follow redirects. |
| `@build fetch: HTTP {status}` | Fix the URL or check the server. |
| `@build fetch: response too large (max 10MB)` | Paginate or restructure to fetch less. |
| `@build fetch: timeout after 10s` | Use a cache; check server health. |
| `@build readFile: path traversal blocked` | Keep paths within project root. |
| `@build readFile: forbidden filename pattern` | Don't read `.env`, `.git/`, `id_rsa`, `secrets.*`. |
| `arc: warning: import not found` | Fix the path; ensure the file exists. |
| `arc: warning: import escapes project root` | Keep imports within project root. |
| `arc: sharp not installed — skipping image optimization` | Run `npm install sharp` to enable AVIF/WebP/srcset. |
| `arc: image pipeline error` | Verify source file is a valid image. SVG isn't auto-transcoded. |
| `[arc] @live data error` | A `@server fn` threw inside `_resolveData()`. Wrap with try/catch + return `Err`. |
| `ADP: unknown tag N` | Decoder received a frame with unknown type tag. Server may be using a different protocol version. |

## Workflow for a pasted error

1. **Extract** the exact error line (`arc: error: <file>:<line>: <message>`).
2. **Read** the file at the cited line (use `Read` tool).
3. **Match** the message against the catalog above + `docs/reference/errors.md`.
4. **Propose** the minimal edit that resolves it.
5. **Apply** the edit.
6. **Re-run** `arc check` (or `arc build`) to confirm the error is gone.
7. **Run `arc-self-verify`** on the surrounding code — sometimes a checker error is a symptom of a broader simplification opportunity.

## Anti-patterns

- ❌ **Suggesting a workaround** (suppression, type cast) instead of the documented fix. Arc's errors are designed to be cheap to fix; the catalog has the right answer for each.
- ❌ **Disabling the check** (`// arc-ignore-next`) — Arc doesn't have suppression syntax for a reason. Fix the root cause.
- ❌ **Adding `// TODO: fix this` and moving on**.
- ❌ **Inventing an error category** not in the catalog. If the error isn't documented, it might be a compiler bug — recommend filing an issue.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Cited error is exactly reproducible** before the fix (run `arc check` to confirm).
- [ ] **Cited error is gone** after the fix (re-run `arc check`).
- [ ] **No new errors introduced** by the fix (compare before/after error count).
- [ ] **Fix matches the documented one** in `docs/reference/errors.md`. If you deviate, explain why.
- [ ] **Side effects considered**: e.g., changing `null → none` may affect comparisons elsewhere; changing `switch → match` requires a catch-all.
- [ ] **If the error is in stdlib** (`stdlib/*.arc`), tell the user it's a known stdlib issue — don't try to fix the stdlib unless they specifically asked. (Should be 0 errors after Arc 0.1.0.)
- [ ] **If the error is unrecognized**: don't guess. Tell the user it's not in the catalog and recommend filing an issue at `github.com/arc-language/arc-web/issues`.


---

## arc-from-astro

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


---

## arc-from-react

---
name: arc-from-react
description: Use when the user pastes a React/Next.js component and wants the Arc equivalent. Translates hooks, props, JSX, effects, and SSR patterns one-for-one. Always returns Arc code that ships ≥70× less bytes than the original.
---

# arc-from-react

**When to use:** the user pastes React or Next.js code (uses `useState`, `useEffect`, JSX, `'use client'`, `'use server'`, `getServerSideProps`, etc.) and wants the Arc translation.

**Reference docs:** `docs/guides/migrating-from-react.md`.

## Translation table (definitive)

| React pattern | Arc equivalent |
| --- | --- |
| `function Component({ prop }) { ... return <div>{prop}</div> }` | `widget Component(prop)\n  div\n    text "{prop}"` |
| `useState(0)` | `@state let x = 0` |
| `setX(v)` | `@x = v` |
| `setX(prev => prev + 1)` | `@x += 1` |
| `useEffect(() => { setX(fetchedData) }, [])` | `@server fn getData() -> ...` + `@live let x = getData()` (data BEFORE first paint, not after) |
| `useEffect(() => { ws.onmessage = ... }, [])` | `@realtime let messages = channel("name")` |
| `useMemo(() => fn(a, b), [a, b])` | `@computed let z = fn(a, b)` (deps inferred) |
| `useCallback(fn, [deps])` | Just use `fn` — Arc doesn't re-create per render (no renders) |
| `useRef(null)` | `id="x"` + `document.getElementById('x')` (escape hatch only) |
| `useContext(Ctx)` | `import { store } from "arc/store"` |
| `createContext` | `const myStore = store({ ... })` |
| `<Children />` | `@slot` inside widget body |
| `{items.map(item => <Card {...item} key={item.id} />)}` | `for item in items\n  Card(item.title, item.body)` (no `key`, Arc handles list updates) |
| `{cond && <X />}` | `if cond\n  X()` |
| `{cond ? <A /> : <B />}` | `if cond\n  A()\nelse\n  B()` |
| `className="card"` + CSS file | `card` (Arc layout primitive) + `design { card { ... } }` block |
| `<img src={src} alt={alt} />` | `img src="{src}" alt="{alt}"` (Arc pipeline runs automatically) |
| Server Component `async function Page()` | `@server fn` + `@live` |
| `'use client'` directive | Remove — Arc decides per-context automatically |
| `'use server'` action | `@server fn name(args) -> Result<T, E>` |
| `<Link href="/about">` (Next.js) | `link href="about.html"` (Arc) — `arc build-site` injects prefetch automatically |
| `<form action={action}>` (Next.js action) | `form on:submit={ await actionFn(...) }` |
| `cookies()` (Next.js) | `@session` (inside `@server fn`) |
| `notFound()` (Next.js) | `return Err("not found")` from `@server fn`, render 404 page conditionally |

## Concrete examples

### React counter → Arc

```jsx
// React
'use client'
import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <button onClick={() => setCount(c => c - 1)}>−</button>
      <span>{count}</span>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  )
}
```

```arc
# Arc
@state let count = 0

row
  button on:click={ @count -= 1 } "−"
  text "{count}"
  button on:click={ @count += 1 } "+"
```

Bytes shipped: React = ~225 KB (framework + component). Arc = ~250 B (direct DOM updater).

### Next.js Server Component → Arc @live

```jsx
// Next.js
async function Page() {
  const r = await fetch('/api/me', { headers: { cookie: cookies().toString() } })
  const user = await r.json()
  return <h1>Hello, {user.name}</h1>
}
```

```arc
# Arc
@server fn getUser() -> User
  const r = await fetch("/api/me", { headers: { cookie: @session.cookie } })
  return await r.json()

@live let user = getUser()
heading "Hello, {user.name}"
```

### Next.js server action → Arc @server fn

```jsx
// Next.js
async function submitContact(formData) {
  'use server'
  await db.contacts.add({ email: formData.get('email') })
}

<form action={submitContact}>
  <input name="email" type="email" required />
  <button type="submit">Send</button>
</form>
```

```arc
# Arc
@state let email = ""
@server fn submitContact(email: Email) -> Result<String, String>
  await db.contacts.add({ email })
  return Ok("Thanks!")

form on:submit={ await submitContact(email) }
  input type="email" bind:value={email} required
  button type="submit" "Send"
```

## Things that don't translate cleanly (be honest)

- **React Server Components with deep nesting** — Arc's `@live` is per-page, not per-component. Restructure to compute all server data at the page top.
- **Suspense boundaries** — Arc has no suspense (no rerender model). Use `@live` for "show once data ready" and `@state` for explicit loading UI.
- **`useTransition` / `useDeferredValue`** — Arc doesn't have priority schedulers. If you need debouncing, use `setTimeout` explicitly.
- **`forwardRef` / `useImperativeHandle`** — Arc has no ref forwarding. Widgets pass attributes through directly.
- **React Error Boundaries** — Arc has no error boundary primitive. Wrap risky `@server fn` calls in `Result<T, Err>` and handle at the call site.
- **Custom hooks** — extract shared logic into a `fn` or a stdlib widget. No hook composition rules to follow.

## Anti-patterns when translating

- ❌ **Keeping `useState` semantics** in Arc code — Arc reactivity is different (direct DOM ops, no renders, no batching).
- ❌ **Translating `useEffect` to a hand-rolled imperative block** — almost always wrong. Either it's data → `@live`, subscription → `@realtime`, or stateful interaction → `@state`.
- ❌ **Preserving `className` strings literally** — Arc generates scoped class names. Use `design` block.
- ❌ **Importing React components** into the Arc translation — Arc doesn't run React. Translate them too, or note them as out of scope.
- ❌ **Skipping `Result<T, E>` for the `@server fn`** — React throws; Arc returns Result.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **No `useState` / `useEffect` / `useMemo` / `useCallback`** in the output.
- [ ] **No JSX** — Arc's syntax is indentation-based.
- [ ] **All `@server fn` are typed** (params + return) — Arc's contract.
- [ ] **All `@server fn` use `Result<T, E>`** for fallible operations — not throws.
- [ ] **List rendering has NO `key=` props** — Arc handles list updates without React-style keys.
- [ ] **Per-component CSS lives in a `design` block** — no `className` chains.
- [ ] **Side effects (fetch, subscription) classified correctly**: data-on-load → `@live`; pushed updates → `@realtime`; user-action → `@server fn`.
- [ ] **Bundle delta calculated**: state how many bytes Arc ships vs the React original. Almost always 70–500× smaller.
- [ ] **TypeScript-isms removed**: `<T>` generics, `as Type` casts mostly drop. Arc has its own type system.


---

## arc-from-vanilla

---
name: arc-from-vanilla
description: Use when the user pastes plain HTML (+ inline CSS + inline JS) and wants the Arc equivalent. Converts script tags to @state/@server, inline styles to design blocks, manual fetches to @build/@live/@server.
---

# arc-from-vanilla

**When to use:** the user pastes an `.html` file or `<script>` + `<style>` blocks and asks for the Arc translation.

**Reference docs:** `docs/guides/migrating-from-vanilla.md`.

## Translation table

| HTML pattern | Arc equivalent |
| --- | --- |
| `<!doctype html>` + `<html>` + `<head>` + `<body>` | `page "Title"` — Arc auto-emits the entire document chrome |
| `<meta charset>`, `<meta viewport>` | Auto-emitted, don't write manually |
| `<title>X</title>` | `page "X"` |
| `<meta name="description">` | `page "X" description="..."` |
| `<link rel="stylesheet">` | `design { ... }` block at end of page |
| `<script>` block doing state | `@state let x = ...` + `on:event={...}` handlers |
| `<script>` fetching data on load | `@build` (compile-time) OR `@live` (per-request) OR `@server` (on-action) |
| `document.getElementById('x')` | `id="x"` + Arc bindings (rarely needed; use `bind:value` / `on:event`) |
| `addEventListener('click', fn)` | `on:click={ fn() }` |
| `innerHTML = '...'` | Reactive interpolation: `text "{value}"` |
| `<form>` with manual fetch | `form on:submit={ await @server-fn() }` |
| `<button>` (no type) | `button` (Arc auto-adds `type="button"` — prevents accidental submit) |
| `<a href="https://external">` | `link href="https://external"` (Arc auto-adds `target="_blank" rel="noopener noreferrer"`) |
| `<img src>` without dimensions | `img src` (Arc auto-adds width/height + lazy-load via image pipeline) |
| Inline `style="..."` | Move to `design` block; Arc scopes automatically |

## Concrete examples

### Vanilla counter → Arc

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Counter</title>
</head>
<body>
  <button id="incr">Count: 0</button>
  <script>
    let count = 0
    const btn = document.getElementById('incr')
    btn.addEventListener('click', () => {
      count++
      btn.textContent = `Count: ${count}`
    })
  </script>
</body>
</html>
```

```arc
page "Counter"
  @state let count = 0
  button on:click={ @count += 1 } "Count: {count}"
```

Arc replaces 15 lines with 3, AND auto-emits SEO/security defaults (CSP, OG, robots) the vanilla version skipped.

### Vanilla fetch-on-load → Arc @build

```html
<div id="users"></div>
<script>
  fetch('/api/users').then(r => r.json()).then(users => {
    document.getElementById('users').innerHTML =
      users.map(u => `<li>${u.name}</li>`).join('')
  })
</script>
```

If the user list is the same for all visitors:

```arc
@build const users = await fetch("https://api.example/users").then(r => r.json())

ul
  for u in users
    li "{u.name}"
```

The users are inlined as HTML at compile time. **Zero runtime fetch. Zero JavaScript.**

If per-user:

```arc
@server fn getUsers() -> User[]
  return await db.users.find({ visibleTo: @session.userId })

@live let users = getUsers()

ul
  for u in users
    li "{u.name}"
```

Server-rendered, no loading flash, no client fetch.

### Vanilla form → Arc

```html
<form id="contact" action="/contact" method="POST">
  <input name="email" type="email" required>
  <button>Send</button>
</form>
<script>
  document.getElementById('contact').addEventListener('submit', async e => {
    e.preventDefault()
    await fetch('/contact', { method: 'POST', body: new FormData(e.target) })
  })
</script>
```

```arc
@state let email = ""
@server fn submit(email: Email) -> Result<String, String>
  await db.contacts.add(email)
  return Ok("Thanks!")

form on:submit={ await submit(email) }
  input type="email" bind:value={email} required
  button type="submit" "Send"
```

`Email` type auto-validates server-side AND emits matching client-side validation.

### Vanilla CSS → Arc design block

```html
<style>
  .card { padding: 24px; border-radius: 8px; background: #fff; }
  @media (max-width: 640px) { .card { padding: 16px; } }
  @media (prefers-color-scheme: dark) { .card { background: #1a1a1a; } }
</style>
<div class="card">Hello</div>
```

```arc
card "Hello"

design
  card
    p: 24px
    radius: 8px
    bg: #fff
    @mobile { p: 16px }
    @dark { bg: #1a1a1a }
```

Arc scopes the class automatically (no global namespace), maps shorthand (`p:` → `padding:`), and emits proper media queries.

## What auto-improves when translating

| Hand-written HTML you'd need to remember | Arc auto-applies |
| --- | --- |
| `<meta http-equiv="Content-Security-Policy">` | yes |
| Open Graph + Twitter Card meta | yes (when description/image set) |
| JSON-LD structured data | yes (when schemaType set) |
| Skip link (`<a href="#main">`) | yes (when `<main>` exists) |
| `<main id="main-content">` injection | yes (if absent) |
| `loading="lazy"` on below-fold images | yes (via image pipeline + AST analysis) |
| `width`/`height` on images (prevents CLS) | yes (via image pipeline reading file header) |
| `<button type="button">` default | yes (prevents accidental submit) |
| `target="_blank" rel="noopener noreferrer"` on external links | yes |
| `prefers-reduced-motion` CSS reset | yes (in base layer) |
| `:focus-visible` styles | yes |

## What's lost in translation (intentionally)

- **No build step (vanilla wins here)** — Arc adds a 0.1 s compile step. But everything else gets better.
- **Smallest absolute byte count** — vanilla can hit ~500 B for a simple page. Arc adds ~80 B of auto-emitted SEO/security defaults (CSP, OG, robots).
- **Direct `<script>` embedding** — Arc doesn't let you inline arbitrary JS into HTML for security (CSP). Use `@state` / `@server fn` / event handlers.

## Anti-patterns when translating

- ❌ **Keeping `<!doctype html>` + `<html>` + `<head>` + `<body>`** in output — Arc auto-emits, will reject manual.
- ❌ **Preserving `getElementById` / `addEventListener`** — use `bind:value` / `on:event`.
- ❌ **Keeping `<style>` blocks** in the page body — move to `design`.
- ❌ **Preserving inline `<script>`** — Arc forbids inline scripts for CSP. Convert to `@state` / `@server`.
- ❌ **Replicating manual ARIA when Arc auto-applies it** — Arc adds skip link, focus styles, `:focus-visible` for you.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **No `<!doctype>` / `<html>` / `<head>` / `<body>` / `<style>` / `<script>`** in output.
- [ ] **No manual `getElementById` / `addEventListener`** — use Arc bindings.
- [ ] **Data fetches classified** correctly: `@build` (same for everyone) / `@live` (per-request server-rendered) / `@server` (client-triggered).
- [ ] **Form has typed `@server fn`** with `Result<T, E>` return.
- [ ] **CSS moved to `design` block**, with Arc shorthand where applicable (passthrough OK for anything Arc doesn't have).
- [ ] **SEO meta added if missing** — set `description`, `canonical`, `image`, `schemaType` for shareable pages.
- [ ] **Lines reduced**: the Arc version should be 30–70% shorter than the original HTML+CSS+JS (it's almost always shorter).
- [ ] **Bytes shipped reduced**: state the rough delta. Arc almost always wins because of CSS dedup + scoped output + no inline `<script>`.


---

## arc-multi-page-setup

---
name: arc-multi-page-setup
description: Use when the user has (or is about to have) 2+ pages in their Arc project. Triggers on "multi-page", "docs site", "blog with multiple posts", "I need routes". Switches the build to `arc build-site` which dedups CSS, generates sitemap.xml, emits _headers, injects prefetch + View Transitions.
---

# arc-multi-page-setup

**When to use:** the user has, or is about to have, two or more `.arc` files in their project. The single-page `arc build` doesn't dedup CSS or emit sitemap/headers — `arc build-site` does.

**Reference docs:** `docs/features/multi-page.md`, `docs/features/deployment.md`.

## Pattern

For a 2+ page project, structure as flat `.arc` files at the project root + run `arc build-site` instead of `arc build`.

### Project layout

```
my-site/
├── index.arc          # home page (becomes index.html)
├── about.arc          # → about.html
├── contact.arc        # → contact.html
└── docs/              # subdirectories also work
    ├── intro.arc      # → docs/intro.html
    └── advanced.arc   # → docs/advanced.html
```

### Build command

```bash
arc build-site
```

Output:

```
dist/
├── index.html
├── about.html
├── contact.html
├── docs/intro.html
├── docs/advanced.html
├── shared.{sha}.css         # CSS rules used by ≥2 pages, content-hashed
├── sitemap.xml              # from each page's meta.canonical
├── robots.txt
└── _headers                 # Cloudflare Pages / Netlify compatible
```

### What each page should declare

```arc
page "About Us" canonical="https://mysite.com/about" description="..." schemaType="WebPage"
  nav
    link href="index.html" "Home"
    link href="contact.html" "Contact"
  main
    heading "About"
    text "..."
```

The `canonical` meta drives the sitemap. Without it, the page won't appear in `sitemap.xml`.

## What `arc build-site` gives you for free

| Feature | What it does |
| --- | --- |
| Shared CSS dedup | Rules used on ≥2 pages → `shared.<sha>.css` (browser caches once across all routes) |
| sitemap.xml | One `<url>` per page with `<lastmod>`, `<changefreq>`, `<priority>` |
| robots.txt | References the sitemap |
| `_headers` manifest | CSP + security headers + `Cache-Control: immutable` for hashed assets + `Link:` preload (enables 103 Early Hints on Cloudflare/Fastly) |
| `<link rel="prefetch">` injection | One per same-site `<a href>` target — browser prefetches in idle time |
| `<meta name="view-transition">` injection | Cross-page nav gets smooth fade on supporting browsers |
| CSP via header | The per-page `<meta http-equiv="Content-Security-Policy">` is stripped from HTML (saves ~80 B per page) |

Measured impact on a 20-page docs site:
- Per-page Brotli: ~1419 B → ~1021 B (−28%)
- Site total HTML: 106 KB → 79 KB
- Warm-cache 2nd page: HTML only (~3 KB)

## Per-page meta drives sitemap

```arc
page "Hello" canonical="https://blog.example/hello" published="2026-05-01" modified="2026-05-24" priority=0.8 changefreq="weekly"
  ...
```

| Meta key | Sitemap effect |
| --- | --- |
| `canonical` | `<loc>` (required — without it, the page is skipped) |
| `modified` | `<lastmod>` (defaults to build date) |
| `priority` | `<priority>` (0.0–1.0, default 0.5) |
| `changefreq` | `<changefreq>` (default `weekly`) |

## Per-page opt-out

```arc
page "Heavy page" prefetch=false viewTransitions=false
  # No prefetch tags injected; no view-transition meta
```

Useful for heavy pages where you don't want background prefetch eating user bandwidth.

## Cross-page links

```arc
nav
  link href="about.html" "About"      # → /about.html (Arc prefetches this in idle)
  link href="docs/intro.html" "Docs"   # → /docs/intro.html
```

For SPA-feel routing without full page loads, use `arc/router` from the stdlib (View Transitions powered):

```arc
import { router } from "arc/router"

page "App shell"
  nav
    link href="/" "Home"
    link href="/about" "About"
  main
    router()
```

## Deploying

For Cloudflare Pages (recommended):

```bash
arc build-site
npx wrangler pages deploy dist/
```

Cloudflare Pages reads `_headers` automatically — applying CSP, cache-immutable for hashed assets, and 103 Early Hints from the `Link:` preload header.

Netlify supports `_headers` identically. Vercel needs manual `vercel.json` config (Arc doesn't auto-emit Vercel-specific config yet).

## Anti-patterns

- ❌ **Running `arc build` for a multi-page project**: no shared CSS, no sitemap, no `_headers`. Use `arc build-site`.
- ❌ **Forgetting `canonical` on pages you want indexed**: skipped from sitemap.
- ❌ **Hard-coded absolute URLs to your own pages** (`https://mysite.com/about` in `<a href>`): use relative `about.html` so prefetch + dev server work locally.
- ❌ **Inlining the same image on every page** without using `arc build-site`: content-hash dedup is part of multi-page mode. With single-page builds, every page gets its own copy.
- ❌ **Splitting into many subdirectories deeply nested**: Arc's discovery is straightforward but deeply nested routes (4+ levels) get awkward URLs. Flatten when possible.
- ❌ **Using `arc build-site` for a 1-page project**: works (falls back to `arc build`) but adds no value.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **`arc build-site` (not `arc build`)** in user instructions, build scripts, CI workflows.
- [ ] **Every page has `canonical`** if it should appear in sitemap. (Verify: `find dist -name '*.html' | xargs grep -L 'rel="canonical"'` should be empty.)
- [ ] **`shared.{sha}.css` is emitted** — verify after build. If not, all pages have unique CSS (rare) or only one page exists (`build-site` falls back to `build`).
- [ ] **`_headers` exists** in `dist/`. Verify CSP is in headers + stripped from per-page HTML.
- [ ] **`sitemap.xml` URL count matches expected page count** with canonicals.
- [ ] **Cross-page links use relative paths** (`about.html`, not `https://...`). Otherwise prefetch injection doesn't match.
- [ ] **Time complexity (build)**: linear in page count. 20-page site: ~1–2 seconds. 200 pages: ~10–20 seconds. Beyond that, consider parallelizing or partitioning.
- [ ] **Space complexity (dist)**: per-page HTML + ONE shared CSS + image variants (deduped). Linear in unique content.
- [ ] **First-visit + warm-cache scenario explained to user**: cold cache fetches `<page>.html` + `shared.css`. Warm cache (2nd page same session) fetches only `<page2>.html` — `shared.css` cached. That's the big win.
- [ ] **Mobile users tested**: prefetch can eat data on metered connections. The default is on; pages with large CSS/JS might want `prefetch=false`.


---

## arc-new-page

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


---

## arc-perf-audit

---
name: arc-perf-audit
description: Use when the user pastes a Lighthouse report, complains "this is slow", or asks for performance improvements. Diagnoses LCP/CLS/INP/TBT regressions and proposes Arc-idiomatic fixes ranked by impact.
---

# arc-perf-audit

**When to use:** the user has a Lighthouse report, WebPageTest result, or just says "this page feels slow." Distinct from `arc-explain-bytes` (which is about file sizes) — this is about user-perceived speed and Core Web Vitals.

**Reference docs:** `docs/features/multi-page.md`, `docs/features/images.md`, `arc-bench/RESULTS.md` for benchmark baselines.

## Methodology

1. **Identify the failing metric**: LCP, CLS, INP, FCP, TBT. Each has a different cause class.
2. **Bisect the cause**: image, JS, layout, render-blocking resource.
3. **Apply the Arc-idiomatic fix** (usually a 1-line change).
4. **Verify with `arc-self-verify` Core Vitals section**.

## LCP (Largest Contentful Paint) — target ≤ 2.5 s

Most common LCP element: a hero image OR the largest above-fold text block.

| Cause | Fix |
| --- | --- |
| Hero image not pre-prioritized | Arc auto-applies `fetchpriority="high"` to first 2 `<img>` before `<section>`. Verify the LCP element is one of them. If your LCP image is below a `<section>`, restructure or use `meta.fetchPriority` hint. |
| Server-rendered text waits on slow `@server` fn | Reduce the slowest `@server` fn's work; cache at the edge (Cloudflare KV). All `@live` decls run in parallel, so the slowest one IS the LCP gate. |
| Render-blocking CSS | Arc inlines critical CSS automatically below 14 KB. If your CSS is larger, the rest is `<link rel="preload">` deferred. Check `dist/index.html` head. |
| External font without `<link rel="preload">` | Add the preload hint manually; or use `font-display: swap` in the design block. Arc doesn't auto-preload custom fonts (yet). |
| Hero image too large | Image pipeline picks smallest viable AVIF, but source image dimensions matter. 4K source → still 4K in AVIF. Resize source to ≤ 2× display width. |

## CLS (Cumulative Layout Shift) — target ≤ 0.1

| Cause | Fix |
| --- | --- |
| Image missing dimensions | Arc auto-adds `width=`/`height=` via image pipeline. If you see CLS from an image, sharp probably isn't installed (pipeline no-op). Run `npm install sharp`. |
| Async-loaded content pushes layout | For `@state`-bound dynamic content, reserve space in CSS (`min-height`). For `@live` data — Arc renders before HTML ships, so no CLS. |
| Web font swap | Use `font-display: optional` to avoid swap entirely, OR pre-define the metric-equivalent fallback (`size-adjust`). |
| Late-loaded ad / iframe | Set explicit `width`/`height` on `<iframe>`. If you can't predict size, reserve aspect-ratio space with CSS. |

## INP (Interaction to Next Paint) — target ≤ 200 ms

| Cause | Fix |
| --- | --- |
| Event handler runs heavy synchronous work | Move to `@worker` (Web Worker) for CPU-bound work, OR debounce. Arc emits direct DOM updates with no diff cost, so per-update is fast. |
| Filtering/sorting huge lists on every keystroke | Debounce input (300 ms is the sweet spot). For >1000 items, move filtering to `@server fn` to avoid blocking main thread. |
| JSON.parse of huge payload | Use ADP (`@server fn` returns) — 10× faster decode than JSON. |
| Reactive cascade fires many `@computed` | Check the dependency graph — if `@computed let x = ...` triggers more computeds, the chain runs synchronously. Restructure to compute on read instead of on write where possible. |

## FCP (First Contentful Paint) — target ≤ 1.8 s

| Cause | Fix |
| --- | --- |
| Runtime data fetch before render | Move to `@build` (compile-time inline) or `@live` (edge-rendered) — both eliminate the client-side fetch round trip. |
| Render-blocking script | Arc emits `<script defer>` for `app.js`. Verify nothing else (analytics, etc.) blocks. |
| External CSS file | Arc inlines critical CSS below 14 KB. For multi-page, `arc build-site` uses `shared.<sha>.css` with `Link: rel=preload` hint in `_headers` for 103 Early Hints. |
| Cloudflare/Fastly without Early Hints | Deploy to a host that supports 103 (Cloudflare Pages, Fastly Compute). |

## TBT (Total Blocking Time) — target ≤ 200 ms

| Cause | Fix |
| --- | --- |
| Framework JS parse/eval | Arc ships ~0 framework JS. If TBT is high, check for inline scripts or third-party JS. |
| Synchronous third-party scripts | Add `async` / `defer`; or load on user interaction only. |
| Heavy `@worker` initialization on page load | Lazy-instantiate workers on first use. |

## Lighthouse-specific quirks

- Lighthouse runs in headless Chrome with simulated throttling (Slow 4G + 4× CPU). Real-device numbers may differ.
- AVIF decode in headless Chrome is ~50–100 ms slower than WebP. Arc's smart AVIF threshold (≥20% smaller than WebP) handles this — if you see LCP regress when AVIF is emitted, set `meta.imageFormats=["webp","jpg"]` per-page.
- `NO_LCP` error on Lighthouse: page has no detectable LCP element (very rare for real pages). Often happens on placeholder/error pages.

## Anti-patterns

- ❌ **Adding `loading="lazy"` to the hero image** — tanks LCP. Arc auto-prioritizes first 2 images; don't override.
- ❌ **Adding `<link rel="preload">` to every image** — counterproductive (browsers parallelize anyway). Use only for LCP candidates.
- ❌ **Caching `@live` results indefinitely** to "speed up the page" — that's `@build` territory. If data is the same forever, use `@build`.
- ❌ **Debouncing every input** including ones that should feel immediate (toggles, sliders) — only debounce expensive operations (filter, search, autosave).
- ❌ **Optimizing for one Lighthouse run** — numbers fluctuate ±5%. Run 3+ times, take median.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Failing metric named** with its target threshold (e.g., "LCP 3.2 s — above 2.5 s threshold").
- [ ] **Cause class identified** (image / JS / layout / blocking resource).
- [ ] **Arc-idiomatic fix proposed** (not "add memoization" — that's React-think).
- [ ] **Expected post-fix metric stated** (e.g., "should drop to ~900 ms LCP based on benchmark baseline").
- [ ] **Verify after applying**: re-run Lighthouse, confirm the metric improved.
- [ ] **If multiple causes**: rank by impact. Don't ship a 50-line refactor for a 5 ms gain.
- [ ] **Mention measurement noise**: ±5% per run; need 3+ runs for confidence.
- [ ] **Compare to benchmark baseline**: Arc's expected docs page LCP is ~900 ms on Lighthouse mobile profile. If far worse, something specific is wrong.


---

## arc-pick-data-context

---
name: arc-pick-data-context
description: Use when the user describes data they need to display or fetch. Decides between @build, @state, @computed, @live, @realtime, @server. This is the most important architectural decision in Arc — get it right and the app stays fast forever.
---

# arc-pick-data-context

**When to use:** the user says anything like "fetch X", "show user data", "load posts from API", "where should this data live?", "how do I make this dynamic?".

**Reference docs:** `docs/recipes/api-fetching.md`, `docs/language/data-contexts.md`.

## Decision tree

```
Will the data ever change after the user loads the page?
├── No (or only at deploy time)              → @build
└── Yes
    ├── Changes per user?
    │   ├── Yes
    │   │   ├── Needed at initial render?    → @live (server-rendered, inlined HTML)
    │   │   └── Only after a user action?    → @server fn (called from event handlers)
    │   └── No (changes globally over time)
    │       ├── Pushed updates (chat, presence)?  → @realtime
    │       └── Just want fresher data?           → @live (re-renders on each request)

Has the user said the value should react to other reactive values?
└── Yes → @computed (depends on @state / @live values)

Is the value purely client-side UI state?
└── Yes → @state (counter, toggle, form input)
```

## What to ask the user (if intent is ambiguous)

- "Does this data change per visitor?"
- "Does it need to be in the HTML before the user sees anything?"
- "Does it update after the page loads?"

## The five answers, ranked by client-bytes cost (cheapest first)

| Context | Client bytes | When |
| --- | --- | --- |
| `@build` | **0 B** | Data known at compile time. Fetched once during `arc build`. |
| `@live` | **0 B** | Per-request server data. Streamed into initial HTML at the edge. |
| `@state` | ~50–200 B per var | Client UI state (counter, toggle, form). |
| `@computed` | ~30 B per binding | Derived from `@state` (`@computed let doubled = count * 2`). |
| `@server` (called from client) | ~600 B ADP runtime + ~200 B per stub | RPC for actions (form submits, mutations). |
| `@realtime` | ~800 B WebSocket client | Live pushed updates. |

Prefer the leftmost option that fits the data's actual lifetime.

## Examples (each shows the right pick)

### Static blog content
```arc
# Same posts for every visitor, changes only at deploy
@build const posts = await fetch("https://cms/posts").then(r => r.json())
```

### Per-user dashboard
```arc
# Server-rendered, no loading state, one round trip
@server fn getUser() -> User
  return await db.users.find(@session.userId)
@live let user = getUser()
heading "Welcome, {user.name}"
```

### Counter / UI state
```arc
# Local only, no server, no fetch
@state let count = 0
button on:click={ @count += 1 } "{count}"
```

### Search-as-you-type against a small dataset
```arc
@build const products = readFile("./products.json")  # Inlined at build
@state let query = ""
@computed let filtered = products.filter(p => p.name.includes(query))
input bind:value={query}
for p in filtered { card "{p.name}" }
```

### Search-as-you-type against a huge dataset
```arc
# Too big to inline. Use @server, debounce, and ADP for fast wire format.
@server fn search(query: String) -> Product[]
  return await db.products.search(query, 20)
@state let query = ""
@state let results: Product[] = []
input on:input={ setTimeout(async () => @results = await search(query), 300) }
```

### Chat
```arc
@realtime let messages = channel("chat/room-42")
for msg in messages { card "{msg.author}: {msg.body}" }
```

## Anti-patterns

- ❌ `@state` for data that's the same for every visitor → wasted client JS. Use `@build`.
- ❌ `@server` called in `@computed` to fetch on every reactive change → spams the server. Debounce, or move to `@live`.
- ❌ `@live` for purely-client state like form input → unnecessarily edge-rendered. Use `@state`.
- ❌ Calling `fetch()` directly inside a component body — Arc doesn't have that pattern. Use the context annotations.
- ❌ Storing a derived value as `@state` instead of `@computed` — you'll forget to update it.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Bytes match data lifetime**: did you reach for `@state` when `@build` would have shipped 0 bytes?
- [ ] **`@server` fns are typed**: parameters AND return type. Untyped = no auto-validation, no ADP optimization.
- [ ] **`@server` fns called from client are tree-shake friendly**: if no client `on:click` invokes a `@server`, Arc strips the ADP runtime (~600 B). Verify the client code actually calls them.
- [ ] **`@live` resolutions are parallelizable**: if you have multiple `@live let`, Arc wraps them in `Promise.all` automatically. Verify they're independent (no `@live let b = useA(a)` chains).
- [ ] **`@realtime` server exists**: client is auto-generated but the user must provide the WebSocket server (Durable Object / Bun WS / etc.). Mention this if scaffolding.
- [ ] **No `await` outside async context** — Arc warns. `@server fn` bodies are implicitly async; `@build` allows `await`; `@computed` does not.


---

## arc-write-test

---
name: arc-write-test
description: Use when the user wants to write a test for the Arc compiler (a contribution) or for their own Arc app. Provides the test scaffolding pattern + assertion conventions.
---

# arc-write-test

**When to use:** the user is writing a test — either contributing to Arc itself (`tests/*.test.js`) or testing their own Arc project.

**Reference:** `docs/internals/contributing.md`, existing tests in `tests/`.

## Test runner: Node's built-in

Arc uses Node's `--test` flag (no Jest, no Mocha). Available since Node 18+, required Node 20+.

```bash
node --test tests/*.test.js                # run all
node --test tests/lexer.test.js            # one file
node --test --test-name-pattern="image" tests/   # by name pattern
node --test --experimental-test-coverage tests/  # with coverage
```

## File structure

```js
// tests/<area>.test.js
'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert')

// Import the thing under test
const { compile } = require('../src/cli')
// Or per-module:
// const { Lexer } = require('../src/lexer')
// const { Parser } = require('../src/parser')

describe('<feature>: <area>', () => {
  test('<specific behavior>', async () => {
    // Arrange
    const src = `page "Test"\n  text "hi"`

    // Act
    const { html, css, js } = await compile(src)

    // Assert
    assert.ok(html.includes('<p>hi</p>'))
    assert.equal(js.trim(), '')
  })

  test('<another behavior>', async () => {
    ...
  })
})
```

## Assertion patterns

```js
// Substring presence (most common for emit tests)
assert.ok(html.includes('<some-tag>'))
assert.ok(html.includes('class="arc-'))

// Exact match
assert.equal(actual, expected)
assert.strictEqual(actual, expected)   // === comparison

// Regex match
assert.match(html, /class="arc-card_[a-z0-9]+"/)

// Negative: substring NOT present (for tree-shake tests, opt-out tests)
assert.ok(!html.includes('something-that-should-be-stripped'))

// Throws
assert.throws(() => doIt(), /expected error pattern/)

// Async throws
await assert.rejects(asyncDoIt(), /pattern/)

// Deep equality (for AST nodes, JSON-LD, etc.)
assert.deepStrictEqual(actual, expected)
```

## What to test

### For Arc compiler contributions

| Layer | Test it as |
| --- | --- |
| Lexer | Token stream from a string source |
| Parser | AST shape from a token stream OR from source via lexer+parser |
| Checker | Errors / warnings from a source string |
| Optimizer | AST transformation (input AST → output AST) |
| Emitters (HTML/CSS/JS) | String output from a `page` / `widget` declaration |
| End-to-end | `compile(src)` returns `{ html, css, js, edgeFunctions, liveEdgeFunction }` with expected properties |

For each new feature or bug fix, test:
1. **Happy path** — the feature works as documented
2. **At least one edge case** — empty input, single element, deeply nested, etc.
3. **Failure mode** — invalid input emits the right error (use `assert.throws` or `assert.rejects`)

### For Arc projects (user apps)

Arc has no built-in test harness for `.arc` files. Two options:
1. **`arc check`** in CI — catches type / a11y / syntax errors at build time
2. **Manual integration tests** — use Playwright / Puppeteer against the built `dist/`

For unit-testing logic inside `@server fn`, extract pure functions into a `.js` file you can import + test:

```js
// helpers.js
function calculatePrice(items, discount) { ... }
module.exports = { calculatePrice }

// helpers.test.js
const assert = require('node:assert')
const { calculatePrice } = require('./helpers')

test('discount applies correctly', () => {
  assert.equal(calculatePrice([{ price: 10 }], 0.1), 9)
})
```

Then import the helper from your `.arc` `@server fn`:

```arc
@server fn checkout() -> Number
  const items = await getCart()
  return calculatePrice(items, 0.1)
```

## Coverage policy

- **Aim**: ≥95% line coverage on lines you touched
- **Run**: `node --test --experimental-test-coverage tests/`
- **Inspect per-file**: the output lists each file with line/branch/function percentages

For a PR, coverage on the diff matters more than total coverage. Use `--test-coverage-lines=95` to make CI fail on regression.

## Common pitfalls

- ❌ **Forgetting `await`** on async tests: `test('x', async () => { compile(src) })` — should be `await compile(src)`.
- ❌ **Hard-coded scoped class names**: `assert.ok(html.includes('arc-card_1g18'))` — the hash changes if anything in the program changes. Use `assert.match(html, /arc-card_[a-z0-9]+/)`.
- ❌ **Testing against entire HTML string with `assert.equal`** — fragile. Test for the SPECIFIC behavior (substring or regex).
- ❌ **Sharing state between tests** — each test should be isolated. Don't assign to module-level `let` in tests.
- ❌ **Time-dependent tests** without `Date.now()` mock — flaky. Either inject the date or accept slight imprecision.
- ❌ **Skipping cleanup** for tests that write files: use `os.tmpdir()` + `fs.mkdtempSync` + `try/finally rmDir`.

## Anti-patterns

- ❌ **No test for a bug fix** — PR won't merge. Always add one that fails on the old code, passes on the new.
- ❌ **Testing implementation details** (private function names, internal state) — test the OBSERVABLE behavior (compiled output).
- ❌ **Mocking the compiler** — Arc has no DI; just call `compile()` directly. It's fast (~10 ms for a simple page).
- ❌ **Multiple assertions for unrelated concerns in one test** — split into multiple tests.

## Verification

Apply the universal **arc-self-verify** checklist to the test itself. In addition:

- [ ] **Test fails on the broken code, passes on the fixed code** (for bug fixes — confirm both directions).
- [ ] **`describe` + `test` names are descriptive**: future maintainers should understand WHAT broke without reading the test body.
- [ ] **Arrange/Act/Assert structure** visible.
- [ ] **Isolated** — no order dependency, no shared mutable state.
- [ ] **Async tests use `await`** correctly.
- [ ] **Scoped class names matched with regex** (`arc-card_[a-z0-9]+`), not exact string.
- [ ] **Cleanup in `try/finally`** for tests that touch the filesystem.
- [ ] **Coverage on the touched code path ≥95%**.
- [ ] **Time complexity** of the test: should be O(1) for unit tests; integration tests may be O(n) for example builds.
- [ ] **Test runs in <1 s** (most unit tests should be <100 ms). Slow tests get cut by CI timeouts.
